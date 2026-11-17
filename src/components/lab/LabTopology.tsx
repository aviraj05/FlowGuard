// ─── Live topology: traffic flow, attack and block, per-server load ───────
import { Network } from 'lucide-react';
import type { LabAlgo, LabDefence } from '../../api/labTypes';
import { ALGO_LABEL, BACKEND_COLORS, BACKEND_NAMES } from './labUtils';

interface Props {
  running: boolean;
  attack: boolean;
  blocked: boolean;
  uplink: number;
  algo: LabAlgo;
  slow: boolean;
  defence: LabDefence;
  shares: number[]; // 0..1 per back-end
}

interface Node { id: string; x: number; y: number; label: string; sub: string; color: string }

const NODES: Node[] = [
  { id: 'client', x: 70, y: 70, label: 'client', sub: '10.0.0.1', color: '#3b82f6' },
  { id: 'attacker', x: 70, y: 250, label: 'attacker', sub: '10.0.0.2', color: '#ef4444' },
  { id: 's1', x: 235, y: 160, label: 's1 switch', sub: 'Open vSwitch', color: '#818cf8' },
  { id: 'lb', x: 405, y: 160, label: 'HAProxy', sub: '10.0.0.10', color: '#22c55e' },
  { id: 'srv1', x: 580, y: 70, label: 'srv1', sub: '10.0.0.11', color: BACKEND_COLORS[0] },
  { id: 'srv2', x: 580, y: 160, label: 'srv2', sub: '10.0.0.12', color: BACKEND_COLORS[1] },
  { id: 'srv3', x: 580, y: 250, label: 'srv3', sub: '10.0.0.13', color: BACKEND_COLORS[2] },
];

function pos(id: string): Node {
  const n = NODES.find((x) => x.id === id);
  return n ? n : NODES[0];
}

export default function LabTopology({ running, attack, blocked, uplink, algo, slow, defence, shares }: Props) {
  const saturated = attack && !blocked && uplink <= 20;
  const attackFlows = attack && !blocked;

  const link = (a: string, b: string, color: string, animated: boolean, width = 2, dim = false) => {
    const A = pos(a);
    const B = pos(b);
    return (
      <line
        key={`${a}-${b}`}
        x1={A.x} y1={A.y} x2={B.x} y2={B.y}
        stroke={color}
        strokeWidth={width}
        opacity={dim ? 0.25 : 0.9}
        className={animated ? 'labflow' : undefined}
        strokeDasharray={animated ? undefined : dim ? '4 5' : undefined}
      />
    );
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="section-header">
        <div className="section-title">
          <Network size={14} />
          Emulated network (Mininet)
        </div>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
          {running ? 'live' : 'lab stopped'}
        </span>
      </div>
      <svg viewBox="0 0 660 320" style={{ width: '100%', height: 'auto' }} role="img" aria-label="Network topology">
        <style>{`@keyframes labflow { to { stroke-dashoffset: -24; } } .labflow { stroke-dasharray: 6 6; animation: labflow 0.8s linear infinite; }`}</style>

        {link('client', 's1', running ? '#3b82f6' : '#22304a', running, 2)}
        {link('attacker', 's1', attackFlows ? '#ef4444' : '#22304a', attackFlows, attackFlows ? 3 : 2, !attackFlows)}
        {link('s1', 'lb', saturated ? '#ef4444' : running ? '#22c55e' : '#22304a', running, saturated ? 4 : 2.5)}
        {BACKEND_NAMES.map((n, i) => link('lb', n, running ? BACKEND_COLORS[i] : '#22304a', running && shares[i] > 0.02, 1 + (shares[i] || 0) * 6))}

        <text x={320} y={128} textAnchor="middle" fontSize={10} fill={saturated ? '#ef4444' : '#8899b4'} fontWeight={saturated ? 700 : 400}>
          {saturated ? `LINK SATURATED (${uplink} Mbit/s)` : `uplink ${uplink} Mbit/s`}
        </text>

        {NODES.map((n) => {
          const isAttacker = n.id === 'attacker';
          const stroke = isAttacker && attackFlows ? '#ef4444' : n.color;
          return (
            <g key={n.id}>
              <rect
                x={n.x - 48} y={n.y - 22} width={96} height={44} rx={8}
                fill="#141c2e"
                stroke={stroke}
                strokeWidth={isAttacker && attackFlows ? 2.5 : 1.5}
                opacity={running || n.id === 'attacker' ? 1 : 0.6}
              />
              <text x={n.x} y={n.y - 2} textAnchor="middle" fontSize={12} fontWeight={700} fill="#e8edf5">{n.label}</text>
              <text x={n.x} y={n.y + 13} textAnchor="middle" fontSize={9} fill="#8899b4">{n.sub}</text>
            </g>
          );
        })}

        {/* algorithm label on the load balancer */}
        <text x={405} y={198} textAnchor="middle" fontSize={10} fill="#22c55e" fontWeight={600}>{ALGO_LABEL[algo]}</text>

        {/* slow badge on srv1 */}
        {slow && (
          <g>
            <rect x={604} y={36} width={52} height={16} rx={4} fill="rgba(245,158,11,0.15)" stroke="#f59e0b" />
            <text x={630} y={48} textAnchor="middle" fontSize={9} fontWeight={700} fill="#f59e0b">+100 ms</text>
          </g>
        )}

        {/* attacker state */}
        {attackFlows && (
          <text x={70} y={290} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ef4444">FLOODING</text>
        )}
        {blocked && (
          <g>
            <circle cx={150} cy={205} r={14} fill="rgba(239,68,68,0.18)" stroke="#ef4444" strokeWidth={2} />
            <path d="M143 198 L157 212 M157 198 L143 212" stroke="#ef4444" strokeWidth={2.5} />
            <text x={150} y={236} textAnchor="middle" fontSize={10} fontWeight={700} fill="#ef4444">DROP RULE</text>
            <text x={150} y={248} textAnchor="middle" fontSize={9} fill="#ef4444">installed on s1</text>
          </g>
        )}

        {/* defence badge on the switch */}
        <text x={235} y={198} textAnchor="middle" fontSize={9} fill={defence === 'protect' ? '#22c55e' : defence === 'monitor' ? '#f59e0b' : '#4a5a72'} fontWeight={600}>
          {defence === 'protect' ? 'ML defence: ACTIVE' : defence === 'monitor' ? 'ML defence: DETECT ONLY' : 'ML defence: OFF'}
        </text>
      </svg>
    </div>
  );
}
