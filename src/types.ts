export type AlgorithmId =
  | "token-bucket"
  | "leaky-bucket"
  | "fixed-window"
  | "sliding-window";

export type RequestStatus = "allowed" | "throttled";

export interface RequestEvent {
  id: string;
  index: number;
  status: RequestStatus;
  timestamp: number;
  endpoint: string;
  method: string;
  retryAfter?: number; // seconds
  remaining?: number;
  limit?: number;
  reset?: number; // ms epoch
}

export interface AlgorithmConfig {
  capacity: number;
  refillRate: number; // tokens/sec (or equivalent leaks/window)
  requestsPerSecond: number;
}

export interface AlgorithmState {
  // Token bucket
  tokens?: number;
  lastRefill?: number;
  // Leaky bucket
  queue?: number;
  lastLeak?: number;
  // Fixed window
  windowStart?: number;
  windowCount?: number;
  // Sliding window log
  log?: number[];
}

export interface RateLimiterResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  reset: number;
  retryAfter: number;
}
