"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ButtonHTMLAttributes,
} from "react";
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Database,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe2,
  KeyRound,
  Layers3,
  ListFilter,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Minus,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import type { Market } from "@/lib/contracts";
import { analyzeHistory } from "@/lib/finance/math";
import type {
  CompanyFundamentals,
  CompanyNews,
  FactorScore,
  HistoryAnalysis,
  InstrumentRef,
  MarketHistory,
  MarketProvider,
  MarketQuote,
  PortfolioSummary,
  PortfolioTrade,
  PositionValuation,
  ProviderResult,
} from "@/lib/finance/contracts";
import type {
  AIRole,
  AIProvider,
  CatalogModel,
  ModelAssignment,
  PublicAISettings,
  ResearchAgentInput,
  StructuredResearchReport,
} from "@/lib/ai/types";
import type { PersonalizedPlan, PlanProfile } from "@/lib/planning/contracts";
import type { SourceReviewReport } from "@/server/platform/source-review";
import {
  cancelGoogleMerge,
  completeGoogleMerge,
  connectGoogleAccount,
  newPrivateWorkspace,
  observeWorkspaceIdentity,
  workspaceFetch,
  type WorkspaceIdentity,
} from "@/lib/client/firebase-auth";
import "@/app/platform.css";

type View =
  | "portfolio"
  | "plan"
  | "markets"
  | "research"
  | "news"
  | "runs"
  | "watchlist"
  | "settings";
type SettingsTab = "ai" | "data" | "routing" | "account";
interface WatchItem {
  id: string;
  instrument: InstrumentRef;
  note: string;
  createdAt: string;
}
interface Job {
  result?: PersonalizedPlan | StructuredResearchReport | null;
  input?: unknown;
  id: string;
  kind?: "plan" | "research";
  status: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  message?: string;
  error?: string | { message: string };
  pollUrl?: string;
}
function jobDisplayTitle(job: Job): string {
  if (job.kind !== "plan" && job.result && "input" in job.result && job.result.input.question) return job.result.input.question;
  if (job.title) return job.title;
  const input = job.input && typeof job.input === "object" ? job.input as Record<string, unknown> : {};
  if (typeof input.question === "string" && input.question.trim()) return input.question;
  if (typeof input.goalDescription === "string" && input.goalDescription.trim()) return input.goalDescription;
  const instrument = input.instrument && typeof input.instrument === "object" ? input.instrument as Record<string, unknown> : {};
  if (typeof instrument.symbol === "string") return instrument.symbol + " source evidence review";
  return job.kind === "plan" ? "Personal investment plan" : "Investment research";
}
function jobDisplayStatus(job: Job): string {
  if (job.status === "completed" && job.kind !== "plan" && job.result && ["incomplete", "failed", "abstained"].includes(job.result.status)) return job.result.status;
  return job.status;
}
interface PublicDataProvider {
  entitlementAcknowledged?: boolean;
  premiumHistory?: boolean;
  minuteBudget?: number | null;
  dayBudget?: number | null;
  id: MarketProvider;
  name: string;
  keyConfigured: boolean;
  keyLast4: string | null;
  test?: { status: string; message: string; checkedAt?: string } | null;
  capabilities?: Record<string, boolean>;
  note?: string;
}
interface DataSettings {
  selected: MarketProvider;
  providers: PublicDataProvider[];
}
type DataPurpose =
  | "quoteProvider"
  | "historyProvider"
  | "fundamentalsProvider"
  | "newsProvider";
interface Preferences {
  quoteProvider?: MarketProvider | null;
  historyProvider?: MarketProvider | null;
  fundamentalsProvider?: MarketProvider | null;
  newsProvider?: MarketProvider | null;
  dataProvider: MarketProvider;
  costBasis: "fifo" | "average";
  baseCurrency: string;
}
export interface PlatformBootstrap {
  user: { name: string; email?: string | null; isAnonymous?: boolean };
  settings: PublicAISettings;
  dataProviders: DataSettings;
  portfolio: PortfolioSummary;
  trades: PortfolioTrade[];
  watchlist: WatchItem[];
  runs: Job[];
  plans: (Job | PersonalizedPlan)[];
  availability?: Record<string, unknown>;
  preferences?: Preferences;
}
interface MarketItem extends InstrumentRef {
  sector?: string | null;
  assetClass?: string;
  quote: ProviderResult<MarketQuote> | null;
  history?: ProviderResult<MarketHistory>;
  analysis?: HistoryAnalysis;
  factors?: FactorScore;
}
interface QuantitativeScan {
  startedAt: string;
  completedAt: string;
  inputs: { markets: Market[]; sectors: string[]; limit: number };
  factors: FactorScore[];
  history: { instrument: InstrumentRef; analysis: HistoryAnalysis | null }[];
  sources: {
    instrument: InstrumentRef;
    history: ProviderResult<MarketHistory>["provenance"] | null;
    fundamentals: ProviderResult<CompanyFundamentals>["provenance"] | null;
  }[];
  warnings: string[];
}
interface MarketsResponse {
  instruments: MarketItem[];
  coverage?: unknown;
  asOf?: string | null;
  warnings?: string[];
}
type NewsArticle = Omit<CompanyNews, "instrument" | "publishedAt"> & {
  instrument: InstrumentRef | null;
  publishedAt: string | null;
  indexedAt?: string;
  dateType?: string;
};
interface NewsResponse {
  provenance?: { provider: string };
  data?: NewsArticle[] | null;
  articles?: NewsArticle[];
  results?: ProviderResult<NewsArticle[]>[];
  status?: string;
  warnings?: string[];
}
const REGIONS: Market[] = ["US", "India", "China", "UAE"];
const REGION: Record<Market, { name: string; flag: string }> = {
  US: { name: "United States", flag: "🇺🇸" },
  India: { name: "India", flag: "🇮🇳" },
  China: { name: "China", flag: "🇨🇳" },
  UAE: { name: "United Arab Emirates", flag: "🇦🇪" },
};
const SECTORS = [
  "Technology",
  "Financials",
  "Healthcare",
  "Consumer Discretionary",
  "Consumer Staples",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Communication Services",
  "Materials",
];
const CURRENCIES = [
  "USD",
  "INR",
  "CNY",
  "HKD",
  "AED",
  "EUR",
  "GBP",
  "SGD",
  "JPY",
  "CAD",
  "AUD",
];
const ROLE_NAMES: Record<AIRole, string> = {
  planner: "Planner",
  fundamentals: "Fundamentals",
  quant: "Quantitative analyst",
  news: "News analyst",
  skeptic: "Skeptic",
  evaluator: "Evaluator",
};
const PROVIDER_NAMES: Record<AIProvider, string> = {
  nvidia: "NVIDIA",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  nightshift: "Nightshift",
};
const COLORS = [
  "#3b5bdb",
  "#7589e9",
  "#abb8f2",
  "#3c9d8c",
  "#8ac5bc",
  "#c0dbd3",
  "#e7b86e",
  "#d38b84",
];
const amount = (
  value: number | null | undefined,
  currency = "USD",
  digits = 0,
) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value)
    : "Unavailable";
const observedAmount = (
  value: number | null | undefined,
  currency?: string | null,
  digits = 2,
) =>
  currency
    ? amount(value, currency, digits)
    : typeof value === "number" && Number.isFinite(value)
      ? `${value.toFixed(digits)} · currency unreported`
      : "Unavailable";
const num = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(
        value,
      )
    : "Unavailable";
const percent = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`
    : "Unavailable";
const day = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date unavailable";
const when = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not reported";
const refKey = (instrument: InstrumentRef) =>
  `${instrument.market}:${instrument.exchange || "?"}:${instrument.symbol}`;
const safeLink = (url?: string) => !!url && /^https:\/\//i.test(url);
const activeJob = (job: Job) =>
  ["queued", "running", "pending"].includes(job.status);
const localDate = (value = new Date()) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
class APIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "APIRequestError";
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await workspaceFetch(
    path.startsWith("/api/platform/") ? path : `/api/platform/${path}`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(method === "POST" && ["research", "plans"].includes(path)
          ? { "x-idempotency-key": crypto.randomUUID() }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    },
  );
  const data: unknown = await response.json().catch(() => ({
    error: "The server returned an unreadable response. Please retry.",
  }));
  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data ? data.error : null;
    throw new APIRequestError(
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String(error.message)
          : `The request could not be completed (${response.status}).`,
      response.status,
      data,
    );
  }
  return data as T;
}
function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Brand() {
  return (
    <span className="tp-brand">
      <span className="tp-brand-mark">
        <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path
            d="M6 6h17M14 6v17M7 23 21 6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      thesis<span className="tp-brand-dot">.</span>
    </span>
  );
}
function Button({
  children,
  variant = "secondary",
  small = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  small?: boolean;
}) {
  return (
    <button
      className={`tp-btn tp-btn-${variant} ${small ? "tp-btn-small" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
function IconButton({
  children,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="tp-icon-btn" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red";
}) {
  return (
    <span className={`tp-status tp-status-${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Empty({
  icon: Icon = Layers3,
  title,
  children,
  action,
}: {
  icon?: typeof Layers3;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="tp-empty">
      <span className="tp-empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Notice({
  children,
  tone = "info",
  onClose,
}: {
  children: ReactNode;
  tone?: "info" | "error" | "warning";
  onClose?: () => void;
}) {
  return (
    <div
      className={`tp-notice tp-notice-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span>
        {tone === "error" ? (
          <CircleHelp size={18} />
        ) : (
          <ShieldCheck size={18} />
        )}
      </span>
      <div>{children}</div>
      {onClose && (
        <IconButton label="Dismiss message" onClick={onClose}>
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="tp-page-heading">
      <div>
        {eyebrow && <p className="tp-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {body && <p>{body}</p>}
      </div>
      {actions && <div className="tp-heading-actions">{actions}</div>}
    </div>
  );
}
function PanelHead({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="tp-panel-head">
      <div>
        <h2>{title}</h2>
        {body && <p>{body}</p>}
      </div>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      dialog?.close();
      requestAnimationFrame(() => {
        if (
          previous instanceof HTMLElement &&
          previous.isConnected &&
          !previous.closest("[inert]")
        )
          previous.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`tp-modal ${wide ? "tp-modal-wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="tp-modal-inner">
        <div className="tp-modal-top">
          <h2>{title}</h2>
          <IconButton label="Close dialog" disabled={busy} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
interface ConfirmedAction {
  title: string;
  body: string;
  confirmLabel: string;
  run: () => Promise<void>;
}
function useConfirmedAction() {
  const [action, setAction] = useState<ConfirmedAction | null>(null);
  const cancel = useCallback(() => setAction(null), []);
  return {
    confirm: (next: ConfirmedAction) => setAction(next),
    cancel,
    confirmation: action ? (
      <ConfirmationDialog action={action} onClose={cancel} />
    ) : null,
  };
}
function ConfirmationDialog({
  action,
  onClose,
}: {
  action: ConfirmedAction;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const execute = async () => {
    setWorking(true);
    setError("");
    try {
      await action.run();
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The request could not be completed. Please retry.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <Modal title={action.title} onClose={onClose} busy={working}>
      <div className="tp-dialog-body tp-form">
        <p className="tp-form-intro">{action.body}</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="tp-dialog-actions">
          <Button autoFocus disabled={working} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={working}
            onClick={() => void execute()}
          >
            {working ? (
              <Loader2 size={16} className="tp-spin" />
            ) : (
              <Trash2 size={16} />
            )}{" "}
            {action.confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SectorPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value),
    [search, setSearch] = useState("");
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="tp-select-popover" ref={ref}>
      <button
        type="button"
        ref={trigger}
        className="tp-filter-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setDraft(value);
          setSearch("");
          setOpen(!open);
        }}
      >
        <ListFilter size={15} />
        {!value.length
          ? "All sectors"
          : value.length === 1
            ? value[0]
            : `${value.length} sectors`}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="tp-sector-menu"
          id={id}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="tp-popover-heading">
            <strong>Choose sectors</strong>
            <button type="button" onClick={() => setDraft([])}>
              Select all
            </button>
          </div>
          <input
            ref={searchRef}
            className="tp-sector-search"
            aria-label="Search sectors"
            placeholder="Search sectors"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={!draft.length}
              onChange={() => setDraft([])}
            />
            All sectors
          </label>
          {SECTORS.filter((sector) =>
            sector.toLowerCase().includes(search.toLowerCase()),
          ).map((sector) => (
            <label key={sector}>
              <input
                type="checkbox"
                checked={draft.includes(sector)}
                onChange={() =>
                  setDraft((current) =>
                    current.includes(sector)
                      ? current.filter((s) => s !== sector)
                      : [...current, sector],
                  )
                }
              />
              {sector}
            </label>
          ))}
          <div className="tp-popover-footer">
            <Button type="button" small onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              small
              variant="primary"
              onClick={() => {
                onChange(draft);
                close();
              }}
            >
              {" "}
              Apply{draft.length ? ` (${draft.length})` : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
function RegionPicker({
  value,
  onChange,
}: {
  value: Market[];
  onChange: (value: Market[]) => void;
}) {
  return (
    <div className="tp-region-picker" role="group" aria-label="Markets">
      {REGIONS.map((region) => (
        <button
          type="button"
          key={region}
          className={value.includes(region) ? "selected" : ""}
          aria-pressed={value.includes(region)}
          onClick={() =>
            onChange(
              value.includes(region)
                ? value.length > 1
                  ? value.filter((r) => r !== region)
                  : value
                : [...value, region],
            )
          }
        >
          <span>{REGION[region].flag}</span>
          {region === "US" ? "US" : region}
          <span className="tp-region-check">
            {value.includes(region) && <Check size={10} />}
          </span>
        </button>
      ))}
    </div>
  );
}
function QuoteChart({ history }: { history: MarketHistory }) {
  const id = useId();
  const bars = history.bars.filter((b) => Number.isFinite(b.close));
  if (bars.length < 2)
    return (
      <Empty icon={ChartNoAxesCombined} title="Not enough dated observations">
        This provider has not returned enough price history to draw a chart.
      </Empty>
    );
  const min = Math.min(...bars.map((b) => b.close)),
    max = Math.max(...bars.map((b) => b.close)),
    span = max - min || 1;
  const path = bars
    .map(
      (bar, i) =>
        `${i ? "L" : "M"}${((i / (bars.length - 1)) * 900).toFixed(2)},${(215 - ((bar.close - min) / span) * 190).toFixed(2)}`,
    )
    .join(" ");
  return (
    <div className="tp-price-chart">
      <div className="tp-chart-axis">
        <span>{observedAmount(max, history.currency, 2)}</span>
        <span>{observedAmount(min, history.currency, 2)}</span>
      </div>
      <svg
        viewBox="0 0 900 240"
        role="img"
        aria-label={`Observed closing prices from ${bars[0].date} to ${bars[bars.length - 1].date}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a65df" stopOpacity=".18" />
            <stop offset="100%" stopColor="#4a65df" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 90, 155, 215].map((y) => (
          <line
            key={y}
            x1="0"
            x2="900"
            y1={y}
            y2={y}
            stroke="#e8edf5"
            strokeDasharray="4 5"
          />
        ))}
        <path d={`${path} L900,240 L0,240 Z`} fill={`url(#${id})`} />
        <path
          d={path}
          fill="none"
          stroke="#4562d8"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="tp-chart-dates">
        <span>{day(bars[0].date)}</span>
        <span>{day(bars[bars.length - 1].date)}</span>
      </div>
      <p className="tp-caption">
        {bars.length} dated observations ·{" "}
        {history.currency || "Currency unreported"} ·{" "}
        {history.adjustment.replaceAll("_", " ")}
      </p>
    </div>
  );
}
function AllocationChart({
  positions,
  currency,
}: {
  positions: PositionValuation[];
  currency: string;
}) {
  const [basis, setBasis] = useState<"cost" | "value">("cost");
  const rows = positions
    .filter((p) => p.currency === currency && p.quantity > 0)
    .map((p) => ({
      name: p.instrument.name || p.instrument.symbol,
      symbol: p.instrument.symbol,
      value: basis === "cost" ? p.costBasis : p.marketValue,
    }))
    .filter(
      (p): p is typeof p & { value: number } => p.value !== null && p.value > 0,
    )
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, p) => s + p.value, 0);
  let offset = 0;
  return (
    <section className="tp-panel tp-allocation">
      <PanelHead
        title="Portfolio composition"
        body={
          basis === "cost"
            ? "Based on recorded acquisition costs."
            : "Based on positions with an available valuation."
        }
        action={
          <div className="tp-segment">
            <button
              className={basis === "cost" ? "active" : ""}
              onClick={() => setBasis("cost")}
            >
              Cost basis
            </button>
            <button
              className={basis === "value" ? "active" : ""}
              onClick={() => setBasis("value")}
            >
              Market value
            </button>
          </div>
        }
      />
      {!rows.length ? (
        <Empty
          icon={ChartNoAxesCombined}
          title={
            positions.length
              ? "No valuation available yet"
              : "A clear view of what you own"
          }
        >
          {positions.length
            ? "Connect a market data provider to value these positions, or view their recorded cost basis."
            : "Add your holdings to see how your capital is distributed across companies."}
        </Empty>
      ) : (
        <div className="tp-allocation-content">
          <div className="tp-donut">
            <svg
              viewBox="0 0 200 200"
              role="img"
              aria-label={`Allocation by ${basis === "cost" ? "cost basis" : "priced market value"} in ${currency}`}
            >
              <circle
                cx="100"
                cy="100"
                r="76"
                fill="none"
                stroke="#edf0f8"
                strokeWidth="24"
              />
              {rows.map((row, index) => {
                const length = (row.value / total) * 477.52;
                const element = (
                  <circle
                    key={row.symbol}
                    cx="100"
                    cy="100"
                    r="76"
                    fill="none"
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth="24"
                    strokeDasharray={`${length} ${477.52 - length}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 100 100)"
                  />
                );
                offset += length;
                return element;
              })}
            </svg>
            <div>
              <small>
                {basis === "cost" ? "Recorded cost" : "Priced value"}
              </small>
              <strong>{amount(total, currency)}</strong>
              <span>{currency}</span>
            </div>
          </div>
          <div className="tp-allocation-legend">
            {rows.map((row, index) => (
              <div key={row.symbol}>
                <i style={{ background: COLORS[index % COLORS.length] }} />
                <span>
                  <strong>{row.symbol}</strong>
                  <small>{row.name}</small>
                </span>
                <b>{((row.value / total) * 100).toFixed(1)}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
function Article({ article }: { article: NewsArticle }) {
  const date = article.publishedAt || article.indexedAt;
  const indexed = !article.publishedAt && !!article.indexedAt;
  return (
    <article className="tp-news-card">
      <div className="tp-article-meta">
        <span>{article.source}</span>
        <i />
        <time dateTime={date || undefined}>
          {indexed ? "Indexed " : ""}
          {when(date)}
        </time>
        {article.instrument && (
          <span className="tp-symbol-tag">{article.instrument.symbol}</span>
        )}
      </div>
      <h3>
        {safeLink(article.url) ? (
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            {article.headline}
            <ArrowUpRight size={17} />
          </a>
        ) : (
          article.headline
        )}
      </h3>
      <p>{article.summary}</p>
      {article.sentiment && (
        <span className="tp-caption">
          {article.sentiment.label} · {article.sentiment.provider}
        </span>
      )}
    </article>
  );
}

export default function ThesisPlatform() {
  const {
    confirm,
    confirmation,
    cancel: cancelConfirmation,
  } = useConfirmedAction();
  const [view, setView] = useState<View>("portfolio"),
    [settingsTab, setSettingsTab] = useState<SettingsTab>("ai");
  const [data, setData] = useState<PlatformBootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null),
    [mobile, setMobile] = useState(false),
    [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const [regions, setRegions] = useState<Market[]>([...REGIONS]),
    [sectors, setSectors] = useState<string[]>([]),
    [marketQuery, setMarketQuery] = useState(""),
    [submittedQuery, setSubmittedQuery] = useState("");
  const [scan, setScan] = useState<QuantitativeScan | null>(null),
    [scanBusy, setScanBusy] = useState(false),
    [scanError, setScanError] = useState("");
  const [marketResult, setMarketResult] = useState<MarketsResponse | null>(
      null,
    ),
    [marketLoading, setMarketLoading] = useState(false),
    [marketError, setMarketError] = useState("");
  const [news, setNews] = useState<NewsArticle[]>([]),
    [newsWarnings, setNewsWarnings] = useState<string[]>([]),
    [newsSource, setNewsSource] = useState(""),
    [newsLoading, setNewsLoading] = useState(false),
    [newsError, setNewsError] = useState(""),
    [newsScope, setNewsScope] = useState<"portfolio" | "watchlist" | "markets">(
      "portfolio",
    );
  const [currency, setCurrency] = useState("USD"),
    [portfolioTab, setPortfolioTab] = useState<"holdings" | "transactions">(
      "holdings",
    );
  const [tradeModal, setTradeModal] = useState<{
      trade?: PortfolioTrade;
      instrument?: InstrumentRef;
      opening?: boolean;
    } | null>(null),
    [watchModal, setWatchModal] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null),
    [selectedAsset, setSelectedAsset] = useState<InstrumentRef | null>(null),
    [selectedReport, setSelectedReport] =
      useState<StructuredResearchReport | null>(null),
    [selectedPlan, setSelectedPlan] = useState<PersonalizedPlan | null>(null);
  const [planWizard, setPlanWizard] = useState(false),
    [planSeed, setPlanSeed] = useState<PlanProfile | null>(null),
    [googleMerge, setGoogleMerge] = useState(false),
    [pending, setPending] = useState<Job[]>([]),
    [watchNotes, setWatchNotes] = useState<Record<string, string>>({});
  const [researchInput, setResearchInput] = useState<ResearchAgentInput>({
    markets: [...REGIONS],
    sectors: [],
    symbols: [],
    question: "",
    risk: {
      targetReturn: 8,
      maxVolatility: 20,
      maxDrawdown: 20,
      horizonMonths: 36,
    },
  });
  const [researchScope, setResearchScope] = useState<"custom" | "portfolio">(
    "custom",
  );
  const navRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLButtonElement>(null),
    previousUid = useRef<string | null>(null),
    loadEpoch = useRef(0),
    identityEpoch = useRef(0),
    marketEpoch = useRef(0),
    newsEpoch = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await request<PlatformBootstrap>("bootstrap");
      if (
        !result.portfolio ||
        !Array.isArray(result.portfolio.positions) ||
        !Array.isArray(result.trades) ||
        !result.settings
      )
        throw new Error("The workspace response is incomplete. Please retry.");
      if (epoch !== loadEpoch.current) return;
      setData(result);
      setPending((current) => {
        const known = [
          ...result.runs,
          ...result.plans.filter((p): p is Job => !("allocations" in p)),
        ].filter(activeJob);
        return [
          ...known,
          ...current.filter(
            (job) => !known.some((k) => k.id === job.id) && activeJob(job),
          ),
        ];
      });
    } catch (error) {
      if (epoch === loadEpoch.current) setLoadError((error as Error).message);
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return observeWorkspaceIdentity((user) => {
      setIdentity(user);
      if (previousUid.current && previousUid.current !== user?.uid) {
        identityEpoch.current++;
        loadEpoch.current++;
        setScan(null);
        setScanError("");
        setScanBusy(false);
        setMarketResult(null);
        setMarketQuery("");
        setSubmittedQuery("");
        setActionError("");
        setNews([]);
        setNewsWarnings([]);
        setNewsSource("");
        setResearchScope("custom");
        setResearchInput((current) => ({
          ...current,
          question: "",
          portfolioContext: undefined,
          symbols: [],
        }));
        setData(null);
        cancelConfirmation();
        setSelectedJob(null);
        setSelectedPlan(null);
        setSelectedReport(null);
        setSelectedAsset(null);
        setTradeModal(null);
        setWatchModal(false);
        setPlanWizard(false);
        setPlanSeed(null);
        setWatchNotes({});
        setPending([]);
        setLoading(true);
        if (user?.uid) void load();
      }
      if (user?.uid) previousUid.current = user.uid;
    });
  }, [load]);
  useEffect(() => {
    const q = matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(q.matches);
      if (!q.matches) setNavOpen(false);
    };
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!navOpen || !mobile) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      Array.from(
        navRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href]",
        ) || [],
      );
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      const items = controls();
      if (event.key === "Escape") {
        event.preventDefault();
        setNavOpen(false);
      }
      if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", onKey);
      menuRef.current?.focus();
    };
  }, [navOpen, mobile]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!data) return;
    const list = data.portfolio.byCurrency.map((group) => group.currency);
    if (list.length && !list.includes(currency)) setCurrency(list[0]);
  }, [data, currency]);
  const go = (next: View) => {
    setView(next);
    setNavOpen(false);
    setActionError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const newPlan = (initial?: PlanProfile) => {
    setPlanSeed(initial || null);
    setPlanWizard(true);
  };
  const settings = (tab: SettingsTab = "ai") => {
    setSettingsTab(tab);
    go("settings");
  };
  const perform = async (
    key: string,
    action: () => Promise<unknown>,
    message?: string,
  ) => {
    setBusy(key);
    setActionError("");
    try {
      await action();
      await load();
      if (message) setNotice(message);
      return true;
    } catch (error) {
      setActionError((error as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const refreshMarkets = useCallback(async () => {
    const epoch = identityEpoch.current;
    const sequence = ++marketEpoch.current;
    setMarketLoading(true);
    setMarketError("");
    try {
      const params = new URLSearchParams({
        q: submittedQuery,
        markets: regions.join(","),
        sectors: sectors.join(","),
      });
      const result = await request<MarketsResponse>(`markets?${params}`);
      if (!Array.isArray(result.instruments))
        throw new Error(
          "The market response did not include an instrument list.",
        );
      if (epoch === identityEpoch.current && sequence === marketEpoch.current)
        setMarketResult(result);
    } catch (error) {
      if (epoch === identityEpoch.current && sequence === marketEpoch.current)
        setMarketError((error as Error).message);
    } finally {
      if (epoch === identityEpoch.current && sequence === marketEpoch.current)
        setMarketLoading(false);
    }
  }, [submittedQuery, regions, sectors]);
  useEffect(() => {
    if (view === "markets" && data) void refreshMarkets();
  }, [view, data?.dataProviders.selected, refreshMarkets]);
  const refreshNews = useCallback(async () => {
    const epoch = identityEpoch.current;
    const sequence = ++newsEpoch.current;
    setNewsLoading(true);
    setNewsError("");
    setNewsWarnings([]);
    try {
      const response = await request<NewsResponse>(
        `news?scope=${newsScope}&markets=${regions.join(",")}`,
      );
      const articles =
        response.data ||
        response.articles ||
        response.results?.flatMap((result) => result.data || []) ||
        [];
      if (epoch !== identityEpoch.current || sequence !== newsEpoch.current)
        return;
      setNews(articles);
      setNewsSource(response.provenance?.provider || "");
      const warnings = [
        ...(response.warnings || []),
        ...(response.results || []).flatMap((result) => result.warnings || []),
      ];
      setNewsWarnings(warnings);
    } catch (error) {
      if (epoch === identityEpoch.current && sequence === newsEpoch.current)
        setNewsError((error as Error).message);
    } finally {
      if (epoch === identityEpoch.current && sequence === newsEpoch.current)
        setNewsLoading(false);
    }
  }, [newsScope, regions]);
  useEffect(() => {
    if (view === "news" && data) void refreshNews();
  }, [view, data?.dataProviders.selected, refreshNews]);
  const onJob = async (
    kind: "plan" | "research" | "source-review",
    body: PlanProfile | ResearchAgentInput | { instrument: InstrumentRef },
  ) => {
    const epoch = identityEpoch.current;
    const result = await request<
      Job | PersonalizedPlan | StructuredResearchReport
    >(kind === "plan" ? "plans" : kind, "POST", body);
    if (epoch !== identityEpoch.current)
      throw new Error(
        "Your workspace changed while this request was sent. Return to the original account to inspect its run.",
      );
    if ("allocations" in result) {
      setSelectedPlan(result);
      setPlanWizard(false);
      await load();
      return;
    }
    if ("findings" in result) {
      setSelectedReport(result);
      await load();
      return;
    }
    const job: Job = {
      ...result,
      kind: kind === "plan" ? "plan" : "research",
    };
    if (job.status === "completed") {
      await openJob(job);
      await load();
      return;
    }
    setPending((current) => [job, ...current.filter((j) => j.id !== job.id)]);
    setPlanWizard(false);
    setNotice(
      `${kind === "plan" ? "Your investment plan" : kind === "source-review" ? "Your source evidence review" : "Your research"} is queued. You can return to it in Agent runs.`,
    );
    go("runs");
  };
  const reviewSourceEvidence = async (instrument: InstrumentRef) => {
    const epoch = identityEpoch.current;
    setBusy("source-review");
    setActionError("");
    try {
      const listing: InstrumentRef = {
        symbol: instrument.symbol,
        market: instrument.market,
        ...(instrument.exchange ? { exchange: instrument.exchange } : {}),
        ...(instrument.currency ? { currency: instrument.currency } : {}),
        ...(instrument.providerSymbol
          ? { providerSymbol: instrument.providerSymbol }
          : {}),
        ...(instrument.name ? { name: instrument.name } : {}),
      };
      await onJob("source-review", { instrument: listing });
      if (epoch === identityEpoch.current) setSelectedAsset(null);
    } catch (error) {
      if (epoch === identityEpoch.current)
        setActionError((error as Error).message);
    } finally {
      if (epoch === identityEpoch.current) setBusy(null);
    }
  };
  const pollJob = useCallback(async (job: Job) => {
    const epoch = identityEpoch.current;
    const fallback = `/api/platform/${job.kind === "plan" ? "plans" : "runs"}/${encodeURIComponent(job.id)}`;
    const path =
      job.pollUrl &&
      /^\/api\/platform\/(runs|plans|jobs)\/[A-Za-z0-9_-]+$/.test(job.pollUrl)
        ? job.pollUrl
        : fallback;
    let envelope: Job | PersonalizedPlan | StructuredResearchReport;
    try {
      envelope = await request<
        Job | PersonalizedPlan | StructuredResearchReport
      >(path);
    } catch (error) {
      if (
        error instanceof APIRequestError &&
        error.status === 422 &&
        error.payload &&
        typeof error.payload === "object" &&
        "id" in error.payload &&
        error.payload.id === job.id &&
        "status" in error.payload &&
        error.payload.status === "failed"
      )
        envelope = error.payload as Job;
      else throw error;
    }
    if (epoch !== identityEpoch.current)
      throw new Error(
        "Your workspace changed. Refresh the current workspace before checking this run.",
      );
    const result =
      "result" in envelope && envelope.result ? envelope.result : envelope;
    if ("allocations" in result) {
      setPending((current) => current.filter((j) => j.id !== job.id));
      setData((current) =>
        current
          ? {
              ...current,
              plans: [
                result,
                ...current.plans.filter((p) => p.id !== result.id),
              ],
              runs: [
                {
                  ...job,
                  id: result.id,
                  kind: "plan",
                  status: "completed",
                  createdAt: job.createdAt || result.createdAt,
                  input: result.profile,
                  title:
                    result.profile.goalDescription ||
                    "Personal investment plan",
                },
                ...current.runs.filter((r) => r.id !== job.id),
              ],
            }
          : current,
      );
      setNotice("Your investment plan is ready to review.");
      return result;
    }
    if ("findings" in result) {
      setPending((current) => current.filter((j) => j.id !== job.id));
      setData((current) =>
        current
          ? {
              ...current,
              runs: [
                {
                  id: result.id,
                  kind: "research",
                  status: result.status,
                  createdAt: result.startedAt,
                  title: result.input.question,
                },
                ...current.runs.filter((r) => r.id !== result.id),
              ],
            }
          : current,
      );
      setNotice("Your research run is ready to review.");
      return result;
    }
    if ("status" in result && result.status === "failed") {
      setPending((current) => current.filter((j) => j.id !== job.id));
      setData((current) =>
        current
          ? {
              ...current,
              runs: [
                { ...job, ...result },
                ...current.runs.filter((r) => r.id !== job.id),
              ],
            }
          : current,
      );
      return result;
    }
    if ("status" in result && result.status === "completed")
      throw new Error(
        "The run completed without a readable report. Refresh your workspace before trying again.",
      );
    setPending((current) =>
      current.map((j) => (j.id === job.id ? { ...j, ...result } : j)),
    );
    return result;
  }, []);
  useEffect(() => {
    const active = pending.filter(activeJob);
    if (!active.length) return;
    const timer = setTimeout(() => {
      void Promise.allSettled(
        active.map((job) =>
          pollJob(job).catch((error) => {
            setPending((current) =>
              current.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      status: "disconnected",
                      message: (error as Error).message,
                    }
                  : j,
              ),
            );
          }),
        ),
      );
    }, 4000);
    return () => clearTimeout(timer);
  }, [pending, pollJob]);
  const openJob = async (job: Job) => {
    const epoch = identityEpoch.current;
    setBusy(job.id);
    setActionError("");
    try {
      const result = await pollJob(job);
      if (epoch !== identityEpoch.current) return;
      if ("allocations" in result) setSelectedPlan(result);
      else if ("findings" in result) setSelectedReport(result);
      else if (result.status === "failed")
        setSelectedJob({ ...job, ...result });
      else {
        setPending((current) => [
          { ...job, ...result },
          ...current.filter((j) => j.id !== job.id),
        ]);
        go("runs");
      }
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const google = async () => {
    setBusy("google");
    setActionError("");
    try {
      const result = await connectGoogleAccount();
      if (result.status === "merge_required") setGoogleMerge(true);
      else {
        await load();
        setNotice("Your workspace is connected to Google.");
      }
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const beginResearch = (
    instruments: InstrumentRef[],
    fromPortfolio = false,
  ) => {
    const chosen = [
      ...new Map(instruments.map((item) => [refKey(item), item])).values(),
    ].slice(0, 4);
    if (!chosen.length) {
      go("research");
      return;
    }
    if (instruments.length > chosen.length)
      setNotice(
        `The first ${chosen.length} holdings are selected. Choose a group of up to four for this research run.`,
      );
    const chosenKeys = new Set(chosen.map(refKey));
    setResearchScope(fromPortfolio ? "portfolio" : "custom");
    setResearchInput((current) => ({
      ...current,
      markets: [...new Set(chosen.map((item) => item.market))],
      symbols: [...new Set(chosen.map((item) => item.symbol))],
      question: fromPortfolio
        ? "Review the selected holdings for concentration, material risks, conflicting evidence and opportunities for further research. This run covers the selected group, not every holding in my portfolio."
        : `Research ${chosen.map((item) => item.name || item.symbol).join(", ")}. Challenge the investment case and identify material gaps in the evidence.`,
      portfolioContext: fromPortfolio
        ? JSON.stringify({
            scope:
              "Recorded ledger context only. Current source checks cover the selected group. Other holdings need separate review.",
            totalOpenHoldings:
              data?.portfolio.positions.filter(
                (position) => position.quantity > 0,
              ).length ?? 0,
            holdings:
              data?.portfolio.positions
                .filter(
                  (position) =>
                    position.quantity > 0 &&
                    chosenKeys.has(refKey(position.instrument)),
                )
                .map((position) => ({
                  instrument: position.instrument,
                  quantity: position.quantity,
                  currency: position.currency,
                  costBasis: position.costBasis,
                })) ?? [],
          })
        : undefined,
    }));
    setSelectedAsset(null);
    go("research");
  };
  const saved = (instrument: InstrumentRef) =>
    data?.watchlist.find(
      (item) => refKey(item.instrument) === refKey(instrument),
    );
  const saveWatch = async (instrument: InstrumentRef) => {
    const prior = saved(instrument);
    await perform(
      `watch-${refKey(instrument)}`,
      () =>
        prior
          ? request(`watchlist/${encodeURIComponent(prior.id)}`, "DELETE")
          : request("watchlist", "POST", { instrument, note: "" }),
      prior
        ? "Instrument removed from your watchlist."
        : "Instrument added to your watchlist.",
    );
  };
  const group = data?.portfolio.byCurrency.find(
    (item) => item.currency === currency,
  );
  const positions = (data?.portfolio.positions || []).filter(
    (position) => position.quantity > 0,
  );
  const dataProvider = data?.dataProviders.providers.find(
    (p) =>
      p.id === (data.preferences?.quoteProvider || data.dataProviders.selected),
  );
  const dataReady =
    !!dataProvider?.keyConfigured && !!dataProvider?.entitlementAcknowledged;
  const aiReady = data
    ? Object.values(data.settings.roles).every(
        (role) =>
          !!role.model &&
          data.settings.providers.some(
            (provider) =>
              provider.id === role.provider && provider.keyConfigured,
          ),
      )
    : false;
  const nav = [
    { id: "portfolio", label: "Portfolio", icon: Wallet },
    { id: "plan", label: "Investment plan", icon: Target },
    { id: "markets", label: "Markets", icon: Globe2 },
    { id: "research", label: "Research agents", icon: Sparkles },
    { id: "news", label: "News & insights", icon: Newspaper },
    { id: "runs", label: "Agent runs", icon: GitIcon },
    { id: "watchlist", label: "Watchlist", icon: Bookmark },
  ] as const;
  const runScan = async () => {
    const epoch = identityEpoch.current;
    setScanBusy(true);
    setScanError("");
    try {
      const result = await request<QuantitativeScan>("market-scan", "POST", {
        markets: regions,
        sectors,
        limit: 6,
      });
      if (epoch !== identityEpoch.current) return;
      setScan(result);
      await refreshMarkets();
    } catch (error) {
      if (epoch === identityEpoch.current)
        setScanError((error as Error).message);
    } finally {
      if (epoch === identityEpoch.current) setScanBusy(false);
    }
  };
  const scanReady = (
    ["historyProvider", "fundamentalsProvider"] as DataPurpose[]
  ).some((purpose) =>
    data?.dataProviders.providers.some(
      (provider) =>
        provider.id ===
          (data.preferences?.[purpose] || data.dataProviders.selected) &&
        provider.keyConfigured &&
        provider.entitlementAcknowledged,
    ),
  );
  const refreshPortfolio = () =>
    perform(
      "prices",
      () => request("portfolio?refresh=true"),
      "Portfolio valuation refreshed.",
    );
  return (
    <div className="thesis-platform">
      {mobile && navOpen && (
        <button
          className="tp-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside
        className={`tp-sidebar ${navOpen ? "open" : ""}`}
        ref={navRef}
        inert={mobile && !navOpen}
        role={mobile && navOpen ? "dialog" : undefined}
        aria-modal={mobile && navOpen ? true : undefined}
        aria-label="Workspace navigation"
      >
        <button
          className="tp-brand-home"
          aria-label="Thesis portfolio home"
          onClick={() => go("portfolio")}
        >
          <Brand />
        </button>
        <div className="tp-workspace-label">
          <span>
            <BriefcaseBusiness size={15} />
          </span>
          <div>
            <strong>Investment workspace</strong>
            <small>
              {identity?.isAnonymous
                ? "Private guest workspace"
                : "Personal workspace"}
            </small>
          </div>
          <LockKeyhole size={12} />
        </div>
        <p className="tp-nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => go(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "runs" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
              {view === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="tp-sidebar-bottom">
          <div className="tp-sidebar-principle">
            <ShieldCheck size={21} />
            <strong>Clarity before conviction.</strong>
            <p>
              Understand what you own.
              <br />
              Question what comes next.
            </p>
          </div>
          <button
            className={`tp-settings-link ${view === "settings" ? "active" : ""}`}
            onClick={() => settings()}
          >
            <Settings2 size={18} />
            <span>Settings & connections</span>
          </button>
          <button
            className="tp-account-link"
            onClick={() => settings("account")}
          >
            <span className="tp-avatar">
              {identity && !identity.isAnonymous ? (
                identity.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
              ) : (
                <ShieldCheck size={17} />
              )}
            </span>
            <span>
              <strong>
                {identity?.isAnonymous
                  ? "Guest workspace"
                  : identity?.name || "Your workspace"}
              </strong>
              <small>
                {identity?.isAnonymous
                  ? "Connect Google to keep access"
                  : identity?.email || "Account & privacy"}
              </small>
            </span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="tp-main-shell" inert={mobile && navOpen}>
        <header className="tp-topbar">
          <div className="tp-breadcrumb">
            <button
              className="tp-menu"
              ref={menuRef}
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {nav.find((item) => item.id === view)?.label || "Settings"}
            </strong>
          </div>
          <form
            className="tp-global-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(marketQuery.trim());
              go("markets");
            }}
          >
            <Search size={16} />
            <input
              aria-label="Search markets"
              placeholder="Search a stock or company"
              value={marketQuery}
              onChange={(event) => setMarketQuery(event.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <div className="tp-header-actions">
            <span
              className="tp-connection-dot"
              title={dataProvider?.name || "Market data"}
            >
              <i className={dataReady ? "configured" : ""} />
              {dataReady
                ? dataProvider?.name
                : dataProvider?.keyConfigured
                  ? "Confirm data access"
                  : "Connect market data"}
            </span>
            {identity?.isAnonymous && (
              <Button small onClick={() => void google()} disabled={!!busy}>
                <GoogleMark />
                Sign in
              </Button>
            )}
          </div>
        </header>
        <main className="tp-main">
          {loadError && (
            <Notice tone="error">
              <strong>Your workspace could not be opened.</strong>
              <p>{loadError}</p>
              <Button small onClick={() => void load()}>
                <RefreshCw size={14} />
                Retry
              </Button>
            </Notice>
          )}
          {actionError && (
            <Notice tone="error" onClose={() => setActionError("")}>
              {actionError}
            </Notice>
          )}
          {!data && loading ? (
            <div className="tp-loading-workspace" role="status">
              <Loader2 size={27} className="tp-spin" />
              <h2>Opening your workspace</h2>
              <p>Loading your portfolio, preferences and connections.</p>
              <div className="tp-skeleton-row">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} />
                ))}
              </div>
            </div>
          ) : (
            data && (
              <>
                {view === "portfolio" && (
                  <>
                    <Heading
                      eyebrow="YOUR CAPITAL, IN CONTEXT"
                      title="A clearer view of your portfolio."
                      body="Track what you own, understand your exposure, and decide what deserves a closer look."
                      actions={
                        <>
                          <Button
                            onClick={() =>
                              beginResearch(
                                positions.map((p) => p.instrument),
                                true,
                              )
                            }
                            disabled={!positions.length}
                          >
                            <Sparkles size={16} />
                            Research holdings
                          </Button>
                          <Button
                            variant="primary"
                            onClick={() => setTradeModal({ opening: true })}
                          >
                            <Plus size={16} />
                            Add holding
                          </Button>
                        </>
                      }
                    />
                    <div className="tp-portfolio-toolbar">
                      <div className="tp-segment">
                        <button
                          className={
                            portfolioTab === "holdings" ? "active" : ""
                          }
                          onClick={() => setPortfolioTab("holdings")}
                        >
                          Overview
                        </button>
                        <button
                          className={
                            portfolioTab === "transactions" ? "active" : ""
                          }
                          onClick={() => setPortfolioTab("transactions")}
                        >
                          Transactions <span>{data.trades.length}</span>
                        </button>
                      </div>
                      <div className="tp-toolbar-actions">
                        <span className="tp-caption">
                          Currencies are valued separately
                        </span>
                        <select
                          aria-label="Portfolio currency"
                          value={currency}
                          onChange={(event) => setCurrency(event.target.value)}
                        >
                          {(data.portfolio.byCurrency.length
                            ? data.portfolio.byCurrency.map((c) => c.currency)
                            : [currency]
                          ).map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <IconButton
                          label="Refresh portfolio prices"
                          disabled={!!busy || !positions.length || !dataReady}
                          onClick={() => void refreshPortfolio()}
                        >
                          <RefreshCw
                            size={16}
                            className={busy === "prices" ? "tp-spin" : ""}
                          />
                        </IconButton>
                      </div>
                    </div>
                    <div className="tp-metric-grid">
                      <Metric
                        title={
                          group && group.quoteCoverage < 1
                            ? "Priced market value"
                            : "Market value"
                        }
                        value={amount(group?.marketValue, currency)}
                        detail={
                          group
                            ? `${Math.round(group.quoteCoverage * 100)}% of positions priced`
                            : "Add holdings to begin"
                        }
                        icon={Wallet}
                      />
                      <Metric
                        title="Recorded cost basis"
                        value={amount(
                          group?.costBasis ??
                            (!positions.length ? 0 : undefined),
                          currency,
                        )}
                        detail={
                          group
                            ? `${data.portfolio.costBasisMethod.toUpperCase()} accounting · ${currency}`
                            : "Acquisition costs from your ledger"
                        }
                        icon={Layers3}
                      />
                      <Metric
                        title={
                          group && group.quoteCoverage < 1
                            ? "P/L on priced positions"
                            : "Unrealized gain / loss"
                        }
                        value={amount(group?.unrealizedPnl, currency)}
                        detail="Based on available observed prices"
                        tone={
                          group?.unrealizedPnl != null
                            ? group.unrealizedPnl >= 0
                              ? "positive"
                              : "negative"
                            : undefined
                        }
                        icon={ChartNoAxesCombined}
                      />
                      <Metric
                        title="Realized gain / loss"
                        value={amount(
                          group?.realizedPnl ??
                            (!data.trades.length ? 0 : undefined),
                          currency,
                        )}
                        detail={`${positions.length} open ${positions.length === 1 ? "position" : "positions"} in your ledger`}
                        tone={
                          group?.realizedPnl != null
                            ? group.realizedPnl >= 0
                              ? "positive"
                              : "negative"
                            : undefined
                        }
                        icon={BriefcaseBusiness}
                      />
                    </div>
                    <div className="tp-accounting-note">
                      <div>
                        <ShieldCheck size={14} />
                        <span>
                          Recorded trades only. Add broker adjustments to keep
                          quantities and costs accurate.
                        </span>
                      </div>
                    </div>
                    {!!data.portfolio.warnings.length && (
                      <Notice tone="warning">
                        {data.portfolio.warnings.join(" ")}
                      </Notice>
                    )}
                    {portfolioTab === "holdings" ? (
                      <>
                        <div className="tp-portfolio-grid">
                          <AllocationChart
                            positions={positions}
                            currency={currency}
                          />
                          <section className="tp-panel tp-research-callout">
                            <span className="tp-callout-icon">
                              <Sparkles size={24} />
                            </span>
                            <p className="tp-eyebrow">BEYOND THE NUMBERS</p>
                            <h2>
                              What deserves
                              <br />a second opinion?
                            </h2>
                            <p>
                              Let specialist agents examine the business, the
                              numbers and the counterargument using sourced
                              evidence.
                            </p>
                            <div className="tp-callout-roles">
                              <span>
                                <Database size={13} />
                                Fundamentals
                              </span>
                              <span>
                                <ChartNoAxesCombined size={13} />
                                Risk
                              </span>
                              <span>
                                <ShieldCheck size={13} />
                                Skeptic
                              </span>
                            </div>
                            <Button
                              onClick={() =>
                                positions.length
                                  ? beginResearch(
                                      positions.map((p) => p.instrument),
                                      true,
                                    )
                                  : go("research")
                              }
                            >
                              Build a research brief
                              <ArrowRight size={15} />
                            </Button>
                          </section>
                        </div>
                        <section className="tp-panel tp-holdings-panel">
                          <PanelHead
                            title="Your holdings"
                            body="Recorded transactions and their available market valuations."
                            action={
                              <Button small onClick={() => setTradeModal({})}>
                                <Plus size={14} />
                                Record trade
                              </Button>
                            }
                          />
                          {!positions.length ? (
                            <Empty
                              icon={BriefcaseBusiness}
                              title="Make your portfolio visible."
                              action={
                                <Button
                                  variant="primary"
                                  onClick={() =>
                                    setTradeModal({ opening: true })
                                  }
                                >
                                  <Plus size={15} />
                                  Add your first holding
                                </Button>
                              }
                            >
                              Record the securities you already own and their
                              acquisition costs. Connect market data when you
                              want observed valuations.
                            </Empty>
                          ) : (
                            <div className="tp-table-scroll">
                              <table className="tp-table">
                                <thead>
                                  <tr>
                                    <th>Company / asset</th>
                                    <th>Quantity</th>
                                    <th>Average cost</th>
                                    <th>Observed price</th>
                                    <th>Market value</th>
                                    <th>Unrealized P/L</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {positions
                                    .filter((p) => p.quantity > 0)
                                    .map((position) => (
                                      <tr key={refKey(position.instrument)}>
                                        <td>
                                          <button
                                            className="tp-asset-name"
                                            onClick={() => {
                                              setActionError("");
                                              setSelectedAsset(
                                                position.instrument,
                                              );
                                            }}
                                          >
                                            <span className="tp-company-monogram">
                                              {position.instrument.symbol.slice(
                                                0,
                                                2,
                                              )}
                                            </span>
                                            <span>
                                              <strong>
                                                {position.instrument.name ||
                                                  position.instrument.symbol}
                                              </strong>
                                              <small>
                                                {position.instrument.symbol} ·{" "}
                                                {position.instrument.exchange ||
                                                  position.instrument
                                                    .market}{" "}
                                                · {position.currency}
                                              </small>
                                            </span>
                                          </button>
                                        </td>
                                        <td>{num(position.quantity, 6)}</td>
                                        <td>
                                          {amount(
                                            position.averageCost,
                                            position.currency,
                                            2,
                                          )}
                                        </td>
                                        <td>
                                          <strong>
                                            {amount(
                                              position.price,
                                              position.currency,
                                              2,
                                            )}
                                          </strong>
                                          <small>
                                            {position.priceAsOf
                                              ? day(position.priceAsOf)
                                              : "No quote available"}
                                          </small>
                                        </td>
                                        <td>
                                          {amount(
                                            position.marketValue,
                                            position.currency,
                                          )}
                                        </td>
                                        <td
                                          className={
                                            position.unrealizedPnl != null
                                              ? position.unrealizedPnl >= 0
                                                ? "tp-positive"
                                                : "tp-negative"
                                              : ""
                                          }
                                        >
                                          {amount(
                                            position.unrealizedPnl,
                                            position.currency,
                                          )}
                                          {position.status !== "valued" && (
                                            <small>
                                              {position.status === "stale_quote"
                                                ? "Stale observation"
                                                : "Valuation unavailable"}
                                            </small>
                                          )}
                                        </td>
                                        <td>
                                          <IconButton
                                            label={`Research ${position.instrument.symbol}`}
                                            onClick={() =>
                                              beginResearch([
                                                position.instrument,
                                              ])
                                            }
                                          >
                                            <Sparkles size={16} />
                                          </IconButton>
                                          <IconButton
                                            label={`Record transaction for ${position.instrument.symbol}`}
                                            onClick={() =>
                                              setTradeModal({
                                                instrument: position.instrument,
                                              })
                                            }
                                          >
                                            <Plus size={16} />
                                          </IconButton>
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                      </>
                    ) : (
                      <Transactions
                        trades={data.trades}
                        busy={busy}
                        onAdd={() => setTradeModal({})}
                        onEdit={(trade) => setTradeModal({ trade })}
                        onDelete={(trade) =>
                          confirm({
                            title: "Delete this recorded transaction?",
                            body: `Delete the recorded ${trade.side} of ${num(trade.quantity)} ${trade.instrument.symbol} on ${day(trade.executedAt)}? This recalculates your portfolio ledger.`,
                            confirmLabel: "Delete transaction",
                            run: async () => {
                              await request(
                                `trades/${encodeURIComponent(trade.id)}`,
                                "DELETE",
                              );
                              await load();
                              setNotice("Transaction deleted.");
                            },
                          })
                        }
                      />
                    )}
                    {!dataReady && (
                      <div className="tp-connection-banner">
                        <span>
                          <Database size={21} />
                        </span>
                        <div>
                          <strong>
                            Your ledger is ready. Bring in the market.
                          </strong>
                          <p>
                            Connect your own market data provider for quotes,
                            dated history and coverage supported by your
                            account.
                          </p>
                        </div>
                        <Button onClick={() => settings("data")}>
                          Connect market data
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {view === "markets" && (
                  <>
                    <Heading
                      eyebrow="A WIDER PERSPECTIVE"
                      title="Explore the market. Find your questions."
                      body="Search actual instruments and inspect the data your connected provider can verify."
                      actions={
                        <>
                          <Button
                            onClick={() => void runScan()}
                            disabled={scanBusy || !scanReady}
                            title={
                              !scanReady
                                ? "Connect an entitled history or fundamentals source in Settings"
                                : "Explicitly scan up to six listings through your selected sources"
                            }
                          >
                            {scanBusy ? (
                              <Loader2 size={15} className="tp-spin" />
                            ) : (
                              <SlidersHorizontal size={15} />
                            )}
                            Run quantitative scan
                          </Button>
                          <Button
                            onClick={() => void refreshMarkets()}
                            disabled={marketLoading}
                          >
                            <RefreshCw
                              size={15}
                              className={marketLoading ? "tp-spin" : ""}
                            />
                            Refresh
                          </Button>
                        </>
                      }
                    />
                    <div className="tp-filter-toolbar">
                      <RegionPicker value={regions} onChange={setRegions} />
                      <div className="tp-toolbar-actions">
                        <SectorPicker value={sectors} onChange={setSectors} />
                        <form
                          className="tp-local-search"
                          onSubmit={(event) => {
                            event.preventDefault();
                            setSubmittedQuery(marketQuery.trim());
                          }}
                        >
                          <Search size={16} />
                          <input
                            aria-label="Search instruments"
                            placeholder="Company name or ticker"
                            value={marketQuery}
                            onChange={(event) =>
                              setMarketQuery(event.target.value)
                            }
                          />
                          <button aria-label="Search selected markets">
                            <ArrowRight size={15} />
                          </button>
                        </form>
                      </div>
                    </div>
                    {marketError && <Notice tone="error">{marketError}</Notice>}
                    {scanError && <Notice tone="error">{scanError}</Notice>}
                    {scanBusy && (
                      <LoadingPanel text="Checking dated history and fundamental coverage for the selected scan cohort" />
                    )}
                    {scan && (
                      <QuantitativeScanPanel
                        scan={scan}
                        onClose={() => setScan(null)}
                        onInstrument={(instrument) => {
                          setActionError("");
                          setSelectedAsset(instrument);
                        }}
                      />
                    )}
                    {!dataReady && (
                      <Notice>
                        <strong>
                          Explore listings before connecting price data.
                        </strong>
                        <p>
                          The listing catalog contains no replacement prices. An
                          entitled data source is needed for portfolio
                          valuations and AI evidence; attributed chart widgets
                          remain a separate source.
                        </p>
                        <Button small onClick={() => settings("data")}>
                          Set up market data
                          <ArrowRight size={14} />
                        </Button>
                      </Notice>
                    )}
                    {marketLoading ? (
                      <LoadingPanel text="Looking up instruments and their available observations" />
                    ) : !marketResult?.instruments.length ? (
                      <section className="tp-panel">
                        <Empty
                          icon={Search}
                          title={
                            submittedQuery
                              ? "No instruments matched this search."
                              : "Search a company you want to understand."
                          }
                        >
                          {submittedQuery
                            ? "Try another name or check the configured provider’s exchange entitlements."
                            : "Start with a name or ticker. The results will show listing details and the data actually returned by your provider."}
                        </Empty>
                      </section>
                    ) : (
                      <>
                        <div className="tp-results-count">
                          <span>
                            {marketResult.instruments.length} instruments
                          </span>
                          <small>
                            {marketResult.asOf
                              ? `Observed ${when(marketResult.asOf)}`
                              : "Observation dates appear with each quote"}
                          </small>
                        </div>
                        <div className="tp-market-grid">
                          {marketResult.instruments.map((instrument) => {
                            const quote = instrument.quote?.data;
                            return (
                              <article
                                className="tp-panel tp-market-card"
                                key={refKey(instrument)}
                              >
                                <div className="tp-market-card-top">
                                  <span className="tp-company-monogram">
                                    {instrument.symbol.slice(0, 2)}
                                  </span>
                                  <IconButton
                                    label={`${saved(instrument) ? "Remove" : "Add"} ${instrument.symbol} ${saved(instrument) ? "from" : "to"} watchlist`}
                                    disabled={!!busy}
                                    onClick={() => void saveWatch(instrument)}
                                  >
                                    <Bookmark
                                      size={17}
                                      fill={
                                        saved(instrument)
                                          ? "currentColor"
                                          : "none"
                                      }
                                    />
                                  </IconButton>
                                </div>
                                <button
                                  className="tp-market-title"
                                  onClick={() => {
                                    setActionError("");
                                    setSelectedAsset(instrument);
                                  }}
                                >
                                  <h3>
                                    {instrument.name || instrument.symbol}
                                  </h3>
                                  <span>
                                    {instrument.symbol} ·{" "}
                                    {instrument.exchange || instrument.market}
                                    <ArrowUpRight size={14} />
                                  </span>
                                </button>
                                <div className="tp-market-price">
                                  <strong>
                                    {quote
                                      ? observedAmount(
                                          quote.price,
                                          quote.currency || instrument.currency,
                                          2,
                                        )
                                      : "Quote unavailable"}
                                  </strong>
                                  {quote?.changePercent != null && (
                                    <span
                                      className={
                                        quote.changePercent >= 0
                                          ? "tp-positive"
                                          : "tp-negative"
                                      }
                                    >
                                      {percent(quote.changePercent)}
                                    </span>
                                  )}
                                </div>
                                {instrument.factors && (
                                  <p className="tp-market-factor">
                                    Relative factor rank:{" "}
                                    <strong>
                                      {instrument.factors.score === null
                                        ? "Withheld"
                                        : `${num(instrument.factors.score, 0)} / 100`}
                                    </strong>{" "}
                                    · {instrument.factors.peerCount} peers
                                  </p>
                                )}
                                <div className="tp-market-meta">
                                  <span>
                                    {REGION[instrument.market].flag}{" "}
                                    {instrument.market}
                                  </span>
                                  {instrument.sector && (
                                    <span>{instrument.sector}</span>
                                  )}
                                </div>
                                <div className="tp-market-card-bottom">
                                  <small>
                                    {quote
                                      ? `As of ${when(quote.asOf)}`
                                      : instrument.quote?.warnings[0] ||
                                        "No observed quote returned"}
                                  </small>
                                  <button
                                    onClick={() => beginResearch([instrument])}
                                  >
                                    Research
                                    <ArrowRight size={13} />
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                        {marketResult.warnings?.length && (
                          <Notice tone="warning">
                            {marketResult.warnings.join(" ")}
                          </Notice>
                        )}
                      </>
                    )}
                  </>
                )}
                {view === "plan" && (
                  <>
                    <Heading
                      eyebrow="A PLAN FOR SOMETHING THAT MATTERS"
                      title="Give your money a purpose."
                      body="Build around your goal, the time you have and the loss you could live with."
                      actions={
                        <Button variant="primary" onClick={() => newPlan()}>
                          <Plus size={16} />
                          Create an investment plan
                        </Button>
                      }
                    />
                    <section className="tp-plan-hero tp-panel">
                      <div>
                        <span className="tp-plan-icon">
                          <Target size={28} />
                        </span>
                        <h2>
                          Your goal first.
                          <br />
                          <em>The allocation follows.</em>
                        </h2>
                        <p>
                          A home in two years calls for different tradeoffs from
                          wealth you can leave invested for twenty. Tell Thesis
                          what this money needs to do.
                        </p>
                        <Button variant="primary" onClick={() => newPlan()}>
                          Build my plan
                          <ArrowRight size={16} />
                        </Button>
                      </div>
                      <div className="tp-plan-principles">
                        <div>
                          <span>01</span>
                          <strong>A real amount. A real horizon.</strong>
                          <p>
                            Exact allocations in your chosen currency, with the
                            reserve and constraints visible.
                          </p>
                        </div>
                        <div>
                          <span>02</span>
                          <strong>Risk is part of the brief.</strong>
                          <p>
                            Liquidity, loss tolerance, concentration and foreign
                            currency exposure matter.
                          </p>
                        </div>
                        <div>
                          <span>03</span>
                          <strong>Gaps stay visible.</strong>
                          <p>
                            Missing quotes, access checks or deposit terms can
                            make a plan conditional.
                          </p>
                        </div>
                      </div>
                    </section>
                    <section className="tp-panel">
                      <PanelHead
                        title="Your investment plans"
                        body="Saved goals and the reasoning behind each allocation."
                      />
                      {!data.plans.length ? (
                        <Empty
                          icon={Target}
                          title="Start with what you are saving for."
                        >
                          Your first plan will appear here with its allocations,
                          assumptions and next steps.
                        </Empty>
                      ) : (
                        <div className="tp-run-list">
                          {data.plans.map((plan) => (
                            <button
                              className="tp-run-row"
                              key={plan.id}
                              disabled={busy === plan.id}
                              onClick={() =>
                                "allocations" in plan
                                  ? setSelectedPlan(plan)
                                  : void openJob({ ...plan, kind: "plan" })
                              }
                            >
                              <span className="tp-run-icon">
                                <Target size={18} />
                              </span>
                              <span>
                                <strong>
                                  {"allocations" in plan
                                    ? plan.profile.goalDescription ||
                                      `${amount(plan.profile.amount, plan.profile.baseCurrency)} investment plan`
                                    : plan.title || "Investment plan"}
                                </strong>
                                <small>
                                  {day(plan.createdAt)}
                                  {"allocations" in plan
                                    ? ` · ${plan.profile.horizonMonths} months · ${amount(plan.profile.amount, plan.profile.baseCurrency)}`
                                    : ""}
                                </small>
                              </span>
                              <Status
                                tone={
                                  plan.status === "ready_for_review"
                                    ? "green"
                                    : plan.status === "needs_data" ||
                                        plan.status === "conditional"
                                      ? "amber"
                                      : "neutral"
                                }
                              >
                                {plan.status.replaceAll("_", " ")}
                              </Status>
                              <ChevronRight size={17} />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
                {view === "research" && (
                  <ResearchWorkspace
                    input={researchInput}
                    setInput={setResearchInput}
                    scope={researchScope}
                    setScope={setResearchScope}
                    positions={positions}
                    settings={data.settings}
                    ready={aiReady}
                    busy={busy === "research"}
                    onSettings={() => settings("routing")}
                    onSubmit={async (value) => {
                      setBusy("research");
                      setActionError("");
                      try {
                        await onJob("research", value);
                      } catch (error) {
                        setActionError((error as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  />
                )}
                {view === "news" && (
                  <>
                    <Heading
                      eyebrow="CONTEXT, NOT JUST HEADLINES"
                      title="Keep up with what you own."
                      body="Reporting from connected sources and a public news index. Original links and timestamp meanings stay visible."
                      actions={
                        <Button
                          disabled={newsLoading}
                          onClick={() => void refreshNews()}
                        >
                          <RefreshCw
                            size={15}
                            className={newsLoading ? "tp-spin" : ""}
                          />
                          Refresh news
                        </Button>
                      }
                    />
                    <div className="tp-news-toolbar">
                      <div className="tp-segment">
                        {(["portfolio", "watchlist", "markets"] as const).map(
                          (scope) => (
                            <button
                              key={scope}
                              className={newsScope === scope ? "active" : ""}
                              onClick={() => setNewsScope(scope)}
                            >
                              {scope === "portfolio"
                                ? "My portfolio"
                                : scope === "watchlist"
                                  ? "Watchlist"
                                  : "Selected markets"}
                            </button>
                          ),
                        )}
                      </div>
                      <Status>
                        {newsLoading
                          ? "Loading source"
                          : newsSource || "No source loaded"}
                      </Status>
                    </div>
                    {newsScope === "markets" && (
                      <div className="tp-news-regions">
                        <RegionPicker value={regions} onChange={setRegions} />
                      </div>
                    )}
                    {newsError && <Notice tone="error">{newsError}</Notice>}
                    {newsWarnings.length > 0 && (
                      <Notice tone="warning">{newsWarnings.join(" ")}</Notice>
                    )}
                    {newsLoading ? (
                      <LoadingPanel text="Retrieving dated articles from your connected sources" />
                    ) : !news.length ? (
                      <section className="tp-panel">
                        <Empty
                          icon={Newspaper}
                          title={
                            newsScope === "portfolio" && !positions.length
                              ? "Your holdings will shape the reading list."
                              : "No related articles available."
                          }
                          action={
                            newsScope === "portfolio" && !positions.length ? (
                              <Button onClick={() => go("portfolio")}>
                                Add your holdings
                                <ArrowRight size={15} />
                              </Button>
                            ) : !dataReady ? (
                              <Button onClick={() => settings("data")}>
                                Configure source coverage
                                <ArrowRight size={15} />
                              </Button>
                            ) : undefined
                          }
                        >
                          {newsScope === "portfolio" && !positions.length
                            ? "Add your holdings, then return for reporting related to those companies."
                            : "The configured source has not returned related articles. Check its news coverage or choose a different scope."}
                        </Empty>
                      </section>
                    ) : (
                      <div className="tp-news-grid">
                        {news.map((article) => (
                          <Article key={article.id} article={article} />
                        ))}
                      </div>
                    )}
                  </>
                )}
                {view === "runs" && (
                  <>
                    <Heading
                      eyebrow="THE WORK, MADE VISIBLE"
                      title="Every research run has a trail."
                      body="Follow active work, reopen conclusions and inspect the source requests and model receipts."
                      actions={
                        <Button onClick={() => void load()} disabled={loading}>
                          <RefreshCw
                            size={15}
                            className={loading ? "tp-spin" : ""}
                          />
                          Refresh
                        </Button>
                      }
                    />
                    {pending.length > 0 && (
                      <section className="tp-panel tp-pending-panel">
                        <PanelHead
                          title="Active research"
                          body="These requests remain on the server when you leave this page."
                        />
                        {pending.map((job) => (
                          <div className="tp-active-job" key={job.id}>
                            <span className="tp-run-icon">
                              {activeJob(job) ? (
                                <Loader2 size={20} className="tp-spin" />
                              ) : (
                                <CircleHelp size={20} />
                              )}
                            </span>
                            <div>
                              <strong>
                                {job.kind === "plan"
                                  ? "Building your investment plan"
                                  : "Research committee"}
                              </strong>
                              <p>
                                {job.message ||
                                  "The request is waiting for the next server update. Completed actions will appear in the final trace."}
                              </p>
                              <small>
                                {job.createdAt
                                  ? `Started ${when(job.createdAt)}`
                                  : job.id}
                              </small>
                            </div>
                            <Status
                              tone={
                                job.status === "disconnected" ? "amber" : "blue"
                              }
                            >
                              {job.status.replaceAll("_", " ")}
                            </Status>
                            <Button
                              small
                              onClick={() => void openJob(job)}
                              disabled={busy === job.id}
                            >
                              Check status
                            </Button>
                          </div>
                        ))}
                      </section>
                    )}
                    <section className="tp-panel">
                      <PanelHead
                        title="Research history"
                        body="Completed, incomplete and failed runs retain their actual execution state."
                      />
                      {!data.runs.length ? (
                        <Empty
                          icon={Sparkles}
                          title="Your first research question belongs here."
                          action={
                            <Button onClick={() => go("research")}>
                              Build a research brief
                              <ArrowRight size={15} />
                            </Button>
                          }
                        >
                          Choose candidates or start with your portfolio.
                          Configure your providers before requesting a committee
                          review.
                        </Empty>
                      ) : (
                        <div className="tp-run-list">
                          {data.runs.map((run) => (
                            <button
                              className="tp-run-row"
                              key={run.id}
                              onClick={() =>
                                void openJob({
                                  ...run,
                                  kind: run.kind || "research",
                                })
                              }
                              disabled={busy === run.id}
                            >
                              <span className="tp-run-icon">
                                {run.kind === "plan" ? (
                                  <Target size={18} />
                                ) : (
                                  <Sparkles size={18} />
                                )}
                              </span>
                              <span>
                                <strong>
                                  {jobDisplayTitle(run)}
                                </strong>
                                <small>
                                  {day(run.createdAt)}
                                  {run.summary ? ` · ${run.summary}` : ""}
                                </small>
                              </span>
                              <Status tone={jobDisplayStatus(run) === "completed" ? "green" : jobDisplayStatus(run) === "failed" ? "red" : "amber"}>
                                {jobDisplayStatus(run).replaceAll("_", " ")}
                              </Status>
                              <ChevronRight size={17} />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
                {view === "watchlist" && (
                  <>
                    <Heading
                      eyebrow="IDEAS WORTH KEEPING IN VIEW"
                      title="A watchlist with a point of view."
                      body="Keep the companies you want to understand, along with the reason you are watching."
                      actions={
                        <Button
                          variant="primary"
                          onClick={() => setWatchModal(true)}
                        >
                          <Plus size={15} />
                          Add an instrument
                        </Button>
                      }
                    />
                    {!data.watchlist.length ? (
                      <section className="tp-panel">
                        <Empty
                          icon={Bookmark}
                          title="Keep a good question within reach."
                          action={
                            <Button onClick={() => go("markets")}>
                              Explore markets
                              <ArrowRight size={15} />
                            </Button>
                          }
                        >
                          Find a company in Markets or add its listing details.
                          Prices appear only when a connected provider returns
                          them.
                        </Empty>
                      </section>
                    ) : (
                      <div className="tp-watch-grid">
                        {data.watchlist.map((item) => (
                          <article
                            className="tp-panel tp-watch-card"
                            key={item.id}
                          >
                            <div className="tp-watch-card-top">
                              <button
                                className="tp-asset-name"
                                onClick={() => {
                                  setActionError("");
                                  setSelectedAsset(item.instrument);
                                }}
                              >
                                <span className="tp-company-monogram">
                                  {item.instrument.symbol.slice(0, 2)}
                                </span>
                                <span>
                                  <strong>
                                    {item.instrument.name ||
                                      item.instrument.symbol}
                                  </strong>
                                  <small>
                                    {item.instrument.symbol} ·{" "}
                                    {item.instrument.exchange ||
                                      item.instrument.market}
                                  </small>
                                </span>
                              </button>
                              <IconButton
                                label={`Remove ${item.instrument.symbol} from watchlist`}
                                disabled={busy === item.id}
                                onClick={() =>
                                  void perform(
                                    item.id,
                                    () =>
                                      request(
                                        `watchlist/${encodeURIComponent(item.id)}`,
                                        "DELETE",
                                      ),
                                    "Instrument removed from watchlist.",
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </IconButton>
                            </div>
                            <label>
                              Your reason to watch
                              <textarea
                                value={watchNotes[item.id] ?? item.note}
                                maxLength={2000}
                                placeholder="What would make this company worth a closer look?"
                                onChange={(event) =>
                                  setWatchNotes((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <div className="tp-watch-card-actions">
                              <Button
                                small
                                disabled={
                                  (watchNotes[item.id] ?? item.note) ===
                                    item.note || !!busy
                                }
                                onClick={() =>
                                  void perform(
                                    item.id,
                                    () =>
                                      request("watchlist", "POST", {
                                        instrument: item.instrument,
                                        note: watchNotes[item.id] ?? item.note,
                                      }),
                                    "Watchlist note saved.",
                                  )
                                }
                              >
                                <Check size={13} />
                                Save note
                              </Button>
                              <Button
                                small
                                variant="ghost"
                                onClick={() => beginResearch([item.instrument])}
                              >
                                Research
                                <ArrowRight size={14} />
                              </Button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {view === "settings" && (
                  <SettingsWorkspace
                    settings={data.settings}
                    dataSettings={data.dataProviders}
                    tab={settingsTab}
                    setTab={setSettingsTab}
                    identity={identity}
                    onReload={load}
                    onGoogle={google}
                    onNotice={setNotice}
                    onError={setActionError}
                    busyGoogle={busy === "google"}
                    portfolioMethod={data.portfolio.costBasisMethod}
                    preferences={data.preferences}
                    activeWork={
                      pending.some(activeJob) || data.runs.some(activeJob)
                    }
                  />
                )}
              </>
            )
          )}
          <footer className="tp-footer">
            <span>
              <ShieldCheck size={13} />
              Research support. Your decisions remain yours.
            </span>
            <span>Built by Shivam Gupta with AI-assisted engineering</span>
          </footer>
        </main>
      </div>
      {confirmation}
      {notice && (
        <div className="tp-toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <IconButton
            label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {selectedJob && (
        <Modal title="Agent run stopped" onClose={() => setSelectedJob(null)}>
          <div className="tp-dialog-body tp-form">
            <Status tone="red">Failed</Status>
            <h3>
              {selectedJob.kind === "plan"
                ? "Investment plan"
                : "Research committee"}
            </h3>
            <p>
              {typeof selectedJob.error === "string"
                ? selectedJob.error
                : selectedJob.error?.message ||
                  selectedJob.message ||
                  "The server could not complete this request. Review your provider connections and try a new brief when ready."}
            </p>
            <p className="tp-caption">
              Run {selectedJob.id} · {when(selectedJob.createdAt)}. No automatic
              inference replay is attempted.
            </p>
            <div className="tp-dialog-actions">
              <Button onClick={() => setSelectedJob(null)}>Close</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const job = selectedJob;
                  setSelectedJob(null);
                  if (job.kind === "plan") {
                    if (
                      job.input &&
                      typeof job.input === "object" &&
                      "amount" in job.input
                    )
                      newPlan(job.input as PlanProfile);
                    else newPlan();
                  } else {
                    if (
                      job.input &&
                      typeof job.input === "object" &&
                      "question" in job.input
                    )
                      setResearchInput(job.input as ResearchAgentInput);
                    go("research");
                  }
                }}
              >
                Review a new request
                <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {tradeModal && (
        <TradeDialog
          initial={tradeModal.trade}
          instrument={tradeModal.instrument}
          opening={tradeModal.opening}
          onClose={() => setTradeModal(null)}
          onSave={async (body) => {
            await request(
              tradeModal.trade
                ? `trades/${encodeURIComponent(tradeModal.trade.id)}`
                : "trades",
              tradeModal.trade ? "PATCH" : "POST",
              body,
            );
            await load();
            setTradeModal(null);
            setNotice(
              tradeModal.trade
                ? "Transaction updated."
                : "Your transaction is recorded.",
            );
          }}
        />
      )}
      {watchModal && (
        <WatchDialog
          onClose={() => setWatchModal(false)}
          onSave={async (instrument) => {
            await request("watchlist", "POST", { instrument, note: "" });
            await load();
            setWatchModal(false);
            setNotice("Instrument added to your watchlist.");
          }}
        />
      )}
      {selectedAsset && (
        <AssetDialog
          instrument={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onResearch={() => beginResearch([selectedAsset])}
          onSourceReview={() => void reviewSourceEvidence(selectedAsset)}
          sourceReviewBusy={busy === "source-review"}
          onWatch={() => void saveWatch(selectedAsset)}
          isSaved={!!saved(selectedAsset)}
          watchBusy={!!busy}
          actionError={actionError}
          onHolding={() => {
            setTradeModal({ instrument: selectedAsset, opening: true });
            setSelectedAsset(null);
          }}
        />
      )}
      {selectedReport && (
        <ReportDialog
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
        />
      )}
      {selectedPlan && (
        <PlanDialog
          plan={selectedPlan}
          onAlternative={(profile) => {
            setSelectedPlan(null);
            newPlan(profile);
          }}
          onClose={() => setSelectedPlan(null)}
          onResearch={() => {
            if (selectedPlan.research) setSelectedReport(selectedPlan.research);
            setSelectedPlan(null);
          }}
        />
      )}
      {planWizard && (
        <PlanWizard
          initial={planSeed}
          onClose={() => setPlanWizard(false)}
          settings={data?.settings || null}
          onSubmit={async (profile) => {
            await onJob("plan", profile);
          }}
        />
      )}
      {googleMerge && (
        <Modal
          title="Keep both workspaces"
          busy={busy === "merge"}
          onClose={() => {
            cancelGoogleMerge();
            setGoogleMerge(false);
          }}
        >
          <div className="tp-dialog-body">
            <span className="tp-dialog-emblem">
              <ShieldCheck size={27} />
            </span>
            <h3>This Google account already has a workspace.</h3>
            <p>
              Your guest workspace is still open. Merge its records into your
              Google account before switching, so neither workspace is
              discarded.
            </p>
            <p className="tp-muted">
              Existing account preferences may be kept when settings conflict.
              Financial records are not replaced by an empty workspace.
            </p>
            {actionError && <Notice tone="error">{actionError}</Notice>}
            <div className="tp-dialog-actions">
              <Button
                onClick={() => {
                  cancelGoogleMerge();
                  setGoogleMerge(false);
                }}
                disabled={!!busy}
              >
                Keep using guest
              </Button>
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={async () => {
                  setBusy("merge");
                  setActionError("");
                  try {
                    const result = await completeGoogleMerge();
                    setGoogleMerge(false);
                    await load();
                    setNotice(
                      result.conflicts?.length
                        ? "Workspaces merged. Review the settings that were kept from your account."
                        : "Your workspaces are merged and connected to Google.",
                    );
                  } catch (error) {
                    setActionError((error as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "merge" ? (
                  <Loader2 size={16} className="tp-spin" />
                ) : (
                  <GoogleMark />
                )}
                Merge and continue
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Wallet;
  tone?: string;
}) {
  return (
    <section className="tp-panel tp-metric">
      <div>
        <span>{title}</span>
        <Icon size={16} />
      </div>
      <strong className={tone ? `tp-${tone}` : ""}>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
function LoadingPanel({ text }: { text: string }) {
  return (
    <section className="tp-panel tp-loading-panel" role="status">
      <Loader2 size={24} className="tp-spin" />
      <p>{text}</p>
    </section>
  );
}
function GitIcon({ size = 18 }: { size?: number }) {
  return <Layers3 size={size} />;
}
function GoogleMark() {
  return (
    <span className="tp-google-mark" aria-hidden="true">
      G
    </span>
  );
}

function Transactions({
  trades,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  trades: PortfolioTrade[];
  busy: string | null;
  onAdd: () => void;
  onEdit: (trade: PortfolioTrade) => void;
  onDelete: (trade: PortfolioTrade) => void;
}) {
  return (
    <section className="tp-panel">
      <PanelHead
        title="Transaction ledger"
        body="Record actual executions. Entries recalculate your positions and cost basis."
        action={
          <Button small onClick={onAdd}>
            <Plus size={14} />
            Record transaction
          </Button>
        }
      />
      {!trades.length ? (
        <Empty icon={FileText} title="Your transactions tell the story.">
          Add opening buys or record subsequent purchases and sales. No order is
          sent to a broker.
        </Empty>
      ) : (
        <div className="tp-table-scroll">
          <table className="tp-table">
            <thead>
              <tr>
                <th>Executed</th>
                <th>Instrument</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Fees</th>
                <th>Currency</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...trades].reverse().map((trade) => (
                <tr key={trade.id}>
                  <td>{when(trade.executedAt)}</td>
                  <td>
                    <strong>{trade.instrument.symbol}</strong>
                    <small>
                      {trade.instrument.exchange || trade.instrument.market}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`tp-trade-side ${trade.side.toLowerCase()}`}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td>{num(trade.quantity, 6)}</td>
                  <td>{amount(trade.price, trade.currency, 2)}</td>
                  <td>{amount(trade.fees, trade.currency, 2)}</td>
                  <td>{trade.currency}</td>
                  <td>
                    <Button
                      small
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() => onEdit(trade)}
                    >
                      Edit
                    </Button>
                    <IconButton
                      label={`Delete ${trade.side} ${trade.instrument.symbol} transaction`}
                      disabled={!!busy}
                      onClick={() => onDelete(trade)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function InstrumentFields({
  instrument,
  onChange,
}: {
  instrument: InstrumentRef;
  onChange: (value: InstrumentRef) => void;
}) {
  return (
    <>
      <label>
        Listing market
        <select
          value={instrument.market}
          onChange={(event) =>
            onChange({ symbol: "", market: event.target.value as Market })
          }
        >
          {REGIONS.map((region) => (
            <option key={region} value={region}>
              {REGION[region].name}
            </option>
          ))}
        </select>
      </label>
      <InstrumentPicker
        market={instrument.market}
        selected={instrument}
        onSelect={onChange}
      />
      <details className="tp-manual-instrument">
        <summary>Enter or adjust verified listing details manually</summary>
        <div className="tp-form">
          <div className="tp-form-grid">
            <label>
              Ticker symbol
              <input
                maxLength={80}
                value={instrument.symbol}
                onChange={(event) =>
                  onChange({
                    ...instrument,
                    symbol: event.target.value.toUpperCase(),
                  })
                }
              />
            </label>
            <label>
              Exchange
              <input
                maxLength={80}
                value={instrument.exchange || ""}
                onChange={(event) =>
                  onChange({
                    ...instrument,
                    exchange: event.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
          <label>
            Company or asset name<span className="tp-optional">Optional</span>
            <input
              maxLength={250}
              value={instrument.name || ""}
              onChange={(event) =>
                onChange({
                  ...instrument,
                  name: event.target.value || undefined,
                })
              }
            />
          </label>
          <label>
            Provider symbol<span className="tp-optional">Optional</span>
            <input
              maxLength={80}
              value={instrument.providerSymbol || ""}
              onChange={(event) =>
                onChange({
                  ...instrument,
                  providerSymbol: event.target.value || undefined,
                })
              }
            />
          </label>
          <p className="tp-field-hint">
            Manual listing details are provided by you. They do not establish
            source coverage or an observed price.
          </p>
        </div>
      </details>
    </>
  );
}
function TradeDialog({
  initial,
  instrument: seed,
  opening,
  onClose,
  onSave,
}: {
  initial?: PortfolioTrade;
  instrument?: InstrumentRef;
  opening?: boolean;
  onClose: () => void;
  onSave: (trade: Omit<PortfolioTrade, "id">) => Promise<void>;
}) {
  const [instrument, setInstrument] = useState<InstrumentRef>(
    initial?.instrument || seed || { symbol: "", market: "US" },
  );
  const [side, setSide] = useState<"BUY" | "SELL">(initial?.side || "BUY"),
    [quantity, setQuantity] = useState(initial ? String(initial.quantity) : ""),
    [price, setPrice] = useState(initial ? String(initial.price) : ""),
    [fees, setFees] = useState(initial ? String(initial.fees) : "0"),
    [currency, setCurrency] = useState(
      initial?.currency || seed?.currency || "USD",
    ),
    [date, setDate] = useState(
      localDate(initial ? new Date(initial.executedAt) : new Date()),
    ),
    [note, setNote] = useState(initial?.note || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (instrument.currency) setCurrency(instrument.currency);
  }, [instrument.currency]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!instrument.symbol.trim())
        throw new Error(
          "Choose an instrument or enter its verified listing details.",
        );
      await onSave({
        instrument: {
          ...instrument,
          symbol: instrument.symbol.trim().toUpperCase(),
          currency,
        },
        side,
        quantity: Number(quantity),
        price: Number(price),
        fees: Number(fees),
        currency,
        executedAt: new Date(date).toISOString(),
        ...(note ? { note } : {}),
      });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        initial
          ? "Edit recorded transaction"
          : opening
            ? "Add an existing holding"
            : "Record a transaction"
      }
      onClose={onClose}
      busy={busy}
    >
      <form className="tp-dialog-body tp-form" onSubmit={submit}>
        <p className="tp-form-intro">
          {opening
            ? "Record the shares you already own and the acquisition cost you know. This creates an opening buy in your ledger."
            : "Enter an actual execution. This records your portfolio history and does not place an order."}
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <InstrumentFields instrument={instrument} onChange={setInstrument} />
        {!opening && (
          <fieldset className="tp-choice-field">
            <legend>Transaction type</legend>
            <div className="tp-segment tp-trade-segment">
              <button
                type="button"
                className={side === "BUY" ? "active" : ""}
                aria-pressed={side === "BUY"}
                onClick={() => setSide("BUY")}
              >
                Buy
              </button>
              <button
                type="button"
                className={side === "SELL" ? "active" : ""}
                aria-pressed={side === "SELL"}
                onClick={() => setSide("SELL")}
              >
                Sell
              </button>
            </div>
          </fieldset>
        )}
        <div className="tp-form-grid">
          <label>
            Quantity
            <input
              required
              type="number"
              min="0.00000001"
              max="1000000000000"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            {opening ? "Acquisition price per unit" : "Executed price per unit"}
            <input
              required
              type="number"
              min="0"
              max="1000000000000"
              step="any"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
        </div>
        <div className="tp-form-grid">
          <label>
            Listing currency
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {[...new Set([...CURRENCIES, currency])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Transaction fees
            <input
              required
              type="number"
              min="0"
              max="1000000000000"
              step="any"
              value={fees}
              onChange={(event) => setFees(event.target.value)}
            />
          </label>
        </div>
        <label>
          Executed at
          <input
            required
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <small className="tp-field-hint">
            Entered in your browser's local timezone.
          </small>
        </label>
        <label>
          Research or transaction note
          <span className="tp-optional">Optional</span>
          <textarea
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="tp-dialog-summary">
          <span>Recorded {side === "BUY" ? "purchase" : "sale"} value</span>
          <strong>
            {quantity && price
              ? amount(Number(quantity) * Number(price), currency, 2)
              : "Enter quantity and price"}
          </strong>
          <small>Fees are recorded separately.</small>
        </div>
        <div className="tp-dialog-actions">
          <Button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="tp-spin" />
            ) : (
              <Check size={16} />
            )}
            Save transaction
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function WatchDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (instrument: InstrumentRef) => Promise<void>;
}) {
  const [instrument, setInstrument] = useState<InstrumentRef>({
      symbol: "",
      market: "US",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Add an instrument to watch" onClose={onClose} busy={busy}>
      <form
        className="tp-dialog-body tp-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave(instrument);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="tp-form-intro">
          Use the ticker and exchange for the specific listing you want to
          follow. A watchlist entry does not establish that a quote is
          available.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <InstrumentFields instrument={instrument} onChange={setInstrument} />
        <div className="tp-dialog-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="tp-spin" />
            ) : (
              <Bookmark size={15} />
            )}
            Add to watchlist
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AssetDialog({
  instrument,
  onClose,
  onResearch,
  onSourceReview,
  sourceReviewBusy,
  onWatch,
  isSaved,
  onHolding,
  watchBusy,
  actionError,
}: {
  watchBusy: boolean;
  actionError: string;
  instrument: InstrumentRef;
  onClose: () => void;
  onResearch: () => void;
  onSourceReview: () => void;
  sourceReviewBusy: boolean;
  onWatch: () => void;
  isSaved: boolean;
  onHolding: () => void;
}) {
  const [tab, setTab] = useState<
      "overview" | "financials" | "news" | "sources"
    >("overview"),
    [loading, setLoading] = useState(true),
    [errors, setErrors] = useState<string[]>([]),
    [quote, setQuote] = useState<ProviderResult<MarketQuote> | null>(null),
    [history, setHistory] = useState<ProviderResult<MarketHistory> | null>(
      null,
    ),
    [fundamentals, setFundamentals] =
      useState<ProviderResult<CompanyFundamentals> | null>(null),
    [news, setNews] = useState<ProviderResult<NewsArticle[]> | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const parameters = new URLSearchParams(
      Object.entries(instrument).filter(
        ([key, value]) => key !== "name" && !!value,
      ) as [string, string][],
    );
    const responses = await Promise.allSettled([
      request<ProviderResult<MarketQuote>>(`quote?${parameters}`),
      request<ProviderResult<MarketHistory>>(`history?${parameters}`),
      request<ProviderResult<CompanyFundamentals>>(
        `fundamentals?${parameters}`,
      ),
      request<ProviderResult<NewsArticle[]>>(`news?${parameters}`),
    ]);
    const messages: string[] = [];
    responses.forEach((response, index) => {
      if (response.status === "rejected") {
        messages.push(
          response.reason instanceof Error
            ? response.reason.message
            : "A data source could not be loaded.",
        );
        return;
      }
      if (index === 0) setQuote(response.value as ProviderResult<MarketQuote>);
      else if (index === 1)
        setHistory(response.value as ProviderResult<MarketHistory>);
      else if (index === 2)
        setFundamentals(response.value as ProviderResult<CompanyFundamentals>);
      else setNews(response.value as ProviderResult<NewsArticle[]>);
    });
    setErrors([...new Set(messages)]);
    setLoading(false);
  }, [instrument]);
  useEffect(() => {
    void load();
  }, [load]);
  const analysis = useMemo(() => {
    if (!history?.data) return null;
    try {
      return analyzeHistory(history.data);
    } catch {
      return null;
    }
  }, [history]);
  const q = quote?.data;
  const sources = (
    [
      ["Quote", quote],
      ["Price history", history],
      ["Fundamentals", fundamentals],
      ["News", news],
    ] as [string, ProviderResult<unknown> | null][]
  ).filter(
    (entry): entry is [string, ProviderResult<unknown>] => entry[1] !== null,
  );
  return (
    <Modal
      title={`${instrument.name || instrument.symbol}: instrument detail`}
      onClose={onClose}
      wide
    >
      <div className="tp-asset-dialog-heading">
        <span className="tp-company-monogram">
          {instrument.symbol.slice(0, 2)}
        </span>
        <div>
          <h2>
            {fundamentals?.data?.name || instrument.name || instrument.symbol}
          </h2>
          <p>
            {instrument.symbol} · {instrument.exchange || instrument.market} ·{" "}
            {q?.currency || instrument.currency || "Currency not reported"}
          </p>
        </div>
        <Button small disabled={watchBusy} onClick={onWatch}>
          <Bookmark size={15} fill={isSaved ? "currentColor" : "none"} />
          {isSaved ? "Watching" : "Watch"}
        </Button>
      </div>
      <div className="tp-asset-quote">
        <strong>
          {q
            ? observedAmount(q.price, q.currency || instrument.currency, 2)
            : "Quote unavailable"}
        </strong>
        {q?.changePercent != null && (
          <span
            className={q.changePercent >= 0 ? "tp-positive" : "tp-negative"}
          >
            {percent(q.changePercent)}
          </span>
        )}
        <small>
          {q
            ? `Observed ${when(q.asOf)} · ${quote?.provenance.provider}`
            : quote?.warnings.join(" ") ||
              "No observed price has been returned."}
        </small>
      </div>
      <div className="tp-detail-nav" aria-label="Instrument sections">
        {(["overview", "financials", "news", "sources"] as const).map(
          (section) => (
            <button
              className={tab === section ? "active" : ""}
              aria-pressed={tab === section}
              onClick={() => setTab(section)}
              key={section}
            >
              {section === "financials"
                ? "Fundamentals"
                : section[0].toUpperCase() + section.slice(1)}
            </button>
          ),
        )}
        <IconButton
          label="Refresh observed instrument data"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={15} className={loading ? "tp-spin" : ""} />
        </IconButton>
      </div>
      <div className="tp-asset-dialog-body">
        {actionError && <Notice tone="error">{actionError}</Notice>}
        {errors.length > 0 && (
          <Notice tone="warning">{errors.join(" ")}</Notice>
        )}
        {loading ? (
          <LoadingPanel text="Retrieving observed instrument data" />
        ) : tab === "overview" ? (
          <>
            {history?.data ? (
              <QuoteChart history={history.data} />
            ) : (
              <>
                <Notice>
                  {history?.warnings.join(" ") ||
                    "Your configured provider has not returned dated bars for this listing."}
                </Notice>
                <TradingViewChart instrument={instrument} />
              </>
            )}
            {analysis && (
              <>
                <div className="tp-detail-metrics">
                  <div>
                    <span>Historical annualized return</span>
                    <strong>{percent(analysis.annualizedReturn)}</strong>
                  </div>
                  <div>
                    <span>Annualized volatility</span>
                    <strong>
                      {analysis.annualizedVolatility != null
                        ? `${num(analysis.annualizedVolatility, 1)}%`
                        : "Unavailable"}
                    </strong>
                  </div>
                  <div>
                    <span>Historical max drawdown</span>
                    <strong>
                      {analysis.maxDrawdown != null
                        ? `${num(analysis.maxDrawdown, 1)}%`
                        : "Unavailable"}
                    </strong>
                  </div>
                  <div>
                    <span>Dated observations</span>
                    <strong>{analysis.observations}</strong>
                  </div>
                </div>
                {analysis.warnings.length > 0 && (
                  <Notice tone="warning">{analysis.warnings.join(" ")}</Notice>
                )}
                <p className="tp-caption">
                  Historical calculations describe the supplied observation
                  window. They do not predict returns or cap future losses.
                </p>
              </>
            )}
          </>
        ) : tab === "financials" ? (
          fundamentals?.data ? (
            <>
              <div className="tp-fundamental-meta">
                <span>{fundamentals.data.sector || "Sector unavailable"}</span>
                <span>
                  {fundamentals.data.industry || "Industry unavailable"}
                </span>
                <span>
                  Fiscal period:{" "}
                  {fundamentals.data.fiscalDate
                    ? day(fundamentals.data.fiscalDate)
                    : "Not reported"}
                </span>
              </div>
              <div className="tp-fundamental-grid">
                {Object.entries(fundamentals.data.metrics).map(
                  ([name, metric]) => (
                    <div key={name}>
                      <span>
                        {(
                          {
                            pe: "Price / earnings",
                            priceToBook: "Price / book",
                            roe: "Return on equity",
                            operatingMargin: "Operating margin",
                            debtToEquity: "Debt / equity",
                            revenueGrowth: "Revenue growth",
                            dividendYield: "Dividend yield",
                            marketCap: "Market capitalization",
                            eps: "Earnings per share",
                          } as Record<string, string>
                        )[name] || name}
                      </span>
                      <strong>
                        {metric.value === null
                          ? "Unavailable"
                          : metric.unit === "percent"
                            ? `${num(metric.value)}%`
                            : metric.unit === "currency"
                              ? observedAmount(
                                  metric.value,
                                  fundamentals.data!.currency,
                                  2,
                                )
                              : metric.unit === "currency_millions"
                                ? `${num(metric.value)}m ${fundamentals.data!.currency || ""}`
                                : num(metric.value)}
                      </strong>
                      <small>
                        {metric.period || metric.note || "Period not reported"}
                      </small>
                    </div>
                  ),
                )}
              </div>
            </>
          ) : (
            <Empty icon={Database} title="Fundamentals were not returned">
              {fundamentals?.warnings.join(" ") ||
                "No financial statements or company metrics are available from this connection."}
            </Empty>
          )
        ) : tab === "news" ? (
          news?.data?.length ? (
            <div className="tp-detail-news">
              {news.data.map((article) => (
                <Article key={article.id} article={article} />
              ))}
            </div>
          ) : (
            <Empty icon={Newspaper} title="No dated reporting available">
              {news?.warnings.join(" ") ||
                "This source did not return company news for the selected listing."}
            </Empty>
          )
        ) : (
          <div className="tp-provenance-list">
            {sources.map(([name, source]) => (
              <section key={name}>
                <div>
                  <strong>{name}</strong>
                  <Status
                    tone={
                      source.status === "ok"
                        ? "green"
                        : source.status === "partial"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {source.status.replaceAll("_", " ")}
                  </Status>
                </div>
                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{source.provenance.provider}</dd>
                  </div>
                  <div>
                    <dt>Observation date</dt>
                    <dd>{when(source.provenance.asOf)}</dd>
                  </div>
                  <div>
                    <dt>Retrieved</dt>
                    <dd>{when(source.provenance.fetchedAt)}</dd>
                  </div>
                  <div>
                    <dt>Quote convention</dt>
                    <dd>
                      {source.provenance.delay.replaceAll("_", " ")} ·{" "}
                      {source.provenance.adjustment.replaceAll("_", " ")}
                    </dd>
                  </div>
                </dl>
                {source.warnings.length > 0 && (
                  <p>{source.warnings.join(" ")}</p>
                )}
                {safeLink(source.provenance.sourceUrl) && (
                  <a
                    href={source.provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Provider source
                    <ExternalLink size={13} />
                  </a>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
      <div className="tp-detail-footer">
        <p className="tp-caption">
          Source review checks evidence and its limits. Deep research uses your
          assigned models. Neither places trades.
        </p>
        <Button disabled={watchBusy} onClick={onHolding}>
          <Plus size={15} />
          Add existing holding
        </Button>
        <Button disabled={watchBusy} onClick={onResearch}>
          <Sparkles size={15} />
          Deep research
        </Button>
        <Button variant="primary" disabled={watchBusy} onClick={onSourceReview}>
          {sourceReviewBusy ? (
            <Loader2 size={15} className="tp-spin" />
          ) : (
            <ShieldCheck size={15} />
          )}
          {sourceReviewBusy ? "Queueing review" : "Review source evidence"}
        </Button>
      </div>
    </Modal>
  );
}

function InstrumentPicker({
  market,
  selected,
  onSelect,
  label = "Find an instrument",
}: {
  market: Market;
  selected?: InstrumentRef;
  onSelect: (instrument: InstrumentRef) => void;
  label?: string;
}) {
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<MarketItem[]>([]),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [highlight, setHighlight] = useState(0),
    [providerSearch, setProviderSearch] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setProviderSearch(false);
    void request<MarketsResponse>(
      `markets?markets=${market}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => setItems(result.instruments))
      .catch((error) => {
        if (!controller.signal.aborted) setError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [market]);
  const filtered = items
    .filter(
      (item) =>
        !query ||
        `${item.name || ""} ${item.symbol} ${item.exchange || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, 30);
  const select = (item: InstrumentRef) => {
    onSelect(item);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };
  return (
    <div
      className="tp-instrument-picker"
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <label>{label}</label>
      {selected?.symbol && (
        <div className="tp-selected-instrument">
          <span className="tp-company-monogram">
            {selected.symbol.slice(0, 2)}
          </span>
          <span>
            <strong>{selected.name || selected.symbol}</strong>
            <small>
              {selected.symbol} · {selected.exchange || selected.market}
            </small>
          </span>
          <CheckCircle2 size={16} />
        </div>
      )}
      <div className="tp-picker-input">
        <Search size={16} />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={id}
          aria-activedescendant={
            open && filtered[highlight] ? `${id}-${highlight}` : undefined
          }
          placeholder={
            selected?.symbol
              ? "Search to change the instrument"
              : "Search company or ticker"
          }
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setHighlight((current) =>
                Math.min(current + 1, filtered.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && open && filtered[highlight]) {
              event.preventDefault();
              select(filtered[highlight]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
        {loading ? (
          <Loader2 size={15} className="tp-spin" />
        ) : (
          <ChevronDown size={14} />
        )}
      </div>
      {open && (
        <div
          className="tp-instrument-options"
          id={id}
          role="listbox"
          aria-label="Matching instruments"
        >
          <div className="tp-popover-heading">
            <strong>
              {providerSearch
                ? "Provider search results"
                : "Supported listings"}
            </strong>
            <small>{market}</small>
          </div>
          {loading ? (
            <p className="tp-picker-message">Loading listing catalog…</p>
          ) : filtered.length ? (
            filtered.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                id={`${id}-${index}`}
                className={index === highlight ? "highlighted" : ""}
                key={refKey(item)}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => select(item)}
              >
                <span>
                  <strong>{item.symbol}</strong>
                  <small>{item.name || "Name not reported"}</small>
                </span>
                <span>{item.exchange || item.market}</span>
              </button>
            ))
          ) : (
            <p className="tp-picker-message">
              No catalog match. You can search your connected provider or enter
              verified listing details below.
            </p>
          )}
          {error && <p className="tp-picker-error">{error}</p>}
          {query.trim() && (
            <button
              type="button"
              className="tp-provider-search"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError("");
                try {
                  const result = await request<MarketsResponse>(
                    `markets?markets=${market}&q=${encodeURIComponent(query.trim())}`,
                  );
                  setItems(result.instruments);
                  setProviderSearch(true);
                  setHighlight(0);
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Search size={14} />
              Search connected provider for “{query}”
            </button>
          )}
          <p className="tp-picker-footer">
            Listing metadata does not establish that quotes or history are
            available.
          </p>
        </div>
      )}
    </div>
  );
}
function ResearchWorkspace({
  input,
  setInput,
  scope,
  setScope,
  positions,
  settings,
  ready,
  busy,
  onSettings,
  onSubmit,
}: {
  input: ResearchAgentInput;
  setInput: (
    value:
      | ResearchAgentInput
      | ((current: ResearchAgentInput) => ResearchAgentInput),
  ) => void;
  scope: "custom" | "portfolio";
  setScope: (value: "custom" | "portfolio") => void;
  positions: PositionValuation[];
  settings: PublicAISettings;
  ready: boolean;
  busy: boolean;
  onSettings: () => void;
  onSubmit: (input: ResearchAgentInput) => Promise<void>;
}) {
  const [focus, setFocus] = useState("quality"),
    [notes, setNotes] = useState(""),
    [candidate, setCandidate] = useState<InstrumentRef>({
      symbol: "",
      market: "US",
    }),
    [symbols, setSymbols] = useState<InstrumentRef[]>([]);
  const questions: Record<string, string> = {
    quality:
      "Assess business quality, valuation context and material risks. Challenge the thesis with source-cited counterarguments.",
    comparison:
      "Compare the selected companies, their concentration risks and the evidence that could invalidate each investment thesis.",
    news: "Investigate recent dated reporting, material catalysts, conflicting coverage and unsupported claims about the selected companies.",
    portfolio:
      "Review my recorded portfolio for concentration, material risks and opportunities for further research.",
  };
  useEffect(() => {
    if (input.symbols?.length && !symbols.length)
      setSymbols(
        input.symbols.map((symbol) => ({
          symbol,
          market: (input.markets[0] as Market) || "US",
        })),
      );
  }, [input.symbols]);
  const change = <K extends keyof ResearchAgentInput>(
    key: K,
    value: ResearchAgentInput[K],
  ) => setInput((current) => ({ ...current, [key]: value }));
  const scopedPositions = scope === "portfolio" ? positions : [];
  return (
    <>
      <Heading
        eyebrow="OPPORTUNITIES DESERVE HARD QUESTIONS"
        title="Build the brief. Let the agents challenge it."
        body="A bounded committee researches the business, quantitative evidence, news and the counterargument."
      />
      <div className="tp-research-layout">
        <section className="tp-panel tp-research-form">
          <PanelHead
            title="Your research brief"
            body="Start with a focus and the listings you want examined."
          />
          <form
            className="tp-form"
            onSubmit={(event) => {
              event.preventDefault();
              const question =
                (scope === "portfolio"
                  ? questions.portfolio
                  : questions[focus]) +
                (notes.trim() ? ` Additional context: ${notes.trim()}` : "");
              void onSubmit({
                ...input,
                question,
                markets:
                  scope === "portfolio"
                    ? [...new Set(positions.map((p) => p.instrument.market))]
                    : input.markets,
                symbols:
                  scope === "portfolio"
                    ? positions.map((p) => p.instrument.symbol)
                    : symbols.map((i) => i.symbol),
                ...(scope === "portfolio"
                  ? {
                      portfolioContext: JSON.stringify(
                        scopedPositions.map((p) => ({
                          instrument: p.instrument,
                          quantity: p.quantity,
                          currency: p.currency,
                          costBasis: p.costBasis,
                        })),
                      ),
                    }
                  : { portfolioContext: undefined }),
              });
            }}
          >
            <fieldset className="tp-choice-field">
              <legend>What should the committee examine?</legend>
              <div className="tp-segment tp-scope-segment">
                <button
                  type="button"
                  className={scope === "custom" ? "active" : ""}
                  aria-pressed={scope === "custom"}
                  onClick={() => setScope("custom")}
                >
                  Selected companies
                </button>
                <button
                  type="button"
                  className={scope === "portfolio" ? "active" : ""}
                  aria-pressed={scope === "portfolio"}
                  disabled={!positions.length}
                  onClick={() => setScope("portfolio")}
                >
                  My portfolio <span>{positions.length}</span>
                </button>
              </div>
            </fieldset>
            {scope === "custom" ? (
              <>
                <label>
                  Research focus
                  <select
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                  >
                    <option value="quality">
                      Business quality, valuation and risk
                    </option>
                    <option value="comparison">
                      Compare companies and tradeoffs
                    </option>
                    <option value="news">
                      News catalysts and conflicting evidence
                    </option>
                  </select>
                </label>
                <RegionPicker
                  value={input.markets as Market[]}
                  onChange={(value) => change("markets", value)}
                />
                <SectorPicker
                  value={input.sectors}
                  onChange={(value) => change("sectors", value)}
                />
                <div className="tp-form-grid tp-candidate-controls">
                  <label>
                    Listing market
                    <select
                      value={candidate.market}
                      onChange={(event) =>
                        setCandidate({
                          symbol: "",
                          market: event.target.value as Market,
                        })
                      }
                    >
                      {REGIONS.map((m) => (
                        <option key={m} value={m}>
                          {REGION[m].name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <InstrumentPicker
                    label="Add a research candidate"
                    market={candidate.market}
                    onSelect={(instrument) => {
                      setCandidate(instrument);
                      setSymbols((current) =>
                        current.some((i) => refKey(i) === refKey(instrument))
                          ? current
                          : [...current, instrument],
                      );
                      if (!input.markets.includes(instrument.market))
                        change("markets", [
                          ...input.markets,
                          instrument.market,
                        ]);
                    }}
                  />
                </div>
                {symbols.length > 0 && (
                  <div className="tp-candidate-chips">
                    {symbols.map((instrument) => (
                      <span key={refKey(instrument)}>
                        <strong>{instrument.symbol}</strong>
                        <small>
                          {instrument.exchange || instrument.market}
                        </small>
                        <button
                          type="button"
                          aria-label={`Remove ${instrument.symbol} research candidate`}
                          onClick={() =>
                            setSymbols((current) =>
                              current.filter(
                                (i) => refKey(i) !== refKey(instrument),
                              ),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="tp-field-hint">
                  Leave candidates empty to let the planner propose a small,
                  bounded source-verification scope. Proposed tickers are not
                  accepted as opportunities without evidence.
                </p>
              </>
            ) : (
              <div className="tp-scope-summary">
                <BriefcaseBusiness size={21} />
                <div>
                  <strong>{positions.length} recorded positions</strong>
                  <p>{positions.map((p) => p.instrument.symbol).join(", ")}</p>
                  <small>
                    Your recorded quantities, costs and listing details are
                    included in this research request.
                  </small>
                </div>
              </div>
            )}
            <label>
              Additional context<span className="tp-optional">Optional</span>
              <textarea
                value={notes}
                maxLength={2500}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What would make this research useful for your decision?"
                rows={3}
              />
            </label>
            <details className="tp-advanced">
              <summary>
                Investment preferences
                <ChevronDown size={14} />
              </summary>
              <div className="tp-form-grid">
                <label>
                  Annual return aspiration (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={input.risk.targetReturn}
                    onChange={(event) =>
                      change("risk", {
                        ...input.risk,
                        targetReturn: Number(event.target.value),
                      })
                    }
                  />
                  <small className="tp-field-hint">
                    A goal to research, never a forecast.
                  </small>
                </label>
                <label>
                  Time horizon
                  <select
                    value={input.risk.horizonMonths}
                    onChange={(event) =>
                      change("risk", {
                        ...input.risk,
                        horizonMonths: Number(event.target.value),
                      })
                    }
                  >
                    {[6, 12, 24, 36, 60, 120].map((months) => (
                      <option key={months} value={months}>
                        {months < 12
                          ? `${months} months`
                          : `${months / 12} ${months === 12 ? "year" : "years"}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="tp-form-grid">
                <label>
                  Volatility tolerance (%)
                  <input
                    type="number"
                    min="1"
                    max="80"
                    value={input.risk.maxVolatility}
                    onChange={(event) =>
                      change("risk", {
                        ...input.risk,
                        maxVolatility: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Historical drawdown tolerance (%)
                  <input
                    type="number"
                    min="0"
                    max="80"
                    value={input.risk.maxDrawdown}
                    onChange={(event) =>
                      change("risk", {
                        ...input.risk,
                        maxDrawdown: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </details>
            {!ready && (
              <Notice tone="warning">
                <strong>Your committee needs a model assignment.</strong>
                <p>
                  Connect an AI provider, load its actual model catalog and
                  choose models for the research roles.
                </p>
                <Button type="button" small onClick={onSettings}>
                  Configure research agents
                  <ArrowRight size={14} />
                </Button>
              </Notice>
            )}
            <Button
              variant="primary"
              className="tp-full"
              disabled={busy || !ready}
            >
              {busy ? (
                <Loader2 size={17} className="tp-spin" />
              ) : (
                <Sparkles size={17} />
              )}
              Run research committee
              <ArrowRight size={16} />
            </Button>
            <p className="tp-caption">
              This sends the selected brief and available evidence to your
              configured providers. Your provider's usage terms apply.
            </p>
          </form>
        </section>
        <aside className="tp-research-aside">
          <section className="tp-panel tp-committee-card">
            <PanelHead
              title="A committee, not a single opinion"
              body="Each role has a clear job and an inspectable execution record."
            />
            {(Object.keys(ROLE_NAMES) as AIRole[]).map((role, index) => {
              const assignment = settings.roles[role];
              return (
                <div key={role}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{ROLE_NAMES[role]}</strong>
                    <small>
                      {assignment.model
                        ? `${PROVIDER_NAMES[assignment.provider]} · ${assignment.model}`
                        : "Model not selected"}
                    </small>
                  </div>
                  {assignment.model ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <Minus size={15} />
                  )}
                </div>
              );
            })}
            <Button small variant="ghost" onClick={onSettings}>
              Manage role assignments
              <ArrowUpRight size={14} />
            </Button>
          </section>
          <section className="tp-principle-note">
            <ShieldCheck size={22} />
            <h3>A persuasive answer still needs evidence.</h3>
            <p>
              Models can request bounded sources and challenge conclusions.
              Missing facts remain missing, and computational risk controls stay
              separate from the narrative.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
function SourceReadinessSummary({ report }: { report: SourceReviewReport }) {
  const audit = report.sourceAudit;
  const labels = {
    quote: "Usable market quote",
    history: "Usable dated price history",
    fundamentals: "Usable company financials",
  };
  const coverage = (value: SourceReviewReport["sourceAudit"]["critic"]) =>
    !value
      ? "No accepted result"
      : value.coverage === "fundamentals_only"
        ? "Company financials only"
        : value.coverage === "market_data_complete"
          ? "Required source types present"
          : "Incomplete source coverage";
  return (
    <section className="tp-source-readiness">
      <div className="tp-source-readiness-heading">
        <div>
          <p className="tp-eyebrow">BINDING SOURCE ASSESSMENT</p>
          <h3>
            {audit.decision === "ready_for_quant_review"
              ? "Sources support a quantitative review."
              : "Market evidence is incomplete."}
          </h3>
        </div>
        <Status tone={audit.missing.length ? "amber" : "green"}>
          {audit.missing.length ? "Gaps remain" : "Source types present"}
        </Status>
      </div>
      {audit.missing.length > 0 && (
        <ul className="tp-source-gap-list">
          {audit.missing.map((kind) => (
            <li key={kind}>
              <CircleHelp size={15} aria-hidden="true" />
              {labels[kind]} unavailable
            </li>
          ))}
        </ul>
      )}
      <dl className="tp-source-review-checks">
        <div>
          <dt>Deterministic source plan</dt>
          <dd>
            {audit.missing.length
              ? `${audit.missing.length} required input${audit.missing.length === 1 ? "" : "s"} unavailable`
              : "Required source types available"}
          </dd>
        </div>
        <div>
          <dt>Model countercheck</dt>
          <dd>
            {coverage(audit.critic)}
            {audit.criticAgreement === true ? " · matches source plan" : ""}
          </dd>
        </div>
        <div>
          <dt>Accepted model counterchecks</dt>
          <dd>{Number(audit.critic !== null)} of 1</dd>
        </div>
        <div>
          <dt>Historical memory</dt>
          <dd>
            {report.memory.reused
              ? `${report.memory.count} historical record${report.memory.count === 1 ? "" : "s"} recalled`
              : "No previous decision reused"}
          </dd>
        </div>
      </dl>
      {report.memory.reused && report.memory.context?.trim() && (
        <details className="tp-historical-context">
          <summary>Inspect historical context</summary>
          <div>
            <Status tone="amber">Historical · untrusted</Status>
            <p className="tp-caption">
              This retained excerpt is not current financial evidence.
              Revalidate the source observations before applying a previous
              decision.
            </p>
            <blockquote>{report.memory.context}</blockquote>
          </div>
        </details>
      )}
      <p className="tp-caption">
        Source requirements determine the plan. Model output cannot remove
        source gaps; receipts show actual execution. {report.memory.engine}{" "}
        history is not current financial evidence. This review does not approve
        an investment.
      </p>
    </section>
  );
}

function SourceDeliveryReceipts({ report }: { report: SourceReviewReport }) {
  return (
    <section className="tp-layer-receipts">
      <h3>Data delivery receipts</h3>
      <p>
        Original financial dates stay visible when source observations are read
        through Zetaris.
      </p>
      {report.dataLayerReceipts.map((receipt, index) => (
        <article key={`${receipt.payloadHash || receipt.status}-${index}`}>
          <div>
            <strong>
              {receipt.provider} delivery {index + 1}
            </strong>
            <Status
              tone={
                receipt.status === "verified" && receipt.actual
                  ? "green"
                  : receipt.status === "failed"
                    ? "red"
                    : "neutral"
              }
            >
              {receipt.status === "verified" && receipt.actual
                ? "Actual read verified"
                : receipt.status === "not_applicable"
                  ? "No observation supplied"
                  : receipt.status === "verified"
                    ? "Verification not confirmed"
                    : receipt.status}
            </Status>
          </div>
          <p>{receipt.message}</p>
          <dl className="tp-source-review-checks">
            <div>
              <dt>Original source date</dt>
              <dd>
                {receipt.sourceAsOf ? day(receipt.sourceAsOf) : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Zetaris read time</dt>
              <dd>
                {receipt.queriedAt
                  ? when(receipt.queriedAt)
                  : "No read completed"}
              </dd>
            </div>
          </dl>
          {receipt.payloadHash && (
            <details>
              <summary>Inspect payload fingerprint</summary>
              <code className="tp-delivery-fingerprint">
                {receipt.payloadHash}
              </code>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}

function ReportDialog({
  report,
  onClose,
}: {
  report: StructuredResearchReport;
  onClose: () => void;
}) {
  const sourceReview =
    "workflow" in report && report.workflow === "source_review"
      ? (report as SourceReviewReport)
      : null;
  const [tab, setTab] = useState<"findings" | "trace" | "sources" | "usage">(
    "findings",
  );
  const totalTokens = report.receipts.reduce(
    (s, r) => s + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  );
  const hasReportedTokens = report.receipts.some(
    (receipt) => receipt.inputTokens !== null || receipt.outputTokens !== null,
  );
  return (
    <Modal
      title={sourceReview ? "Source evidence review" : "Research report"}
      onClose={onClose}
      wide
    >
      <div className="tp-report-heading">
        <p className="tp-eyebrow">
          {sourceReview
            ? "THE EVIDENCE, WITH ITS LIMITS"
            : "AN ARGUMENT YOU CAN INSPECT"}
        </p>
        <h2>{report.input.question || "Investment research"}</h2>
        <div>
          <Status
            tone={
              report.status === "completed"
                ? "green"
                : report.status === "failed"
                  ? "red"
                  : "amber"
            }
          >
            {report.status}
          </Status>
          <span>{when(report.completedAt || report.startedAt)}</span>
          <span>{report.evidence.length} evidence records</span>
        </div>
      </div>
      <div className="tp-detail-nav">
        {(["findings", "trace", "sources", "usage"] as const).map((section) => (
          <button
            key={section}
            className={tab === section ? "active" : ""}
            aria-pressed={tab === section}
            onClick={() => setTab(section)}
          >
            {section === "trace"
              ? "Agent trace"
              : section === "usage"
                ? "Model receipts"
                : section[0].toUpperCase() + section.slice(1)}
          </button>
        ))}
      </div>
      <div className="tp-report-body">
        {report.error && (
          <Notice tone="error">
            <strong>{report.error.code.replaceAll("_", " ")}</strong>
            <p>{report.error.message}</p>
          </Notice>
        )}
        {tab === "findings" ? (
          <>
            {sourceReview && <SourceReadinessSummary report={sourceReview} />}
            {report.findings.length ? (
              report.findings.map((finding, index) => (
                <article className="tp-finding" key={index}>
                  <div>
                    <span className="tp-symbol-tag">
                      {finding.symbol || "Portfolio perspective"}
                    </span>
                    <Status tone="neutral">
                      {finding.confidence} model confidence
                    </Status>
                  </div>
                  <h3>{finding.thesis}</h3>
                  <div className="tp-finding-columns">
                    <section>
                      <h4>The counterargument</h4>
                      <ul>
                        {finding.risks.map((risk, i) => (
                          <li key={i}>{risk}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h4>What would change the thesis</h4>
                      <p>{finding.invalidation}</p>
                    </section>
                  </div>
                  <div className="tp-citation-list">
                    {finding.evidenceIds.map((id) => {
                      const evidence = report.evidence.find((e) => e.id === id);
                      return (
                        <button key={id} onClick={() => setTab("sources")}>
                          <FileText size={12} />
                          {evidence?.title || id}
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))
            ) : sourceReview ? null : (
              <Empty
                icon={ShieldCheck}
                title="No investment thesis was accepted."
              >
                The report did not establish a sufficiently supported
                conclusion. Review the evidence gaps and actual execution state.
              </Empty>
            )}
            {report.unansweredQuestions.length > 0 && (
              <section className="tp-open-questions">
                <h3>What remains unresolved</h3>
                <ul>
                  {report.unansweredQuestions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </section>
            )}
            {report.risks.length > 0 && (
              <section className="tp-open-questions">
                <h3>Material risks</h3>
                <ul>
                  {report.risks.map((risk, index) => (
                    <li key={index}>{risk}</li>
                  ))}
                </ul>
              </section>
            )}
            {report.limitations.length > 0 && (
              <Notice tone="warning">{report.limitations.join(" ")}</Notice>
            )}
          </>
        ) : tab === "trace" ? (
          <div className="tp-agent-timeline">
            {report.events.map((event) => (
              <article key={event.id}>
                <span className={`tp-timeline-dot ${event.type}`}>
                  {event.type === "completed" ? (
                    <Check size={12} />
                  ) : event.type === "model" ? (
                    <Sparkles size={12} />
                  ) : (
                    <span />
                  )}
                </span>
                <div>
                  <div className="tp-timeline-meta">
                    <strong>{event.stage}</strong>
                    <span>{event.type}</span>
                    <time>{when(event.at)}</time>
                  </div>
                  <p>{event.message}</p>
                  {event.receiptId && <small>Receipt {event.receiptId}</small>}
                </div>
              </article>
            ))}
          </div>
        ) : tab === "sources" ? (
          <div className="tp-report-sources">
            {sourceReview && <SourceDeliveryReceipts report={sourceReview} />}
            {report.evidence.map((evidence) => (
              <article key={evidence.id}>
                <div>
                  <span className="tp-symbol-tag">{evidence.kind}</span>
                  <small>{evidence.symbol}</small>
                </div>
                <h3>
                  {safeLink(evidence.url) ? (
                    <a
                      href={evidence.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {evidence.title}
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    evidence.title
                  )}
                </h3>
                <p>
                  {evidence.source} ·{" "}
                  {evidence.asOf
                    ? `Dated ${day(evidence.asOf)}`
                    : "Publication date not verified"}{" "}
                  · Retrieved {when(evidence.retrievedAt)}
                </p>
                {evidence.warnings?.length > 0 && (
                  <p className="tp-source-warning">
                    {evidence.warnings.join(" ")}
                  </p>
                )}
                <details>
                  <summary>Inspect retained source content</summary>
                  <pre>{JSON.stringify(evidence.content, null, 2)}</pre>
                </details>
                <code>{evidence.id}</code>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="tp-usage-metrics">
              <div>
                <span>Model requests</span>
                <strong>{report.budget.modelCalls}</strong>
              </div>
              <div>
                <span>Source requests</span>
                <strong>{report.budget.toolCalls}</strong>
              </div>
              <div>
                <span>Reported tokens</span>
                <strong>
                  {hasReportedTokens ? num(totalTokens, 0) : "Unavailable"}
                </strong>
              </div>
              <div>
                <span>Calls without complete usage</span>
                <strong>{report.budget.unknownUsageCalls}</strong>
              </div>
            </div>
            {report.receipts.map((receipt) => (
              <article className="tp-receipt" key={receipt.id}>
                <div>
                  <strong>
                    {ROLE_NAMES[receipt.role as AIRole] || receipt.role}
                  </strong>
                  <Status
                    tone={receipt.status === "completed" ? "green" : "amber"}
                  >
                    {receipt.status.replaceAll("_", " ")}
                  </Status>
                </div>
                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{PROVIDER_NAMES[receipt.provider]}</dd>
                  </div>
                  <div>
                    <dt>Requested model</dt>
                    <dd>{receipt.requestedModel}</dd>
                  </div>
                  <div>
                    <dt>Returned model</dt>
                    <dd>{receipt.responseModel || "Not reported"}</dd>
                  </div>
                  <div>
                    <dt>Input / output tokens</dt>
                    <dd>
                      {num(receipt.inputTokens, 0)} /{" "}
                      {num(receipt.outputTokens, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt>Provider-reported cost</dt>
                    <dd>
                      {receipt.reportedCostUsd === null
                        ? "Not reported"
                        : amount(receipt.reportedCostUsd, "USD", 5)}
                    </dd>
                  </div>
                  <div>
                    <dt>Latency</dt>
                    <dd>{num(receipt.latencyMs / 1000, 2)} seconds</dd>
                  </div>
                </dl>
                <small>{receipt.requestId || receipt.id}</small>
              </article>
            ))}
          </>
        )}
      </div>
      <div className="tp-detail-footer">
        <p className="tp-caption">
          A source citation records what was used. It does not certify that
          every model interpretation is correct.
        </p>
        <Button
          onClick={() =>
            downloadJSON(report, `thesis-research-${report.id}.json`)
          }
        >
          <Download size={15} />
          Export research
        </Button>
      </div>
    </Modal>
  );
}

function SettingsWorkspace({
  settings,
  dataSettings,
  tab,
  setTab,
  identity,
  onReload,
  onGoogle,
  onNotice,
  onError,
  busyGoogle,
  portfolioMethod,
  preferences,
  activeWork,
}: {
  preferences?: Preferences;
  activeWork: boolean;
  settings: PublicAISettings;
  dataSettings: DataSettings;
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  identity: WorkspaceIdentity | null;
  onReload: () => Promise<void>;
  onGoogle: () => Promise<void>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  busyGoogle: boolean;
  portfolioMethod: "fifo" | "average";
}) {
  const { confirm, confirmation } = useConfirmedAction();
  const [purposes, setPurposes] = useState<
    Partial<Record<DataPurpose, MarketProvider | null>>
  >({});
  useEffect(() => {
    setPurposes(
      Object.fromEntries(
        (
          [
            "quoteProvider",
            "historyProvider",
            "fundamentalsProvider",
            "newsProvider",
          ] as DataPurpose[]
        ).map((key) => [key, preferences?.[key] || null]),
      ),
    );
  }, [preferences]);
  const [roles, setRoles] = useState(settings.roles),
    [budget, setBudget] = useState(settings.budget),
    [busy, setBusy] = useState(false),
    [searchKey, setSearchKey] = useState(""),
    [searchProvider, setSearchProvider] = useState<"brave" | "tavily">(
      settings.search.provider || "brave",
    );
  useEffect(() => {
    setRoles(settings.roles);
    setBudget(settings.budget);
  }, [settings]);
  const action = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    onError("");
    try {
      await fn();
      await onReload();
      onNotice(message);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportAccount = () =>
    action(async () => {
      const response = await workspaceFetch("/api/platform/account");
      if (!response.ok)
        throw new Error("The workspace export could not be prepared.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "thesis-private-workspace.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "Your private workspace export is ready.");
  return (
    <>
      <Heading
        eyebrow="MAKE THE WORKSPACE YOURS"
        title="Thoughtful research starts with the right setup."
        body="Choose your data, your models and the roles they play. Your keys stay on the server."
      />
      <div className="tp-settings-tabs" aria-label="Settings sections">
        {(
          [
            { id: "ai", label: "AI providers", icon: Sparkles },
            { id: "data", label: "Market data", icon: Database },
            { id: "routing", label: "Agent roles", icon: Layers3 },
            { id: "account", label: "Account & privacy", icon: ShieldCheck },
          ] as const
        ).map((section) => (
          <button
            className={tab === section.id ? "active" : ""}
            aria-pressed={tab === section.id}
            onClick={() => setTab(section.id)}
            key={section.id}
          >
            <section.icon size={16} />
            {section.label}
          </button>
        ))}
      </div>
      {tab === "ai" ? (
        <>
          <section className="tp-settings-intro">
            <div>
              <h2>Your provider. Your actual models.</h2>
              <p>
                Save a key, discover the models available to that account, then
                assign them to the committee. A catalog listing is not an
                inference test.
              </p>
            </div>
            <label>
              Default provider
              <select
                value={settings.defaultProvider}
                disabled={busy}
                onChange={(event) =>
                  void action(
                    () =>
                      request("settings", "PATCH", {
                        defaultProvider: event.target.value,
                      }),
                    "Default AI provider saved.",
                  )
                }
              >
                {settings.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <div className="tp-provider-grid">
            {settings.providers
              .filter(
                (provider) =>
                  provider.id !== "nightshift" || provider.keyConfigured,
              )
              .map((provider) => (
                <AIProviderCard
                  key={provider.id}
                  provider={provider}
                  isDefault={settings.defaultProvider === provider.id}
                  onReload={onReload}
                  onNotice={onNotice}
                />
              ))}
          </div>
          <section className="tp-panel tp-key-note">
            <LockKeyhole size={22} />
            <div>
              <h3>A connection is more than a saved key.</h3>
              <p>
                Keys are encrypted on the server and only their last four
                characters are returned. Model catalogs, compatibility checks
                and actual research receipts are reported separately.
              </p>
            </div>
            <Button onClick={() => setTab("routing")}>
              Assign research roles
              <ArrowRight size={15} />
            </Button>
          </section>
        </>
      ) : tab === "data" ? (
        <>
          <section className="tp-settings-intro">
            <div>
              <h2>Market facts need an entitled source.</h2>
              <p>
                A free API key does not automatically permit display,
                redistribution or AI processing. Confirm the permissions that
                apply to your account.
              </p>
            </div>
            <label>
              Selected data source
              <select
                value={dataSettings.selected}
                disabled={busy}
                onChange={(event) =>
                  void action(
                    () =>
                      request("preferences", "PATCH", {
                        dataProvider: event.target.value,
                      }),
                    "Market data source saved.",
                  )
                }
              >
                {dataSettings.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="tp-panel tp-purpose-settings">
            <PanelHead
              title="Data sources by purpose"
              body="Choose explicit sources for each task. There is no silent switching between your paid requests."
            />
            <div className="tp-form-grid">
              {(
                [
                  { id: "quoteProvider", label: "Quotes and valuations" },
                  { id: "historyProvider", label: "Dated price history" },
                  { id: "fundamentalsProvider", label: "Company fundamentals" },
                  { id: "newsProvider", label: "Company news" },
                ] as const
              ).map((purpose) => (
                <label key={purpose.id}>
                  {purpose.label}
                  <select
                    value={purposes[purpose.id] || ""}
                    onChange={(event) =>
                      setPurposes((current) => ({
                        ...current,
                        [purpose.id]:
                          (event.target.value as MarketProvider) || null,
                      }))
                    }
                  >
                    <option value="">Use selected provider</option>
                    {dataSettings.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                        {provider.keyConfigured &&
                        provider.entitlementAcknowledged
                          ? ""
                          : " · setup needed"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="tp-settings-save">
              <p>
                Public news metadata and chart widgets keep their own visible
                source labels.
              </p>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (
                    [
                      "quoteProvider",
                      "historyProvider",
                      "fundamentalsProvider",
                      "newsProvider",
                    ] as DataPurpose[]
                  ).every(
                    (key) =>
                      (purposes[key] || null) === (preferences?.[key] || null),
                  )
                }
                onClick={() =>
                  void action(
                    () => request("preferences", "PATCH", purposes),
                    "Data sources by purpose saved.",
                  )
                }
              >
                <Check size={15} />
                Save data routing
              </Button>
            </div>
          </section>
          <div className="tp-data-provider-stack">
            {dataSettings.providers.map((provider) => (
              <DataProviderCard
                key={provider.id}
                provider={provider}
                selected={provider.id === dataSettings.selected}
                onReload={onReload}
                onNotice={onNotice}
              />
            ))}
          </div>
          <section className="tp-panel tp-key-note">
            <Globe2 size={23} />
            <div>
              <h3>Chart sources remain separate.</h3>
              <p>
                An attributed TradingView chart may be displayed for a supported
                listing. Its data is not extracted into portfolio valuations,
                allocation calculations or AI research.
              </p>
            </div>
          </section>
        </>
      ) : tab === "routing" ? (
        <>
          <section className="tp-panel tp-role-settings">
            <PanelHead
              title="Choose the model behind each role"
              body="Only models returned by your provider's account catalog can be selected."
            />
            <div className="tp-role-routing">
              {(Object.keys(ROLE_NAMES) as AIRole[]).map((role, index) => {
                const assignment = roles[role],
                  provider = settings.providers.find(
                    (p) => p.id === assignment.provider,
                  );
                return (
                  <div key={role}>
                    <span className="tp-role-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="tp-role-description">
                      <strong>{ROLE_NAMES[role]}</strong>
                      <small>
                        {
                          (
                            {
                              planner: "Plans sources, scope and revisions",
                              fundamentals:
                                "Examines business and valuation evidence",
                              quant: "Interprets observed prices and risk",
                              news: "Checks dated reporting and catalysts",
                              skeptic:
                                "Challenges the strongest interpretation",
                              evaluator:
                                "Reviews support, gaps and final findings",
                            } as Record<AIRole, string>
                          )[role]
                        }
                      </small>
                    </div>
                    <label>
                      <span className="tp-sr-only">
                        {ROLE_NAMES[role]} provider
                      </span>
                      <select
                        value={assignment.provider}
                        onChange={(event) =>
                          setRoles((current) => ({
                            ...current,
                            [role]: {
                              provider: event.target.value as AIProvider,
                              model: null,
                            },
                          }))
                        }
                      >
                        {settings.providers.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.keyConfigured ? "" : " · not connected"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="tp-sr-only">
                        {ROLE_NAMES[role]} model
                      </span>
                      <select
                        value={assignment.model || ""}
                        disabled={
                          !provider?.keyConfigured || !provider.models.length
                        }
                        onChange={(event) =>
                          setRoles((current) => ({
                            ...current,
                            [role]: {
                              ...current[role],
                              model: event.target.value || null,
                            },
                          }))
                        }
                      >
                        <option value="">
                          {!provider?.keyConfigured
                            ? "Connect this provider"
                            : !provider.models.length
                              ? "Load the account catalog"
                              : "Choose a discovered model"}
                        </option>
                        {provider?.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                            {model.inferenceTested ? " · tested" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="tp-settings-save">
              <p>Changing a provider resets that role's model choice.</p>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  JSON.stringify(roles) === JSON.stringify(settings.roles)
                }
                onClick={() =>
                  void action(
                    () => request("settings", "PATCH", { roles }),
                    "Agent role assignments saved.",
                  )
                }
              >
                <Check size={15} />
                Save role assignments
              </Button>
            </div>
          </section>
          <section className="tp-panel tp-budget-settings">
            <PanelHead
              title="Bound the work"
              body="Per-run limits are enforced by the server. These are spending controls, not a promise that every task will finish."
            />
            <div className="tp-form-grid tp-budget-grid">
              {(
                [
                  {
                    key: "maxModelCalls",
                    label: "Maximum model requests",
                    min: 1,
                    max: 30,
                  },
                  {
                    key: "maxToolCalls",
                    label: "Maximum source requests",
                    min: 1,
                    max: 50,
                  },
                  {
                    key: "maxOutputTokens",
                    label: "Output tokens per request",
                    min: 256,
                    max: 16000,
                  },
                  {
                    key: "maxTotalTokens",
                    label: "Maximum total reported tokens",
                    min: 1000,
                    max: 200000,
                  },
                ] as const
              ).map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step="1"
                    value={budget[field.key]}
                    onChange={(event) =>
                      setBudget((current) => ({
                        ...current,
                        [field.key]: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              ))}
              <label>
                Time budget
                <select
                  value={budget.timeoutMs}
                  onChange={(event) =>
                    setBudget((current) => ({
                      ...current,
                      timeoutMs: Number(event.target.value),
                    }))
                  }
                >
                  {[60000, 120000, 180000, 300000, 600000].map((ms) => (
                    <option key={ms} value={ms}>
                      {ms / 60000} {ms === 60000 ? "minute" : "minutes"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tp-settings-save">
              <span />
              <Button
                variant="primary"
                disabled={
                  busy ||
                  JSON.stringify(budget) === JSON.stringify(settings.budget)
                }
                onClick={() =>
                  void action(
                    () => request("settings", "PATCH", { budget }),
                    "Research budgets saved.",
                  )
                }
              >
                <Check size={15} />
                Save limits
              </Button>
            </div>
          </section>
          <section className="tp-panel tp-search-settings">
            <PanelHead
              title="Optional web search"
              body="A configured search provider can supply bounded public web results. Retrieved text remains untrusted evidence."
            />
            <form
              className="tp-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await request(`search-providers/${searchProvider}`, "PUT", {
                    apiKey: searchKey,
                  });
                  await request("settings", "PATCH", { searchProvider });
                  setSearchKey("");
                }, "Search connection saved.");
              }}
            >
              <div className="tp-form-grid">
                <label>
                  Search provider
                  <select
                    value={searchProvider}
                    onChange={(event) =>
                      setSearchProvider(
                        event.target.value as "brave" | "tavily",
                      )
                    }
                  >
                    <option value="brave">Brave Search</option>
                    <option value="tavily">Tavily</option>
                  </select>
                </label>
                <label>
                  New API key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={searchKey}
                    onChange={(event) => setSearchKey(event.target.value)}
                    placeholder={
                      settings.search.configured
                        ? "A search connection is configured"
                        : "Paste your provider key"
                    }
                  />
                </label>
              </div>
              <div className="tp-settings-save">
                <Status tone={settings.search.configured ? "blue" : "neutral"}>
                  {settings.search.configured
                    ? "Key configured"
                    : "Optional connection not configured"}
                </Status>
                <div>
                  <Button
                    type="button"
                    disabled={busy || !settings.search.configured}
                    onClick={() =>
                      void action(
                        () =>
                          request(
                            `search-providers/${settings.search.provider || searchProvider}`,
                            "DELETE",
                          ),
                        "Search key removed.",
                      )
                    }
                  >
                    <Trash2 size={14} />
                    Remove
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || !searchKey.trim()}
                  >
                    <Check size={14} />
                    Save search key
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </>
      ) : (
        <div className="tp-account-grid">
          <section className="tp-panel tp-account-settings">
            <span className="tp-account-large-avatar">
              {identity?.isAnonymous ? (
                <ShieldCheck size={31} />
              ) : (
                identity?.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("") || "T"
              )}
            </span>
            <h2>
              {identity?.isAnonymous
                ? "Keep your workspace within reach."
                : identity?.name || "Your account"}
            </h2>
            <p>
              {identity?.isAnonymous
                ? "A guest workspace belongs to this browser identity. Connect Google to return to the same records from another device."
                : identity?.email ||
                  "Your authenticated account owns this workspace."}
            </p>
            <Status tone={identity?.isAnonymous ? "neutral" : "green"}>
              {identity?.isAnonymous
                ? "Private guest identity"
                : "Google account connected"}
            </Status>
            {identity?.isAnonymous ? (
              <Button
                variant="primary"
                disabled={busyGoogle}
                onClick={() => void onGoogle()}
              >
                {busyGoogle ? (
                  <Loader2 size={16} className="tp-spin" />
                ) : (
                  <GoogleMark />
                )}
                Continue with Google
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await newPrivateWorkspace();
                  }, "You are signed out. Your account workspace is preserved.")
                }
              >
                <LogOut size={15} />
                Sign out
              </Button>
            )}
            <div className="tp-account-explanation">
              <h3>Guest upgrade without a blank start</h3>
              <p>
                A new Google connection keeps the current workspace identity. If
                the account already exists, Thesis asks to merge before
                switching; the guest workspace stays open if the merge fails.
              </p>
            </div>
          </section>
          <section className="tp-panel tp-privacy-settings">
            <PanelHead title="Your data and preferences" />
            <div>
              <h3>Export your workspace</h3>
              <p>
                Download portfolio transactions, watchlist notes, plans and
                research records. Provider keys are excluded. Keep the export
                private.
              </p>
              <Button onClick={() => void exportAccount()} disabled={busy}>
                <Download size={15} />
                Export private workspace
              </Button>
            </div>
            <div>
              <h3>Portfolio accounting</h3>
              <p>
                Choose how recorded acquisition lots are matched to sales.
                Currency groups remain separate without observed FX data.
              </p>
              <select
                aria-label="Portfolio cost basis method"
                value={portfolioMethod}
                disabled={busy}
                onChange={(event) =>
                  void action(
                    () =>
                      request("preferences", "PATCH", {
                        costBasis: event.target.value,
                      }),
                    "Portfolio accounting method saved.",
                  )
                }
              >
                <option value="fifo">First in, first out (FIFO)</option>
                <option value="average">Average cost</option>
              </select>
            </div>
            <div>
              <h3>What reaches an AI provider</h3>
              <p>
                When you start a plan or research run, the selected goal,
                available source content and any portfolio context in your brief
                are sent to the assigned providers. Their privacy, retention and
                billing terms apply.
              </p>
            </div>
            <div className="tp-danger-zone">
              <h3>Erase this workspace</h3>
              <p>
                Delete portfolio transactions, watchlist notes, research, plans
                and stored provider keys from this workspace. Export anything
                you want to keep first.
              </p>
              <Button
                variant="danger"
                disabled={busy || activeWork}
                onClick={() =>
                  confirm({
                    title: "Erase this workspace?",
                    body: "Permanently erase this workspace's portfolio transactions, watchlist notes, plans, research and stored provider keys. This cannot be undone. Export anything you want to keep first.",
                    confirmLabel: "Erase workspace",
                    run: async () => {
                      await request("account", "DELETE");
                      await newPrivateWorkspace();
                      await onReload();
                      onNotice("Your workspace records were erased.");
                    },
                  })
                }
              >
                <Trash2 size={15} />
                Erase workspace
              </Button>
              {activeWork && (
                <p className="tp-field-hint">
                  Wait for active agent runs to finish before erasing this
                  workspace.
                </p>
              )}
            </div>
            <div>
              <h3>Workspace access</h3>
              <p>
                {identity?.isAnonymous
                  ? "Keep this browser's site data until you have connected an account. Clearing it can remove access to a guest workspace."
                  : "Signing out preserves your account records. Sign in with the same Google account to return."}
              </p>
              <a
                className="tp-privacy-link"
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the privacy details
                <ExternalLink size={13} />
              </a>
            </div>
          </section>
        </div>
      )}
      {confirmation}
    </>
  );
}
function AIProviderCard({
  provider,
  isDefault,
  onReload,
  onNotice,
}: {
  provider: PublicAISettings["providers"][number];
  isDefault: boolean;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const { confirm, confirmation } = useConfirmedAction();
  const [key, setKey] = useState(""),
    [show, setShow] = useState(false),
    [model, setModel] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const models = provider.models.filter(
    (m) =>
      !query || `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const act = async (
    name: string,
    fn: () => Promise<unknown>,
    message: string,
  ) => {
    setBusy(name);
    setError("");
    try {
      const result = await fn();
      await onReload();
      if (name === "test" && result && typeof result === "object") {
        const response = result as {
          connection?: { status: string; message?: string };
          settings?: PublicAISettings;
        };
        const connection =
          response.connection ??
          response.settings?.providers.find((item) => item.id === provider.id)
            ?.connection;
        if (!connection || connection.status !== "passed")
          throw new Error(
            connection?.message ||
              "The provider did not pass the inference check.",
          );
      }
      onNotice(message);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const selected = provider.models.find((m) => m.id === model);
  return (
    <section className="tp-panel tp-provider-card">
      <div className="tp-provider-heading">
        <span className={`tp-provider-logo ${provider.id}`}>
          {provider.id === "nvidia" ? (
            <Zap size={24} />
          ) : provider.id === "openai" ? (
            <Sparkles size={24} />
          ) : provider.id === "anthropic" ? (
            "A"
          ) : provider.id === "gemini" ? (
            <Sparkles size={24} />
          ) : (
            <Layers3 size={24} />
          )}
        </span>
        <div>
          <h3>{provider.name}</h3>
          <span>
            {isDefault ? "Default provider" : "Research model provider"}
          </span>
        </div>
        <Status
          tone={
            provider.connection.status === "passed"
              ? "green"
              : provider.keyConfigured
                ? "blue"
                : "neutral"
          }
        >
          {provider.connection.status === "passed"
            ? "Inference checked"
            : provider.keyConfigured
              ? provider.keySource === "operator"
                ? "Managed connection"
                : "Key saved"
              : "Not connected"}
        </Status>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(
            "save",
            async () => {
              await request(`providers/${provider.id}`, "PUT", { apiKey: key });
              setKey("");
              setModel("");
            },
            "Provider key saved. Load its account model catalog next.",
          );
        }}
      >
        <label>
          {provider.keySource === "operator"
            ? "Your own API key (optional)"
            : provider.keyConfigured
              ? "Replace saved key"
              : "API key"}
          <div className="tp-secret-input">
            <KeyRound size={15} />
            <input
              aria-label={`${provider.name} API key`}
              type={show ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={
                provider.keySource === "operator"
                  ? "Managed connection available"
                  : provider.keyConfigured
                    ? `Saved key · ${provider.keyLast4 ? `••••${provider.keyLast4}` : "masked"}`
                    : "Paste your provider API key"
              }
            />
            <button
              type="button"
              aria-label={show ? "Hide new API key" : "Show new API key"}
              disabled={!key}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <div className="tp-provider-key-actions">
          <Button small variant="primary" disabled={!!busy || !key.trim()}>
            {busy === "save" ? (
              <Loader2 size={14} className="tp-spin" />
            ) : (
              <Check size={14} />
            )}
            Save key
          </Button>
          {provider.keySource === "account" && (
            <Button
              type="button"
              small
              variant="ghost"
              disabled={!!busy}
              onClick={() =>
                confirm({
                  title: `Remove the ${provider.name} key?`,
                  body: "Future requests using this saved key will stop. Existing reports remain. Reconnect your own key whenever you want to use this provider again.",
                  confirmLabel: "Remove key",
                  run: async () => {
                    await request(`providers/${provider.id}`, "DELETE");
                    await onReload();
                    onNotice("Provider key removed.");
                  },
                })
              }
            >
              <Trash2 size={13} />
              Remove
            </Button>
          )}
        </div>
      </form>
      <div className="tp-provider-models">
        <div>
          <strong>Account model catalog</strong>
          <Button
            small
            variant="ghost"
            disabled={!!busy || !provider.keyConfigured}
            onClick={() =>
              void act(
                "models",
                () => request(`providers/${provider.id}/models`),
                "The account model catalog has been refreshed.",
              )
            }
          >
            <RefreshCw
              size={13}
              className={busy === "models" ? "tp-spin" : ""}
            />
            {provider.catalogStatus === "ready" ? "Refresh" : "Load models"}
          </Button>
        </div>
        {provider.catalogStatus === "ready" && provider.models.length > 0 ? (
          <>
            <div className="tp-model-search">
              <Search size={13} />
              <input
                aria-label={`Filter ${provider.name} models`}
                placeholder={`Search ${provider.models.length} listed models`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label={`${provider.name} discovered model`}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              <option value="">Choose an account-listed model</option>
              {model && !models.some((m) => m.id === model) && selected && (
                <option value={selected.id}>{selected.name}</option>
              )}
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.inferenceTested
                    ? " · tested"
                    : item.capability === "unverified"
                      ? " · compatibility unverified"
                      : ""}
                </option>
              ))}
            </select>
            <div className="tp-model-action-row">
              <Button
                small
                disabled={!!busy || !model}
                onClick={() =>
                  void act(
                    "test",
                    () =>
                      request(`providers/${provider.id}/test`, "POST", {
                        model,
                      }),
                    "The selected model completed an inference check.",
                  )
                }
              >
                {busy === "test" ? (
                  <Loader2 size={13} className="tp-spin" />
                ) : (
                  <ShieldCheck size={13} />
                )}
                Test model
              </Button>
              <Button
                small
                variant="primary"
                disabled={!!busy || !model}
                onClick={() =>
                  void act(
                    "assign",
                    () =>
                      request("settings", "PATCH", {
                        defaultProvider: provider.id,
                        roles: Object.fromEntries(
                          (Object.keys(ROLE_NAMES) as AIRole[]).map((role) => [
                            role,
                            { provider: provider.id, model },
                          ]),
                        ),
                      }),
                    "Selected model assigned to all research roles.",
                  )
                }
              >
                <Layers3 size={13} />
                Use for all agents
              </Button>
            </div>
            <p className="tp-field-hint">
              Testing sends one small inference request to this model. Your
              provider may charge for it.
            </p>
          </>
        ) : (
          <p className="tp-model-empty">
            {provider.keyConfigured
              ? provider.catalogStatus === "error"
                ? "Catalog discovery failed. Retry to inspect this account's actual models."
                : "Load the catalog to see which model IDs this account returns."
              : "Connect your key before discovering or selecting a model."}
          </p>
        )}
      </div>
      {provider.connection.checkedAt && (
        <p className="tp-provider-check">
          Last check: {when(provider.connection.checkedAt)} ·{" "}
          {provider.connection.message || provider.connection.status}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {confirmation}
    </section>
  );
}
function DataProviderCard({
  provider,
  selected,
  onReload,
  onNotice,
}: {
  provider: PublicDataProvider;
  selected: boolean;
  onReload: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const { confirm, confirmation } = useConfirmedAction();
  const [key, setKey] = useState(""),
    [show, setShow] = useState(false),
    [ack, setAck] = useState(provider.entitlementAcknowledged || false),
    [premium, setPremium] = useState(provider.premiumHistory || false),
    [minute, setMinute] = useState(provider.minuteBudget || 4),
    [daily, setDaily] = useState(provider.dayBudget || 25),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setAck(provider.entitlementAcknowledged || false);
    setPremium(provider.premiumHistory || false);
    setMinute(provider.minuteBudget || 4);
    setDaily(provider.dayBudget || 25);
  }, [provider]);
  const terms = {
    finnhub: "https://finnhub.io/terms-of-service",
    twelvedata: "https://twelvedata.com/terms",
    alphavantage: "https://www.alphavantage.co/terms_of_service/",
  };
  const act = async (
    name: string,
    fn: () => Promise<unknown>,
    message: string,
  ) => {
    setBusy(name);
    setError("");
    try {
      const result = await fn();
      await onReload();
      if (
        result &&
        typeof result === "object" &&
        "status" in result &&
        !["ok", "partial", "passed"].includes(String(result.status))
      )
        throw new Error(
          "message" in result
            ? String(result.message)
            : "The provider did not return a usable entitled response. Check its connection details.",
        );
      onNotice(message);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="tp-panel tp-data-provider">
      <div className="tp-data-provider-info">
        <span className="tp-provider-logo data">
          <Database size={23} />
        </span>
        <h3>{provider.name}</h3>
        <Status
          tone={
            provider.keyConfigured && provider.entitlementAcknowledged
              ? "blue"
              : "neutral"
          }
        >
          {provider.keyConfigured
            ? provider.entitlementAcknowledged
              ? "Key and permission saved"
              : "Permission not confirmed"
            : "Not connected"}
        </Status>
        {selected && (
          <span className="tp-selected-label">Selected data source</span>
        )}
        <p>
          {provider.note ||
            "Coverage and endpoint availability depend on your provider account."}
        </p>
        <div className="tp-capabilities">
          {Object.entries(provider.capabilities || {}).map(
            ([name, available]) => (
              <span key={name} className={available ? "" : "unavailable"}>
                {available ? <Check size={12} /> : <Minus size={12} />} {name}
              </span>
            ),
          )}
        </div>
        <a href={terms[provider.id]} target="_blank" rel="noopener noreferrer">
          Review provider terms
          <ExternalLink size={12} />
        </a>
      </div>
      <div className="tp-data-provider-form">
        <form
          className="tp-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              "save",
              async () => {
                await request(`data-providers/${provider.id}`, "PUT", {
                  apiKey: key,
                  entitlementAcknowledged: ack,
                });
                setKey("");
              },
              "Market data key saved.",
            );
          }}
        >
          <label>
            {provider.keyConfigured ? "Replace saved API key" : "API key"}
            <div className="tp-secret-input">
              <KeyRound size={15} />
              <input
                aria-label={`${provider.name} data API key`}
                type={show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={
                  provider.keyConfigured
                    ? `Saved key · ••••${provider.keyLast4 || ""}`
                    : "Paste the key from your provider account"
                }
              />
              <button
                type="button"
                aria-label={show ? "Hide data key" : "Show data key"}
                disabled={!key}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>
          <label className="tp-checkbox-line">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            <span>
              I confirm my plan permits displaying its data here and processing
              it on the server for my requested AI research.
            </span>
          </label>
          <div className="tp-provider-key-actions">
            <Button variant="primary" small disabled={!!busy || !key.trim()}>
              {busy === "save" ? (
                <Loader2 size={14} className="tp-spin" />
              ) : (
                <Check size={14} />
              )}
              Save key
            </Button>
            <Button
              type="button"
              small
              disabled={
                !!busy ||
                !provider.keyConfigured ||
                !provider.entitlementAcknowledged
              }
              onClick={() =>
                void act(
                  "test",
                  () =>
                    request(`data-providers/${provider.id}/test`, "POST", {}),
                  "Market data connection checked.",
                )
              }
            >
              {busy === "test" ? (
                <Loader2 size={14} className="tp-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              Test connection
            </Button>
            {provider.keyConfigured && (
              <Button
                type="button"
                small
                variant="ghost"
                onClick={() =>
                  confirm({
                    title: `Remove the ${provider.name} data key?`,
                    body: "Quotes and source requests using this saved key will stop. Your recorded trades and existing reports remain.",
                    confirmLabel: "Remove data key",
                    run: async () => {
                      await request(`data-providers/${provider.id}`, "DELETE");
                      await onReload();
                      onNotice("Market data key removed.");
                    },
                  })
                }
                disabled={!!busy}
              >
                <Trash2 size={13} />
                Remove
              </Button>
            )}
          </div>
        </form>
        <details className="tp-advanced">
          <summary>
            Permission & request budgets
            <ChevronDown size={14} />
          </summary>
          <div className="tp-form">
            <label>
              Daily request budget
              <select
                value={[25, 100, 800].includes(daily) ? daily : "custom"}
                onChange={(event) => {
                  if (event.target.value !== "custom")
                    setDaily(Number(event.target.value));
                }}
              >
                <option value="25">Small allowance: 25 requests per day</option>
                <option value="100">100 requests per day</option>
                <option value="800">800 requests per day</option>
                <option value="custom">Custom daily budget</option>
              </select>
            </label>
            <div className="tp-form-grid">
              <label>
                Requests per minute
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={minute}
                  onChange={(event) => setMinute(Number(event.target.value))}
                />
              </label>
              <label>
                Requests per day
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={daily}
                  onChange={(event) => setDaily(Number(event.target.value))}
                />
              </label>
            </div>
            <label className="tp-checkbox-line">
              <input
                type="checkbox"
                checked={premium}
                onChange={(event) => setPremium(event.target.checked)}
              />
              <span>
                My provider entitlement includes the requested full or adjusted
                history endpoints.
              </span>
            </label>
            <p className="tp-field-hint">
              These limits cap application requests. They do not change your
              provider's quotas or permissions.
            </p>
            <Button
              small
              disabled={!!busy || !provider.keyConfigured}
              onClick={() =>
                void act(
                  "config",
                  () =>
                    request(`data-providers/${provider.id}`, "PATCH", {
                      entitlementAcknowledged: ack,
                      premiumHistory: premium,
                      minuteBudget: minute,
                      dayBudget: daily,
                    }),
                  "Data permissions and request limits saved.",
                )
              }
            >
              <Check size={13} />
              Save permissions and limits
            </Button>
          </div>
        </details>
        {provider.test && (
          <p className="tp-provider-check">
            Last check: {provider.test.status} · {when(provider.test.checkedAt)}{" "}
            · {provider.test.message}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      {confirmation}
    </section>
  );
}

const GOALS = [
  {
    id: "house",
    name: "A home",
    description: "Build the amount for a purchase",
    goal: "specific_purchase",
    months: 24,
    icon: BriefcaseBusiness,
  },
  {
    id: "education",
    name: "Education",
    description: "Prepare for a future course or fees",
    goal: "specific_purchase",
    months: 60,
    icon: FileText,
  },
  {
    id: "retirement",
    name: "Retirement",
    description: "Invest for a longer chapter",
    goal: "growth",
    months: 120,
    icon: CalendarDays,
  },
  {
    id: "income",
    name: "Regular income",
    description: "Explore a cash-flow objective",
    goal: "income",
    months: 36,
    icon: Wallet,
  },
  {
    id: "wealth",
    name: "General wealth",
    description: "Grow capital over time",
    goal: "growth",
    months: 60,
    icon: TrendingUp,
  },
  {
    id: "emergency",
    name: "Emergency cushion",
    description: "Prioritize access and resilience",
    goal: "capital_preservation",
    months: 6,
    icon: ShieldCheck,
  },
] as const;
function PlanWizard({
  onClose,
  onSubmit,
  settings,
  initial,
}: {
  onClose: () => void;
  onSubmit: (profile: PlanProfile) => Promise<void>;
  settings: PublicAISettings | null;
  initial?: PlanProfile | null;
}) {
  const [step, setStep] = useState(0),
    [profile, setProfile] = useState<PlanProfile>(
      initial || {
        amount: 0,
        baseCurrency: "USD",
        residenceCountry: "India",
        goal: "growth",
        goalDescription: "",
        horizonMonths: 24,
        principalNeededAtHorizon: true,
        riskComfort: "balanced",
        maxVolatility: 20,
        maxLoss: 10,
        preferredMarkets: [],
        allowForeign: false,
        sectors: [],
        emergencyReserve: 0,
        monthlyContribution: 0,
        maxPositionWeight: 10,
        maxSectorWeight: 30,
        includeETFs: true,
        includeStocks: true,
        includeDeposits: true,
      },
    ),
    [budgetText, setBudgetText] = useState(
      initial ? String(initial.amount) : "",
    ),
    [residence, setResidence] = useState(initial?.residenceCountry || ""),
    [goal, setGoal] = useState(() =>
      initial
        ? GOALS.find(
            (g) =>
              initial.goalDescription.startsWith(g.name + ".") ||
              initial.goalDescription === g.name,
          )?.id ||
          (
            {
              growth: "wealth",
              income: "income",
              capital_preservation: "emergency",
              specific_purchase: "custom",
            } as const
          )[initial.goal]
        : "",
    ),
    [notes, setNotes] = useState(() => {
      if (!initial) return "";
      let text = initial.goalDescription;
      for (const name of [...GOALS.map((g) => g.name), "Custom goal"])
        if (text === name) text = "";
        else if (text.startsWith(name + "."))
          text = text.slice(name.length + 1).trim();
      return text
        .replace(
          /\.?\s*Emergency reserve was not provided; do not assume an adequate existing cushion\./g,
          "",
        )
        .trim();
    }),
    [reserveText, setReserveText] = useState(
      initial?.emergencyReserve ? String(initial.emergencyReserve) : "",
    ),
    [monthlyText, setMonthlyText] = useState(
      initial?.monthlyContribution ? String(initial.monthlyContribution) : "",
    ),
    [currencyTouched, setCurrencyTouched] = useState(!!initial),
    [mix, setMix] = useState<"home" | "even" | "home_us" | "custom">(
      initial &&
        (initial.marketWeights ||
          initial.allowForeign ||
          initial.preferredMarkets.length !== 1 ||
          initial.preferredMarkets[0] !== initial.residenceCountry)
        ? "custom"
        : "home",
    ),
    [customSplit, setCustomSplit] = useState(!!initial?.marketWeights),
    [weights, setWeights] = useState<Record<Market, number>>(
      (initial?.marketWeights as Record<Market, number>) || {
        US: 0,
        India: 0,
        China: 0,
        UAE: 0,
      },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = stepHeading.current;
    heading?.closest("dialog")?.scrollTo({ top: 0, behavior: "instant" });
    heading?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (error)
      stepHeading.current
        ?.closest("dialog")
        ?.scrollTo({ top: 0, behavior: "instant" });
  }, [error]);
  const set = <K extends keyof PlanProfile>(key: K, value: PlanProfile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }));
  const home: Market | null =
    residence && residence !== "Other" ? (residence as Market) : null;
  const weightTotal = profile.preferredMarkets.reduce(
    (sum, market) => sum + (weights[market] || 0),
    0,
  );
  const selectMix = (value: typeof mix) => {
    setMix(value);
    if (value === "home" && home) {
      setProfile((current) => ({
        ...current,
        preferredMarkets: [home],
        allowForeign: false,
        marketWeights: undefined,
      }));
      setCustomSplit(false);
    } else if (value === "even") {
      setProfile((current) => ({
        ...current,
        preferredMarkets: [...REGIONS],
        allowForeign: true,
      }));
      setWeights({ US: 25, India: 25, China: 25, UAE: 25 });
      setCustomSplit(true);
    } else if (value === "home_us" && home) {
      const regions: Market[] = home === "US" ? ["US"] : [home, "US"];
      setProfile((current) => ({
        ...current,
        preferredMarkets: regions,
        allowForeign: home !== "US",
      }));
      setWeights({
        US: home === "US" ? 100 : 50,
        India: home === "India" ? 50 : 0,
        China: home === "China" ? 50 : 0,
        UAE: home === "UAE" ? 50 : 0,
      });
      setCustomSplit(true);
    } else {
      setCustomSplit(false);
    }
  };
  const next = () => {
    setError("");
    if (
      step === 0 &&
      (!budgetText ||
        Number(budgetText) < 100 ||
        Number(budgetText) > 1e12 ||
        !Number.isFinite(Number(budgetText)) ||
        !residence ||
        !goal)
    ) {
      setError(
        "Choose a goal and your country of residence, then enter an investment amount of at least 100 currency units.",
      );
      return;
    }
    if (
      step === 1 &&
      (!Number.isFinite(profile.horizonMonths) ||
        !Number.isInteger(profile.horizonMonths) ||
        profile.horizonMonths < 3 ||
        profile.horizonMonths > 600 ||
        !Number.isFinite(profile.maxVolatility) ||
        profile.maxVolatility < 1 ||
        profile.maxVolatility > 80)
    ) {
      setError(
        "Choose a horizon between 3 and 600 months and a volatility tolerance between 1% and 80%.",
      );
      return;
    }
    if (
      step === 1 &&
      (!Number.isFinite(profile.maxLoss) ||
        profile.maxLoss < 0 ||
        profile.maxLoss > 80)
    ) {
      setError("Choose a maximum tolerable loss between 0% and 80%.");
      return;
    }
    if (step === 2) {
      if (!profile.preferredMarkets.length) {
        setError("Choose at least one preferred market.");
        return;
      }
      if (
        customSplit &&
        (Math.abs(weightTotal - 100) > 0.01 ||
          profile.preferredMarkets.some(
            (m) =>
              !Number.isFinite(weights[m]) ||
              weights[m] < 0 ||
              weights[m] > 100,
          ))
      ) {
        setError(
          "Your optional market mix must add to 100% of the equity portion.",
        );
        return;
      }
      if (
        !Number.isFinite(profile.emergencyReserve) ||
        profile.emergencyReserve < 0 ||
        profile.emergencyReserve > profile.amount
      ) {
        setError(
          "The reserve must be between zero and your investment budget.",
        );
        return;
      }
      if (
        !Number.isFinite(profile.monthlyContribution) ||
        profile.monthlyContribution < 0 ||
        profile.monthlyContribution > 1e9
      ) {
        setError(
          "Choose a monthly contribution between zero and 1,000,000,000 currency units.",
        );
        return;
      }
    }
    setStep((current) => current + 1);
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const preset = GOALS.find((g) => g.id === goal);
      const description = [
        preset?.name || "Custom goal",
        notes.trim(),
        !reserveText
          ? "Emergency reserve was not provided; do not assume an adequate existing cushion."
          : "",
      ]
        .filter(Boolean)
        .join(". ")
        .slice(0, 1000);
      const final = {
        ...profile,
        amount: Number(budgetText),
        residenceCountry: residence as PlanProfile["residenceCountry"],
        goalDescription: description,
        ...(customSplit
          ? {
              marketWeights: Object.fromEntries(
                REGIONS.map((market) => [
                  market,
                  profile.preferredMarkets.includes(market)
                    ? weights[market] || 0
                    : 0,
                ]),
              ) as Record<Market, number>,
            }
          : { marketWeights: undefined }),
      };
      await onSubmit(final);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        initial
          ? "Compare another investment plan"
          : "Build your investment plan"
      }
      onClose={onClose}
      wide
      busy={busy}
    >
      <div className="tp-plan-wizard">
        <div
          className="tp-wizard-progress"
          aria-label={`Step ${step + 1} of 4`}
        >
          {["Your goal", "Risk & time", "Markets & reserve", "Review"].map(
            (name, index) => (
              <div
                key={name}
                className={
                  index === step ? "active" : index < step ? "complete" : ""
                }
              >
                <span>{index < step ? <Check size={13} /> : index + 1}</span>
                <strong>{name}</strong>
              </div>
            ),
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {step === 0 ? (
          <section className="tp-wizard-step">
            <p className="tp-eyebrow">START WITH THE PURPOSE</p>
            <h2 ref={stepHeading} tabIndex={-1}>
              What does this money need to do?
            </h2>
            <p>
              A useful plan starts with your goal and the amount you can set
              aside.
            </p>
            <div className="tp-goal-grid">
              {GOALS.map((item) => (
                <button
                  key={item.id}
                  className={goal === item.id ? "selected" : ""}
                  aria-pressed={goal === item.id}
                  onClick={() => {
                    setGoal(item.id);
                    setProfile((current) => ({
                      ...current,
                      goal: item.goal,
                      horizonMonths: item.months,
                      principalNeededAtHorizon:
                        item.goal === "specific_purchase" ||
                        item.goal === "capital_preservation",
                    }));
                  }}
                >
                  <item.icon size={22} />
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                  {goal === item.id && <CheckCircle2 size={17} />}
                </button>
              ))}
              <button
                className={goal === "custom" ? "selected" : ""}
                aria-pressed={goal === "custom"}
                onClick={() => {
                  setGoal("custom");
                  set("goal", "specific_purchase");
                }}
              >
                <Plus size={21} />
                <strong>Another goal</strong>
                <span>Add your own context below</span>
              </button>
            </div>
            <div className="tp-form-grid">
              <label>
                Amount to plan for
                <input
                  inputMode="decimal"
                  type="number"
                  min="100"
                  max="1000000000000"
                  step="any"
                  value={budgetText}
                  onChange={(event) => {
                    setBudgetText(event.target.value);
                    set("amount", Number(event.target.value));
                  }}
                  placeholder="Enter your amount"
                />
              </label>
              <label>
                Planning currency
                <select
                  value={profile.baseCurrency}
                  onChange={(event) => {
                    setCurrencyTouched(true);
                    set("baseCurrency", event.target.value);
                  }}
                >
                  {CURRENCIES.map((currency) => (
                    <option key={currency}>{currency}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Country of residence
              <select
                value={residence}
                onChange={(event) => {
                  const value = event.target
                    .value as PlanProfile["residenceCountry"];
                  setResidence(value);
                  setMix(value === "Other" ? "custom" : "home");
                  setCustomSplit(false);
                  setProfile((current) => ({
                    ...current,
                    residenceCountry: value,
                    preferredMarkets:
                      value === "Other"
                        ? current.preferredMarkets
                        : [value as Market],
                    allowForeign: false,
                    marketWeights: undefined,
                    ...(!currencyTouched && value !== "Other"
                      ? {
                          baseCurrency: (
                            {
                              US: "USD",
                              India: "INR",
                              China: "CNY",
                              UAE: "AED",
                            } as const
                          )[value],
                        }
                      : {}),
                  }));
                }}
              >
                <option value="" disabled>
                  Select your country of residence
                </option>
                <option value="India">India</option>
                <option value="US">United States</option>
                <option value="China">China</option>
                <option value="UAE">United Arab Emirates</option>
                <option value="Other">Another country</option>
              </select>
              <small className="tp-field-hint">
                Residence informs access and currency checks. It does not
                establish tax treatment or broker eligibility.
              </small>
            </label>
            <label>
              What else should the plan understand?
              <span className="tp-optional">Optional</span>
              <textarea
                value={notes}
                maxLength={800}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="A deposit for a home, future education costs, flexible timing…"
                rows={3}
              />
            </label>
          </section>
        ) : step === 1 ? (
          <section className="tp-wizard-step">
            <p className="tp-eyebrow">
              THE TIME YOU HAVE, THE RISK YOU CAN TAKE
            </p>
            <h2 ref={stepHeading} tabIndex={-1}>
              Make the boundaries clear.
            </h2>
            <p>
              Money you need soon deserves a different set of tradeoffs from a
              flexible long-term goal.
            </p>
            <fieldset className="tp-choice-field">
              <legend>When will you need this money?</legend>
              <div className="tp-horizon-presets">
                {[6, 12, 24, 36, 60, 120].map((months) => (
                  <button
                    key={months}
                    className={
                      profile.horizonMonths === months ? "selected" : ""
                    }
                    aria-pressed={profile.horizonMonths === months}
                    onClick={() => set("horizonMonths", months)}
                  >
                    {months < 12
                      ? `${months} months`
                      : `${months / 12} ${months === 12 ? "year" : "years"}`}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="tp-choice-field">
              <legend>Do you need the full amount by then?</legend>
              <div className="tp-deadline-options">
                <button
                  className={profile.principalNeededAtHorizon ? "selected" : ""}
                  aria-pressed={profile.principalNeededAtHorizon}
                  onClick={() => set("principalNeededAtHorizon", true)}
                >
                  <CalendarDays size={20} />
                  <strong>Yes, the deadline matters</strong>
                  <span>I need to preserve access to the money.</span>
                </button>
                <button
                  className={
                    !profile.principalNeededAtHorizon ? "selected" : ""
                  }
                  aria-pressed={!profile.principalNeededAtHorizon}
                  onClick={() => set("principalNeededAtHorizon", false)}
                >
                  <WavesIcon />
                  <strong>I can be flexible</strong>
                  <span>I could delay the goal if conditions change.</span>
                </button>
              </div>
            </fieldset>
            <fieldset className="tp-choice-field">
              <legend>How comfortable are you with market swings?</legend>
              <div className="tp-risk-cards">
                {(
                  [
                    {
                      id: "cautious",
                      name: "Keep it steadier",
                      copy: "I prefer stability and easier access.",
                      vol: 10,
                      icon: ShieldCheck,
                    },
                    {
                      id: "balanced",
                      name: "Some ups and downs",
                      copy: "I can accept measured fluctuations.",
                      vol: 20,
                      icon: ScaleIcon,
                    },
                    {
                      id: "adventurous",
                      name: "Comfortable with swings",
                      copy: "I can tolerate a more uneven journey.",
                      vol: 30,
                      icon: TrendingUp,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    className={
                      profile.riskComfort === item.id ? "selected" : ""
                    }
                    aria-pressed={profile.riskComfort === item.id}
                    onClick={() =>
                      setProfile((current) => ({
                        ...current,
                        riskComfort: item.id,
                        maxVolatility: item.vol,
                      }))
                    }
                  >
                    <item.icon size={22} />
                    <strong>{item.name}</strong>
                    <span>{item.copy}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="tp-loss-preference">
              <div>
                <label htmlFor="tp-max-loss">
                  What loss would you find difficult to accept?
                </label>
                <strong>{profile.maxLoss}%</strong>
              </div>
              <input
                id="tp-max-loss"
                type="range"
                min="0"
                max="80"
                step="1"
                value={profile.maxLoss}
                onChange={(event) => set("maxLoss", Number(event.target.value))}
              />
              <p>
                On {amount(profile.amount, profile.baseCurrency)},{" "}
                {profile.maxLoss}% is{" "}
                <strong>
                  {amount(
                    (profile.amount * profile.maxLoss) / 100,
                    profile.baseCurrency,
                  )}
                </strong>
                . This is your tolerance, not a guaranteed loss limit.
              </p>
            </div>
            <details className="tp-advanced">
              <summary>
                Set another horizon or volatility tolerance
                <ChevronDown size={14} />
              </summary>
              <label>
                Time horizon in months
                <input
                  type="number"
                  min="3"
                  max="600"
                  step="1"
                  value={profile.horizonMonths}
                  onChange={(event) =>
                    set("horizonMonths", Number(event.target.value))
                  }
                />
              </label>
              <label>
                Annualized volatility comfort (%)
                <input
                  type="number"
                  min="1"
                  max="80"
                  value={profile.maxVolatility}
                  onChange={(event) =>
                    set("maxVolatility", Number(event.target.value))
                  }
                />
              </label>
            </details>
          </section>
        ) : step === 2 ? (
          <section className="tp-wizard-step">
            <p className="tp-eyebrow">KEEP THE PREFERENCES EXPLICIT</p>
            <h2 ref={stepHeading} tabIndex={-1}>
              Where should the plan look?
            </h2>
            <p>
              Market preferences apply to the equity portion. Cash and reserve
              allocations stay outside this split.
            </p>
            <div className="tp-mix-presets">
              <button
                className={mix === "home" ? "selected" : ""}
                disabled={!home}
                onClick={() => selectMix("home")}
              >
                <strong>Home market</strong>
                <span>
                  {home ? REGION[home].name : "Choose a home market below"}
                </span>
              </button>
              <button
                className={mix === "home_us" ? "selected" : ""}
                disabled={!home}
                onClick={() => selectMix("home_us")}
              >
                <strong>Home + US</strong>
                <span>An even preference between the two</span>
              </button>
              <button
                className={mix === "even" ? "selected" : ""}
                onClick={() => selectMix("even")}
              >
                <strong>Even market mix</strong>
                <span>25% of equity in each selected region</span>
              </button>
              <button
                className={mix === "custom" ? "selected" : ""}
                onClick={() => selectMix("custom")}
              >
                <strong>Choose my own</strong>
                <span>Set markets and an optional split</span>
              </button>
            </div>
            <RegionPicker
              value={profile.preferredMarkets}
              onChange={(value) => {
                setMix("custom");
                set("preferredMarkets", value);
              }}
            />
            <label className="tp-checkbox-line">
              <input
                type="checkbox"
                checked={profile.allowForeign}
                onChange={(event) => set("allowForeign", event.target.checked)}
              />
              <span>
                I am open to foreign investments, subject to access, liquidity
                and FX checks.
              </span>
            </label>
            <label className="tp-checkbox-line">
              <input
                type="checkbox"
                checked={customSplit}
                onChange={(event) => setCustomSplit(event.target.checked)}
              />
              <span>
                Set a preferred percentage split of the equity portion
              </span>
            </label>
            {customSplit && (
              <div className="tp-market-weight-grid">
                {profile.preferredMarkets.map((market) => (
                  <label key={market}>
                    {REGION[market].flag} {market}
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step=".1"
                        value={weights[market] || 0}
                        onChange={(event) =>
                          setWeights((current) => ({
                            ...current,
                            [market]: Number(event.target.value),
                          }))
                        }
                      />
                      <span>%</span>
                    </div>
                  </label>
                ))}
                <p
                  className={
                    Math.abs(weightTotal - 100) < 0.01
                      ? "tp-positive"
                      : "tp-negative"
                  }
                >
                  Total: {num(weightTotal, 1)}% of the equity portion
                </p>
              </div>
            )}
            <div className="tp-wizard-field">
              <label>
                Sector preferences<span className="tp-optional">Optional</span>
              </label>
              <SectorPicker
                value={profile.sectors}
                onChange={(value) => set("sectors", value)}
              />
            </div>
            <div className="tp-form-grid">
              <label>
                Hold aside as an emergency reserve
                <span className="tp-optional">
                  Optional, within this budget
                </span>
                <input
                  type="number"
                  min="0"
                  max={profile.amount}
                  step="any"
                  value={reserveText}
                  onChange={(event) => {
                    setReserveText(event.target.value);
                    set("emergencyReserve", Number(event.target.value));
                  }}
                  placeholder="Amount to keep accessible"
                />
              </label>
              <label>
                Planned monthly contribution
                <span className="tp-optional">Optional</span>
                <input
                  type="number"
                  min="0"
                  max="1000000000"
                  step="any"
                  value={monthlyText}
                  onChange={(event) => {
                    setMonthlyText(event.target.value);
                    set("monthlyContribution", Number(event.target.value));
                  }}
                  placeholder="Future monthly amount"
                />
              </label>
            </div>
            <div className="tp-instrument-inclusions">
              <label className="tp-checkbox-line">
                <input
                  type="checkbox"
                  checked={profile.includeStocks}
                  onChange={(event) =>
                    set("includeStocks", event.target.checked)
                  }
                />
                Consider individual stocks
              </label>
              <label className="tp-checkbox-line">
                <input
                  type="checkbox"
                  checked={profile.includeETFs}
                  onChange={(event) => set("includeETFs", event.target.checked)}
                />
                Consider ETFs or funds
              </label>
              <label className="tp-checkbox-line">
                <input
                  type="checkbox"
                  checked={profile.includeDeposits}
                  onChange={(event) =>
                    set("includeDeposits", event.target.checked)
                  }
                />
                Consider deposit products
              </label>
            </div>
            <p className="tp-field-hint">
              A market preference is not an access or suitability determination.
              Deposit rates, fund returns and foreign currency conversions are
              not invented when evidence is missing.
            </p>
          </section>
        ) : (
          <section className="tp-wizard-step">
            <p className="tp-eyebrow">YOUR GOAL, BEFORE THE CALCULATIONS</p>
            <h2 ref={stepHeading} tabIndex={-1}>
              Does this sound like your plan?
            </h2>
            <div className="tp-brief-review">
              <div className="tp-brief-review-amount">
                <span>Investment budget</span>
                <strong>
                  {amount(Number(budgetText), profile.baseCurrency)}
                </strong>
                <small>
                  {GOALS.find((item) => item.id === goal)?.name ||
                    "Custom goal"}{" "}
                  · {residence}
                </small>
              </div>
              <dl>
                <div>
                  <dt>Time horizon</dt>
                  <dd>
                    {profile.horizonMonths < 12
                      ? `${profile.horizonMonths} months`
                      : `${profile.horizonMonths / 12} years`}
                  </dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>
                    {profile.principalNeededAtHorizon
                      ? "Full amount needed at horizon"
                      : "Flexible timing"}
                  </dd>
                </div>
                <div>
                  <dt>Risk comfort</dt>
                  <dd>{profile.riskComfort}</dd>
                </div>
                <div>
                  <dt>Loss tolerance</dt>
                  <dd>
                    {profile.maxLoss}% ·{" "}
                    {amount(
                      (profile.amount * profile.maxLoss) / 100,
                      profile.baseCurrency,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Preferred markets</dt>
                  <dd>{profile.preferredMarkets.join(", ")}</dd>
                </div>
                <div>
                  <dt>Foreign investments</dt>
                  <dd>
                    {profile.allowForeign
                      ? "Open to verified access and FX checks"
                      : "Not permitted by this brief"}
                  </dd>
                </div>
                <div>
                  <dt>Emergency reserve</dt>
                  <dd>
                    {reserveText
                      ? amount(profile.emergencyReserve, profile.baseCurrency)
                      : "Not stated"}
                  </dd>
                </div>
                <div>
                  <dt>Monthly contribution</dt>
                  <dd>
                    {monthlyText
                      ? amount(
                          profile.monthlyContribution,
                          profile.baseCurrency,
                        )
                      : "Not stated"}
                  </dd>
                </div>
              </dl>
            </div>
            {profile.principalNeededAtHorizon &&
              profile.horizonMonths <= 24 && (
                <Notice>
                  <strong>
                    A short, firm goal prioritizes access to principal.
                  </strong>
                  <p>
                    The plan may retain a large cash or fixed-income reserve. It
                    will not assume that a strong return can be achieved safely
                    in this time.
                  </p>
                </Notice>
              )}
            <div className="tp-plan-expectation">
              <ShieldCheck size={22} />
              <div>
                <h3>What you will receive</h3>
                <p>
                  Exact amounts and percentages, the reason for each bucket,
                  liquidity and FX assumptions, risk checks, scenarios and the
                  gaps that still need attention.
                </p>
                <p>
                  Missing observations, provider permissions or eligibility
                  checks can result in a conditional plan instead of an
                  actionable allocation.
                </p>
              </div>
            </div>
            {settings &&
              !Object.values(settings.roles).every((role) => role.model) && (
                <p className="tp-field-hint">
                  Some AI roles are not configured. A numerical readiness
                  assessment can still identify missing data; it must not imply
                  an AI review was completed.
                </p>
              )}
          </section>
        )}
        <div className="tp-wizard-footer">
          <Button
            disabled={busy}
            onClick={() =>
              step ? setStep((current) => current - 1) : onClose()
            }
          >
            <ArrowLeft size={15} />
            {step ? "Back" : "Cancel"}
          </Button>
          <span>Step {step + 1} of 4</span>
          {step < 3 ? (
            <Button variant="primary" onClick={next}>
              Continue
              <ArrowRight size={15} />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader2 size={16} className="tp-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Create my investment plan
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
function WavesIcon({ size = 20 }: { size?: number }) {
  return <ChartNoAxesCombined size={size} />;
}
function ScaleIcon({ size = 22 }: { size?: number }) {
  return <SlidersHorizontal size={size} />;
}
function PlanDialog({
  plan,
  onClose,
  onResearch,
  onAlternative,
}: {
  plan: PersonalizedPlan;
  onClose: () => void;
  onResearch: () => void;
  onAlternative?: (profile: PlanProfile) => void;
}) {
  const [tab, setTab] = useState<"allocation" | "checks" | "scenarios">(
    "allocation",
  );
  const colors = COLORS;
  return (
    <Modal title="Your investment plan" onClose={onClose} wide>
      <div className="tp-plan-result-heading">
        <div>
          <p className="tp-eyebrow">A PLAN BUILT AROUND YOUR GOAL</p>
          <h2>
            {plan.profile.goalDescription.split(".")[0] ||
              "Your investment plan"}
          </h2>
          <p>
            {plan.profile.horizonMonths} months ·{" "}
            {plan.profile.residenceCountry} · {day(plan.createdAt)}
          </p>
        </div>
        <Status tone={plan.status === "ready_for_review" ? "blue" : "amber"}>
          {plan.status === "ready_for_review"
            ? "Ready for your review"
            : plan.status === "conditional"
              ? "Conditional plan"
              : "More evidence required"}
        </Status>
      </div>
      <div className="tp-plan-result-body">
        <p className="tp-plan-summary">{plan.summary}</p>
        <PlanDiagnostics details={plan.allocationDetails} />
        <div className="tp-plan-amounts">
          <div>
            <span>Your amount</span>
            <strong>
              {amount(plan.profile.amount, plan.profile.baseCurrency, 2)}
            </strong>
          </div>
          <div>
            <span>Allocated in the plan</span>
            <strong>
              {amount(plan.totalAllocated, plan.profile.baseCurrency, 2)}
            </strong>
          </div>
          <div>
            <span>Unallocated</span>
            <strong>
              {amount(plan.unallocated, plan.profile.baseCurrency, 2)}
            </strong>
          </div>
        </div>
        <div
          className="tp-allocation-strip"
          role="img"
          aria-label="Proposed allocation amounts"
        >
          {plan.allocations.map((row, index) => (
            <div
              key={row.id}
              style={{
                width: `${row.weightPercent}%`,
                background: colors[index % colors.length],
              }}
              title={`${row.name}: ${row.weightPercent}%`}
            />
          ))}
          {plan.unallocated > 0 && (
            <div
              style={{
                width: `${(plan.unallocated / plan.profile.amount) * 100}%`,
                background: "#e8ebf1",
              }}
              title="Unallocated"
            />
          )}
        </div>
        <div className="tp-detail-nav">
          {(["allocation", "checks", "scenarios"] as const).map((section) => (
            <button
              key={section}
              className={tab === section ? "active" : ""}
              aria-pressed={tab === section}
              onClick={() => setTab(section)}
            >
              {section === "allocation"
                ? "Exact allocation"
                : section === "checks"
                  ? "Why, risks & checks"
                  : "Scenarios & alternatives"}
            </button>
          ))}
        </div>
        {tab === "allocation" ? (
          <>
            <div className="tp-plan-allocation-list">
              {plan.allocations.map((row, index) => (
                <article key={row.id}>
                  <div className="tp-plan-allocation-top">
                    <span
                      className="tp-allocation-color"
                      style={{ background: colors[index % colors.length] }}
                    />
                    <div>
                      <h3>{row.name}</h3>
                      <span>
                        {[
                          row.symbol,
                          row.market,
                          row.assetClass.replaceAll("_", " "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <strong>
                      {amount(row.amount, plan.profile.baseCurrency, 2)}
                      <small>{num(row.weightPercent, 2)}%</small>
                    </strong>
                  </div>
                  <p>{row.reason}</p>
                  <div className="tp-plan-row-details">
                    <Status
                      tone={row.status === "reserve" ? "neutral" : "amber"}
                    >
                      {row.status === "research_candidate"
                        ? "Research candidate"
                        : row.status === "reserve"
                          ? "Reserve bucket"
                          : "Conditional"}
                    </Status>
                    {row.price !== null && (
                      <span>
                        Observed price:{" "}
                        {observedAmount(
                          row.price,
                          (
                            row as typeof row & {
                              priceCurrency?: string | null;
                            }
                          ).priceCurrency,
                          2,
                        )}{" "}
                        · {day(row.priceAsOf)}
                      </span>
                    )}
                    {row.units !== null && (
                      <span>
                        {num(row.units, 6)} units, subject to execution checks
                      </span>
                    )}
                  </div>
                  {row.risks.length > 0 && (
                    <ul>
                      {row.risks.map((risk, i) => (
                        <li key={i}>{risk}</li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
            {plan.unallocated > 0 && (
              <Notice tone="warning">
                {amount(plan.unallocated, plan.profile.baseCurrency, 2)} remains
                unallocated. Review the missing evidence and access conditions
                before committing this amount.
              </Notice>
            )}
          </>
        ) : tab === "checks" ? (
          <>
            <section className="tp-plan-checks">
              <h3>Against your constraints</h3>
              {plan.checks.map((check, index) => (
                <div key={index}>
                  <span
                    className={
                      check.passed === true
                        ? "passed"
                        : check.passed === false
                          ? "failed"
                          : "unknown"
                    }
                  >
                    {check.passed === true ? (
                      <Check size={15} />
                    ) : check.passed === false ? (
                      <X size={15} />
                    ) : (
                      <CircleHelp size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{check.name}</strong>
                    <p>{check.detail}</p>
                  </div>
                </div>
              ))}
            </section>
            <div className="tp-plan-notes-grid">
              <section>
                <h3>Assumptions to verify</h3>
                <ul>
                  {plan.assumptions.map((assumption, index) => (
                    <li key={index}>{assumption}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Material risks</h3>
                <ul>
                  {plan.risks.map((risk, index) => (
                    <li key={index}>{risk}</li>
                  ))}
                </ul>
              </section>
            </div>
            <section className="tp-next-steps">
              <h3>Before taking action</h3>
              <ol>
                {plan.nextSteps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </section>
            {plan.methodology.length > 0 && (
              <div className="tp-method-links">
                {plan.methodology.map((source, index) =>
                  safeLink(source.url) ? (
                    <a
                      href={source.url}
                      key={index}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.label}
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <span key={index}>{source.label}</span>
                  ),
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <h3 className="tp-scenario-heading">
              What if conditions are different?
            </h3>
            <p className="tp-muted">
              These are explicit hypothetical shocks, not expected returns or
              assigned probabilities.
            </p>
            {plan.scenarios?.length ? (
              <div className="tp-scenario-grid">
                {plan.scenarios.map((scenario, index) => (
                  <article key={index}>
                    <h3>{scenario.name}</h3>
                    <p>{scenario.assumption}</p>
                    <dl>
                      <div>
                        <dt>Illustrated loss</dt>
                        <dd>
                          {amount(
                            scenario.lossAmount,
                            plan.profile.baseCurrency,
                            2,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Illustrated ending amount</dt>
                        <dd>
                          {amount(
                            scenario.endingAmount,
                            plan.profile.baseCurrency,
                            2,
                          )}
                        </dd>
                      </div>
                    </dl>
                    <small>No probability assigned.</small>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                icon={ChartNoAxesCombined}
                title="No scenario calculation was supplied."
              >
                Scenario inputs will appear here when the plan includes a
                supported calculation.
              </Empty>
            )}
            {plan.alternatives?.length ? (
              <section className="tp-plan-alternatives">
                <h3>Compare a different set of constraints</h3>
                {plan.alternatives.map((alternative, index) => (
                  <article key={index}>
                    <div>
                      <h4>{alternative.name}</h4>
                      <p>{alternative.description}</p>
                    </div>
                    <Button
                      small
                      onClick={() =>
                        onAlternative?.({
                          ...plan.profile,
                          ...alternative.profilePatch,
                        })
                      }
                    >
                      Review alternative
                      <ArrowRight size={14} />
                    </Button>
                  </article>
                ))}
              </section>
            ) : (
              <Button onClick={() => onAlternative?.(plan.profile)}>
                Compare another plan
                <ArrowRight size={15} />
              </Button>
            )}
          </>
        )}
      </div>
      <div className="tp-detail-footer">
        <Button
          onClick={() => downloadJSON(plan, `thesis-plan-${plan.id}.json`)}
        >
          <Download size={15} />
          Export plan
        </Button>
        {plan.research && (
          <Button onClick={onResearch}>
            <Sparkles size={15} />
            Inspect AI review
          </Button>
        )}
        <Button variant="primary" onClick={() => onAlternative?.(plan.profile)}>
          Adjust the brief
          <ArrowRight size={15} />
        </Button>
      </div>
    </Modal>
  );
}

function TradingViewChart({ instrument }: { instrument: InstrumentRef }) {
  const holder = useRef<HTMLDivElement>(null),
    [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const rawExchange = (instrument.exchange || "").toUpperCase();
  const exchange = rawExchange === "NYSE ARCA" ? "AMEX" : rawExchange;
  const known = [
    "NASDAQ",
    "NYSE",
    "AMEX",
    "NSE",
    "BSE",
    "SSE",
    "SZSE",
    "HKEX",
    "ADX",
    "DFM",
  ].includes(exchange);
  const rawTicker = instrument.symbol
    .toUpperCase()
    .replace(/\.(SS|SZ|HK|NS|BO)$/i, "");
  const ticker =
    exchange === "HKEX" && /^\d+$/.test(rawTicker)
      ? String(Number(rawTicker))
      : rawTicker;
  const symbol =
    known && /^[A-Z0-9._-]{1,40}$/.test(ticker)
      ? `${exchange}:${ticker}`
      : null;
  const url = symbol
    ? `https://www.tradingview.com/symbols/${encodeURIComponent(exchange)}-${encodeURIComponent(ticker)}/`
    : "https://www.tradingview.com/markets/";
  useEffect(() => {
    if (!symbol || !holder.current) {
      setState("failed");
      return;
    }
    setState("loading");
    const container = holder.current;
    let loaded = false,
      cancelled = false;
    let target: HTMLDivElement | null = null;
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const initialize = setTimeout(() => {
      if (cancelled) return;
      target = document.createElement("div");
      target.className = "tradingview-widget-container";
      target.style.height = "100%";
      target.style.width = "100%";
      const chart = document.createElement("div");
      chart.className = "tradingview-widget-container__widget";
      chart.style.height = "calc(100% - 32px)";
      chart.style.width = "100%";
      target.appendChild(chart);
      const copyright = document.createElement("div");
      copyright.className = "tradingview-widget-copyright";
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener nofollow";
      link.textContent = `${instrument.symbol} chart`;
      copyright.appendChild(link);
      copyright.appendChild(document.createTextNode(" by TradingView"));
      target.appendChild(copyright);
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src =
        "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.async = true;
      script.textContent = JSON.stringify({
        autosize: true,
        symbol,
        interval: "D",
        timezone: "exchange",
        theme: "light",
        style: "1",
        locale: "en",
        allow_symbol_change: false,
        calendar: false,
        save_image: false,
        hide_side_toolbar: true,
        withdateranges: true,
        support_host: "https://www.tradingview.com",
      });
      script.onerror = () => {
        if (!cancelled) setState("failed");
      };
      observer = new MutationObserver(() => {
        const frame = container.querySelector("iframe");
        if (frame && !frame.dataset.thesisObserved) {
          frame.dataset.thesisObserved = "true";
          frame.title = `${instrument.symbol} interactive chart by TradingView`;
          frame.addEventListener(
            "load",
            () => {
              if (!cancelled) {
                loaded = true;
                setState("ready");
              }
            },
            { once: true },
          );
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      target.appendChild(script);
      container.appendChild(target);
      timeout = setTimeout(() => {
        if (!cancelled && !loaded) setState("failed");
      }, 15000);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(initialize);
      if (timeout) clearTimeout(timeout);
      observer?.disconnect();
      target?.remove();
    };
  }, [symbol, url, instrument.symbol]);
  return (
    <section className="tp-tradingview-section">
      <div className="tp-tradingview-heading">
        <h3>Interactive market chart</h3>
        <a href={url} target="_blank" rel="noopener noreferrer">
          Open at TradingView
          <ArrowUpRight size={14} />
        </a>
      </div>
      <div className="tp-tradingview-frame">
        <div ref={holder} style={{ height: "100%", width: "100%" }} />
        {state === "loading" && (
          <LoadingPanel text="Loading the attributed TradingView chart" />
        )}
        {state === "failed" && (
          <div className="tp-tradingview-error">
            <p>
              {symbol
                ? "The embedded chart could not be loaded. You can open the provider's chart directly."
                : "This listing does not have a verified chart symbol in this integration."}
            </p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open TradingView
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>
      <p className="tp-caption">
        Chart source: TradingView. Exchange access and delays may vary. This
        separate chart does not supply portfolio valuations or data to the
        research agents.
      </p>
    </section>
  );
}

function QuantitativeScanPanel({
  scan,
  onClose,
  onInstrument,
}: {
  scan: QuantitativeScan;
  onClose: () => void;
  onInstrument: (instrument: InstrumentRef) => void;
}) {
  return (
    <section className="tp-panel tp-scan-panel">
      <PanelHead
        title="Quantitative evidence scan"
        body={`${scan.factors.length} listings checked · ${when(scan.completedAt)}`}
        action={
          <IconButton label="Close scan results" onClick={onClose}>
            <X size={16} />
          </IconButton>
        }
      />
      <div className="tp-scan-content">
        <p className="tp-caption">
          Relative ranks describe this scan's available cohort. Scores are
          withheld when factor coverage or peer requirements are unmet. This
          scan uses source requests, with no model inference.
        </p>
        {scan.warnings.length > 0 && (
          <Notice tone="warning">{scan.warnings.join(" ")}</Notice>
        )}
        <div className="tp-scan-grid">
          {scan.factors.map((factor) => {
            const history = scan.history.find(
              (row) => refKey(row.instrument) === refKey(factor.instrument),
            )?.analysis;
            const source = scan.sources.find(
              (row) => refKey(row.instrument) === refKey(factor.instrument),
            );
            return (
              <article key={refKey(factor.instrument)}>
                <div className="tp-scan-card-head">
                  <button onClick={() => onInstrument(factor.instrument)}>
                    <strong>{factor.instrument.symbol}</strong>
                    <small>
                      {factor.instrument.exchange || factor.instrument.market}
                      <ArrowUpRight size={12} />
                    </small>
                  </button>
                  <span>
                    {factor.score === null
                      ? "Score withheld"
                      : `${num(factor.score, 0)} / 100`}
                  </span>
                </div>
                <p>
                  {num(factor.coverage * 100, 0)}% factor coverage ·{" "}
                  {factor.peerCount} cohort peers
                </p>
                <dl>
                  {factor.components.map((component) => (
                    <div key={component.name}>
                      <dt>{component.name.replaceAll("_", " ")}</dt>
                      <dd>
                        {component.score === null
                          ? "Unavailable"
                          : `${num(component.score, 0)} / 100`}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details>
                  <summary>Coverage, history and source details</summary>
                  {factor.components.map((component) => (
                    <p key={component.name}>
                      <strong>{component.name.replaceAll("_", " ")}:</strong>{" "}
                      {component.detail} ({num(component.coverage * 100, 0)}%
                      coverage)
                    </p>
                  ))}
                  {history && (
                    <p>
                      {history.observations} dated observations · volatility{" "}
                      {history.annualizedVolatility === null
                        ? "unavailable"
                        : `${num(history.annualizedVolatility, 1)}%`}{" "}
                      · drawdown{" "}
                      {history.maxDrawdown === null
                        ? "unavailable"
                        : `${num(history.maxDrawdown, 1)}%`}
                    </p>
                  )}
                  {factor.warnings.map((warning, index) => (
                    <p key={index}>{warning}</p>
                  ))}
                  {source &&
                    (["history", "fundamentals"] as const).map((kind) => {
                      const value = source[kind];
                      return (
                        <p key={kind}>
                          <strong>{kind}:</strong>{" "}
                          {value
                            ? `${value.provider} · observation ${when(value.asOf)} · retrieved ${when(value.fetchedAt)}`
                            : "No source provenance returned"}
                        </p>
                      );
                    })}
                </details>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
function PlanDiagnostics({ details }: { details: unknown }) {
  if (!details || typeof details !== "object") return null;
  const value = details as Record<string, unknown>;
  const review =
    value.aiReview && typeof value.aiReview === "object"
      ? (value.aiReview as Record<string, unknown>)
      : null;
  const excluded = Array.isArray(value.excluded)
    ? (value.excluded.filter((row) => row && typeof row === "object") as {
        instrument?: InstrumentRef;
        reasons?: unknown[];
      }[])
    : [];
  const sources = Array.isArray(value.sourceMetadata)
    ? (value.sourceMetadata.filter(
        (row) => row && typeof row === "object",
      ) as Record<string, unknown>[])
    : [];
  return (
    <div className="tp-plan-diagnostics">
      {review && (
        <div className="tp-plan-review-state">
          <Status
            tone={
              review.status === "completed"
                ? "blue"
                : review.status === "unconfigured"
                  ? "neutral"
                  : "amber"
            }
          >
            {review.status === "completed"
              ? "AI critique completed"
              : review.status === "unconfigured"
                ? "AI critique not configured"
                : "AI critique incomplete"}
          </Status>
          <p>
            {typeof review.message === "string"
              ? review.message
              : "The computed allocation and optional AI review have separate readiness states."}
          </p>
        </div>
      )}
      {excluded.length > 0 && (
        <details>
          <summary>Why candidates were excluded ({excluded.length})</summary>
          <div className="tp-plan-exclusions">
            {excluded.map((row, index) => (
              <article key={index}>
                <strong>
                  {row.instrument?.name ||
                    row.instrument?.symbol ||
                    "Candidate"}
                  {row.instrument?.symbol ? ` · ${row.instrument.symbol}` : ""}
                </strong>
                <ul>
                  {row.reasons
                    ?.filter(
                      (reason): reason is string => typeof reason === "string",
                    )
                    .map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                </ul>
              </article>
            ))}
          </div>
        </details>
      )}
      {sources.length > 0 && (
        <details>
          <summary>Inspect retained source checks ({sources.length})</summary>
          <div className="tp-plan-exclusions">
            {sources.map((source, index) => {
              const instrument =
                source.instrument && typeof source.instrument === "object"
                  ? (source.instrument as InstrumentRef)
                  : null;
              return (
                <article key={index}>
                  <strong>
                    {instrument?.symbol || "Source check"} ·{" "}
                    {source.eligibleForRisk === true
                      ? "Eligible observed history"
                      : "Risk data not established"}
                  </strong>
                  {Array.isArray(source.warnings) &&
                    source.warnings
                      .filter(
                        (warning): warning is string =>
                          typeof warning === "string",
                      )
                      .map((warning, i) => <p key={i}>{warning}</p>)}
                  {(["stock", "fx", "quote"] as const).map((kind) => {
                    const item = source[kind];
                    if (!item || typeof item !== "object") return null;
                    const record = item as Record<string, unknown>;
                    const provenance =
                      record.provenance && typeof record.provenance === "object"
                        ? (record.provenance as Record<string, unknown>)
                        : record;
                    return (
                      <div key={kind}>
                        <h4>
                          {kind === "stock"
                            ? "Stock history"
                            : kind === "fx"
                              ? "FX history"
                              : "Observed quote"}
                        </h4>
                        <p>
                          {typeof record.status === "string"
                            ? record.status.replaceAll("_", " ")
                            : "Status unreported"}
                          {typeof provenance.provider === "string"
                            ? ` · ${provenance.provider}`
                            : ""}
                          {typeof provenance.asOf === "string"
                            ? ` · observed ${when(provenance.asOf)}`
                            : " · observation date not reported"}
                        </p>
                        {Array.isArray(record.warnings) &&
                          record.warnings
                            .filter(
                              (warning): warning is string =>
                                typeof warning === "string",
                            )
                            .map((warning, i) => <p key={i}>{warning}</p>)}
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
