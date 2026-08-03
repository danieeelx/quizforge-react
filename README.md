# QuizForge React v3.3

QuizForge turns text-based PDF question banks and manually entered questions into editable mock exams. It uses React and TypeScript, PDF.js for local PDF text extraction, and browser storage for saved study sets and exam recovery.

## Main features

- Separate PDF import and manual question-builder workflows
- Defensive PDF question parsing and import validation
- Collapsible per-question manual builder with optional topic and explanation
- Single-answer and multiple-answer questions
- Timed and untimed exams, lifelines, confidence marking, and keyboard shortcuts
- Source-page viewing for supported PDF imports
- Results filters, weak-topic practice, backup, CSV/JSON export, and recovery
- Light and dark mode

AI Import Assistance is currently hidden from the creation screen. Local PDF extraction remains available. Image-only scanned PDFs display an OCR limitation only after they are detected.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run build`.
4. Run `npm start`.
5. Open `http://127.0.0.1:4173`.

The prebuilt `dist` directory can be deployed directly as a static site.

## Vercel

Use the included `UPDATE_VERCEL.md` instructions. Existing study sets and browser data are preserved when updating the deployed files.
