import dotenv from 'dotenv';
dotenv.config({ override: true });
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cron from 'node-cron';
import { createBrightDataCLI, BrightDataCLI } from './brightdata.js';
import {
  DEFAULT_COLLECTORS,
  PIPELINE_TYPES,
  REAL_COLLECTOR_IDS,
  CollectorConfig,
  HealEvent,
} from './schema.js';
import {
  initializeDb,
  saveCollector,
  listCollectors,
  getCollector,
  generateId,
  getLatestHealth,
  getHealthHistory,
  getHealEvents,
  saveHealthMetrics,
  saveHealEvent,
} from './store.js';
import { eventBus } from './events.js';
import { monitorAndHeal, initializeSnapshot } from './heal.js';
import { runHealthCheck } from './monitor.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/15 * * * *'; // every 15 min
const REALTIME_MODE = process.env.REALTIME_MODE === 'true'; // faster schedule for demo
const MOCK_MODE = process.env.MOCK_MODE === 'true'; // simulated collectors, no Bright Data calls

// ============================================================
// Initialization
// ============================================================

async function ensureCollectorsInitialized(): Promise<CollectorConfig[]> {
  const existing = listCollectors();
  const existingNames = new Set(existing.map((c) => c.name));

  for (const def of DEFAULT_COLLECTORS) {
    if (existingNames.has(def.name)) continue;

    // Use pre-built pipeline types as collectorId
    const collectorId = PIPELINE_TYPES[def.name as keyof typeof PIPELINE_TYPES];
    if (!collectorId) {
      console.warn(`[Init] No pipeline type found for ${def.name} — skipping`);
      continue;
    }

    const now = new Date().toISOString();
    const config: CollectorConfig = {
      id: generateId(),
      collectorId,
      name: def.name,
      targetUrl: def.targetUrl,
      description: def.description,
      expectedFields: def.expectedFields,
      createdAt: now,
      updatedAt: now,
    };

    saveCollector(config);
    console.log(`[Init] Registered ${def.name} → pipeline: ${collectorId}`);
  }

  // Upgrade collectors that have real Bright Data custom collector IDs
  for (const [name, realId] of Object.entries(REAL_COLLECTOR_IDS)) {
    const current = listCollectors().find((c) => c.name === name);
    if (!current) continue;
    if (current.collectorId === realId) continue;

    saveCollector({
      ...current,
      collectorId: realId,
      updatedAt: new Date().toISOString(),
    });
    console.log(`[Init] ${name}: upgraded to real collector ${realId}`);
  }

  return listCollectors();
}

// ============================================================
// Mock Data Seeding (for demo when Bright Data is slow)
// ============================================================

function seedMockData(): void {
  const existing = listCollectors();
  if (existing.length > 0) return; // Already has data

  console.log('[Seed] No collectors found — seeding mock data for demo...');

  const mockCollectors: CollectorConfig[] = [
    {
      id: generateId(),
      collectorId: 'c_mock_hackernews',
      name: 'hacker-news',
      targetUrl: 'https://news.ycombinator.com',
      description: 'Hacker News front page scraper',
      expectedFields: ['title', 'url', 'points', 'author', 'comments', 'rank'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      collectorId: 'c_mock_github',
      name: 'github-trending',
      targetUrl: 'https://github.com/trending',
      description: 'GitHub trending repositories',
      expectedFields: ['name', 'description', 'language', 'stars', 'starsToday', 'url'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      collectorId: 'c_mock_producthunt',
      name: 'product-hunt',
      targetUrl: 'https://www.producthunt.com',
      description: 'Product Hunt daily launches',
      expectedFields: ['name', 'tagline', 'votes', 'url', 'category'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      collectorId: 'c_mock_reddit',
      name: 'reddit-programming',
      targetUrl: 'https://www.reddit.com/r/programming',
      description: 'Extract Reddit posts: title, url, score, author, comments, subreddit',
      expectedFields: ['title', 'url', 'score', 'author', 'num_comments', 'subreddit'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: generateId(),
      collectorId: 'c_mock_youtube',
      name: 'youtube-tech',
      targetUrl: 'https://www.youtube.com/@fireship',
      description: 'Extract YouTube videos: title, views, likes, comments, published',
      expectedFields: ['title', 'view_count', 'like_count', 'comment_count', 'published_at'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  for (const collector of mockCollectors) {
    saveCollector(collector);

    // Seed health metrics
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 15 * 60000).toISOString();
      saveHealthMetrics({
        collectorId: collector.collectorId,
        url: collector.targetUrl,
        timestamp: ts,
        matchRate: 0.85 + Math.random() * 0.15,
        nullRate: Math.random() * 0.05,
        rowCount: Math.floor(20 + Math.random() * 30),
        latencyMs: Math.floor(500 + Math.random() * 2000),
        fieldStats: {},
      });
    }

    // Seed heal events
    const healStatuses: HealEvent['status'][] = ['success', 'success', 'success', 'failed', 'started'];
    for (let i = 0; i < 3; i++) {
      const ts = new Date(now.getTime() - i * 30 * 60000).toISOString();
      const status = healStatuses[i % healStatuses.length];
      saveHealEvent({
        id: generateId(),
        collectorId: collector.collectorId,
        timestamp: ts,
        trigger: i === 0 ? 'manual' : 'scheduled',
        prompt: 'Fix broken selector for title element after site redesign',
        status,
        diff: status === 'success' ? JSON.stringify({
          addedFields: i === 0 ? ['rank'] : [],
          removedFields: [],
          changedSelectors: [
            {
              field: 'title',
              oldSelector: '.titleline > a',
              newSelector: '.titleline a',
              oldContext: 'Hacker News post title',
              newContext: 'Updated selector after DOM change',
            },
          ],
          summary: 'Selector updated after site layout change',
        }) : undefined,
        oldDomHash: status === 'success' ? 'a1b2c3d4' : undefined,
        newDomHash: status === 'success' ? 'e5f6a7b8' : undefined,
        error: status === 'failed' ? 'Selector validation failed: element not found' : undefined,
        durationMs: Math.floor(2000 + Math.random() * 8000),
      });
    }
  }

  console.log('[Seed] Mock data seeded: 3 collectors with health history and heal events.');
}

// Seed mock health data for collectors that have no health data
function seedMockHealthData(collectors: CollectorConfig[]): void {
  for (const collector of collectors) {
    // Only seed if no health data exists
    if (getLatestHealth(collector.collectorId) !== null) continue;

    console.log(`[Seed] Seeding mock health for ${collector.name}...`);

    // Seed health metrics
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 15 * 60000).toISOString();
      saveHealthMetrics({
        collectorId: collector.collectorId,
        url: collector.targetUrl,
        timestamp: ts,
        matchRate: 0.85 + Math.random() * 0.15,
        nullRate: Math.random() * 0.05,
        rowCount: Math.floor(20 + Math.random() * 30),
        latencyMs: Math.floor(500 + Math.random() * 2000),
        fieldStats: {},
      });
    }

    // Seed heal events
    const healStatuses: HealEvent['status'][] = ['success', 'success', 'success', 'failed', 'started'];
    for (let i = 0; i < 3; i++) {
      const ts = new Date(now.getTime() - i * 30 * 60000).toISOString();
      const status = healStatuses[i % healStatuses.length];
      saveHealEvent({
        id: generateId(),
        collectorId: collector.collectorId,
        timestamp: ts,
        trigger: i === 0 ? 'manual' : 'scheduled',
        prompt: 'Fix broken selector for title element after site redesign',
        status,
        diff: status === 'success' ? JSON.stringify({
          addedFields: i === 0 ? ['rank'] : [],
          removedFields: [],
          changedSelectors: [
            {
              field: 'title',
              oldSelector: '.titleline > a',
              newSelector: '.titleline a',
              oldContext: 'Hacker News post title',
              newContext: 'Updated selector after DOM change',
            },
          ],
          summary: 'Selector updated after site layout change',
        }) : undefined,
        oldDomHash: status === 'success' ? 'a1b2c3d4' : undefined,
        newDomHash: status === 'success' ? 'e5f6a7b8' : undefined,
        error: status === 'failed' ? 'Selector validation failed: element not found' : undefined,
        durationMs: Math.floor(2000 + Math.random() * 8000),
      });
    }
  }

  console.log('[Seed] Mock health data seeded for all collectors.');
}

// Build a snapshot + first health check for any collector lacking one
async function primeCollectors(cli: BrightDataCLI): Promise<void> {
  const collectors = listCollectors();
  for (const collector of collectors) {
    await initializeSnapshot(cli, collector);
    // run one baseline health check
    const result = await runHealthCheck(cli, collector);
    console.log(
      `[Prime] ${collector.name}: matchRate=${result.metrics.matchRate.toFixed(2)}, ` +
      `rows=${result.metrics.rowCount}, broken=${result.isBroken}`
    );
  }
}

// ============================================================
// Monitoring Loop
// ============================================================

async function runMonitorCycle(cli: BrightDataCLI): Promise<void> {
  if (cycleRunning) {
    console.log('[Monitor] Previous cycle still running — skipping this tick.');
    return;
  }
  cycleRunning = true;
  try {
    console.log(`\n[${new Date().toISOString()}] Monitor cycle starting...`);
    const collectors = listCollectors();

    for (const collector of collectors) {
      try {
        await monitorAndHeal(cli, collector, {
          trigger: 'scheduled',
        });
      } catch (err) {
        console.error(`[Monitor] Error processing ${collector.name}: ${err}`);
      }
    }
    console.log(`[${new Date().toISOString()}] Monitor cycle complete.\n`);
  } finally {
    cycleRunning = false;
  }
}

let cycleRunning = false;

// ============================================================
// HTTP API + WebSocket Server
// ============================================================

function createServer() {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);

    try {
      // GET /api/collectors
      if (url.pathname === '/api/collectors' && req.method === 'GET') {
        const collectors = listCollectors();
        const result = collectors.map((c) => ({
          ...c,
          latestHealth: getLatestHealth(c.collectorId),
        }));
        return sendJson(res, 200, result);
      }

      // GET /api/collectors/:id/health
      const healthMatch = url.pathname.match(/^\/api\/collectors\/([^/]+)\/health$/);
      if (healthMatch && req.method === 'GET') {
        const collectorId = healthMatch[1];
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return sendJson(res, 200, getHealthHistory(collectorId, limit));
      }

      // GET /api/heal-events
      if (url.pathname === '/api/heal-events' && req.method === 'GET') {
        const collectorId = url.searchParams.get('collectorId') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return sendJson(res, 200, getHealEvents(collectorId, limit));
      }

      // POST /api/trigger/:collectorId — manual monitor+heal for demo
      const triggerMatch = url.pathname.match(/^\/api\/trigger\/([^/]+)$/);
      if (triggerMatch && req.method === 'POST') {
        const cli = createBrightDataCLI();
        const collector = getCollector(decodeURIComponent(triggerMatch[1]));
        if (!collector) return sendJson(res, 404, { error: 'Collector not found' });
        const simulateBreakage = url.searchParams.get('simulate') === 'true';

        // Run async, respond immediately
        sendJson(res, 202, { message: 'Triggered', collectorId: collector.collectorId });
        monitorAndHeal(cli, collector, { trigger: 'manual', simulateBreakage }).catch((err) =>
          console.error('[API] Manual trigger error:', err)
        );
        return;
      }

      // POST /api/prime — re-run initial snapshots + baseline checks
      if (url.pathname === '/api/prime' && req.method === 'POST') {
        sendJson(res, 202, { message: 'Priming collectors...' });
        const cli = createBrightDataCLI();
        primeCollectors(cli).catch((err) =>
          console.error('[API] Prime error:', err)
        );
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error('[API] Error:', err);
      sendJson(res, 500, { error: String(err) });
    }
  });

  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    console.log('[WS] Client connected');
    socket.emit('connected', { message: 'Scrape-Verse orchestrator connected' });
    socket.on('disconnect', () => console.log('[WS] Client disconnected'));
  });

  // Bridge eventBus → WebSocket
  eventBus.on('event', (event) => {
    io.emit('event', event);
  });

  return { server, io };
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🕸️  Scrape-Verse Orchestrator starting...');

  // Initialize the database before any synchronous store access
  await initializeDb();

  if (MOCK_MODE) {
    // Simulated end-to-end demo: c_mock_* collectors exercise the full
    // breakage → heal lifecycle locally (no Bright Data billing required)
    console.log('[Init] MOCK MODE — registering simulated demo collectors');
    seedMockData();
  } else {
    // First, ensure all 5 collectors are registered with pipeline types
    await ensureCollectorsInitialized();
  }

  // Then seed mock health data for any collector missing it
  const allCollectors = listCollectors();
  console.log(`[Main] Found ${allCollectors.length} collectors after init`);
  allCollectors.forEach(c => console.log(`[Main]   ${c.name}: ${c.collectorId}`));

  const needsHealthSeed = allCollectors.some(c => getLatestHealth(c.collectorId) === null);
  console.log(`[Main] needsHealthSeed: ${needsHealthSeed}`);
  console.log(`[Main] Calling seedMockHealthData...`);
  seedMockHealthData(allCollectors);

  // Verify seed worked
  const verifyCollectors = listCollectors();
  verifyCollectors.forEach(c => {
    const health = getLatestHealth(c.collectorId);
    console.log(`[Verify] ${c.name}: health=${health ? `matchRate=${health.matchRate}` : 'NULL'}`);
  });

  const cli = createBrightDataCLI();

  // Verify CLI works
  try {
    const version = await cli.version();
    console.log(`[Init] Bright Data CLI version: ${version}`);
  } catch (err) {
    console.warn(`[Init] Could not get CLI version (continuing): ${err}`);
  }

  // Start HTTP + WS server IMMEDIATELY so dashboard can connect
  const { server } = createServer();
  server.listen(PORT, () => {
    console.log(`[Server] HTTP + WebSocket listening on http://localhost:${PORT}`);
  });

  // Initialize collectors in background (non-blocking) - DISABLED for demo
  // ensureCollectorsInitialized().then(async () => {
  //   console.log('[Init] Collectors initialized.');
  //
  //   // Prime collectors if needed
  //   const collectors = listCollectors();
  //   const needsPrime = collectors.some(
  //     (c) => getLatestHealth(c.collectorId) === null
  //   );
  //   if (needsPrime) {
  //     console.log('[Init] No health data found — running initial prime...');
  //     await primeCollectors(cli);
  //   } else {
  //     console.log('[Init] Health data exists — skipping prime.');
  //   }
  // }).catch((err) => {
  //   console.error('[Init] Collector initialization error:', err);
  // });
  console.log('[Init] Background initialization disabled for demo');

  // Start the autonomous monitor → diagnose → heal loop
  const schedule = REALTIME_MODE ? '*/30 * * * * *' : CRON_SCHEDULE;
  console.log(
    `[Scheduler] Auto-monitoring on cron: "${schedule}" ` +
    `(realtime=${REALTIME_MODE ? 'every 30s' : 'every cycle'})`
  );
  cron.schedule(schedule, () => {
    runMonitorCycle(cli).catch((err) =>
      console.error('[Scheduler] Cycle error:', err)
    );
  });

  // Kick off one cycle immediately so the dashboard sees live activity
  setTimeout(() => {
    runMonitorCycle(cli).catch((err) =>
      console.error('[Scheduler] Initial cycle error:', err)
    );
  }, 2000);

  console.log('\n✅ Scrape-Verse orchestrator is live.\n');
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
