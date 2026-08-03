import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const token of [
  'restored-draft-banner',
  'width:min(100%,720px)',
  'justify-content:center',
  'min-height:58px',
]) {
  if (!app.includes(token) && !css.includes(token)) {
    throw new Error(`Missing v3.3.1 UI token: ${token}`);
  }
}
console.log('v3.3.1 UI smoke test passed.');
