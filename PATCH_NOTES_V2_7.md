# QuizForge v2.7 — AI Import Assistant and Exam Lifelines

## AI import assistance

- Adds a server-side `/api/ai-import` endpoint for Vercel and the local Node server.
- Reviews locally extracted questions before they reach Import Preview.
- Repairs clear PDF formatting problems such as merged text, repeated choices, and page-boundary fragments.
- Preserves supported answers and leaves uncertain answers marked for review instead of guessing.
- Adds per-question AI confidence, repair notes, and a source-level summary.
- Falls back to the local parser if the AI endpoint fails, times out, or is not configured.
- Keeps the OpenAI API key on the server. It is never included in the React bundle.

## Optional exam lifelines

Every lifeline has its own on/off switch in Exam Setup and can be used once per attempt:

- **50:50** — removes incorrect choices until two remain. Single-answer questions only.
- **Audience Poll** — displays a simulated vote beside the remaining choices. Single-answer questions only.
- **Time Freeze** — pauses a timed exam for 60 seconds.
- **Clue** — displays the saved explanation, source page, or topic hint.

Lifeline usage is saved in exam recovery, so refreshing the page does not restore a used lifeline.

## Verification

- TypeScript check passed.
- Production build passed.
- Parser smoke test passed.
- AI import response-contract test passed with a mocked OpenAI response.
- Vercel health-function test passed.
