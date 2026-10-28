import { cn } from "@/lib/utils";

/** The Amogana mark (same artwork as src/app/icon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("h-7 w-7 shrink-0", className)}>
      <rect width="64" height="64" rx="14" fill="#0B120F" />
      <rect x="3" y="3" width="58" height="58" rx="11" fill="none" stroke="#C8A24A" strokeWidth="2" />
      <path d="M14 46 L26 30 L34 38 L50 18" fill="none" stroke="#85BB65" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="50" cy="18" r="4.5" fill="#85BB65" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-[0.08em] text-ivory", className)}>
      AMOGANA<span className="text-gold">.</span>
    </span>
  );
}
