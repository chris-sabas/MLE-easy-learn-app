"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function SignUpPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
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
    const origin = window.location.origin;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        data: { username: username.trim() },
      },
    });
    setLoading(false);

    if (error) {
      setMessage(error.message.toLowerCase().includes("username") ? "That username is already taken." : error.message);
      return;
    }

    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }

    setMessage("Check your email to confirm your account, then return here to sign in.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-8">
      <form className="grid w-full max-w-md gap-4 rounded border border-stone-300 bg-white p-5" onSubmit={submit}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-teal-700">MLE certification practice</p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-950">Create account</h1>
        </div>
        <label className="grid gap-1 text-sm font-medium text-stone-800">
          Username
          <input className="rounded border border-stone-300 px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-stone-800">
          Email
          <input className="rounded border border-stone-300 px-3 py-2" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-stone-800">
          Password
          <input className="rounded border border-stone-300 px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} />
        </label>
        <button className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-stone-400" disabled={loading}>
          {loading ? "Creating..." : "Sign up"}
        </button>
        {message ? <p className="text-sm text-stone-700">{message}</p> : null}
        <p className="text-sm text-stone-600">
          Already have an account? <Link className="font-medium text-teal-700" href="/auth/sign-in">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
