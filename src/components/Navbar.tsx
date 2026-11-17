import { Activity, FileText, Play, Radio, Shield, Square, WifiOff, Wifi, Zap } from 'lucide-react';
import type { AppMode, ClusterStatus, Environment, GlobalState } from '../types';
import type { ConnectionState } from '../api/client';
import { formatBytes, formatUptime } from '../utils/helpers';

interface NavbarProps {
  state: GlobalState;
  onEnvironmentChange: (env: Environment) => void;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  connectionState: ConnectionState;
  isReplayRunning: boolean;
  onToggleReplay: () => void;
  totalLiveEvents?: number;
  onOpenReportModal?: () => void;
}

const CLUSTER_CONFIG = {
  operational: {
    dotClass:  'healthy',
    label:     'Operational',
    color:     'var(--green)',
  },
  degraded: {
    dotClass:  'degraded',
    label:     'Degraded',
    color:     'var(--amber)',
  },
  outage: {
    dotClass:  'down',
    label:     'Outage',
    color:     'var(--red)',
  },
} as const;

function ClusterStatus({ status }: { status: ClusterStatus }) {
  const cfg = CLUSTER_CONFIG[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className={`pulse-dot ${cfg.dotClass}`} />
      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: cfg.color }}>
        {cfg.label}
      </span>
    </div>
  );
}

function NavStat({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ color: 'var(--text-dim)', display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span
        className="mono"
        style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        {value}
      </span>
    </div>
  );
}

export default function Navbar({
  state,
  onEnvironmentChange,
  mode,
  onModeChange,
  connectionState,
  isReplayRunning,
  onToggleReplay,
  totalLiveEvents = 0,
  onOpenReportModal,
}: NavbarProps) {
  return (
    <header
      role="banner"
      style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(10,14,26,0.90)',
        backdropFilter: 'blur(16px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '0 1.25rem',
        height: 52,
        display: 'flex', alignItems: 'center', gap: '1rem',
      }}
    >
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <div
          aria-hidden="true"
          style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(145deg, #22c55e 0%, #16a34a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Shield size={14} color="white" strokeWidth={2.5} />
        </div>
        <div>
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            FlowGuard
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase', lineHeight: 1 }}>
            Edge Gateway
          </div>
        </div>
      </div>

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <div aria-hidden="true" style={{ width: 1, height: 22, background: 'var(--border-subtle)', flexShrink: 0 }} />

      {/* ── Cluster status ────────────────────────────────────────────── */}
      <ClusterStatus status={state.clusterStatus} />

      {/* ── Mode selector (Demo vs Live) ─────────────────────────────── */}
      <div
        className="env-toggle"
        role="group"
        aria-label="Application data mode"
        style={{ flexShrink: 0 }}
      >
        <button
          id="mode-demo"
          className={`env-toggle-btn ${mode === 'demo' ? 'active' : ''}`}
          onClick={() => onModeChange('demo')}
          style={mode === 'demo' ? { color: 'var(--amber)', background: 'var(--amber-dim)', borderColor: 'var(--amber-border)' } : undefined}
          aria-pressed={mode === 'demo'}
        >
          <Radio size={10} />
          Demo Mode
        </button>
        <button
          id="mode-live"
          className={`env-toggle-btn ${mode === 'live' ? 'active' : ''}`}
          onClick={() => onModeChange('live')}
          style={mode === 'live' ? { color: 'var(--green)', background: 'var(--green-dim)', borderColor: 'var(--green-border)' } : undefined}
          aria-pressed={mode === 'live'}
        >
          <span
            className={`pulse-dot ${
              connectionState === 'connected' ? 'healthy' : connectionState === 'connecting' ? 'degraded' : 'down'
            }`}
            style={{ width: 6, height: 6 }}
          />
          Live API
        </button>
      </div>

      {/* ── Replay control (visible in live mode) ────────────────────── */}
      {mode === 'live' && (
        <button
          id="btn-replay-toggle"
          onClick={onToggleReplay}
          className={`btn ${isReplayRunning ? 'btn-danger' : 'btn-success'}`}
          style={{ padding: '3px 8px', fontSize: 'var(--text-2xs)', gap: 4 }}
          title={isReplayRunning ? 'Stop offline flow replay' : 'Start offline flow replay from representative UNSW records'}
        >
          {isReplayRunning ? <Square size={9} /> : <Play size={9} />}
          {isReplayRunning ? 'Stop Replay' : 'Start Replay'}
        </button>
      )}

      {/* ── Evaluation Report Trigger ────────────────────────────────── */}
      {onOpenReportModal && (
        <button
          id="btn-open-report"
          onClick={onOpenReportModal}
          className="btn btn-secondary"
          style={{ padding: '3px 8px', fontSize: 'var(--text-2xs)', gap: 4 }}
          title="Generate model evaluation report (JSON / CSV / HTML)"
        >
          <FileText size={10} color="var(--blue)" />
          Report
        </button>
      )}

      {/* ── Live stats ─────────────────────────────────────────────────── */}
      <div
        aria-label="Live system statistics"
        style={{
          display: 'flex', alignItems: 'center', gap: '1.25rem',
          flex: 1, justifyContent: 'center',
        }}
      >
        {mode === 'live' ? (
          <>
            <NavStat
              icon={<Shield size={11} />}
              label="Model"
              value="DT-90 (UNSW)"
            />
            <NavStat
              icon={<Activity size={11} />}
              label="Scored Flows"
              value={totalLiveEvents.toLocaleString()}
            />
            <NavStat
              icon={<Wifi size={11} />}
              label="Backend API"
              value={connectionState.toUpperCase()}
            />
          </>
        ) : (
          <>
            <NavStat
              icon={<Zap size={11} />}
              label="Throughput"
              value={`${state.totalRequestsPerSec.toLocaleString()} req/s`}
            />
            <NavStat
              icon={<Activity size={11} />}
              label="Proxied"
              value={formatBytes(state.totalBytesProxied)}
            />
            <NavStat
              icon={<Wifi size={11} />}
              label="Uptime"
              value={formatUptime(state.uptime)}
            />
          </>
        )}
      </div>

      {/* ── Environment toggle ────────────────────────────────────────── */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        aria-label="Environment selector"
      >
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Env
        </span>
        <div className="env-toggle" role="group" aria-label="Select environment">
          <button
            id="env-mininet"
            className={`env-toggle-btn ${state.environment === 'mininet' ? 'active' : ''}`}
            onClick={() => onEnvironmentChange('mininet')}
            aria-pressed={state.environment === 'mininet'}
          >
            <WifiOff size={10} />
            Mininet
          </button>
          <button
            id="env-production"
            className={`env-toggle-btn ${state.environment === 'production' ? 'active' : ''}`}
            onClick={() => onEnvironmentChange('production')}
            aria-pressed={state.environment === 'production'}
          >
            <Wifi size={10} />
            Production
          </button>
        </div>
      </div>
    </header>
  );
}
