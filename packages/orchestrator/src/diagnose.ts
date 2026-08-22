import { BrightDataCLI } from './brightdata.js';
import { DomDiff, DomDiffSchema, HealPrompt } from './schema.js';
import { getCollector, getDomSnapshot } from './store.js';
import { createLLMClient } from './llm.js';

// ============================================================
// Lightweight HTML parsing (no external DOM dependency)
// ============================================================

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

interface ParsedElement {
  tag: string;
  id: string | null;
  classes: string[];
  attrNames: string[];
  attrBlob: string;
  text: string;
  selector: string;
  path: string;
  context: string;
}

interface PageOutline {
  elements: ParsedElement[];
  size: number;
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseAttributes(blob: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:@][a-zA-Z0-9_.:@-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function buildSelector(tag: string, id: string | null, classes: string[]): string {
  let sel = tag;
  if (id) return `${tag}#${id}`;
  if (classes.length > 0) sel += '.' + classes.slice(0, 3).join('.');
  return sel;
}

// Parse HTML into a flat, ordered list of interesting elements with
// approximate hierarchy paths. Tolerant of malformed markup by design.
export function parsePageOutline(html: string): PageOutline {
  const clean = stripNoise(html);
  const elements: ParsedElement[] = [];
  const stack: string[] = [];

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;

  while ((match = tagRe.exec(clean)) !== null) {
    // Text between previous tag and this one belongs to the current open element
    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrBlob = match[3] || '';

    // Attach preceding text to the innermost open element
    const between = clean.slice(lastEnd, match.index);
    const text = decodeEntities(between.replace(/\s+/g, ' ').trim());
    if (text && stack.length > 0 && elements.length > 0) {
      const top = elements[elements.length - 1];
      if (!top.text) top.text = text.slice(0, 160);
    }
    lastEnd = tagRe.lastIndex;

    if (isClosing) {
      // Pop back to the matching opener (tolerate mismatches)
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.length = idx;
      continue;
    }

    const selfClosing = attrBlob.trimEnd().endsWith('/') || VOID_ELEMENTS.has(tag);
    const attrs = parseAttributes(attrBlob);
    const id = attrs.id || null;
    const classes = (attrs.class || '').split(/\s+/).filter(Boolean);
    const attrNames = Object.keys(attrs);
    const selector = buildSelector(tag, id, classes);

    const contextStart = Math.max(0, match.index - 40);
    elements.push({
      tag,
      id,
      classes,
      attrNames,
      attrBlob,
      text,
      selector,
      path: [...stack, tag].join(' > '),
      context: clean.slice(contextStart, match.index + Math.min(attrBlob.length + 300, 600)).trim(),
    });

    if (!selfClosing) stack.push(tag);
    if (stack.length > 64) stack.shift(); // safety against pathological nesting
  }

  return { elements, size: clean.length };
}

// ============================================================
// Field ↔ element matching heuristics
// ============================================================

function fieldVariants(field: string): string[] {
  const lower = field.toLowerCase();
  const variants = new Set<string>([
    lower,
    lower.replace(/[_-]/g, ''),
    lower.replace(/_/g, '-'),
    lower.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), // camelCase
  ]);
  return [...variants];
}

function scoreElement(el: ParsedElement, variants: string[], field: string): number {
  let score = 0;
  const haystacks: Array<[string, number]> = [
    [el.id ?? '', 6],
    [el.classes.join(' '), 4],
    [el.attrNames.join(' '), 4],
    [el.tag, 2],
  ];

  for (const [hay, weight] of haystacks) {
    const hayLower = hay.toLowerCase().replace(/[_-]/g, '');
    if (!hayLower) continue;
    for (const v of variants) {
      if (hayLower.includes(v)) {
        score += weight;
        break;
      }
    }
  }

  // Semantic bonuses for common field types based on visible text
  const semanticFields: Record<string, RegExp[]> = {
    title: [/^h[1-6]$/],
    name: [/^h[1-6]$/],
    description: [/^p$/, /^meta$/],
    author: [/^a$/, /^span$/],
    published_at: [/^time$/, /^span$/, /^p$/],
  };
  const semantic = semanticFields[field];
  if (semantic && el.text && el.text.length < 200 && semantic.some((re) => re.test(el.tag))) {
    score += 2;
  }

  // Penalize huge containers — data lives in leaves, not wrappers
  if (['html', 'body', 'div', 'main', 'section'].includes(el.tag) && !el.id && el.classes.length === 0) {
    score -= 2;
  }

  return score;
}

function bestMatch(outline: PageOutline, field: string): ParsedElement | null {
  const variants = fieldVariants(field);
  let best: ParsedElement | null = null;
  let bestScore = 0;
  for (const el of outline.elements) {
    const score = scoreElement(el, variants, field);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore >= 3 ? best : null; // require a confident-enough signal
}

function truncateContext(s: string, max = 420): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

// ============================================================
// DOM diffing
// ============================================================

export function computeDomDiff(
  oldHtml: string | null,
  newHtml: string,
  expectedFields: string[]
): DomDiff {
  const oldOutline = oldHtml ? parsePageOutline(oldHtml) : { elements: [], size: 0 };
  const newOutline = parsePageOutline(newHtml);

  const changedSelectors: DomDiff['changedSelectors'] = [];
  const addedFields: string[] = [];
  const removedFields: string[] = [];

  for (const field of expectedFields) {
    const oldEl = bestMatch(oldOutline, field);
    const newEl = bestMatch(newOutline, field);

    if (oldEl && newEl) {
      const structuralSignature = (el: ParsedElement) =>
        `${el.path}|${el.selector}|${el.attrNames.slice().sort().join(',')}`;
      if (structuralSignature(oldEl) !== structuralSignature(newEl)) {
        changedSelectors.push({
          field,
          oldSelector: oldEl.selector,
          newSelector: newEl.selector,
          oldContext: truncateContext(oldEl.context),
          newContext: truncateContext(newEl.context),
        });
      }
    } else if (oldEl && !newEl) {
      removedFields.push(field);
      changedSelectors.push({
        field,
        oldSelector: oldEl.selector,
        newSelector: undefined,
        oldContext: truncateContext(oldEl.context),
        newContext: '(field no longer locatable in the new DOM)',
      });
    } else if (!oldEl && newEl) {
      addedFields.push(field);
      if (oldHtml) {
        changedSelectors.push({
          field,
          oldSelector: undefined,
          newSelector: newEl.selector,
          oldContext: '(field was not locatable in the old DOM)',
          newContext: truncateContext(newEl.context),
        });
      } else {
        // First snapshot: record where fields currently live so future diffs have a baseline reference
        changedSelectors.push({
          field,
          oldSelector: undefined,
          newSelector: newEl.selector,
          oldContext: '(no baseline snapshot)',
          newContext: truncateContext(newEl.context),
        });
      }
    }
    // Both missing: nothing to report for this field
  }

  const parts: string[] = [];
  if (!oldHtml) parts.push('No known-good snapshot existed; built first structural baseline.');
  if (changedSelectors.length > 0) {
    parts.push(`${changedSelectors.length} field location(s) changed.`);
  }
  if (removedFields.length > 0) {
    parts.push(`Expected fields no longer findable: ${removedFields.join(', ')}.`);
  }
  if (addedFields.length > 0) {
    parts.push(`Newly locatable fields: ${addedFields.join(', ')}.`);
  }
  if (parts.length === 0) {
    parts.push('No structural changes detected for the expected fields.');
  }

  return DomDiffSchema.parse({
    changedSelectors,
    addedFields,
    removedFields,
    summary: parts.join(' '),
  });
}

// ============================================================
// Diagnosis pipeline (diff + LLM heal prompt)
// ============================================================

export interface Diagnosis {
  collectorId: string;
  url: string;
  diff: DomDiff;
  healPrompt: HealPrompt;
}

async function diagnose(
  cli: BrightDataCLI,
  collectorId: string,
  url: string
): Promise<Diagnosis> {
  const config = getCollector(collectorId);
  if (!config) {
    throw new Error(`Cannot diagnose unknown collector: ${collectorId}`);
  }

  console.log(`[Diagnose] ${config.name}: fetching current DOM for ${url}...`);
  const current = await cli.scrapeHtml(url);
  const oldDom = getDomSnapshot(collectorId);

  console.log(
    `[Diagnose] ${config.name}: diffing against ${oldDom ? 'known-good snapshot' : '(no snapshot — first run)'}`
  );
  const diff = computeDomDiff(oldDom, current.html, config.expectedFields);
  console.log(`[Diagnose] ${config.name}: ${diff.summary}`);

  const llm = createLLMClient();
  const healPrompt = await llm.generateHealPrompt(diff, config.expectedFields);
  console.log(
    `[Diagnose] ${config.name}: heal prompt generated (${healPrompt.prompt.length} chars)`
  );

  return { collectorId, url, diff, healPrompt };
}

/**
 * Required export: compute the DomDiff for a possibly-broken collector.
 * Fetches the live DOM, diffs it against the stored known-good snapshot,
 * and analyzes which expected fields moved/vanished/appeared.
 */
export async function diagnoseBreakage(
  collectorId: string,
  url: string,
  cli: BrightDataCLI
): Promise<DomDiff> {
  const diagnosis = await diagnose(cli, collectorId, url);
  return diagnosis.diff;
}

/**
 * Full diagnosis including the LLM-generated heal prompt.
 */
export async function diagnoseAndPrompt(
  collectorId: string,
  url: string,
  cli: BrightDataCLI
): Promise<Diagnosis> {
  return diagnose(cli, collectorId, url);
}
