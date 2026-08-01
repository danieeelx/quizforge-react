export type QuestionStatus = "verified" | "review";
export type SelectionMode = "single" | "multiple";

export interface AnswerOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  question: string;
  options: AnswerOption[];
  /** Legacy single-answer field retained for older saved study sets. */
  correctOptionId: string | null;
  /** Supports questions such as “Choose two” and “Choose three.” */
  correctOptionIds?: string[];
  selectionMode?: SelectionMode;
  explanation: string;
  status: QuestionStatus;
  sourcePage?: number;
  topic?: string;
  importWarnings?: string[];
}

export interface AttemptQuestionResult {
  questionId: string;
  topic: string;
  correct: boolean;
}

export interface Attempt {
  id: string;
  date: string;
  score: number;
  correct: number;
  total: number;
  durationSeconds: number;
  results?: AttemptQuestionResult[];
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
  topicFilter?: string;
  weakAreasOnly?: boolean;
}

export interface ExamSession {
  questions: ExamQuestion[];
  responses: Record<string, string[]>;
  flagged: Record<string, boolean>;
  currentIndex: number;
  startedAt: number;
  remainingSeconds: number;
  submittedAt?: number;
}

export interface PasteSectionDraft {
  id: string;
  title: string;
  questions: string;
  answers: string;
}

export interface UploadDraft {
  title: string;
  pasteSections: PasteSectionDraft[];
  aiEnhanced: boolean;
  ocrEnabled: boolean;
  savedAt: string;
  fileName?: string;
}

export interface ExamRecovery {
  activeSetId: string;
  exam: ExamSession;
  settings: ExamSettings;
  savedAt: string;
}

export interface TopicPerformance {
  topic: string;
  attempts: number;
  correct: number;
  total: number;
  accuracy: number;
}
