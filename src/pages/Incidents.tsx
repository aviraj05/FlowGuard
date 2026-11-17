import { useState } from 'react';
import type { Severity } from '../api/labTypes';
import { attackName, dateTime, duration, secs } from '../lib/format';
import { inRange } from '../lib/derive';
import { navigate } from '../lib/router';
import { RANGE_SECONDS, useFG } from '../state/store';
import { Icon } from '../ui/Icon';
import { Card, Empty, IncidentStatusLabel, PageHead, Seg, SeverityBadge } from '../ui/parts';
import { RANGE_OPTIONS } from './Overview';

type StatusFilter = 'all' | 'open' | 'resolved';
type SevFilter = 'all' | Severity;

export default function Incidents() {
  const fg = useFG();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sev, setSev] = useState<SevFilter>('all');

  const list = [...inRange(fg.incidents, RANGE_SECONDS[fg.range])]
    .reverse()
    .filter((i) => (status === 'all' ? true : status === 'open' ? i.status !== 'resolved' : i.status === 'resolved'))
    .filter((i) => (sev === 'all' ? true : i.severity === sev));

  return (
    <div className="page">
      <PageHead title="Incidents" sub="Every attack FlowGuard has detected, what it did about it, and who was told."
        actions={<Seg value={fg.range} onChange={fg.setRange} options={RANGE_OPTIONS} />} />

      <div className="row-wrap" style={{ marginBottom: 16 }}>
        <Seg value={status} onChange={setStatus} options={[
          { value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' },
        ]} />
        <Seg value={sev} onChange={setSev} options={[
          { value: 'all', label: 'Any severity' }, { value: 'critical', label: 'Critical' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' },
        ]} />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{list.length} incident{list.length === 1 ? '' : 's'}</span>
      </div>

      <Card bodyClass="table-wrap">
        {list.length === 0 ? (
          <Empty title="No incidents match">Try a wider time range, or run a drill to see FlowGuard in action.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Incident</th>
                <th className="hide-sm">Status</th>
                <th className="hide-sm">Time to block</th>
                <th className="hide-sm">Detected</th>
                <th className="r hide-sm">Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => navigate(`/incidents/${i.id}`)}>
                  <td><SeverityBadge s={i.severity} /></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{attackName(i.kind)} {i.blocked_at ? 'blocked' : 'detected'} from {i.src_name}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      <span className="mono">{i.id}</span> · {i.src} → {i.target_name}{i.simulated ? ' · drill' : ''}
                    </div>
                  </td>
                  <td className="hide-sm"><IncidentStatusLabel inc={i} /></td>
                  <td className="hide-sm num">{secs(i.impact.detect_delay_s)}</td>
                  <td className="hide-sm muted">{dateTime(i.opened)}</td>
                  <td className="r hide-sm num muted">{duration(i.attack_started ?? i.opened, i.resolved_at)}</td>
                  <td className="r"><Icon name="chevronRight" size={16} className="faint" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
