import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  clearLabHistory,
  fetchLabHealth,
  sendLabCommand,
  startLab,
  stopLab,
  subscribeLab,
} from '../api/lab';
import type {
  AgentConnection,
  LabCommand,
  LabDetectorWindow,
  LabEpisode,
  LabEvent,
  LabHealth,
  LabMessage,
  LabStartConfig,
  LabStatus,
  LabTick,
} from '../api/labTypes';

const MAX_TICKS = 180;
const MAX_EVENTS = 100;

export interface LabState {
  agent: AgentConnection;
  health: LabHealth | null;
  status: LabStatus | null;
  ticks: LabTick[];
  events: LabEvent[]; // newest first
  detector: Record<string, LabDetectorWindow>;
  episodes: LabEpisode[];
}

type LabAction =
  | { type: 'agent'; value: AgentConnection }
  | { type: 'health'; value: LabHealth | null }
  | { type: 'msg'; msg: LabMessage };

const initialState: LabState = {
  agent: 'connecting',
  health: null,
  status: null,
  ticks: [],
  events: [],
  detector: {},
  episodes: [],
};

function reducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'agent':
      return { ...state, agent: action.value };
    case 'health':
      return { ...state, health: action.value };
    case 'msg': {
      const m = action.msg;
      switch (m.type) {
        case 'snapshot':
          return {
            ...state,
            status: m.status,
            ticks: m.ticks.slice(-MAX_TICKS),
            events: [...m.events].reverse().slice(0, MAX_EVENTS),
            detector: m.detector,
            episodes: m.episodes,
          };
        case 'reset':
          return { ...state, ticks: [], events: [], detector: {} };
        case 'status':
          return { ...state, status: m };
        case 'tick':
          return { ...state, ticks: [...state.ticks, m].slice(-MAX_TICKS) };
        case 'event':
          return { ...state, events: [m, ...state.events].slice(0, MAX_EVENTS) };
        case 'detector':
          return { ...state, detector: { ...state.detector, [m.src]: m } };
        case 'episode':
          return { ...state, episodes: [...state.episodes, m].slice(-50) };
        case 'history_cleared':
          return { ...state, episodes: [] };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export function isSessionRunning(status: LabStatus | null): boolean {
  return status !== null && (status.phase === 'starting' || status.phase === 'ready' || status.phase === 'stopping');
}

export function useLab() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live stream
  useEffect(() => {
    return subscribeLab(
      (msg) => dispatch({ type: 'msg', msg }),
      (value) => dispatch({ type: 'agent', value }),
    );
  }, []);

  // Prerequisite check (root, mininet, haproxy, hping3, model) while no lab is running
  useEffect(() => {
    let alive = true;
    const poll = () => {
      fetchLabHealth()
        .then((h) => {
          if (alive) dispatch({ type: 'health', value: h });
        })
        .catch(() => {
          if (alive) dispatch({ type: 'health', value: null });
        });
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) setActionError(res.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback((cfg: LabStartConfig) => run(() => startLab(cfg)), [run]);
  const stop = useCallback(() => run(() => stopLab()), [run]);
  const command = useCallback((cmd: LabCommand) => run(() => sendLabCommand(cmd)), [run]);
  const clearHistory = useCallback(() => run(() => clearLabHistory()), [run]);

  return { state, busy, actionError, start, stop, command, clearHistory };
}
