import type { AlgorithmId, RateLimiterResult } from "../types";

export interface RateLimiterLike {
  hit: (now?: number) => RateLimiterResult;
  refill?: (now?: number) => void;
  getTokens: () => number;
  getQueue?: () => number;
  reset: () => void;
}

// Token Bucket: capacity tokens, refill r tokens/sec, each call consumes 1.
export function createTokenBucket(capacity: number, refillRate: number): RateLimiterLike {
  let tokens = capacity;
  let lastRefill = Date.now();

  const refill = (now: number = Date.now()) => {
    const delta = (now - lastRefill) / 1000;
    tokens = Math.min(capacity, tokens + delta * refillRate);
    lastRefill = now;
  };

  return {
    refill,
    getTokens: () => tokens,
    reset: () => {
      tokens = capacity;
      lastRefill = Date.now();
    },
    hit: (now: number = Date.now()) => {
      refill(now);
      const resetSec = Math.ceil((capacity - tokens) / Math.max(refillRate, 0.0001));
      if (tokens >= 1) {
        tokens -= 1;
        return {
          allowed: true,
          remaining: Math.floor(tokens),
          limit: capacity,
          reset: Math.ceil((capacity - tokens) / Math.max(refillRate, 0.0001)),
          retryAfter: 0,
        };
      }
      return {
        allowed: false,
        remaining: 0,
        limit: capacity,
        reset: resetSec,
        retryAfter: Math.max(1, resetSec),
      };
    },
  };
}

// Leaky Bucket: queue up to capacity, leak at refillRate per second.
export function createLeakyBucket(capacity: number, leakRate: number): RateLimiterLike {
  let queue = 0;
  let lastLeak = Date.now();

  const leak = (now: number = Date.now()) => {
    const delta = (now - lastLeak) / 1000;
    queue = Math.max(0, queue - delta * leakRate);
    lastLeak = now;
  };

  return {
    refill: leak,
    getTokens: () => capacity - queue, // "available slots"
    getQueue: () => queue,
    reset: () => {
      queue = 0;
      lastLeak = Date.now();
    },
    hit: (now: number = Date.now()) => {
      leak(now);
      const roundedQueue = Math.floor(queue + 1);
      if (queue + 1 <= capacity) {
        queue += 1;
        return {
          allowed: true,
          remaining: capacity - Math.ceil(queue),
          limit: capacity,
          reset: Math.ceil(queue / Math.max(leakRate, 0.0001)),
          retryAfter: 0,
        };
      }
      // queue full -> throttled
      const retryAfter = Math.max(1, Math.ceil((roundedQueue - capacity + 1) / Math.max(leakRate, 0.0001)));
      return {
        allowed: false,
        remaining: 0,
        limit: capacity,
        reset: retryAfter,
        retryAfter,
      };
    },
  };
}

// Fixed Window: counter resets every windowMs milliseconds.
// For compatibility with the UI, `refillRate` is unused (kept for signature parity).
export function createFixedWindow(capacity: number, _refillRate: number, windowMs: number = 1000): RateLimiterLike {
  let windowStart = Date.now();
  let count = 0;

  const checkExpire = (now: number = Date.now()) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
  };

  return {
    refill: checkExpire,
    getTokens: () => Math.max(0, capacity - count),
    reset: () => {
      windowStart = Date.now();
      count = 0;
    },
    hit: (now: number = Date.now()) => {
      checkExpire(now);
      count += 1;
      const resetMs = windowStart + windowMs - now;
      const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
      if (count <= capacity) {
        return {
          allowed: true,
          remaining: Math.max(0, capacity - count),
          limit: capacity,
          reset: resetSec,
          retryAfter: 0,
        };
      }
      return {
        allowed: false,
        remaining: 0,
        limit: capacity,
        reset: resetSec,
        retryAfter: resetSec,
      };
    },
  };
}

// Sliding Window Log: keeps timestamps; counts requests in last windowMs.
export function createSlidingWindow(capacity: number, _refillRate: number, windowMs: number = 1000): RateLimiterLike {
  const timestamps: number[] = [];

  const prune = (now: number = Date.now()) => {
    const cutoff = now - windowMs;
    while (timestamps.length && timestamps[0] <= cutoff) {
      timestamps.shift();
    }
  };

  return {
    refill: prune,
    getTokens: () => Math.max(0, capacity - timestamps.length),
    reset: () => {
      timestamps.length = 0;
    },
    hit: (now: number = Date.now()) => {
      prune(now);
      timestamps.push(now);
      if (timestamps.length <= capacity) {
        const oldest = timestamps[0];
        const resetMs = oldest + windowMs - now;
        return {
          allowed: true,
          remaining: capacity - timestamps.length,
          limit: capacity,
          reset: Math.max(1, Math.ceil(resetMs / 1000)),
          retryAfter: 0,
        };
      }
      const oldest = timestamps[0];
      const retryMs = oldest + windowMs - now;
      const retrySec = Math.max(1, Math.ceil(retryMs / 1000));
      // remove the one we just pushed (it's throttled, don't count it against future? Or keep? Typically throttle doesn't consume.)
      timestamps.pop();
      return {
        allowed: false,
        remaining: 0,
        limit: capacity,
        reset: retrySec,
        retryAfter: retrySec,
      };
    },
  };
}

export function createLimiter(
  algorithm: AlgorithmId,
  capacity: number,
  refillRate: number,
  windowMs: number = 1000,
): RateLimiterLike {
  switch (algorithm) {
    case "token-bucket":
      return createTokenBucket(capacity, refillRate);
    case "leaky-bucket":
      return createLeakyBucket(capacity, refillRate);
    case "fixed-window":
      return createFixedWindow(capacity, refillRate, windowMs);
    case "sliding-window":
      return createSlidingWindow(capacity, refillRate, windowMs);
  }
}
