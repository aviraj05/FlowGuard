/**
 * Global FlowGuard state: one live connection to the lab agent shared by every page.
 * Falls back to clearly-labelled demo data when the agent is not reachable.
 */
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  clearLabHistory,
  fetchLabHealth,
  incidentAction as apiIncidentAction,
  sendLabCommand,
  startLab,
  stopLab,
  subscribeLab,
} from '../api/lab';
import type { ActionResult, IncidentAction } from '../api/lab';
import type {
  AgentConnection,
  Device,
  Incident,
  LabCommand,
  LabDetectorWindow,
  LabEpisode,
  LabEvent,
  LabHealth,
  LabMessage,
  LabStartConfig,
  LabStatus,
  LabTick,
  NotificationEntry,
} from '../api/labTypes';
import { DEMO_DEVICES, demoEpisodes, demoIncidents, demoNotifyLog, demoTick, demoTicks } from '../data/demo';

const MAX_TICKS = 180;

export type DataSource = 'connecting' | 'live' | 'simulated' | 'demo';
export type Range = '24h' | '7d' | '30d';

export interface Toast {
  id: number;
  incident: Incident;
}

interface State {
  agent: AgentConnection;
  demo: boolean;
  health: LabHealth | null;
  status: LabStatus | null;
  ticks: LabTick[];
  events: LabEvent[];
  detector: Record<string, LabDetectorWindow>;
  episodes: LabEpisode[];
  incidents: Incident[];
  notifyLog: NotificationEntry[];
  devices: Device[];
  lastOpened: Incident | null;
}

type Action =
  | { type: 'agent'; value: AgentConnection }
  | { type: 'health'; value: LabHealth | null }
  | { type: 'demo'; now: number }
  | { type: 'demoTick' }
  | { type: 'msg'; msg: LabMessage };

const initial: State = {
  agent: 'connecting', demo: false, health: null, status: null, ticks: [], events: [], detector: {},
  episodes: [], incidents: [], notifyLog: [], devices: DEMO_DEVICES, lastOpened: null,
};

function upsertIncident(list: Incident[], inc: Incident): Incident[] {
  const i = list.findIndex((x) => x.id === inc.id);
  if (i === -1) return [...list, inc].slice(-200);
  const next = list.slice();
  next[i] = inc;
  return next;
}

let demoRand = 7;
function rand() {
  demoRand = (demoRand * 9301 + 49297) % 233280;
  return demoRand / 233280;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'agent':
      return { ...state, agent: action.value };
    case 'health':
      return { ...state, health: action.value };
    case 'demo': {
      if (state.demo) return state;
      const incidents = demoIncidents(action.now);
      return {
        ...state, demo: true, status: null, ticks: demoTicks(action.now), events: [], detector: {},
        episodes: demoEpisodes(action.now), incidents, notifyLog: demoNotifyLog(incidents), devices: DEMO_DEVICES,
      };
    }
    case 'demoTick': {
      if (!state.demo) return state;
      const last = state.ticks[state.ticks.length - 1];
      const now = Date.now() / 1000;
      return { ...state, ticks: [...state.ticks, demoTick((last?.t ?? 0) + 1, now, rand)].slice(-MAX_TICKS) };
    }
    case 'msg': {
      const m = action.msg;
      const base = state.demo ? { ...initial, agent: state.agent, health: state.health } : state;
      switch (m.type) {
        case 'snapshot':
          return {
            ...base, demo: false, status: m.status, ticks: m.ticks.slice(-MAX_TICKS), events: [...m.events].reverse(),
            detector: m.detector, episodes: m.episodes, incidents: m.incidents ?? [],
            notifyLog: m.notify_log ?? [], devices: m.devices?.length ? m.devices : DEMO_DEVICES,
          };
        case 'reset':
          return { ...base, ticks: [], events: [], detector: {} };
        case 'status':
          return { ...base, status: m };
        case 'tick':
          return { ...base, ticks: [...base.ticks, m].slice(-MAX_TICKS) };
        case 'event':
          return { ...base, events: [m, ...base.events].slice(0, 150) };
        case 'detector':
          return { ...base, detector: { ...base.detector, [m.src]: m } };
        case 'episode':
          return { ...base, episodes: [...base.episodes, m].slice(-50) };
        case 'history_cleared':
          return { ...base, episodes: [], incidents: [] };
        case 'incident':
          return {
            ...base, incidents: upsertIncident(base.incidents, m.incident),
            lastOpened: m.what === 'opened' ? m.incident : base.lastOpened,
          };
        case 'notification':
          return { ...base, notifyLog: [...base.notifyLog, m.entry].slice(-300) };
        case 'devices':
          return { ...base, devices: m.devices };
        default:
          return base;
      }
    }
    default:
      return state;
  }
}

export function isRunning(status: LabStatus | null): boolean {
  return status !== null && (status.phase === 'starting' || status.phase === 'ready' || status.phase === 'stopping');
}

function useStore() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [range, setRange] = useState<Range>('7d');
  const toastSeq = useRef(0);

  useEffect(() => subscribeLab((msg) => dispatch({ type: 'msg', msg }), (v) => dispatch({ type: 'agent', value: v })), []);

  // Agent not reachable: switch to demo data after a short grace period.
  const online = state.agent === 'online';
  useEffect(() => {
    if (online) return;
    const id = setTimeout(() => dispatch({ type: 'demo', now: Date.now() / 1000 }), 2500);
    return () => clearTimeout(id);
  }, [online]);

  useEffect(() => {
    if (!state.demo) return;
    const id = setInterval(() => dispatch({ type: 'demoTick' }), 1000);
    return () => clearInterval(id);
  }, [state.demo]);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetchLabHealth()
        .then((h) => alive && dispatch({ type: 'health', value: h }))
        .catch(() => alive && dispatch({ type: 'health', value: null }));
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Toast for every newly opened incident
  useEffect(() => {
    const inc = state.lastOpened;
    if (!inc) return;
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, incident: inc }].slice(-3));
    const timer = setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 9000);
    return () => clearTimeout(timer);
  }, [state.lastOpened]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const run = useCallback(async (fn: () => Promise<ActionResult>): Promise<ActionResult> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.message);
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback((cfg: LabStartConfig) => run(() => startLab(cfg)), [run]);
  const stop = useCallback(() => run(() => stopLab()), [run]);
  const command = useCallback((cmd: LabCommand) => run(() => sendLabCommand(cmd)), [run]);
  const clearHistory = useCallback(() => run(() => clearLabHistory()), [run]);
  const actOnIncident = useCallback((id: string, a: IncidentAction) => run(() => apiIncidentAction(id, a)), [run]);

  const source: DataSource = state.demo
    ? 'demo'
    : state.agent !== 'online'
      ? 'connecting'
      : state.status?.simulated
        ? 'simulated'
        : 'live';

  const running = !state.demo && isRunning(state.status);
  const lastTick = state.ticks[state.ticks.length - 1] ?? null;

  return {
    ...state, source, running, lastTick, busy, error, setError, toasts, dismissToast, range, setRange,
    start, stop, command, clearHistory, actOnIncident,
  };
}

export type Store = ReturnType<typeof useStore>;

const Ctx = createContext<Store | null>(null);

export function FlowGuardProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useFG(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useFG must be used inside FlowGuardProvider');
  return s;
}

export function deviceName(devices: Device[], key: string): string {
  const d = devices.find((x) => x.ip === key || x.host === key);
  return d ? d.name : key;
}

export const RANGE_SECONDS: Record<Range, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
