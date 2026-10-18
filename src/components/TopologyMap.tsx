// ─── Network Topology Map ─────────────────────────────────────────────────
import { Network } from 'lucide-react';
import type { NetworkLink, NetworkNode } from '../types';

interface TopologyMapProps {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

// Design canvas dimensions (coordinate space for node positions)
const DW = 640;
const DH = 380;

/* ── Node visual config ─────────────────────────────────────────────────── */
const NODE_STYLE: Record<NetworkNode['type'], {
  color: string; bg: string; border: string; r: number;
}> = {
  client:  { color: 'var(--blue)',   bg: 'rgba(59,130,246,0.10)',  border: 'rgba(59,130,246,0.30)',  r: 22 },
  switch:  { color: 'var(--violet)', bg: 'rgba(129,140,248,0.10)', border: 'rgba(129,140,248,0.30)', r: 24 },
  proxy:   { color: 'var(--green)',  bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.40)',   r: 30 },
  backend: { color: 'var(--amber)',  bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.30)',  r: 22 },
};

const STATUS_COLOR: Record<NetworkNode['status'], string> = {
  active:   'var(--green)',
  inactive: 'var(--red)',
  warning:  'var(--amber)',
};

/* ── Link helpers ────────────────────────────────────────────────────────── */
function linkStroke(link: NetworkLink): string {
  if (!link.active) return 'var(--red)';
  if (link.packetLossPercent > 5 || link.delayMs > 15) return 'var(--amber)';
  return '#2a3a52';
}

function linkDash(link: NetworkLink): string {
  if (!link.active) return '5 4';
  if (link.packetLossPercent > 2) return '7 3';
  return '0';
}

function linkWidth(link: NetworkLink): number {
  if (!link.active) return 1;
  return link.bandwidthMbps >= 1000 ? 2 : 1.5;
}

/* ── Inline SVG node icons ───────────────────────────────────────────────── */
function NodeIcon({ type, color }: { type: NetworkNode['type']; color: string }) {
  switch (type) {
    case 'client':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <rect x="1" y="1.5" width="11" height="7.5" rx="1.5" />
          <line x1="3.5" y1="9" x2="3.5" y2="11.5" />
          <line x1="9.5" y1="9" x2="9.5" y2="11.5" />
          <line x1="2" y1="11.5" x2="11" y2="11.5" />
        </svg>
      );
    case 'switch':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <rect x="1" y="4" width="11" height="5" rx="1.5" />
          <circle cx="3" cy="6.5" r="0.8" fill={color} stroke="none" />
          <circle cx="6.5" cy="6.5" r="0.8" fill={color} stroke="none" />
          <circle cx="10" cy="6.5" r="0.8" fill={color} stroke="none" />
        </svg>
      );
    case 'proxy':
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke={color} strokeWidth="1.5">
          <path d="M7.5 2L13 5.25V9.75L7.5 13L2 9.75V5.25L7.5 2Z" />
          <circle cx="7.5" cy="7.5" r="2" />
        </svg>
      );
    case 'backend':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round">
          <rect x="1" y="1.5" width="11" height="3.5" rx="1" />
          <rect x="1" y="8" width="11" height="3.5" rx="1" />
          <circle cx="10" cy="3.25" r="0.7" fill={color} stroke="none" />
          <circle cx="10" cy="9.75" r="0.7" fill={color} stroke="none" />
        </svg>
      );
  }
}

/* ── Midpoint label for links involving the proxy ────────────────────────── */
function LinkLabel({ link, nodes }: { link: NetworkLink; nodes: NetworkNode[] }) {
  const src = nodes.find(n => n.id === link.source);
  const tgt = nodes.find(n => n.id === link.target);
  if (!src || !tgt) return null;

  const mx = (src.x + tgt.x) / 2;
  const my = (src.y + tgt.y) / 2;
  const text = link.active
    ? `${link.delayMs}ms · ${link.packetLossPercent.toFixed(1)}%loss`
    : 'LINK DOWN';
  const color = linkStroke(link);

  return (
    <g>
      <rect x={mx - 40} y={my - 9} width={80} height={16} rx={4}
        fill="var(--bg-elevated)" stroke={color} strokeWidth={0.5} opacity={0.92}
      />
      <text x={mx} y={my + 3.5} textAnchor="middle"
        fontSize={8} fill={color} fontFamily="var(--font-mono)">
        {text}
      </text>
    </g>
  );
}

/* ── Single topology node ────────────────────────────────────────────────── */
function TopoNode({ node }: { node: NetworkNode }) {
  const cfg = NODE_STYLE[node.type];
  const statusColor = STATUS_COLOR[node.status];
  const isProxy = node.type === 'proxy';

  return (
    <g transform={`translate(${node.x},${node.y})`} aria-label={`${node.label} — ${node.status}`}>
      {/* Extra glow ring for the proxy node */}
      {isProxy && (
        <circle r={cfg.r + 12} fill="rgba(34,197,94,0.05)" stroke="rgba(34,197,94,0.12)" strokeWidth={1} />
      )}
      {/* Status ring */}
      <circle r={cfg.r + 5} fill="none" stroke={statusColor} strokeWidth={1.5} opacity={0.35} />
      {/* Main node circle */}
      <circle r={cfg.r} fill={cfg.bg} stroke={cfg.border} strokeWidth={1.5} />
      {/* Status dot */}
      <circle r={3.5} cx={cfg.r - 2} cy={-(cfg.r - 2)} fill={statusColor} stroke="var(--bg-surface)" strokeWidth={2} />
      {/* Icon via foreignObject */}
      <foreignObject x={-7} y={-7} width={15} height={15}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <NodeIcon type={node.type} color={cfg.color} />
        </div>
      </foreignObject>
      {/* Label */}
      <text
        y={cfg.r + 14}
        textAnchor="middle"
        fontSize={9}
        fill="var(--text-secondary)"
        fontFamily="var(--font-sans)"
        fontWeight={500}
      >
        {node.label}
      </text>
    </g>
  );
}

/* ── Legend item ─────────────────────────────────────────────────────────── */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */
export default function TopologyMap({ nodes, links }: TopologyMapProps) {
  const proxyLinks = links.filter(l => l.source === 'proxy' || l.target === 'proxy');

  return (
    <section className="card" aria-label="Network topology" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-4)' }}>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 0 }}>
        <h2 className="section-title">
          <Network size={13} />
          Network Topology
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} aria-label="Legend">
          <LegendDot color="var(--green)" label="Active" />
          <LegendDot color="var(--amber)" label="Degraded" />
          <LegendDot color="var(--red)"   label="Down" />
        </div>
      </div>

      {/* SVG canvas */}
      <div style={{ flex: 1, minHeight: 200, position: 'relative' }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${DW} ${DH}`}
          aria-label="Network topology diagram"
          role="img"
          style={{ overflow: 'visible', display: 'block' }}
        >
          {/* Links */}
          {links.map((link, i) => {
            const src = nodes.find(n => n.id === link.source);
            const tgt = nodes.find(n => n.id === link.target);
            if (!src || !tgt) return null;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke={linkStroke(link)}
                strokeWidth={linkWidth(link)}
                strokeDasharray={linkDash(link)}
                opacity={link.active ? 0.65 : 0.35}
                style={{ transition: 'stroke 0.4s ease, opacity 0.4s ease' }}
              />
            );
          })}

          {/* Midpoint labels on proxy-adjacent links only */}
          {proxyLinks.map((link, i) => (
            <LinkLabel key={`lbl-${i}`} link={link} nodes={nodes} />
          ))}

          {/* Nodes (rendered last so they sit above links) */}
          {nodes.map(node => (
            <TopoNode key={node.id} node={node} />
          ))}
        </svg>
      </div>

      {/* Link status table */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Proxy Links
        </div>
        <div
          role="table"
          aria-label="Proxy link stats"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {links.filter(l => l.source === 'proxy').map((link, i) => {
            const tgt = nodes.find(n => n.id === link.target);
            const statusColor = link.active
              ? link.packetLossPercent > 2 ? 'var(--amber)' : 'var(--green)'
              : 'var(--red)';
            return (
              <div key={i} role="row" style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, flexShrink: 0 }} aria-hidden />
                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flex: 1 }}>
                  proxy → {tgt?.label}
                </span>
                <span className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  {link.bandwidthMbps}Mbps
                </span>
                <span className="mono" style={{
                  fontSize: 'var(--text-2xs)',
                  color: link.delayMs > 10 ? 'var(--amber)' : 'var(--text-muted)',
                }}>
                  {link.delayMs}ms
                </span>
                <span className="mono" style={{
                  fontSize: 'var(--text-2xs)',
                  color: link.packetLossPercent > 2 ? 'var(--red)' : 'var(--text-muted)',
                }}>
                  {link.packetLossPercent.toFixed(1)}%loss
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
