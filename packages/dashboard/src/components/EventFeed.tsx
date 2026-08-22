import { useEffect, useRef, useState } from 'react';
import { AppEvent, isHealEvent, MonitorEvent, HealEvent } from '../types/events';
import {
  Play,
  CheckCircle,
  AlertTriangle,
  Wrench,
  Loader2,
  Search,
  XCircle,
  Radio,
} from 'lucide-react';

interface EventFeedProps {
  events: AppEvent[];
  onSelectEvent?: (event: AppEvent) => void;
}

export function EventFeed({ events, onSelectEvent }: EventFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'heal' | 'monitor'>('all');

  useEffect(() => {
    if (isAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events, isAutoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    setIsAutoScroll(scrollTop < 50);
  };

  const filtered = events.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'heal') return isHealEvent(e);
    return !isHealEvent(e);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
            <Radio className="w-3.5 h-3.5 text-accent" />
          </div>
          <div>
            <h2 className="font-semibold text-text-primary text-sm">Live Events</h2>
            <span className="text-[10px] text-text-muted">{events.length} total</span>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-1 p-1 bg-surface-2 rounded-xl">
          {(['all', 'heal', 'monitor'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                filter === f
                  ? 'bg-accent text-white shadow-glow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-glass-border flex items-center justify-center mb-4">
              <Radio className="w-5 h-5 text-text-muted" />
            </div>
            <p className="text-text-secondary text-sm font-medium">Waiting for events</p>
            <p className="text-text-muted text-xs mt-1">Events will appear here in real-time</p>
          </div>
        ) : (
          filtered.map((event) =>
            isHealEvent(event) ? (
              <HealEventRow key={event.id} event={event} onSelect={() => onSelectEvent?.(event)} />
            ) : (
              <MonitorEventRow key={event.id} event={event} />
            )
          )
        )}
      </div>
    </div>
  );
}

/* ─── Monitor Event Row ─── */

function MonitorEventRow({ event }: { event: MonitorEvent }) {
  const config = {
    run_started: { icon: Play, color: 'text-text-muted', label: 'Run Started', dot: 'bg-text-muted' },
    run_completed: { icon: CheckCircle, color: 'text-success', label: 'Run Completed', dot: 'bg-success' },
    breakage_detected: { icon: AlertTriangle, color: 'text-danger', label: 'Breakage Detected', dot: 'bg-danger' },
    health_check: { icon: Search, color: 'text-text-muted', label: 'Health Check', dot: 'bg-text-muted' },
  }[event.type];

  const Icon = config.icon;

  return (
    <div className="event-row-enter event-row-visible glass-card p-4 hover:border-glass-highlight transition-colors cursor-default">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
          event.type === 'breakage_detected' ? 'bg-danger/10' : 'bg-surface-2'
        }`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
            <span className="text-[11px] text-text-muted shrink-0">
              {formatTime(event.timestamp)}
            </span>
          </div>
          <div className="text-xs text-text-secondary font-mono truncate">
            {event.message || event.collectorId}
          </div>
          {event.health && event.type === 'breakage_detected' && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-medium text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                {(event.health.matchRate * 100).toFixed(0)}% match
              </span>
              <span className="text-[10px] text-text-muted">
                {event.health.rowCount} rows
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Heal Event Row ─── */

function HealEventRow({ event, onSelect }: { event: HealEvent; onSelect: () => void }) {
  const config = {
    started: { icon: Wrench, color: 'text-warning', label: 'Heal Started', bg: 'bg-warning/5 border-warning/20' },
    healing: { icon: Loader2, color: 'text-warning', label: 'Healing…', bg: 'bg-warning/5 border-warning/20', spin: true },
    verifying: { icon: Loader2, color: 'text-warning', label: 'Verifying…', bg: 'bg-warning/5 border-warning/20', spin: true },
    success: { icon: CheckCircle, color: 'text-success', label: 'Healed', bg: 'bg-success/5 border-success/20' },
    failed: { icon: XCircle, color: 'text-danger', label: 'Failed', bg: 'bg-danger/5 border-danger/20' },
  }[event.status];

  const Icon = config.icon;

  return (
    <button
      onClick={onSelect}
      className={`event-row-enter event-row-visible glass-card w-full p-4 border ${config.bg} text-left cursor-pointer hover:border-glass-highlight focus-visible:ring-2 focus-visible:ring-accent`}
      aria-label={`Open ${config.label} details`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${config.bg.split(' ')[0]}`}>
          <Icon className={`w-4 h-4 ${config.color} ${config.spin ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className={`text-sm font-semibold ${config.color}`}>
              {config.label}
            </span>
            <span className="text-[11px] text-text-muted shrink-0">
              {formatTime(event.timestamp)}
              {event.durationMs && <span className="opacity-60 ml-1">{(event.durationMs / 1000).toFixed(1)}s</span>}
            </span>
          </div>
          <div className="text-xs text-text-muted font-mono truncate">
            {event.collectorId}
          </div>
          {event.prompt && (
            <div className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
              {event.prompt.slice(0, 120)}
              {event.prompt.length > 120 && '…'}
            </div>
          )}
          {event.error && (
            <div className="text-[11px] text-danger mt-2 line-clamp-2 bg-danger/5 px-3 py-2 rounded-lg">
              {event.error}
            </div>
          )}
          {event.status === 'success' && event.oldDomHash && event.newDomHash && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-mono text-success/70 bg-success/10 px-2 py-0.5 rounded">
                {event.oldDomHash.slice(0, 8)}
              </span>
              <span className="text-text-muted">→</span>
              <span className="text-[10px] font-mono text-success/70 bg-success/10 px-2 py-0.5 rounded">
                {event.newDomHash.slice(0, 8)}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false });
}
