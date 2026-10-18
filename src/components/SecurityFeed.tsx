// ─── Security Feed ────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Pause, Play, ShieldAlert } from 'lucide-react';
import type { SecurityLogEntry } from '../types';
import { formatTimestamp, scoreColor } from '../utils/helpers';

interface SecurityFeedProps {
  entries: SecurityLogEntry[];
}

type FilterType = 'all' | SecurityLogEntry['action'];

const ACTION_CONFIG = {
  allowed: {
    label: 'PASS',
    color: 'var(--green)',
    bg: 'var(--green-dim)',
    Icon: CheckCircle2,
    rowClass: 'log-allowed',
  },
  flagged: {
    label: 'FLAG',
    color: 'var(--amber)',
    bg: 'var(--amber-dim)',
    Icon: AlertTriangle,
    rowClass: 'log-flagged',
  },
  blocked: {
    label: 'BLOCK',
    color: 'var(--red)',
    bg: 'var(--red-dim)',
    Icon: Ban,
    rowClass: 'log-blocked',
  },
  'rate-limited': {
    label: 'LIMIT',
    color: 'var(--violet)',
    bg: 'var(--violet-dim)',
    Icon: ShieldAlert,
    rowClass: 'log-rate-limited',
  },
} as const;

const HTTP_STATUS_COLOR = (code: number): string => {
  if (code >= 500) return 'var(--red)';
  if (code >= 400) return 'var(--amber)';
  return 'var(--green)';
};

function ScoreChip({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 'var(--text-2xs)', fontWeight: 600, color,
          padding: '0 4px', borderRadius: 3,
          background: `${color}18`, border: `1px solid ${color}28`,
        }}
      >
        {score.toFixed(2)}
      </span>
    </span>
  );
}

function LogRow({ entry, isNew }: { entry: SecurityLogEntry; isNew: boolean }) {
  const isRealFlow = entry.sourceType && entry.sourceType !== 'demo';
  const cfg = ACTION_CONFIG[entry.action] || ACTION_CONFIG.allowed;
  const { Icon } = cfg;

  if (isRealFlow) {
    const isAttack = entry.label === 1 || entry.labelName === 'ATTACK';
    const badgeColor = isAttack ? 'var(--red)' : 'var(--green)';
    const badgeBg = isAttack ? 'var(--red-dim)' : 'var(--green-dim)';
    const risk = entry.riskScore ?? (isAttack ? 1.0 : 0.0);

    return (
      <div
        className={`log-row ${isAttack ? 'log-blocked' : 'log-allowed'} ${isNew ? 'log-entry-new' : ''}`}
        style={{ background: isNew ? badgeBg : undefined }}
        role="row"
      >
        {/* Primary row: model decision · endpoints · proto/service · timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <span
            aria-label={`Model Decision: ${entry.labelName || (isAttack ? 'ATTACK' : 'NORMAL')}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 6px', borderRadius: 3,
              background: badgeBg,
              flexShrink: 0,
            }}
          >
            <Icon size={8} color={badgeColor} strokeWidth={2.5} aria-hidden />
            <span className="mono" style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: badgeColor, letterSpacing: '0.04em' }}>
              {entry.labelName || (isAttack ? 'ATTACK' : 'NORMAL')}
            </span>
          </span>

          {/* Source IP -> Destination */}
          <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', flexShrink: 0 }}>
            {entry.sourceIp} → {entry.dstIp || '10.0.0.1'}
          </span>

          {/* Protocol / Service */}
          <span
            className="mono"
            style={{
              fontSize: 'var(--text-2xs)', fontWeight: 600,
              color: 'var(--text-muted)',
              padding: '0 4px', borderRadius: 3,
              background: 'var(--border-subtle)',
              flexShrink: 0,
            }}
          >
            {(entry.protocol || 'TCP').toUpperCase()} / {(entry.service || 'RAW').toUpperCase()}
          </span>

          {/* Model tag */}
          <span
            className="mono"
            style={{
              fontSize: 'var(--text-2xs)', color: 'var(--blue)',
              padding: '0 4px', borderRadius: 3,
              background: 'var(--blue-dim)',
              flexShrink: 0,
            }}
          >
            DT-90
          </span>

          {/* Timestamp */}
          <span
            className="mono"
            style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', marginLeft: 'auto', flexShrink: 0 }}
          >
            {formatTimestamp(entry.timestamp)}
          </span>
        </div>

        {/* Secondary row: Risk score + Source type + Schema note */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2, flexWrap: 'wrap' }}>
          <ScoreChip label="Risk" score={risk} />
          <span
            className="mono"
            style={{
              fontSize: 'var(--text-2xs)', color: 'var(--text-muted)',
              padding: '0 4px', borderRadius: 3,
              background: 'var(--border-subtle)',
            }}
          >
            SRC: {entry.sourceType?.toUpperCase()}
          </span>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Entropy/DGA: N/A (Flow model uses 90 network features)
          </span>
          {entry.reason && (
            <span style={{ fontSize: 'var(--text-2xs)', color: badgeColor, opacity: 0.8, fontStyle: 'italic' }}>
              {entry.reason}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`log-row ${cfg.rowClass} ${isNew ? 'log-entry-new' : ''}`}
      style={{ background: isNew ? cfg.bg : undefined }}
      role="row"
    >
      {/* Primary row: action badge · IP · method · path · status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        {/* Action badge */}
        <span
          aria-label={`Action: ${cfg.label}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 6px', borderRadius: 3,
            background: cfg.bg,
            flexShrink: 0,
          }}
        >
          <Icon size={8} color={cfg.color} strokeWidth={2.5} aria-hidden />
          <span className="mono" style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: cfg.color, letterSpacing: '0.04em' }}>
            {cfg.label}
          </span>
        </span>

        {/* Source IP */}
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {entry.sourceIp}
        </span>

        {/* HTTP method */}
        <span
          className="mono"
          style={{
            fontSize: 'var(--text-2xs)', fontWeight: 600,
            color: 'var(--text-muted)',
            padding: '0 4px', borderRadius: 3,
            background: 'var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          {entry.method}
        </span>

        {/* Path */}
        <span
          className="mono"
          style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={entry.path}
        >
          {entry.path}
        </span>

        {/* HTTP status code */}
        <span
          className="mono"
          style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: HTTP_STATUS_COLOR(entry.statusCode), flexShrink: 0 }}
        >
          {entry.statusCode}
        </span>

        {/* Timestamp */}
        <span
          className="mono"
          style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)', flexShrink: 0 }}
        >
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>

      {/* Secondary row: scores + size + reason */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 }}>
        <ScoreChip label="Ent" score={entry.entropyScore} />
        <ScoreChip label="DGA" score={entry.dgaScore} />
        <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-dim)' }}>
          {entry.latencyMs}ms · {(entry.byteSize / 1024).toFixed(1)}KB
        </span>
        {entry.reason && (
          <span style={{ fontSize: 'var(--text-2xs)', color: cfg.color, opacity: 0.7, fontStyle: 'italic', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.reason}
          </span>
        )}
      </div>
    </div>
  );
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'blocked',      label: 'Blocked' },
  { key: 'flagged',      label: 'Flagged' },
  { key: 'rate-limited', label: 'Limited' },
];

export default function SecurityFeed({ entries }: SecurityFeedProps) {
  const [filter, setFilter]         = useState<FilterType>('all');
  const [newIds, setNewIds]         = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const prevIds    = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentIds = new Set(entries.map(e => e.id));
    const added = new Set<string>();
    currentIds.forEach(id => { if (!prevIds.current.has(id)) added.add(id); });

    if (added.size > 0) {
      setNewIds(added);
      setTimeout(() => setNewIds(new Set()), 2000);
      if (autoScroll && containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    }
    prevIds.current = currentIds;
  }, [entries, autoScroll]);

  const filtered = filter === 'all' ? entries : entries.filter(e => e.action === filter);

  const counts: Record<FilterType, number> = {
    all:           entries.length,
    allowed:       entries.filter(e => e.action === 'allowed').length,
    blocked:       entries.filter(e => e.action === 'blocked').length,
    flagged:       entries.filter(e => e.action === 'flagged').length,
    'rate-limited': entries.filter(e => e.action === 'rate-limited').length,
  };

  return (
    <section className="card" aria-label="Security feed" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div className="section-header">
        <h2 className="section-title">
          <ShieldAlert size={13} />
          Anomaly &amp; Security Feed
          {/* LIVE badge — minimal, no pill */}
          <span aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <span className="pulse-dot healthy" />
            <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--green)', letterSpacing: '0.06em' }}>LIVE</span>
          </span>
        </h2>

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll(v => !v)}
          className={autoScroll ? 'btn btn-success' : 'btn btn-ghost'}
          aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume live feed'}
          title={autoScroll ? 'Pause auto-scroll' : 'Resume live feed'}
        >
          {autoScroll
            ? <><Pause size={10} /> Pause</>
            : <><Play  size={10} /> Live</>
          }
        </button>
      </div>

      {/* Filter row */}
      <div
        role="tablist"
        aria-label="Filter security events"
        style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}
      >
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            id={`filter-${key}`}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={`filter-tab ${filter === key ? 'active' : ''}`}
          >
            {label}
            <span className="tab-count">{counts[key] ?? entries.length}</span>
          </button>
        ))}
      </div>

      {/* Log stream */}
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        aria-label="Security log entries"
        style={{
          flex: 1,
          overflowY: 'auto',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-inset)',
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
            No entries for this filter
          </div>
        ) : (
          filtered.map(entry => (
            <LogRow key={entry.id} entry={entry} isNew={newIds.has(entry.id)} />
          ))
        )}
      </div>
    </section>
  );
}
