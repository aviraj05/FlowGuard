/**
 * Typed API Client for FlowGuard Backend
 * Handles REST calls, error normalization, and resilient WebSocket event subscriptions.
 */

import type {
  HealthDTO,
  ModelInfoDTO,
  DashboardSnapshotDTO,
  EventItemDTO,
  LabActionDTO,
  ReplayStatusDTO,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorText = await res.text();
    let detail = errorText;
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || errorText;
    } catch {
      // Keep raw text
    }
    throw new Error(`API Error [${res.status}]: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<HealthDTO> {
  const res = await fetch(`${API_BASE_URL}/api/v1/health`);
  return handleResponse<HealthDTO>(res);
}

export async function fetchModelInfo(): Promise<ModelInfoDTO> {
  const res = await fetch(`${API_BASE_URL}/api/v1/model/info`);
  return handleResponse<ModelInfoDTO>(res);
}

export async function fetchSnapshot(): Promise<DashboardSnapshotDTO> {
  const res = await fetch(`${API_BASE_URL}/api/v1/dashboard/snapshot`);
  return handleResponse<DashboardSnapshotDTO>(res);
}

export async function fetchEvents(limit = 50, severity?: string, label?: number): Promise<{ total: number; events: EventItemDTO[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (severity) params.append('severity', severity);
  if (label !== undefined) params.append('label', String(label));
  const res = await fetch(`${API_BASE_URL}/api/v1/events?${params.toString()}`);
  return handleResponse<{ total: number; events: EventItemDTO[] }>(res);
}

export async function toggleLabBackend(backendId: string, failed: boolean, reason?: string): Promise<LabActionDTO> {
  const res = await fetch(`${API_BASE_URL}/api/v1/lab/backends/${encodeURIComponent(backendId)}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ failed, reason: reason || 'Operator dashboard toggle' }),
  });
  return handleResponse<LabActionDTO>(res);
}

export async function startReplay(interval = 2.0): Promise<{ status: string; interval: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/replay/start?interval=${interval}`, {
    method: 'POST',
  });
  return handleResponse<{ status: string; interval: number }>(res);
}

export async function stopReplay(): Promise<{ status: string; total_replayed: number }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/replay/stop`, {
    method: 'POST',
  });
  return handleResponse<{ status: string; total_replayed: number }>(res);
}

export async function fetchReplayStatus(): Promise<ReplayStatusDTO> {
  const res = await fetch(`${API_BASE_URL}/api/v1/replay/status`);
  return handleResponse<ReplayStatusDTO>(res);
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WebSocketCallbacks {
  onFlowEvent: (event: EventItemDTO) => void;
  onBackendUpdate: (backend: any) => void;
  onConnectionChange: (state: ConnectionState, message?: string) => void;
}

export function subscribeToEventStream(callbacks: WebSocketCallbacks): () => void {
  let ws: WebSocket | null = null;
  let isClosedManually = false;
  let heartbeatTimer: any = null;
  let reconnectTimeout: any = null;
  let retryCount = 0;

  function connect() {
    if (isClosedManually) return;
    callbacks.onConnectionChange('connecting');

    try {
      ws = new WebSocket(`${WS_BASE_URL}/api/v1/events/stream`);

      ws.onopen = () => {
        retryCount = 0;
        callbacks.onConnectionChange('connected');
        // Start ping heartbeat every 15s
        heartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'flow_event' && payload.data) {
            callbacks.onFlowEvent(payload.data as EventItemDTO);
          } else if (payload.type === 'backend_update' && payload.data) {
            callbacks.onBackendUpdate(payload.data);
          }
        } catch (err) {
          console.warn('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = () => {
        callbacks.onConnectionChange('error', 'WebSocket connection failed');
      };

      ws.onclose = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (!isClosedManually) {
          callbacks.onConnectionChange('disconnected', 'Disconnected from server. Reconnecting...');
          // Exponential backoff up to 10 seconds
          const delay = Math.min(1000 * Math.pow(1.5, retryCount), 10000);
          retryCount++;
          reconnectTimeout = setTimeout(connect, delay);
        }
      };
    } catch (err) {
      callbacks.onConnectionChange('error', String(err));
      reconnectTimeout = setTimeout(connect, 3000);
    }
  }

  connect();

  return () => {
    isClosedManually = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}
