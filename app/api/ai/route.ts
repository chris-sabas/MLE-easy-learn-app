import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const OPENAI_MODEL = "gpt-5.5";
const GEMINI_MODEL = "gemini-3.5-flash";
const MAX_USER_MESSAGE_LENGTH = 800;
const MAX_HISTORY_MESSAGES = 6;
const MAX_OUTPUT_TOKENS = 1_400;
const GEMINI_THINKING_BUDGET = 512;

type ModelProvider = "openai" | "gemini";
type AiMode = "explain" | "custom" | "followup" | "general";

type AiHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type AiQuestion = {
  id: number;
  question: string;
  choices: Record<string, string>;
  voteDistribution: Record<string, number>;
  arnoutsComment?: string;
  arnoutsAnswer?: string;
  hasImage?: boolean;
};

type AiRequestBody = {
  modelProvider?: ModelProvider;
  mode?: AiMode;
  questionId?: number;
  question?: AiQuestion;
  selectedAnswer?: string | null;
  userMessage?: string;
  history?: AiHistoryMessage[];
};

type AiProviderResult = { text: string } | { error: string };

const SYSTEM_MESSAGE =
  "You are a study assistant for ML/Google Cloud certification-style practice questions. The source is unofficial. Community votes may be incorrect, and Arnout's answer/comment may also need technical verification. Explain the concepts, evaluate the choices, and clearly separate community vote signal, Arnout signal, and your own technical assessment. Aim for about 600 visible tokens, so you are concise but still helpful and explanatory. Finish the answer completely; do not stop mid-choice or mid-sentence. Do not reveal hidden reasoning, chain-of-thought, scratchpad, internal analysis, or thinking process. Provide only the final study explanation. Use concise reasoning summaries when useful.";

function modelIdForProvider(provider: ModelProvider) {
  return provider === "openai" ? OPENAI_MODEL : GEMINI_MODEL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeHistory(value: unknown): AiHistoryMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((message): AiHistoryMessage[] => {
      if (!isRecord(message)) return [];
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return [];
      return [{ role: message.role, content: message.content.slice(0, 2_000) }];
    })
    .slice(-MAX_HISTORY_MESSAGES);
}

function validateQuestion(value: unknown): AiQuestion | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || typeof value.question !== "string" || !isRecord(value.choices)) return null;

  const choices: Record<string, string> = {};
  for (const [key, choice] of Object.entries(value.choices)) {
    if (typeof choice === "string") choices[key] = choice;
  }

  const voteDistribution: Record<string, number> = {};
  if (isRecord(value.voteDistribution)) {
    for (const [key, percent] of Object.entries(value.voteDistribution)) {
      if (typeof percent === "number" && Number.isFinite(percent)) voteDistribution[key] = percent;
    }
  }

  return {
    id: value.id,
    question: value.question,
    choices,
    voteDistribution,
    arnoutsComment: typeof value.arnoutsComment === "string" ? value.arnoutsComment : "",
    arnoutsAnswer: typeof value.arnoutsAnswer === "string" ? value.arnoutsAnswer : "",
    hasImage: typeof value.hasImage === "boolean" ? value.hasImage : undefined,
  };
}

function buildQuestionContext(question: AiQuestion, selectedAnswer?: string | null) {
  return JSON.stringify(
    {
      id: question.id,
      question: question.question,
      choices: question.choices,
      communityVotes: question.voteDistribution,
      arnoutsAnswer: question.arnoutsAnswer || null,
      arnoutsComment: question.arnoutsComment || null,
      selectedAnswer: selectedAnswer ?? null,
      hasImage: question.hasImage ?? false,
      note: "Unofficial study material. Community votes may be wrong. Arnout's answer is the preferred local answer key when provided, but still verify it technically.",
    },
    null,
    2,
  );
}

function buildUserMessage(body: Required<Pick<AiRequestBody, "mode">> & AiRequestBody, question: AiQuestion) {
  if (body.mode === "explain") {
    return `Explain this question. Compare the choices, discuss the community vote signal and Arnout signal separately, and say which answer you think is best based on technical reasoning.\n\nQuestion context:\n${buildQuestionContext(question, body.selectedAnswer)}`;
  }

  return `${body.userMessage}\n\nQuestion context:\n${buildQuestionContext(question, body.selectedAnswer)}`;
}

function buildGeneralUserMessage(userMessage: string) {
  return `You are a study assistant for ML/Google Cloud certification-style practice questions.\n\n${userMessage}`;
}

function textFromContentParts(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .flatMap((part): string[] => {
      if (!isRecord(part)) return [];
      if (part.type === "reasoning" || part.type === "reasoning_summary" || part.type === "tool_call") return [];
      if (typeof part.text === "string") return [part.text];
      if (typeof part.output_text === "string") return [part.output_text];
      return [];
    })
    .join("\n")
    .trim();
}

function extractOpenAiVisibleText(data: unknown): string {
  if (!isRecord(data)) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();

  const responseOutput = Array.isArray(data.output)
    ? data.output.flatMap((item): string[] => {
        if (!isRecord(item) || item.type !== "message") return [];
        const text = textFromContentParts(item.content);
        return text ? [text] : [];
      })
    : [];
  if (responseOutput.length) return responseOutput.join("\n").trim();

  const choices = Array.isArray(data.choices) ? data.choices : [];
  return choices
    .flatMap((choice): string[] => {
      if (!isRecord(choice) || !isRecord(choice.message)) return [];
      const text = textFromContentParts(choice.message.content);
      return text ? [text] : [];
    })
    .join("\n")
    .trim();
}

function extractGeminiVisibleText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.candidates)) return "";
  return data.candidates
    .flatMap((candidate): string[] => {
      if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return [];
      return candidate.content.parts.flatMap((part): string[] => {
        if (!isRecord(part) || part.thought === true || typeof part.text !== "string") return [];
        return [part.text];
      });
    })
    .join("")
    .trim();
}

async function callOpenAi(messages: AiHistoryMessage[]): Promise<AiProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OpenAI provider is not configured. Missing OPENAI_API_KEY." };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_MESSAGE,
      input: messages.map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: MAX_OUTPUT_TOKENS,
    }),
  });

  const data = await response.json();
  if (!response.ok) return { error: `OpenAI request failed (${response.status}). ${data?.error?.message ?? "No visible response text was returned."}` };

  const text = extractOpenAiVisibleText(data);
  if (!text) return { error: `OpenAI returned no visible response text (${response.status}).` };
  return { text };
}

async function callGemini(messages: AiHistoryMessage[]): Promise<AiProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "Gemini provider is not configured. Missing GEMINI_API_KEY." };

  const contents = messages
    .filter((message) => message.role !== "assistant" || message.content.trim())
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_MESSAGE }] },
        contents,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
        },
      }),
    },
  );

  const data = await response.json();
  if (!response.ok) return { error: `Gemini request failed (${response.status}). ${data?.error?.message ?? "No visible response text was returned."}` };

  const text = extractGeminiVisibleText(data);
  if (!text) return { error: `Gemini returned no visible response text (${response.status}).` };
  return { text };
}

async function getCachedExplanation(questionId: number, provider: ModelProvider) {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("ai_explanation_cache")
    .select("explanation")
    .eq("question_id", questionId)
    .eq("model_provider", provider)
    .eq("model_id", modelIdForProvider(provider))
    .maybeSingle();

  if (error || !data || typeof data.explanation !== "string") return null;
  return data.explanation;
}

async function saveCachedExplanation(questionId: number, provider: ModelProvider, explanation: string) {
  const supabase = await createClient();
  if (!supabase) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("ai_explanation_cache").upsert(
    {
      question_id: questionId,
      model_provider: provider,
      model_id: modelIdForProvider(provider),
      explanation,
      created_by: user.id,
    },
    { onConflict: "question_id,model_provider,model_id" },
  );
}

async function saveAskedQuestion(body: AiRequestBody, question: AiQuestion | null, answer: string) {
  if (body.mode !== "custom" && body.mode !== "followup" && body.mode !== "general") return;
  if (body.modelProvider !== "openai" && body.modelProvider !== "gemini") return;
  if (!body.userMessage?.trim()) return;

  const supabase = await createClient();
  if (!supabase) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const historyQuestionId =
    question?.id ??
    (typeof body.questionId === "number" && Number.isInteger(body.questionId) ? body.questionId : null);

  await supabase.from("ai_question_history").insert({
    question_id: historyQuestionId,
    model_provider: body.modelProvider,
    model_id: modelIdForProvider(body.modelProvider),
    mode: body.mode,
    user_message: body.userMessage.trim(),
    answer,
    created_by: user.id,
  });
}

export async function POST(request: Request) {
  let body: AiRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.");
  }

  if (body.modelProvider !== "openai" && body.modelProvider !== "gemini") {
    return jsonError("modelProvider must be openai or gemini.");
  }
  if (body.mode !== "explain" && body.mode !== "custom" && body.mode !== "followup" && body.mode !== "general") {
    return jsonError("mode must be explain, custom, followup, or general.");
  }

  const question = validateQuestion(body.question);
  const needsQuestion = body.mode === "explain" || body.mode === "custom";
  if (needsQuestion && !question) return jsonError("Missing or invalid question.");

  if ((body.mode === "custom" || body.mode === "followup" || body.mode === "general") && !body.userMessage?.trim()) {
    return jsonError("userMessage is required for custom, followup, and general requests.");
  }
  if (body.userMessage && body.userMessage.length > MAX_USER_MESSAGE_LENGTH) {
    return jsonError("userMessage must be 800 characters or fewer.");
  }

  if (body.mode === "explain" && question) {
    const cachedExplanation = await getCachedExplanation(question.id, body.modelProvider);
    if (cachedExplanation) {
      return NextResponse.json({ message: cachedExplanation, cached: true, historyUsed: 0 });
    }
  }

  const history = normalizeHistory(body.history);
  const userMessage =
    question && body.mode !== "general"
      ? buildUserMessage({ ...body, mode: body.mode }, question)
      : buildGeneralUserMessage(body.userMessage ?? "");
  const messages: AiHistoryMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  const result = body.modelProvider === "openai" ? await callOpenAi(messages) : await callGemini(messages);
  if ("error" in result) return jsonError(result.error, result.error.includes("not configured") ? 503 : 502);

  if (body.mode === "explain" && question) {
    await saveCachedExplanation(question.id, body.modelProvider, result.text);
  }
  await saveAskedQuestion(body, question, result.text);

  return NextResponse.json({ message: result.text, cached: false, historyUsed: history.length });
}
