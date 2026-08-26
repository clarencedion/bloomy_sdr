"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap } from "lucide-react";
import { useAuth } from "@/lib/firebase/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/app/home");
  }, [loading, router, user]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/app/home");
    } catch {
      setError("Incorrect email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-slate-50">
      {/* ── Left branding panel ── */}
      <section className="hidden lg:flex lg:flex-col lg:w-1/2 bg-blue-600 p-12 text-white">
        <div className="flex items-center gap-3 mb-auto">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/20">
            <Zap className="size-5 text-white" />
          </div>
          <span className="text-[16px] font-bold">Devcomm OS</span>
        </div>

        <div className="mb-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest mb-6">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            B2B Sales Automation
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Find leads &amp;<br />send emails —<br />automatically.
          </h1>
          <p className="text-blue-100 text-[15px] leading-relaxed max-w-sm">
            Set your target. The machine does the rest: discovers companies, enriches contacts, writes personalised outreach, and sends every day.
          </p>

          <div className="mt-10 flex gap-8">
            {[
              { n: "100+", l: "emails / day" },
              { n: "24/7", l: "autonomous" },
              { n: "0", l: "manual steps" },
            ].map((s) => (
              <div key={s.l}>
                <div className="text-3xl font-bold">{s.n}</div>
                <div className="text-blue-200 text-[12px] mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-blue-300 text-[11px]">
          © {new Date().getFullYear()} Devcomm
        </p>
      </section>

      {/* ── Right login form ── */}
      <section className="flex flex-1 items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Zap className="size-4" />
            </div>
            <span className="font-bold text-slate-800">Devcomm OS</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Sign in</h2>
          <p className="text-[13px] text-slate-500 mb-6">
            Enter your credentials to access your account.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
