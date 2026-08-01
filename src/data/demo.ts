import type { StudySet } from "../types.js";
import { uid } from "../lib/utils.js";

function makeQuestion(question: string, options: string[], correctIndex: number, explanation: string) {
  const mapped = options.map((text) => ({ id: uid(), text }));
  return {
    id: uid(),
    question,
    options: mapped,
    correctOptionId: mapped[correctIndex]?.id ?? null,
    explanation,
    status: "verified" as const
  };
}

export function createDemoSet(): StudySet {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "Demo: Computer Fundamentals",
    sourceName: "Built-in sample",
    createdAt: now,
    updatedAt: now,
    attempts: [],
    questions: [
      makeQuestion("Which component performs most general-purpose calculations in a computer?", ["CPU", "Monitor", "Keyboard", "Router"], 0, "The CPU executes instructions and performs general calculations."),
      makeQuestion("Which type of memory normally loses its contents when power is removed?", ["SSD", "RAM", "ROM", "Blu-ray disc"], 1, "RAM is volatile memory and normally clears when power is removed."),
      makeQuestion("What is the main purpose of an operating system?", ["Manage hardware and provide services for applications", "Only browse the internet", "Replace all application software", "Increase monitor resolution"], 0, "An operating system manages hardware resources and provides common services to applications."),
      makeQuestion("Which file extension commonly represents a PDF document?", [".pdf", ".mp3", ".exe", ".png"], 0, "PDF documents commonly use the .pdf file extension."),
      makeQuestion("Which network device commonly connects multiple devices within the same local network?", ["Switch", "Printer", "Webcam", "Projector"], 0, "A network switch connects devices within a LAN and forwards frames to the correct port."),
      makeQuestion("What does a strong password usually include?", ["A mix of length and varied characters", "Only a first name", "The word password", "A four-digit birthday"], 0, "Long, unique passwords with varied characters are generally harder to guess.")
    ]
  };
}
