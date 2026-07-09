"use client";

import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  History,
  Loader2,
  Repeat2,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import type { Transaction, TransactionStatus, TransactionType, Wallet } from "@/lib/types/database";

interface LedgerListProps {
  transactions: Transaction[];
  wallets: Wallet[];
}

const TYPE_META: Record<TransactionType, { icon: LucideIcon; label: string }> = {
  deposit: { icon: ArrowDownToLine, label: "Deposit" },
  withdrawal: { icon: ArrowUpFromLine, label: "Withdrawal" },
  transfer: { icon: ArrowLeftRight, label: "Transfer" },
  fx_swap: { icon: Repeat2, label: "FX Swap" },
  merchant_payment: { icon: ShoppingBag, label: "Merchant Payment" },
};

const STATUS_META: Record<TransactionStatus, { variant: BadgeProps["variant"]; label: string; pulse?: boolean }> = {
  pending: { variant: "amber", label: "Pending" },
  processing: { variant: "amber", label: "Processing", pulse: true },
  completed: { variant: "mint", label: "Completed" },
  failed: { variant: "crimson", label: "Failed" },
  reversed: { variant: "muted", label: "Reversed" },
};

function walletLabel(wallets: Wallet[], walletId: string | null, fallback: string): string {
  if (!walletId) return fallback;
  const wallet = wallets.find((candidate) => candidate.id === walletId);
  return wallet ? wallet.display_name : fallback;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function LedgerList({ transactions, wallets }: LedgerListProps) {
  return (
    <Card className="border-white/[0.06]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
            <History className="h-4 w-4 text-cyber-mint" />
          </div>
          <CardTitle>Transaction Ledger</CardTitle>
        </div>
        <CardDescription>A precise record of every settlement, local and international.</CardDescription>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ul className="scrollbar-thin max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {transactions.map((transaction, index) => {
              const typeMeta = TYPE_META[transaction.type];
              const statusMeta = STATUS_META[transaction.status];
              const TypeIcon = typeMeta.icon;

              const fromLabel = walletLabel(wallets, transaction.sender_wallet_id, "External Deposit");
              const toLabel = walletLabel(wallets, transaction.receiver_wallet_id, "External Withdrawal");
              const isCrossCurrency = transaction.source_currency !== transaction.destination_currency;

              return (
                <motion.li
                  key={transaction.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.4) }}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.015] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.03]"
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                      transaction.status === "failed"
                        ? "border-neon-crimson/30 bg-neon-crimson/10 text-neon-crimson"
                        : "border-cyber-mint/20 bg-cyber-mint/[0.06] text-cyber-mint",
                    )}
                  >
                    <TypeIcon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-liquid-platinum">
                        {typeMeta.label}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {fromLabel} <span className="mx-1 text-muted-foreground/50">→</span> {toLabel}
                        </span>
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{formatTimestamp(transaction.created_at)}</span>
                      {transaction.external_reference && (
                        <span className="truncate font-mono text-muted-foreground/70">
                          {transaction.external_reference}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold text-liquid-platinum">
                      {formatCurrency(transaction.destination_amount, transaction.destination_currency)}
                    </p>
                    {isCrossCurrency && (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        from {formatCurrency(transaction.source_amount, transaction.source_currency)}
                      </p>
                    )}
                    <Badge variant={statusMeta.variant} className="mt-1.5">
                      {statusMeta.pulse && <Loader2 className="h-3 w-3 animate-spin" />}
                      {statusMeta.label}
                    </Badge>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
