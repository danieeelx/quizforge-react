# QuizForge React

QuizForge is a local-first React + TypeScript web app that turns text-based PDFs, pasted reviewers, question banks, and notes into editable mock exams.

## What works

- Modern React UI matching the interactive mockup
- PDF drag-and-drop and browser-based PDF.js text extraction
- Recognition of numbered questions, A–H choices, inline answers, and answer keys
- Optional AI-enhanced generation from ordinary notes
- Review and correction screen before testing
- Add, duplicate, edit, and delete questions or answer choices
- Shuffled questions and shuffled choices
- Timed or untimed mock exams
- Question navigator and flags
- Automatic scoring, explanations, answer review, and retake-incorrect mode
- Study-set library, attempt history, score summary, light/dark mode
- Browser localStorage; no account or database is required

## Run on Windows

1. Extract the ZIP.
2. Install Node.js 20 or newer if it is not already installed.
3. Double-click `START_QUIZFORGE_REACT.bat`.
4. The app opens at `http://127.0.0.1:4173`.

A prebuilt `dist` folder is included, so normal use does not require `npm install`. The prebuilt no-install version needs an internet connection when opening the interface because React, icons, and PDF.js are loaded from pinned browser CDN modules. Your uploaded PDF and study history remain in your browser unless optional AI mode is enabled.

## Development

Install the declared React, PDF.js, icon, and TypeScript packages:

```bash
npm install
npm run dev
```

Create a fresh build with:

```bash
npm run build
npm start
```

## Optional AI-enhanced generation

Local mode works without an API key when the PDF contains questions and answers. To generate stronger questions from ordinary notes:

1. Copy `.env.example` to `.env`.
2. Add your server API key and a supported model.
3. Restart the app.

The key stays in the Node.js server and is never placed in the browser bundle.

## Accuracy and limitations

- Correct answers are most reliable when the PDF includes an answer key or an `Answer:` line.
- AI-generated or locally inferred answers can be wrong, so the review screen is mandatory by design.
- Scanned/image-only PDFs require OCR and are not supported in this version.
- Complex multi-column PDFs may extract text in an imperfect order.
- Uploaded PDF files are not saved. Only extracted questions, edits, and score history are stored locally in the browser.
