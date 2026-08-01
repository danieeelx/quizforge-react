const STORAGE_KEY = "quizforge.react.studySets.v2";
const THEME_KEY = "quizforge.react.theme";
const UPLOAD_DRAFT_KEY = "quizforge.react.uploadDraft.v2";
const EXAM_RECOVERY_KEY = "quizforge.react.examRecovery.v2";
export function loadStudySets() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export function saveStudySets(sets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
}
export function loadTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark")
        return stored;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function saveTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
}
export function loadUploadDraft() {
    try {
        const value = localStorage.getItem(UPLOAD_DRAFT_KEY);
        if (!value)
            return null;
        const parsed = JSON.parse(value);
        if (!parsed || !Array.isArray(parsed.pasteSections))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function saveUploadDraft(draft) {
    localStorage.setItem(UPLOAD_DRAFT_KEY, JSON.stringify(draft));
}
export function clearUploadDraft() {
    localStorage.removeItem(UPLOAD_DRAFT_KEY);
}
export function loadExamRecovery() {
    try {
        const value = localStorage.getItem(EXAM_RECOVERY_KEY);
        if (!value)
            return null;
        const parsed = JSON.parse(value);
        if (!parsed?.activeSetId || !parsed.exam?.questions?.length)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function saveExamRecovery(recovery) {
    localStorage.setItem(EXAM_RECOVERY_KEY, JSON.stringify(recovery));
}
export function clearExamRecovery() {
    localStorage.removeItem(EXAM_RECOVERY_KEY);
}
