import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Gauge,
  RotateCcw,
  Download,
  Play,
  Pause,
  Zap,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Activity,
  Hash,
  Clock,
  Server,
  Copy,
  Check,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { cn } from "./utils/cn";
import type {
  AlgorithmId,
  RequestEvent,
  RequestStatus,
} from "./types";
import { createLimiter, type RateLimiterLike } from "./lib/limiters";
import { FRAMEWORKS, getSnippet } from "./lib/snippets";

const ALGORITHMS: {
  id: AlgorithmId;
  label: string;
  description: string;
}[] = [
  {
    id: "token-bucket",
    label: "Token Bucket",
    description: "Tokens refill at constant rate — allows bursts up to capacity",
  },
  {
    id: "leaky-bucket",
    label: "Leaky Bucket",
    description: "Queue drained at steady rate — smooths traffic spikes",
  },
  {
    id: "fixed-window",
    label: "Fixed Window",
    description: "Counter resets each interval — simple, but allows edge bursts",
  },
  {
    id: "sliding-window",
    label: "Sliding Window",
    description: "Per-request timestamps — accurate rolling time window",
  },
];

const ENDPOINTS = [
  "GET /api/users",
  "POST /api/orders",
  "GET /api/products/:id",
  "PUT /api/settings",
  "DELETE /api/sessions",
  "GET /api/search?q=*",
  "POST /api/webhooks",
  "GET /api/analytics",
];

function randomEndpoint(): { method: string; path: string } {
  const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const [method, ...rest] = ep.split(" ");
  return { method, path: rest.join(" ") };
}

// ---------- Top-level App ----------
export default function App() {
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("token-bucket");
  const [capacity, setCapacity] = useState(20);
  const [refillRate, setRefillRate] = useState(10);
  const [rps, setRps] = useState(12);
  const [running, setRunning] = useState(true);
  const [requests, setRequests] = useState<RequestEvent[]>([]);
  const [selected, setSelected] = useState<RequestEvent | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [counter, setCounter] = useState(0);
  const [framework, setFramework] = useState<"express" | "fastapi" | "nextjs">("express");
  const [copied, setCopied] = useState(false);
  const [currentTokens, setCurrentTokens] = useState(20);

  const limiterRef = useRef<RateLimiterLike | null>(null);

  // For window-based algorithms, the second slider maps to window size in ms (200ms – 10s).
  const windowMs = useMemo(() => {
    if (algorithm === "fixed-window" || algorithm === "sliding-window") {
      // refillRate slider is 1-50; scale to 200-10000ms
      return Math.round(200 + ((refillRate - 1) / 49) * 9800);
    }
    return 1000;
  }, [algorithm, refillRate]);

  // Build limiter whenever algorithm/capacity/refill changes
  useEffect(() => {
    limiterRef.current = createLimiter(algorithm, capacity, refillRate, windowMs);
    setCurrentTokens(limiterRef.current.getTokens());
  }, [algorithm, capacity, refillRate, windowMs]);

  // Periodic tick for smooth UI (also refills buckets so display stays live)
  useEffect(() => {
    const id = setInterval(() => {
      const l = limiterRef.current;
      if (l && l.refill) l.refill();
      if (l) setCurrentTokens(l.getTokens());
    }, 100);
    return () => clearInterval(id);
  }, []);

  const fireOne = useCallback(() => {
    const l = limiterRef.current;
    if (!l) return;
    const now = Date.now();
    const result = l.hit(now);
    const { method, path } = randomEndpoint();
    setCounter((c) => c + 1);
    const event: RequestEvent = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      index: counter + 1,
      status: result.allowed ? "allowed" : "throttled",
      timestamp: now,
      endpoint: path,
      method,
      remaining: result.remaining,
      limit: result.limit,
      reset: result.reset,
      retryAfter: result.retryAfter,
    };
    setRequests((prev) => [event, ...prev].slice(0, 120));
    setCurrentTokens(l.getTokens());
    return event;
  }, [counter]);

  // Continuous traffic generator
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      if (cancelled) return;
      // fire one request immediately
      fireOne();
      const jitter = 0.7 + Math.random() * 0.6; // 0.7-1.3x interval
      const intervalMs = 1000 / rps * jitter;
      timeoutId = setTimeout(schedule, Math.max(10, intervalMs));
    };
    timeoutId = setTimeout(schedule, 100);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [running, rps, fireOne]);

  // Totals / stats
  const totals = useMemo(() => {
    const total = requests.length;
    const throttled = requests.filter((r) => r.status === "throttled").length;
    const allowed = total - throttled;
    const rate = total ? (throttled / total) * 100 : 0;
    return { total, throttled, allowed, rate };
  }, [requests]);

  const handleReset = () => {
    limiterRef.current?.reset();
    setRequests([]);
    setCounter(0);
    setCurrentTokens(capacity);
    setSelected(null);
  };

  const handleExport = () => {
    const config = {
      algorithm,
      capacity,
      refillRate,
      requestsPerSecond: rps,
      exportedAt: new Date().toISOString(),
      stats: {
        total: totals.total,
        allowed: totals.allowed,
        throttled: totals.throttled,
        throttleRatePercent: Number(totals.rate.toFixed(2)),
      },
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ratepulse-config-${algorithm}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendBurst = () => {
    // Fire 20 near-simultaneous requests
    for (let i = 0; i < 20; i++) {
      setTimeout(() => fireOne(), i * 4);
    }
  };

  const displayTokens = Math.max(0, Math.min(capacity, currentTokens));
  const tokenPct = capacity > 0 ? (displayTokens / capacity) * 100 : 0;

  const code = useMemo(
    () => getSnippet(framework, algorithm),
    [framework, algorithm]
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="min-h-screen w-full text-slate-100">
      {/* Top bar */}
      <Header
        algorithm={algorithm}
        setAlgorithm={setAlgorithm}
        onReset={handleReset}
        onExport={handleExport}
      />

      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 md:px-8">
        {/* Hero / title row */}
        <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="col-span-2 rounded-2xl border border-slate-800/80 bg-[#0f172a]/80 p-6 shadow-xl shadow-indigo-950/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-indigo-300/80">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Live throttle simulator
                </div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Visualize how your API{" "}
                  <span className="text-indigo-400">rate limits</span> react to traffic
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">
                  Tune capacity, refill rates, and request volume. Watch requests flow in real time and inspect standard <span className="font-mono text-slate-300">X-RateLimit-*</span> response headers.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRunning((r) => !r)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition",
                    running
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  )}
                >
                  {running ? (
                    <>
                      <Pause className="h-4 w-4" /> Pause traffic
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" /> Start traffic
                    </>
                  )}
                </button>
                <button
                  onClick={handleSendBurst}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20"
                >
                  <Zap className="h-4 w-4" /> Send Burst (×20)
                </button>
              </div>
            </div>
            {/* Bucket fill bar */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between font-mono text-xs text-slate-400">
                <span className="flex items-center gap-2">
                  <Gauge className="h-3.5 w-3.5 text-indigo-400" />
                  {algorithm === "leaky-bucket"
                    ? "Queue fill"
                    : algorithm === "fixed-window" || algorithm === "sliding-window"
                    ? "Window remaining"
                    : "Token availability"}
                </span>
                <span className="text-slate-200">
                  {algorithm === "leaky-bucket"
                    ? `${(capacity - displayTokens).toFixed(1)} / ${capacity}`
                    : `${Math.floor(displayTokens)} / ${capacity}`}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800/80">
                <div
                  className="tb-fill h-full rounded-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400"
                  style={{
                    width: `${
                      algorithm === "leaky-bucket"
                        ? ((capacity - displayTokens) / capacity) * 100
                        : tokenPct
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          <QuickStatus
            algorithm={algorithm}
            capacity={capacity}
            refillRate={refillRate}
            windowMs={windowMs}
            rps={rps}
            throttleRate={totals.rate}
            running={running}
          />
        </section>

        {/* Main grid */}
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <ControlPanel
            capacity={capacity}
            setCapacity={setCapacity}
            refillRate={refillRate}
            setRefillRate={setRefillRate}
            rps={rps}
            setRps={setRps}
            onBurst={handleSendBurst}
            algorithm={algorithm}
          />

          {/* Middle column */}
          <div className="flex flex-col gap-6">
            <MetricsCards
              total={totals.total}
              allowed={totals.allowed}
              throttled={totals.throttled}
              throttleRate={totals.rate}
              currentTokens={displayTokens}
              capacity={capacity}
              algorithm={algorithm}
            />

            <RequestStream
              requests={requests}
              onSelect={(req) => {
                setSelected(req);
                setInspectorOpen(true);
              }}
              selectedId={selected?.id}
              algorithm={algorithm}
            />

            <CodeSection
              framework={framework}
              setFramework={setFramework}
              code={code}
              copied={copied}
              onCopy={copyCode}
              algorithm={algorithm}
            />
          </div>

          {/* Right: headers inspector */}
          <HeadersInspector
            open={inspectorOpen}
            onToggle={() => setInspectorOpen((o) => !o)}
            selected={selected}
            defaultLimit={capacity}
            defaultReset={
              algorithm === "fixed-window" || algorithm === "sliding-window"
                ? Math.ceil(windowMs / 1000)
                : Math.ceil(capacity / Math.max(refillRate, 1))
            }
          />
        </section>

        <footer className="mt-12 border-t border-slate-800/70 pt-6 text-center text-xs text-slate-500">
          RatePulse · Educational simulator. Timings run at browser animation speed — real backends will differ slightly.
        </footer>
      </main>
    </div>
  );
}

// ---------- Header ----------
function Header({
  algorithm,
  setAlgorithm,
  onReset,
  onExport,
}: {
  algorithm: AlgorithmId;
  setAlgorithm: (a: AlgorithmId) => void;
  onReset: () => void;
  onExport: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 md:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-500 shadow-lg shadow-indigo-900/50">
            <Gauge className="gauge-glow h-5 w-5 text-white" strokeWidth={2.4} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xl font-bold tracking-tight text-white">
                RatePulse
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                <span className="pulse-glow h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Throttle engine: active
              </span>
            </div>
            <p className="text-xs text-slate-400">
              API rate-limiting, throttling & token-bucket simulator
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-[#0f172a] p-1">
            {ALGORITHMS.map((a) => (
              <button
                key={a.id}
                onClick={() => setAlgorithm(a.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  algorithm === a.id
                    ? "bg-indigo-500/20 text-indigo-200 shadow-inner shadow-indigo-500/20 ring-1 ring-indigo-500/40"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                )}
                title={a.description}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset state
          </button>
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
          >
            <Download className="h-3.5 w-3.5" /> Export config
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------- Quick Status (hero side card) ----------
function QuickStatus({
  algorithm,
  capacity,
  refillRate,
  windowMs,
  rps,
  throttleRate,
  running,
}: {
  algorithm: AlgorithmId;
  capacity: number;
  refillRate: number;
  windowMs?: number;
  rps: number;
  throttleRate: number;
  running: boolean;
}) {
  const algo = ALGORITHMS.find((a) => a.id === algorithm)!;
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#0f172a]/80 p-6 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
          <Activity className="h-3.5 w-3.5 text-indigo-400" />
          Engine config
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            running
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          )}
        >
          {running ? "streaming" : "paused"}
        </span>
      </div>
      <div className="mb-4">
        <div className="text-lg font-semibold text-slate-100">{algo.label}</div>
        <p className="text-xs leading-relaxed text-slate-400">{algo.description}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 font-mono text-[11px]">
        <Stat label="CAPACITY" value={capacity} accent="indigo" />
        {algorithm === "fixed-window" || algorithm === "sliding-window" ? (
          <Stat label="WINDOW" value={`${windowMs}ms`} accent="emerald" />
        ) : (
          <Stat label="REFILL/s" value={refillRate} accent="emerald" />
        )}
        <Stat label="REQ/s" value={rps} accent="rose" />
      </dl>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-slate-500">
          <span>Throttle rate</span>
          <span className="font-mono text-slate-300">{throttleRate.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 transition-all"
            style={{ width: `${Math.min(100, throttleRate)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: "indigo" | "emerald" | "rose";
}) {
  const color =
    accent === "indigo"
      ? "text-indigo-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-rose-300";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold", color)}>{value}</div>
    </div>
  );
}

// ---------- Control panel ----------
function ControlPanel({
  capacity,
  setCapacity,
  refillRate,
  setRefillRate,
  rps,
  setRps,
  onBurst,
  algorithm,
}: {
  capacity: number;
  setCapacity: (n: number) => void;
  refillRate: number;
  setRefillRate: (n: number) => void;
  rps: number;
  setRps: (n: number) => void;
  onBurst: () => void;
  algorithm: AlgorithmId;
}) {
  const refillLabel =
    algorithm === "leaky-bucket"
      ? "Leak rate (req/sec)"
      : algorithm === "fixed-window" || algorithm === "sliding-window"
      ? "Window size"
      : "Refill rate (tokens/sec)";

  // For windowed algorithms, show ms instead of /s
  const refillValue =
    algorithm === "fixed-window" || algorithm === "sliding-window"
      ? Math.round(200 + ((refillRate - 1) / 49) * 9800)
      : refillRate;
  const refillUnit =
    algorithm === "fixed-window" || algorithm === "sliding-window" ? " ms" : "/s";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-[#0f172a]/80 p-5 shadow-xl shadow-indigo-950/10 xl:sticky xl:top-[96px] xl:self-start">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Server className="h-4 w-4 text-indigo-400" />
          Control panel
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Tune parameters live. The simulator updates instantly.
        </p>
      </div>

      <Slider
        label="Burst capacity"
        hint="Max concurrent requests/tokens allowed"
        min={1}
        max={100}
        value={capacity}
        onChange={setCapacity}
        unit=""
        accent="indigo"
      />
      <Slider
        label={refillLabel}
        hint={
          algorithm === "token-bucket"
            ? "Tokens added per second"
            : algorithm === "leaky-bucket"
            ? "Requests drained from queue per second"
            : "Rolling window duration; older requests fall off"
        }
        min={1}
        max={50}
        value={refillRate}
        displayValue={refillValue}
        onChange={setRefillRate}
        unit={refillUnit}
        accent="emerald"
      />
      <Slider
        label="Request frequency"
        hint="Simulated inbound requests per second"
        min={1}
        max={60}
        value={rps}
        onChange={setRps}
        unit=" rps"
        accent="rose"
      />

      <button
        onClick={onBurst}
        className="group relative mt-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl border border-indigo-500/40 bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:shadow-indigo-700/50"
      >
        <Zap className="h-4 w-4" strokeWidth={2.4} />
        Send burst traffic (20 req)
      </button>

      <div className="mt-1 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-400">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Tip
        </div>
        Set capacity high and refill low, then press <span className="font-mono text-slate-200">Send burst</span> to see how fast 429s ramp up.
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  value,
  displayValue,
  onChange,
  unit,
  accent,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  value: number;
  displayValue?: number | string;
  onChange: (n: number) => void;
  unit?: string;
  accent: "indigo" | "emerald" | "rose";
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const shownValue = displayValue ?? value;
  const track =
    accent === "indigo"
      ? "#6366f1"
      : accent === "emerald"
      ? "#10b981"
      : "#f43f5e";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold",
            accent === "indigo"
              ? "bg-indigo-500/10 text-indigo-300"
              : accent === "emerald"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-rose-500/10 text-rose-300"
          )}
        >
          {shownValue}
          {unit}
        </span>
      </div>
      {hint && <p className="mb-2 text-[11px] text-slate-500">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{
          // @ts-expect-error CSS var
          "--pct": `${pct}%`,
          background: `linear-gradient(90deg, ${track} ${pct}%, #1f2937 ${pct}%)`,
        }}
      />
    </div>
  );
}

// ---------- Metrics Cards ----------
function MetricsCards({
  total,
  allowed,
  throttled,
  throttleRate,
  currentTokens,
  capacity,
  algorithm,
}: {
  total: number;
  allowed: number;
  throttled: number;
  throttleRate: number;
  currentTokens: number;
  capacity: number;
  algorithm: AlgorithmId;
}) {
  const bucketLabel =
    algorithm === "leaky-bucket"
      ? "Queue depth"
      : algorithm === "fixed-window" || algorithm === "sliding-window"
      ? "Remaining in window"
      : "Current bucket tokens";
  const bucketVal =
    algorithm === "leaky-bucket"
      ? `${(capacity - currentTokens).toFixed(1)} / ${capacity}`
      : `${Math.floor(currentTokens)} / ${capacity}`;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard
        icon={<Hash className="h-4 w-4" />}
        label="Total requests"
        value={total.toLocaleString()}
        accent="indigo"
      />
      <MetricCard
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="200 OK (allowed)"
        value={allowed.toLocaleString()}
        accent="emerald"
      />
      <MetricCard
        icon={<ShieldAlert className="h-4 w-4" />}
        label="429 throttled"
        value={`${throttleRate.toFixed(1)}%`}
        sub={`${throttled} requests`}
        accent="rose"
      />
      <MetricCard
        icon={<Gauge className="h-4 w-4" />}
        label={bucketLabel}
        value={bucketVal}
        accent="indigo"
        mono
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: "indigo" | "emerald" | "rose";
  mono?: boolean;
}) {
  const accentMap = {
    indigo: "text-indigo-300 bg-indigo-500/10 ring-indigo-500/20",
    emerald: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/20",
    rose: "text-rose-300 bg-rose-500/10 ring-rose-500/20",
  };
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#0f172a] p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1",
            accentMap[accent]
          )}
        >
          {icon}
        </span>
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold text-slate-100",
          mono && "font-mono text-xl"
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------- Request stream ----------
function RequestStream({
  requests,
  onSelect,
  selectedId,
  algorithm,
}: {
  requests: RequestEvent[];
  onSelect: (r: RequestEvent) => void;
  selectedId?: string;
  algorithm: AlgorithmId;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const lastStatus = requests[0]?.status;
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#0f172a]/70 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">Live request stream</h3>
          <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {requests.length} / 120 buffered
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
            200 OK
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.7)]" />
            429 Too Many
          </span>
        </div>
      </div>

      {/* Dot grid */}
      <div className="px-5 pt-4">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(16px, 1fr))" }}
        >
          {Array.from({ length: 96 }).map((_, i) => {
            const r = requests[i];
            if (!r) {
              return (
                <div
                  key={i}
                  className="h-4 w-4 rounded-[3px] border border-slate-800/70 bg-slate-900/40"
                />
              );
            }
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                title={`#${r.index} · ${r.method} ${r.endpoint}`}
                className={cn(
                  "pop-in h-4 w-4 rounded-[3px] transition hover:scale-110",
                  r.status === "allowed"
                    ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.55)]"
                    : "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.55)]",
                  selectedId === r.id && "ring-2 ring-white/70"
                )}
              />
            );
          })}
        </div>
      </div>

      {/* Scrollable log */}
      <div
        ref={listRef}
        className="mt-4 max-h-[260px] overflow-y-auto border-t border-slate-800/80"
      >
        {requests.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-slate-500">
            Waiting for first request…
          </div>
        )}
        {requests.slice(0, 40).map((r) => (
          <RequestRow
            key={r.id}
            req={r}
            onClick={() => onSelect(r)}
            selected={selectedId === r.id}
          />
        ))}
      </div>

      {lastStatus && (
        <div className="flex items-center justify-between border-t border-slate-800/80 px-5 py-2 text-[11px] text-slate-500">
          <span>
            Algorithm:{" "}
            <span className="font-mono text-slate-300">
              {ALGORITHMS.find((a) => a.id === algorithm)?.label}
            </span>
          </span>
          <span className="font-mono">Click a request to inspect headers →</span>
        </div>
      )}
    </div>
  );
}

function RequestRow({
  req,
  onClick,
  selected,
}: {
  req: RequestEvent;
  onClick: () => void;
  selected: boolean;
}) {
  const isOK = req.status === "allowed";
  return (
    <button
      onClick={onClick}
      className={cn(
        "slide-in-right flex w-full items-center gap-3 border-b border-slate-800/50 px-5 py-2 text-left text-xs transition hover:bg-slate-800/30",
        selected && "bg-slate-800/50"
      )}
    >
      <span
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          isOK
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-rose-500/15 text-rose-300"
        )}
      >
        {isOK ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="w-12 shrink-0 font-mono text-slate-500">
        #{req.index.toString().padStart(4, "0")}
      </span>
      <span
        className={cn(
          "w-12 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-bold",
          isOK
            ? "bg-emerald-500/20 text-emerald-200"
            : "bg-rose-500/20 text-rose-200"
        )}
      >
        {isOK ? "200" : "429"}
      </span>
      <span className="w-14 shrink-0 font-mono text-[10px] font-semibold uppercase text-indigo-300">
        {req.method}
      </span>
      <span className="truncate font-mono text-slate-300">{req.endpoint}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
        {isOK ? (
          <>remaining: {req.remaining}</>
        ) : (
          <>retry-after: {req.retryAfter}s</>
        )}
      </span>
    </button>
  );
}

// ---------- Headers Inspector ----------
function HeadersInspector({
  open,
  onToggle,
  selected,
  defaultLimit,
  defaultReset,
}: {
  open: boolean;
  onToggle: () => void;
  selected: RequestEvent | null;
  defaultLimit: number;
  defaultReset: number;
}) {
  const limit = selected?.limit ?? defaultLimit;
  const remaining = selected?.remaining ?? (selected?.status === "throttled" ? 0 : defaultLimit);
  const reset = selected?.reset ?? defaultReset;
  const retryAfter = selected?.retryAfter ?? 0;
  const status: RequestStatus = selected?.status ?? "allowed";
  const isOK = status === "allowed";

  return (
    <aside
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-[#0f172a]/80 p-5 shadow-xl xl:sticky xl:top-[96px] xl:self-start",
        !open && "opacity-90"
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Terminal className="h-4 w-4 text-indigo-400" /> Headers inspector
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Emulated <span className="font-mono">HTTP/1.1</span> response
          </p>
        </div>
        <button
          onClick={onToggle}
          className="text-[11px] text-slate-400 hover:text-slate-200"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>

      {!open ? null : (
        <>
          <div
            className={cn(
              "rounded-xl border p-4",
              isOK
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-rose-500/30 bg-rose-500/5"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <div
                  className={cn(
                    "font-mono text-2xl font-bold",
                    isOK ? "text-emerald-300" : "text-rose-300"
                  )}
                >
                  {isOK ? "200 OK" : "429 Too Many Requests"}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {selected
                    ? `${selected.method} ${selected.endpoint}`
                    : "Defaults — click a request to see its response."}
                </div>
              </div>
              {isOK ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-7 w-7 text-rose-400" />
              )}
            </div>
          </div>

          <div className="code-block p-0">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                Response headers
              </span>
              <Clock className="h-3 w-3 text-slate-500" />
            </div>
            <div className="divide-y divide-slate-800 px-3 py-1 font-mono text-[11.5px]">
              <HeaderRow name="X-RateLimit-Limit" value={String(limit)} kind="limit" />
              <HeaderRow
                name="X-RateLimit-Remaining"
                value={String(Math.max(0, remaining))}
                kind={isOK ? "ok" : "blocked"}
              />
              <HeaderRow
                name="X-RateLimit-Reset"
                value={`${reset}s`}
                kind="neutral"
              />
              <HeaderRow
                name="Retry-After"
                value={isOK ? "—" : `${retryAfter}s`}
                kind={isOK ? "muted" : "blocked"}
              />
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              What it means
            </div>
            {isOK ? (
              <p>
                Request was accepted. The client has{" "}
                <span className="font-mono text-emerald-300">{remaining}</span> of{" "}
                <span className="font-mono text-slate-200">{limit}</span> tokens left
                before the window resets.
              </p>
            ) : (
              <p>
                Request was rejected. The client must wait{" "}
                <span className="font-mono text-rose-300">{retryAfter}s</span> before
                retrying. Remaining is{" "}
                <span className="font-mono">0</span>.
              </p>
            )}
          </div>

          {/* Response body preview */}
          <div className="code-block p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
              Response body
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-slate-300">
{isOK
  ? JSON.stringify({ ok: true, id: selected?.id ?? "req_xxx", remaining }, null, 2)
  : JSON.stringify(
      {
        statusCode: 429,
        error: "Too Many Requests",
        message: "Rate limit exceeded. Retry after the indicated interval.",
        retryAfter,
      },
      null,
      2
    )}
            </pre>
          </div>
        </>
      )}
    </aside>
  );
}

function HeaderRow({
  name,
  value,
  kind,
}: {
  name: string;
  value: string;
  kind: "limit" | "ok" | "blocked" | "neutral" | "muted";
}) {
  const color =
    kind === "ok"
      ? "text-emerald-300"
      : kind === "blocked"
      ? "text-rose-300"
      : kind === "limit"
      ? "text-indigo-300"
      : kind === "muted"
      ? "text-slate-600"
      : "text-slate-300";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-slate-400">{name}:</span>
      <span className={cn("font-semibold", color)}>{value}</span>
    </div>
  );
}

// ---------- Code tabs ----------
function CodeSection({
  framework,
  setFramework,
  code,
  copied,
  onCopy,
  algorithm,
}: {
  framework: "express" | "fastapi" | "nextjs";
  setFramework: (f: "express" | "fastapi" | "nextjs") => void;
  code: string;
  copied: boolean;
  onCopy: () => void;
  algorithm: AlgorithmId;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#0f172a]/80 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Terminal className="h-4 w-4 text-indigo-400" />
            Middleware snippet
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Production-ready starter for{" "}
            <span className="font-mono text-slate-300">
              {ALGORITHMS.find((a) => a.id === algorithm)?.label}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
            {FRAMEWORKS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFramework(f.id as "express" | "fastapi" | "nextjs")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                  framework === f.id
                    ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-500/40"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy
              </>
            )}
          </button>
        </div>
      </div>
      <div className="code-block m-4 max-h-[420px] overflow-auto p-4">
        <pre className="whitespace-pre text-slate-300">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
