const TOPIC_RULES = [
    { topic: "Platform Basics", keywords: ["navigation", "application navigator", "instance", "role", "user", "group", "platform", "form", "list"] },
    { topic: "Database & CMDB", keywords: ["table", "field", "dictionary", "schema", "cmdb", "configuration item", "relationship", "database", "coalesce", "import set"] },
    { topic: "Security", keywords: ["access control", "acl", "security", "impersonat", "permission", "role", "authentication", "authorize"] },
    { topic: "Automation", keywords: ["flow designer", "workflow", "business rule", "client script", "ui policy", "data policy", "notification", "event", "trigger"] },
    { topic: "Service Catalog", keywords: ["service catalog", "catalog item", "record producer", "order guide", "request", "variable set", "cart"] },
    { topic: "Knowledge", keywords: ["knowledge base", "knowledge article", "knowledge manager", "article", "knowledge"] },
    { topic: "Reporting & Analytics", keywords: ["report", "dashboard", "performance analytics", "indicator", "visualization", "analytics"] },
    { topic: "ITSM", keywords: ["incident", "problem", "change request", "sla", "assignment group", "service desk", "task"] },
    { topic: "Integrations & Data", keywords: ["api", "integration", "web service", "rest", "soap", "ldap", "jdbc", "transform map", "data source"] }
];
export const DEFAULT_TOPIC = "General";
export function inferTopic(question) {
    const haystack = `${question.question} ${question.options.map((option) => option.text).join(" ")}`.toLowerCase();
    let best = DEFAULT_TOPIC;
    let bestScore = 0;
    for (const rule of TOPIC_RULES) {
        const score = rule.keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
        if (score > bestScore) {
            bestScore = score;
            best = rule.topic;
        }
    }
    return best;
}
export function ensureQuestionTopics(questions) {
    return questions.map((question) => ({ ...question, topic: question.topic?.trim() || inferTopic(question) }));
}
export function availableTopics(questions) {
    return [...new Set(questions.map((question) => question.topic?.trim() || DEFAULT_TOPIC))].sort((a, b) => a.localeCompare(b));
}
export function computeTopicPerformance(attempts) {
    const map = new Map();
    for (const attempt of attempts) {
        for (const result of attempt.results ?? []) {
            const topic = result.topic || DEFAULT_TOPIC;
            const current = map.get(topic) ?? { attempts: new Set(), correct: 0, total: 0 };
            current.attempts.add(attempt.id);
            current.correct += result.correct ? 1 : 0;
            current.total += 1;
            map.set(topic, current);
        }
    }
    return [...map.entries()]
        .map(([topic, value]) => ({
        topic,
        attempts: value.attempts.size,
        correct: value.correct,
        total: value.total,
        accuracy: value.total ? Math.round((value.correct / value.total) * 100) : 0
    }))
        .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}
export function weakTopics(attempts, threshold = 70) {
    return computeTopicPerformance(attempts)
        .filter((item) => item.total >= 2 && item.accuracy < threshold)
        .map((item) => item.topic);
}
