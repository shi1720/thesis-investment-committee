"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Database,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Globe2,
  History,
  Layers3,
  Loader2,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { defaultProfile, markets } from "@/lib/contracts";
import type {
  Bootstrap,
  Market,
  Opportunity,
  ProviderStatus,
  ResearchProfile,
  ResearchRun,
  SavedThesis,
  Stock,
} from "@/lib/contracts";

type View = "research" | "saved" | "history" | "methodology" | "integrations";
type ResultsTab = "opportunities" | "committee" | "stress" | "evidence";
const marketLabels: Record<
  Market,
  { flag: string; exchange: string; short: string }
> = {
  US: { flag: "🇺🇸", exchange: "NYSE · NASDAQ", short: "United States" },
  India: { flag: "🇮🇳", exchange: "NSE · BSE", short: "India" },
  China: { flag: "🇨🇳", exchange: "SSE · SZSE · HKEX", short: "China" },
  UAE: { flag: "🇦🇪", exchange: "ADX · DFM", short: "UAE" },
};
const palette: Record<string, string> = {
  Technology: "#dfe6fd",
  Financials: "#e4f0e8",
  Healthcare: "#f2e6f1",
  "Consumer Staples": "#f7ecd9",
  Energy: "#e8e6fc",
  Industrials: "#e6eff4",
  "Communication Services": "#eee6f6",
  "Consumer Discretionary": "#fff0db",
  "Real Estate": "#e0eeef",
};
const format = (n: number, digits = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "—";
const pct = (n: number, sign = false) =>
  `${sign && n > 0 ? "+" : ""}${format(n)}%`;
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
const initials = (name: string) =>
  name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data: unknown = await response
    .json()
    .catch(() => ({ error: "The server returned an unreadable response." }));
  if (!response.ok) {
    const details =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    throw new Error(
      typeof details.error === "string"
        ? details.error
        : typeof details.message === "string"
          ? details.message
          : `Request failed (${response.status}). Please try again.`,
    );
  }
  return data as T;
}
function Sparkline({
  prices,
  color = "#5067e9",
  large = false,
}: {
  prices: number[];
  color?: string;
  large?: boolean;
}) {
  const source = prices.length > 1 ? prices : [1, 1];
  const min = Math.min(...source),
    max = Math.max(...source),
    span = max - min || 1;
  const w = large ? 640 : 120,
    h = large ? 180 : 40,
    pad = large ? 15 : 3;
  const path = source
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${((i / (source.length - 1)) * w).toFixed(1)},${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`,
    )
    .join(" ");
  const id = `spark-${Math.round(source[0] * 100)}-${source.length}-${large ? "large" : "small"}`;
  return (
    <svg
      className={large ? "sparkline large" : "sparkline"}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Synthetic sample price path, not a forecast"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {large &&
        [30, 70, 110, 150].map((y) => (
          <line
            key={y}
            x1="0"
            x2={w}
            y1={y}
            y2={y}
            stroke="#e9edf3"
            strokeDasharray="4 5"
          />
        ))}
      {large && (
        <path d={`${path} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      )}
      <path
        d={path}
        stroke={color}
        strokeWidth={large ? 2.5 : 2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className={`wordmark ${small ? "small" : ""}`}>
      <span className="brand-icon">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M8 8h17M16 8v17M9 25 23 8"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="25" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span>
        thesis<span className="wordmark-period">.</span>
      </span>
    </div>
  );
}
function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "blue" | "amber" | "red" | "neutral";
}) {
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
function Modal({
  children,
  onClose,
  className = "",
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={label}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={19} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof Bookmark;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export default function Home() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState("");
  const [view, setView] = useState<View>("research");
  const [profile, setProfile] = useState<ResearchProfile>({
    ...defaultProfile,
  });
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [history, setHistory] = useState<ResearchRun[]>([]);
  const [watchlist, setWatchlist] = useState<SavedThesis[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ResultsTab>("opportunities");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "qualified" | "excluded">("all");
  const [selected, setSelected] = useState<Stock | Opportunity | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [notice, setNotice] = useState("");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const resultsRef = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    setBootError("");
    try {
      const data = await api<Bootstrap>("/api/bootstrap");
      setBootstrap(data);
      setWatchlist(data.watchlist);
      setHistory(data.recentRuns);
    } catch (e) {
      setBootError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [running, startedAt]);
  const navigate = (next: View) => {
    setView(next);
    setMobileOpen(false);
    setSearch("");
    setError("");
    if (next === "history") {
      setHistoryLoading(true);
      api<{ runs: ResearchRun[] }>("/api/runs")
        .then((d) => setHistory(d.runs))
        .catch((e) => setError(e.message))
        .finally(() => setHistoryLoading(false));
    }
  };
  const startResearch = async () => {
    setError("");
    setRunning(true);
    setElapsed(0);
    setStartedAt(Date.now());
    setView("research");
    setTab("opportunities");
    setCompare([]);
    try {
      const data = await api<ResearchRun>("/api/research", {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(profile),
      });
      setRun(data);
      setHistory((h) => [data, ...h.filter((r) => r.id !== data.id)]);
      setFilter("all");
      setSearch("");
      setScenarioIndex(0);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const openHistory = (item: ResearchRun) => {
    setRun(item);
    setScenarioIndex(0);
    setProfile(item.profile);
    setView("research");
    setTab("opportunities");
    setCompare([]);
    setSearch("");
  };
  const toggleMarket = (market: Market) =>
    setProfile((p) => ({
      ...p,
      markets: p.markets.includes(market)
        ? p.markets.length === 1
          ? p.markets
          : p.markets.filter((m) => m !== market)
        : [...p.markets, market],
    }));
  const change = <K extends keyof ResearchProfile>(
    key: K,
    value: ResearchProfile[K],
  ) => setProfile((p) => ({ ...p, [key]: value }));
  const providers = run?.providers || bootstrap?.providers || [];
  const stocks = useMemo<(Stock | Opportunity)[]>(
    () =>
      run?.opportunities ||
      (bootstrap?.universe || []).filter((s) =>
        profile.markets.includes(s.market),
      ),
    [run, bootstrap, profile.markets],
  );
  const displayed = stocks.filter(
    (s) =>
      (!search ||
        `${s.name} ${s.symbol} ${s.sector} ${s.market}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === "all" ||
        ("status" in s &&
          (filter === "qualified"
            ? s.status === "qualified"
            : s.status === "excluded"))),
  );
  const qualified =
    run?.opportunities.filter((s) => s.status === "qualified") || [];
  const selectedCompare = stocks.filter((s) => compare.includes(s.symbol));
  const profileChanged =
    !!run && JSON.stringify(profile) !== JSON.stringify(run.profile);
  const getSaved = (symbol: string) =>
    watchlist.find((w) => w.symbol === symbol);
  const save = async (stock: Stock | Opportunity) => {
    if (!run) {
      setNotice("Run the committee first to save an evidence-backed thesis.");
      return;
    }
    setSaving(stock.symbol);
    setMutationError("");
    try {
      const existing = getSaved(stock.symbol);
      if (existing) {
        await api(`/api/watchlist/${encodeURIComponent(existing.id)}`, {
          method: "DELETE",
        });
        setWatchlist((list) => list.filter((w) => w.id !== existing.id));
        setNotice(`${stock.symbol} removed from saved theses.`);
      } else {
        const data = await api<SavedThesis>("/api/watchlist", {
          method: "POST",
          body: JSON.stringify({
            symbol: stock.symbol,
            name: stock.name,
            market: stock.market,
            runId: run.id,
            invalidation:
              "invalidation" in stock ? stock.invalidation : stock.risk,
            note: "",
          }),
        });
        setWatchlist((list) => [data, ...list]);
        setNotice(`${stock.symbol} thesis saved.`);
      }
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const deleteSaved = async (item: SavedThesis) => {
    setSaving(item.id);
    setMutationError("");
    try {
      await api(`/api/watchlist/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      setWatchlist((list) => list.filter((w) => w.id !== item.id));
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const saveNote = async (item: SavedThesis) => {
    setSaving(item.id);
    setMutationError("");
    try {
      const updated = await api<SavedThesis>(
        `/api/watchlist/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ note: draftNotes[item.id] ?? item.note }),
        },
      );
      setWatchlist((list) => list.map((w) => (w.id === item.id ? updated : w)));
      setNotice("Research note saved.");
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setSaving(null);
    }
  };
  const exportRun = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify(run, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thesis-research-${run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const toggleCompare = (symbol: string) => {
    setCompare((list) =>
      list.includes(symbol)
        ? list.filter((s) => s !== symbol)
        : list.length < 3
          ? [...list, symbol]
          : list,
    );
  };
  const navItems: {
    id: View;
    label: string;
    icon: typeof Compass;
    count?: number;
  }[] = [
    { id: "research", label: "Research workspace", icon: Compass },
    {
      id: "saved",
      label: "Saved theses",
      icon: Bookmark,
      count: watchlist.length,
    },
    { id: "history", label: "Run history", icon: History },
  ];
  const fallbackProviders: ProviderStatus[] = [
    {
      name: "Zetaris",
      status: "unavailable",
      detail: "Unified evidence layer. Check server configuration.",
    },
    {
      name: "Meterless Nightshift",
      status: "unavailable",
      detail: "Primary model gateway. Check server configuration.",
    },
    {
      name: "Meterless Engine",
      status: "unavailable",
      detail: "Memory integration status appears when the server responds.",
    },
  ];

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <button
          className="brand-home"
          onClick={() => navigate("research")}
          aria-label="Thesis home"
        >
          <Wordmark />
        </button>
        <div className="workspace-tag">
          <span className="workspace-monogram">SG</span>
          <div>
            <strong>Personal workspace</strong>
            <span>Investment research</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={view === item.id ? "active" : ""}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && (
                <span className="nav-count">{item.count}</span>
              )}
              {view === item.id && <span className="active-nav-dot" />}
            </button>
          ))}
        </nav>
        <p className="nav-label second">SYSTEM</p>
        <nav className="primary-nav" aria-label="System navigation">
          <button
            onClick={() => navigate("methodology")}
            className={view === "methodology" ? "active" : ""}
          >
            <BookOpen size={18} />
            <span>Methodology</span>
          </button>
          <button
            onClick={() => navigate("integrations")}
            className={view === "integrations" ? "active" : ""}
          >
            <Layers3 size={18} />
            <span>Integrations</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="principle-card">
            <ShieldCheck size={20} />
            <strong>
              A second opinion.
              <br />A better first decision.
            </strong>
            <p>
              Evidence before conviction.
              <br />
              Risk before returns.
            </p>
            <button onClick={() => navigate("methodology")}>
              Our research principles <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} /> Help & getting started{" "}
            <ArrowUpRight size={13} />
          </button>
          <div className="account">
            <span className="avatar">
              {bootstrap?.user.signedIn ? initials(bootstrap.user.name) : "SG"}
            </span>
            <div>
              <strong>
                {bootstrap?.user.signedIn
                  ? bootstrap.user.name
                  : "Guest researcher"}
              </strong>
              <span>
                {bootstrap?.user.signedIn
                  ? "Personal account"
                  : "Sign in to begin research"}
              </span>
            </div>
            {bootstrap?.user.signedIn ? (
              <a
                href="/signout-with-chatgpt?return_to=%2F"
                target="_top"
                className="icon-button"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </a>
            ) : (
              <a
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
                title="Sign in with ChatGPT"
                className="icon-button"
              >
                <ArrowUpRight size={16} />
              </a>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="topbar-icon">
              <Compass size={17} />
            </span>
            <span>
              {view === "research"
                ? "Research desk"
                : view === "saved"
                  ? "Saved theses"
                  : view === "history"
                    ? "Run history"
                    : view === "methodology"
                      ? "Methodology"
                      : "Integrations"}
            </span>
            <ChevronRight size={14} />
            <span className="topbar-subtitle">
              {view === "research"
                ? "Your next conviction starts here"
                : "Personal workspace"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className="topbar-sample">
              <span />{" "}
              {run?.mode === "live" ? "Connected research" : "Sample workspace"}
            </span>
            <button
              className="icon-button"
              onClick={() => setHelpOpen(true)}
              aria-label="About this workspace"
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {bootError && (
            <div className="banner error" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>We couldn’t load your workspace.</strong>
                <span>{bootError}</span>
              </div>
              <button className="text-button" onClick={load}>
                Retry <RefreshCw size={13} />
              </button>
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Research needs your attention</strong>
                <span>{error}</span>
              </div>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {mutationError && (
            <div className="banner error" role="alert">
              <TriangleAlert size={18} />
              <span>{mutationError}</span>
              <button
                className="icon-button"
                onClick={() => setMutationError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {view === "research" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="mini-line" /> YOUR INDEPENDENT RESEARCH
                    COMMITTEE
                  </div>
                  <h1>
                    Conviction, with a<br />
                    <em>counterargument.</em>
                  </h1>
                  <p>
                    Good opportunities deserve hard questions. Set your goals.
                    <br className="desktop-break" /> Let a committee challenge
                    the thesis before you commit.
                  </p>
                  <div className="hero-proof">
                    <span>
                      <ShieldCheck size={14} /> Your risk limits come first
                    </span>
                    <i />
                    <span>
                      <GitBranch size={14} /> Every decision has a trail
                    </span>
                  </div>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="visual-grid" />
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <svg className="hero-trend" viewBox="0 0 400 180" fill="none">
                    <path
                      d="M8 156 40 148 63 157 88 128 112 137 133 99 155 115 177 78 203 87 225 55 246 67 276 34 299 46 325 17 350 28 380 3"
                      stroke="#9daafa"
                      strokeWidth="2"
                    />
                    <path
                      d="M8 156 40 148 63 157 88 128 112 137 133 99 155 115 177 78 203 87 225 55 246 67 276 34 299 46 325 17 350 28 380 3V180H8Z"
                      fill="url(#heroFill)"
                    />
                    <defs>
                      <linearGradient
                        id="heroFill"
                        x1="200"
                        y1="0"
                        x2="200"
                        y2="180"
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop stopColor="#c9d0ff" stopOpacity=".35" />
                        <stop offset="1" stopColor="#e6e9ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="floating-thesis">
                    <span className="visual-icon blue">
                      <TrendingUp size={17} />
                    </span>
                    <div>
                      <span>The opportunity</span>
                      <strong>What could go right?</strong>
                    </div>
                    <span className="visual-pill">Thesis</span>
                  </div>
                  <div className="floating-check">
                    <span className="visual-icon mint">
                      <ShieldCheck size={17} />
                    </span>
                    <div>
                      <span>The counterargument</span>
                      <strong>What are we missing?</strong>
                    </div>
                    <span className="visual-check">
                      <Check size={13} />
                    </span>
                  </div>
                  <span className="visual-caption">
                    THINK IN POSSIBILITIES. DECIDE WITH EVIDENCE.
                  </span>
                </div>
              </section>
              <section className="workspace-stats" aria-label="Research scope">
                <div>
                  <span className="stat-icon">
                    <Globe2 size={18} />
                  </span>
                  <div>
                    <strong>4 global markets</strong>
                    <span>One research workspace</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <Scale size={18} />
                  </span>
                  <div>
                    <strong>Independent perspectives</strong>
                    <span>Thesis, skeptic & risk review</span>
                  </div>
                </div>
                <div>
                  <span className="stat-icon">
                    <FileText size={18} />
                  </span>
                  <div>
                    <strong>Evidence you can inspect</strong>
                    <span>Sources, assumptions & limits</span>
                  </div>
                </div>
                <div className="stats-mode">
                  <Status tone={run?.mode === "live" ? "green" : "amber"}>
                    {run?.mode === "live" ? "Connected mode" : "Sample data"}
                  </Status>
                  <button
                    className="text-button"
                    onClick={() => navigate("integrations")}
                  >
                    View connections <ArrowUpRight size={13} />
                  </button>
                </div>
              </section>
              <div className="research-layout">
                <section className="brief-panel panel">
                  <div className="panel-heading">
                    <span className="section-icon">
                      <SlidersHorizontal size={17} />
                    </span>
                    <h2>Your research brief</h2>
                    <span className="step-label">01</span>
                  </div>
                  <p className="panel-intro">
                    Your goals set the direction.
                    <br />
                    Your limits set the boundaries.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void startResearch();
                    }}
                  >
                    <fieldset className="market-field">
                      <legend>Where do you want to explore?</legend>
                      <div className="market-grid">
                        {markets.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`market-option ${profile.markets.includes(m) ? "selected" : ""}`}
                            onClick={() => toggleMarket(m)}
                            aria-pressed={profile.markets.includes(m)}
                          >
                            <span className="market-flag">
                              {marketLabels[m].flag}
                            </span>
                            <span>{marketLabels[m].short}</span>
                            <span className="market-check">
                              {profile.markets.includes(m) && (
                                <Check size={10} />
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                      <p className="field-hint">Select one or more markets.</p>
                    </fieldset>
                    <div className="slider-field">
                      <div className="field-top">
                        <label htmlFor="return">
                          Annual return goal <CircleHelp size={12} />
                        </label>
                        <span className="field-value">
                          {profile.targetReturn}
                          <small>%</small>
                        </span>
                      </div>
                      <input
                        id="return"
                        type="range"
                        min="0"
                        max="60"
                        step="1"
                        value={profile.targetReturn}
                        onChange={(e) =>
                          change("targetReturn", +e.target.value)
                        }
                        style={
                          {
                            "--fill": `${(profile.targetReturn / 60) * 100}%`,
                          } as React.CSSProperties
                        }
                      />
                      <div className="range-labels">
                        <span>0%</span>
                        <span>60%</span>
                      </div>
                      <p className="field-hint">
                        A goal to evaluate, never a promised return.
                      </p>
                    </div>
                    <div className="slider-field">
                      <div className="field-top">
                        <label htmlFor="volatility">
                          Volatility comfort <Waves size={13} />
                        </label>
                        <span className="field-value">
                          {profile.maxVolatility}
                          <small>%</small>
                        </span>
                      </div>
                      <input
                        id="volatility"
                        type="range"
                        min="5"
                        max="80"
                        value={profile.maxVolatility}
                        onChange={(e) =>
                          change("maxVolatility", +e.target.value)
                        }
                        style={
                          {
                            "--fill": `${((profile.maxVolatility - 5) / 75) * 100}%`,
                          } as React.CSSProperties
                        }
                      />
                      <div className="range-labels">
                        <span>Steadier</span>
                        <span>More variable</span>
                      </div>
                      <p className="field-hint">
                        Annualized price variability.{" "}
                        {money(
                          (profile.capital * profile.maxVolatility) / 100,
                          profile.baseCurrency,
                        )}{" "}
                        on {money(profile.capital, profile.baseCurrency)} is one
                        standard deviation, not a loss cap.
                      </p>
                    </div>
                    <div className="brief-two-col">
                      <div className="select-field">
                        <label htmlFor="horizon">Time horizon</label>
                        <div className="select-wrap">
                          <select
                            id="horizon"
                            value={profile.horizonMonths}
                            onChange={(e) =>
                              change("horizonMonths", +e.target.value)
                            }
                          >
                            {[
                              [3, "3 months"],
                              [6, "6 months"],
                              [12, "1 year"],
                              [24, "2 years"],
                              [36, "3 years"],
                              [60, "5 years"],
                              [120, "10 years"],
                            ].map(([v, t]) => (
                              <option key={v} value={v}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      </div>
                      <div className="select-field">
                        <label htmlFor="drawdown">Drawdown ceiling</label>
                        <div className="select-wrap">
                          <select
                            id="drawdown"
                            value={profile.maxDrawdown}
                            onChange={(e) =>
                              change("maxDrawdown", +e.target.value)
                            }
                          >
                            {[5, 10, 15, 20, 25, 30, 40, 50, 60, 80].map(
                              (v) => (
                                <option key={v} value={v}>
                                  {v}% peak-to-trough
                                </option>
                              ),
                            )}
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="advanced-toggle"
                      onClick={() => setAdvanced(!advanced)}
                      aria-expanded={advanced}
                    >
                      <Settings2 size={14} /> Capital & preferences{" "}
                      <ChevronDown
                        size={13}
                        className={advanced ? "rotated" : ""}
                      />
                    </button>
                    {advanced && (
                      <div className="advanced-fields">
                        <div className="brief-two-col">
                          <div className="select-field">
                            <label htmlFor="capital">Research capital</label>
                            <input
                              id="capital"
                              type="number"
                              min="100"
                              max="1000000000"
                              value={profile.capital}
                              onChange={(e) =>
                                change("capital", +e.target.value)
                              }
                              required
                            />
                          </div>
                          <div className="select-field">
                            <label htmlFor="currency">Base currency</label>
                            <div className="select-wrap">
                              <select
                                id="currency"
                                value={profile.baseCurrency}
                                onChange={(e) =>
                                  change(
                                    "baseCurrency",
                                    e.target
                                      .value as ResearchProfile["baseCurrency"],
                                  )
                                }
                              >
                                {["USD", "INR", "CNY", "AED"].map((c) => (
                                  <option key={c}>{c}</option>
                                ))}
                              </select>
                              <ChevronDown size={13} />
                            </div>
                          </div>
                        </div>
                        <div className="select-field">
                          <label htmlFor="exclude">Exclude a sector</label>
                          <div className="select-wrap">
                            <select
                              id="exclude"
                              value={profile.excludedSectors[0] || ""}
                              onChange={(e) =>
                                change(
                                  "excludedSectors",
                                  e.target.value ? [e.target.value] : [],
                                )
                              }
                            >
                              <option value="">All sectors welcome</option>
                              {Array.from(
                                new Set(
                                  (bootstrap?.universe || []).map(
                                    (s) => s.sector,
                                  ),
                                ),
                              )
                                .sort()
                                .map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                            </select>
                            <ChevronDown size={13} />
                          </div>
                        </div>
                        <div className="select-field">
                          <label htmlFor="mode">Data & analysis mode</label>
                          <div className="select-wrap">
                            <select
                              id="mode"
                              value={profile.mode}
                              onChange={(e) =>
                                change(
                                  "mode",
                                  e.target.value as "sample" | "live",
                                )
                              }
                            >
                              <option value="sample">
                                Reproducible sample
                              </option>
                              <option value="live">
                                Connected · requires configured providers
                              </option>
                            </select>
                            <ChevronDown size={13} />
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="brief-divider" />
                    {bootstrap && !bootstrap.user.signedIn ? (
                      <a
                        className="primary-button run-button"
                        href="/signin-with-chatgpt?return_to=%2F"
                        target="_top"
                      >
                        <ShieldCheck size={16} /> Sign in to run research{" "}
                        <ArrowRight size={15} />
                      </a>
                    ) : (
                      <button
                        type="submit"
                        className="primary-button run-button"
                        disabled={running || !bootstrap}
                      >
                        {running ? (
                          <>
                            <Loader2 size={17} className="spinning" /> Committee
                            at work…
                          </>
                        ) : (
                          <>
                            <Sparkles size={17} /> Run research committee{" "}
                            <ArrowRight size={16} />
                          </>
                        )}
                      </button>
                    )}
                    <p className="run-caption">
                      <ShieldCheck size={12} /> Research support. Your decision,
                      always.
                    </p>
                  </form>
                </section>
                <section
                  className="results-panel"
                  ref={resultsRef}
                  aria-live="polite"
                  aria-busy={running}
                >
                  <div className="results-heading">
                    <div>
                      <div className="eyebrow small">
                        {run
                          ? "YOUR RESEARCH RESULTS"
                          : "THE OPPORTUNITY UNIVERSE"}
                      </div>
                      <h2>
                        {run
                          ? "An informed shortlist."
                          : "A world of possibilities."}
                      </h2>
                      <p>
                        {run
                          ? `${run.universeCount} companies reviewed · ${run.eligibleCount} within your risk limits`
                          : "Explore the sample universe, then put it to the test."}
                      </p>
                    </div>
                    {run ? (
                      <button
                        className="secondary-button compact"
                        onClick={() => setShowReport(true)}
                      >
                        <Download size={14} />
                        <span>Export</span>
                        <ChevronDown size={12} />
                      </button>
                    ) : (
                      <span className="round-icon">
                        <Globe2 size={21} />
                      </span>
                    )}
                  </div>
                  <div
                    className={`sample-notice ${run?.mode === "live" ? "live-notice" : ""}`}
                  >
                    <span className="notice-icon">
                      {run?.mode === "live" ? (
                        <Database size={15} />
                      ) : (
                        <FlaskIcon />
                      )}
                    </span>
                    <p>
                      {run?.mode === "live" ? (
                        <>
                          <strong>Connected research.</strong> Check each
                          source’s observation date, data provenance and model
                          trace.
                        </>
                      ) : (
                        <>
                          <strong>A transparent starting point.</strong>{" "}
                          Synthetic sample prices and fundamentals. Outputs
                          demonstrate the research process, not current
                          investment opportunities.
                        </>
                      )}
                    </p>
                    {!run && (
                      <button
                        onClick={() => navigate("methodology")}
                        aria-label="Read about sample data"
                      >
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                  {profileChanged && (
                    <div className="pending-brief">
                      <RefreshCw size={14} />
                      <span>
                        Your brief has changed. Run the committee to update
                        these results.
                      </span>
                    </div>
                  )}
                  {running ? (
                    <div className="research-loading">
                      <div className="loading-orbit">
                        <span />
                        <Sparkles size={27} />
                      </div>
                      <Status tone="blue">Research in progress</Status>
                      <h3>Putting your brief to the test.</h3>
                      <p>
                        The committee is checking evidence, calculating risk and
                        challenging the shortlist. The full decision trail
                        appears when the run completes.
                      </p>
                      <div className="loading-line">
                        <span />
                      </div>
                      <span className="loading-time">
                        {elapsed}s elapsed · Results are calculated on the
                        server
                      </span>
                    </div>
                  ) : (
                    <>
                      {run && (
                        <>
                          <div
                            className={`feasibility-card ${run.feasibility.status}`}
                          >
                            <span className="feasibility-icon">
                              {run.feasibility.status === "aligned" ? (
                                <ShieldCheck size={19} />
                              ) : (
                                <TriangleAlert size={19} />
                              )}
                            </span>
                            <div>
                              <strong>
                                {run.abstained
                                  ? "Sometimes the strongest thesis is to wait."
                                  : run.feasibility.status === "aligned"
                                    ? "Your brief has room to work."
                                    : run.feasibility.status === "stretch"
                                      ? "Your return goal needs a closer look."
                                      : "Your goals and limits are in tension."}
                              </strong>
                              <p>{run.feasibility.message}</p>
                            </div>
                          </div>
                          <div
                            className="result-tabs"
                            role="tablist"
                            aria-label="Research result views"
                          >
                            {(
                              [
                                {
                                  id: "opportunities",
                                  label: "Shortlist",
                                  icon: Compass,
                                },
                                {
                                  id: "committee",
                                  label: "Committee",
                                  icon: GitBranch,
                                },
                                {
                                  id: "stress",
                                  label: "Stress lab",
                                  icon: Waves,
                                },
                                {
                                  id: "evidence",
                                  label: "Evidence",
                                  icon: FileText,
                                },
                              ] as const
                            ).map((t) => (
                              <button
                                key={t.id}
                                role="tab"
                                aria-selected={tab === t.id}
                                className={tab === t.id ? "active" : ""}
                                onClick={() => setTab(t.id)}
                              >
                                <t.icon size={15} />
                                {t.label}
                                {t.id === "committee" && (
                                  <span>{run.events.length}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      {(!run || tab === "opportunities") && (
                        <>
                          <div className="list-toolbar">
                            <div className="filter-pills">
                              <button
                                className={filter === "all" ? "selected" : ""}
                                onClick={() => setFilter("all")}
                              >
                                {run ? "All reviewed" : "All companies"}
                                <span>{stocks.length}</span>
                              </button>
                              {run && (
                                <>
                                  <button
                                    className={
                                      filter === "qualified" ? "selected" : ""
                                    }
                                    onClick={() => setFilter("qualified")}
                                  >
                                    Qualified<span>{qualified.length}</span>
                                  </button>
                                  <button
                                    className={
                                      filter === "excluded" ? "selected" : ""
                                    }
                                    onClick={() => setFilter("excluded")}
                                  >
                                    Excluded
                                  </button>
                                </>
                              )}
                            </div>
                            <label className="search-control">
                              <Search size={15} />
                              <input
                                placeholder="Find a company"
                                aria-label="Search companies"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                              />
                              {search && (
                                <button
                                  onClick={() => setSearch("")}
                                  aria-label="Clear search"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </label>
                          </div>
                          {displayed.length === 0 ? (
                            <Empty
                              icon={Compass}
                              title={
                                search
                                  ? "No companies found."
                                  : "No companies meet these filters."
                              }
                            >
                              {search
                                ? "Try a company name, ticker or sector."
                                : "Your limits are doing their job. Explore the excluded companies to understand the tradeoffs, or revise your research brief."}
                            </Empty>
                          ) : (
                            <div className="opportunity-list">
                              {displayed.map((stock, index) => {
                                const opportunity =
                                  "score" in stock && "reasons" in stock
                                    ? (stock as Opportunity)
                                    : null;
                                return (
                                  <article
                                    className={`opportunity-card ${opportunity?.status === "excluded" ? "excluded-card" : ""}`}
                                    key={stock.symbol}
                                  >
                                    <div className="stock-top">
                                      <div
                                        className="company-icon"
                                        style={{
                                          background:
                                            palette[stock.sector] || "#e5e9f6",
                                        }}
                                      >
                                        {stock.symbol
                                          .replace(/[^A-Z]/g, "")
                                          .slice(0, 2) ||
                                          stock.name.slice(0, 2).toUpperCase()}
                                      </div>
                                      <button
                                        className="stock-name"
                                        onClick={() => setSelected(stock)}
                                      >
                                        <strong>
                                          {stock.name}
                                          <ArrowUpRight size={13} />
                                        </strong>
                                        <span>
                                          {stock.symbol} <i /> {stock.exchange}
                                        </span>
                                      </button>
                                      {opportunity ? (
                                        <span
                                          className={`fit-score ${opportunity.status}`}
                                        >
                                          <strong>
                                            {Math.round(opportunity.score)}
                                          </strong>
                                          <span>fit score</span>
                                        </span>
                                      ) : (
                                        <span className="unscreened-label">
                                          Unscreened
                                        </span>
                                      )}
                                      {run && (
                                        <button
                                          className={`icon-button save-button ${getSaved(stock.symbol) ? "is-saved" : ""}`}
                                          onClick={() => void save(stock)}
                                          disabled={saving === stock.symbol}
                                          aria-label={`${getSaved(stock.symbol) ? "Unsave" : "Save"} ${stock.name}`}
                                        >
                                          {saving === stock.symbol ? (
                                            <Loader2
                                              size={17}
                                              className="spinning"
                                            />
                                          ) : (
                                            <Bookmark
                                              size={17}
                                              fill={
                                                getSaved(stock.symbol)
                                                  ? "currentColor"
                                                  : "none"
                                              }
                                            />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                    <div className="stock-tags">
                                      <span>
                                        {marketLabels[stock.market].flag}{" "}
                                        {stock.market}
                                      </span>
                                      <span>{stock.sector}</span>
                                      {opportunity && (
                                        <span
                                          className={`stock-outcome ${opportunity.status}`}
                                        >
                                          {opportunity.status ===
                                          "qualified" ? (
                                            <>
                                              <Check size={11} /> Within limits
                                            </>
                                          ) : opportunity.status ===
                                            "excluded" ? (
                                            <>
                                              <X size={11} /> Outside limits
                                            </>
                                          ) : (
                                            "Watch closely"
                                          )}
                                        </span>
                                      )}
                                    </div>
                                    <div className="stock-metrics">
                                      <div>
                                        <span>Sample annual return</span>
                                        <strong
                                          className={
                                            stock.annualReturn >= 0
                                              ? "positive"
                                              : "negative"
                                          }
                                        >
                                          {pct(stock.annualReturn, true)}
                                        </strong>
                                      </div>
                                      <div>
                                        <span>Annualized volatility</span>
                                        <strong>
                                          {pct(stock.annualVolatility)}
                                        </strong>
                                      </div>
                                      <div>
                                        <span>Max. drawdown</span>
                                        <strong>
                                          {pct(-Math.abs(stock.maxDrawdown))}
                                        </strong>
                                      </div>
                                      <div className="sparkline-cell">
                                        <Sparkline
                                          prices={stock.prices}
                                          color={
                                            opportunity?.status === "excluded"
                                              ? "#a6adbd"
                                              : index % 3 === 1
                                                ? "#4c9b83"
                                                : "#6e83ee"
                                          }
                                        />
                                        <span>Sample path</span>
                                      </div>
                                    </div>
                                    <div className="stock-card-bottom">
                                      <p>
                                        {opportunity
                                          ? opportunity.reasons[0] ||
                                            stock.thesis
                                          : stock.thesis}
                                      </p>
                                      <div>
                                        <button
                                          className={`compare-check ${compare.includes(stock.symbol) ? "checked" : ""}`}
                                          onClick={() =>
                                            toggleCompare(stock.symbol)
                                          }
                                          disabled={
                                            compare.length >= 3 &&
                                            !compare.includes(stock.symbol)
                                          }
                                          aria-label={`Compare ${stock.name}`}
                                          aria-pressed={compare.includes(
                                            stock.symbol,
                                          )}
                                        >
                                          <span>
                                            {compare.includes(stock.symbol) && (
                                              <Check size={10} />
                                            )}
                                          </span>
                                          Compare
                                        </button>
                                        <button
                                          className="thesis-link"
                                          onClick={() => setSelected(stock)}
                                        >
                                          View thesis <ArrowRight size={13} />
                                        </button>
                                      </div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          )}
                          <div className="results-footnote">
                            <ShieldCheck size={13} />
                            <p>
                              {run
                                ? "Fit scores measure alignment with this brief. They are not return forecasts or probabilities of success."
                                : "Sample historical metrics are calculated from synthetic price paths. They do not represent actual company performance."}
                            </p>
                          </div>
                        </>
                      )}
                      {run && tab === "committee" && (
                        <section className="committee-panel panel">
                          <div className="inner-panel-head">
                            <div>
                              <h3>A committee with a paper trail.</h3>
                              <p>
                                Inspect what each specialist checked and
                                challenged.
                              </p>
                            </div>
                            <Status tone="green">
                              {
                                run.events.filter(
                                  (e) => e.status === "completed",
                                ).length
                              }{" "}
                              checks completed
                            </Status>
                          </div>
                          <div className="trace-summary">
                            <div>
                              <strong>
                                {new Set(run.events.map((e) => e.agent)).size}
                              </strong>
                              <span>specialist roles</span>
                            </div>
                            <div>
                              <strong>
                                {Math.max(
                                  ...run.events.map((e) => e.iteration),
                                  1,
                                )}
                              </strong>
                              <span>review rounds</span>
                            </div>
                            <div>
                              <strong>{run.cost.modelCalls}</strong>
                              <span>model calls</span>
                            </div>
                            <div>
                              <strong>
                                {format(run.durationMs / 1000, 2)}s
                              </strong>
                              <span>execution time</span>
                            </div>
                          </div>
                          <div className="trace-list">
                            {run.events.map((event, index) => (
                              <div
                                className={`trace-event ${event.status}`}
                                key={event.id}
                              >
                                <span className="trace-node">
                                  {event.status === "rejected" ? (
                                    <X size={12} />
                                  ) : event.status === "warning" ? (
                                    <TriangleAlert size={12} />
                                  ) : (
                                    <Check size={12} />
                                  )}
                                </span>
                                <div className="trace-content">
                                  <div className="trace-meta">
                                    <strong>{event.agent}</strong>
                                    <span>Round {event.iteration}</span>
                                    <time>
                                      {new Date(event.at).toLocaleTimeString(
                                        "en-GB",
                                        {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          second: "2-digit",
                                        },
                                      )}
                                    </time>
                                  </div>
                                  <h4>{event.action}</h4>
                                  <p>{event.detail}</p>
                                  <div className="trace-provenance">
                                    <span>
                                      <Zap size={11} />
                                      {event.model}
                                    </span>
                                    {event.evidenceIds.length > 0 && (
                                      <button
                                        onClick={() => setTab("evidence")}
                                      >
                                        <FileText size={11} />
                                        {event.evidenceIds.length} evidence
                                        references <ArrowUpRight size={10} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {run.memory.lessons.length > 0 && (
                            <div className="memory-card">
                              <Database size={17} />
                              <div>
                                <strong>
                                  {run.memory.reused
                                    ? "Context carried forward"
                                    : "Lessons retained for the next run"}
                                </strong>
                                {run.memory.lessons.map((l, i) => (
                                  <p key={i}>{l}</p>
                                ))}
                              </div>
                            </div>
                          )}
                          <p className="small-note">
                            Sample mode uses deterministic analytical roles.
                            Model names in this trace identify the actual
                            execution path; sample checks are not represented as
                            LLM calls.
                          </p>
                        </section>
                      )}
                      {run && tab === "stress" && (
                        <section className="stress-panel panel">
                          <div className="inner-panel-head">
                            <div>
                              <h3>Test the uncomfortable scenario.</h3>
                              <p>
                                A thesis is stronger when it survives a
                                challenge.
                              </p>
                            </div>
                            <span className="round-icon">
                              <Waves size={19} />
                            </span>
                          </div>
                          {run.scenarios.length > 0 ? (
                            <>
                              <div className="scenario-options">
                                {run.scenarios.map((s, i) => (
                                  <button
                                    key={s.name}
                                    onClick={() => setScenarioIndex(i)}
                                    className={
                                      scenarioIndex === i ? "selected" : ""
                                    }
                                  >
                                    {s.name}
                                    <ArrowDownRight size={14} />
                                  </button>
                                ))}
                              </div>
                              <div className="scenario-intro">
                                <Status tone="amber">
                                  Illustrative stress, not a forecast
                                </Status>
                                <h4>{run.scenarios[scenarioIndex]?.name}</h4>
                                <p>
                                  {run.scenarios[scenarioIndex]?.description}
                                </p>
                              </div>
                              <div className="stress-table">
                                <div className="stress-table-header">
                                  <span>Company</span>
                                  <span>Illustrative impact</span>
                                </div>
                                {run.scenarios[scenarioIndex]?.values.map(
                                  (v) => {
                                    const s = run.opportunities.find(
                                      (x) => x.symbol === v.symbol,
                                    );
                                    return (
                                      <div
                                        className="stress-row"
                                        key={v.symbol}
                                      >
                                        <div>
                                          <strong>{v.symbol}</strong>
                                          <span>{s?.name}</span>
                                        </div>
                                        <div className="stress-impact">
                                          <span className="stress-bar">
                                            <i
                                              style={{
                                                width: `${Math.min(100, Math.abs(v.impact))}%`,
                                              }}
                                            />
                                          </span>
                                          <strong
                                            className={
                                              v.impact < 0
                                                ? "negative"
                                                : "positive"
                                            }
                                          >
                                            {pct(v.impact, true)}
                                          </strong>
                                        </div>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                              <div className="caution-note">
                                <TriangleAlert size={15} />
                                <p>
                                  Scenario shocks are explicit assumptions, not
                                  probabilities. Losses can exceed these
                                  illustrations. Currency, tax, liquidity and
                                  execution costs require separate review.
                                </p>
                              </div>
                            </>
                          ) : (
                            <Empty
                              icon={Waves}
                              title="No scenario output in this run."
                            >
                              A new research run will evaluate available
                              candidates against the configured stress
                              assumptions.
                            </Empty>
                          )}
                        </section>
                      )}
                      {run && tab === "evidence" && (
                        <section className="evidence-panel panel">
                          <div className="inner-panel-head">
                            <div>
                              <h3>Show the receipts.</h3>
                              <p>
                                Follow every source. Challenge every assumption.
                              </p>
                            </div>
                            <span className="count-chip">
                              {run.evidence.length} records
                            </span>
                          </div>
                          <div className="evidence-list">
                            {run.evidence.map((e) => (
                              <article className="evidence-item" key={e.id}>
                                <span className="evidence-type-icon">
                                  <FileText size={18} />
                                </span>
                                <div>
                                  <div className="evidence-meta">
                                    <span>{e.publisher}</span>
                                    <span>{e.kind}</span>
                                    <span>{date(e.asOf)}</span>
                                  </div>
                                  <a
                                    href={e.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {e.title}
                                    <ExternalLink size={13} />
                                  </a>
                                  <p>{e.excerpt}</p>
                                  <div className="evidence-bottom">
                                    <code>{e.id}</code>
                                    {e.sample && (
                                      <Status tone="amber">
                                        Sample assumption
                                      </Status>
                                    )}
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>
                      )}
                      {run && run.warnings.length > 0 && (
                        <details className="warnings-details">
                          <summary>
                            <TriangleAlert size={14} />
                            {run.warnings.length} research limitations to review
                            <ChevronDown size={14} />
                          </summary>
                          <ul>
                            {run.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {view === "saved" && (
            <section className="secondary-view">
              <PageHeading
                eyebrow="YOUR RESEARCH, CARRIED FORWARD"
                title="Keep the thesis. Question it often."
                description="Save the idea and the condition that would change your mind."
                action={
                  <button
                    className="primary-button"
                    onClick={() => navigate("research")}
                  >
                    <Plus size={15} /> New research
                  </button>
                }
              />
              {watchlist.length === 0 ? (
                <div className="panel">
                  <Empty
                    icon={Bookmark}
                    title="Conviction deserves a record."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => navigate("research")}
                      >
                        Explore opportunities <ArrowRight size={15} />
                      </button>
                    }
                  >
                    Run the committee and save a company’s thesis. Its
                    invalidation condition and your research notes stay together
                    here.
                  </Empty>
                </div>
              ) : (
                <div className="saved-grid">
                  {watchlist.map((item) => (
                    <article className="saved-card panel" key={item.id}>
                      <div className="saved-header">
                        <div className="company-icon">
                          {item.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <h3>{item.name}</h3>
                          <span>
                            {item.symbol} · {marketLabels[item.market].flag}{" "}
                            {item.market}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => void deleteSaved(item)}
                          disabled={saving === item.id}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="invalidation-box">
                        <span>
                          <Target size={13} /> WHAT WOULD CHANGE MY MIND
                        </span>
                        <p>{item.invalidation}</p>
                      </div>
                      <label className="note-label" htmlFor={`note-${item.id}`}>
                        Your research note
                      </label>
                      <textarea
                        id={`note-${item.id}`}
                        placeholder="What should your future self remember?"
                        maxLength={4000}
                        value={draftNotes[item.id] ?? item.note}
                        onChange={(e) =>
                          setDraftNotes((d) => ({
                            ...d,
                            [item.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="saved-footer">
                        <span>Saved {date(item.createdAt)}</span>
                        <button
                          className="secondary-button compact"
                          onClick={() => void saveNote(item)}
                          disabled={saving === item.id}
                        >
                          {saving === item.id ? (
                            <Loader2 size={12} className="spinning" />
                          ) : (
                            <Check size={12} />
                          )}{" "}
                          Save note
                        </button>
                      </div>
                      <button
                        className="text-button saved-run-link"
                        onClick={async () => {
                          try {
                            const r = await api<ResearchRun>(
                              `/api/runs/${encodeURIComponent(item.runId)}`,
                            );
                            openHistory(r);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Open original research <ArrowUpRight size={12} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {view === "history" && (
            <section className="secondary-view">
              <PageHeading
                eyebrow="A DECISION TRAIL, NOT A BLACK BOX"
                title="Research has a memory."
                description="Revisit the brief, the counterargument and the evidence behind every run."
                action={
                  <button
                    className="secondary-button"
                    onClick={() => navigate("history")}
                  >
                    <RefreshCw
                      size={14}
                      className={historyLoading ? "spinning" : ""}
                    />{" "}
                    Refresh
                  </button>
                }
              />
              <div className="panel history-panel">
                {historyLoading && history.length === 0 ? (
                  <div className="loading-simple">
                    <Loader2 size={22} className="spinning" /> Loading research
                    history…
                  </div>
                ) : history.length === 0 ? (
                  <Empty
                    icon={History}
                    title="Your first research chapter starts here."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => navigate("research")}
                      >
                        Build a research brief <ArrowRight size={15} />
                      </button>
                    }
                  >
                    Completed runs preserve their preferences, outcomes, source
                    records and specialist trace.
                  </Empty>
                ) : (
                  history.map((item) => (
                    <button
                      className="history-row"
                      key={item.id}
                      onClick={() => openHistory(item)}
                    >
                      <span className="history-icon">
                        <FileText size={20} />
                      </span>
                      <div className="history-main">
                        <h3>{item.title}</h3>
                        <p>
                          {item.profile.markets.join(" + ")} <i />{" "}
                          {item.profile.targetReturn}% goal <i /> ≤
                          {item.profile.maxVolatility}% volatility <i />{" "}
                          {item.profile.horizonMonths} months
                        </p>
                        <span>
                          {date(item.createdAt)} ·{" "}
                          {new Date(item.createdAt).toLocaleTimeString(
                            "en-GB",
                            { hour: "2-digit", minute: "2-digit" },
                          )}
                        </span>
                      </div>
                      <Status tone={item.abstained ? "amber" : "green"}>
                        {item.abstained
                          ? "Committee abstained"
                          : `${item.eligibleCount} within limits`}
                      </Status>
                      <span className="history-mode">{item.mode}</span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))
                )}
              </div>
            </section>
          )}
          {view === "methodology" && (
            <section className="secondary-view methodology-view">
              <PageHeading
                eyebrow="THE PRINCIPLES BEHIND THE PRODUCT"
                title="Trust the process. Inspect the work."
                description="A good research system makes its limits as visible as its conclusions."
              />
              <div className="method-lead panel">
                <span className="method-icon">
                  <Scale size={30} />
                </span>
                <div>
                  <h2>
                    We are building a research committee,
                    <br />
                    <em>one that can say “not this time.”</em>
                  </h2>
                  <p>
                    Thesis tests a stock against your brief, sends the thesis to
                    a skeptic, and lets the risk guardian veto it. A high score
                    never overrides a failed hard limit. If the evidence or
                    preferences do not support a shortlist, the committee
                    abstains.
                  </p>
                </div>
              </div>
              <div className="method-grid">
                {[
                  {
                    n: "01",
                    icon: SlidersHorizontal,
                    title: "Start with the investor.",
                    text: "Markets, horizon, return goal, annualized volatility and peak-to-trough loss tolerance define the brief. Return targets are aspirations, never forecasts.",
                  },
                  {
                    n: "02",
                    icon: Database,
                    title: "Keep evidence attached.",
                    text: "Price paths, fundamental inputs and source records stay attached to the run. Sample assumptions are labeled and kept separate from verified live observations.",
                  },
                  {
                    n: "03",
                    icon: GitBranch,
                    title: "Invite a counterargument.",
                    text: "Quant and fundamental checks feed a skeptic review. Risk exclusions go back to the planner for reevaluation. The trace exposes the branch and its reason.",
                  },
                  {
                    n: "04",
                    icon: ShieldCheck,
                    title: "Respect hard boundaries.",
                    text: "Observed volatility and drawdown ceilings filter eligibility before ranking. Past risk measures are not limits on future losses. Research can end without a qualified idea.",
                  },
                ].map((m) => (
                  <article className="method-card panel" key={m.n}>
                    <div>
                      <m.icon size={20} />
                      <span>{m.n}</span>
                    </div>
                    <h3>{m.title}</h3>
                    <p>{m.text}</p>
                  </article>
                ))}
              </div>
              <section className="method-details panel">
                <h3>What the numbers mean</h3>
                <dl>
                  <div>
                    <dt>Annual return</dt>
                    <dd>
                      Annualized historical growth calculated from the
                      observation window. Synthetic in sample mode. It does not
                      estimate your future return.
                    </dd>
                  </div>
                  <div>
                    <dt>Annualized volatility</dt>
                    <dd>
                      The standard deviation of daily price returns, scaled
                      using 252 trading days. It describes variability, not
                      maximum loss or a guarantee of a normal distribution.
                    </dd>
                  </div>
                  <div>
                    <dt>Maximum drawdown</dt>
                    <dd>
                      The largest observed decline from a prior peak in the
                      supplied price path. Future losses can be larger.
                    </dd>
                  </div>
                  <div>
                    <dt>Fit score</dt>
                    <dd>
                      An explainable ranking within a particular brief. It is
                      neither a probability of success nor a recommendation to
                      buy. Risk gates remain separate from the score.
                    </dd>
                  </div>
                  <div>
                    <dt>Currency and horizon</dt>
                    <dd>
                      Stock returns are evaluated in listing currency. The base
                      currency provides capital context; it does not imply FX
                      hedging or currency-adjusted return estimates.
                    </dd>
                  </div>
                </dl>
                <p className="method-source">
                  Risk and diversification principles:{" "}
                  <a
                    href="https://www.investor.gov/introduction-investing/getting-started/asset-allocation"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Investor.gov <ExternalLink size={12} />
                  </a>
                </p>
              </section>
              <div className="method-disclaimer">
                <ShieldCheck size={18} />
                <p>
                  Thesis is an investment research tool. It does not execute
                  trades or provide personalized financial advice. Verify
                  current information, local market access, taxes, liquidity and
                  suitability before acting. Individual stocks can lose their
                  entire value.
                </p>
              </div>
            </section>
          )}
          {view === "integrations" && (
            <section className="secondary-view">
              <PageHeading
                eyebrow="BUILT TO SHOW ITS WORK"
                title="One workspace. An accountable stack."
                description="Connection status reflects server configuration. A configured provider is only verified after a successful request."
                action={
                  <button className="secondary-button" onClick={load}>
                    <RefreshCw size={14} /> Refresh status
                  </button>
                }
              />
              <div className="integration-note">
                <Database size={18} />
                <div>
                  <strong>Sample mode works without credentials.</strong>
                  <p>
                    It runs the same analytical workflow on synthetic fixtures.
                    Connected mode routes evidence and model requests through the
                    configured providers. Synthetic source data stays labeled as sample data.
                  </p>
                </div>
              </div>
              <div className="integration-grid">
                {(providers.length ? providers : fallbackProviders).map(
                  (p, i) => (
                    <article className="integration-card panel" key={p.name}>
                      <div className="integration-head">
                        <span
                          className={`integration-logo integration-${i % 3}`}
                        >
                          {/zetaris/i.test(p.name) ? (
                            <Database size={23} />
                          ) : /nightshift|nvidia|nemotron/i.test(p.name) ? (
                            <Zap size={23} />
                          ) : (
                            <GitBranch size={23} />
                          )}
                        </span>
                        <Status
                          tone={
                            p.status === "verified"
                              ? "green"
                              : p.status === "configured"
                                ? "blue"
                                : p.status === "sample"
                                  ? "amber"
                                  : "neutral"
                          }
                        >
                          {p.status}
                        </Status>
                      </div>
                      <h3>{p.name}</h3>
                      <p>{p.detail}</p>
                      <div className="integration-footer">
                        <span>
                          {/zetaris/i.test(p.name)
                            ? "Evidence & market data"
                            : /nightshift/i.test(p.name)
                              ? "Primary AI gateway"
                              : /nvidia|nemotron/i.test(p.name)
                                ? "Model provenance"
                                : "Context & reasoning"}
                        </span>
                        <span className="credential-label">
                          <ShieldCheck size={12} /> Server-side
                        </span>
                      </div>
                    </article>
                  ),
                )}
              </div>
              <section className="integration-how panel">
                <h3>From reproducible research to connected research.</h3>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Validate the workflow in sample mode.</strong>
                      <p>
                        Try different markets, impossible goals and strict risk
                        limits. The committee should respond to the brief and
                        show its reasoning.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Configure providers securely.</strong>
                      <p>
                        Set the environment variables documented in the
                        repository. Credentials belong on the server and are
                        never entered into this browser.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Run a connected research brief.</strong>
                      <p>
                        Select Connected under Capital & preferences. Inspect
                        the source timestamps and per-request model trace before
                        relying on a result.
                      </p>
                    </div>
                  </li>
                </ol>
                <button
                  className="primary-button"
                  onClick={() => {
                    setAdvanced(true);
                    navigate("research");
                  }}
                >
                  Open research workspace <ArrowRight size={15} />
                </button>
              </section>
            </section>
          )}
          <footer className="app-footer">
            <span>
              <Wordmark small /> Independent thinking, by design.
            </span>
            <span>
              Built by Shivam Gupta <i /> Open Agent Hackathon 2026
            </span>
          </footer>
        </main>
      </div>
      {compare.length > 0 && view === "research" && !compareOpen && (
        <div className="compare-tray">
          <span className="compare-tray-icon">
            <Scale size={19} />
          </span>
          <div>
            <strong>
              {compare.length} {compare.length === 1 ? "company" : "companies"}{" "}
              selected
            </strong>
            <span>Compare the tradeoffs side by side</span>
          </div>
          <div className="compare-tickers">
            {compare.map((s) => (
              <button key={s} onClick={() => toggleCompare(s)}>
                {s}
                <X size={11} />
              </button>
            ))}
          </div>
          <button
            className="primary-button compact"
            disabled={compare.length < 2}
            onClick={() => setCompareOpen(true)}
          >
            Compare <ArrowRight size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Clear comparison"
            onClick={() => setCompare([])}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selected && (
        <Modal
          className="detail-dialog"
          label={`${selected.name} research thesis`}
          onClose={() => setSelected(null)}
        >
          <div className="detail-heading">
            <div className="eyebrow small">THE THESIS, UNDER EXAMINATION</div>
            <div className="detail-company">
              <div
                className="company-icon big"
                style={{ background: palette[selected.sector] || "#e5e9f6" }}
              >
                {selected.symbol.replace(/[^A-Z]/g, "").slice(0, 2) ||
                  selected.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2>{selected.name}</h2>
                <span>
                  {selected.symbol} · {selected.exchange} · {selected.currency}
                </span>
              </div>
            </div>
            <div className="detail-tags">
              <Status
                tone={
                  "status" in selected && selected.status === "qualified"
                    ? "green"
                    : "status" in selected && selected.status === "excluded"
                      ? "red"
                      : "amber"
                }
              >
                {"status" in selected
                  ? selected.status === "qualified"
                    ? "Within this brief’s limits"
                    : selected.status === "excluded"
                      ? "Excluded by a hard limit"
                      : "Needs closer review"
                  : "Not yet screened"}
              </Status>
              <span>{selected.sector}</span>
              <span>
                {marketLabels[selected.market].flag} {selected.market}
              </span>
            </div>
          </div>
          <div className="detail-body">
            <div className="detail-data-warning">
              <FlaskIcon />
              <span>
                {run?.mode === "live"
                  ? "Source dates and provider provenance are attached to the run."
                  : "All displayed prices and fundamentals are synthetic sample assumptions."}
              </span>
            </div>
            <div className="detail-price">
              <div>
                <span>Sample price · {selected.currency}</span>
                <strong>{money(selected.price, selected.currency)}</strong>
              </div>
              <span>Fixture as of {date(selected.asOf)}</span>
            </div>
            <Sparkline prices={selected.prices} large />
            <div className="chart-caption">
              <span>Synthetic observation window</span>
              <span>Listing currency · no FX adjustment</span>
            </div>
            <div className="detail-metrics">
              <div>
                <span>Annualized return</span>
                <strong
                  className={
                    selected.annualReturn >= 0 ? "positive" : "negative"
                  }
                >
                  {pct(selected.annualReturn, true)}
                </strong>
              </div>
              <div>
                <span>Volatility</span>
                <strong>{pct(selected.annualVolatility)}</strong>
              </div>
              <div>
                <span>Max. drawdown</span>
                <strong>{pct(-Math.abs(selected.maxDrawdown))}</strong>
              </div>
              <div>
                <span>P/E · sample</span>
                <strong>{format(selected.pe)}×</strong>
              </div>
            </div>
            <div className="detail-thesis">
              <h3>The research thesis</h3>
              <p>{selected.thesis}</p>
            </div>
            <div className="bull-bear">
              <div className="bull-case">
                <h4>
                  <TrendingUp size={17} /> The opportunity
                </h4>
                <p>
                  {"bullCase" in selected
                    ? selected.bullCase
                    : selected.catalyst}
                </p>
              </div>
              <div className="bear-case">
                <h4>
                  <Scale size={17} /> The counterargument
                </h4>
                <p>
                  {"bearCase" in selected ? selected.bearCase : selected.risk}
                </p>
              </div>
            </div>
            {"metrics" in selected && (
              <section className="risk-gates">
                <h3>Against your hard limits</h3>
                {selected.metrics.map((m) => (
                  <div key={m.name}>
                    <span>
                      {m.passed ? <Check size={14} /> : <X size={14} />}{" "}
                      {m.name}
                    </span>
                    <strong>
                      {pct(m.value)} <small>ceiling {pct(m.limit)}</small>
                    </strong>
                    <Status tone={m.passed ? "green" : "red"}>
                      {m.passed ? "Passed" : "Failed"}
                    </Status>
                  </div>
                ))}
              </section>
            )}
            <div className="invalidation-box">
              <span>
                <Target size={14} /> WHAT WOULD CHANGE THE THESIS
              </span>
              <p>
                {"invalidation" in selected
                  ? selected.invalidation
                  : selected.risk}
              </p>
            </div>
            {"reasons" in selected && (
              <div className="detail-reasons">
                <h3>Why the committee reached this conclusion</h3>
                <ul>
                  {selected.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {selected.analystNote && (
                  <p className="analyst-note">{selected.analystNote}</p>
                )}
              </div>
            )}
            <section className="detail-sources">
              <h3>Evidence & source references</h3>
              {selected.evidence.map((e) => (
                <div className="detail-source" key={e.id}>
                  <FileText size={16} />
                  <div>
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      {e.title}
                      <ExternalLink size={12} />
                    </a>
                    <span>
                      {e.publisher} · {date(e.asOf)}
                      {e.sample ? " · Sample assumption" : ""}
                    </span>
                    <p>{e.excerpt}</p>
                  </div>
                </div>
              ))}
            </section>
            <p className="small-note">
              A company-level research brief is not a diversified portfolio or
              an instruction to trade. Past and simulated performance do not
              establish future outcomes.
            </p>
          </div>
          <div className="detail-footer">
            <button
              className="secondary-button"
              onClick={() => {
                toggleCompare(selected.symbol);
                setSelected(null);
              }}
            >
              <Scale size={15} />
              {compare.includes(selected.symbol)
                ? "Remove from comparison"
                : "Add to comparison"}
            </button>
            <button
              className="primary-button"
              onClick={() => void save(selected)}
              disabled={!run || saving === selected.symbol}
            >
              {saving === selected.symbol ? (
                <Loader2 size={15} className="spinning" />
              ) : (
                <Bookmark
                  size={15}
                  fill={getSaved(selected.symbol) ? "currentColor" : "none"}
                />
              )}{" "}
              {getSaved(selected.symbol) ? "Thesis saved" : "Save thesis"}
            </button>
          </div>
        </Modal>
      )}
      {compareOpen && (
        <Modal
          className="compare-dialog"
          label="Compare companies"
          onClose={() => setCompareOpen(false)}
        >
          <div className="modal-heading">
            <div className="eyebrow small">TRADEOFFS, SIDE BY SIDE</div>
            <h2>Compare the conviction.</h2>
            <p>Same brief. Different opportunities and vulnerabilities.</p>
          </div>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Research measure</th>
                  {selectedCompare.map((s) => (
                    <th key={s.symbol}>
                      <span className="compare-company-name">{s.name}</span>
                      <span>
                        {s.symbol} · {s.market}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Sample annual return",
                    (s: Stock) => pct(s.annualReturn, true),
                  ],
                  [
                    "Annualized volatility",
                    (s: Stock) => pct(s.annualVolatility),
                  ],
                  [
                    "Maximum drawdown",
                    (s: Stock) => pct(-Math.abs(s.maxDrawdown)),
                  ],
                  ["Sector", (s: Stock) => s.sector],
                  ["Sample P/E", (s: Stock) => `${format(s.pe)}×`],
                  [
                    "Revenue growth · sample",
                    (s: Stock) => pct(s.revenueGrowth),
                  ],
                  [
                    "Operating margin · sample",
                    (s: Stock) => pct(s.operatingMargin),
                  ],
                  [
                    "Debt / equity · sample",
                    (s: Stock) => format(s.debtToEquity),
                  ],
                  [
                    "Dividend yield · sample",
                    (s: Stock) => pct(s.dividendYield),
                  ],
                  ["The opportunity", (s: Stock) => s.catalyst],
                  ["The counterargument", (s: Stock) => s.risk],
                ].map(([label, get]) => (
                  <tr key={label as string}>
                    <th>{label as string}</th>
                    {selectedCompare.map((s) => (
                      <td key={s.symbol}>{(get as (s: Stock) => string)(s)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th>Research status</th>
                  {selectedCompare.map((s) => (
                    <td key={s.symbol}>
                      {"status" in s ? String(s.status) : "Unscreened"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="compare-disclaimer">
            <FlaskIcon />
            Sample metrics and assumptions. Cross-market figures are in their
            listing currencies.
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal
          className="help-dialog"
          label="Getting started with Thesis"
          onClose={() => setHelpOpen(false)}
        >
          <div className="modal-heading">
            <Wordmark />
            <h2>Meet your second opinion.</h2>
            <p>
              Thesis turns an investment goal into a research brief you can
              question.
            </p>
          </div>
          <div className="help-steps">
            {[
              {
                title: "Set the boundaries.",
                text: "Choose markets, a return goal, volatility comfort and a drawdown ceiling. The system tests whether the brief is internally consistent.",
              },
              {
                title: "Run the committee.",
                text: "Inspect the shortlist and the companies rejected by risk controls. Open the committee tab to see how the conclusion was reached.",
              },
              {
                title: "Save the argument, too.",
                text: "Compare companies, test stress assumptions and save the thesis with the condition that would change your mind.",
              },
            ].map((s, i) => (
              <div key={s.title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="help-sample">
            <FlaskIcon />
            <p>
              Start in sample mode. It uses synthetic prices and fundamentals so
              the workflow is reproducible without credentials. It does not
              display current investment recommendations.
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => {
              setHelpOpen(false);
              navigate("research");
            }}
          >
            Build my research brief <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {showReport && run && (
        <Modal
          className="report-dialog"
          label="Export research report"
          onClose={() => setShowReport(false)}
        >
          <div className="modal-heading">
            <div className="eyebrow small">TAKE THE EVIDENCE WITH YOU</div>
            <h2>A record of the decision.</h2>
            <p>
              Export the complete research run, including the brief, source
              records, scenario assumptions and committee trace.
            </p>
          </div>
          <div className="report-preview">
            <FileText size={26} />
            <div>
              <strong>{run.title}</strong>
              <span>
                {date(run.createdAt)} · {run.mode} mode · {run.events.length}{" "}
                trace events
              </span>
            </div>
          </div>
          <div className="report-actions">
            <button className="primary-button" onClick={exportRun}>
              <Download size={16} /> Download complete JSON
            </button>
            <a
              className="secondary-button"
              href={`/api/runs/${encodeURIComponent(run.id)}/report`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText size={16} /> Open print-ready report{" "}
              <ArrowUpRight size={13} />
            </a>
          </div>
          <p className="small-note">
            The exported report preserves the original sample or live
            provenance. JSON can be independently inspected or used to reproduce
            the result.
          </p>
        </Modal>
      )}
      {run && (
        <article className="print-report">
          <Wordmark />
          <h1>{run.title}</h1>
          <p>
            {date(run.createdAt)} · {run.mode.toUpperCase()} MODE · Research by
            Shivam Gupta
          </p>
          <h2>Research brief</h2>
          <p>
            {run.profile.markets.join(", ")} · Annual return goal{" "}
            {run.profile.targetReturn}% · Volatility ceiling{" "}
            {run.profile.maxVolatility}% · Drawdown ceiling{" "}
            {run.profile.maxDrawdown}% · Horizon {run.profile.horizonMonths}{" "}
            months
          </p>
          <p>{run.summary}</p>
          <h2>Feasibility</h2>
          <p>{run.feasibility.message}</p>
          {run.opportunities.map((s) => (
            <section key={s.symbol}>
              <h2>
                {s.name} ({s.symbol}) · {s.status}
              </h2>
              <p>{s.thesis}</p>
              <p>
                Sample annual return: {pct(s.annualReturn)} · Volatility:{" "}
                {pct(s.annualVolatility)} · Drawdown: {pct(s.maxDrawdown)} · Fit
                score: {s.score}
              </p>
              <p>
                <strong>Opportunity:</strong> {s.bullCase}
              </p>
              <p>
                <strong>Counterargument:</strong> {s.bearCase}
              </p>
              <p>
                <strong>Invalidation:</strong> {s.invalidation}
              </p>
            </section>
          ))}
          <h2>Research limitations</h2>
          <ul>
            {run.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <h2>Evidence</h2>
          {run.evidence.map((e) => (
            <p key={e.id}>
              {e.id} · {e.title} · {e.url} ·{" "}
              {e.sample ? "Sample assumption" : "Source observation"} · {e.asOf}
            </p>
          ))}
          <p>
            Investment research support. No guaranteed returns. Verify current
            sources and suitability before acting.
          </p>
        </article>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function FlaskIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 2h6M8 2v6l-4.5 7A2 2 0 0 0 5.2 18h9.6a2 2 0 0 0 1.7-3L12 8V2M6 12h8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="14.5" r=".8" fill="currentColor" />
    </svg>
  );
}
