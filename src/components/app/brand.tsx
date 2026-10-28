import { cn } from "@/lib/utils";

/** The Amogana mark (same artwork as src/app/icon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("h-7 w-7 shrink-0", className)}>
      <rect width="64" height="64" rx="14" fill="#0A0B10" stroke="rgba(0,255,163,0.35)" strokeWidth="2" />
      <path d="M14 46 L26 30 L34 38 L50 18" fill="none" stroke="#00FFA3" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="18" r="4.5" fill="#00FFA3" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-[0.08em] text-liquid-platinum", className)}>
      AMOGANA<span className="text-cyber-mint">.</span>
    </span>
  );
}
