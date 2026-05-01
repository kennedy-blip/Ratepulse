import type { AlgorithmId } from "../types";

type FrameworkId = "express" | "fastapi" | "nextjs";

export const FRAMEWORKS: { id: FrameworkId; label: string; language: string }[] = [
  { id: "express", label: "Node.js · Express", language: "javascript" },
  { id: "fastapi", label: "Python · FastAPI + Redis", language: "python" },
  { id: "nextjs", label: "Next.js API Middleware", language: "typescript" },
];

export function getSnippet(framework: FrameworkId, algorithm: AlgorithmId): string {
  if (framework === "express") {
    if (algorithm === "token-bucket") {
      return `// Token Bucket rate limiter — Express middleware
// Uses an in-memory store; for production, swap to Redis.
const BUCKETS = new Map(); // ip -> { tokens, lastRefill }

const CONFIG = {
  capacity: 20,          // burst size
  refillRate: 10,        // tokens refilled per second
  windowMs: 60_000,
};

function tokenBucketFor(ip) {
  const now = Date.now();
  let b = BUCKETS.get(ip);
  if (!b) {
    b = { tokens: CONFIG.capacity, lastRefill: now };
    BUCKETS.set(ip, b);
  }
  const delta = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(CONFIG.capacity, b.tokens + delta * CONFIG.refillRate);
  b.lastRefill = now;
  return b;
}

export function rateLimit(req, res, next) {
  const ip = req.ip;
  const b = tokenBucketFor(ip);

  res.set("X-RateLimit-Limit", String(CONFIG.capacity));

  if (b.tokens >= 1) {
    b.tokens -= 1;
    res.set("X-RateLimit-Remaining", String(Math.floor(b.tokens)));
    res.set("X-RateLimit-Reset", String(
      Math.ceil(
        (CONFIG.capacity - b.tokens) / CONFIG.refillRate
      )
    ));
    return next();
  }

  const retryAfter = Math.ceil(
    (1 - b.tokens) / CONFIG.refillRate
  );
  res.set("X-RateLimit-Remaining", "0");
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({ error: "Too Many Requests" });
}`;
    }
    if (algorithm === "leaky-bucket") {
      return `// Leaky Bucket rate limiter — Express middleware
// Queues overflow requests and processes them at a constant rate.
import { setTimeout as wait } from "node:timers/promises";

const QUEUES = new Map(); // ip -> { queue, lastLeak }
const CAPACITY = 20;      // max queue depth
const LEAK_RATE = 10;     // requests/sec leaked (processed)

function leakFor(ip) {
  const now = Date.now();
  let q = QUEUES.get(ip);
  if (!q) { q = { queue: 0, lastLeak: now }; QUEUES.set(ip, q); }
  const delta = (now - q.lastLeak) / 1000;
  q.queue = Math.max(0, q.queue - delta * LEAK_RATE);
  q.lastLeak = now;
  return q;
}

export async function rateLimit(req, res, next) {
  const q = leakFor(req.ip);
  if (q.queue + 1 > CAPACITY) {
    const retryAfter = Math.ceil(
      ((q.queue + 1) - CAPACITY) / LEAK_RATE
    );
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too Many Requests" });
  }
  q.queue += 1;
  const delayMs = (q.queue / LEAK_RATE) * 1000;
  await wait(delayMs);
  res.set("X-RateLimit-Limit", String(CAPACITY));
  res.set("X-RateLimit-Remaining", String(CAPACITY - Math.ceil(q.queue)));
  next();
}`;
    }
    if (algorithm === "fixed-window") {
      return `// Fixed Window counter — Express middleware
// Simple but suffers from burst-at-edge-of-window.
const WINDOWS = new Map();
const CONFIG = { max: 20, windowMs: 1000 };

export function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let w = WINDOWS.get(ip);
  if (!w || now - w.start > CONFIG.windowMs) {
    w = { start: now, count: 0 };
    WINDOWS.set(ip, w);
  }
  w.count += 1;
  const resetSec = Math.ceil((w.start + CONFIG.windowMs - now) / 1000);
  res.set("X-RateLimit-Limit", String(CONFIG.max));
  res.set("X-RateLimit-Remaining", String(Math.max(0, CONFIG.max - w.count)));
  res.set("X-RateLimit-Reset", String(resetSec));
  if (w.count > CONFIG.max) {
    res.set("Retry-After", String(resetSec));
    return res.status(429).json({ error: "Too Many Requests" });
  }
  next();
}`;
    }
    return `// Sliding Window log — Express middleware
// Tracks per-request timestamps for accurate limits.
const LOGS = new Map(); // ip -> number[]
const CONFIG = { max: 20, windowMs: 1000 };

export function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  let log = LOGS.get(ip) || [];
  const cutoff = now - CONFIG.windowMs;
  log = log.filter((t) => t > cutoff);
  if (log.length >= CONFIG.max) {
    const oldest = log[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + CONFIG.windowMs - now) / 1000));
    res.set("X-RateLimit-Limit", String(CONFIG.max));
    res.set("X-RateLimit-Remaining", "0");
    res.set("Retry-After", String(retryAfter));
    LOGS.set(ip, log);
    return res.status(429).json({ error: "Too Many Requests" });
  }
  log.push(now);
  LOGS.set(ip, log);
  const remaining = CONFIG.max - log.length;
  const resetSec = Math.max(1,
    Math.ceil((log[0] + CONFIG.windowMs - now) / 1000));
  res.set("X-RateLimit-Limit", String(CONFIG.max));
  res.set("X-RateLimit-Remaining", String(remaining));
  res.set("X-RateLimit-Reset", String(resetSec));
  next();
}`;
  }

  if (framework === "fastapi") {
    if (algorithm === "token-bucket") {
      return `# Token Bucket — FastAPI middleware using Redis
import time
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

CAPACITY = 20       # burst tokens
REFILL_RATE = 10    # tokens / second

async def token_bucket_dep(request: Request, response: Response, redis: Redis):
    ip = request.client.host
    key = f"rl:tb:{ip}"
    now = time.time()

    data = await redis.hmget(key, "tokens", "last")
    tokens = float(data[0]) if data[0] else CAPACITY
    last = float(data[1]) if data[1] else now

    delta = now - last
    tokens = min(CAPACITY, tokens + delta * REFILL_RATE)

    response.headers["X-RateLimit-Limit"] = str(CAPACITY)
    if tokens >= 1:
        tokens -= 1
        response.headers["X-RateLimit-Remaining"] = str(int(tokens))
        response.headers["X-RateLimit-Reset"] = str(
            int(round((CAPACITY - tokens) / REFILL_RATE))
        )
        await redis.hset(key, mapping={"tokens": tokens, "last": now})
        await redis.expire(key, 60)
        return True

    retry_after = max(1, int(round((1 - tokens) / REFILL_RATE)))
    response.headers["Retry-After"] = str(retry_after)
    response.headers["X-RateLimit-Remaining"] = "0"
    return JSONResponse(
        status_code=429,
        content={"detail": "Too Many Requests"},
        headers=dict(response.headers),
    )`;
    }
    if (algorithm === "leaky-bucket") {
      return `# Leaky Bucket — FastAPI dependency (Redis backed)
import asyncio, time
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

CAPACITY = 20
LEAK_RATE = 10  # requests/sec leaked

async def leaky_bucket_dep(request: Request, response: Response, redis: Redis):
    ip = request.client.host
    key = f"rl:lb:{ip}"
    now = time.time()
    data = await redis.hmget(key, "queue", "last")
    queue = float(data[0]) if data[0] else 0.0
    last = float(data[1]) if data[1] else now
    queue = max(0.0, queue - (now - last) * LEAK_RATE)

    if queue + 1 > CAPACITY:
        retry = max(1, int(round((queue + 1 - CAPACITY) / LEAK_RATE)))
        response.headers["Retry-After"] = str(retry)
        return JSONResponse(status_code=429, content={"detail": "Too Many Requests"})

    queue += 1
    await redis.hset(key, mapping={"queue": queue, "last": now})
    await asyncio.sleep(queue / LEAK_RATE)
    response.headers["X-RateLimit-Limit"] = str(CAPACITY)
    response.headers["X-RateLimit-Remaining"] = str(CAPACITY - int(queue))
    return True`;
    }
    if (algorithm === "fixed-window") {
      return `# Fixed Window Counter — FastAPI + Redis INCR
import time
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

LIMIT = 20
WINDOW_SEC = 1

async def fixed_window_dep(request: Request, response: Response, redis: Redis):
    ip = request.client.host
    now = int(time.time())
    key = f"rl:fw:{ip}:{now // WINDOW_SEC}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, WINDOW_SEC + 1)
    reset = WINDOW_SEC - (time.time() % WINDOW_SEC)
    response.headers["X-RateLimit-Limit"] = str(LIMIT)
    response.headers["X-RateLimit-Remaining"] = str(max(0, LIMIT - count))
    response.headers["X-RateLimit-Reset"] = str(int(round(reset)))
    if count > LIMIT:
        response.headers["Retry-After"] = str(max(1, int(round(reset))))
        return JSONResponse(status_code=429, content={"detail": "Too Many Requests"})
    return True`;
    }
    return `# Sliding Window Log — FastAPI + Redis sorted sets
import time
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

LIMIT = 20
WINDOW_MS = 1000

async def sliding_window_dep(request: Request, response: Response, redis: Redis):
    ip = request.client.host
    key = f"rl:sw:{ip}"
    now = time.time()
    cutoff = now - (WINDOW_MS / 1000)

    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, cutoff)
    pipe.zcard(key)
    pipe.zadd(key, {f"{now}:{request.client.port}": now})
    pipe.expire(key, 10)
    _, current, _, _ = await pipe.execute()

    response.headers["X-RateLimit-Limit"] = str(LIMIT)
    response.headers["X-RateLimit-Remaining"] = str(max(0, LIMIT - current - 1))
    if current >= LIMIT:
        oldest = await redis.zrange(key, 0, 0, withscores=True)
        retry = max(1, int(round(oldest[0][1] + (WINDOW_MS / 1000) - now)))
        response.headers["Retry-After"] = str(retry)
        await redis.zrem(key, f"{now}:{request.client.port}")
        return JSONResponse(status_code=429, content={"detail": "Too Many Requests"})
    return True`;
  }

  // Next.js
  if (algorithm === "token-bucket") {
    return `// Token Bucket — Next.js App Router middleware (Edge compatible)
// Place in /middleware.ts at project root.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CAPACITY = 20;
const REFILL_RATE = 10;
const KV = new Map<string, { tokens: number; last: number }>();

function getBucket(ip: string) {
  const now = Date.now();
  let b = KV.get(ip);
  if (!b) {
    b = { tokens: CAPACITY, last: now };
    KV.set(ip, b);
  }
  const delta = (now - b.last) / 1000;
  b.tokens = Math.min(CAPACITY, b.tokens + delta * REFILL_RATE);
  b.last = now;
  return b;
}

export function middleware(req: NextRequest) {
  const ip = req.ip ?? "anonymous";
  const res = NextResponse.next();
  const b = getBucket(ip);
  res.headers.set("X-RateLimit-Limit", String(CAPACITY));
  if (b.tokens >= 1) {
    b.tokens -= 1;
    res.headers.set("X-RateLimit-Remaining", String(Math.floor(b.tokens)));
    res.headers.set(
      "X-RateLimit-Reset",
      String(Math.ceil((CAPACITY - b.tokens) / REFILL_RATE))
    );
    return res;
  }
  const retry = Math.max(1, Math.ceil((1 - b.tokens) / REFILL_RATE));
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set("Retry-After", String(retry));
  return new NextResponse(
    JSON.stringify({ error: "Too Many Requests" }),
    { status: 429, headers: res.headers }
  );
}

export const config = { matcher: "/api/:path*" };`;
  }
  if (algorithm === "leaky-bucket") {
    return `// Leaky Bucket — Next.js API route helper
// Usage: wrap your handler with \`withLeakyBucket(handler)\`.
import { NextApiRequest, NextApiResponse } from "next";

const CAPACITY = 20;
const LEAK_RATE = 10;
const state = new Map<string, { queue: number; last: number }>();

function leak(ip: string) {
  const now = Date.now();
  let s = state.get(ip);
  if (!s) { s = { queue: 0, last: now }; state.set(ip, s); }
  s.queue = Math.max(0, s.queue - ((now - s.last) / 1000) * LEAK_RATE);
  s.last = now;
  return s;
}

export function withLeakyBucket(
  handler: (req: NextApiRequest, res: NextApiResponse) => void | Promise<void>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const ip = req.socket.remoteAddress || "anonymous";
    const s = leak(ip);
    if (s.queue + 1 > CAPACITY) {
      const retry = Math.max(1, Math.ceil((s.queue + 1 - CAPACITY) / LEAK_RATE));
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "Too Many Requests" });
    }
    s.queue += 1;
    await new Promise((r) => setTimeout(r, (s.queue / LEAK_RATE) * 1000));
    res.setHeader("X-RateLimit-Limit", String(CAPACITY));
    res.setHeader("X-RateLimit-Remaining", String(CAPACITY - Math.ceil(s.queue)));
    return handler(req, res);
  };
}`;
  }
  if (algorithm === "fixed-window") {
    return `// Fixed Window — Next.js middleware (KV-style)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const MAX = 20;
const WINDOW_MS = 1000;
const WINDOWS = new Map<string, { start: number; count: number }>();

export function middleware(req: NextRequest) {
  const ip = req.ip ?? "anonymous";
  const now = Date.now();
  let w = WINDOWS.get(ip);
  if (!w || now - w.start > WINDOW_MS) {
    w = { start: now, count: 0 };
    WINDOWS.set(ip, w);
  }
  w.count += 1;
  const resetSec = Math.ceil((w.start + WINDOW_MS - now) / 1000);
  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(MAX));
  res.headers.set("X-RateLimit-Remaining", String(Math.max(0, MAX - w.count)));
  res.headers.set("X-RateLimit-Reset", String(resetSec));
  if (w.count > MAX) {
    res.headers.set("Retry-After", String(resetSec));
    return new NextResponse(
      JSON.stringify({ error: "Too Many Requests" }),
      { status: 429, headers: res.headers }
    );
  }
  return res;
}

export const config = { matcher: "/api/:path*" };`;
  }
  return `// Sliding Window Log — Next.js API middleware
import { NextApiRequest, NextApiResponse } from "next";

const MAX = 20;
const WINDOW_MS = 1000;
const LOGS = new Map<string, number[]>();

export function slidingWindow(req: NextApiRequest, res: NextApiResponse, next: () => void) {
  const ip = req.socket.remoteAddress || "anonymous";
  const now = Date.now();
  let log = LOGS.get(ip) || [];
  const cutoff = now - WINDOW_MS;
  log = log.filter((t) => t > cutoff);
  if (log.length >= MAX) {
    const oldest = log[0];
    const retry = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    res.setHeader("Retry-After", String(retry));
    res.setHeader("X-RateLimit-Limit", String(MAX));
    res.setHeader("X-RateLimit-Remaining", "0");
    return res.status(429).json({ error: "Too Many Requests" });
  }
  log.push(now);
  LOGS.set(ip, log);
  res.setHeader("X-RateLimit-Limit", String(MAX));
  res.setHeader("X-RateLimit-Remaining", String(MAX - log.length));
  next();
}

// Usage in /api/hello.ts:
// export default function handler(req, res) {
//   slidingWindow(req, res, () => res.status(200).json({ ok: true }));
// }`;
}
