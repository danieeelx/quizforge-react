import type { Question } from "../types.js";
import { normalizeText, shuffle, uid } from "./utils.js";

interface WorkingOption {
  label: string;
  text: string;
  correct: boolean;
}

interface WorkingQuestion {
  number: number;
  question: string;
  options: WorkingOption[];
  answerTokens: string[];
  explanation: string;
  sourcePage?: number;
}

export interface ParseDiagnostics {
  questions: Question[];
  detectedQuestionNumbers: number[];
  highestQuestionNumber: number;
  verifiedAnswers: number;
  suspiciousQuestions: number;
  warnings: string[];
}

const QUESTION_START = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*(?:[.)\]:-]\s*|\s+)(.{3,})$/i;
const EXPLICIT_QUESTION = /^(?:q|question)\s*[:.-]\s*(.{3,})$/i;
const OPTION_START = /^(?:\[\[CORRECT\]\]\s*)?([A-H])\s*[).:-]\s*(.{1,})$/i;
const CORRECT_OPTION_START = /^(?:correct\s*[-:]\s*|\[\[CORRECT\]\]\s*)([A-H])\s*[).:-]\s*(.{1,})$/i;
const ANSWER_LINE = /^(?:correct\s+answers?|answers?|ans)\s*[:=-]\s*(.+)$/i;
const EXPLANATION_LINE = /^(?:explanation|rationale|reason)\s*[:=-]\s*(.+)$/i;
const PAGE_MARKER = /^\[\[PAGE\s+(\d+)\]\]$/i;

/**
 * Parse a question bank while returning diagnostics that can be shown to users.
 * The parser is intentionally defensive because PDF text extraction often removes
 * spaces, wraps answer choices, or places a question at the bottom of one page and
 * its answers on the next page.
 */
export function parseQuestionBankDetailed(rawText: string): ParseDiagnostics {
  const lines = prepareLines(rawText);
  const answerKey = extractAnswerKey(lines);
  const questions: Question[] = [];
  const detectedQuestionNumbers: number[] = [];
  const warnings: string[] = [];
  let current: WorkingQuestion | null = null;
  let currentPage: number | undefined;
  let inAnswerKey = false;

  const flush = () => {
    if (!current || current.question.trim().length < 3) {
      current = null;
      return;
    }

    // A real multiple-choice item rarely has more than A-H. Keeping this guard
    // prevents a missed question boundary from becoming one A-U mega-question.
    const safeOptions = current.options.slice(0, 8);
    const optionObjects = safeOptions
      .map((option) => ({ id: uid(), text: option.text.trim() }))
      .filter((option) => option.text.length > 0);

    const explicitTokens = uniqueTokens([
      ...current.answerTokens,
      ...(answerKey.get(current.number) ?? []),
      ...safeOptions.filter((option) => option.correct).map((option) => option.label)
    ]);

    const correctOptionIds = explicitTokens
      .map((token) => tokenToOptionId(token, safeOptions, optionObjects))
      .filter((id): id is string => Boolean(id));

    const uniqueCorrectIds = [...new Set(correctOptionIds)];
    const isMultiple = uniqueCorrectIds.length > 1 || chooseCount(current.question) > 1;

    if (optionObjects.length >= 2) {
      questions.push({
        id: uid(),
        question: current.question.trim(),
        options: optionObjects,
        correctOptionId: uniqueCorrectIds[0] ?? null,
        correctOptionIds: uniqueCorrectIds,
        selectionMode: isMultiple ? "multiple" : "single",
        explanation: current.explanation.trim(),
        status: uniqueCorrectIds.length ? "verified" : "review",
        sourcePage: current.sourcePage
      });
    }

    if (current.options.length > 8) {
      warnings.push(`Question ${current.number} contained more than eight answer choices and was trimmed for review.`);
    }
    current = null;
  };

  for (const originalLine of lines) {
    const pageMatch = originalLine.match(PAGE_MARKER);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      continue;
    }

    const line = originalLine.trim();
    if (!line || isNoiseLine(line)) continue;

    if (/^(?:answer\s*key|answers?)\s*[:=-]?$/i.test(line)) {
      flush();
      inAnswerKey = true;
      continue;
    }
    if (inAnswerKey && looksLikeAnswerKeyLine(line)) continue;

    const numberedQuestion = matchQuestionStart(line);
    const explicitQuestion = line.match(EXPLICIT_QUESTION);
    const correctOption = line.match(CORRECT_OPTION_START);
    const option = line.match(OPTION_START);
    const answer = line.match(ANSWER_LINE);
    const explanation = line.match(EXPLANATION_LINE);

    if (numberedQuestion) {
      flush();
      const number = Number(numberedQuestion[1]);
      detectedQuestionNumbers.push(number);
      current = {
        number,
        question: numberedQuestion[2].trim(),
        options: [],
        answerTokens: [],
        explanation: "",
        sourcePage: currentPage
      };
      inAnswerKey = false;
      continue;
    }

    if (explicitQuestion) {
      flush();
      const number = detectedQuestionNumbers.length
        ? Math.max(...detectedQuestionNumbers) + 1
        : questions.length + 1;
      detectedQuestionNumbers.push(number);
      current = {
        number,
        question: explicitQuestion[1].trim(),
        options: [],
        answerTokens: [],
        explanation: "",
        sourcePage: currentPage
      };
      continue;
    }

    if ((correctOption || option) && current) {
      const match = correctOption ?? option!;
      const label = match[1].toUpperCase();
      const optionText = match[2].trim();
      const markedCorrect = Boolean(correctOption) || /^\[\[CORRECT\]\]/i.test(line);
      const existingIndex = current.options.findIndex((item) => item.label === label);

      // If choices restart at A after several choices, a question boundary was
      // probably flattened by the PDF. Do not keep accumulating A-I-J... choices.
      if (existingIndex >= 0) {
        if (label === "A" && current.options.length >= 2) {
          warnings.push(`A repeated A choice was found near question ${current.number}; the item was stopped to prevent merged questions.`);
          flush();
          continue;
        }
        const existing = current.options[existingIndex];
        if (normalizeText(existing.text) !== normalizeText(optionText)) {
          existing.text = `${existing.text} ${optionText}`.trim();
        }
        existing.correct = existing.correct || markedCorrect;
        continue;
      }

      if (current.options.length >= 8) {
        warnings.push(`Extra answer choices after H were ignored near question ${current.number}.`);
        continue;
      }

      current.options.push({ label, text: optionText, correct: markedCorrect });
      continue;
    }

    if (answer && current) {
      current.answerTokens.push(...parseAnswerTokens(answer[1]));
      continue;
    }

    if (explanation && current) {
      current.explanation = `${current.explanation} ${explanation[1]}`.trim();
      continue;
    }

    if (!current) continue;

    // Wrapped text after choices belongs to the latest answer choice. Before the
    // first choice, it belongs to the question itself.
    if (current.options.length === 0) {
      current.question = `${current.question} ${line}`.trim();
    } else if (current.explanation) {
      current.explanation = `${current.explanation} ${line}`.trim();
    } else {
      const lastOption = current.options[current.options.length - 1];
      lastOption.text = `${lastOption.text} ${line}`.trim();
    }
  }

  flush();

  const deduped = deduplicate(questions);
  const highestQuestionNumber = detectedQuestionNumbers.length
    ? Math.max(...detectedQuestionNumbers)
    : deduped.length;
  const verifiedAnswers = deduped.filter((question) => getCorrectIds(question).length > 0).length;
  const suspiciousQuestions = deduped.filter((question) => question.options.length > 8 || question.options.length < 2).length;

  if (highestQuestionNumber > 0 && deduped.length < highestQuestionNumber) {
    warnings.push(`The PDF appears to contain ${highestQuestionNumber} numbered questions, but ${deduped.length} were extracted.`);
  }
  if (deduped.some((question) => question.options.length > 8)) {
    warnings.push("Some questions have an unusually high number of choices and should be reviewed.");
  }

  return {
    questions: deduped,
    detectedQuestionNumbers: [...new Set(detectedQuestionNumbers)].sort((a, b) => a - b),
    highestQuestionNumber,
    verifiedAnswers,
    suspiciousQuestions,
    warnings: [...new Set(warnings)]
  };
}

export function parseQuestionBank(rawText: string): Question[] {
  return parseQuestionBankDetailed(rawText).questions;
}

function prepareLines(rawText: string): string[] {
  const normalized = rawText
    .replace(/\r/g, "")
    .replace(/[\u00a0\t]+/g, " ")
    .replace(/[‐‑‒–—]/g, "-");

  return normalized
    .split("\n")
    .flatMap((line) => splitFlattenedQuestionStarts(line))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitFlattenedQuestionStarts(line: string): string[] {
  const cleaned = line.trim();
  if (!cleaned) return [];

  // PDF.js can occasionally put the next numbered question immediately after
  // the previous line. Split only when the number is followed by question-like
  // text, which avoids splitting ordinary numeric values.
  const parts = cleaned.split(/\s+(?=(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.)\]:-]\s*(?:What|Which|When|Where|Who|How|Why|The|An|A\s|Your|You\s|ServiceNow\b))/i);
  return parts.length > 1 ? parts : [cleaned];
}

function matchQuestionStart(line: string): RegExpMatchArray | null {
  const direct = line.match(QUESTION_START);
  if (direct && !/^[A-H](?:\s*[,;/]\s*[A-H])*$/i.test(direct[2].trim())) return direct;

  // Also accept missing spacing: “12.What ...” and “12)Which ...”.
  const tight = line.match(/^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:-]\s*(.{3,})$/i);
  if (tight && !/^[A-H](?:\s*[,;/]\s*[A-H])*$/i.test(tight[2].trim())) return tight;
  return null;
}

function extractAnswerKey(lines: string[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  let inKey = false;

  for (const line of lines) {
    if (/^(?:answer\s*key|answers?)\s*[:=-]?$/i.test(line)) {
      inKey = true;
      continue;
    }

    const pairPattern = /(?:^|\s|,|;)(\d{1,3})\s*[).:-]?\s*([A-H](?:\s*[,/&+]\s*[A-H])*)(?=\s|$|,|;)/gi;
    const pairs = [...line.matchAll(pairPattern)];
    if (pairs.length >= 2 || inKey) {
      pairs.forEach((pair) => map.set(Number(pair[1]), parseAnswerTokens(pair[2])));
      if (inKey && pairs.length === 0 && matchQuestionStart(line)) inKey = false;
    }
  }
  return map;
}

function parseAnswerTokens(value: string): string[] {
  const cleaned = value
    .replace(/[\[\](){}]/g, " ")
    .replace(/\band\b/gi, ",")
    .replace(/[&/+]/g, ",");
  const letters = cleaned.match(/\b[A-H]\b/gi);
  if (letters?.length) return uniqueTokens(letters);
  return [value.trim()].filter(Boolean);
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => token.trim().toUpperCase()).filter(Boolean))];
}

function tokenToOptionId(
  token: string,
  sourceOptions: WorkingOption[],
  optionObjects: Array<{ id: string; text: string }>
): string | null {
  const normalizedToken = token.trim();
  if (/^[A-H]$/i.test(normalizedToken)) {
    const sourceIndex = sourceOptions.findIndex((option) => option.label === normalizedToken.toUpperCase());
    return optionObjects[sourceIndex]?.id ?? null;
  }
  const matchingIndex = sourceOptions.findIndex(
    (option) => normalizeText(option.text) === normalizeText(normalizedToken)
  );
  return optionObjects[matchingIndex]?.id ?? null;
}

function looksLikeAnswerKeyLine(line: string): boolean {
  return /^(?:\d{1,3}\s*[).:-]?\s*[A-H](?:\s*[,/&+]\s*[A-H])?(?:\s*[,;]\s*|\s+))*\d{1,3}\s*[).:-]?\s*[A-H](?:\s*[,/&+]\s*[A-H])?$/i.test(line);
}

function chooseCount(question: string): number {
  const match = question.match(/\bchoose\s+(one|two|three|four|five|six|seven|eight|\d+)\b/i);
  if (!match) return 1;
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8
  };
  return (words[match[1].toLowerCase()] ?? Number(match[1])) || 1;
}

function isNoiseLine(line: string): boolean {
  return /^(?:page\s+\d+(?:\s+of\s+\d+)?|quizforge|mock\s+exam)$/i.test(line);
}

function getCorrectIds(question: Question): string[] {
  if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length) {
    return question.correctOptionIds;
  }
  return question.correctOptionId ? [question.correctOptionId] : [];
}

function deduplicate(questions: Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = normalizeText(question.question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateLocalQuestions(rawText: string): Question[] {
  const cleaned = rawText
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 260);

  const unique = [...new Map(sentences.map((sentence) => [normalizeText(sentence), sentence])).values()].slice(0, 60);
  const selected = unique.slice(0, Math.min(15, unique.length));

  return selected.map((sentence, index) => {
    const keyword = chooseKeyword(sentence) || `concept ${index + 1}`;
    const distractors = shuffle(unique.filter((item) => item !== sentence)).slice(0, 3);
    const optionTexts = shuffle([sentence, ...distractors]);
    const options = optionTexts.map((text) => ({ id: uid(), text }));
    const correct = options.find((option) => option.text === sentence);
    return {
      id: uid(),
      question: `Which statement best matches “${keyword}” according to the uploaded material?`,
      options,
      correctOptionId: correct?.id ?? null,
      correctOptionIds: correct ? [correct.id] : [],
      selectionMode: "single" as const,
      explanation: sentence,
      status: "review" as const
    };
  });
}

function chooseKeyword(sentence: string): string | null {
  const stopWords = new Set(["about", "after", "again", "against", "because", "before", "being", "between", "could", "during", "every", "first", "from", "have", "into", "more", "most", "other", "should", "their", "there", "these", "they", "this", "through", "under", "using", "very", "what", "when", "where", "which", "while", "with", "would"]);
  const words = sentence.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? [];
  return words.filter((word) => !stopWords.has(word.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? null;
}
