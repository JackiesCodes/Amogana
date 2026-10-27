"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", "POST", { password });
      const next = params.get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass-panel w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-xl font-extrabold tracking-[0.08em] text-liquid-platinum">
            AMOGANA<span className="text-cyber-mint">.</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Auto-trading control room</p>
        </div>
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="text-sm text-neon-crimson">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? "Checking…" : "Enter"}
        </Button>
      </form>
    </main>
  );
}
