import { BrightDataCLI } from './brightdata.js';
import { CollectorConfig, HealthMetrics, PIPELINE_TYPES } from './schema.js';
import { saveHealthMetrics } from './store.js';
import { eventBus } from './events.js';
import { randomUUID } from 'crypto';

export interface MonitorResult {
  metrics: HealthMetrics;
  isBroken: boolean;
  brokenFields: string[];
  warnings: string[];
}

export interface HealthCheckOptions {
  simulateBreakage?: boolean;
}

export function isMockCollector(collectorId: string): boolean {
  return collectorId.startsWith('c_mock_');
}

export function isPipelineCollector(collectorId: string): boolean {
  return Object.values(PIPELINE_TYPES).includes(collectorId as any);
}

interface DefaultThresholds {
  matchRate: number;
  nullRate: number;
  minRowCount: number;
}

const DEFAULT_THRESHOLDS: DefaultThresholds = {
  matchRate: 0.8,
  nullRate: 0.3,
  minRowCount: 1,
};

// Run a collector and compute health metrics
export async function runHealthCheck(
  cli: BrightDataCLI,
  collector: CollectorConfig,
  options: HealthCheckOptions = {}
): Promise<MonitorResult> {
  const startTime = Date.now();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...collector.thresholds };

  eventBus.emitMonitorEvent({
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    type: 'run_started',
    message: `Running ${collector.name} on ${collector.targetUrl}`,
  });

  // Mock collectors: demo stand-ins. Simulate locally instead of hitting Bright Data.
  if (isMockCollector(collector.collectorId)) {
    return simulateHealthCheck(collector, thresholds, options.simulateBreakage);
  }

  // Pipeline collectors: use pre-built Bright Data pipelines
  if (isPipelineCollector(collector.collectorId)) {
    return runPipelineHealthCheck(cli, collector, thresholds, startTime);
  }

  let result;
  try {
    result = await cli.runCollector(collector.collectorId, collector.targetUrl);
  } catch (err) {
    const metrics: HealthMetrics = {
      collectorId: collector.collectorId,
      url: collector.targetUrl,
      timestamp: new Date().toISOString(),
      matchRate: 0,
      nullRate: 1,
      fieldStats: {},
      rowCount: 0,
      latencyMs: Date.now() - startTime,
    };
    saveHealthMetrics(metrics);

    eventBus.emitMonitorEvent({
      id: randomUUID(),
      collectorId: collector.collectorId,
      timestamp: new Date().toISOString(),
      type: 'breakage_detected',
      health: metrics,
      message: `Run failed: ${String(err).slice(0, 200)}`,
    });

    return {
      metrics,
      isBroken: true,
      brokenFields: collector.expectedFields,
      warnings: [`Collector run failed: ${String(err).slice(0, 200)}`],
    };
  }

  const latencyMs = Date.now() - startTime;
  const items = result.items || [];

  // Compute health metrics across the rows
  const metrics = computeHealthMetrics(
    collector,
    items,
    result,
    latencyMs
  );

  saveHealthMetrics(metrics);

  const brokenFields = identifyBrokenFields(collector, items);
  const warnings: string[] = [];

  if (metrics.matchRate < thresholds.matchRate) {
    warnings.push(`Match rate ${metrics.matchRate.toFixed(2)} below threshold ${thresholds.matchRate}`);
  }
  if (metrics.nullRate > thresholds.nullRate) {
    warnings.push(`Null rate ${metrics.nullRate.toFixed(2)} above threshold ${thresholds.nullRate}`);
  }
  if (metrics.rowCount < thresholds.minRowCount) {
    warnings.push(`Row count ${metrics.rowCount} below minimum ${thresholds.minRowCount}`);
  }

  if (brokenFields.length > 0) {
    warnings.push(`Required fields missing from every row: ${brokenFields.join(', ')}`);
  }
  const isBroken = warnings.length > 0;

  eventBus.emitMonitorEvent({
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    type: isBroken ? 'breakage_detected' : 'run_completed',
    health: metrics,
    message: isBroken
      ? `Breakage detected: ${warnings.join('; ')}`
      : `Healthy: matchRate=${metrics.matchRate.toFixed(2)}, rows=${metrics.rowCount}`,
  });

  return {
    metrics,
    isBroken,
    brokenFields,
    warnings,
  };
}

// Local simulation for mock demo collectors (no Bright Data calls)
function simulateHealthCheck(
  collector: CollectorConfig,
  thresholds: DefaultThresholds,
  forceBroken = false
): MonitorResult {
  const latencyMs = 400 + Math.floor(Math.random() * 1200);

  // ~25% of runs show a breakage so the auto-heal path stays visible in the demo
  const broken = forceBroken || Math.random() < 0.25;
  const rowCount = 18 + Math.floor(Math.random() * 22);
  const fields = collector.expectedFields;
  const brokenField = fields.length > 0 ? fields[Math.floor(Math.random() * fields.length)] : null;

  const fieldStats: Record<string, { present: number; null: number; type: string }> = {};
  const brokenFields: string[] = [];

  for (const field of fields) {
    if (broken && field === brokenField) {
      fieldStats[field] = { present: 0, null: rowCount, type: 'unknown' };
      brokenFields.push(field);
    } else {
      fieldStats[field] = { present: rowCount, null: 0, type: 'string' };
    }
  }

  const nullCount = broken ? rowCount : 0;
  const totalExpected = fields.length * rowCount;
  const metrics: HealthMetrics = {
    collectorId: collector.collectorId,
    url: collector.targetUrl,
    timestamp: new Date().toISOString(),
    matchRate: totalExpected > 0 ? (totalExpected - nullCount) / totalExpected : 0,
    nullRate: totalExpected > 0 ? nullCount / totalExpected : 1,
    rowCount,
    latencyMs,
    fieldStats,
  };

  saveHealthMetrics(metrics);

  const warnings: string[] = [];
  if (broken) warnings.push(`Simulated breakage: ${brokenFields.join(', ')} missing in ${rowCount} rows`);
  if (metrics.matchRate < thresholds.matchRate) warnings.push(`Match rate below threshold ${thresholds.matchRate}`);
  if (metrics.nullRate > thresholds.nullRate) warnings.push(`Null rate above threshold ${thresholds.nullRate}`);

  eventBus.emitMonitorEvent({
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    type: broken ? 'breakage_detected' : 'run_completed',
    health: metrics,
    message: broken
      ? `Breakage detected: ${brokenFields.join(', ')} missing in ${rowCount} rows`
      : `Healthy: matchRate=${metrics.matchRate.toFixed(2)}, rows=${rowCount}`,
  });

  return {
    metrics,
    isBroken: broken,
    brokenFields,
    warnings,
  };
}

function computeHealthMetrics(
  collector: CollectorConfig,
  items: Record<string, unknown>[],
  result: { status?: string; error?: string },
  latencyMs: number
): HealthMetrics {
  const expectedFields = collector.expectedFields;
  const totalRows = items.length || 0;

  // If no rows returned, everything is broken
  if (totalRows === 0) {
    return {
      collectorId: collector.collectorId,
      url: collector.targetUrl,
      timestamp: new Date().toISOString(),
      matchRate: 0,
      nullRate: 1,
      fieldStats: {},
      rowCount: 0,
      latencyMs,
    };
  }

  // Compute per-field statistics across all rows
  const fieldStats: Record<string, { present: number; null: number; type: string }> = {};
  let totalPresent = 0;
  let totalNull = 0;

  for (const field of expectedFields) {
    let present = 0;
    let nullCount = 0;
    let sampleType = 'unknown';

    for (const item of items) {
      const value = item[field];
      if (value === undefined || value === null || value === '') {
        nullCount++;
        totalNull++;
      } else {
        present++;
        totalPresent++;
        sampleType = typeof value;
      }
    }

    fieldStats[field] = {
      present,
      null: nullCount,
      type: sampleType,
    };
  }

  const totalExpectedFieldInstances = expectedFields.length * totalRows;
  const matchRate = totalExpectedFieldInstances > 0
    ? totalPresent / totalExpectedFieldInstances
    : 0;
  const nullRate = totalExpectedFieldInstances > 0
    ? totalNull / totalExpectedFieldInstances
    : 1;

  return {
    collectorId: collector.collectorId,
    url: collector.targetUrl,
    timestamp: new Date().toISOString(),
    matchRate,
    nullRate,
    fieldStats,
    rowCount: totalRows,
    latencyMs,
  };
}

// Identify which specific fields are broken (all null across rows)
function identifyBrokenFields(
  collector: CollectorConfig,
  items: Record<string, unknown>[]
): string[] {
  if (items.length === 0) return collector.expectedFields;

  const broken: string[] = [];
  for (const field of collector.expectedFields) {
    const allNull = items.every(
      (item) => item[field] === undefined || item[field] === null || item[field] === ''
    );
    if (allNull) broken.push(field);
  }
  return broken;
}

// Pipeline collectors: use pre-built Bright Data pipelines
async function runPipelineHealthCheck(
  cli: BrightDataCLI,
  collector: CollectorConfig,
  thresholds: DefaultThresholds,
  startTime: number
): Promise<MonitorResult> {
  const pipelineType = collector.collectorId;
  let result;
  try {
    result = await cli.runPipeline(pipelineType, collector.targetUrl);
  } catch (err) {
    const metrics: HealthMetrics = {
      collectorId: collector.collectorId,
      url: collector.targetUrl,
      timestamp: new Date().toISOString(),
      matchRate: 0,
      nullRate: 1,
      fieldStats: {},
      rowCount: 0,
      latencyMs: Date.now() - startTime,
    };
    saveHealthMetrics(metrics);

    eventBus.emitMonitorEvent({
      id: randomUUID(),
      collectorId: collector.collectorId,
      timestamp: new Date().toISOString(),
      type: 'breakage_detected',
      health: metrics,
      message: `Pipeline run failed: ${String(err).slice(0, 200)}`,
    });

    return {
      metrics,
      isBroken: true,
      brokenFields: collector.expectedFields,
      warnings: [`Pipeline run failed: ${String(err).slice(0, 200)}`],
    };
  }

  const latencyMs = Date.now() - startTime;
  const items = result.items || [];

  // Compute health metrics across the rows
  const metrics = computeHealthMetrics(collector, items, result, latencyMs);
  saveHealthMetrics(metrics);

  const brokenFields = identifyBrokenFields(collector, items);
  const isBroken =
    metrics.matchRate < thresholds.matchRate ||
    metrics.nullRate > thresholds.nullRate ||
    metrics.rowCount < thresholds.minRowCount;

  const warnings: string[] = [];
  if (metrics.matchRate < thresholds.matchRate) {
    warnings.push(`Match rate ${(metrics.matchRate * 100).toFixed(0)}% below threshold ${(thresholds.matchRate * 100).toFixed(0)}%`);
  }
  if (metrics.nullRate > thresholds.nullRate) {
    warnings.push(`Null rate ${(metrics.nullRate * 100).toFixed(0)}% above threshold ${(thresholds.nullRate * 100).toFixed(0)}%`);
  }
  if (metrics.rowCount < thresholds.minRowCount) {
    warnings.push(`Row count ${metrics.rowCount} below minimum ${thresholds.minRowCount}`);
  }

  eventBus.emitMonitorEvent({
    id: randomUUID(),
    collectorId: collector.collectorId,
    timestamp: new Date().toISOString(),
    type: isBroken ? 'breakage_detected' : 'run_completed',
    health: metrics,
    message: isBroken
      ? `Breakage detected: ${warnings.join('; ')}`
      : `Healthy: matchRate=${metrics.matchRate.toFixed(2)}, rows=${metrics.rowCount}`,
  });

  return {
    metrics,
    isBroken,
    brokenFields,
    warnings,
  };
}
