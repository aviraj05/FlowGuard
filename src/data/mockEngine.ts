// ─── Mock Data Engine ─────────────────────────────────────────────────────
// Generates realistic streaming data for demo/simulation purposes

import type {
  GlobalState,
  BackendServer,
  SecurityLogEntry,
  TrafficDataPoint,
  CacheMetrics,
  NetworkNode,
  NetworkLink,
} from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────
const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const uuid = () => Math.random().toString(36).slice(2, 10);

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const PATHS = [
  '/api/v1/users', '/api/v1/auth/token', '/api/v2/events',
  '/api/v1/metrics', '/health', '/api/v2/stream', '/api/v1/orders',
  '/static/bundle.js', '/api/v1/config', '/api/v2/analytics',
  '/api/v1/sessions', '/admin/dashboard', '/api/v1/webhooks',
];
const SUSPICIOUS_PATHS = [
  '/admin/../etc/passwd', '/api/v1/users?id=1 OR 1=1',
  '/wp-admin/setup-config.php', '/.env', '/api/v1/eval?expr=__import__',
  '/api/v2/users?__proto__[admin]=true', '/xmlrpc.php',
];
const IPS = [
  '10.0.0.2', '10.0.0.3', '10.0.0.4', '192.168.1.101',
  '172.16.0.55', '10.1.2.88', '203.0.113.42', '198.51.100.7',
];
const SUSPICIOUS_IPS = [
  '185.220.101.34', '194.165.16.77', '45.139.122.11',
  '91.108.4.12', '176.10.104.243',
];

function generateLogEntry(): SecurityLogEntry {
  const isSuspicious = Math.random() < 0.22;
  const isBlocked = isSuspicious && Math.random() < 0.45;
  const isRateLimited = !isBlocked && Math.random() < 0.1;
  const isFlagged = isSuspicious && !isBlocked;

  let action: SecurityLogEntry['action'] = 'allowed';
  if (isBlocked) action = 'blocked';
  else if (isRateLimited) action = 'rate-limited';
  else if (isFlagged) action = 'flagged';

  const entropyScore = isSuspicious ? rand(0.72, 0.98) : rand(0.1, 0.45);
  const dgaScore = isSuspicious ? rand(0.65, 0.97) : rand(0.02, 0.25);
  const sourceIp = isSuspicious ? pick(SUSPICIOUS_IPS) : pick(IPS);
  const path = isSuspicious ? pick(SUSPICIOUS_PATHS) : pick(PATHS);
  const method = isBlocked ? pick(['POST', 'GET', 'DELETE']) : pick(METHODS);
  const statusCode = isBlocked ? pick([403, 429, 400]) :
                     isRateLimited ? 429 :
                     isFlagged ? pick([200, 400, 500]) :
                     pick([200, 200, 200, 304, 201, 404, 500]);

  return {
    id: uuid(),
    timestamp: Date.now(),
    sourceIp,
    method,
    path,
    statusCode,
    entropyScore,
    dgaScore,
    action,
    byteSize: randInt(128, 65536),
    latencyMs: randInt(2, 850),
    reason: isBlocked ? pick(['payload entropy threshold exceeded', 'DGA pattern match', 'IP reputation block', 'SQLi signature detected']) :
            isRateLimited ? 'rate limit: 100 req/min exceeded' :
            isFlagged ? 'entropy anomaly detected' : undefined,
  };
}

export function generateInitialState(): GlobalState {
  const now = Date.now();

  const backends: BackendServer[] = [
    {
      id: 'backend-a',
      label: 'Backend A',
      ip: '10.0.0.10',
      port: 8001,
      status: 'healthy',
      latencyMs: 12,
      cpuPercent: 28,
      requestsPerSec: 142,
      errorRate: 0.2,
      weight: 3,
      manuallyFailed: false,
    },
    {
      id: 'backend-b',
      label: 'Backend B',
      ip: '10.0.0.11',
      port: 8002,
      status: 'healthy',
      latencyMs: 48,
      cpuPercent: 55,
      requestsPerSec: 98,
      errorRate: 1.1,
      weight: 2,
      manuallyFailed: false,
    },
    {
      id: 'backend-c',
      label: 'Backend C',
      ip: '10.0.0.12',
      port: 8003,
      status: 'degraded',
      latencyMs: 320,
      cpuPercent: 87,
      requestsPerSec: 34,
      errorRate: 8.4,
      weight: 1,
      manuallyFailed: false,
    },
  ];

  // Generate 60 historical data points (last 60 seconds)
  const trafficHistory: TrafficDataPoint[] = Array.from({ length: 60 }, (_, i) => ({
    timestamp: now - (59 - i) * 1000,
    backendA: randInt(110, 165),
    backendB: randInt(80, 120),
    backendC: randInt(20, 55),
    total: 0,
  })).map(p => ({ ...p, total: p.backendA + p.backendB + p.backendC }));

  const securityLog: SecurityLogEntry[] = Array.from({ length: 30 }, () => generateLogEntry())
    .map((e, i) => ({ ...e, timestamp: now - (30 - i) * 800 }))
    .sort((a, b) => b.timestamp - a.timestamp);

  const cacheMetrics: CacheMetrics = {
    hitRatio: 0.724,
    totalHits: 18_432,
    totalMisses: 7_014,
    bytesFromCache: 1_248_394_240,
    bytesFromBackend: 476_837_888,
    ttlExpirations: 843,
    totalEntries: 4_201,
    evictions: 127,
  };

  const networkNodes: NetworkNode[] = [
    { id: 'client-1', label: 'Client h1', type: 'client', x: 60, y: 130, status: 'active' },
    { id: 'client-2', label: 'Client h2', type: 'client', x: 60, y: 230, status: 'active' },
    { id: 'client-3', label: 'Client h3', type: 'client', x: 60, y: 330, status: 'active' },
    { id: 'switch',   label: 'Switch s1', type: 'switch',  x: 220, y: 230, status: 'active' },
    { id: 'proxy',    label: 'FlowGuard', type: 'proxy',   x: 390, y: 230, status: 'active' },
    { id: 'bk-a',    label: 'Backend A', type: 'backend',  x: 560, y: 130, status: 'active' },
    { id: 'bk-b',    label: 'Backend B', type: 'backend',  x: 560, y: 230, status: 'active' },
    { id: 'bk-c',    label: 'Backend C', type: 'backend',  x: 560, y: 330, status: 'warning' },
  ];

  const networkLinks: NetworkLink[] = [
    { source: 'client-1', target: 'switch',  bandwidthMbps: 100, delayMs: 1,  packetLossPercent: 0,   active: true },
    { source: 'client-2', target: 'switch',  bandwidthMbps: 100, delayMs: 1,  packetLossPercent: 0,   active: true },
    { source: 'client-3', target: 'switch',  bandwidthMbps: 100, delayMs: 2,  packetLossPercent: 0.1, active: true },
    { source: 'switch',   target: 'proxy',   bandwidthMbps: 1000,delayMs: 0,  packetLossPercent: 0,   active: true },
    { source: 'proxy',    target: 'bk-a',    bandwidthMbps: 1000,delayMs: 0,  packetLossPercent: 0,   active: true },
    { source: 'proxy',    target: 'bk-b',    bandwidthMbps: 1000,delayMs: 1,  packetLossPercent: 0,   active: true },
    { source: 'proxy',    target: 'bk-c',    bandwidthMbps: 100, delayMs: 18, packetLossPercent: 3.2, active: true },
  ];

  return {
    environment: 'mininet',
    clusterStatus: 'degraded',
    totalRequestsPerSec: 274,
    totalBytesProxied: 2_847_291_392,
    uptime: 287442,
    backends,
    trafficHistory,
    securityLog,
    cacheMetrics,
    networkNodes,
    networkLinks,
  };
}

// ── Live tick function ─────────────────────────────────────────────────────
export function tick(prev: GlobalState): GlobalState {
  const backends = prev.backends.map(b => {
    if (b.manuallyFailed) {
      return { ...b, status: 'down' as const, latencyMs: 0, cpuPercent: 0, requestsPerSec: 0 };
    }
    const drift = (v: number, min: number, max: number, step: number) =>
      Math.min(max, Math.max(min, v + rand(-step, step)));

    const newLatency = Math.round(drift(b.latencyMs, 3, 1200, 8));
    const newCpu = Math.min(99, Math.max(5, drift(b.cpuPercent, 5, 99, 3)));
    const newRps = Math.max(0, Math.round(drift(b.requestsPerSec, 0, 250, 10)));
    const newErr = Math.max(0, Math.min(30, drift(b.errorRate, 0, 30, 0.5)));

    let status: BackendServer['status'] = 'healthy';
    if (newLatency > 600 || newErr > 10 || newCpu > 90) status = 'degraded';
    if (newLatency > 1000 || newErr > 20 || newCpu > 97) status = 'down';

    return { ...b, latencyMs: newLatency, cpuPercent: newCpu, requestsPerSec: newRps, errorRate: newErr, status };
  });

  const activeBackends = backends.filter(b => b.status !== 'down');
  const newPoint: TrafficDataPoint = {
    timestamp: Date.now(),
    backendA: backends[0].status !== 'down' ? backends[0].requestsPerSec : 0,
    backendB: backends[1].status !== 'down' ? backends[1].requestsPerSec : 0,
    backendC: backends[2].status !== 'down' ? backends[2].requestsPerSec : 0,
    total: 0,
  };
  newPoint.total = newPoint.backendA + newPoint.backendB + newPoint.backendC;

  const trafficHistory = [...prev.trafficHistory.slice(-59), newPoint];

  // Inject 0-3 new log entries per tick
  const newEntries = Array.from({ length: randInt(0, 3) }, generateLogEntry);
  const securityLog = [...newEntries, ...prev.securityLog].slice(0, 200);

  // Update cache metrics
  const hitDelta = randInt(10, 80);
  const missDelta = randInt(3, 30);
  const cacheMetrics: CacheMetrics = {
    ...prev.cacheMetrics,
    totalHits: prev.cacheMetrics.totalHits + hitDelta,
    totalMisses: prev.cacheMetrics.totalMisses + missDelta,
    bytesFromCache: prev.cacheMetrics.bytesFromCache + hitDelta * randInt(512, 8192),
    bytesFromBackend: prev.cacheMetrics.bytesFromBackend + missDelta * randInt(512, 8192),
    ttlExpirations: prev.cacheMetrics.ttlExpirations + (Math.random() < 0.15 ? 1 : 0),
    evictions: prev.cacheMetrics.evictions + (Math.random() < 0.05 ? 1 : 0),
    hitRatio: 0,
  };
  const total = cacheMetrics.totalHits + cacheMetrics.totalMisses;
  cacheMetrics.hitRatio = total > 0 ? cacheMetrics.totalHits / total : 0;

  // Update network links
  const networkLinks = prev.networkLinks.map(link => {
    const targetBackend = backends.find(b =>
      (b.id === 'backend-a' && link.target === 'bk-a') ||
      (b.id === 'backend-b' && link.target === 'bk-b') ||
      (b.id === 'backend-c' && link.target === 'bk-c')
    );
    if (targetBackend) {
      return {
        ...link,
        active: targetBackend.status !== 'down',
        packetLossPercent: Math.max(0, Math.min(20, link.packetLossPercent + rand(-0.5, 0.5))),
        delayMs: Math.max(0, Math.round(link.delayMs + rand(-1, 1))),
      };
    }
    return link;
  });

  // Update network node statuses
  const networkNodes = prev.networkNodes.map(node => {
    const backendMap: Record<string, string> = { 'bk-a': 'backend-a', 'bk-b': 'backend-b', 'bk-c': 'backend-c' };
    const backendId = backendMap[node.id];
    if (backendId) {
      const b = backends.find(b => b.id === backendId);
      return { ...node, status: b?.status === 'down' ? 'inactive' : b?.status === 'degraded' ? 'warning' : 'active' } as NetworkNode;
    }
    return node;
  });

  const downCount = backends.filter(b => b.status === 'down').length;
  const degradedCount = backends.filter(b => b.status === 'degraded').length;
  const clusterStatus = downCount >= 2 ? 'outage' : downCount >= 1 || degradedCount >= 2 ? 'degraded' : 'operational';

  return {
    ...prev,
    backends,
    trafficHistory,
    securityLog,
    cacheMetrics,
    networkLinks,
    networkNodes,
    clusterStatus,
    totalRequestsPerSec: newPoint.total,
    totalBytesProxied: prev.totalBytesProxied + newPoint.total * randInt(512, 4096),
    uptime: prev.uptime + 1,
    activeBackends,
  } as GlobalState & { activeBackends: BackendServer[] };
}

export { generateLogEntry };
