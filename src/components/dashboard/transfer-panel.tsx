"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2, Sparkles, TriangleAlert, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { getFallbackMidRate, quoteConversion } from "@/lib/fx";
import type { Transaction, Wallet, WalletCategory } from "@/lib/types/database";

export interface TransferSubmitInput {
  sourceWalletId: string;
  destinationWalletId: string;
  amount: number;
  narrative?: string;
}

export type TransferSubmitResult =
  | { transaction: Transaction; simulated: boolean }
  | { error: string };

interface TransferPanelProps {
  wallets: Wallet[];
  onSubmit: (input: TransferSubmitInput) => Promise<TransferSubmitResult>;
}

const CATEGORY_GROUP_LABEL: Record<WalletCategory, string> = {
  mobile_money: "Mobile Money",
  bank: "Bank Rails",
  fx: "FX Vaults",
  trading: "Trading Platforms",
  sportsbook: "Sportsbooks",
  platform: "Platform Wallets",
};

function groupWallets(wallets: Wallet[]): Map<WalletCategory, Wallet[]> {
  const groups = new Map<WalletCategory, Wallet[]>();
  for (const wallet of wallets) {
    const existing = groups.get(wallet.category) ?? [];
    existing.push(wallet);
    groups.set(wallet.category, existing);
  }
  return groups;
}

type SubmitState = "idle" | "submitting" | "success" | "error";

export function TransferPanel({ wallets, onSubmit }: TransferPanelProps) {
  const [sourceWalletId, setSourceWalletId] = useState<string>(wallets[0]?.id ?? "");
  const [destinationWalletId, setDestinationWalletId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [narrative, setNarrative] = useState<string>("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTransaction, setLastTransaction] = useState<Transaction | null>(null);
  const [wasSimulated, setWasSimulated] = useState(false);

  const sourceWallet = wallets.find((wallet) => wallet.id === sourceWalletId);
  const destinationOptions = wallets.filter((wallet) => wallet.id !== sourceWalletId);
  const destinationWallet = destinationOptions.find((wallet) => wallet.id === destinationWalletId);
  const groupedDestinations = useMemo(() => groupWallets(destinationOptions), [destinationOptions]);

  const parsedAmount = Number(amount);
  const isAmountValid = amount.length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const exceedsBalance = Boolean(sourceWallet) && isAmountValid && parsedAmount > sourceWallet!.available_balance;

  const quote = useMemo(() => {
    if (!sourceWallet || !destinationWallet || !isAmountValid) return null;
    try {
      const midRate = getFallbackMidRate(sourceWallet.currency_code, destinationWallet.currency_code);
      return quoteConversion({
        baseCurrency: sourceWallet.currency_code,
        quoteCurrency: destinationWallet.currency_code,
        sourceAmount: parsedAmount,
        midRate,
      });
    } catch {
      return null;
    }
  }, [sourceWallet, destinationWallet, isAmountValid, parsedAmount]);

  const canSubmit =
    Boolean(sourceWallet) &&
    Boolean(destinationWallet) &&
    isAmountValid &&
    !exceedsBalance &&
    state !== "submitting";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !sourceWallet || !destinationWallet) return;

    setState("submitting");
    setErrorMessage(null);

    const result = await onSubmit({
      sourceWalletId: sourceWallet.id,
      destinationWalletId: destinationWallet.id,
      amount: parsedAmount,
      narrative: narrative.trim() || undefined,
    });

    if ("error" in result) {
      setState("error");
      setErrorMessage(result.error);
      return;
    }

    setLastTransaction(result.transaction);
    setWasSimulated(result.simulated);
    setState("success");
    setAmount("");
    setNarrative("");

    window.setTimeout(() => setState("idle"), 3200);
  }

  return (
    <Card className="border-white/[0.06]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyber-mint/30 bg-cyber-mint/10">
            <Zap className="h-4 w-4 text-cyber-mint" />
          </div>
          <CardTitle>Execute Transfer</CardTitle>
        </div>
        <CardDescription>
          Move funds between local mobile money, FX vaults, and global merchant platforms.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="source-wallet">Source Wallet</Label>
            <Select value={sourceWalletId} onValueChange={setSourceWalletId}>
              <SelectTrigger id="source-wallet">
                <SelectValue placeholder="Select a source wallet" />
              </SelectTrigger>
              <SelectContent>
                {wallets.map((wallet) => (
                  <SelectItem key={wallet.id} value={wallet.id}>
                    {wallet.display_name} — {wallet.currency_code}{" "}
                    <span className="text-muted-foreground">
                      ({formatCurrency(wallet.available_balance, wallet.currency_code)})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
              <ArrowRight className="h-4 w-4 text-cyber-mint" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination-wallet">Target Platform</Label>
            <Select value={destinationWalletId} onValueChange={setDestinationWalletId}>
              <SelectTrigger id="destination-wallet">
                <SelectValue placeholder="Choose a destination" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(groupedDestinations.entries()).map(([category, options]) => (
                  <SelectGroup key={category}>
                    <SelectLabel>{CATEGORY_GROUP_LABEL[category]}</SelectLabel>
                    {options.map((wallet) => (
                      <SelectItem key={wallet.id} value={wallet.id}>
                        {wallet.display_name} — {wallet.currency_code}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount {sourceWallet ? `(${sourceWallet.currency_code})` : ""}
            </Label>
            <Input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="font-mono text-lg"
            />
            {exceedsBalance && (
              <p className="flex items-center gap-1.5 text-xs text-neon-crimson">
                <TriangleAlert className="h-3.5 w-3.5" />
                Amount exceeds available balance.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="narrative">Narrative (optional)</Label>
            <Input
              id="narrative"
              placeholder="e.g. Deriv trading top-up"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              maxLength={280}
            />
          </div>

          <AnimatePresence mode="wait">
            {quote && (
              <motion.div
                key={`${quote.destinationAmount}-${quote.effectiveRate}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden rounded-xl border border-cyber-mint/20 bg-cyber-mint/[0.04] p-4"
              >
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-cyber-mint">
                  <Sparkles className="h-3.5 w-3.5" />
                  Live Conversion
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="font-mono text-sm text-muted-foreground">
                    1 {quote.baseCurrency} = {quote.effectiveRate.toFixed(6)} {quote.quoteCurrency}
                  </span>
                  <span className="font-mono text-lg font-semibold text-liquid-platinum">
                    {formatCurrency(quote.destinationAmount, quote.quoteCurrency)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Includes a {(quote.spreadBps / 100).toFixed(2)}% platform spread ·{" "}
                  {formatCurrency(quote.spreadCost, quote.baseCurrency)} margin
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <SubmitButton state={state} canSubmit={canSubmit} />

          <AnimatePresence>
            {state === "error" && errorMessage && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-sm text-neon-crimson"
              >
                <TriangleAlert className="h-4 w-4" />
                {errorMessage}
              </motion.p>
            )}
            {state === "success" && lastTransaction && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-xl border border-cyber-mint/20 bg-cyber-mint/[0.04] p-3 text-sm text-liquid-platinum"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyber-mint" />
                <span>
                  Transfer executed{wasSimulated ? " (simulated preview)" : ""}. Reference{" "}
                  <span className="font-mono text-cyber-mint">{lastTransaction.id}</span>.
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitButton({ state, canSubmit }: { state: SubmitState; canSubmit: boolean }) {
  return (
    <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
      <AnimatePresence mode="wait" initial={false}>
        {state === "submitting" ? (
          <motion.span
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing…
          </motion.span>
        ) : state === "success" ? (
          <motion.span
            key="success"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Sent
          </motion.span>
        ) : (
          <motion.span
            key="default"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("flex items-center gap-2")}
          >
            <Zap className="h-4 w-4" />
            Confirm Transfer
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}
