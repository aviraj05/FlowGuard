import type { ReactNode } from 'react';
import type { Incident, IncidentStatus, Severity } from '../api/labTypes';
import { SEVERITY_LABEL } from '../lib/format';
import { href } from '../lib/router';
import type { DataSource } from '../state/store';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export function Card({ title, sub, action, children, className = '', bodyClass = 'card-body' }: {
  title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function CardLink({ to, children = 'View all' }: { to: string; children?: ReactNode }) {
  return (
    <a className="card-link" href={href(to)}>
      {children} <Icon name="arrowRight" size={14} />
    </a>
  );
}

export function Stat({ icon, tone, value, unit, label, foot }: {
  icon: IconName; tone?: 'ok' | 'danger' | 'violet'; value: ReactNode; unit?: string; label: string; foot?: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className={`stat-icon ${tone ?? ''}`}><Icon name={icon} size={18} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-value">{value}{unit && <small>{unit}</small>}</div>
        <div className="stat-label">{label}</div>
        {foot && <div className="stat-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`sev sev-${s}`}>{SEVERITY_LABEL[s]}</span>;
}

const STATUS_META: Record<IncidentStatus, { label: string; dot: string }> = {
  active: { label: 'Active · not blocked', dot: 'dot-danger' },
  contained: { label: 'Contained · blocked', dot: 'dot-warn' },
  resolved: { label: 'Resolved', dot: 'dot-muted' },
};

export function IncidentStatusLabel({ inc }: { inc: Incident }) {
  const m = STATUS_META[inc.status];
  return (
    <span className="status">
      <span className={`dot ${m.dot}`} />
      {inc.false_positive ? 'False positive' : m.label}
    </span>
  );
}

export function SourceTag({ source }: { source: DataSource }) {
  if (source === 'live') return <span className="tag tag-live"><span className="dot dot-ok" />Live</span>;
  if (source === 'simulated') return <span className="tag tag-sim">Simulated</span>;
  if (source === 'demo') return <span className="tag tag-demo">Demo data</span>;
  return <span className="tag">Connecting…</span>;
}

export function Seg<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} disabled={disabled}
          aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className={`check ${on ? 'on' : ''}`} onClick={() => onChange(!on)} disabled={disabled}
      aria-pressed={on} aria-label={label}>
      {on && <Icon name="check" size={12} strokeWidth={3} />}
    </button>
  );
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} disabled={disabled} aria-pressed={on} aria-label={label} />;
}

export function Empty({ icon = 'shieldCheck', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={20} /></div>
      <div className="empty-title">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}

export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <a className="back-link" href={href(back.to)}><Icon name="chevronLeft" size={14} />{back.label}</a>
        )}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

export function Notice({ tone, children }: { tone?: 'danger' | 'ok'; children: ReactNode }) {
  return <div className={`notice ${tone ? `notice-${tone}` : ''}`}>{children}</div>;
}
