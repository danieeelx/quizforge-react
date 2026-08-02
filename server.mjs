import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAiHealth, runAiImportAssistance } from "./api/_shared.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "dist");
loadLocalEnv(path.join(rootDir, ".env"));

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const model = process.env.OPENAI_MODEL || "gpt-5-mini";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

if (!existsSync(path.join(publicDir, "index.html"))) {
  console.error("The dist folder is missing. Run npm install and npm run build first.");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, 200, getAiHealth());
    }

    if (url.pathname === "/api/generate") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
      return handleGenerate(request, response);
    }

    if (url.pathname === "/api/ai-import") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
      const body = await readJsonBody(request, 3_500_000);
      const result = await runAiImportAssistance(body);
      return sendJson(response, 200, result);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed" });
    }
    return serveStatic(url.pathname, request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, error?.statusCode || 500, { error: error?.message || "Unexpected server error" });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`\nQuizForge React is running at http://${host}:${port}`);
  console.log(process.env.OPENAI_API_KEY
    ? `AI import assistance is enabled with ${model}.\n`
    : "AI import assistance is not configured. Local PDF and answer-key extraction still works.\n");
});

async function handleGenerate(request, response) {
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(response, 503, {
      code: "AI_NOT_CONFIGURED",
      error: "Set OPENAI_API_KEY in .env to enable AI-enhanced generation."
    });
  }

  const body = await readJsonBody(request, 1_500_000);
  const text = String(body.text || "").trim();
  const title = String(body.title || "Uploaded study material").slice(0, 150);
  if (text.length < 40) return sendJson(response, 400, { error: "Not enough text to generate questions." });

  const instructions = `Create accurate study questions using only the supplied source material. Return JSON only, with no markdown.

Required JSON shape:
{"questions":[{"question":"clear question","options":["A","B","C","D"],"correctIndex":0,"explanation":"brief source-grounded explanation"}]}

Rules:
- Create 10 to 30 questions depending on the material length.
- Use exactly four plausible options whenever possible.
- Preserve correct answers when the source already contains a question bank.
- Never add facts not supported by the supplied material.
- Avoid duplicates, trick questions, and vague wording.
- correctIndex must be an integer from 0 to 3.`;

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input: `Study set title: ${title}\n\nSOURCE MATERIAL:\n${text.slice(0, 120000)}`,
      max_output_tokens: 12000
    })
  });

  const payload = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    console.error("OpenAI API error:", payload);
    return sendJson(response, apiResponse.status, { error: payload?.error?.message || "AI generation failed." });
  }

  const outputText = extractOutputText(payload);
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(outputText));
  } catch {
    return sendJson(response, 502, { error: "The AI returned an unreadable question set. Try again." });
  }

  const questions = Array.isArray(parsed.questions) ? parsed.questions.filter(validQuestion).slice(0, 50) : [];
  if (!questions.length) return sendJson(response, 502, { error: "The AI did not return usable questions." });
  return sendJson(response, 200, { questions, model });
}

function validQuestion(question) {
  return question
    && typeof question.question === "string"
    && question.question.trim().length >= 3
    && Array.isArray(question.options)
    && question.options.length >= 2
    && Number.isInteger(question.correctIndex)
    && question.correctIndex >= 0
    && question.correctIndex < question.options.length;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const pieces = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") pieces.push(content.text);
      else if (typeof content.output_text === "string") pieces.push(content.output_text);
    }
  }
  return pieces.join("\n");
}

function stripJsonFence(value) {
  return String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function serveStatic(requestPath, request, response) {
  const decoded = decodeURIComponent(requestPath);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = path.resolve(publicDir, relative);
  const publicRoot = path.resolve(publicDir);
  if (!candidate.startsWith(`${publicRoot}${path.sep}`) && candidate !== path.join(publicRoot, "index.html")) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  let target = candidate;
  try {
    const details = await stat(target);
    if (details.isDirectory()) target = path.join(target, "index.html");
  } catch {
    target = path.join(publicDir, "index.html");
  }

  const data = await readFile(target);
  const extension = path.extname(target).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' https://esm.sh https://cdn.jsdelivr.net; connect-src 'self' https://esm.sh https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self' blob: https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com; base-uri 'self'; frame-ancestors 'none'"
  });
  if (request.method === "HEAD") return response.end();
  response.end(data);
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request too large"), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
