"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    router.push(searchParams.get("next") ?? "/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-8">
      <form className="grid w-full max-w-md gap-4 rounded border border-stone-300 bg-white p-5" onSubmit={submit}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-teal-700">MLE certification practice</p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-950">Sign in</h1>
        </div>
        <label className="grid gap-1 text-sm font-medium text-stone-800">
          Email
          <input className="rounded border border-stone-300 px-3 py-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-stone-800">
          Password
          <input className="rounded border border-stone-300 px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-stone-400" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {message ? <p className="text-sm text-red-700">{message}</p> : null}
        <p className="text-sm text-stone-600">
          Need an account? <Link className="font-medium text-teal-700" href="/auth/sign-up">Sign up</Link>
        </p>
      </form>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-8">Loading sign in...</main>}>
      <SignInForm />
    </Suspense>
  );
}
