const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

export function getAiHealth() {
  return {
    ok: true,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_API_KEY ? MODEL : null,
    features: {
      importAssistance: Boolean(process.env.OPENAI_API_KEY)
    }
  };
}

export async function runAiImportAssistance(body) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("AI import assistance is not configured. Add OPENAI_API_KEY in Vercel Environment Variables.");
    error.statusCode = 503;
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  const title = String(body?.title || "Imported study set").slice(0, 160);
  const sourceText = String(body?.sourceText || "").slice(0, 120000);
  const rawQuestions = Array.isArray(body?.questions) ? body.questions.slice(0, 120) : [];
  if (sourceText.trim().length < 20 && rawQuestions.length === 0) {
    const error = new Error("There is not enough source material for AI import assistance.");
    error.statusCode = 400;
    throw error;
  }

  const questions = rawQuestions.map((question, index) => ({
    clientId: String(question?.clientId || `question-${index + 1}`).slice(0, 120),
    question: String(question?.question || "").slice(0, 3000),
    options: Array.isArray(question?.options) ? question.options.slice(0, 10).map((value) => String(value).slice(0, 1500)) : [],
    correctIndexes: Array.isArray(question?.correctIndexes)
      ? question.correctIndexes.filter((value) => Number.isInteger(value) && value >= 0 && value < 10).slice(0, 8)
      : [],
    selectionMode: question?.selectionMode === "multiple" ? "multiple" : "single",
    explanation: String(question?.explanation || "").slice(0, 3000),
    topic: String(question?.topic || "General").slice(0, 120),
    sourcePage: Number.isInteger(question?.sourcePage) ? question.sourcePage : null,
    importWarnings: Array.isArray(question?.importWarnings) ? question.importWarnings.slice(0, 8).map((value) => String(value).slice(0, 500)) : []
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["questions", "summary", "warnings"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "clientId", "question", "options", "correctIndexes", "selectionMode",
            "explanation", "topic", "sourcePage", "confidence", "changed",
            "changes", "reviewRequired"
          ],
          properties: {
            clientId: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correctIndexes: { type: "array", items: { type: "integer" } },
            selectionMode: { type: "string", enum: ["single", "multiple"] },
            explanation: { type: "string" },
            topic: { type: "string" },
            sourcePage: { anyOf: [{ type: "integer" }, { type: "null" }] },
            confidence: { type: "number" },
            changed: { type: "boolean" },
            changes: { type: "array", items: { type: "string" } },
            reviewRequired: { type: "boolean" }
          }
        }
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["reviewed", "repaired", "lowConfidence", "generated"],
        properties: {
          reviewed: { type: "integer" },
          repaired: { type: "integer" },
          lowConfidence: { type: "integer" },
          generated: { type: "integer" }
        }
      },
      warnings: { type: "array", items: { type: "string" } }
    }
  };

  const modeInstruction = questions.length
    ? `Review every supplied question and return the same questions in the same order. Preserve each clientId exactly. Repair only clear extraction or formatting problems. Do not remove questions. Do not invent an answer when the source does not support one; set reviewRequired=true instead. Keep between 2 and 8 choices unless the source genuinely has more.`
    : `The local parser found no usable question bank. Generate 10 to 20 source-grounded multiple-choice questions from the supplied material. Use clientId values generated-1, generated-2, and so on. Use four choices when practical.`;

  const instructions = `You are QuizForge's AI import assistant. Your job is to convert imperfect PDF extraction into a trustworthy editable question set.

${modeInstruction}

Rules:
- Use only the supplied source material. Never rely on outside facts.
- Repair merged or split question text, repeated choice labels, page-boundary fragments, and obvious duplicated choices.
- Preserve valid wording and answer keys rather than rewriting for style.
- correctIndexes are zero-based indexes into options.
- For "choose two/three" questions, use selectionMode=multiple and include every supported correct index.
- If the source answer is absent, ambiguous, or contradicted, leave correctIndexes empty and set reviewRequired=true.
- Explanations must be brief and source-grounded. Leave explanation empty when unsupported.
- confidence must be from 0 to 1. Values below 0.75 should normally require review.
- changes should be short user-facing notes such as "Separated two merged questions" or "Removed duplicated choice".
- Return JSON matching the provided schema only.`;

  const inputPayload = {
    title,
    questions,
    sourceText
  };

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify(inputPayload)
        }]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "quizforge_import_assistance",
          description: "Repaired and validated QuizForge questions.",
          strict: true,
          schema
        }
      },
      max_output_tokens: 30000,
      store: false
    })
  });

  const payload = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    const error = new Error(payload?.error?.message || "OpenAI import assistance failed.");
    error.statusCode = apiResponse.status;
    throw error;
  }

  const outputText = extractOutputText(payload);
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    const error = new Error("The AI returned an unreadable import result. The local extraction was kept.");
    error.statusCode = 502;
    throw error;
  }

  return { ...parsed, model: MODEL };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const pieces = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") pieces.push(content.text);
      else if (typeof content?.output_text === "string") pieces.push(content.output_text);
    }
  }
  return pieces.join("\n").trim();
}
