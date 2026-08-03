import type { ExamRecovery, StudySet, UploadDraft } from "../types.js";

const STORAGE_KEY = "quizforge.react.studySets.v2";
const THEME_KEY = "quizforge.react.theme";
const UPLOAD_DRAFT_KEY = "quizforge.react.uploadDraft.v2";
const EXAM_RECOVERY_KEY = "quizforge.react.examRecovery.v2";

export function loadStudySets(): StudySet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StudySet[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStudySets(sets: StudySet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}

export function loadTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(theme: "light" | "dark"): void {
  localStorage.setItem(THEME_KEY, theme);
}

export function loadUploadDraft(): UploadDraft | null {
  try {
    const value = localStorage.getItem(UPLOAD_DRAFT_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as UploadDraft;
    if (!parsed || !Array.isArray(parsed.pasteSections)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveUploadDraft(draft: UploadDraft): void {
  localStorage.setItem(UPLOAD_DRAFT_KEY, JSON.stringify(draft));
}

export function clearUploadDraft(): void {
  localStorage.removeItem(UPLOAD_DRAFT_KEY);
}

export function loadExamRecovery(): ExamRecovery | null {
  try {
    const value = localStorage.getItem(EXAM_RECOVERY_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as ExamRecovery;
    if (!parsed?.activeSetId || !parsed.exam?.questions?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveExamRecovery(recovery: ExamRecovery): void {
  localStorage.setItem(EXAM_RECOVERY_KEY, JSON.stringify(recovery));
}

export function clearExamRecovery(): void {
  localStorage.removeItem(EXAM_RECOVERY_KEY);
}
