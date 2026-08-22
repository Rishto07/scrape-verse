import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface DiffViewerProps {
  selectedEventId?: string;
  onClose?: () => void;
}

export function DiffViewer({ selectedEventId, onClose }: DiffViewerProps) {
  const [diff, setDiff] = useState<DomDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'unified'>('side-by-side');

  useEffect(() => {
    if (!selectedEventId) {
      setDiff(null);
      return;
    }
    fetchDiff(selectedEventId);
  }, [selectedEventId]);

  async function fetchDiff(eventId: string) {
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_WS_URL || 'http://localhost:3001'}/api/heal-events?collectorId=&limit=100`
      );
      const events = await res.json();
      const event = events.find((e: any) => e.id === eventId);
      if (event?.diff) {
        setDiff(parseDiff(event.diff));
      }
    } catch (err) {
      console.error('Failed to load diff:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <h2 className="font-display font-semibold text-text-primary text-sm">DOM Diff</h2>
          {diff && (
            <span className="text-[10px] font-mono text-text-muted bg-surface-3 px-2 py-0.5 rounded-full">
              {diff.changedSelectors.length} changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 p-0.5 bg-surface-2 rounded-lg border border-glass-border">
            {(['side-by-side', 'unified'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-[10px] uppercase tracking-wider font-mono px-2.5 py-1 min-h-0 rounded-md transition-colors ${
                  viewMode === mode
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/5 text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-heal-spin" />
          </div>
        ) : diff ? (
          viewMode === 'side-by-side' ? (
            <SideBySideDiff diff={diff} />
          ) : (
            <UnifiedDiff diff={diff} />
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-text-muted text-xs font-mono">No diff available</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface DomDiff {
  changedSelectors: Array<{
    field: string;
    oldSelector?: string;
    newSelector?: string;
    oldContext: string;
    newContext: string;
  }>;
  addedFields: string[];
  removedFields: string[];
  summary: string;
}

function parseDiff(diffText: string): DomDiff {
  try {
    return JSON.parse(diffText);
  } catch {
    return {
      changedSelectors: [],
      addedFields: [],
      removedFields: [],
      summary: diffText.slice(0, 200),
    };
  }
}

function SideBySideDiff({ diff }: { diff: DomDiff }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
      <DiffPane title="Previous" items={diff.changedSelectors} side="old" />
      <DiffPane title="Current" items={diff.changedSelectors} side="new" />
    </div>
  );
}

function UnifiedDiff({ diff }: { diff: DomDiff }) {
  return (
    <div className="space-y-2">
      {diff.changedSelectors.map((change, i) => (
        <UnifiedChange key={i} change={change} />
      ))}
    </div>
  );
}

function DiffPane({
  title,
  items,
  side,
}: {
  title: string;
  items: DomDiff['changedSelectors'];
  side: 'old' | 'new';
}) {
  return (
    <div className="glass-card flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-glass-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-text-muted">{title}</span>
        <span className="text-[10px] font-mono text-text-muted bg-surface-3 px-2 py-0.5 rounded-full">
          {items.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="text-text-muted text-xs font-mono text-center py-8">No changes</div>
        ) : (
          items.map((change, i) => (
            <SelectorChangeCard
              key={i}
              field={change.field}
              selector={side === 'old' ? change.oldSelector : change.newSelector}
              context={side === 'old' ? change.oldContext : change.newContext}
              side={side}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SelectorChangeCard({
  field,
  selector,
  context,
  side,
}: {
  field: string;
  selector: string | undefined;
  context: string;
  side: 'old' | 'new';
}) {
  return (
    <div className="bg-surface-2/50 rounded-xl border border-glass-border p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider font-mono text-text-muted">Field</span>
        <code className="text-[11px] font-mono text-text-primary">{field}</code>
      </div>
      {selector && (
        <div className="mb-2">
          <span className="text-[10px] uppercase tracking-wider font-mono text-text-muted">Selector</span>
          <code className={`text-[10px] font-mono block mt-1 break-all ${side === 'old' ? 'text-danger/80' : 'text-accent/80'}`}>
            {selector}
          </code>
        </div>
      )}
      <div>
        <span className="text-[10px] uppercase tracking-wider font-mono text-text-muted">Context</span>
        <pre className="text-[9px] font-mono text-text-muted mt-1 bg-surface-0/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
          {context.slice(0, 500)}{context.length > 500 ? '…' : ''}
        </pre>
      </div>
    </div>
  );
}

function UnifiedChange({ change }: { change: DomDiff['changedSelectors'][0] }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <code className="text-[11px] font-mono text-text-primary">{change.field}</code>
        <span className="text-[9px] uppercase tracking-wider font-mono text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">changed</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-[9px] uppercase tracking-wider font-mono text-danger">Previous</span>
          {change.oldSelector && (
            <code className="text-[10px] font-mono text-danger/70 block mt-1 break-all">{change.oldSelector}</code>
          )}
          <pre className="text-[9px] font-mono text-text-muted mt-1 bg-surface-0/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
            {change.oldContext.slice(0, 400)}
          </pre>
        </div>
        <div>
          <span className="text-[9px] uppercase tracking-wider font-mono text-accent">Current</span>
          {change.newSelector && (
            <code className="text-[10px] font-mono text-accent/70 block mt-1 break-all">{change.newSelector}</code>
          )}
          <pre className="text-[9px] font-mono text-text-muted mt-1 bg-surface-0/50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
            {change.newContext.slice(0, 400)}
          </pre>
        </div>
      </div>
    </div>
  );
}
