import { useEffect, useState } from 'react';
import { CollectorConfig, AppEvent, isHealEvent, HealthMetrics } from '../types/events';
import { Activity, AlertTriangle, CheckCircle, Loader2, RefreshCw, Clock } from 'lucide-react';
import { HealthSparkline } from './HealthSparkline';

const API_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';

interface HealthGridProps {
  events: AppEvent[];
  onTrigger: (collectorId: string) => void;
  onSelect?: (collectorId: string) => void;
}

type CardStatus = 'healthy' | 'broken' | 'healing' | 'unknown';

interface CollectorState {
  config: CollectorConfig;
  status: CardStatus;
  healingStage?: string;
  lastEvent?: AppEvent;
}

export function HealthGrid({ events, onTrigger, onSelect }: HealthGridProps) {
  const [collectors, setCollectors] = useState<CollectorConfig[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/collectors`);
        const data = await res.json();
        if (active) setCollectors(data);
      } catch (err) {
        console.error('Failed to load collectors:', err);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Derive per-collector state from events + latest health
  const states: CollectorState[] = collectors.map((config) => {
    const collectorEvents = events.filter(
      (e) => e.collectorId === config.collectorId
    );
    const latestHeal = collectorEvents.find(isHealEvent) as
      | (AppEvent & { status: string })
      | undefined;

    let status: CardStatus = 'unknown';
    let healingStage: string | undefined;

    if (latestHeal) {
      const healStatus = latestHeal.status;
      if (healStatus === 'started' || healStatus === 'healing' || healStatus === 'verifying') {
        status = 'healing';
        healingStage = healStatus;
      } else if (healStatus === 'success') {
        status = 'healthy';
      } else if (healStatus === 'failed') {
        status = 'broken';
      }
    }

    // Fall back to latest health metric if no heal event dictates state
    if (status === 'unknown' && config.latestHealth) {
      status = deriveStatusFromHealth(config.latestHealth);
    }

    return {
      config,
      status,
      healingStage,
      lastEvent: collectorEvents[0],
    };
  });

  // For demo: if we have no events yet, use baseline health from API
  if (states.length === 0) {
    return (
      <div className="text-text-muted text-center py-12 font-mono text-sm">
        No collectors registered yet. Start the orchestrator to create them.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {states.map((state) => (
        <CollectorCard key={state.config.collectorId} state={state} onTrigger={onTrigger} onSelect={onSelect} />
      ))}
    </div>
  );
}

function deriveStatusFromHealth(health: HealthMetrics): CardStatus {
  if (health.matchRate >= 0.8 && health.rowCount >= 1) return 'healthy';
  if (health.rowCount === 0 || health.matchRate === 0) return 'broken';
  return 'broken';
}

function CollectorCard({
  state,
  onTrigger,
  onSelect,
}: {
  state: CollectorState;
  onTrigger: (collectorId: string) => void;
  onSelect?: (collectorId: string) => void;
}) {
  const { config, status, healingStage } = state;
  const health = config.latestHealth;

  const statusConfig = {
    healthy: {
      icon: <CheckCircle className="w-5 h-5 text-accent" />,
      color: 'text-accent',
      border: 'border-accent/40',
      bg: 'bg-accent/5',
      label: 'Healthy',
      pulse: 'status-pulse text-accent',
    },
    broken: {
      icon: <AlertTriangle className="w-5 h-5 text-danger" />,
      color: 'text-danger',
      border: 'border-danger/40',
      bg: 'bg-danger/5',
      label: 'Broken',
      pulse: 'status-pulse text-danger',
    },
    healing: {
      icon: <Loader2 className="w-5 h-5 text-circuit animate-heal-spin" />,
      color: 'text-circuit',
      border: 'border-circuit/40',
      bg: 'bg-circuit/5',
      label: healingStage === 'verifying' ? 'Verifying' : 'Healing',
      pulse: 'status-pulse text-circuit',
    },
    unknown: {
      icon: <Activity className="w-5 h-5 text-text-muted" />,
      color: 'text-text-muted',
      border: 'border-glass-border',
      bg: 'bg-surface-2',
      label: 'No data',
    },
  }[status];

  return (
    <article
      className={`glass-card group relative ${statusConfig.border} ${statusConfig.bg} p-4 transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:bg-white/[0.035]`}
    >
      {/* Status dot */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`${statusConfig.color} ${status === 'healing' || status === 'broken' ? 'status-pulse' : ''}`}>
            {statusConfig.icon}
          </span>
          <button onClick={() => onSelect?.(config.collectorId)} className="text-left rounded-lg focus-visible:ring-2 focus-visible:ring-accent">
            <h3 className="font-semibold text-text-primary text-sm">{config.name}</h3>
            <span className={`text-xs font-mono ${statusConfig.color}`}>{statusConfig.label}</span>
          </button>
        </div>
        <button
          onClick={() => onTrigger(config.collectorId)}
          className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
          title="Trigger monitor + heal"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Target URL */}
      <a
        href={config.targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs font-mono text-text-muted hover:text-accent truncate mb-3"
      >
        {config.targetUrl}
      </a>

      {/* Health metrics */}
      {health ? (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Metric label="Match" value={`${(health.matchRate * 100).toFixed(0)}%`} good={health.matchRate >= 0.8} />
          <Metric label="Nulls" value={`${(health.nullRate * 100).toFixed(0)}%`} good={health.nullRate <= 0.3} />
          <Metric label="Rows" value={String(health.rowCount)} good={health.rowCount >= 1} />
        </div>
      ) : (
        <div className="text-xs font-mono text-text-muted mb-3">Awaiting first run…</div>
      )}

      {/* Field chips */}
      <div className="flex flex-wrap gap-1">
        {config.expectedFields.map((field) => {
          const stats = health?.fieldStats[field];
          const broken = stats && stats.present === 0;
          return (
            <span
              key={field}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                broken
                  ? 'bg-danger/20 text-danger'
                  : stats
                  ? 'bg-accent/15 text-accent'
                  : 'bg-surface-2 text-text-muted'
              }`}
            >
              {field}
            </span>
          );
        })}
      </div>

      {/* Sparkline + Collector ID footer */}
      <div className="mt-3 pt-2 border-t border-glass-border flex items-center justify-between">
        <HealthSparkline collectorId={config.collectorId} width={100} height={28} />
        <div className="flex items-center gap-1 text-[10px] font-mono text-text-muted">
          <Clock className="w-3 h-3" />
          {config.collectorId.slice(0, 10)}…
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-md bg-surface-1/50 px-2 py-1.5 text-center">
      <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-mono font-semibold ${good ? 'text-accent' : 'text-danger'}`}>
        {value}
      </div>
    </div>
  );
}
