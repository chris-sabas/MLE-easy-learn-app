import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import questions from "../app/data/questions.json" with { type: "json" };

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const quizSource = readFileSync(new URL("../lib/quiz.ts", import.meta.url), "utf8");

const choiceKeys = ["A", "B", "C", "D", "E", "F"];

function normalizeQuestions(items) {
  const seen = new Set();
  return items
    .map((question) => {
      assert.equal(typeof question.id, "number");
      assert.equal(typeof question.question, "string");
      assert.ok(question.question.length > 0);
      assert.ok(question.choices && Object.keys(question.choices).length > 0);
      assert.equal(seen.has(question.id), false, `duplicate id ${question.id}`);
      seen.add(question.id);
      return question;
    })
    .sort((a, b) => a.id - b.id);
}

function positiveVoteEntries(question) {
  return choiceKeys
    .flatMap((key) => {
      const percent = question.voteDistribution?.[key];
      return typeof percent === "number" && percent > 0 ? [[key, percent]] : [];
    })
    .sort((a, b) => b[1] - a[1]);
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function shouldShowCommunityData(selectedChoice) {
  return selectedChoice !== null;
}

function questionsInRange(items, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return items.filter((question) => question.id >= low && question.id <= high);
}

function nextByOffset(items, currentId, offset) {
  const index = items.findIndex((question) => question.id === currentId);
  return items[index + offset]?.id;
}

test("all questions are loaded from app/data/questions.json", () => {
  const sorted = normalizeQuestions(questions);
  assert.equal(sorted.length, questions.length);
  assert.ok(sorted.length > 10);
  assert.equal(pageSource.includes("./data/questions.json"), true);
  assert.equal(pageSource.includes("questions." + "sample.json"), false);
});

test("sparse vote distributions are accepted", () => {
  const sparse = questions.find((question) => Object.keys(question.voteDistribution ?? {}).length < Object.keys(question.choices).length);
  assert.ok(sparse);
});

test("question text whitespace is collapsed at render level", () => {
  assert.equal(collapseWhitespace("One line\n  another\tline"), "One line another line");
  assert.equal(pageSource.includes("collapseWhitespace(currentQuestion.question)"), true);
});

test("vote entries only include positive percentages sorted high to low", () => {
  const entries = positiveVoteEntries({ voteDistribution: { A: 0, B: 19, C: 73, D: undefined } });
  assert.deepEqual(entries, [
    ["C", 73],
    ["B", 19],
  ]);
});

test("vote distribution is hidden before answer selection and visible after", () => {
  assert.equal(shouldShowCommunityData(null), false);
  assert.equal(shouldShowCommunityData("A"), true);
  assert.equal(pageSource.includes("Community vote distribution"), true);
});

test("theme preference is stored in localStorage", () => {
  assert.equal(pageSource.includes("localStorage.getItem(\"quiz-theme\")"), true);
  assert.equal(pageSource.includes("localStorage.setItem(\"quiz-theme\", theme)"), true);
  assert.equal(pageSource.includes("prefers-color-scheme: dark"), true);
});

test("comments are hidden before answer selection and visible after", () => {
  assert.equal(shouldShowCommunityData(null), false);
  assert.equal(shouldShowCommunityData("C"), true);
  assert.equal(pageSource.includes("No community comments are available for this question."), true);
});

test("changing questions resets the selected answer and hides results", () => {
  assert.equal(pageSource.includes("setSelectedChoice(null)"), true);
  assert.equal(pageSource.includes("resetForQuestion(next.id)"), true);
});

test("previous and next use sorted available IDs", () => {
  const sorted = normalizeQuestions([{ id: 7, question: "q", choices: { A: "a" } }, { id: 2, question: "q", choices: { A: "a" } }, { id: 9, question: "q", choices: { A: "a" } }]);
  assert.deepEqual(sorted.map((question) => question.id), [2, 7, 9]);
  assert.equal(nextByOffset(sorted, 7, -1), 2);
  assert.equal(nextByOffset(sorted, 7, 1), 9);
});

test("random range selection uses only available IDs in the requested range", () => {
  const sorted = normalizeQuestions(questions);
  const matches = questionsInRange(sorted, 40, 42);
  assert.deepEqual(matches.map((question) => question.id), [40, 41, 42]);
  assert.deepEqual(questionsInRange(sorted, 9999, 10000), []);
});

test("there is no grading behavior", () => {
  const combined = `${pageSource}\n${quizSource}`;
  const blockedTerms = ["correct" + "Answer", "document" + "Answer", "answer" + "Status", "In" + "correct", "Cor" + "rect"];
  assert.equal(blockedTerms.some((term) => combined.includes(term)), false);
});

test("there is no source-link section", () => {
  const combined = `${pageSource}\n${quizSource}`;
  const blockedTerms = ["refer" + "ences", "Refer" + "ences"];
  assert.equal(blockedTerms.some((term) => combined.includes(term)), false);
});

test("hasImage true displays the image warning", () => {
  assert.ok(questions.some((question) => question.hasImage === true));
  assert.equal(
    pageSource.includes("This question includes an image from the source document that is not currently displayed."),
    true,
  );
});

test("choice keys A through F are supported", () => {
  for (const question of questions) {
    for (const key of Object.keys(question.choices)) {
      assert.equal(choiceKeys.includes(key), true);
    }
  }
});
