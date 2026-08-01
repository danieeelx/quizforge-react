export type QuestionStatus = "verified" | "review";

export interface AnswerOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  question: string;
  options: AnswerOption[];
  correctOptionId: string | null;
  explanation: string;
  status: QuestionStatus;
  sourcePage?: number;
}

export interface Attempt {
  id: string;
  date: string;
  score: number;
  correct: number;
  total: number;
  durationSeconds: number;
}

export interface StudySet {
  id: string;
  title: string;
  sourceName: string;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
  attempts: Attempt[];
}

export interface ExamQuestion extends Omit<Question, "options"> {
  options: Array<AnswerOption & { originalId: string }>;
}

export interface ExamSettings {
  questionCount: number;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  timed: boolean;
  minutes: number;
  showExplanations: boolean;
}

export interface ExamSession {
  questions: ExamQuestion[];
  responses: Record<string, string>;
  flagged: Record<string, boolean>;
  currentIndex: number;
  startedAt: number;
  remainingSeconds: number;
  submittedAt?: number;
}
