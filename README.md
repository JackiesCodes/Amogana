# Amogana

A neo-futuristic currency transfer platform bridging local African mobile money
networks (Orange Money, myZaka, Smega) with international FX, remittance
rails, and global merchants (Deriv, Bet365).

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui-style
  components, Lucide icons, Framer Motion.
- **Backend**: Supabase (PostgreSQL) — double-entry ledger schema, Row Level
  Security, Postgres RPC functions for atomic settlement.
- **Integrations**: HMAC-verified webhook receiver for Orange Money, atomic
  transfer API for wallet-to-wallet / FX / merchant payments.

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project credentials
npm run dev
```

The dashboard at `/dashboard` renders fully with in-memory demo data even
without a Supabase project configured — the transfer panel calls the real
`/api/transfers` route first, and transparently falls back to a local,
clearly-labelled simulation ("simulated preview") if the backend isn't
reachable or unauthenticated. Wire up Supabase to make it fully live.

### Database Setup

Run the migrations against a Supabase project (via the SQL editor or the
Supabase CLI) in order:

```bash
supabase/migrations/0001_amogana_core_ledger.sql
supabase/migrations/0002_amogana_external_settlement.sql
```

This provisions:

- `currencies`, `profiles`, `wallets`, `external_accounts`, `fx_rates`
- `transactions` (the double-entry ledger header) and `ledger_entries`
  (immutable debit/credit lines)
- `webhook_events` (inbound audit log + idempotency guard)
- RPC functions: `execute_ledger_transfer`, `create_pending_settlement`,
  `settle_pending_transaction`, `fail_pending_transaction`,
  `reserve_wallet_funds`
- Row Level Security policies scoping every table to `auth.uid()`

## Architecture Notes

### Double-entry ledger

Every money movement is one row in `transactions` (sender/receiver wallet,
source/destination amount + currency, FX rate, status) plus a matching pair
of immutable `ledger_entries` rows (one debit, one credit) for full
auditability. Balance mutations, FX conversion, and the ledger write all
happen inside a single Postgres function (`execute_ledger_transfer`) using
row-level locks (`SELECT ... FOR UPDATE`) — this is what makes the transfer
atomic, not application-level retry logic.

### Two-phase external settlement

Deposits/withdrawals that depend on an external provider (Orange Money, a
bank rail) go through `create_pending_settlement` → `pending` transaction →
provider webhook → `settle_pending_transaction` (or `fail_pending_transaction`
on decline). `settle_pending_transaction` is idempotent: a duplicate webhook
delivery for an already-completed transaction is a no-op.

### Webhook security

`/api/webhooks/orange-money` verifies an HMAC-SHA256 signature
(`X-Orange-Signature` header) over the raw request body using a
timing-safe comparison before trusting the payload. Every inbound delivery —
valid or not — is persisted to `webhook_events` first, with a unique
`(provider, event_id)` constraint providing idempotency against retries.

### FX pricing

`src/lib/fx.ts` applies the platform spread (basis points) against a
mid-market rate to compute the customer-facing rate and margin. In
production, `mid_rate` comes from the `fx_rates` table; a small fallback
table is used client-side for the dashboard's live conversion preview before
the authoritative server-side quote is computed at submission time.

## Project Structure

```
src/
  app/
    api/transfers/route.ts             # atomic wallet-to-wallet / FX / merchant transfer
    api/webhooks/orange-money/route.ts # HMAC-verified MNO settlement webhook
    dashboard/page.tsx
  components/
    dashboard/                         # wallet matrix, transfer panel, ledger list
    ui/                                # shadcn-style primitives
  lib/
    supabase/{client,server,admin}.ts
    types/database.ts                  # hand-written Database types matching the SQL schema
    fx.ts / webhooks/hmac.ts / validation.ts / mock-data.ts
supabase/migrations/                   # SQL schema + RPC functions
```

## Security Considerations

- All privileged writes (wallet balance mutation, transaction settlement)
  happen through Postgres `SECURITY DEFINER` RPC functions called from
  server-only code using the Supabase **service role** key
  (`src/lib/supabase/admin.ts`, guarded by the `server-only` package). RLS
  policies on `wallets`/`transactions`/`ledger_entries` only grant `SELECT`
  to the owning user — there are intentionally no client-facing
  insert/update policies.
- Webhook signatures are compared with `crypto.timingSafeEqual` to avoid
  timing side-channels.
- `next@14.2.35` is the latest patch on the requested Next.js 14 line. `npm
  audit` still flags advisories fixed only in Next 15/16 (a major-version
  jump out of scope here) and one transitive `postcss` version bundled
  inside `next`'s own build tooling (not the project's own `postcss`
  dependency, which is current). Revisit if/when upgrading past Next 14.
