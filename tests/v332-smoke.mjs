import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const token of [
  'function getPasteSectionStatus',
  'completionState !== "empty"',
  'aria-live="polite"',
  'QuizForge v3.3.2',
  'align-self:stretch',
  'padding:7px 10px 0 0'
]) {
  if (!app.includes(token) && !css.includes(token)) throw new Error(`Missing v3.3.2 token: ${token}`);
}
console.log('v3.3.2 UI smoke test passed.');
