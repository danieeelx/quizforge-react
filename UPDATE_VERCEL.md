# Update the existing Vercel deployment

The current Vercel project serves the prebuilt `dist` folder.

1. Extract `quizforge-vercel-update-v2.4.zip`.
2. Open the existing `quizforge-react` repository on GitHub.
3. Choose **Add file → Upload files**.
4. Upload everything from inside the extracted update folder.
5. Commit the files with `Update QuizForge to v2.4`.
6. Wait for Vercel to redeploy.
7. Refresh the live website with **Ctrl + Shift + R**.

Do not delete the repository first. Files with matching names are replaced by the update.

Recommended Vercel settings remain:
- Framework preset: Other
- Build command: `echo "Using prebuilt dist"`
- Output directory: `dist`
- Install command: `echo "No install needed"`

OCR loads its browser engine from jsDelivr when it is first needed, so scanned-document OCR requires an internet connection. Text-based PDF extraction remains local in the browser.
