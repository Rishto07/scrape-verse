import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Zap,
  Bug,
  Shield,
  RefreshCw,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Check,
  ChevronDown,
} from 'lucide-react';
import { MagneticButton } from './MagneticButton';

interface DemoControlsProps {
  onTrigger: (collectorId: string, simulate?: boolean) => void;
  onPrime: () => void;
  collectors: { collectorId: string; name: string }[];
}

export function DemoControls({ onTrigger, onPrime, collectors }: DemoControlsProps) {
  const [selectedCollector, setSelectedCollector] = useState<string>('');
  const [mode, setMode] = useState<'manual' | 'simulate'>('manual');
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [dropdownOpen]);

  const selectedLabel = selectedCollector
    ? collectors.find((c) => c.collectorId === selectedCollector)?.name
    : '';

  const runDemo = async () => {
    if (!selectedCollector) return;
    setStatus('running');
    setMessage('Triggering monitor + heal…');

    try {
      await onTrigger(selectedCollector, mode === 'simulate');
      setStatus('success');
      setMessage('Trigger sent, watch the event feed');
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 3000);
    } catch (err) {
      setStatus('error');
      setMessage(`Failed: ${String(err)}`);
    }
  };

  const runPrime = async () => {
    setStatus('running');
    setMessage('Priming all collectors…');
    try {
      await onPrime();
      setStatus('success');
      setMessage('Prime started, check the event feed');
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 3000);
    } catch (err) {
      setStatus('error');
      setMessage(`Failed: ${String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Section label */}
      <div className="flex items-center gap-2 px-1">
        <Zap className="w-3 h-3 text-accent" />
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-text-muted">Demo Controls</span>
      </div>

      {/* Collector selector — custom dropdown */}
      <div>
        <label htmlFor="collector-select" className="text-[11px] font-medium text-text-muted mb-1.5 block px-1">
          Target Collector
        </label>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            id="collector-select"
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            onClick={() => setDropdownOpen((o) => !o)}
            className={`w-full flex items-center justify-between gap-2 bg-white/[0.03] border rounded-lg pl-3 pr-3 py-2 text-left text-[13px] shadow-sm transition-colors cursor-pointer focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30 ${
              dropdownOpen
                ? 'border-accent/40 ring-1 ring-accent/30'
                : 'border-glass-border hover:border-glass-border'
            }`}
          >
            <span className={selectedLabel ? 'text-text-primary truncate' : 'text-text-muted'}>
              {selectedLabel || 'Select a collector'}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-200 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.ul
                role="listbox"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="absolute z-30 mt-1.5 w-full max-h-60 overflow-auto rounded-xl bg-surface-1 border border-glass-border shadow-glass p-1 space-y-0.5 origin-top"
              >
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={!selectedCollector}
                    onClick={() => {
                      setSelectedCollector('');
                      setDropdownOpen(false);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-[13px] text-text-muted hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    <span>Select a collector</span>
                    {!selectedCollector && <Check className="w-3.5 h-3.5 text-accent" />}
                  </button>
                </li>
                {collectors.map((c) => {
                  const isSel = c.collectorId === selectedCollector;
                  return (
                    <li key={c.collectorId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => {
                          setSelectedCollector(c.collectorId);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          isSel ? 'bg-accent/10' : 'hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className={`block text-[13px] leading-tight ${isSel ? 'text-accent-bright' : 'text-text-primary'}`}>
                            {c.name}
                          </span>
                          <span className="block text-[11px] leading-tight text-white/35 truncate">
                            {c.collectorId.slice(0, 14)}…
                          </span>
                        </span>
                        {isSel && <Check className="w-3.5 h-3.5 shrink-0 text-accent" />}
                      </button>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mode toggle — pill islands */}
      <div>
        <label className="text-[11px] font-medium text-text-muted mb-1.5 block px-1">
          Demo Mode
        </label>
        <div className="flex gap-1.5 p-1 bg-surface-2 rounded-xl border border-glass-border">
          {(['manual', 'simulate'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-accent-solid text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {m === 'manual' ? <Play className="w-3 h-3" /> : <Bug className="w-3 h-3" />}
                {m === 'manual' ? 'Manual' : 'Simulate'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Action buttons — pill CTA */}
      <div className="grid grid-cols-2 gap-2">
        <MagneticButton
          onClick={runDemo}
          disabled={!selectedCollector || status === 'running'}
          strength={0.4}
          className="group relative overflow-hidden flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed bg-accent/15 text-accent hover:bg-accent/25 border border-accent/20 hover:border-accent/40 transition-colors"
        >
          {status === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 animate-heal-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          )}
          <span>{status === 'running' ? 'Running…' : 'Trigger Heal'}</span>
        </MagneticButton>

        <MagneticButton
          onClick={runPrime}
          disabled={status === 'running'}
          strength={0.4}
          className="group relative overflow-hidden flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed bg-warning/10 text-warning hover:bg-warning/20 border border-warning/20 hover:border-warning/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-500" />
          <span>Prime All</span>
        </MagneticButton>
      </div>

      {/* Status message — glass pill */}
      {(status === 'success' || status === 'error') && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-mono ${
            status === 'success'
              ? 'bg-success/10 text-success border border-success/20'
              : 'bg-danger/10 text-danger border border-danger/20'
          }`}
        >
          {status === 'success' ? (
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          )}
          {message}
        </div>
      )}

      {/* How it works — subtle disclosure */}
      <details className="group">
        <summary className="text-[11px] font-medium text-text-muted flex items-center gap-1.5 cursor-pointer hover:text-text-secondary px-1">
          <Shield className="w-3 h-3" />
          How the Demo Works
        </summary>
        <div className="mt-3 text-[11px] text-text-muted space-y-1.5 font-mono leading-relaxed px-1">
          <p>1. Click "Trigger Heal" to run monitor → diagnose → heal → verify.</p>
          <p>2. "Simulate" forces a mock breakage, then auto-repairs.</p>
          <p>3. "Prime All" creates DOM snapshots + baseline checks.</p>
          <p>4. Watch the <span className="text-text-secondary">Event Feed</span> for real-time updates.</p>
        </div>
      </details>
    </div>
  );
}
