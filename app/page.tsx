"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
type ModelProvider = "openai" | "gemini";
type AiMode = "explain" | "custom" | "followup" | "general";
type ChatMessage = { role: "user" | "assistant"; content: string };

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderMarkdown(content: string, theme: Theme) {
  const lines = content.split(/\r?\n/);
  const elements: ReactNode[] = [];
  let bullets: string[] = [];

  function flushBullets() {
    if (!bullets.length) return;
    elements.push(
      <ul key={`list-${elements.length}`} className="list-disc space-y-1 pl-5">
        {bullets.map((line, index) => (
          <li key={index}>{renderInlineMarkdown(line)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets();
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      bullets.push(line.slice(2));
      return;
    }

    flushBullets();
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={index} className={`mt-3 font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>
          {renderInlineMarkdown(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h3 key={index} className={`mt-3 text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>
          {renderInlineMarkdown(line.slice(3))}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h3 key={index} className={`mt-3 text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>
          {renderInlineMarkdown(line.slice(2))}
        </h3>,
      );
    } else {
      elements.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
    }
  });

  flushBullets();
  return elements;
}

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
  const [modelProvider, setModelProvider] = useState<ModelProvider>("gemini");
  const [customPrompt, setCustomPrompt] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState("");
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const currentQuestion = findQuestionById(sortedQuestions, currentId) ?? firstQuestion;
  const currentIndex = sortedQuestions.findIndex((question) => question.id === currentQuestion.id);
  const showCommunityData = shouldShowCommunityData(selectedChoice);
  const voteEntries = positiveVoteEntries(currentQuestion);
  const hasVotes = voteEntries.length > 0;
  const hasAiConversation = aiMessages.length > 0;

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
    setCustomPrompt("");
    setFollowUpPrompt("");
    setAiMessages([]);
    setAiError("");
    setCopyMessage("");
  }

  function buildManualPrompt() {
    if (!selectedChoice) {
      return `Disclaimer: This prompt is intended for an external AI chatbot. It is optimized for careful study help and answer quality, not brevity.\n\nYou are a study assistant. I have not submitted an answer yet, so do not reveal or infer the answer to the quiz. Help me study this general topic or clarify concepts only. Explain the underlying concepts and ask clarifying questions if needed.\n\nMy question:\n${customPrompt.trim() || "[write your general study question here]"}`;
    }

    return `Disclaimer: This prompt is intended for an external AI chatbot. It is optimized to get the most accurate study answer possible, not to minimize token usage.\n\nYou are a study assistant for ML/Google Cloud certification-style practice questions. The source is unofficial study material. Community votes and comments may be wrong, so do not blindly follow them. Analyze the question from first principles, evaluate every choice, identify likely traps, and clearly separate: (1) community vote signal, (2) comment signal, and (3) your own technical assessment. If the supplied community signal conflicts with your technical assessment, say so clearly. Provide the final answer you think is best and explain why.\n\nQuestion #${currentQuestion.id}: ${collapseWhitespace(currentQuestion.question)}\n\nChoices:\n${choiceEntries(currentQuestion).map(([key, text]) => `${key}. ${text}`).join("\n")}\n\nCommunity votes:\n${voteEntries.length ? voteEntries.map(([key, percent]) => `${key}: ${percent}%`).join("\n") : "No community voting data."}\n\nSelected answer: ${selectedChoice}\n\nComments:\n${currentQuestion.comments.slice(0, 5).map((comment) => `- ${comment.author} (${comment.votes} votes): ${comment.text}`).join("\n") || "No retained comments."}\n\nMy question:\n${customPrompt.trim() || "Explain this question and say which answer you think is best."}`;
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildManualPrompt());
      setCopyMessage("Prompt copied.");
    } catch {
      setCopyMessage("Could not copy prompt.");
    }
  }

  async function askAi(mode: AiMode) {
    const userMessage = mode === "custom" || mode === "general" ? customPrompt.trim() : mode === "followup" ? followUpPrompt.trim() : undefined;
    if ((mode === "custom" || mode === "general" || mode === "followup") && !userMessage) {
      setAiError("Write a question first.");
      return;
    }
    if (userMessage && userMessage.length > 800) {
      setAiError("Keep your question to 800 characters or fewer.");
      return;
    }

    setAiLoading(true);
    setAiError("");

    const outgoingUserMessage =
      mode === "explain" ? "Explain this question." : userMessage ?? "";
    const nextMessages: ChatMessage[] =
      mode === "explain" ? aiMessages : [...aiMessages, { role: "user", content: outgoingUserMessage }];
    const includeQuestionContext = selectedChoice !== null && mode !== "general";

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelProvider,
          mode,
          question: includeQuestionContext
            ? {
                id: currentQuestion.id,
                question: currentQuestion.question,
                choices: currentQuestion.choices,
                voteDistribution: currentQuestion.voteDistribution,
                comments: currentQuestion.comments.slice(0, 5),
                hasImage: currentQuestion.hasImage,
              }
            : undefined,
          selectedAnswer: selectedChoice,
          userMessage,
          history: aiMessages.slice(-6),
        }),
      });
      const data: { message?: string; error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI request failed.");

      setAiMessages([...nextMessages, { role: "assistant", content: data.message ?? "" }]);
      setCustomPrompt("");
      setFollowUpPrompt("");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI request failed.");
    } finally {
      setAiLoading(false);
    }
  }

  function renderAiHelpSection() {
    return (
      <section className={`grid gap-4 rounded border p-4 sm:p-5 ${theme === "dark" ? "border-stone-700 bg-stone-900" : "border-stone-300 bg-white"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={`text-base font-semibold ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>AI help</h2>
            <p className={`mt-1 text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>AI calls may cost API credits.</p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className={theme === "dark" ? "text-stone-300" : "text-stone-700"}>Model</span>
            <select
              className={`rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`}
              value={modelProvider}
              onChange={(event) => setModelProvider(event.target.value as ModelProvider)}
              disabled={aiLoading}
            >
              <option value="openai">GPT 5.5</option>
              <option value="gemini">Gemini 3.5 Flash</option>
            </select>
          </label>
        </div>

        {!hasAiConversation ? (
          <div className="grid gap-3">
            {selectedChoice ? (
              <button
                className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
                disabled={aiLoading}
                onClick={() => askAi("explain")}
              >
                {aiLoading ? "Asking..." : "Explain this question"}
              </button>
            ) : (
              <p className={`text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>
                Before you answer, ask general study questions only. The AI will not receive the quiz context yet.
              </p>
            )}

            <div className="grid gap-2">
              <label className={`text-sm font-medium ${theme === "dark" ? "text-stone-200" : "text-stone-800"}`} htmlFor="custom-ai-question">
                {selectedChoice ? "Ask custom question" : "Ask a general question"}
              </label>
              <textarea
                id="custom-ai-question"
                className={`min-h-24 rounded border px-3 py-2 text-sm ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`}
                maxLength={800}
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                disabled={aiLoading}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
                  disabled={aiLoading || !customPrompt.trim()}
                  onClick={() => askAi(selectedChoice ? "custom" : "general")}
                >
                  {selectedChoice ? "Ask custom question" : "Ask general question"}
                </button>
                <button
                  className={`rounded border px-4 py-2 text-sm font-medium ${theme === "dark" ? "border-stone-700 text-stone-100" : "border-stone-300 text-stone-900"}`}
                  type="button"
                  onClick={copyPrompt}
                >
                  Copy prompt
                </button>
              </div>
              {copyMessage ? <p className={`text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>{copyMessage}</p> : null}
            </div>
          </div>
        ) : null}

        {aiError ? <p className="text-sm text-red-700">{aiError}</p> : null}

        {aiMessages.length ? (
          <div className={`grid max-w-full gap-3 overflow-visible rounded border p-3 ${theme === "dark" ? "border-stone-700 bg-stone-950" : "border-stone-200 bg-stone-50"}`}>
            {aiMessages.map((chatMessage, index) => (
              <div
                key={`${chatMessage.role}-${index}`}
                className={`max-w-full overflow-visible rounded px-3 py-2 text-sm leading-6 ${
                  chatMessage.role === "assistant"
                    ? theme === "dark"
                      ? "bg-stone-900 text-stone-100"
                      : "bg-white text-stone-800"
                    : "bg-teal-700 text-white"
                }`}
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide">{chatMessage.role === "assistant" ? "AI" : "You"}</p>
                <div className="grid gap-2 whitespace-normal break-words">{renderMarkdown(chatMessage.content, theme)}</div>
              </div>
            ))}
            <div className="grid gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  className={`rounded border px-4 py-2 text-sm font-medium ${theme === "dark" ? "border-stone-700 text-stone-100" : "border-stone-300 text-stone-900"}`}
                  type="button"
                  onClick={copyPrompt}
                >
                  Copy prompt
                </button>
                {copyMessage ? <p className={`text-sm ${theme === "dark" ? "text-stone-300" : "text-stone-600"}`}>{copyMessage}</p> : null}
              </div>
              <textarea
                aria-label="Follow-up question"
                className={`min-h-20 rounded border px-3 py-2 text-sm ${theme === "dark" ? "border-stone-700 bg-stone-900 text-stone-100" : "border-stone-300 bg-white text-stone-900"}`}
                maxLength={800}
                value={followUpPrompt}
                onChange={(event) => setFollowUpPrompt(event.target.value)}
                disabled={aiLoading}
              />
              <button
                className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
                disabled={aiLoading || !followUpPrompt.trim()}
                onClick={() => askAi("followup")}
              >
                Ask follow-up
              </button>
            </div>
          </div>
        ) : null}
      </section>
    );
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
            <p className="text-sm font-medium uppercase tracking-wide text-teal-700">MLE certification practice</p>
            <h1 className={`text-2xl font-semibold sm:text-3xl ${theme === "dark" ? "text-stone-50" : "text-stone-950"}`}>Question #{currentQuestion.id}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
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
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                selectByNumber();
              }}
            >
              <input
                id="question-number"
                className={`min-w-0 flex-1 rounded border px-3 py-2 ${theme === "dark" ? "border-stone-700 bg-stone-950 text-stone-100" : "border-stone-300 bg-white"}`}
                inputMode="numeric"
                value={numberInput}
                onChange={(event) => setNumberInput(event.target.value)}
              />
              <button className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white" type="submit">
                Go
              </button>
            </form>
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

            {renderAiHelpSection()}

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

        {!selectedChoice ? renderAiHelpSection() : null}
      </div>
    </main>
  );
}
