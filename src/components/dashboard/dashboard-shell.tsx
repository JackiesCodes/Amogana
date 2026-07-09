"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Sparkle } from "lucide-react";

import { WalletMatrix } from "@/components/dashboard/wallet-matrix";
import { TransferPanel, type TransferSubmitInput, type TransferSubmitResult } from "@/components/dashboard/transfer-panel";
import { LedgerList } from "@/components/dashboard/ledger-list";
import { Badge } from "@/components/ui/badge";
import { getFallbackMidRate, quoteConversion } from "@/lib/fx";
import { DEMO_TRANSACTIONS, DEMO_WALLETS } from "@/lib/mock-data";
import type { Transaction, Wallet } from "@/lib/types/database";

function buildSimulatedTransaction(input: TransferSubmitInput, sourceWallet: Wallet, destinationWallet: Wallet): Transaction {
  const midRate = getFallbackMidRate(sourceWallet.currency_code, destinationWallet.currency_code);
  const quote = quoteConversion({
    baseCurrency: sourceWallet.currency_code,
    quoteCurrency: destinationWallet.currency_code,
    sourceAmount: input.amount,
    midRate,
  });

  const type =
    destinationWallet.category === "trading" || destinationWallet.category === "sportsbook"
      ? "merchant_payment"
      : sourceWallet.currency_code !== destinationWallet.currency_code
        ? "fx_swap"
        : "transfer";

  const now = new Date().toISOString();

  return {
    id: `sim-${crypto.randomUUID().slice(0, 8)}`,
    user_id: sourceWallet.user_id,
    sender_wallet_id: sourceWallet.id,
    receiver_wallet_id: destinationWallet.id,
    type,
    status: "completed",
    source_amount: input.amount,
    source_currency: sourceWallet.currency_code,
    destination_amount: quote.destinationAmount,
    destination_currency: destinationWallet.currency_code,
    fx_rate: quote.effectiveRate,
    fee_amount: 0,
    idempotency_key: null,
    external_reference: null,
    failure_reason: null,
    metadata: { narrative: input.narrative, initiated_via: "dashboard-simulation" },
    created_at: now,
    updated_at: now,
    completed_at: now,
  };
}

export function DashboardShell() {
  const [wallets, setWallets] = useState<Wallet[]>(DEMO_WALLETS);
  const [transactions, setTransactions] = useState<Transaction[]>(DEMO_TRANSACTIONS);

  const applyLedgerEffect = useCallback((transaction: Transaction) => {
    setWallets((current) =>
      current.map((wallet) => {
        if (wallet.id === transaction.sender_wallet_id) {
          const debit = transaction.source_amount + transaction.fee_amount;
          return {
            ...wallet,
            balance: wallet.balance - debit,
            available_balance: wallet.available_balance - debit,
          };
        }
        if (wallet.id === transaction.receiver_wallet_id) {
          return {
            ...wallet,
            balance: wallet.balance + transaction.destination_amount,
            available_balance: wallet.available_balance + transaction.destination_amount,
          };
        }
        return wallet;
      }),
    );
    setTransactions((current) => [transaction, ...current]);
  }, []);

  const handleSubmit = useCallback(
    async (input: TransferSubmitInput): Promise<TransferSubmitResult> => {
      const sourceWallet = wallets.find((wallet) => wallet.id === input.sourceWalletId);
      const destinationWallet = wallets.find((wallet) => wallet.id === input.destinationWalletId);

      if (!sourceWallet || !destinationWallet) {
        return { error: "Selected wallet could not be resolved." };
      }

      try {
        const response = await fetch("/api/transfers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (response.ok) {
          const { transaction } = (await response.json()) as { transaction: Transaction };
          applyLedgerEffect(transaction);
          return { transaction, simulated: false };
        }

        if (response.status === 401 || response.status >= 500) {
          // No authenticated Supabase session, or Supabase isn't configured
          // in this environment (no NEXT_PUBLIC_SUPABASE_URL) — fall back to
          // a local, clearly-labelled simulation so the dashboard stays
          // interactive during local development and demos. Genuine
          // business-rule failures (insufficient funds, bad wallet, etc.)
          // still surface as real errors below.
          const simulated = buildSimulatedTransaction(input, sourceWallet, destinationWallet);
          applyLedgerEffect(simulated);
          return { transaction: simulated, simulated: true };
        }

        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        return { error: body?.message ?? "The transfer could not be completed." };
      } catch {
        const simulated = buildSimulatedTransaction(input, sourceWallet, destinationWallet);
        applyLedgerEffect(simulated);
        return { transaction: simulated, simulated: true };
      }
    },
    [wallets, applyLedgerEffect],
  );

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 bg-grid-glow bg-grid opacity-[0.15] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />

      <div className="container relative py-8">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyber-mint/30 bg-cyber-mint/10 shadow-glow-mint">
              <Sparkle className="h-5 w-5 text-cyber-mint" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-liquid-platinum">Amogana</h1>
              <p className="text-xs text-muted-foreground">Move money at the speed of light.</p>
            </div>
          </div>
          <Badge variant="mint">
            <ShieldCheck className="h-3.5 w-3.5" />
            KYC Verified
          </Badge>
        </motion.header>

        <div className="space-y-8">
          <WalletMatrix wallets={wallets} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <TransferPanel wallets={wallets} onSubmit={handleSubmit} />
            </div>
            <div className="lg:col-span-3">
              <LedgerList transactions={transactions} wallets={wallets} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
