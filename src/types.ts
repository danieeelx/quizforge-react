export type QuestionStatus = "verified" | "review";
export type SelectionMode = "single" | "multiple";
export type ConfidenceLevel = "confident" | "unsure" | "guessed";

export interface SourcePage {
  page: number;
  text: string;
}

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
  aiConfidence?: number;
  aiChanged?: boolean;
  aiNotes?: string[];
}

export interface AttemptQuestionResult {
  questionId: string;
  topic: string;
  correct: boolean;
  confidence?: ConfidenceLevel;
  flagged?: boolean;
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
  /** Extracted text grouped by original PDF page for source review. */
  sourcePages?: SourcePage[];
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
  /** Master switch for all practice lifelines. Legacy per-lifeline fields remain for saved-setting compatibility. */
  lifelinesEnabled?: boolean;
  lifelineFiftyFifty?: boolean;
  lifelineAudiencePoll?: boolean;
  lifelineTimeFreeze?: boolean;
  lifelineClue?: boolean;
}

export interface AudiencePollResult {
  [optionId: string]: number;
}

export interface LifelineState {
  fiftyFiftyUsed: boolean;
  audiencePollUsed: boolean;
  timeFreezeUsed: boolean;
  clueUsed: boolean;
  removedOptionIds: Record<string, string[]>;
  audiencePolls: Record<string, AudiencePollResult>;
  clues: Record<string, string>;
  timerFrozenUntil?: number;
}

export interface ExamSession {
  questions: ExamQuestion[];
  responses: Record<string, string[]>;
  flagged: Record<string, boolean>;
  confidence: Record<string, ConfidenceLevel>;
  currentIndex: number;
  startedAt: number;
  remainingSeconds: number;
  lifelines?: LifelineState;
  submittedAt?: number;
}

export interface PasteAnswerDraft {
  id: string;
  text: string;
  correct: boolean;
}

export interface PasteSectionDraft {
  id: string;
  title: string;
  topic: string;
  explanation?: string;
  question: string;
  answers: PasteAnswerDraft[];
  selectionMode: SelectionMode;
  activeTab: "question" | "answers";
  expanded?: boolean;
  /** Legacy v2.2-v2.4 field retained so old browser drafts can be migrated. */
  questions?: string;
}

export interface UploadDraft {
  title: string;
  mode?: "pdf" | "manual";
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
