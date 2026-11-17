/** "Monitoring is not running" card + start control, used on Overview and Drills. */
import { useState } from 'react';
import { useFG } from '../state/store';
import { Icon } from './Icon';
import { Notice, Seg } from './parts';

export function StartMonitoring({ compact = false }: { compact?: boolean }) {
  const fg = useFG();
  const realReady = !!fg.health && fg.health.root && fg.health.mininet && fg.health.haproxy && fg.health.hping3 && fg.health.model;
  const [mode, setMode] = useState<'real' | 'sim'>(fg.health && !fg.health.default_simulate && realReady ? 'real' : 'sim');

  if (fg.source === 'demo' || fg.agent !== 'online') {
    return (
      <div className="banner banner-muted">
        <div className="banner-icon"><Icon name="info" size={20} /></div>
        <div>
          <div className="banner-title">Showing demo data: the FlowGuard agent is not connected</div>
          <div className="banner-text">
            Start it in the VM with <span className="mono">sudo python3 lab_agent.py</span> (or <span className="mono">python3 lab_agent.py --simulate</span>) and forward port 8765.
          </div>
        </div>
      </div>
    );
  }

  const missing = fg.health
    ? (['root', 'mininet', 'haproxy', 'hping3', 'model'] as const).filter((k) => !fg.health![k])
    : [];

  return (
    <div className="banner banner-warn">
      <div className="banner-icon"><Icon name="shield" size={20} /></div>
      <div>
        <div className="banner-title">Monitoring is paused</div>
        <div className="banner-text">
          {compact ? 'Start the network session to watch traffic and run drills.' :
            'Start a monitoring session: FlowGuard brings up the network, the load balancer and the detector.'}
        </div>
        {mode === 'real' && missing.length > 0 && (
          <div className="banner-text warn">Real network not ready (missing: {missing.join(', ')}). Use simulated mode.</div>
        )}
      </div>
      <div className="spacer" />
      <Seg value={mode} onChange={setMode} options={[{ value: 'real', label: 'Real network' }, { value: 'sim', label: 'Simulated' }]} />
      <button className="btn btn-primary" disabled={fg.busy || (mode === 'real' && !realReady)}
        onClick={() => fg.start({ algo: 'leastconn', defence: 'protect', uplink: 10, slow: false, simulate: mode === 'sim' })}>
        <Icon name="play" size={14} /> Start monitoring
      </button>
    </div>
  );
}

export function ErrorNotice() {
  const fg = useFG();
  if (!fg.error) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Notice tone="danger">
        <div className="between">
          <span>{fg.error}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => fg.setError(null)}><Icon name="x" size={14} /></button>
        </div>
      </Notice>
    </div>
  );
}
