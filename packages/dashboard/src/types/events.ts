// Shared event types — must mirror orchestrator's schema.ts

export interface HealthMetrics {
  collectorId: string;
  url: string;
  timestamp: string;
  matchRate: number;
  nullRate: number;
  fieldStats: Record<string, {
    present: number;
    null: number;
    type: string;
  }>;
  rowCount: number;
  latencyMs: number;
}

export interface MonitorEvent {
  id: string;
  collectorId: string;
  timestamp: string;
  type: 'run_started' | 'run_completed' | 'breakage_detected' | 'health_check';
  health?: HealthMetrics;
  message?: string;
}

export interface HealEvent {
  id: string;
  collectorId: string;
  timestamp: string;
  trigger: 'monitor' | 'manual' | 'scheduled';
  prompt: string;
  status: 'started' | 'healing' | 'verifying' | 'success' | 'failed';
  diff?: string;
  oldDomHash?: string;
  newDomHash?: string;
  error?: string;
  durationMs?: number;
}

export type AppEvent = MonitorEvent | HealEvent;

export function isHealEvent(e: AppEvent): e is HealEvent {
  return 'trigger' in e;
}

export function isMonitorEvent(e: AppEvent): e is MonitorEvent {
  return !('trigger' in e);
}

export interface CollectorConfig {
  id: string;
  collectorId: string;
  name: string;
  targetUrl: string;
  description: string;
  expectedFields: string[];
  thresholds?: {
    matchRate: number;
    nullRate: number;
    minRowCount: number;
  };
  createdAt: string;
  updatedAt: string;
  latestHealth?: HealthMetrics;
}

export type HealEventRecord = HealEvent;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
