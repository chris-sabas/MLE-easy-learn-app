import type { ChoiceKey, QuizQuestion } from "./quiz";

export type ProgressResult = "correct" | "incorrect" | "ungraded";

export type ProgressRecord = {
  question_id: number;
  selected_answer: string;
  result: ProgressResult;
  answered_at: string;
};

export type Metrics = {
  total: number;
  answered: number;
  unanswered: number;
  correct: number;
  incorrect: number;
  ungraded: number;
  completionPercentage: number;
  accuracyPercentage: number | null;
  answeredPerDay: Array<{ date: string; count: number }>;
};

export function getProgressResult(question: QuizQuestion, selectedAnswer: ChoiceKey): ProgressResult {
  const voteValues = Object.values(question.voteDistribution).filter((value): value is number => typeof value === "number" && value > 0);
  if (!voteValues.length) return "ungraded";

  const maxVote = Math.max(...voteValues);
  return question.voteDistribution[selectedAnswer] === maxVote ? "correct" : "incorrect";
}

export function getQuestionsInMetricsRange(questions: QuizQuestion[], start: number, end: number) {
  return questions.filter((question) => question.id >= start && question.id <= end);
}

export function calculateMetrics(questions: QuizQuestion[], progress: ProgressRecord[], start: number, end: number, now = new Date()): Metrics {
  const questionsInRange = getQuestionsInMetricsRange(questions, start, end);
  const questionIds = new Set(questionsInRange.map((question) => question.id));
  const progressInRange = progress.filter((record) => questionIds.has(record.question_id));
  const answered = new Set(progressInRange.map((record) => record.question_id)).size;
  const correct = progressInRange.filter((record) => record.result === "correct").length;
  const incorrect = progressInRange.filter((record) => record.result === "incorrect").length;
  const ungraded = progressInRange.filter((record) => record.result === "ungraded").length;
  const graded = correct + incorrect;

  const dayKeys = Array.from({ length: 14 }, (_value, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (13 - index));
    return date.toISOString().slice(0, 10);
  });
  const counts = new Map(dayKeys.map((date) => [date, 0]));
  for (const record of progressInRange) {
    const date = new Date(record.answered_at).toISOString().slice(0, 10);
    if (counts.has(date)) counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return {
    total: questionsInRange.length,
    answered,
    unanswered: questionsInRange.length - answered,
    correct,
    incorrect,
    ungraded,
    completionPercentage: questionsInRange.length ? Math.round((answered / questionsInRange.length) * 100) : 0,
    accuracyPercentage: graded ? Math.round((correct / graded) * 100) : null,
    answeredPerDay: dayKeys.map((date) => ({ date, count: counts.get(date) ?? 0 })),
  };
}
