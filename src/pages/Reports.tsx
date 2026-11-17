import { useState } from 'react';
import { sendWeeklyReport } from '../api/lab';
import { attackName, dateTime, ms, secs } from '../lib/format';
import { inRange, rangeStats } from '../lib/derive';
import { RANGE_SECONDS, useFG } from '../state/store';
import { Icon } from '../ui/Icon';
import { Card, Empty, Notice, PageHead, Seg, SeverityBadge, Stat } from '../ui/parts';
import { RANGE_OPTIONS } from './Overview';

function mean(v: number[]): number | null {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function downloadCsv(rows: (string | number | null)[][], name: string) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const fg = useFG();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const secsRange = RANGE_SECONDS[fg.range];
  const list = inRange(fg.incidents, secsRange);
  const s = rangeStats(list);
  const eps = fg.episodes.filter((e) => e.ts >= Date.now() / 1000 - secsRange);
  const off = mean(eps.filter((e) => e.defence === 'off' && e.attack_ms !== null).map((e) => e.attack_ms as number));
  const prot = mean(eps.filter((e) => e.blocked && e.attack_ms !== null).map((e) => e.attack_ms as number));
  const base = mean(eps.filter((e) => e.baseline_ms !== null).map((e) => e.baseline_ms as number));
  const maxBar = Math.max(off ?? 0, prot ?? 0, base ?? 0, 1);

  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const i of list) {
    byType[attackName(i.kind)] = (byType[attackName(i.kind)] ?? 0) + 1;
    bySource[i.src_name] = (bySource[i.src_name] ?? 0) + 1;
  }
  const typeMax = Math.max(1, ...Object.values(byType));

  const exportCsv = () => downloadCsv([
    ['Incident', 'Detected', 'Severity', 'Type', 'Source', 'Source IP', 'Status', 'Time to block (s)', 'Response before (ms)', 'During (ms)', 'After (ms)', 'Drill'],
    ...list.map((i) => [i.id, new Date(i.opened * 1000).toISOString(), i.severity, attackName(i.kind), i.src_name, i.src, i.status,
      i.impact.detect_delay_s, i.impact.baseline_ms, i.impact.attack_ms, i.impact.after_ms, i.simulated ? 'yes' : 'no']),
  ], `flowguard-incidents-${fg.range}.csv`);

  const emailReport = async () => {
    setSending(true);
    try {
      const r = await sendWeeklyReport();
      setMsg({ ok: r.results.some((x) => x.status === 'sent'), text: r.results.length ? r.message : 'No stakeholder is set to receive the weekly report (Settings → Notifications).' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <PageHead title="Reports" sub={`Security summary for the last ${fg.range === '24h' ? '24 hours' : fg.range === '7d' ? '7 days' : '30 days'}.`}
        actions={
          <span className="row-wrap no-print">
            <Seg value={fg.range} onChange={fg.setRange} options={RANGE_OPTIONS} />
            <button className="btn" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} />CSV</button>
            <button className="btn" onClick={() => window.print()}><Icon name="printer" size={14} />Save PDF</button>
            <button className="btn btn-primary" onClick={emailReport} disabled={sending || fg.source === 'demo'}><Icon name="mail" size={14} />{sending ? 'Sending…' : 'Email report'}</button>
          </span>
        } />
      {msg && <div style={{ marginBottom: 16 }} className="no-print"><Notice tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Notice></div>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat icon="incidents" value={s.total} label="Incidents" foot={`${list.filter((i) => i.severity === 'critical').length} critical`} />
        <Stat icon="shieldCheck" tone="ok" value={s.blocked} label="Blocked automatically" foot={s.total ? `${Math.round((s.blocked / s.total) * 100)}% of incidents` : 'No incidents'} />
        <Stat icon="zap" value={s.medianDelay !== null ? s.medianDelay.toFixed(1) : '—'} unit={s.medianDelay !== null ? 's' : undefined} label="Median time to block" />
        <Stat icon="users" tone="violet" value={list.filter((i) => i.ack_at).length} label="Acknowledged by staff" foot={`${list.filter((i) => !i.ack_at).length} awaiting acknowledgement`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="What protection is worth" sub="Average response time for users during attacks">
          {off === null && prot === null ? (
            <Empty icon="reports" title="Not enough drills yet">Run one drill with protection off and one with it on to compare.</Empty>
          ) : (
            <div className="stack" style={{ gap: 18 }}>
              {[
                { label: 'Normal (no attack)', v: base, color: 'var(--faint)' },
                { label: 'Attack, protection off', v: off, color: 'var(--danger)' },
                { label: 'Attack, FlowGuard protecting', v: prot, color: 'var(--ok)' },
              ].map((r) => (
                <div key={r.label}>
                  <div className="between" style={{ marginBottom: 6, fontSize: 13 }}>
                    <span className="muted">{r.label}</span><b className="num">{ms(r.v)}</b>
                  </div>
                  <div className="bar" style={{ height: 10 }}><span style={{ width: `${r.v ? Math.max(2, (r.v / maxBar) * 100) : 0}%`, background: r.color }} /></div>
                </div>
              ))}
              {off !== null && prot !== null && (
                <div className="notice">Users saw responses <b>{Math.round(off / Math.max(prot, 0.1))}× faster</b> with FlowGuard protecting during an attack.</div>
              )}
            </div>
          )}
        </Card>
        <Card title="Incidents by type and source">
          {list.length === 0 ? <Empty title="No incidents in this period" /> : (
            <div className="stack" style={{ gap: 14 }}>
              {Object.entries(byType).map(([t, n]) => (
                <div key={t}>
                  <div className="between" style={{ fontSize: 13, marginBottom: 6 }}><span>{t}</span><span className="num muted">{n}</span></div>
                  <div className="bar"><span style={{ width: `${(n / typeMax) * 100}%` }} /></div>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Most frequent sources</div>
                {Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([src, n]) => (
                  <div key={src} className="between" style={{ fontSize: 13, padding: '4px 0' }}><span>{src}</span><span className="num muted">{n} incident{n === 1 ? '' : 's'}</span></div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Incident log" bodyClass="table-wrap">
        {list.length === 0 ? <Empty title="No incidents in this period" /> : (
          <table className="table">
            <thead><tr><th>Incident</th><th>Detected</th><th>Severity</th><th>Type</th><th>Source</th><th className="r">Time to block</th><th className="r">During attack</th></tr></thead>
            <tbody>
              {[...list].reverse().map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.id}</td>
                  <td className="muted">{dateTime(i.opened)}</td>
                  <td><SeverityBadge s={i.severity} /></td>
                  <td>{attackName(i.kind)}</td>
                  <td>{i.src_name}</td>
                  <td className="r num">{secs(i.impact.detect_delay_s)}</td>
                  <td className="r num">{ms(i.impact.attack_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
