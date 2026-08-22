import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Minus, History } from 'lucide-react';

interface SchemaChange {
  field: string;
  type: 'added' | 'removed' | 'type_changed';
  oldType?: string;
  newType?: string;
  timestamp: string;
  eventId: string;
}

interface SchemaTimelineProps {
  collectorId?: string;
}

export function SchemaTimeline({ collectorId }: SchemaTimelineProps) {
  const [changes, setChanges] = useState<SchemaChange[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!collectorId) {
      setChanges([]);
      return;
    }
    fetchTimeline(collectorId);
  }, [collectorId]);

  async function fetchTimeline(cid: string) {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_WS_URL || 'http://localhost:3001'}/api/heal-events?collectorId=${encodeURIComponent(cid)}&limit=100`
      );
      const events = await res.json();
      const timeline = buildTimeline(events);
      setChanges(timeline);
    } catch (err) {
      console.error('Failed to load schema timeline:', err);
    }
  }

  function buildTimeline(events: any[]): SchemaChange[] {
    const result: SchemaChange[] = [];
    for (const event of events) {
      if (event.status !== 'success') continue;
      if (event.diff) {
        try {
          const diff = JSON.parse(event.diff);
          if (diff.addedFields) {
            for (const field of diff.addedFields) {
              result.push({
                field,
                type: 'added',
                timestamp: event.timestamp,
                eventId: event.id,
              });
            }
          }
          if (diff.removedFields) {
            for (const field of diff.removedFields) {
              result.push({
                field,
                type: 'removed',
                timestamp: event.timestamp,
                eventId: event.id,
              });
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  if (!collectorId) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-10 h-10 rounded-2xl bg-surface-2 border border-glass-border flex items-center justify-center mb-3">
          <History className="w-4 h-4 text-text-muted" />
        </div>
        <p className="text-text-muted text-xs font-mono">Select a collector</p>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-10 h-10 rounded-2xl bg-surface-2 border border-glass-border flex items-center justify-center mb-3">
          <History className="w-4 h-4 text-text-muted" />
        </div>
        <p className="text-text-muted text-xs font-mono">No schema changes yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center">
            <History className="w-3 h-3 text-accent" />
          </div>
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-text-muted">Evolution</span>
        </div>
        <span className="text-[10px] font-mono text-text-muted bg-surface-3 px-2 py-0.5 rounded-full">
          {changes.length}
        </span>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-glass-border" />

        {changes.map((change, i) => (
          <SchemaChangeRow
            key={change.eventId + '-' + change.field}
            change={change}
            expanded={expanded.has(change.eventId + '-' + change.field)}
            onToggle={(id) => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            staggerIndex={i}
          />
        ))}
      </div>
    </div>
  );
}

function SchemaChangeRow({
  change,
  expanded,
  onToggle,
  staggerIndex,
}: {
  change: SchemaChange;
  expanded: boolean;
  onToggle: (id: string) => void;
  staggerIndex: number;
}) {
  const id = change.eventId + '-' + change.field;
  const isAdded = change.type === 'added';
  const Icon = isAdded ? Plus : Minus;

  return (
    <div className="stagger-item relative pl-12 pb-3" style={{ animationDelay: `${staggerIndex * 50}ms` }}>
      {/* Timeline dot */}
      <div
        className={`absolute left-3 top-1 w-4 h-4 rounded-full border-2 flex items-center justify-center z-10 ${
          isAdded
            ? 'bg-surface-0 border-accent'
            : 'bg-surface-0 border-danger'
        }`}
      >
        <Icon className={`w-2 h-2 ${isAdded ? 'text-accent' : 'text-danger'}`} />
      </div>

      {/* Card */}
      <div
        className={`glass-card p-3 transition-colors ${
          expanded ? 'border-accent/20 shadow-glow-sm' : ''
        }`}
      >
        <div className="flex items-start gap-2">
          <span className={`text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
            isAdded ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'
          }`}>
            {isAdded ? 'ADDED' : 'REMOVED'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <code className="text-[13px] font-mono text-text-primary">{change.field}</code>
              <button
                onClick={() => onToggle(id)}
                className="p-1 rounded-lg hover:bg-white/5 text-text-muted"
                aria-label={expanded ? 'Collapse' : 'Expand'}
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[10px] font-mono text-text-muted mt-0.5">
              {formatTime(change.timestamp)}
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-glass-border space-y-1.5 schema-expand-enter schema-expand-visible">
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Event:</span> {change.eventId.slice(0, 12)}…
            </div>
            <div className="text-[10px] font-mono text-text-muted">
              <span className="text-text-secondary">Type:</span> {isAdded ? 'Field added to schema' : 'Field removed from schema'}
            </div>
            {change.oldType && (
              <div className="text-[10px] font-mono text-text-muted">
                <span className="text-text-secondary">Changed:</span> {change.oldType} → {change.newType}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
