import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/[0.04] text-ivory",
        profit: "border-profit/30 bg-profit/10 text-profit",
        loss: "border-loss/30 bg-loss/10 text-loss",
        /** Real money: live mode, real accounts. */
        gold: "border-gold/40 bg-gold/10 text-gold",
        warning: "border-amber-400/30 bg-amber-400/10 text-amber-300",
        muted: "border-white/5 bg-white/[0.02] text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
