// ─── FlowGuard Dashboard ──────────────────────────────────────────────────
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import './index.css';
import './App.css';
import Navbar from './components/Navbar';
import TrafficPanel from './components/TrafficPanel';
import SecurityFeed from './components/SecurityFeed';
import BackendMatrix from './components/BackendMatrix';
import CacheMetricsPanel from './components/CacheMetrics';
import TopologyMap from './components/TopologyMap';
import EvaluationSummaryPanel from './components/EvaluationSummaryPanel';
import ReportModal from './components/ReportModal';
import LabView from './components/lab/LabView';
import { generateInitialState, tick } from './data/mockEngine';
import type { AppMode, Environment, GlobalState, SecurityLogEntry } from './types';
import {
  type ConnectionState,
  fetchSnapshot,
  fetchReplayStatus,
  startReplay,
  stopReplay,
  subscribeToEventStream,
  toggleLabBackend,
} from './api/client';
import type { EventItemDTO } from './api/types';

// ── Reducer ──────────────────────────────────────────────────────────────
type Action =
  | { type: 'TICK' }
  | { type: 'SET_ENV'; env: Environment }
  | { type: 'TOGGLE_FAIL'; id: string }
  | { type: 'SET_BACKEND_STATUS'; id: string; status: 'healthy' | 'degraded' | 'down'; manuallyFailed: boolean }
  | { type: 'ADD_LIVE_EVENT'; event: SecurityLogEntry }
  | { type: 'LOAD_SNAPSHOT'; events: SecurityLogEntry[]; backends: any[] };

function reducer(state: GlobalState, action: Action): GlobalState {
  switch (action.type) {
    case 'TICK':
      return tick(state);

    case 'SET_ENV':
      return { ...state, environment: action.env };

    case 'TOGGLE_FAIL':
      return {
        ...state,
        backends: state.backends.map(b =>
          b.id === action.id ? { ...b, manuallyFailed: !b.manuallyFailed } : b
        ),
      };

    case 'SET_BACKEND_STATUS':
      return {
        ...state,
        backends: state.backends.map(b =>
          b.id === action.id ? { ...b, status: action.status, manuallyFailed: action.manuallyFailed } : b
        ),
      };

    case 'ADD_LIVE_EVENT': {
      const updatedLog = [action.event, ...state.securityLog.slice(0, 99)];
      const isAttack = action.event.label === 1;
      return {
        ...state,
        securityLog: updatedLog,
        clusterStatus: isAttack ? 'degraded' : state.clusterStatus,
      };
    }

    case 'LOAD_SNAPSHOT': {
      return {
        ...state,
        securityLog: action.events.length > 0 ? action.events : state.securityLog,
      };
    }

    default:
      return state;
  }
}

function dtoToLogEntry(dto: EventItemDTO): SecurityLogEntry {
  const isAttack = dto.label === 1 || dto.label_name === 'ATTACK';
  const actionType = isAttack ? 'flagged' : 'allowed';
  return {
    id: dto.event_id,
    timestamp: new Date(dto.timestamp).getTime() || Date.now(),
    sourceIp: dto.src_ip,
    dstIp: dto.dst_ip,
    method: (dto.service || 'RAW').toUpperCase(),
    path: `/${dto.proto}/${dto.dst_port}`,
    statusCode: isAttack ? 403 : 200,
    entropyScore: 0,
    dgaScore: 0,
    action: actionType,
    byteSize: 1024,
    latencyMs: 12,
    reason: isAttack ? 'ML Model: Intrusion Flagged (UNSW-90)' : undefined,
    label: dto.label,
    labelName: dto.label_name,
    riskScore: dto.risk_score,
    protocol: dto.proto,
    service: dto.service,
    sourceType: (dto.source_type as any) || 'replay',
  };
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, generateInitialState);
  const [mode, setMode] = useState<AppMode>('demo');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isReplayRunning, setIsReplayRunning] = useState(false);
  const [totalLiveEvents, setTotalLiveEvents] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [view, setView] = useState<'lab' | 'monitor'>('lab');

  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Demo mode ticker (runs only in demo mode)
  useEffect(() => {
    if (mode === 'demo' && view === 'monitor') {
      demoIntervalRef.current = setInterval(() => dispatch({ type: 'TICK' }), 1200);
    } else {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    }
    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    };
  }, [mode, view]);

  // Live mode WebSocket and initial snapshot fetch
  useEffect(() => {
    if (mode !== 'live') return;

    let isMounted = true;

    // Fetch initial snapshot
    fetchSnapshot()
      .then((snapshot) => {
        if (!isMounted) return;
        setTotalLiveEvents(snapshot.total_events);
        setLastUpdateTime(new Date().toLocaleTimeString());
        const mappedEntries = snapshot.recent_events.map(dtoToLogEntry);
        dispatch({ type: 'LOAD_SNAPSHOT', events: mappedEntries, backends: snapshot.backends });
      })
      .catch((err) => {
        if (!isMounted) return;
        setApiErrorMessage(String(err));
      });

    // Check replay status
    fetchReplayStatus()
      .then((status) => {
        if (isMounted) setIsReplayRunning(status.is_running);
      })
      .catch(() => {});

    // Subscribe to WebSocket
    const unsubscribe = subscribeToEventStream({
      onFlowEvent: (eventDTO) => {
        if (!isMounted) return;
        const entry = dtoToLogEntry(eventDTO);
        dispatch({ type: 'ADD_LIVE_EVENT', event: entry });
        setTotalLiveEvents((prev) => prev + 1);
        setLastUpdateTime(new Date().toLocaleTimeString());
      },
      onBackendUpdate: (backendDTO) => {
        if (!isMounted) return;
        const statusMap: Record<string, 'healthy' | 'degraded' | 'down'> = {
          HEALTHY: 'healthy',
          DEGRADED: 'degraded',
          OFFLINE: 'down',
        };
        dispatch({
          type: 'SET_BACKEND_STATUS',
          id: backendDTO.id,
          status: statusMap[backendDTO.status] || 'healthy',
          manuallyFailed: Boolean(backendDTO.failed),
        });
      },
      onConnectionChange: (connState, msg) => {
        if (!isMounted) return;
        setConnectionState(connState);
        if (connState === 'connected') {
          setApiErrorMessage(null);
        } else if (msg) {
          setApiErrorMessage(msg);
        }
      },
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [mode]);

  const handleEnvironmentChange = useCallback((env: Environment) => {
    dispatch({ type: 'SET_ENV', env });
  }, []);

  const handleToggleFail = useCallback(
    async (id: string) => {
      if (mode === 'live') {
        const targetBackend = state.backends.find((b) => b.id === id);
        const willFail = !(targetBackend?.manuallyFailed);
        try {
          await toggleLabBackend(id, willFail);
          dispatch({
            type: 'SET_BACKEND_STATUS',
            id,
            status: willFail ? 'down' : 'healthy',
            manuallyFailed: willFail,
          });
        } catch (err) {
          console.error('Failed to toggle backend via API:', err);
          alert(`Lab action failed: ${err}`);
        }
      } else {
        dispatch({ type: 'TOGGLE_FAIL', id });
      }
    },
    [mode, state.backends]
  );

  const handleToggleReplay = useCallback(async () => {
    try {
      if (isReplayRunning) {
        await stopReplay();
        setIsReplayRunning(false);
      } else {
        await startReplay(2.0);
        setIsReplayRunning(true);
      }
    } catch (err) {
      console.error('Failed to toggle replay:', err);
    }
  }, [isReplayRunning]);

  const envLabel =
    state.environment === 'mininet' ? 'Mininet Emulation' : 'Production';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* ── View tabs: Mininet Lab (load balancing + ML defence) / Monitoring Dashboard ── */}
      <nav
        aria-label="Dashboard view"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '6px 1.25rem',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          FlowGuard
        </span>
        <div className="env-toggle" role="group" aria-label="Dashboard view">
          <button
            id="view-lab"
            className={`env-toggle-btn ${view === 'lab' ? 'active' : ''}`}
            onClick={() => setView('lab')}
            aria-pressed={view === 'lab'}
          >
            Mininet Lab &middot; load balancing + ML defence
          </button>
          <button
            id="view-monitor"
            className={`env-toggle-btn ${view === 'monitor' ? 'active' : ''}`}
            onClick={() => setView('monitor')}
            aria-pressed={view === 'monitor'}
          >
            Monitoring Dashboard
          </button>
        </div>
      </nav>

      {view === 'lab' ? (
        <LabView />
      ) : (
        <>
      <Navbar
        state={state}
        onEnvironmentChange={handleEnvironmentChange}
        mode={mode}
        onModeChange={setMode}
        connectionState={connectionState}
        isReplayRunning={isReplayRunning}
        onToggleReplay={handleToggleReplay}
        totalLiveEvents={totalLiveEvents}
        onOpenReportModal={() => setIsReportModalOpen(true)}
      />

      {/* ── Banner: Mode description & warnings ── */}
      {mode === 'demo' ? (
        <div
          role="status"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            borderBottom: '1px solid var(--amber-border)',
            padding: '5px 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--text-xs)',
            color: 'var(--amber)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontWeight: 700 }}>[DEMO SIMULATION]</span>
            <span>Dashboard is currently displaying client-side generated telemetry.</span>
          </div>
          <button
            onClick={() => setMode('live')}
            className="btn btn-outline"
            style={{ padding: '2px 8px', fontSize: 'var(--text-2xs)', color: 'var(--amber)', borderColor: 'var(--amber-border)' }}
          >
            Switch to Live API Mode →
          </button>
        </div>
      ) : (
        <div
          role="status"
          style={{
            background: connectionState === 'connected' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            borderBottom: `1px solid ${connectionState === 'connected' ? 'var(--green-border)' : 'var(--red-border)'}`,
            padding: '5px 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--text-xs)',
            color: connectionState === 'connected' ? 'var(--green)' : 'var(--red)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono" style={{ fontWeight: 700 }}>[LIVE API MODE]</span>
            <span>
              Connected to FastAPI backend with 90-feature Decision Tree model (UNSW-NB15).
              {lastUpdateTime && ` Last flow scored at ${lastUpdateTime}.`}
            </span>
          </div>
          {apiErrorMessage && (
            <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--red)' }}>
              {apiErrorMessage}
            </span>
          )}
        </div>
      )}

      <main
        id="main-content"
        aria-label="Dashboard"
        style={{
          flex: 1,
          padding: '1rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          maxWidth: 1800,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* ── Row 1: Traffic chart (2/3) + Backend health (1/3) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
            gap: '1rem',
            minHeight: 320,
          }}
        >
          <TrafficPanel
            history={state.trafficHistory}
            backends={state.backends}
            totalRps={state.totalRequestsPerSec}
          />
          <BackendMatrix
            backends={state.backends}
            onToggleFail={handleToggleFail}
          />
        </div>

        {/* ── Evaluation & Performance Gates Summary Panel ── */}
        <EvaluationSummaryPanel
          onOpenReportModal={() => setIsReportModalOpen(true)}
          totalLiveEvents={totalLiveEvents}
        />

        {/* ── Row 2: Security feed (3/5) + Cache metrics (2/5) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
            gap: '1rem',
            minHeight: 360,
          }}
        >
          <SecurityFeed entries={state.securityLog} />
          <CacheMetricsPanel metrics={state.cacheMetrics} isLiveMode={mode === 'live'} />
        </div>

        {/* ── Row 3: Full-width topology ── */}
        <div style={{ minHeight: 400 }}>
          <TopologyMap
            nodes={state.networkNodes}
            links={state.networkLinks}
          />
        </div>
      </main>
        </>
      )}

      {/* ── Footer ── */}
      <footer
        aria-label="System status bar"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '7px 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>
            flowguard v2.4.1 · {envLabel} · {view === 'lab' ? 'Lab model: Random Forest (9 window features)' : 'Model: DecisionTree_UNSW90_v1.0 (90 features)'}
          </span>
          {mode === 'live' && (
            <span
              className="mono"
              style={{
                fontSize: 'var(--text-2xs)',
                color: connectionState === 'connected' ? 'var(--green)' : 'var(--red)',
                padding: '0 4px',
                borderRadius: 2,
                background: connectionState === 'connected' ? 'var(--green-dim)' : 'var(--red-dim)',
              }}
            >
              {connectionState === 'connected' ? 'WS: ACTIVE' : 'WS: RECONNECTING'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>
            {lastUpdateTime ? `Updated: ${lastUpdateTime}` : 'System Ready'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              className={`pulse-dot ${
                state.clusterStatus === 'operational'
                  ? 'healthy'
                  : state.clusterStatus === 'degraded'
                  ? 'degraded'
                  : 'down'
              }`}
              aria-hidden
            />
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              {state.clusterStatus === 'operational'
                ? 'All systems operational'
                : state.clusterStatus === 'degraded'
                ? 'Degraded mode'
                : 'Cluster outage'}
            </span>
          </div>
        </div>
      </footer>

      {/* ── Evaluation Report Modal ── */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
      />
    </div>
  );
}
