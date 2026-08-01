const STORAGE_KEY = "quizforge.react.studySets.v2";
const THEME_KEY = "quizforge.react.theme";
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
