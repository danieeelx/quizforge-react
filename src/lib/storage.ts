import type { StudySet } from "../types.js";

const STORAGE_KEY = "quizforge.react.studySets.v2";
const THEME_KEY = "quizforge.react.theme";

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
