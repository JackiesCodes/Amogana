import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/[0.04] text-liquid-platinum",
        mint: "border-cyber-mint/30 bg-cyber-mint/10 text-cyber-mint",
        crimson: "border-neon-crimson/30 bg-neon-crimson/10 text-neon-crimson",
        amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
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
