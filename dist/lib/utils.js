export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
}
export function normalizeText(value) {
    return String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
export function stripExtension(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled study set";
}
export function formatDuration(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
export function formatDate(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
export function bestScore(attempts) {
    return attempts.reduce((best, attempt) => Math.max(best, attempt.score), 0);
}
