import fs from "node:fs";

const app = fs.readFileSync(new URL("../dist/App.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../dist/styles.css", import.meta.url), "utf8");

for (const required of [
  "AI import assistance",
  "Unavailable for now",
  'checked: false, disabled: true',
  "Local PDF extraction remains available"
]) {
  if (!app.includes(required)) throw new Error(`Missing compiled AI-disabled marker: ${required}`);
}

for (const required of [
  ".ai-import-disabled",
  ".feature-unavailable-badge",
  ".accordion-head .remove-section-button",
  "padding:7px 14px 17px 0",
  "margin:13px 0 0"
]) {
  if (!css.includes(required)) throw new Error(`Missing compiled v3.2.1 CSS marker: ${required}`);
}

console.log("QuizForge v3.2.1 smoke test passed.");
