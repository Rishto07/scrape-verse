import { spawn, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { z } from 'zod';
import { CollectorInfo, ScrapeResult, HealResult, ScrapeHtmlResult, CollectorInfoSchema, ScrapeResultSchema, HealResultSchema, ScrapeHtmlResultSchema } from './schema.js';

const isWin = process.platform === 'win32';
const BD_CLI = isWin ? 'cmd.exe' : 'npx';

// Ensure Bright Data CLI is installed (checked on first use)

const BD_ARGS_BASE = ['-p', '@brightdata/cli'];

// ------------------------------------------------------------
// HTTP/1.1 fetch shim
// Injected via NODE_OPTIONS=--require into every CLI child process.
// Node >=24 negotiates HTTP/2 with api.brightdata.com; valid unlocker
// responses then die mid-stream with ERR_HTTP2_STREAM_ERROR /
// NGHTTP2_PROTOCOL_ERROR. Forcing HTTP/1.1 fixes it completely.
// ------------------------------------------------------------
const HTTP1_SHIM_PATH = path.join(tmpdir(), 'scrapverse-force-http1.js');
const HTTP1_SHIM_SRC = `
(function install() {
  if (globalThis.__forceHttp1Installed || typeof Response === 'undefined') return;
  globalThis.__forceHttp1Installed = true;
  const https = require('https');
  const http = require('http');

  function headerPairs(h) {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function') {
      h.forEach((v, k) => { out[k] = v; });
    } else {
      Object.assign(out, h);
    }
    return out;
  }

  async function fetch(input, init = {}) {
    let url = typeof input === 'string' ? input : (input && input.url) || String(input);
    for (let hop = 0; hop <= 5; hop++) {
      const method = (init.method || 'GET').toUpperCase();
      const headers = headerPairs(init.headers);
      const proto = url.startsWith('http://') ? http : https;
      const body = init.body;

      const res = await new Promise((resolve, reject) => {
        const req = proto.request(url, { method, headers }, (r) => resolve(r));
        req.on('error', reject);
        if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
          req.write(typeof body === 'string' ? body : Buffer.from(body));
        }
        req.end();
      });

      const buf = await new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      const status = res.statusCode || 0;
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && loc) {
        url = new URL(loc, url).toString();
        if ([301, 302, 303].includes(status)) {
          init = { ...init, method: 'GET', body: undefined };
        }
        continue;
      }

      const flat = {};
      for (const [k, v] of Object.entries(res.headers)) {
        flat[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      return new Response(buf, { status, headers: flat });
    }
    throw new Error('Too many redirects');
  }

  globalThis.fetch = fetch;
})();
`;

function ensureHttp1Shim(): void {
  if (!existsSync(HTTP1_SHIM_PATH)) {
    try {
      writeFileSync(HTTP1_SHIM_PATH, HTTP1_SHIM_SRC, 'utf-8');
    } catch {
      // Non-fatal: CLI falls back to native fetch behavior
    }
  }
}

// Helper to run CLI commands and parse JSON output
function runCli(args: string[], options: SpawnOptions = {}, timeoutMs = 5 * 60 * 1000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(async (resolve, reject) => {
    const fullArgs = isWin ? ['/c', 'npx', ...BD_ARGS_BASE, ...args] : [...BD_ARGS_BASE, ...args];

    // Prefer IPv4 and force HTTP/1.1 for the CLI's fetch (see shim above)
    const nodeOpts = [
      process.env.NODE_OPTIONS,
      '--dns-result-order=ipv4first',
      existsSync(HTTP1_SHIM_PATH) ? `--require ${HTTP1_SHIM_PATH.replace(/\\/g, '/')}` : '',
    ].filter(Boolean).join(' ');

    const child = spawn(BD_CLI, fullArgs, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env, NODE_OPTIONS: nodeOpts },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${BD_CLI}: ${err.message}`));
    });

    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI command timed out after ${Math.round(timeoutMs / 1000)}s: ${fullArgs.join(' ')}`));
    }, timeoutMs);
  });
}

const TRANSIENT_ERROR_RE = /timed out|fetch failed|HTTP2|NGHTTP2|ECONNRESET|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|Network request failed/i;

// Wrap runCli with bounded retries for transient transport errors
// (intermittent HTTP/2 stream failures against the Bright Data API)
async function runCliResilient(
  args: string[],
  options: SpawnOptions = {},
  timeoutMs = 5 * 60 * 1000,
  attempts = 3
): Promise<{ stdout: string; stderr: string; code: number }> {
  let lastErr: unknown;
  const backoffMs = [0, 4000, 12000];
  for (let i = 0; i < attempts; i++) {
    if (backoffMs[i] > 0) {
      await new Promise((r) => setTimeout(r, backoffMs[i]));
    }
    try {
      return await runCli(args, options, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT_ERROR_RE.test(String(err))) throw err;
      console.warn(`[BrightData] Transient CLI failure (attempt ${i + 1}/${attempts}): ${String(err).slice(0, 160)}`);
    }
  }
  throw lastErr;
}

// Extract an array of result rows from mixed CLI output
// (progress lines like "Polling (attempt 1/600)" precede the JSON payload)
function extractRows(output: string): Record<string, unknown>[] | null {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    }
  } catch {
    // fall through
  }
  return null;
}

// Parse a JSON object from mixed CLI output (logs may precede/follow it)
function extractObject(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

// Parse JSON from CLI output, handling both pretty and compact output
function parseJsonOutput<T>(output: string, schema: z.ZodSchema<T>): T {
  // Try to find JSON in the output (CLI may print logs before/after)
  const jsonMatch = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in CLI output:\n${output.slice(0, 500)}`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return schema.parse(parsed);
  } catch (err) {
    throw new Error(`Failed to parse CLI JSON output: ${err}\nOutput: ${output.slice(0, 500)}`);
  }
}

export interface BrightDataCLI {
  // Collector management
  createCollector(url: string, description: string): Promise<string>;
  runCollector(collectorId: string, url: string): Promise<ScrapeResult>;
  runPipeline(pipelineType: string, url: string): Promise<ScrapeResult>;
  healCollector(collectorId: string, prompt: string, url: string, autoApprove?: boolean): Promise<HealResult>;
  approveHeal(collectorId: string, url: string): Promise<void>;
  rejectHeal(collectorId: string): Promise<void>;
  listCollectors(): Promise<CollectorInfo[]>;
  scrapeHtml(url: string): Promise<ScrapeHtmlResult>;

  // Utility
  login(): Promise<void>;
  version(): Promise<string>;
}

export function createBrightDataCLI(): BrightDataCLI {
  ensureHttp1Shim();
  return {
    async login() {
      const { stdout, stderr, code } = await runCliResilient(['bdata', 'login']);
      if (code !== 0) {
        throw new Error(`Login failed (code ${code}): ${stderr || stdout}`);
      }
      console.log('[BrightData] Login successful');
    },

    async version() {
      const { stdout, code } = await runCli(['bdata', '--version']);
      if (code !== 0) throw new Error(`Version check failed: ${stdout}`);
      return stdout.trim();
    },

    async createCollector(url: string, description: string): Promise<string> {
      console.log(`[BrightData] Creating collector for ${url}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'scraper', 'create', url, description,
        '--json' // Ensure JSON output
      ]);

      if (code !== 0) {
        throw new Error(`Create collector failed (code ${code}): ${stderr || stdout}`);
      }

      // The create command returns the collector ID in JSON
      const result = parseJsonOutput(stdout, CollectorInfoSchema);
      const collectorId = result.collector_id;

      if (!collectorId || !collectorId.startsWith('c_')) {
        throw new Error(`Unexpected create collector response: ${stdout}`);
      }

      console.log(`[BrightData] Created collector: ${collectorId}`);
      return collectorId;
    },

    async runCollector(collectorId: string, url: string): Promise<ScrapeResult> {
      console.log(`[BrightData] Running collector ${collectorId} on ${url}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'scraper', 'run', collectorId, url,
        '--json', '--pretty'
      ]);

      if (code !== 0 && !stdout.includes('[')) {
        // Check if it's a "building" status (async)
        if (stdout.includes('building') || stdout.includes('status')) {
          const result = extractObject(stdout);
          return {
            url,
            status: 'building',
            data: (result?.data || result?.items) as Record<string, unknown>[] | undefined,
            error: result?.error as string | undefined
          };
        }
        throw new Error(`Run collector failed (code ${code}): ${stderr || stdout}`);
      }

      // Shape 1: bare array of row objects (CLI polls internally, then prints rows)
      const rows = extractRows(stdout);
      if (rows) {
        return {
          url,
          items: rows,
          data: rows,
          status: 'success',
        };
      }

      // Shape 2: object wrapper { items: [...] } / { data: ... }
      const obj = extractObject(stdout);
      if (obj) {
        const wrapped = ScrapeResultSchema.safeParse(obj);
        if (wrapped.success) {
          const r = wrapped.data;
          const items = (r.items || []) as Record<string, unknown>[];
          return {
            url,
            items,
            data: ((r.data || items) as Record<string, unknown>[] | undefined),
            status: 'success',
          };
        }
        // building/triggered response with a run id but no rows yet
        if (typeof obj.status === 'string') {
          return {
            url,
            status: 'building',
            error: typeof obj.error === 'string' ? obj.error : undefined,
          };
        }
      }

      throw new Error(
        `Run collector returned unrecognized output:\n${stdout.slice(0, 300)}`
      );
    },

    async runPipeline(pipelineType: string, url: string): Promise<ScrapeResult> {
      console.log(`[BrightData] Running pipeline ${pipelineType} on ${url}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'pipelines', pipelineType, url,
        '--json', '--pretty'
      ]);

      if (code !== 0) {
        throw new Error(`Run pipeline failed (code ${code}): ${stderr || stdout}`);
      }

      const rows = extractRows(stdout);
      if (rows) {
        return {
          url,
          items: rows,
          data: rows,
          status: 'success',
        };
      }

      const obj = extractObject(stdout);
      const items = ((obj?.items || obj?.data || []) as Record<string, unknown>[]);
      return {
        url,
        items,
        data: items,
        status: 'success',
      };
    },

    async healCollector(
      collectorId: string,
      prompt: string,
      url: string,
      autoApprove = false
    ): Promise<HealResult> {
      console.log(`[BrightData] Healing collector ${collectorId} ${autoApprove ? '(auto-approve)' : ''}...`);
      const args = [
        'bdata', 'scraper', 'heal', collectorId, prompt,
        '--url', url,
        '--json', '--pretty'
      ];

      if (autoApprove) {
        args.push('--auto-approve');
        // Increase timeout for auto-approve polling
        args.push('--timeout', '1800'); // 30 minutes
      }

      // CLI polls up to 30 min when auto-approving; give it headroom
      const { stdout, stderr, code } = await runCliResilient(args, {}, (autoApprove ? 32 : 5) * 60 * 1000);

      if (code !== 0) {
        throw new Error(`Heal failed (code ${code}): ${stderr || stdout}`);
      }

      // Tolerant parse: heal output shape varies between CLI versions
      const obj = extractObject(stdout);
      const raw = (obj?.status ?? obj?.state) as string | undefined;
      const statusMap: Record<string, HealResult['status']> = {
        awaiting_approval: 'awaiting_approval',
        pending: 'awaiting_approval',
        approved: 'approved',
        done: 'done',
        completed: 'done',
        success: 'done',
      };
      if (raw && statusMap[raw]) {
        return {
          status: statusMap[raw],
          collector_id: collectorId,
          message: typeof stdout === 'string' ? undefined : undefined,
          diff: typeof obj?.diff === 'string' ? obj.diff : undefined,
        };
      }
      // Unknown but successful output — assume the CLI finished its job
      return { status: 'done', collector_id: collectorId };
    },

    async approveHeal(collectorId: string, url: string): Promise<void> {
      console.log(`[BrightData] Approving heal for ${collectorId}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'scraper', 'approve', collectorId,
        '--url', url,
        '--json', '--pretty'
      ]);

      if (code !== 0) {
        throw new Error(`Approve heal failed (code ${code}): ${stderr || stdout}`);
      }

      console.log(`[BrightData] Heal approved for ${collectorId}`);
    },

    async rejectHeal(collectorId: string): Promise<void> {
      console.log(`[BrightData] Rejecting heal for ${collectorId}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'scraper', 'approve', collectorId,
        '--reject',
        '--json', '--pretty'
      ]);

      if (code !== 0) {
        throw new Error(`Reject heal failed (code ${code}): ${stderr || stdout}`);
      }

      console.log(`[BrightData] Heal rejected for ${collectorId}`);
    },

    async listCollectors(): Promise<CollectorInfo[]> {
      const { stdout, code } = await runCli(['bdata', 'pipelines', 'list', '--json']);

      if (code !== 0) {
        throw new Error(`List collectors failed (code ${code}): ${stdout}`);
      }

      const result: unknown = parseJsonOutput(stdout, CollectorInfoSchema);
      if (Array.isArray(result)) {
        return result;
      }
      return (result as { collectors: CollectorInfo[] }).collectors;
    },

    async scrapeHtml(url: string): Promise<ScrapeHtmlResult> {
      console.log(`[BrightData] Scraping HTML for ${url}...`);
      const { stdout, stderr, code } = await runCliResilient([
        'bdata', 'scrape', url,
        '-f', 'html',
        '--json', '--pretty'
      ]);

      if (code !== 0) {
        throw new Error(`Scrape HTML failed (code ${code}): ${stderr || stdout}`);
      }

      const trimmed = stdout.trim();

      // Shape 1: {"html": "...", "url": "..."} object
      try {
        const result = parseJsonOutput(trimmed, ScrapeHtmlResultSchema);
        return { html: result.html, url: result.url || url };
      } catch {
        // fall through to alternate shapes
      }

      // Shape 2: bare JSON string — "<!doctype html>..."
      if (trimmed.startsWith('"')) {
        try {
          const html = JSON.parse(trimmed);
          if (typeof html === 'string' && html.length > 0) {
            return { html, url };
          }
        } catch {
          // fall through
        }
      }

      // Shape 3: raw HTML printed directly
      if (trimmed.startsWith('<')) {
        return { html: trimmed, url };
      }

      throw new Error(
        `Scrape HTML returned unrecognized output:\n${stdout.slice(0, 300)}`
      );
    },
  };
}

// Event emitter for CLI operations (useful for dashboard updates)
export class BrightDataEventEmitter extends EventEmitter {
  private cli: BrightDataCLI;

  constructor(cli: BrightDataCLI) {
    super();
    this.cli = cli;
  }

  async runCollectorWithEvents(collectorId: string, url: string): Promise<ScrapeResult> {
    this.emit('run_started', { collectorId, url, timestamp: new Date().toISOString() });

    try {
      const result = await this.cli.runCollector(collectorId, url);
      this.emit('run_completed', { collectorId, url, result, timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      this.emit('run_error', { collectorId, url, error: String(err), timestamp: new Date().toISOString() });
      throw err;
    }
  }

  async healCollectorWithEvents(
    collectorId: string,
    prompt: string,
    url: string,
    autoApprove = true
  ): Promise<HealResult> {
    this.emit('heal_started', { collectorId, url, prompt, timestamp: new Date().toISOString() });

    try {
      const result = await this.cli.healCollector(collectorId, prompt, url, autoApprove);
      this.emit('heal_completed', { collectorId, url, result, timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      this.emit('heal_error', { collectorId, url, error: String(err), timestamp: new Date().toISOString() });
      throw err;
    }
  }
}