"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import questionsData from "../data/questions.json";
import { calculateMetrics, type ProgressRecord } from "../../lib/progress";
import { collapseWhitespace, findQuestionById, normalizeQuestions } from "../../lib/quiz";
import { createClient } from "../../lib/supabase/client";

const questions = normalizeQuestions(questionsData);
type Theme = "light" | "dark";
type BookmarkRecord = { question_id: number; created_at: string };
type ProfileState = {
  username: string;
  last_question_id: number | null;
  metrics_range_start: number;
  metrics_range_end: number;
};

export default function ProfilePage() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("light");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [progress, setProgress] = useState<ProgressRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRange, setSavingRange] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [error, setError] = useState("");
  const [metricsStart, setMetricsStart] = useState("1");
  const [metricsEnd, setMetricsEnd] = useState("285");

  const metrics = useMemo(
    () => calculateMetrics(questions, progress, Number(metricsStart), Number(metricsEnd)),
    [metricsEnd, metricsStart, progress],
  );

  useEffect(() => {
    const saved = localStorage.getItem("quiz-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const supabase = createClient();
      if (!supabase) {
        setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
        setLoading(false);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (cancelled) return;
      if (userError || !user) {
        router.push("/auth/sign-in");
        return;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");

      const [{ data: profileData, error: profileError }, { data: progressData, error: progressError }, { data: bookmarkData, error: bookmarkError }] =
        await Promise.all([
          supabase.from("profiles").select("username,last_question_id,metrics_range_start,metrics_range_end").eq("id", user.id).single(),
          supabase.from("question_progress").select("question_id,selected_answer,result,answered_at").eq("user_id", user.id),
          supabase.from("bookmarks").select("question_id,created_at").eq("user_id", user.id),
        ]);

      if (cancelled) return;
      const firstError = profileError ?? progressError ?? bookmarkError;
      if (firstError) setError(firstError.message);

      if (profileData) {
        const nextProfile = profileData as ProfileState;
        setProfile(nextProfile);
        setMetricsStart(String(nextProfile.metrics_range_start));
        setMetricsEnd(String(nextProfile.metrics_range_end));
      }

      setProgress((progressData ?? []) as ProgressRecord[]);
      setBookmarks((bookmarkData ?? []) as BookmarkRecord[]);
      setLoading(false);
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    const supabase = createClient();
    await supabase?.auth.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }

  async function saveMetricsRange() {
    const start = Number(metricsStart);
    const end = Number(metricsEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      setError("Metrics range must use whole numbers with start less than or equal to end.");
      return;
    }
    if (!userId) return;

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setSavingRange(true);
    const { error: saveError } = await supabase
      .from("profiles")
      .update({ metrics_range_start: start, metrics_range_end: end })
      .eq("id", userId);
    setSavingRange(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setProfile((current) => current ? { ...current, metrics_range_start: start, metrics_range_end: end } : current);
  }

  async function removeBookmark(questionId: number) {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setSavingBookmark(true);
    const { error: removeError } = await supabase.from("bookmarks").delete().eq("user_id", userId).eq("question_id", questionId);
    setSavingBookmark(false);

    if (removeError) {
      setError(removeError.message);
      return;
    }

    setBookmarks((items) => items.filter((item) => item.question_id !== questionId));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
        <p className="rounded border border-stone-300 bg-white p-4 text-sm text-stone-700">Loading profile...</p>
      </main>
    );
  }

  return (
    <main className={`min-h-screen px-4 py-5 sm:px-6 lg:px-8 ${theme === "dark" ? "bg-stone-950 text-stone-100" : "bg-stone-100 text-stone-950"}`}>
      <div className="mx-auto grid max-w-5xl gap-5">
        <header className={`flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between ${theme === "dark" ? "border-stone-700" : "border-stone-300"}`}>
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-teal-700">MLE certification practice</p>
            <h1 className={`text-2xl font-semibold sm:text-3xl ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Profile</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={`rounded border px-3 py-2 text-sm font-medium ${theme === "dark" ? "border-stone-600 bg-stone-900 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`} href="/">
              Quiz
            </Link>
            <button className={`rounded border px-3 py-2 text-sm font-medium ${theme === "dark" ? "border-stone-600 bg-stone-900 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`} onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        {error ? <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className={`grid gap-2 rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
          <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Account information</h2>
          <p className="text-sm">Username: <span className="font-medium">{profile?.username ?? "Unknown"}</span></p>
          <p className="text-sm">Email: <span className="font-medium">{email}</span></p>
        </section>

        <section className={`grid gap-4 rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Progress dashboard</h2>
              <p className={`mt-1 text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>Metrics use only questions in the selected range.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label="Metrics range start" className={`min-w-0 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`} inputMode="numeric" value={metricsStart} onChange={(event) => setMetricsStart(event.target.value)} />
              <input aria-label="Metrics range end" className={`min-w-0 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`} inputMode="numeric" value={metricsEnd} onChange={(event) => setMetricsEnd(event.target.value)} />
              <button className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-stone-400" disabled={savingRange} onClick={saveMetricsRange}>
                {savingRange ? "Saving..." : "Save range"}
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Answered", metrics.answered],
              ["Unanswered", metrics.unanswered],
              ["Correct", metrics.correct],
              ["Incorrect", metrics.incorrect],
              ["Ungraded", metrics.ungraded],
              ["Completion", `${metrics.completionPercentage}%`],
              ["Accuracy", metrics.accuracyPercentage === null ? "N/A" : `${metrics.accuracyPercentage}%`],
            ].map(([label, value]) => (
              <div key={label} className={`rounded border p-3 ${theme === "dark" ? "border-stone-700" : "border-stone-200"}`}>
                <p className={`text-xs uppercase tracking-wide ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>{label}</p>
                <p className="mt-1 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${theme === "dark" ? "text-stone-100" : "text-stone-900"}`}>Questions answered per day, last 14 days</h3>
            <div className="mt-2 grid gap-1">
              {metrics.answeredPerDay.map((day) => (
                <div key={day.date} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                  <span>{day.date.slice(5)}</span>
                  <div className={`h-2 rounded ${theme === "dark" ? "bg-stone-800" : "bg-stone-200"}`}>
                    <div className="h-2 rounded bg-teal-700" style={{ width: `${Math.min(day.count * 12, 100)}%` }} />
                  </div>
                  <span className="text-right">{day.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`grid gap-3 rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
          <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Bookmarks</h2>
          {bookmarks.length ? (
            <div className="grid gap-2">
              {[...bookmarks].sort((a, b) => a.question_id - b.question_id).map((bookmark) => {
                const question = findQuestionById(questions, bookmark.question_id);
                return (
                  <div key={bookmark.question_id} className={`grid gap-2 rounded border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center ${theme === "dark" ? "border-stone-700" : "border-stone-200"}`}>
                    <div>
                      <span className="font-medium">Question #{bookmark.question_id}</span>
                      <span className={`mt-1 block text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>{question ? collapseWhitespace(question.question).slice(0, 130) : "Question not found in local data."}</span>
                    </div>
                    <Link className="rounded bg-teal-700 px-3 py-2 text-center text-sm font-semibold text-white" href={`/?question=${bookmark.question_id}`}>
                      Open
                    </Link>
                    <button className={`rounded border px-3 py-2 text-sm font-medium disabled:opacity-60 ${theme === "dark" ? "border-stone-700 text-stone-100" : "border-stone-300 text-stone-900"}`} disabled={savingBookmark} onClick={() => removeBookmark(bookmark.question_id)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={`text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>No bookmarks yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
