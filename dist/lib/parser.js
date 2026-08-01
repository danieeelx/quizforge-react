import { normalizeText, shuffle, uid } from "./utils.js";
export function parseQuestionBank(rawText) {
    const text = rawText.replace(/\r/g, "").replace(/[\u00a0\t]+/g, " ");
    const lines = text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const answerKey = extractAnswerKey(lines);
    const questions = [];
    let current = null;
    let inAnswerKey = false;
    const flush = () => {
        if (!current || current.question.trim().length < 3) {
            current = null;
            return;
        }
        const optionObjects = current.options.map((option) => ({ id: uid(), text: option.text.trim() })).filter((option) => option.text);
        const answerToken = current.answerToken || answerKey.get(current.number);
        let correctOptionId = null;
        if (answerToken) {
            const normalizedToken = String(answerToken).trim();
            if (/^[A-H]$/i.test(normalizedToken)) {
                const index = normalizedToken.toUpperCase().charCodeAt(0) - 65;
                correctOptionId = optionObjects[index]?.id ?? null;
            }
            else {
                const matchingIndex = current.options.findIndex((option) => normalizeText(option.text) === normalizeText(normalizedToken));
                correctOptionId = optionObjects[matchingIndex]?.id ?? null;
            }
        }
        if (optionObjects.length >= 2) {
            questions.push({
                id: uid(),
                question: current.question.trim(),
                options: optionObjects,
                correctOptionId,
                explanation: current.explanation.trim(),
                status: correctOptionId ? "verified" : "review"
            });
        }
        current = null;
    };
    for (const line of lines) {
        if (/^(?:answer\s*key|answers?)\s*[:=-]?$/i.test(line)) {
            flush();
            inAnswerKey = true;
            continue;
        }
        if (inAnswerKey && looksLikeAnswerKeyLine(line))
            continue;
        const numberedQuestion = line.match(/^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[).:-]\s+(.{3,})$/i);
        const explicitQuestion = line.match(/^(?:q|question)\s*[:.-]\s*(.{3,})$/i);
        const option = line.match(/^([A-H])\s*[).:-]\s+(.{1,})$/i);
        const answer = line.match(/^(?:correct\s+answer|answer|ans)\s*[:=-]\s*(.+)$/i);
        const explanation = line.match(/^(?:explanation|rationale|reason)\s*[:=-]\s*(.+)$/i);
        if (numberedQuestion) {
            flush();
            current = { number: Number(numberedQuestion[1]), question: numberedQuestion[2], options: [], explanation: "" };
            inAnswerKey = false;
            continue;
        }
        if (explicitQuestion) {
            flush();
            current = { number: questions.length + 1, question: explicitQuestion[1], options: [], explanation: "" };
            continue;
        }
        if (option && current) {
            current.options.push({ label: option[1].toUpperCase(), text: option[2] });
            continue;
        }
        if (answer && current) {
            current.answerToken = answer[1].trim().replace(/^[([{]|[)\]}]$/g, "");
            continue;
        }
        if (explanation && current) {
            current.explanation = `${current.explanation} ${explanation[1]}`.trim();
            continue;
        }
        if (current && current.options.length === 0) {
            current.question = `${current.question} ${line}`.trim();
        }
        else if (current && current.explanation) {
            current.explanation = `${current.explanation} ${line}`.trim();
        }
    }
    flush();
    return deduplicate(questions);
}
function extractAnswerKey(lines) {
    const map = new Map();
    let inKey = false;
    for (const line of lines) {
        if (/^(?:answer\s*key|answers?)\s*[:=-]?$/i.test(line)) {
            inKey = true;
            continue;
        }
        const pairs = [...line.matchAll(/(?:^|\s|,|;)(\d{1,3})\s*[).:-]?\s*([A-H])(?=\s|$|,|;)/gi)];
        if (pairs.length >= 2 || inKey) {
            pairs.forEach((pair) => map.set(Number(pair[1]), pair[2].toUpperCase()));
            if (inKey && pairs.length === 0 && /^(?:q(?:uestion)?\s*)?\d+\s*[).:-]\s+.{3,}$/i.test(line))
                inKey = false;
        }
    }
    return map;
}
function looksLikeAnswerKeyLine(line) {
    return /^(?:\d{1,3}\s*[).:-]?\s*[A-H](?:\s*[,;]\s*|\s+))*\d{1,3}\s*[).:-]?\s*[A-H]$/i.test(line);
}
function deduplicate(questions) {
    const seen = new Set();
    return questions.filter((question) => {
        const key = normalizeText(question.question);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function generateLocalQuestions(rawText) {
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
            explanation: sentence,
            status: "review"
        };
    });
}
function chooseKeyword(sentence) {
    const stopWords = new Set(["about", "after", "again", "against", "because", "before", "being", "between", "could", "during", "every", "first", "from", "have", "into", "more", "most", "other", "should", "their", "there", "these", "they", "this", "through", "under", "using", "very", "what", "when", "where", "which", "while", "with", "would"]);
    const words = sentence.match(/[A-Za-z][A-Za-z-]{4,}/g) ?? [];
    return words.filter((word) => !stopWords.has(word.toLowerCase())).sort((a, b) => b.length - a.length)[0] ?? null;
}
