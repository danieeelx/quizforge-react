/** Helpers for the separate Questions + Answers paste workflow. */
export function questionNumbersFromText(text: string): number[] {
  const found = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.match(/^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*(?:[.)\]:-]|\s)/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]));
  return [...new Set(found)];
}

export function normalizeSeparateAnswers(answerText: string, questionText: string): string {
  const trimmed = answerText.trim();
  if (!trimmed) return "";

  const questionNumbers = questionNumbersFromText(questionText);
  let lines = trimmed
    .replace(/^\s*(?:answer\s*key|answers?)\s*[:=-]?\s*/i, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Support a compact key such as A, B, D, C when its item count matches
  // the number of questions. Keep A, C together for choose-two questions.
  if (lines.length === 1 && !/\d/.test(lines[0])) {
    const compact = lines[0].split(/\s*[,;|]\s*/).filter(Boolean);
    if (compact.length > 1 && (questionNumbers.length === 0 || compact.length === questionNumbers.length)) {
      lines = compact;
    }
  }

  const unnumbered = lines.every((line) => /^(?:[A-H](?:\s*[,/&+]\s*[A-H])*)$/i.test(line));
  if (!unnumbered) return trimmed;

  return lines
    .map((line, index) => `${questionNumbers[index] ?? index + 1}. ${line.toUpperCase()}`)
    .join("\n");
}

export function combinePastedQuestionsAndAnswers(questionText: string, answerText: string): string {
  const normalizedAnswers = normalizeSeparateAnswers(answerText, questionText);
  return [
    questionText.trim(),
    normalizedAnswers ? `Answer Key\n${normalizedAnswers}` : ""
  ].filter(Boolean).join("\n\n");
}
