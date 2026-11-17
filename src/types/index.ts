// ─── Core Data Types ────────────────────────────────────────────────────────

export type BackendStatus = 'healthy' | 'degraded' | 'down';
export type Environment = 'mininet' | 'production';
export type ClusterStatus = 'operational' | 'degraded' | 'outage';

export interface BackendServer {
  id: string;
  label: string;
  ip: string;
  port: number;
  status: BackendStatus;
  latencyMs: number;
  cpuPercent: number;
  requestsPerSec: number;
  errorRate: number;
  weight: number;
  manuallyFailed: boolean;
}

export interface TrafficDataPoint {
  timestamp: number;
  backendA: number;
  backendB: number;
  backendC: number;
  total: number;
}

export type AppMode = 'demo' | 'live';

export interface SecurityLogEntry {
  id: string;
  timestamp: number;
  sourceIp: string;
  method: string;
  path: string;
  statusCode: number;
  entropyScore: number;
  dgaScore: number;
  action: 'allowed' | 'rate-limited' | 'blocked' | 'flagged' | 'alerted';
  byteSize: number;
  latencyMs: number;
  reason?: string;
  // Real model decision fields:
  label?: number;
  labelName?: string;
  riskScore?: number;
  protocol?: string;
  service?: string;
  dstIp?: string;
  sourceType?: 'demo' | 'replay' | 'api' | 'batch' | 'mininet_capture';
}

export interface CacheMetrics {
  hitRatio: number;
  totalHits: number;
  totalMisses: number;
  bytesFromCache: number;
  bytesFromBackend: number;
  ttlExpirations: number;
  totalEntries: number;
  evictions: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  bandwidthMbps: number;
  delayMs: number;
  packetLossPercent: number;
  active: boolean;
}

export interface NetworkNode {
  id: string;
  label: string;
  type: 'client' | 'switch' | 'proxy' | 'backend';
  x: number;
  y: number;
  status: 'active' | 'inactive' | 'warning';
}

export interface GlobalState {
  environment: Environment;
  clusterStatus: ClusterStatus;
  totalRequestsPerSec: number;
  totalBytesProxied: number;
  uptime: number; // seconds
  backends: BackendServer[];
  trafficHistory: TrafficDataPoint[];
  securityLog: SecurityLogEntry[];
  cacheMetrics: CacheMetrics;
  networkNodes: NetworkNode[];
  networkLinks: NetworkLink[];
}
