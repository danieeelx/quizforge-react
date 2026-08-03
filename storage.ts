import type { Attempt, Question, TopicPerformance } from "../types.js";

export const DEFAULT_TOPIC = "General";

export function inferTopic(_question: Pick<Question, "question" | "options">): string {
  return DEFAULT_TOPIC;
}

export function ensureQuestionTopics(questions: Question[]): Question[] {
  return questions.map((question) => ({ ...question, topic: question.topic?.trim() || inferTopic(question) }));
}

export function availableTopics(questions: Question[]): string[] {
  return [...new Set(questions.map((question) => question.topic?.trim() || DEFAULT_TOPIC))].sort((a, b) => a.localeCompare(b));
}

export function computeTopicPerformance(attempts: Attempt[]): TopicPerformance[] {
  const map = new Map<string, { attempts: Set<string>; correct: number; total: number }>();
  for (const attempt of attempts) {
    for (const result of attempt.results ?? []) {
      const topic = result.topic || DEFAULT_TOPIC;
      const current = map.get(topic) ?? { attempts: new Set<string>(), correct: 0, total: 0 };
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

export function weakTopics(attempts: Attempt[], threshold = 70): string[] {
  return computeTopicPerformance(attempts)
    .filter((item) => item.total >= 2 && item.accuracy < threshold)
    .map((item) => item.topic);
}
