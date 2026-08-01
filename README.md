# QuizForge React v2.4

QuizForge is a local-first React and TypeScript study app that turns PDFs, scans, photos, pasted question banks, and notes into editable mock exams.

## Main workflow
1. Upload a PDF/image or paste Questions and Answers in separate sections.
2. QuizForge extracts content, optionally runs OCR, and detects answers.
3. The Import Preview validates the result before it is saved.
4. Search, filter, bulk-edit, verify answers, and organize questions by topic.
5. Build mixed, topic-specific, or weak-area mock exams.
6. Use exam navigation filters and the final review screen before submitting.
7. Review scores, explanations, and topic performance.

## Privacy
- Text-based PDF extraction and question parsing run in the browser.
- OCR runs in the browser, but its OCR engine is loaded from a CDN.
- AI-enhanced generation is optional and sends extracted text only to the configured server endpoint.
- Study sets, drafts, attempts, and exam recovery are stored in browser local storage.

## Run locally
Install Node.js 20 or newer and double-click `START_QUIZFORGE_REACT.bat`, or run:

```bash
npm install --include=dev
npm run build
npm start
```

Open `http://127.0.0.1:4173`.

## Vercel
The included `dist` directory is prebuilt. See `UPDATE_VERCEL.md` for the browser-only GitHub and Vercel update process.
