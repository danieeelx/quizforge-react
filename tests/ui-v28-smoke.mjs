import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

const required = [
  "Practice lifelines",
  "lifelinesEnabled",
  "lifeline-menu-trigger",
  "Save & Home",
  "leaveExamToDashboard",
  "Exam saved — resume it anytime from Home"
];
for (const text of required) {
  if (!app.includes(text)) throw new Error(`Missing v2.8 UI behavior: ${text}`);
}

if (app.includes("function LifelineToggle(")) {
  throw new Error("The old per-lifeline setup toggle component is still present.");
}

for (const selector of [".lifeline-menu", ".exam-home-button", ".new-card", ".local-workspace-note"]) {
  if (!css.includes(selector)) throw new Error(`Missing v2.8 style: ${selector}`);
}

console.log("QuizForge v2.8 UI smoke test passed.");
