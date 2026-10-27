"use client";

import { useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { BrokerStatusBadge, CopyRow, EmptyState, Field, LastSeen, Panel } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money } from "@/lib/client";
import type { PublicBroker } from "@/lib/trading/state";

export default function BrokersPage() {
  const { state } = useDashboard();
  const [bridge, setBridge] = useState<{ key: string; label: string } | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-liquid-platinum">Brokers</h1>
        <p className="text-sm text-muted-foreground">
          Connect a demo account first. Credentials are encrypted and only ever allowed to trade — never withdraw.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExnessConnect onCreated={setBridge} />
        <DerivConnect />
      </div>

      {bridge && <BridgeInstructions bridgeKey={bridge.key} label={bridge.label} onDone={() => setBridge(null)} />}

      <Panel title="Connected accounts">
        {state?.brokers.length ? (
          <div className="divide-y divide-white/5">
            {state.brokers.map((b) => (
              <BrokerRow key={b.id} broker={b} />
            ))}
          </div>
        ) : (
          <EmptyState>No accounts yet.</EmptyState>
        )}
      </Panel>
    </div>
  );
}

function BrokerRow({ broker }: { broker: PublicBroker }) {
  const { refresh } = useDashboard();
  const [busy, setBusy] = useState(false);
  const act = async (method: "POST" | "DELETE") => {
    if (method === "DELETE" && !window.confirm(`Disconnect ${broker.label}? Bots using it move back to paper.`)) return;
    setBusy(true);
    try {
      await api(`/api/brokers/${broker.id}`, method);
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{broker.label}</span>
          <Badge variant="muted">{broker.kind === "mt5" ? "MetaTrader 5" : "Deriv API"}</Badge>
          {broker.login && <Badge variant={broker.is_demo ? "default" : "crimson"}>{broker.is_demo ? "DEMO" : "REAL"}</Badge>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {broker.login ? `Login ${broker.login}${broker.server ? ` · ${broker.server}` : ""} · ` : ""}
          Balance {money(broker.balance, broker.currency)} · Equity {money(broker.equity, broker.currency)} · synced <LastSeen iso={broker.last_sync_at} />
        </div>
        {broker.error && <div className="mt-1 text-xs text-amber-300">{broker.error}</div>}
      </div>
      <div className="flex items-center gap-2">
        <BrokerStatusBadge broker={broker} />
        {broker.kind === "deriv" && (
          <Button size="icon" variant="ghost" onClick={() => act("POST")} disabled={busy} aria-label="Sync now">
            <RefreshCw />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="text-neon-crimson" onClick={() => act("DELETE")} disabled={busy} aria-label="Disconnect">
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function ExnessConnect({ onCreated }: { onCreated: (b: { key: string; label: string }) => void }) {
  const { refresh } = useDashboard();
  const [label, setLabel] = useState("Exness MT5");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<{ bridge_key: string; broker: PublicBroker }>("/api/brokers", "POST", { kind: "mt5", label });
      onCreated({ key: res.bridge_key, label: res.broker.label });
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Exness (MetaTrader 5)">
      <p className="text-sm text-muted-foreground">
        Exness trades through MetaTrader 5. You run the small <b className="text-foreground">Amogana Bridge</b> EA in your MT5 terminal; it
        executes the orders and reports positions back here. Works with any MT5 broker (Deriv MT5 too).
      </p>
      <div className="mt-4 space-y-3">
        <Field label="Account name">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Generate bridge key"}
          </Button>
          <Button variant="outline" asChild>
            <a href="/downloads/AmoganaBridge.mq5" download>
              <Download /> Download EA
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The terminal must stay running for bots to trade — a Windows VPS (Exness offers a free one on qualifying accounts) keeps it online 24/7.
        </p>
      </div>
    </Panel>
  );
}

function BridgeInstructions({ bridgeKey, label, onDone }: { bridgeKey: string; label: string; onDone: () => void }) {
  const url = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Panel title={`Finish connecting ${label}`} className="border-glow-mint">
      <p className="mb-3 text-sm text-amber-300">Copy the bridge key now — it is shown only once.</p>
      <div className="space-y-3">
        <CopyRow label="Server URL" value={url} />
        <CopyRow label="Bridge key" value={bridgeKey} />
      </div>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>
          In MT5: <b className="text-foreground">File → Open Data Folder → MQL5 → Experts</b>, copy <code>AmoganaBridge.mq5</code> there, then
          right-click it in the Navigator → <b className="text-foreground">Compile</b> (or open it in MetaEditor and press F7).
        </li>
        <li>
          <b className="text-foreground">Tools → Options → Expert Advisors</b>: tick <i>Allow algorithmic trading</i> and <i>Allow WebRequest for listed URL</i>, and
          add <code>{url}</code>.
        </li>
        <li>Drag <b className="text-foreground">AmoganaBridge</b> onto any one chart. Paste the Server URL and Bridge key into its inputs and press OK.</li>
        <li>Make sure the <b className="text-foreground">Algo Trading</b> button in the toolbar is green. This page shows “Connected” within a few seconds.</li>
      </ol>
      <Button variant="outline" className="mt-4" onClick={onDone}>
        I&apos;ve saved the key
      </Button>
    </Panel>
  );
}

function DerivConnect() {
  const { refresh } = useDashboard();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/brokers", "POST", { kind: "deriv", token, label: "Deriv" });
      setToken("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Deriv (API)">
      <p className="text-sm text-muted-foreground">
        Trades Deriv forex, gold, crypto and Volatility indices as <b className="text-foreground">Multiplier</b> contracts, with stop-loss
        and take-profit set on every trade.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Log in at app.deriv.com (switch to your <b className="text-foreground">demo</b> account to start).
        </li>
        <li>
          Account Settings → <b className="text-foreground">API token</b> → create a token with only <b className="text-foreground">Read</b> and{" "}
          <b className="text-foreground">Trade</b> scopes.
        </li>
        <li>Paste it below. Each Deriv account (demo / real) needs its own token.</li>
      </ol>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Deriv API token" autoComplete="off" />
        <Button onClick={connect} disabled={busy || token.length < 8}>
          {busy ? "Checking…" : "Connect"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-neon-crimson">{error}</p>}
    </Panel>
  );
}
