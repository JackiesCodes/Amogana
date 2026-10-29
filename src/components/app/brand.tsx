"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

// Geometry of the binaryTrades mark (same artwork as src/app/icon.svg):
// five rounded bars with a rising line and four nodes cut through them.
const BARS = [
  { x: 10, y: 36.5, h: 122 },
  { x: 39, y: 47.5, h: 99 },
  { x: 69, y: 3.5, h: 121 },
  { x: 99, y: 25.5, h: 121 },
  { x: 128, y: 25.5, h: 99 },
] as const;
const NODES = [
  [34, 113.5],
  [65, 82.5],
  [95, 100.5],
  [125, 55.5],
] as const;
const LINE = NODES.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

export function BrandMark({ className }: { className?: string }) {
  const cut = `bt-cut-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 160 160" aria-hidden className={cn("h-7 w-7 shrink-0", className)}>
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="160" height="160">
          <rect width="160" height="160" fill="white" />
          <path d={LINE} fill="none" stroke="black" strokeWidth="6" strokeLinejoin="round" />
          {NODES.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="8.5" fill="black" />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${cut})`} fill="#85BB65">
        {BARS.map((b) => (
          <rect key={b.x} x={b.x} y={b.y} width="22" height={b.h} rx="11" />
        ))}
      </g>
      {NODES.map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="4" fill="#C8A24A" />
      ))}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-tight text-ivory", className)}>
      binary<span className="text-profit">Trades</span>
    </span>
  );
}
