import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");

const expectations = [
  [app.includes("function AutosaveBadge"), "autosave badge"],
  [app.includes("function SourcePageViewer"), "source page viewer"],
  [app.includes("Keyboard shortcuts"), "keyboard shortcuts"],
  [app.includes("How sure are you?"), "confidence control"],
  [app.includes("Backup library"), "library backup"],
  [app.includes("Retake guessed"), "targeted retake"],
  [app.includes('"no-explanation"'), "results filters"],
  [types.includes('ConfidenceLevel = "confident" | "unsure" | "guessed"'), "confidence type"],
  [types.includes("sourcePages?: SourcePage[]"), "source pages storage"],
  [css.includes("--font-reading"), "dual font CSS"],
  [css.includes("--control-height:48px"), "control spacing system"]
];

for (const [ok, name] of expectations) {
  if (!ok) throw new Error(`Missing v3.1 feature: ${name}`);
}
console.log("QuizForge v3.1 smoke test passed.");
