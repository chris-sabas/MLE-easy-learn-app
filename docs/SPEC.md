# Quiz App Specification

## Overview

This project is a small responsive quiz web app for 4-5 friends. Version 1 should stay intentionally minimal: a Next.js app using TypeScript and Tailwind, local JSON question data, browser `localStorage` for progress, and a single server API route for asking AI about the currently selected question.

The app should work well on phones, tablets, and desktop without requiring login, accounts, a database, or multiplayer infrastructure.

## User Stories

1. As a user, I can open the app on my phone, tablet, or desktop so I can answer quiz questions comfortably on any device.
2. As a user, I can select a specific question by number or identifier so I can discuss or revisit a known question.
3. As a user, I can choose a numeric question range and request a random question from that range so the group can play flexibly.
4. As a user, I can select one answer for the current question so the app can evaluate my choice.
5. As a user, I can see whether my selected answer is correct or incorrect so I get immediate feedback.
6. As a user, I can see the document's supplied answer, references, and useful comments so I understand the reasoning and source context.
7. As a user, I can see when community comments disagree with the supplied document answer so disagreement is preserved instead of flattened into one answer.
8. As a user, I can have my progress saved in this browser so I can return later without losing what I have answered.
9. As a user, I can ask an AI about the current question so I can get clarification or a concise explanation.
10. As a maintainer, I can add or edit questions in a local JSON file without changing app code.

## Data Schema

Questions are stored in a local JSON file, for example `data/questions.json`. The exact filename can change during implementation, but the source of truth must be a local JSON file committed with the app.

```ts
type Question = {
  id: string;
  number: number;
  prompt: string;
  choices: AnswerChoice[];
  suppliedAnswer: SuppliedAnswer;
  references: Reference[];
  comments: Comment[];
  tags?: string[];
};

type AnswerChoice = {
  id: string;
  label: string;
  text: string;
};

type SuppliedAnswer = {
  choiceId: string;
  text?: string;
  explanation?: string;
};

type Reference = {
  title: string;
  citation?: string;
  url?: string;
  note?: string;
};

type Comment = {
  id: string;
  author?: string;
  text: string;
  stance: "supports_supplied_answer" | "disagrees_with_supplied_answer" | "neutral_or_context";
  relatedChoiceId?: string;
};

type StoredProgress = {
  answeredByQuestionId: Record<
    string,
    {
      selectedChoiceId: string;
      isCorrect: boolean;
      answeredAt: string;
    }
  >;
  lastQuestionId?: string;
  preferredRange?: {
    start: number;
    end: number;
  };
};
```

### Schema Rules

1. `id` must be stable and unique.
2. `number` must be unique and numeric so users can choose ranges.
3. `choices` must contain at least two options.
4. `suppliedAnswer.choiceId` must match one `choices[].id`.
5. `comments` must preserve disagreement through `stance`; comments that disagree with the supplied answer must not be rewritten as if they support it.
6. `references` may include URLs, citations, short notes, or a mix of these depending on the source document.
7. `localStorage` data is convenience state only and must not be treated as authoritative server data.

## Pages and Components

## Pages

### Main Quiz Page

Route: `/`

Responsibilities:

1. Load questions from the local JSON source.
2. Show controls for choosing a specific question.
3. Show controls for entering a numeric range and selecting a random question within that range.
4. Display the active question, answer options, result feedback, supplied answer, references, comments, and AI ask controls.
5. Read and write progress from `localStorage`.

### API Route

Route: `/api/ask`

Responsibilities:

1. Accept the current question context and a user question.
2. Call an AI provider from the server side.
3. Return a concise answer to the client.
4. Avoid exposing API keys to the browser.
5. Validate the request shape and return helpful errors for invalid input.

## Components

1. `QuestionSelector`
   - Lets the user choose a specific question by number or identifier.

2. `RangeRandomizer`
   - Lets the user enter a start and end question number.
   - Selects a random available question within the inclusive range.
   - Handles empty or invalid ranges with clear inline feedback.

3. `QuestionCard`
   - Displays the active question prompt and answer choices.
   - Keeps layout readable on small screens.

4. `AnswerOptions`
   - Displays choices as a single-select control.
   - Prevents ambiguous multi-answer selection.

5. `ResultPanel`
   - Shows correct or incorrect after submission.
   - Displays the document's supplied answer and explanation.

6. `ReferencesList`
   - Displays supplied references in a compact, readable format.

7. `CommentsPanel`
   - Displays useful comments.
   - Visually distinguishes comments that support, disagree with, or neutrally contextualize the supplied answer.
   - Preserves disagreement without resolving it unless the source data explicitly does so.

8. `ProgressSummary`
   - Shows lightweight local progress such as answered count and current question status.

9. `AskAIBox`
   - Lets the user ask the server API route about the current question.
   - Shows loading, error, and answer states.

## Acceptance Criteria

1. The app is built with Next.js, TypeScript, and Tailwind.
2. The app is usable on phone, tablet, and desktop viewport widths.
3. Questions are loaded from a local JSON file.
4. A user can select a specific question.
5. A user can enter a numeric range and receive a random question from that range.
6. Random selection only chooses questions whose `number` falls within the selected inclusive range.
7. Invalid ranges, empty ranges, or non-numeric inputs are handled without crashing.
8. A user can select exactly one answer for the current question.
9. The app reports whether the selected answer is correct or incorrect.
10. The app displays the document's supplied answer after evaluation.
11. The app displays references associated with the current question.
12. The app displays useful comments associated with the current question.
13. Comments that disagree with the supplied answer remain visible as disagreement.
14. The app stores answered-question progress in browser `localStorage`.
15. Reloading the app restores saved local progress in the same browser.
16. The app includes a server API route for asking AI about the current question.
17. The AI API route does not require login.
18. The AI API route does not write to a database.
19. The app works without any database in version 1.
20. The architecture remains minimal and avoids unnecessary state libraries, backend services, or complex routing.

## Implementation Stages

### Stage 1: Project Foundation

1. Create a Next.js app with TypeScript and Tailwind.
2. Add the local question JSON file.
3. Define TypeScript types for question data and stored progress.
4. Add basic responsive page structure.

### Stage 2: Question Navigation

1. Load and validate local questions.
2. Implement specific question selection.
3. Implement numeric range inputs.
4. Implement random question selection within a valid range.

### Stage 3: Answer Flow

1. Implement single-answer selection.
2. Compare selected answer against the supplied answer.
3. Display correct or incorrect feedback.
4. Display supplied answer details after selection.

### Stage 4: Supporting Context

1. Display references for the current question.
2. Display comments for the current question.
3. Clearly preserve support, disagreement, and neutral context in comments.

### Stage 5: Local Progress

1. Persist answered questions to `localStorage`.
2. Restore progress on page load.
3. Show a lightweight progress summary.
4. Store the last active question and preferred range if useful.

### Stage 6: AI API Route

1. Add `/api/ask`.
2. Validate request payloads.
3. Send current question context and the user's question to the AI provider.
4. Return the AI response to the client.
5. Handle loading and error states in the UI.

### Stage 7: Polish and Verification

1. Test phone, tablet, and desktop layouts.
2. Test localStorage restore behavior.
3. Test invalid question numbers and invalid ranges.
4. Test questions with supporting, disagreeing, and neutral comments.
5. Confirm no login or database dependency exists.

## Explicit Out-of-Scope Features

1. User accounts, login, authentication, or authorization.
2. Database storage.
3. Real-time multiplayer.
4. Shared group sessions across devices.
5. Admin CMS for editing questions.
6. Remote question fetching.
7. Scoreboards shared between users.
8. Payment, subscriptions, or billing.
9. Complex analytics.
10. Question import UI.
11. Full-text search across all questions.
12. Multiple simultaneous selected answers.
13. Native mobile apps.
14. Offline-first service worker behavior.
15. AI-generated grading that overrides the supplied answer.
16. Automatic reconciliation of disagreement between document answers and community comments.
