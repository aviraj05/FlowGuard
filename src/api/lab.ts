/**
 * Client for the Mininet lab agent (lab_agent.py inside the VM).
 * REST for control, Server-Sent Events for the live stream.
 */
import type {
  AgentConnection,
  Device,
  LabCommand,
  LabHealth,
  LabMessage,
  LabStartConfig,
  NotificationEntry,
  NotifyConfig,
  Stakeholder,
} from './labTypes';

// With VirtualBox port forwarding (host 8765 -> VM 8765) this is just localhost.
export const LAB_URL: string = import.meta.env.VITE_LAB_URL || 'http://localhost:8765';

export interface ActionResult {
  ok: boolean;
  message: string;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${LAB_URL}/api/lab${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Lab agent is unreachable. Is lab_agent.py running in the VM (port 8765 forwarded)?');
  }
  const data = (await res.json()) as T;
  return data;
}

export function fetchLabHealth(): Promise<LabHealth> {
  return request<LabHealth>('GET', '/health');
}

export function startLab(cfg: LabStartConfig): Promise<ActionResult> {
  return request<ActionResult>('POST', '/start', cfg);
}

export function stopLab(): Promise<ActionResult> {
  return request<ActionResult>('POST', '/stop', {});
}

export function sendLabCommand(cmd: LabCommand): Promise<ActionResult> {
  return request<ActionResult>('POST', '/command', cmd);
}

export function clearLabHistory(): Promise<ActionResult> {
  return request<ActionResult>('POST', '/history/clear', {});
}

export type IncidentAction = 'ack' | 'unblock' | 'false_positive' | 'resolve';

export function incidentAction(id: string, action: IncidentAction): Promise<ActionResult> {
  return request<ActionResult>('POST', `/incidents/${encodeURIComponent(id)}/action`, { action, who: 'Dashboard' });
}

export function saveDevices(devices: Device[]): Promise<ActionResult> {
  return request<ActionResult>('POST', '/devices', { devices });
}

export function fetchNotifyConfig(): Promise<NotifyConfig> {
  return request<NotifyConfig>('GET', '/notify/config');
}

export function saveNotifyConfig(stakeholders: Stakeholder[], inApp: boolean): Promise<ActionResult & { config?: NotifyConfig }> {
  return request<ActionResult & { config?: NotifyConfig }>('POST', '/notify/config', { stakeholders, in_app: inApp });
}

export function sendTestAlert(stakeholder?: string): Promise<ActionResult & { results: NotificationEntry[] }> {
  return request<ActionResult & { results: NotificationEntry[] }>('POST', '/notify/test', { stakeholder });
}

export function sendWeeklyReport(): Promise<ActionResult & { results: NotificationEntry[] }> {
  return request<ActionResult & { results: NotificationEntry[] }>('POST', '/notify/report', {});
}

/** Opens the live stream and reconnects automatically. Returns an unsubscribe function. */
export function subscribeLab(
  onMessage: (msg: LabMessage) => void,
  onConnection: (state: AgentConnection) => void,
): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    onConnection('connecting');
    source = new EventSource(`${LAB_URL}/api/lab/stream`);
    source.onopen = () => onConnection('online');
    source.onmessage = (ev: MessageEvent) => {
      try {
        onMessage(JSON.parse(ev.data as string) as LabMessage);
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => {
      onConnection('offline');
      if (source) {
        source.close();
        source = null;
      }
      if (!closed) retry = setTimeout(connect, 2000);
    };
  };

  connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    if (source) source.close();
  };
}
