import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");

test("API rejects missing question", () => {
  assert.equal(routeSource.includes("Missing or invalid question."), true);
  assert.equal(routeSource.includes("if (needsQuestion && !question)"), true);
});

test("API rejects missing provider key", () => {
  assert.equal(routeSource.includes("Missing OPENAI_API_KEY"), true);
  assert.equal(routeSource.includes("Missing GEMINI_API_KEY"), true);
});

test("API rejects overlong custom question", () => {
  assert.equal(routeSource.includes("MAX_USER_MESSAGE_LENGTH = 800"), true);
  assert.equal(routeSource.includes("userMessage must be 800 characters or fewer."), true);
});

test("API trims history to latest 6 messages", () => {
  assert.equal(routeSource.includes("MAX_HISTORY_MESSAGES = 6"), true);
  assert.equal(routeSource.includes(".slice(-MAX_HISTORY_MESSAGES)"), true);
});

test("AI context includes question, choices, votes, selected answer, and comments", () => {
  assert.equal(routeSource.includes("question: question.question"), true);
  assert.equal(routeSource.includes("choices: question.choices"), true);
  assert.equal(routeSource.includes("communityVotes: question.voteDistribution"), true);
  assert.equal(routeSource.includes("selectedAnswer: selectedAnswer ?? null"), true);
  assert.equal(routeSource.includes("retainedComments: question.comments.slice(0, MAX_COMMENTS)"), true);
});

test("client hides API keys", () => {
  assert.equal(pageSource.includes("OPENAI_API_KEY"), false);
  assert.equal(pageSource.includes("GEMINI_API_KEY"), false);
});

test("chat resets when question changes", () => {
  assert.equal(pageSource.includes("setAiMessages([])"), true);
  assert.equal(pageSource.includes("setAiError(\"\")"), true);
  assert.equal(pageSource.includes("resetForQuestion(next.id)"), true);
});

test("pre-answer AI asks general questions without quiz context", () => {
  assert.equal(pageSource.includes("Ask a general question"), true);
  assert.equal(pageSource.includes("The AI will not receive the quiz context yet."), true);
  assert.equal(pageSource.includes("const includeQuestionContext = selectedChoice !== null && mode !== \"general\""), true);
  assert.equal(routeSource.includes("buildGeneralUserMessage"), true);
});

test("initial custom controls disappear after conversation starts", () => {
  assert.equal(pageSource.includes("!hasAiConversation ?"), true);
  assert.equal(pageSource.includes("const hasAiConversation = aiMessages.length > 0"), true);
});

test("AI answers render markdown-style content", () => {
  assert.equal(pageSource.includes("function renderMarkdown"), true);
  assert.equal(pageSource.includes("renderMarkdown(chatMessage.content, theme)"), true);
  assert.equal(pageSource.includes("renderInlineMarkdown"), true);
});

test("manual prompt can be copied", () => {
  assert.equal(pageSource.includes("buildManualPrompt"), true);
  assert.equal(pageSource.includes("navigator.clipboard.writeText(buildManualPrompt())"), true);
  assert.equal(pageSource.includes("Copy prompt"), true);
});

test("copy prompt remains available in active conversation", () => {
  const conversationIndex = pageSource.indexOf("{aiMessages.length ? (");
  const copyIndex = pageSource.indexOf("Copy prompt", conversationIndex);
  const followUpIndex = pageSource.indexOf("Follow-up question", conversationIndex);
  assert.ok(conversationIndex >= 0);
  assert.ok(copyIndex > conversationIndex);
  assert.ok(followUpIndex > copyIndex);
});

test("copy prompt is hidden before an AI conversation starts", () => {
  const initialControlsIndex = pageSource.indexOf("{!hasAiConversation ? (");
  const conversationIndex = pageSource.indexOf("{aiMessages.length ? (");
  const initialControls = pageSource.slice(initialControlsIndex, conversationIndex);
  assert.ok(initialControlsIndex >= 0);
  assert.ok(conversationIndex > initialControlsIndex);
  assert.equal(initialControls.includes("Copy prompt"), false);
});

test("OpenAI visible text extraction supports final response text", () => {
  assert.equal(routeSource.includes("extractOpenAiVisibleText"), true);
  assert.equal(routeSource.includes("data.output_text"), true);
  assert.equal(routeSource.includes("part.output_text"), true);
  assert.equal(routeSource.includes("choice.message.content"), true);
});

test("Gemini visible text extraction supports candidate text parts", () => {
  assert.equal(routeSource.includes("extractGeminiVisibleText"), true);
  assert.equal(routeSource.includes("candidate.content.parts"), true);
  assert.equal(routeSource.includes("part.text"), true);
});

test("empty provider text returns useful provider errors", () => {
  assert.equal(routeSource.includes("OpenAI returned no visible response text"), true);
  assert.equal(routeSource.includes("Gemini returned no visible response text"), true);
});

test("API response parsing excludes raw reasoning and thought fields", () => {
  assert.equal(routeSource.includes("part.type === \"reasoning\""), true);
  assert.equal(routeSource.includes("part.thought === true"), true);
  assert.equal(routeSource.includes("Do not reveal hidden reasoning"), true);
});

test("provider prompt asks for concise 600-token answers", () => {
  assert.equal(routeSource.includes("Aim for about 600 visible tokens"), true);
  assert.equal(routeSource.includes("Finish the answer completely"), true);
  assert.equal(routeSource.includes("MAX_OUTPUT_TOKENS = 1_800"), true);
  assert.equal(routeSource.includes("max_output_tokens: MAX_OUTPUT_TOKENS"), true);
  assert.equal(routeSource.includes("maxOutputTokens: MAX_OUTPUT_TOKENS"), true);
  assert.equal(routeSource.includes("thinkingConfig: { thinkingBudget: 0 }"), true);
});

test("Gemini is the default AI provider", () => {
  assert.equal(pageSource.includes("useState<ModelProvider>(\"gemini\")"), true);
});

test("public header avoids local question count", () => {
  assert.equal(pageSource.includes("MLE certification practice"), true);
  assert.equal(pageSource.includes("questions loaded locally"), false);
});

test("external copy prompt is optimized for accuracy with disclaimer", () => {
  assert.equal(pageSource.includes("optimized to get the most accurate study answer possible"), true);
  assert.equal(pageSource.includes("not to minimize token usage"), true);
});

test("AI help is rendered after votes and before comments once answered", () => {
  const votesIndex = pageSource.indexOf("Community vote distribution");
  const aiIndex = pageSource.indexOf("{renderAiHelpSection()}", votesIndex);
  const commentsIndex = pageSource.indexOf(">Comments</h2>", votesIndex);
  assert.ok(votesIndex >= 0);
  assert.ok(aiIndex > votesIndex);
  assert.ok(commentsIndex > aiIndex);
});

test("question selector submits on Enter and Go matches Pick styling", () => {
  assert.equal(pageSource.includes("onSubmit={(event) =>"), true);
  assert.equal(pageSource.includes("type=\"submit\""), true);
  assert.equal(pageSource.includes("className=\"rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white\" type=\"submit\""), true);
});
