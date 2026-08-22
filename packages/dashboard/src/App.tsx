import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EventFeed } from './components/EventFeed';
import { HealthGrid } from './components/HealthGrid';
import { DiffViewer } from './components/DiffViewer';
import { SchemaTimeline } from './components/SchemaTimeline';
import { DemoControls } from './components/DemoControls';
import { useWebSocket } from './hooks/useWebSocket';
import { AppEvent, isHealEvent, CollectorConfig } from './types/events';
import { Globe, Wifi, WifiOff, Menu, X, Activity, Layers, Zap, AlertTriangle, CheckCircle } from 'lucide-react';

export default function App() {
  const { events, status, triggerCollector, primeCollectors } = useWebSocket();
  const [selectedEvent, setSelectedEvent] = useState<AppEvent | null>(null);
  const [selectedCollectorId, setSelectedCollectorId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Derive collector list from events
  const [collectors, setCollectors] = useState<CollectorConfig[]>([]);
  useEffect(() => {
    fetchCollectors();
  }, []);

  async function fetchCollectors() {
    try {
      const res = await fetch('/api/collectors');
      const data = await res.json();
      setCollectors(data);
    } catch (err) {
      console.error('Failed to load collectors:', err);
    }
  }

  const handleSelectEvent = useCallback((event: AppEvent) => {
    setSelectedEvent(event);
    if (isHealEvent(event)) {
      setSelectedCollectorId(event.collectorId);
    }
  }, []);

  return (
    <div className="h-dvh flex flex-col bg-surface-0">
      {/* Top Bar - Apple-style floating nav */}
      <header className="sticky top-0 z-40 px-4 pt-4">
        <nav className="mx-auto max-w-7xl flex items-center justify-between h-14 px-6 rounded-2xl bg-surface-1/80 backdrop-blur-xl border border-glass-border shadow-glass">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-xl hover:bg-white/5 text-text-secondary transition-colors"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                setSelectedCollectorId('');
                setSelectedEvent(null);
              }}
              className="flex items-center gap-3 rounded-xl px-1 py-1 -mx-1 cursor-pointer hover:bg-white/5 transition-colors focus:outline-none"
              aria-label="Back to dashboard home"
            >
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center overflow-hidden ring-1 ring-glass-border">
                <img
                  src="/logo.png"
                  alt="Scrape-Verse logo"
                  className="w-full h-full object-cover scale-110"
                  draggable={false}
                />
              </div>
              <div className="text-left">
                <h1 className="font-semibold text-text-primary text-[15px] leading-tight">Scrape-Verse</h1>
                <span className="text-[10px] uppercase tracking-wider font-medium text-accent">Self-Healing</span>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-5">
            {/* Stats */}
            <div className="hidden sm:flex items-center gap-4 text-xs font-medium text-text-tertiary">
              <span>{collectors.length} collectors</span>
              <span className="w-px h-4 bg-white/10" />
              <span>{events.length} events</span>
            </div>

            {/* Connection status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-glass-border">
              {status === 'connected' ? (
                <Wifi className="w-3.5 h-3.5 text-success" />
              ) : status === 'connecting' ? (
                <Activity className="w-3.5 h-3.5 text-warning animate-pulse" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-danger" />
              )}
              <span className="text-[11px] font-medium text-text-secondary capitalize">{status}</span>
            </div>
          </div>
        </nav>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden pt-2">
        {/* Sidebar */}
        <aside
          className={`fixed lg:relative z-30 h-full w-72 flex flex-col bg-surface-1/50 backdrop-blur-xl border-r border-glass-border transition-transform duration-300 ease-apple ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            <div className="px-3 py-2 mb-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Collectors</span>
            </div>
            {collectors.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-glass-border mx-auto mb-3 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-text-muted" />
                </div>
                <p className="text-text-secondary text-sm font-medium">No collectors yet</p>
                <p className="text-text-muted text-xs mt-1">Start orchestrator to create them</p>
              </div>
            ) : (
              <div className="rounded-lg bg-white/[0.02] border border-glass-border shadow-sm p-1 space-y-0.5">
                {collectors.map((collector) => (
                  <CollectorSidebarItem
                    key={collector.collectorId}
                    collector={collector}
                    isSelected={selectedCollectorId === collector.collectorId}
                    onClick={() => setSelectedCollectorId(collector.collectorId)}
                  />
                ))}
              </div>
            )}

            <div className="pt-4 mt-4 border-t border-glass-border">
              <DemoControls
                collectors={collectors.map((c) => ({
                  collectorId: c.collectorId,
                  name: c.name,
                }))}
                onTrigger={triggerCollector}
                onPrime={primeCollectors}
              />
            </div>
          </nav>
        </aside>

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 lg:hidden bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedCollectorId ? (
            <CollectorDetail
              collectorId={selectedCollectorId}
              events={events.filter((e) => e.collectorId === selectedCollectorId)}
              selectedEvent={selectedEvent}
              onSelectEvent={handleSelectEvent}
              onCloseEvent={() => setSelectedEvent(null)}
            />
          ) : (
            <DashboardOverview events={events} collectors={collectors} onTrigger={triggerCollector} onSelectCollector={setSelectedCollectorId} />
          )}
        </main>

        {/* Diff Modal */}
        <AnimatePresence>
        {selectedEvent && isHealEvent(selectedEvent) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-surface-0/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: 4 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              className="bg-surface-1 rounded-3xl border border-glass-border w-full max-w-4xl h-[85vh] shadow-glass-lg overflow-hidden"
            >
              <DiffViewer
                selectedEventId={selectedEvent.id}
                onClose={() => setSelectedEvent(null)}
              />
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function CollectorSidebarItem({
  collector,
  isSelected,
  onClick,
}: {
  collector: CollectorConfig;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 border ${
        isSelected
          ? 'bg-accent/10 border-accent/25 shadow-glow-sm'
          : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-glass-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span
          className={`text-[13px] font-medium leading-tight tracking-[-0.01em] ${
            isSelected ? 'text-accent-bright' : 'text-text-primary'
          }`}
        >
          {collector.name}
        </span>
        <span className="shrink-0 text-[10px] font-normal leading-none text-white/35">
          {collector.expectedFields?.length || 0} fields
        </span>
      </div>
      <div className="text-[11px] font-normal leading-snug text-white/40 truncate">
        {collector.collectorId.slice(0, 20)}…
      </div>
    </button>
  );
}

function DashboardOverview({
  events,
  collectors,
  onTrigger,
  onSelectCollector,
}: {
  events: AppEvent[];
  collectors: CollectorConfig[];
  onTrigger: (collectorId: string, simulate?: boolean) => void;
  onSelectCollector: (collectorId: string) => void;
}) {
  const recentHeals = events.filter(isHealEvent).slice(0, 5);
  const recentBreaks = events.filter((e) => !isHealEvent(e) && e.type === 'breakage_detected').slice(0, 5);

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="mx-auto max-w-6xl w-full px-6 py-12 lg:py-16 space-y-12">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto stagger-item">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/10 border border-accent/20 mb-6">
            <Activity className="w-3.5 h-3.5 text-accent" />
            <span className="text-[11px] uppercase tracking-wider font-semibold text-accent">Live Monitoring</span>
          </div>
          <h1 className="font-bold text-text-primary mb-4">
            Autonomous <span className="text-accent">Self-Healing</span>
            <br />Web Scraper Platform
          </h1>
          <p className="text-text-secondary text-lg leading-relaxed max-w-xl mx-auto">
            Monitor collector health in real-time. Detect breakages automatically.
            Heal without human intervention.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 stagger-item">
          <StatCard
            label="Collectors"
            value={collectors.length}
            icon={<Layers className="w-5 h-5" />}
            accent
          />
          <StatCard
            label="Total Events"
            value={events.length}
            icon={<Activity className="w-5 h-5" />}
          />
          <StatCard
            label="Heal Cycles"
            value={events.filter(isHealEvent).length}
            icon={<Zap className="w-5 h-5" />}
          />
        </div>

        <HealthGrid events={events} onTrigger={onTrigger} onSelect={onSelectCollector} />

        {/* Recent Activity Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 stagger-item">
          {/* Breakages */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl bg-danger/10 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-danger" />
              </div>
              <h3 className="font-semibold text-text-primary">Recent Breakages</h3>
            </div>
            {recentBreaks.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-8 h-8 text-success/50 mx-auto mb-2" />
                <p className="text-text-muted text-sm">No breakages detected</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {recentBreaks.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-white/[0.02] transition-colors">
                    <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
                    <span className="text-sm text-text-secondary font-mono truncate flex-1">
                      {e.collectorId.slice(0, 14)}…
                    </span>
                    <span className="text-xs text-text-muted">{formatTime(e.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Heal Cycles */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl bg-success/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-success" />
              </div>
              <h3 className="font-semibold text-text-primary">Recent Heal Cycles</h3>
            </div>
            {recentHeals.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="w-8 h-8 text-text-muted/50 mx-auto mb-2" />
                <p className="text-text-muted text-sm">No heal cycles yet</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {recentHeals.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-white/[0.02] transition-colors">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${e.status === 'success' ? 'bg-success' : 'bg-danger'}`} />
                    <span className="text-sm text-text-secondary font-mono truncate flex-1">
                      {e.collectorId.slice(0, 14)}…
                    </span>
                    <span className={`text-xs font-medium ${e.status === 'success' ? 'text-success' : 'text-danger'}`}>
                      {e.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CollectorDetail({
  collectorId,
  events,
  selectedEvent: _selectedEvent,
  onSelectEvent,
  onCloseEvent,
}: {
  collectorId: string;
  events: AppEvent[];
  selectedEvent: AppEvent | null;
  onSelectEvent: (e: AppEvent) => void;
  onCloseEvent: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Collector header */}
      <div className="px-6 py-4 border-b border-glass-border bg-surface-1/30 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
            <Globe className="w-4 h-4 text-accent" />
          </div>
          <h2 className="font-semibold text-text-primary">{collectorId}</h2>
        </div>
        <button
          onClick={onCloseEvent}
          className="p-2 rounded-xl hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Event Feed */}
        <div className="w-full lg:w-2/3 border-r border-glass-border flex flex-col">
          <EventFeed events={events} onSelectEvent={onSelectEvent} />
        </div>

        {/* Right: Schema Timeline */}
        <div className="lg:w-1/3 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-glass-border">
            <h3 className="font-semibold text-text-primary">Schema Evolution</h3>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <SchemaTimeline collectorId={collectorId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`glass-card p-6 card-hover ${accent ? 'border-accent/20 shadow-glow-sm' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">{label}</span>
        <span className={accent ? 'text-accent' : 'text-text-muted'}>{icon}</span>
      </div>
      <div className={`text-4xl font-bold tabular-nums ${accent ? 'text-accent-bright' : 'text-text-primary'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour12: false });
}
