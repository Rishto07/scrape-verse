import { describe, it, expect } from 'vitest';
import { computeDomDiff, parsePageOutline } from './diagnose.js';
import { DomDiffSchema, HealPromptSchema, CollectorConfigSchema } from './schema.js';

const OLD_HTML = `
<html><body>
  <main class="repo">
    <h1 class="repo-title"><a href="/microsoft/vscode">VS Code</a></h1>
    <p class="repo-desc">Editor</p>
    <span class="stars-count">87,431 stars</span>
    <span class="forks-count">12,102 forks</span>
  </main>
</body></html>`;

const NEW_HTML = `
<html><body>
  <main data-testid="layout">
    <h2 data-testid="repo-name"><a href="/microsoft/vscode">vscode</a></h2>
    <p data-testid="repo-desc">Editor</p>
    <span id="repo-stars-counter-star">87.4k</span>
    <span id="repo-network-counter">12.1k</span>
  </main>
</body></html>`;

describe('parsePageOutline', () => {
  it('extracts elements with selectors, classes and ids', () => {
    const outline = parsePageOutline(OLD_HTML);
    expect(outline.elements.length).toBeGreaterThan(3);

    const title = outline.elements.find((e) => e.classes.includes('repo-title'));
    expect(title).toBeDefined();
    expect(title!.tag).toBe('h1');
    expect(title!.selector).toBe('h1.repo-title');
    // Immediate text attaches to the innermost open element (the <a>)
    const link = outline.elements.find((e) => e.tag === 'a' && e.text.includes('VS Code'));
    expect(link).toBeDefined();
  });

  it('strips script and style content', () => {
    const outline = parsePageOutline('<div><script>var x=1;</script><b class="k">ok</b></div>');
    expect(outline.elements.some((e) => e.classes.includes('k'))).toBe(true);
  });
});

describe('computeDomDiff', () => {
  it('detects selector moves between old and new DOM', () => {
    const diff = computeDomDiff(OLD_HTML, NEW_HTML, ['stars']);
    const changed = diff.changedSelectors.find((c) => c.field === 'stars');
    expect(changed).toBeDefined();
    expect(changed!.oldSelector).toBe('span.stars-count');
    expect(changed!.newSelector).toContain('repo-stars-counter-star');
  });

  it('flags expected fields that vanished as removed', () => {
    const diff = computeDomDiff(OLD_HTML, '<html><body><p>nothing here</p></body></html>', ['stars', 'forks']);
    expect(diff.removedFields).toEqual(expect.arrayContaining(['stars', 'forks']));
  });

  it('reports no structural change when layouts match', () => {
    const diff = computeDomDiff(OLD_HTML, OLD_HTML, ['stars', 'forks']);
    expect(diff.changedSelectors.length).toBe(0);
    expect(diff.removedFields.length).toBe(0);
    expect(diff.addedFields.length).toBe(0);
  });

  it('handles a missing baseline snapshot gracefully', () => {
    const diff = computeDomDiff(null, NEW_HTML, ['stars']);
    expect(diff.summary).toMatch(/baseline/i);
  });

  it('always returns a schema-valid DomDiff', () => {
    const diff = computeDomDiff(OLD_HTML, NEW_HTML, ['name', 'description', 'stars', 'forks']);
    expect(() => DomDiffSchema.parse(diff)).not.toThrow();
  });
});

describe('schema contracts', () => {
  it('HealPrompt accepts a prompt + optional targetField', () => {
    expect(() => HealPromptSchema.parse({ prompt: 'fix .title' })).not.toThrow();
    expect(() => HealPromptSchema.parse({ prompt: 'fix', targetField: 'title' })).not.toThrow();
  });

  it('CollectorConfig enforces url + expected fields', () => {
    expect(CollectorConfigSchema.safeParse({
      id: 'i', collectorId: 'c_x', name: 'n',
      targetUrl: 'https://example.com', description: 'd',
      expectedFields: ['a'], createdAt: 'now', updatedAt: 'now',
    }).success).toBe(true);
    expect(CollectorConfigSchema.safeParse({
      id: 'i', collectorId: 'c_x', name: 'n',
      targetUrl: 'not-a-url', description: 'd',
      expectedFields: [], createdAt: 'now', updatedAt: 'now',
    }).success).toBe(false);
  });
});
