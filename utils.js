function correctIds(question) {
    return question.correctOptionIds?.length ? question.correctOptionIds : question.correctOptionId ? [question.correctOptionId] : [];
}
export function validateQuestion(question) {
    const issues = [];
    const prefix = question.id;
    if (question.question.trim().length < 8) {
        issues.push({ id: `${prefix}-short`, questionId: question.id, severity: "error", title: "Question text is too short", message: "Add a complete question before using this item in an exam." });
    }
    if (question.options.length < 2) {
        issues.push({ id: `${prefix}-few-options`, questionId: question.id, severity: "error", title: "Not enough answer choices", message: "A multiple-choice question needs at least two choices." });
    }
    if (question.options.length > 8) {
        issues.push({ id: `${prefix}-many-options`, questionId: question.id, severity: "warning", title: "Unusually many choices", message: `This item has ${question.options.length} choices and may contain merged questions.` });
    }
    const normalized = question.options.map((option) => option.text.trim().toLowerCase().replace(/\s+/g, " "));
    const duplicate = normalized.find((value, index) => value && normalized.indexOf(value) !== index);
    if (duplicate) {
        issues.push({ id: `${prefix}-duplicate`, questionId: question.id, severity: "warning", title: "Duplicate answer choice", message: "Two or more answer choices contain the same text." });
    }
    if (question.options.some((option) => option.text.trim().length < 1)) {
        issues.push({ id: `${prefix}-blank-option`, questionId: question.id, severity: "error", title: "Blank answer choice", message: "Fill in or remove the empty answer choice." });
    }
    const ids = correctIds(question);
    if (!ids.length) {
        issues.push({ id: `${prefix}-missing-answer`, questionId: question.id, severity: "warning", title: "Correct answer not detected", message: "Choose the correct answer before starting an exam." });
    }
    else if (ids.some((id) => !question.options.some((option) => option.id === id))) {
        issues.push({ id: `${prefix}-invalid-answer`, questionId: question.id, severity: "error", title: "Answer key is invalid", message: "The selected answer no longer exists in the choice list." });
    }
    if (question.importWarnings?.length) {
        question.importWarnings.forEach((message, index) => issues.push({ id: `${prefix}-import-${index}`, questionId: question.id, severity: "info", title: "Import note", message }));
    }
    return issues;
}
export function validateQuestions(questions, expectedCount) {
    const issues = questions.flatMap(validateQuestion);
    if (expectedCount && expectedCount !== questions.length) {
        issues.unshift({
            id: "count-mismatch",
            severity: "warning",
            title: "Question count mismatch",
            message: `The source appears to contain ${expectedCount} questions, but ${questions.length} were prepared.`
        });
    }
    const seen = new Map();
    for (const question of questions) {
        const key = question.question.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key)
            continue;
        const first = seen.get(key);
        if (first) {
            issues.push({ id: `duplicate-question-${question.id}`, questionId: question.id, severity: "warning", title: "Possible duplicate question", message: "Another question has the same wording." });
        }
        else {
            seen.set(key, question.id);
        }
    }
    return issues;
}
