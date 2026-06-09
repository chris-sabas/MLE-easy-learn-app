import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202606080001_add_accounts_progress_bookmarks_metrics.sql", import.meta.url),
  "utf8",
);
const middlewareSource = readFileSync(new URL("../lib/supabase/middleware.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("../app/profile/page.tsx", import.meta.url), "utf8");
const signUpSource = readFileSync(new URL("../app/auth/sign-up/page.tsx", import.meta.url), "utf8");

function resultFor(voteDistribution, selectedAnswer) {
  const values = Object.values(voteDistribution).filter((value) => typeof value === "number" && value > 0);
  if (!values.length) return "ungraded";
  const max = Math.max(...values);
  return voteDistribution[selectedAnswer] === max ? "correct" : "incorrect";
}

function metrics(questionIds, progress, start, end) {
  const ids = new Set(questionIds.filter((id) => id >= start && id <= end));
  const rows = progress.filter((row) => ids.has(row.question_id));
  const correct = rows.filter((row) => row.result === "correct").length;
  const incorrect = rows.filter((row) => row.result === "incorrect").length;
  const ungraded = rows.filter((row) => row.result === "ungraded").length;
  const graded = correct + incorrect;
  return {
    total: ids.size,
    answered: new Set(rows.map((row) => row.question_id)).size,
    correct,
    incorrect,
    ungraded,
    accuracy: graded ? Math.round((correct / graded) * 100) : null,
  };
}

test("top-voted answer is correct", () => {
  assert.equal(resultFor({ A: 20, B: 80 }, "B"), "correct");
});

test("tied top answers are correct", () => {
  assert.equal(resultFor({ A: 50, B: 50 }, "A"), "correct");
  assert.equal(resultFor({ A: 50, B: 50 }, "B"), "correct");
});

test("lower-voted answer is incorrect", () => {
  assert.equal(resultFor({ A: 20, B: 80 }, "A"), "incorrect");
});

test("no votes gives ungraded", () => {
  assert.equal(resultFor({}, "A"), "ungraded");
});

test("progress upsert updates an existing record", () => {
  assert.equal(pageSource.includes(".upsert(row, { onConflict: \"user_id,question_id\" })"), true);
});

test("range metrics calculations", () => {
  const data = metrics([1, 2, 3, 4], [{ question_id: 1, result: "correct" }, { question_id: 3, result: "ungraded" }], 1, 3);
  assert.deepEqual({ total: data.total, answered: data.answered, ungraded: data.ungraded }, { total: 3, answered: 2, ungraded: 1 });
});

test("accuracy excludes ungraded", () => {
  const data = metrics(
    [1, 2, 3],
    [{ question_id: 1, result: "correct" }, { question_id: 2, result: "incorrect" }, { question_id: 3, result: "ungraded" }],
    1,
    3,
  );
  assert.equal(data.accuracy, 50);
});

test("bookmark behavior", () => {
  assert.equal(pageSource.includes("toggleBookmark"), true);
  assert.equal(pageSource.includes("from(\"bookmarks\").insert"), true);
  assert.equal(profileSource.includes("removeBookmark"), true);
  assert.equal(profileSource.includes("from(\"bookmarks\").delete()"), true);
});

test("last-question restoration", () => {
  assert.equal(pageSource.includes("last_question_id"), true);
  assert.equal(pageSource.includes("questionToRestore"), true);
  assert.equal(pageSource.includes("resetForQuestion(questionToRestore)"), true);
});

test("signup only shows confirmation message when no session is returned", () => {
  assert.equal(signUpSource.includes("if (data.session)"), true);
  assert.equal(signUpSource.includes("router.push(\"/\")"), true);
  assert.equal(signUpSource.includes("Check your email to confirm your account"), true);
});

test("profile page consolidates account dashboard and bookmarks", () => {
  assert.equal(profileSource.includes("Account information"), true);
  assert.equal(profileSource.includes("Progress dashboard"), true);
  assert.equal(profileSource.includes(">Bookmarks</h2>"), true);
  assert.equal(pageSource.includes("href=\"/profile\""), true);
});

test("unauthenticated users are redirected", () => {
  assert.equal(middlewareSource.includes("/auth/sign-in"), true);
  assert.equal(middlewareSource.includes("NextResponse.redirect"), true);
});

test("SQL migration contains RLS for all three tables", () => {
  for (const table of ["profiles", "question_progress", "bookmarks"]) {
    assert.equal(migration.includes(`alter table public.${table} enable row level security;`), true);
  }
  assert.equal(migration.includes("with check (id = auth.uid())"), true);
  assert.equal(migration.includes("with check (user_id = auth.uid())"), true);
});
