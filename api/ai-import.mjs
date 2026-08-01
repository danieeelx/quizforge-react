import { runAiImportAssistance } from "./_shared.mjs";

export const config = { maxDuration: 60 };

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
    const result = await runAiImportAssistance(body);
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json(result);
  } catch (error) {
    return response.status(error?.statusCode || 500).json({
      code: error?.code,
      error: error?.message || "AI import assistance failed."
    });
  }
}
