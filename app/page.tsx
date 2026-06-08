"use client";

import { useEffect, useMemo, useState } from "react";
import questionsData from "./data/questions.json";
import {
  choiceEntries,
  collapseWhitespace,
  findQuestionById,
  normalizeQuestions,
  positiveVoteEntries,
  questionsInRange,
  shouldShowCommunityData,
  type ChoiceKey,
} from "../lib/quiz";

const questions = normalizeQuestions(questionsData);
type Theme = "light" | "dark";

export default function Home() {
  const sortedQuestions = useMemo(() => questions, []);
  const firstQuestion = sortedQuestions[0];
  const lastQuestion = sortedQuestions[sortedQuestions.length - 1];
  const [currentId, setCurrentId] = useState(firstQuestion.id);
  const [numberInput, setNumberInput] = useState(String(firstQuestion.id));
  const [rangeMin, setRangeMin] = useState(String(firstQuestion.id));
  const [rangeMax, setRangeMax] = useState(String(lastQuestion.id));
  const [selectedChoice, setSelectedChoice] = useState<ChoiceKey | null>(null);
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<Theme>("light");

  const currentQuestion = findQuestionById(sortedQuestions, currentId) ?? firstQuestion;
  const currentIndex = sortedQuestions.findIndex((question) => question.id === currentQuestion.id);
  const showCommunityData = shouldShowCommunityData(selectedChoice);
  const voteEntries = positiveVoteEntries(currentQuestion);
  const hasVotes = voteEntries.length > 0;

  useEffect(() => {
    const saved = localStorage.getItem("quiz-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      return;
    }

    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  useEffect(() => {
    localStorage.setItem("quiz-theme", theme);
  }, [theme]);

  function resetForQuestion(questionId: number) {
    setCurrentId(questionId);
    setNumberInput(String(questionId));
    setSelectedChoice(null);
    setMessage("");
  }

  function selectByNumber() {
    const id = Number(numberInput);
    const question = Number.isFinite(id) ? findQuestionById(sortedQuestions, id) : undefined;
    if (!question) {
      setMessage("That question ID is not available in the loaded dataset.");
      return;
    }
    resetForQuestion(question.id);
  }

  function chooseRandomInRange() {
    const min = Number(rangeMin);
    const max = Number(rangeMax);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      setMessage("Enter a numeric minimum and maximum.");
      return;
    }

    const matches = questionsInRange(sortedQuestions, min, max);
    if (matches.length === 0) {
      setMessage("No available questions exist in that range.");
      return;
    }

    const next = matches[Math.floor(Math.random() * matches.length)];
    resetForQuestion(next.id);
  }

  function goToOffset(offset: number) {
    const next = sortedQuestions[currentIndex + offset];
    if (next) resetForQuestion(next.id);
  }

  return (
    <main className={`min-h-screen px-4 py-5 sm:px-6 lg:px-8 ${theme === "dark" ? "bg-stone-950 text-stone-100" : "bg-stone-100 text-stone-950"}`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className={`flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between ${theme === "dark" ? "border-stone-700" : "border-stone-300"}`}>
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-teal-700">Friend quiz</p>
            <h1 className={`text-2xl font-semibold sm:text-3xl ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Question #{currentQuestion.id}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className={`text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>{sortedQuestions.length} questions loaded locally</p>
            <button
              className={`rounded border px-3 py-2 text-sm font-medium ${theme === "dark" ? "border-stone-600 bg-stone-900 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </header>

        <section className={`grid gap-3 rounded border p-3 sm:grid-cols-2 sm:p-4 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
          <div className="flex flex-col gap-2">
            <label className={`text-sm font-medium ${theme === "dark" ? "text-stone-200" : "text-stone-800"}`} htmlFor="question-number">
              Select question
            </label>
            <div className="flex gap-2">
              <input
                id="question-number"
                className={`min-w-0 flex-1 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`}
                inputMode="numeric"
                value={numberInput}
                onChange={(event) => setNumberInput(event.target.value)}
              />
              <button className="rounded bg-stone-900 px-4 py-2 text-sm font-semibold text-white" onClick={selectByNumber}>
                Go
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={`text-sm font-medium ${theme === "dark" ? "text-stone-200" : "text-stone-800"}`}>Random range</span>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                aria-label="Minimum question number"
                className={`min-w-0 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`}
                inputMode="numeric"
                value={rangeMin}
                onChange={(event) => setRangeMin(event.target.value)}
              />
              <input
                aria-label="Maximum question number"
                className={`min-w-0 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`}
                inputMode="numeric"
                value={rangeMax}
                onChange={(event) => setRangeMax(event.target.value)}
              />
              <button className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white" onClick={chooseRandomInRange}>
                Pick
              </button>
            </div>
          </div>

          {message ? <p className="text-sm text-red-700 sm:col-span-2">{message}</p> : null}
        </section>

        <section className={`rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
          {currentQuestion.hasImage ? (
            <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              This question includes an image from the source document that is not currently displayed.
            </div>
          ) : null}

          <p className={`text-lg font-medium leading-7 ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>{collapseWhitespace(currentQuestion.question)}</p>

          <div className="mt-5 grid gap-3">
            {choiceEntries(currentQuestion).map(([key, text]) => {
              const active = selectedChoice === key;
              return (
                <button
                  key={key}
                  className={`rounded border px-4 py-3 text-left transition-colors ${
                    active
                      ? theme === "dark"
                        ? "border-teal-500 bg-stone-800"
                        : "border-teal-700 bg-teal-50"
                      : theme === "dark"
                        ? "border-stone-700 bg-stone-950 hover:bg-stone-800"
                        : "border-stone-300 bg-white hover:bg-stone-50"
                  }`}
                  onClick={() => setSelectedChoice(key)}
                >
                  <span className="font-semibold">{key}.</span> {text}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex justify-between gap-2">
            <button
              className={`rounded border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${theme === "dark" ? "border-stone-700" : "border-stone-300"}`}
              disabled={currentIndex <= 0}
              onClick={() => goToOffset(-1)}
            >
              Previous
            </button>
            <button
              className={`rounded border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${theme === "dark" ? "border-stone-700" : "border-stone-300"}`}
              disabled={currentIndex >= sortedQuestions.length - 1}
              onClick={() => goToOffset(1)}
            >
              Next
            </button>
          </div>
        </section>

        {showCommunityData ? (
          <section className={`grid gap-4 rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
            <div>
              <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Community vote distribution</h2>
              {hasVotes ? (
                <ul className="mt-3 grid gap-2">
                  {voteEntries.map(([key, percent]) => (
                    <li key={key} className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${theme === "dark" ? "border-stone-700" : "border-stone-200"}`}>
                      <span className={`font-medium ${theme === "dark" ? "text-stone-100" : "text-stone-900"}`}>{key}</span>
                      <span className={theme === "dark" ? "text-stone-300" : "text-stone-700"}>{percent}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-3 text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>No community voting data is available for this question.</p>
              )}
            </div>

            <div>
              <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Comments</h2>
              {currentQuestion.comments.length ? (
                <div className="mt-3 grid gap-3">
                  {currentQuestion.comments.map((comment) => (
                    <article key={`${comment.author}-${comment.votes}-${comment.text.slice(0, 12)}`} className={`rounded border p-3 ${theme === "dark" ? "border-stone-700" : "border-stone-200"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className={`font-medium ${theme === "dark" ? "text-stone-100" : "text-stone-900"}`}>{comment.author}</h3>
                        <span className={`text-xs font-medium ${theme === "dark" ? "text-stone-400" : "text-stone-500"}`}>{comment.votes} votes</span>
                      </div>
                      <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${theme === "dark" ? "text-stone-300" : "text-stone-700"}`}>{comment.text}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={`mt-3 text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>No community comments are available for this question.</p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
