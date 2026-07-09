"use client";

import { motion } from "framer-motion";
import {
  Smartphone,
  LineChart,
  Trophy,
  Landmark,
  Building2,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import type { Wallet, WalletCategory } from "@/lib/types/database";

interface WalletCardProps {
  wallet: Wallet;
  isSelected?: boolean;
  onSelect?: (wallet: Wallet) => void;
  index?: number;
}

const CATEGORY_META: Record<
  WalletCategory,
  { icon: LucideIcon; label: string; accent: "mint" | "crimson" | "platinum" }
> = {
  mobile_money: { icon: Smartphone, label: "Mobile Money", accent: "mint" },
  bank: { icon: Building2, label: "Bank Rail", accent: "platinum" },
  fx: { icon: Landmark, label: "FX Vault", accent: "platinum" },
  trading: { icon: LineChart, label: "Trading", accent: "crimson" },
  sportsbook: { icon: Trophy, label: "Sportsbook", accent: "crimson" },
  platform: { icon: Landmark, label: "Platform", accent: "mint" },
};

export function WalletCard({ wallet, isSelected, onSelect, index = 0 }: WalletCardProps) {
  const meta = CATEGORY_META[wallet.category];
  const Icon = meta.icon;
  const accentIsMint = meta.accent === "mint";
  const accentIsCrimson = meta.accent === "crimson";

  return (
    <motion.button
      type="button"
      onClick={() => onSelect?.(wallet)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: "easeOut" }}
      whileHover={{ y: -4 }}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300",
        "border-white/[0.06] bg-white/[0.02] backdrop-blur-md",
        isSelected
          ? accentIsCrimson
            ? "border-neon-crimson/50 shadow-glow-crimson"
            : "border-cyber-mint/50 shadow-glow-mint"
          : "hover:border-white/20",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl transition-opacity duration-300 opacity-0 group-hover:opacity-100",
          accentIsCrimson ? "bg-neon-crimson/20" : "bg-cyber-mint/20",
        )}
      />

      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl border",
              accentIsCrimson
                ? "border-neon-crimson/30 bg-neon-crimson/10 text-neon-crimson"
                : accentIsMint
                  ? "border-cyber-mint/30 bg-cyber-mint/10 text-cyber-mint"
                  : "border-white/10 bg-white/[0.04] text-liquid-platinum",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {wallet.provider_name}
            </p>
            <p className="text-sm font-medium text-liquid-platinum">{wallet.display_name}</p>
          </div>
        </div>
        <Badge variant={wallet.is_active ? "mint" : "muted"} className="shrink-0">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              wallet.is_active ? "bg-cyber-mint animate-pulse-glow" : "bg-muted-foreground",
            )}
          />
          {wallet.is_active ? "Live" : "Inactive"}
        </Badge>
      </div>

      <div className="relative mt-6 flex items-end justify-between">
        <div>
          <p className="font-mono text-2xl font-semibold tracking-tight text-liquid-platinum">
            {formatCurrency(wallet.balance, wallet.currency_code)}
          </p>
          {wallet.available_balance !== wallet.balance && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {formatCurrency(wallet.available_balance, wallet.currency_code)} available
            </p>
          )}
        </div>
        <Badge variant="default" className="font-mono">
          {wallet.currency_code}
        </Badge>
      </div>

      {wallet.external_ref && (
        <p className="relative mt-3 font-mono text-[11px] text-muted-foreground/70">
          {wallet.external_ref}
        </p>
      )}
    </motion.button>
  );
}
