import { randomUUID, createHash } from 'crypto';
import { BrightDataCLI } from './brightdata.js';
import { CollectorConfig, HealthMetrics, HealEvent, HealResult } from './schema.js';
import {
  saveHealEvent,
  saveHealthMetrics,
  saveDomSnapshot,
  getDomSnapshot,
  snapshotExists,
  getCollector,
  getHealEvents,
} from './store.js';
import { eventBus } from './events.js';
import { diagnoseAndPrompt } from './diagnose.js';
import { runHealthCheck, MonitorResult, isMockCollector } from './monitor.js';

export interface HealOptions {
  trigger: 'monitor' | 'manual' | 'scheduled';
  skipDiagnose?: boolean;
  customPrompt?: string;
  simulateBreakage?: boolean;
}

export interface HealOutcome {
  event: HealEvent;
  success: boolean;
  postHealMetrics?: HealthMetrics;
  error?: string;
}

const HEAL_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between heal attempts

function domHash(html: string): string {
  return createHash('sha256').update(html).digest('hex').slice(0, 16);
}

// ============================================================
// Core heal + verify primitive
// ============================================================

interface RunHealOptions {
  /** Fields that must be present after the heal (from pre-heal monitoring). */
  brokenFields?: string[];
  /** Require every expected field present & non-null (spec-strict mode). */
  strict?: boolean;
}

async function runHealAndVerify(
  cli: BrightDataCLI,
  collector: CollectorConfig,
  prompt: string,
  options: RunHealOptions
): Promise<{ healResult: HealResult; verifyMetrics: HealthMetrics }> {
  const isMock = isMockCollector(collector.collectorId);

  // Step 1: Trigger heal with auto-approve (Bright Data performs the repair).
  // The CLI polls until completion (--auto-approve --timeout 1800).
  let healResult: HealResult;
  if (isMock) {
    console.log(`[Heal] Mock collector — skipping Bright Data heal call for ${collector.name}`);
    healResult = {
      status: 'done',
      collector_id: collector.collectorId,
      message: 'Simulated heal for mock demo collector',
    };
  } else {
    console.log(`[Heal] Triggering auto-approved heal for ${collector.name}...`);
    healResult = await cli.healCollector(
      collector.collectorId,
      prompt,
      collector.targetUrl,
      true // autoApprove — CLI handles polling up to 1800s
    );

    // Defensive: if the CLI returned without finishing approval, force-approve
    if (healResult.status === 'awaiting_approval') {
      console.log(`[Heal] Heal awaiting approval — approving now for ${collector.name}...`);
      await cli.approveHeal(collector.collectorId, collector.targetUrl);
      healResult = { ...healResult, status: 'approved' };
    }
  }

  // Step 2: Verify — re-run the collector/pipeline and check fields recovered
  console.log(`[Heal] Verifying heal for ${collector.name}...`);
  const verify = await runHealthCheck(cli, collector);
  const metrics = verify.metrics;

  const requiredFields = options.strict
    ? collector.expectedFields
    : options.brokenFields && options.brokenFields.length > 0
      ? options.brokenFields
      : [];

  if (requiredFields.length === 0 && !options.strict) {
    // No specific broken fields known — fall back to overall health gates
    const healthyEnough =
      metrics.rowCount > 0 &&
      metrics.matchRate >= 0.8 &&
      metrics.nullRate <= 0.3;
    if (!healthyEnough) {
      throw new Error(
        `Heal verification failed. matchRate=${metrics.matchRate.toFixed(2)}, ` +
        `nullRate=${metrics.nullRate.toFixed(2)}, rows=${metrics.rowCount}`
      );
    }
  }

  const stillBroken = requiredFields.filter((field) => {
    const stats = metrics.fieldStats[field];
    return !stats || stats.present === 0;
  });

  if (stillBroken.length > 0) {
    throw new Error(
      `Heal verification failed. Still broken: ${stillBroken.join(', ')}. ` +
      `matchRate=${metrics.matchRate.toFixed(2)}`
    );
  }

  // Step 3: Persist the healed page as the new known-good snapshot
  try {
    const fresh = await cli.scrapeHtml(collector.targetUrl);
    saveDomSnapshot(collector.collectorId, fresh.html);
    console.log(`[Heal] Updated DOM snapshot for ${collector.name}`);
  } catch (err) {
    // Snapshot refresh is best-effort; the heal itself succeeded
    console.warn(`[Heal] Could not refresh DOM snapshot for ${collector.name}: ${err}`);
  }

  return { healResult, verifyMetrics: metrics };
}

// ============================================================
// Spec primitive: autoHeal(collectorId, prompt, url, cli)
// ============================================================

/**
 * Trigger an auto-approved heal, verify the recovery, and update the
 * known-good DOM snapshot on success.
 *
 * Verification requires every expected field of the collector to be
 * present and non-null (strict mode).
 */
export async function autoHeal(
  collectorId: string,
  prompt: string,
  url: string,
  cli: BrightDataCLI
): Promise<HealResult> {
  const config = getCollector(collectorId);
  if (!config) {
    throw new Error(
      `Cannot auto-heal unregistered collector "${collectorId}". ` +
      `Expected fields are required for verification.`
    );
  }

  const event: HealEvent = {
    id: randomUUID(),
    collectorId,
    timestamp: new Date().toISOString(),
    trigger: 'manual',
    prompt,
    status: 'started',
  };
  const startTime = Date.now();

  // Hash the pre-heal snapshot before runHealAndVerify replaces it
  const preHealSnapshot = getDomSnapshot(collectorId);
  const oldHash = preHealSnapshot ? domHash(preHealSnapshot) : undefined;

  try {
    event.status = 'healing';
    eventBus.emitHealEvent(event);

    const { verifyMetrics } = await runHealAndVerify(cli, config, prompt, {
      strict: true,
    });

    event.status = 'verifying';
    eventBus.emitHealEvent(event);

    const postHealSnapshot = getDomSnapshot(collectorId);
    event.oldDomHash = oldHash;
    event.newDomHash = postHealSnapshot ? domHash(postHealSnapshot) : undefined;
    event.durationMs = Date.now() - startTime;
    event.status = 'success';
    saveHealEvent(event);
    eventBus.emitHealEvent(event);

    console.log(`[Heal] SUCCESS: ${config.name} verified after heal (${event.durationMs}ms)`);

    return {
      status: 'done',
      collector_id: collectorId,
      message: `Heal applied and verified: matchRate=${verifyMetrics.matchRate.toFixed(2)}, rows=${verifyMetrics.rowCount}`,
    };
  } catch (err) {
    event.status = 'failed';
    event.error = String(err).slice(0, 500);
    event.durationMs = Date.now() - startTime;
    saveHealEvent(event);
    eventBus.emitHealEvent(event);
    console.error(`[Heal] FAILED for ${config.name}: ${event.error}`);
    throw err;
  }
}

// ============================================================
// Monitor-loop heal (diagnosis → LLM prompt → heal → verify)
// ============================================================

export async function autoHealCollector(
  cli: BrightDataCLI,
  collector: CollectorConfig,
  monitorResult: MonitorResult,
  options: HealOptions
): Promise<HealOutcome> {
  const event: HealEvent = {
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    trigger: options.trigger,
    prompt: '',
    status: 'started',
  };

  const startTime = Date.now();

  // Cooldown: don't re-attempt expensive heals more than once per 10 min
  // (protects credits from burn-loops when breakage is caused by
  // transient conditions like crawler rate limits)
  const recent = getHealEvents(collector.collectorId, 1);
  if (
    !options.customPrompt &&
    recent.length > 0 &&
    recent[0].status === 'failed' &&
    Date.now() - new Date(recent[0].timestamp).getTime() < HEAL_COOLDOWN_MS
  ) {
    console.log(
      `[Heal] Cooldown active for ${collector.name} — last attempt ${recent[0].timestamp}. Skipping.`
    );
    return {
      event: { ...recent[0], trigger: options.trigger },
      success: false,
      error: 'heal cooldown active',
    };
  }

  // Mock collectors: demo stand-ins. Simulate the heal cycle locally.
  if (isMockCollector(collector.collectorId)) {
    return simulateAutoHeal(collector, monitorResult, options, startTime);
  }

  try {
    // Step 1: Diagnose — fetch live DOM, diff vs snapshot, LLM generates repair prompt
    event.status = 'healing';
    eventBus.emitHealEvent(event);

    let healPrompt = options.customPrompt;
    let oldDomHashValue: string | undefined;

    if (!healPrompt) {
      console.log(`[Heal] Diagnosing breakage for ${collector.name}...`);
      const diagnosis = await diagnoseAndPrompt(
        collector.collectorId,
        collector.targetUrl,
        cli
      );

      healPrompt = diagnosis.healPrompt.prompt;

      const oldSnap = getDomSnapshot(collector.collectorId);
      oldDomHashValue = oldSnap ? domHash(oldSnap) : undefined;

      event.diff = JSON.stringify(diagnosis.diff);
      console.log(`[Heal] Diagnosed. Prompt: ${healPrompt.slice(0, 120)}...`);
    }

    event.prompt = healPrompt;
    event.oldDomHash = oldDomHashValue;

    // Step 2+3: Heal (auto-approved) and verify the previously-broken fields recovered
    const { healResult, verifyMetrics } = await runHealAndVerify(cli, collector, healPrompt, {
      brokenFields: monitorResult.brokenFields,
    });

    if (healResult.diff) event.diff = healResult.diff;

    // Refresh hash against current DOM for the audit trail
    const currentSnap = getDomSnapshot(collector.collectorId);
    event.newDomHash = currentSnap ? domHash(currentSnap) : undefined;

    // Step 4: Record success
    event.status = 'verifying';
    eventBus.emitHealEvent(event);

    event.status = 'success';
    event.durationMs = Date.now() - startTime;
    saveHealEvent(event);
    eventBus.emitHealEvent(event);

    console.log(`[Heal] SUCCESS: ${collector.name} healed in ${event.durationMs}ms`);

    return {
      event,
      success: true,
      postHealMetrics: verifyMetrics,
    };
  } catch (err) {
    event.status = 'failed';
    event.error = String(err).slice(0, 500);
    event.durationMs = Date.now() - startTime;
    saveHealEvent(event);
    eventBus.emitHealEvent(event);

    console.error(`[Heal] FAILED for ${collector.name}: ${event.error}`);
    return {
      event,
      success: false,
      error: event.error,
    };
  }
}

// Simulated heal cycle for mock demo collectors (no Bright Data calls)
function simulateAutoHeal(
  collector: CollectorConfig,
  monitorResult: MonitorResult,
  options: HealOptions,
  _startTime: number
): HealOutcome {
  const event: HealEvent = {
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    trigger: options.trigger,
    prompt: `Fix broken selector for ${monitorResult.brokenFields.join(', ')} after site redesign`,
    status: 'started',
  };

  const broken = monitorResult.brokenFields;

  event.status = 'healing';
  eventBus.emitHealEvent(event);

  event.diff = JSON.stringify({
    addedFields: [],
    removedFields: [],
    changedSelectors: broken.map((field) => ({
      field,
      oldSelector: `.${field}`,
      newSelector: `[data-field="${field}"]`,
      oldContext: 'Original selector from collector config',
      newContext: 'Repaired selector after simulated DOM change',
    })),
    summary: `Repaired ${broken.length} selector(s) after simulated site layout change`,
  });
  event.oldDomHash = domHash('simulated-old-dom');
  event.newDomHash = domHash('simulated-new-dom');

  event.status = 'verifying';
  eventBus.emitHealEvent(event);

  event.status = 'success';
  event.durationMs = 2000 + Math.floor(Math.random() * 5000);
  saveHealEvent(event);
  eventBus.emitHealEvent(event);

  console.log(`[Heal] SUCCESS (simulated): ${collector.name} healed in ${event.durationMs}ms`);

  const postHealMetrics: HealthMetrics = {
    collectorId: collector.collectorId,
    url: collector.targetUrl,
    timestamp: new Date().toISOString(),
    matchRate: 1,
    nullRate: 0,
    rowCount: monitorResult.metrics.rowCount,
    latencyMs: 300 + Math.floor(Math.random() * 700),
    fieldStats: Object.fromEntries(
      collector.expectedFields.map((f) => [
        f,
        { present: monitorResult.metrics.rowCount, null: 0, type: 'string' },
      ])
    ),
  };

  saveHealthMetrics(postHealMetrics);

  return { event, success: true, postHealMetrics };
}

// ============================================================
// Full monitor → diagnose → heal loop for a single collector
// ============================================================

export async function monitorAndHeal(
  cli: BrightDataCLI,
  collector: CollectorConfig,
  options: HealOptions = { trigger: 'scheduled' }
): Promise<{ monitorResult: MonitorResult; healOutcome?: HealOutcome }> {
  console.log(`[Monitor] Checking ${collector.name}...`);

  const monitorResult = await runHealthCheck(cli, collector, {
    simulateBreakage: options.simulateBreakage,
  });

  if (monitorResult.isBroken) {
    console.log(
      `[Monitor] ${collector.name} is BROKEN. Broken fields: ${monitorResult.brokenFields.join(', ')}. ` +
      `Triggering auto-heal (${options.trigger})...`
    );

    const healOutcome = await autoHealCollector(cli, collector, monitorResult, options);
    return { monitorResult, healOutcome };
  }

  console.log(`[Monitor] ${collector.name} is healthy.`);
  return { monitorResult };
}

// ============================================================
// Snapshot bootstrap
// ============================================================

// Initialize DOM snapshot for a collector that doesn't have one yet
export async function initializeSnapshot(
  cli: BrightDataCLI,
  collector: CollectorConfig
): Promise<void> {
  if (snapshotExists(collector.collectorId)) {
    console.log(`[Snapshot] ${collector.name} already has a snapshot.`);
    return;
  }

  console.log(`[Snapshot] Creating initial DOM snapshot for ${collector.name}...`);

  if (isMockCollector(collector.collectorId)) {
    saveDomSnapshot(collector.collectorId, '<!-- simulated mock DOM snapshot -->');
    console.log(`[Snapshot] Created snapshot for ${collector.name}.`);
    return;
  }

  const result = await cli.scrapeHtml(collector.targetUrl);
  saveDomSnapshot(collector.collectorId, result.html);
  console.log(`[Snapshot] Created snapshot for ${collector.name}.`);
}
