"use client";

import { motion } from "framer-motion";
import { Layers } from "lucide-react";

import { WalletCard } from "@/components/dashboard/wallet-card";
import { formatCurrency } from "@/lib/utils";
import type { Wallet } from "@/lib/types/database";

interface WalletMatrixProps {
  wallets: Wallet[];
  selectedWalletId?: string;
  onSelectWallet?: (wallet: Wallet) => void;
}

const HEADLINE_CURRENCY = "BWP";
const APPROX_TO_BWP: Record<string, number> = {
  BWP: 1,
  ZAR: 1.3542,
  USD: 13.6054,
  EUR: 14.728,
  GBP: 17.2414,
};

export function WalletMatrix({ wallets, selectedWalletId, onSelectWallet }: WalletMatrixProps) {
  const totalInBwp = wallets.reduce((sum, wallet) => {
    const rate = APPROX_TO_BWP[wallet.currency_code] ?? 1;
    return sum + wallet.balance * rate;
  }, 0);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3.5 w-3.5 text-cyber-mint" />
            Wallet Matrix
          </div>
          <h2 className="mt-1 text-xl font-semibold text-liquid-platinum">Your Balances</h2>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-right"
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Estimated Net Worth
          </p>
          <p className="font-mono text-2xl font-semibold text-cyber-mint text-glow-mint">
            {formatCurrency(totalInBwp, HEADLINE_CURRENCY)}
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {wallets.map((wallet, index) => (
          <WalletCard
            key={wallet.id}
            wallet={wallet}
            index={index}
            isSelected={wallet.id === selectedWalletId}
            onSelect={onSelectWallet}
          />
        ))}
      </div>
    </section>
  );
}
