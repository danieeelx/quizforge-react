import fs from 'node:fs';
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const checks = [
  ['split creation tabs', app.includes('Upload PDF') && app.includes('Manual builder') && app.includes('creation-mode-tabs')],
  ['AI panel removed', !app.includes('AI import assistance <span className="feature-unavailable-badge"')],
  ['OCR warning is not permanently rendered', !app.includes('scan-coming-soon')],
  ['collapse all removed', !app.includes('Collapse all')],
  ['optional topic and explanation', app.includes('Add topic or explanation') && app.includes('manual-explanation-input')],
  ['three-dot delete menu', app.includes('Delete question') && app.includes('manual-card-menu')],
  ['sticky manual action bar', app.includes('manual-sticky-action-bar')],
  ['review disabled until ready', app.includes('disabled={readyCount === 0}')],
  ['creation mode persisted', app.includes('mode: createMode')],
  ['no hover glow', css.includes('.manual-question-card,.manual-question-card:hover{transform:none!important;box-shadow:none!important}')],
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('v3.3 smoke test failed:', failed.map(([name]) => name).join(', '));
  process.exit(1);
}
console.log('QuizForge v3.3 UI smoke test passed.');
