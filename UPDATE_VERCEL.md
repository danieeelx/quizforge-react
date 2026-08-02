# Update the deployed Vercel site to QuizForge v2.8

1. Extract `quizforge-vercel-update-v2.8.zip`.
2. Open the existing `quizforge-react` GitHub repository.
3. Choose **Add file → Upload files**.
4. Upload everything from inside the extracted update folder.
5. Commit with `Update QuizForge to v2.8`.
6. Wait for Vercel to redeploy.
7. Refresh the live site with `Ctrl + Shift + R`.

Do not delete the repository first. Matching files will be replaced and the new `api` folder will be added.

## Enable AI import assistance

In Vercel:

1. Open the QuizForge project.
2. Go to **Settings → Environment Variables**.
3. Add `OPENAI_API_KEY` with the secret OpenAI API key.
4. Optionally add `OPENAI_MODEL` with `gpt-5-mini`.
5. Apply the variables to Production and Preview.
6. Redeploy the latest deployment.

The AI switch appears only after `/api/health` confirms that the server-side key is configured.


## v3.0
Upload all contents of the v3.0 update folder to the repository root, commit, wait for Vercel, then hard-refresh with Ctrl+Shift+R.
