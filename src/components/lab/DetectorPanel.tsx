// ─── ML detector: live scores per source + event feed ────────────────────
import { ShieldAlert } from 'lucide-react';
import type { LabDefence, LabDetectorWindow, LabEvent } from '../../api/labTypes';
import { fmtClock, roleOf } from './labUtils';

interface Props {
  detector: Record<string, LabDetectorWindow>;
  events: LabEvent[];
  defence: LabDefence;
  blocked: string[];
  latestTs: number | null;
  running: boolean;
}

const SOURCES = ['10.0.0.2', '10.0.0.1'];

const LEVEL_COLOR: Record<LabEvent['level'], string> = {
  info: 'var(--text-secondary)',
  ok: 'var(--green)',
  warn: 'var(--amber)',
  alert: 'var(--red)',
};

function chip(text: string, color: string, bg: string, border: string) {
  return (
    <span
      className="mono"
      style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, padding: '1px 7px', borderRadius: 4, color, background: bg, border: `1px solid ${border}`, whiteSpace: 'nowrap' }}
    >
      {text}
    </span>
  );
}

export default function DetectorPanel({ detector, events, defence, blocked, latestTs, running }: Props) {
  const defenceChip =
    defence === 'protect'
      ? chip('DETECT + BLOCK', 'var(--green)', 'var(--green-dim)', 'var(--green-border)')
      : defence === 'monitor'
      ? chip('DETECT ONLY', 'var(--amber)', 'var(--amber-dim)', 'var(--amber-border)')
      : chip('NO DEFENCE', 'var(--red)', 'var(--red-dim)', 'var(--red-border)');

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div className="section-title">
          <ShieldAlert size={14} />
          ML detector (Random Forest)
        </div>
        {defenceChip}
      </div>

      {SOURCES.map((src) => {
        const w = detector[src];
        const fresh = w !== undefined && latestTs !== null && latestTs - w.ts <= 3;
        const isBlocked = blocked.includes(src);
        const score = fresh && w ? w.score : 0;
        const attack = fresh && w ? w.verdict === 'attack' : false;
        const barColor = attack ? 'var(--red)' : 'var(--green)';
        return (
          <div key={src} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{roleOf(src)}</span>
                <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{src}</span>
              </div>
              {isBlocked
                ? chip('BLOCKED AT SWITCH', 'var(--red)', 'var(--red-dim)', 'var(--red-border)')
                : !running || defence === 'off'
                ? chip(defence === 'off' && running ? 'NOT SCORED' : 'IDLE', 'var(--text-muted)', 'transparent', 'var(--border-muted)')
                : !fresh
                ? chip('QUIET', 'var(--text-muted)', 'transparent', 'var(--border-muted)')
                : attack
                ? chip('ATTACK', 'var(--red)', 'var(--red-dim)', 'var(--red-border)')
                : chip('NORMAL', 'var(--green)', 'var(--green-dim)', 'var(--green-border)')}
            </div>
            <div style={{ position: 'relative', height: 8, background: 'var(--bg-inset)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${score * 100}%`, height: '100%', background: barColor, transition: 'width 0.3s' }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--text-secondary)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              <span>
                model score <b className="mono" style={{ color: 'var(--text-secondary)' }}>{fresh && w ? w.score.toFixed(2) : '\u2014'}</b>
                {' '}(threshold 0.50)
              </span>
              <span>
                <b className="mono" style={{ color: 'var(--text-secondary)' }}>{fresh && w ? w.pkts.toLocaleString() : 0}</b> pkts/s
              </span>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Event log</div>
      <div
        style={{
          background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: 8,
          padding: 8, height: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3,
        }}
      >
        {events.length === 0 && (
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>No events yet.</span>
        )}
        {events.map((e, i) => (
          <div key={`${e.ts}-${i}`} style={{ display: 'flex', gap: 8, fontSize: 'var(--text-2xs)', lineHeight: 1.4 }}>
            <span className="mono" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtClock(e.ts)}</span>
            <span style={{ color: LEVEL_COLOR[e.level] }}>{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
