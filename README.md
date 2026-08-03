# QuizForge React v3.2.1

QuizForge turns text-based PDF question banks and manually entered questions into editable mock exams. It uses React and TypeScript in the browser, PDF.js for local PDF text extraction, browser storage for saved study sets, and an optional server-side OpenAI import assistant.

## Main features

- Text-based PDF import and defensive question parsing
- AI-assisted import repair with confidence and review notes
- Per-question manual builder with collapsible question cards
- Import validation and editable answer keys
- Single-answer and multiple-answer questions
- Timed and untimed exams
- One master lifeline toggle with a compact in-exam menu for 50:50, Audience Poll, Time Freeze, and Clue
- Save-and-exit navigation, question flags, final review, scoring, weak-topic practice, and recovery
- Light and dark mode

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` only when enabling AI.
4. Run `npm run build`.
5. Run `npm start`.
6. Open `http://127.0.0.1:4173`.

The prebuilt `dist` folder can run without installing dependencies when served by a static host. The local Node server is required for local AI assistance.

## Enable AI import assistance

Set these server-side environment variables:

```text
OPENAI_API_KEY=your_secret_api_key
OPENAI_MODEL=gpt-5-mini
```

Never put the API key in React source files, `dist`, or GitHub. When AI is configured, the Create Study Set page displays an **AI import assistance** switch. When enabled, extracted source text and the local parser result are sent to the server endpoint for review.

## Vercel

The repository contains prebuilt static files in `dist` and serverless functions in `api`. Keep the existing Vercel settings:

```text
Framework Preset: Other
Build Command: echo "Using prebuilt dist"
Output Directory: dist
Install Command: echo "No install needed"
```

Then add `OPENAI_API_KEY` in Vercel Project Settings → Environment Variables and redeploy.

## Limits

- Scanned-image PDF OCR is not bundled in this version.
- AI can make mistakes. Low-confidence or unsupported answers remain marked for manual review.
- AI requests use the API account connected to your server key and may incur usage charges.

## v3.0 interface update

- Uses the Oxanium gaming-style typeface with uppercase UI text.
- Uses one consistently centered custom dropdown chevron across the app.
- Removes highlighted styling from Lifelines controls.
- Adds Select all and Deselect all controls for large manual question sets.
- Improves alignment in the review editor and exam setup.

## v3.0.1 results fix

The answer-review screen now shows the correct answer for every question, including questions answered correctly. The user's selected answer is shown separately.



## v3.2.1 maintenance update

- AI Import Assistance is shown as unavailable and cannot be enabled.
- Local PDF parsing and manual study-set creation remain available.
- The manual-builder trash action has increased clearance from the divider and card edge on desktop and mobile.
- Restored drafts cannot silently re-enable AI requests.

## v3.2 study experience update

- Dual-font interface: Oxanium for UI and Inter for readable study content.
- Consistent spacing and control sizing across editor, setup, exam, and results.
- Visible autosave and offline-local-save status.
- Keyboard shortcuts during exams.
- Source-page text viewer for newly imported PDFs.
- Confidence marking: Confident, Unsure, and Guessed.
- Full-library backup/restore plus study-set JSON and CSV export.
- Rich answer-review filters and targeted retake actions.
