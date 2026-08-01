# QuizForge React v2.7

QuizForge turns text-based PDF question banks and manually entered questions into editable mock exams. It uses React and TypeScript in the browser, PDF.js for local PDF text extraction, browser storage for saved study sets, and an optional server-side OpenAI import assistant.

## Main features

- Text-based PDF import and defensive question parsing
- AI-assisted import repair with confidence and review notes
- Per-question manual builder with collapsible question cards
- Import validation and editable answer keys
- Single-answer and multiple-answer questions
- Timed and untimed exams
- Optional 50:50, Audience Poll, Time Freeze, and Clue lifelines
- Question flags, final review, scoring, weak-topic practice, and recovery
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
