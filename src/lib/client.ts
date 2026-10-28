// Browser-side helpers shared by the dashboard pages.

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session expired — please log in again.",
  UNKNOWN_BROKER: "That broker account no longer exists.",
  UNKNOWN_STRATEGY: "Pick a strategy for this bot.",
  KILL_SWITCH_ON: "Release the kill switch before starting bots.",
  CLOSE_TRADES_BEFORE_SWITCHING_ACCOUNT: "Close this bot's open positions before moving it to another account.",
  BOT_NEEDS_BROKER: "Choose a broker account for this bot first.",
  CLOSE_TRADES_FIRST: "Close the open trades on this account first.",
  DERIV_TOKEN_REJECTED: "Deriv rejected that API token.",
  DERIV_TOKEN_NEEDS_TRADE_SCOPE: "The Deriv token needs the “Trade” scope.",
  DERIV_TOKEN_TOO_POWERFUL: "For safety, create a Deriv token with only the Read and Trade scopes (no Payments/Admin).",
  MARKET_DATA_UNAVAILABLE: "Could not download market data from Deriv.",
  NOT_ENOUGH_HISTORY: "Not enough price history for that market/timeframe.",
  CLOSE_FAILED: "The broker refused to close the trade.",
  WRONG_PASSWORD: "Wrong password.",
  APP_PASSWORD_NOT_SET: "Set APP_PASSWORD in your environment to enable login.",
};

export class ApiError extends Error {}

export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/auth/login") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const code = (data as { error?: string }).error ?? `HTTP_${res.status}`;
    const details = (data as { details?: unknown }).details;
    const extra = typeof details === "string" ? ` (${details})` : "";
    throw new ApiError((MESSAGES[code] ?? (data as { reason?: string }).reason ?? code) + extra);
  }
  return data as T;
}

export function money(value: number | null | undefined, currency = "USD", signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const abs = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  return `${sign}${symbol}${abs}`;
}

export function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function price(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const digits = value >= 1000 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(digits);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function pnlClass(value: number | null | undefined): string {
  if (!value) return "text-muted-foreground";
  return value > 0 ? "text-profit" : "text-loss";
}
