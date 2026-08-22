import Groq from 'groq-sdk';
import { DomDiff, HealPrompt } from './schema.js';

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Lazy singleton so a missing API key doesn't crash startup
let client: Groq | null = null;

function getClient(): Groq {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not set. LLM-based heal-prompt generation unavailable.');
  }
  client = new Groq({ apiKey });
  return client;
}

export interface LLMClient {
  generateHealPrompt(domDiff: DomDiff, expectedFields: string[]): Promise<HealPrompt>;
}

export function createLLMClient(): LLMClient {
  return {
    async generateHealPrompt(domDiff, expectedFields): Promise<HealPrompt> {
      const groq = getClient();

      const system = `You are a web-scraping repair specialist. Given a DOM diff between the last known-good page and the current broken page, you produce ONE precise repair instruction for Bright Data's self-healing scraper tool. You never write code — only plain-language instructions referencing exact tags, classes, IDs, attributes and hierarchy of the NEW DOM.`;

      const user = `A scraper extracts these fields from a page:
${expectedFields.map((f) => `- ${f}`).join('\n')}

The page's DOM changed and some fields now return null. Here is the computed diff:

## CHANGED SELECTORS
${
  domDiff.changedSelectors.length > 0
    ? domDiff.changedSelectors
        .map(
          (c) => `### field: ${c.field}
- old selector: ${c.oldSelector ?? '(none found in old DOM)'}
- new selector: ${c.newSelector ?? '(NOT FOUND in new DOM)'}
- old context:\n\`\`\`html\n${c.oldContext}\n\`\`\`
- new context:\n\`\`\`html\n${c.newContext}\n\`\`\``
        )
        .join('\n\n')
    : '(no per-field selector matches could be computed)'
}

## ADDED FIELDS (newly present on page)
${domDiff.addedFields.length ? domDiff.addedFields.join(', ') : '(none)'}

## REMOVED FIELDS (expected but no longer locatable)
${domDiff.removedFields.length ? domDiff.removedFields.join(', ') : '(none)'}

## SUMMARY OF CHANGE
${domDiff.summary}

Write a single concise heal instruction telling Bright Data exactly how to re-capture each affected field from the NEW DOM: name the target field(s), then describe precisely where the data now lives (tag names, class names, ids, data-* attributes, nesting). If a field is gone entirely, say so explicitly so the heal can remove or remap it.

Respond with ONLY the instruction paragraph. No preamble, no markdown headers, no code fences.`;

      const response = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      });

      const text = response.choices[0]?.message?.content?.trim() || '';
      if (!text) {
        throw new Error(`Groq (${GROQ_MODEL}) returned an empty heal prompt.`);
      }

      // Single-broken-field heals get a targeted prompt for Bright Data to act on
      const removedOrChanged = [...domDiff.changedSelectors.map((c) => c.field), ...domDiff.removedFields];
      const targetField = removedOrChanged.length === 1 ? removedOrChanged[0] : undefined;

      return { prompt: text, targetField };
    },
  };
}
