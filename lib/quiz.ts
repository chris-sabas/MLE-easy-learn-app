export type ChoiceKey = "A" | "B" | "C" | "D" | "E" | "F";

export interface QuizComment {
  author: string;
  text: string;
  votes: number;
}

export interface QuizQuestion {
  id: number;
  question: string;
  choices: Partial<Record<ChoiceKey, string>>;
  voteDistribution: Partial<Record<ChoiceKey, number>>;
  comments: QuizComment[];
  sourcePages?: number[];
  hasImage?: boolean;
}

const CHOICE_KEYS: ChoiceKey[] = ["A", "B", "C", "D", "E", "F"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChoiceKey(value: string): value is ChoiceKey {
  return CHOICE_KEYS.includes(value as ChoiceKey);
}

function normalizeChoices(value: unknown, id: number): Partial<Record<ChoiceKey, string>> {
  if (!isRecord(value)) {
    throw new Error(`Question ${id} has invalid choices.`);
  }

  const choices: Partial<Record<ChoiceKey, string>> = {};
  for (const [key, choice] of Object.entries(value)) {
    if (isChoiceKey(key) && typeof choice === "string" && choice.trim()) {
      choices[key] = choice;
    }
  }

  if (Object.keys(choices).length === 0) {
    throw new Error(`Question ${id} must include at least one answer choice.`);
  }

  return choices;
}

function normalizeVoteDistribution(value: unknown): Partial<Record<ChoiceKey, number>> {
  if (!isRecord(value)) return {};

  const distribution: Partial<Record<ChoiceKey, number>> = {};
  for (const [key, percent] of Object.entries(value)) {
    if (isChoiceKey(key) && typeof percent === "number" && Number.isFinite(percent)) {
      distribution[key] = percent;
    }
  }

  return distribution;
}

function normalizeComments(value: unknown): QuizComment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((comment): QuizComment[] => {
    if (!isRecord(comment)) return [];
    const { author, text, votes } = comment;
    if (typeof author !== "string" || typeof text !== "string") return [];
    return [
      {
        author,
        text,
        votes: typeof votes === "number" && Number.isFinite(votes) ? votes : 0,
      },
    ];
  });
}

function normalizeSourcePages(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pages = value.filter((page): page is number => Number.isInteger(page) && page > 0);
  return pages.length ? [...new Set(pages)].sort((a, b) => a - b) : undefined;
}

export function normalizeQuestions(value: unknown): QuizQuestion[] {
  if (!Array.isArray(value)) {
    throw new Error("app/data/questions.json must export an array of questions.");
  }

  const seen = new Set<number>();
  const questions = value.map((item, index): QuizQuestion => {
    if (!isRecord(item)) {
      throw new Error(`Question record at index ${index} is invalid.`);
    }
    const id = item.id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new Error(`Question record at index ${index} has an invalid id.`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate question id found: ${id}`);
    }
    seen.add(id);
    if (typeof item.question !== "string" || !item.question.trim()) {
      throw new Error(`Question ${id} must include question text.`);
    }

    return {
      id,
      question: item.question,
      choices: normalizeChoices(item.choices, id),
      voteDistribution: normalizeVoteDistribution(item.voteDistribution),
      comments: normalizeComments(item.comments),
      sourcePages: normalizeSourcePages(item.sourcePages),
      hasImage: typeof item.hasImage === "boolean" ? item.hasImage : undefined,
    };
  });

  return questions.sort((a, b) => a.id - b.id);
}

export function findQuestionById(questions: QuizQuestion[], id: number): QuizQuestion | undefined {
  return questions.find((question) => question.id === id);
}

export function questionsInRange(questions: QuizQuestion[], min: number, max: number): QuizQuestion[] {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return questions.filter((question) => question.id >= low && question.id <= high);
}

export function choiceEntries(question: QuizQuestion): Array<[ChoiceKey, string]> {
  return CHOICE_KEYS.flatMap((key): Array<[ChoiceKey, string]> => {
    const text = question.choices[key];
    return text ? [[key, text]] : [];
  });
}

export function votePercentForChoice(question: QuizQuestion, choice: ChoiceKey): number {
  return question.voteDistribution[choice] ?? 0;
}

export function positiveVoteEntries(question: QuizQuestion): Array<[ChoiceKey, number]> {
  return CHOICE_KEYS.flatMap((key): Array<[ChoiceKey, number]> => {
    const percent = question.voteDistribution[key];
    return typeof percent === "number" && percent > 0 ? [[key, percent]] : [];
  }).sort((a, b) => b[1] - a[1]);
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function shouldShowCommunityData(selectedChoice: ChoiceKey | null): boolean {
  return selectedChoice !== null;
}
