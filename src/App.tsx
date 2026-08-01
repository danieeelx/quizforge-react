import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  BarChart3,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  Filter,
  Flag,
  FolderOpen,
  Home,
  Layers3,
  Library,
  ListFilter,
  Menu,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Scissors,
  Users,
  Snowflake,
  Lightbulb,
  Bot,
  ShieldCheck,
  Tag,
  Target,
  Trash2,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import type { ExamQuestion, ExamSession, ExamSettings, Question, StudySet, UploadDraft } from "./types.js";
import { extractPdfText } from "./lib/pdf.js";
import { generateLocalQuestions, parseQuestionBankDetailed } from "./lib/parser.js";
import { clearExamRecovery, clearUploadDraft, loadExamRecovery, loadStudySets, loadTheme, loadUploadDraft, saveExamRecovery, saveStudySets, saveTheme, saveUploadDraft } from "./lib/storage.js";
import { bestScore, formatDate, formatDuration, shuffle, stripExtension, uid } from "./lib/utils.js";
import { availableTopics, computeTopicPerformance, ensureQuestionTopics, weakTopics } from "./lib/topics.js";
import { validateQuestions, type ValidationIssue } from "./lib/validation.js";

type View = "dashboard" | "library" | "performance" | "upload" | "processing" | "import-preview" | "editor" | "setup" | "exam" | "results";

type ProcessingStep = "read" | "detect" | "answers" | "finish";

interface ResultDetail {
  question: ExamQuestion;
  selectedOptionIds: string[];
  correct: boolean;
}


interface PasteAnswerDraft {
  id: string;
  text: string;
  correct: boolean;
}

interface PasteSection {
  id: string;
  title: string;
  topic: string;
  question: string;
  answers: PasteAnswerDraft[];
  selectionMode: "single" | "multiple";
  activeTab: "question" | "answers";
  expanded: boolean;
}

interface PendingImport {
  title: string;
  sourceName: string;
  questions: Question[];
  expected: number;
  parserWarnings: string[];
  selectedIds: string[];
  issues: ValidationIssue[];
}

function createPasteAnswer(text = "", correct = false): PasteAnswerDraft {
  return { id: uid(), text, correct };
}

function createPasteSection(): PasteSection {
  return {
    id: uid(),
    title: "",
    topic: "General",
    question: "",
    answers: [createPasteAnswer(), createPasteAnswer(), createPasteAnswer(), createPasteAnswer()],
    selectionMode: "single",
    activeTab: "question",
    expanded: true
  };
}

function normalizePasteSections(rawSections: unknown): PasteSection[] {
  if (!Array.isArray(rawSections) || rawSections.length === 0) return [createPasteSection()];

  const normalized = rawSections.map((rawValue) => {
    const raw = (rawValue && typeof rawValue === "object" ? rawValue : {}) as Record<string, unknown>;
    const rawAnswers = raw.answers;

    if (typeof raw.question === "string" && Array.isArray(rawAnswers)) {
      const answers = rawAnswers
        .filter((answer): answer is Record<string, unknown> => Boolean(answer && typeof answer === "object"))
        .map((answer) => ({
          id: typeof answer.id === "string" ? answer.id : uid(),
          text: typeof answer.text === "string" ? answer.text : "",
          correct: Boolean(answer.correct)
        }));
      while (answers.length < 2) answers.push(createPasteAnswer());
      return {
        id: typeof raw.id === "string" ? raw.id : uid(),
        title: typeof raw.title === "string" ? raw.title : "",
        topic: typeof raw.topic === "string" && raw.topic.trim() ? raw.topic : "General",
        question: raw.question,
        answers,
        selectionMode: raw.selectionMode === "multiple" ? "multiple" as const : "single" as const,
        activeTab: raw.activeTab === "answers" ? "answers" as const : "question" as const,
        expanded: raw.expanded !== false
      };
    }

    // Migrate the old bulk Questions + Answers browser draft into one editable card.
    const legacyQuestion = typeof raw.questions === "string" ? raw.questions : "";
    const legacyAnswerText = typeof rawAnswers === "string" ? rawAnswers : "";
    const legacyAnswers = legacyAnswerText
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:\d+\s*[.)-]?\s*)?/, "").trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => createPasteAnswer(line));
    while (legacyAnswers.length < 4) legacyAnswers.push(createPasteAnswer());
    return {
      id: typeof raw.id === "string" ? raw.id : uid(),
      title: typeof raw.title === "string" ? raw.title : "",
      topic: typeof raw.title === "string" && raw.title.trim() ? raw.title : "General",
      question: legacyQuestion,
      answers: legacyAnswers,
      selectionMode: "single" as const,
      activeTab: "question" as const,
      expanded: true
    };
  });

  if (!normalized.length) return [createPasteSection()];
  const firstExpanded = normalized.findIndex((section) => section.expanded);
  return normalized.map((section, index) => ({ ...section, expanded: firstExpanded === -1 ? index === 0 : index === firstExpanded }));
}


function getCorrectIds(question: Question): string[] {
  if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length) return question.correctOptionIds;
  return question.correctOptionId ? [question.correctOptionId] : [];
}

function hasValidAnswer(question: Question): boolean {
  const ids = getCorrectIds(question);
  return ids.length > 0 && ids.every((id) => question.options.some((option) => option.id === id));
}

function isVerifiedQuestion(question: Question): boolean {
  return question.status !== "review" && hasValidAnswer(question);
}

function isMultipleQuestion(question: Question): boolean {
  return question.selectionMode === "multiple" || getCorrectIds(question).length > 1 || /\bchoose\s+(?:two|three|four|five|six|seven|eight|[2-8])\b/i.test(question.question);
}

function sameAnswerSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

function dedupeImportedQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = `${question.question.toLowerCase().replace(/\s+/g, " ").trim()}::${question.options
      .map((option) => option.text.toLowerCase().replace(/\s+/g, " ").trim())
      .join("||")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const defaultSettings: ExamSettings = {
  questionCount: 20,
  shuffleQuestions: true,
  shuffleAnswers: true,
  timed: true,
  minutes: 30,
  showExplanations: true,
  topicFilter: "All topics",
  weakAreasOnly: false,
  lifelineFiftyFifty: true,
  lifelineAudiencePoll: true,
  lifelineTimeFreeze: true,
  lifelineClue: true
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => loadTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studySets, setStudySets] = useState<StudySet[]>(() => loadStudySets());
  const [initialUploadDraft] = useState<UploadDraft | null>(() => loadUploadDraft());
  const [initialExamRecovery] = useState(() => loadExamRecovery());
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recoveredFileName, setRecoveredFileName] = useState(initialUploadDraft?.fileName ?? "");
  const [pasteSections, setPasteSections] = useState<PasteSection[]>(() => normalizePasteSections(initialUploadDraft?.pasteSections));
  const [studyTitle, setStudyTitle] = useState(initialUploadDraft?.title ?? "");
  const [aiEnhanced, setAiEnhanced] = useState(initialUploadDraft?.aiEnhanced ?? false);
  const [ocrEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("read");
  const [processingLabel, setProcessingLabel] = useState("Reading document text");
  const [settings, setSettings] = useState<ExamSettings>(defaultSettings);
  const [exam, setExam] = useState<ExamSession | null>(null);
  const [resultDetails, setResultDetails] = useState<ResultDetail[]>([]);
  const [toast, setToast] = useState(initialUploadDraft ? "Your unfinished paste draft was recovered" : "");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [submitReviewOpen, setSubmitReviewOpen] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(Boolean(initialExamRecovery));
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSet = useMemo(
    () => studySets.find((set) => set.id === activeSetId) ?? null,
    [studySets, activeSetId]
  );

  const editingQuestion = useMemo(
    () => activeSet?.questions.find((question) => question.id === editingQuestionId) ?? activeSet?.questions[0] ?? null,
    [activeSet, editingQuestionId]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    saveStudySets(studySets);
  }, [studySets]);

  useEffect(() => {
    const hasDraftContent = Boolean(studyTitle.trim() || pasteSections.some((section) => section.title.trim() || section.question.trim() || section.answers.some((answer) => answer.text.trim())) || selectedFile);
    if (!hasDraftContent) return;
    saveUploadDraft({
      title: studyTitle,
      pasteSections,
      aiEnhanced,
      ocrEnabled,
      savedAt: new Date().toISOString(),
      fileName: selectedFile?.name ?? initialUploadDraft?.fileName
    });
  }, [studyTitle, pasteSections, aiEnhanced, ocrEnabled, selectedFile]);

  useEffect(() => {
    if (view === "exam" && exam && activeSetId) {
      saveExamRecovery({ activeSetId, exam, settings, savedAt: new Date().toISOString() });
      setRecoveryAvailable(true);
    }
  }, [view, exam, activeSetId, settings]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data: { aiConfigured?: boolean }) => setAiConfigured(Boolean(data.aiConfigured)))
      .catch(() => setAiConfigured(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (view !== "exam" || !exam || !settings.timed) return;
    if (exam.remainingSeconds <= 0) {
      finalizeExam(true);
      return;
    }
    const timer = window.setInterval(() => {
      setExam((current) => {
        if (!current) return current;
        const frozenUntil = current.lifelines?.timerFrozenUntil ?? 0;
        if (frozenUntil > Date.now()) return { ...current };
        return { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view, exam?.remainingSeconds, settings.timed]);

  function navigate(nextView: View) {
    setSidebarOpen(false);
    setError("");
    setView(nextView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleTheme() {
    setTheme((current) => current === "dark" ? "light" : "dark");
  }

  function openSet(setId: string, target: View = "editor") {
    const set = studySets.find((item) => item.id === setId);
    if (!set) return;
    setActiveSetId(setId);
    setEditingQuestionId(set.questions[0]?.id ?? null);
    setSettings((current) => ({ ...current, questionCount: Math.min(current.questionCount, set.questions.length) || set.questions.length, topicFilter: "All topics", weakAreasOnly: false }));
    navigate(target);
  }

  function newStudySet() {
    setProcessingProgress(0);
    navigate("upload");
  }

  function clearStudyDraft() {
    setSelectedFile(null);
    setRecoveredFileName("");
    setPasteSections([createPasteSection()]);
    setStudyTitle("");
    setAiEnhanced(false);
    clearUploadDraft();
    setToast("Draft cleared");
  }

  function resumeRecoveredExam() {
    const recovery = loadExamRecovery();
    if (!recovery) {
      setRecoveryAvailable(false);
      setToast("No recoverable exam was found");
      return;
    }
    const set = studySets.find((item) => item.id === recovery.activeSetId);
    if (!set) {
      clearExamRecovery();
      setRecoveryAvailable(false);
      setToast("The original study set is no longer available");
      return;
    }
    setActiveSetId(set.id);
    setEditingQuestionId(set.questions[0]?.id ?? null);
    setSettings(recovery.settings);
    const elapsedWhileAway = recovery.settings.timed ? Math.max(0, Math.floor((Date.now() - new Date(recovery.savedAt).getTime()) / 1000)) : 0;
    setExam({ ...recovery.exam, remainingSeconds: recovery.settings.timed ? Math.max(0, recovery.exam.remainingSeconds - elapsedWhileAway) : recovery.exam.remainingSeconds });
    setSubmitReviewOpen(false);
    navigate("exam");
  }

  function updatePasteSection(id: string, patch: Partial<PasteSection>) {
    setPasteSections((current) => current.map((section) => {
      if (patch.expanded === true) return section.id === id ? { ...section, ...patch } : { ...section, expanded: false };
      return section.id === id ? { ...section, ...patch } : section;
    }));
  }

  function addPasteSection() {
    const section = createPasteSection();
    setPasteSections((current) => [...current.map((item) => ({ ...item, expanded: false })), section]);
    window.setTimeout(() => {
      document.querySelector(".manual-question-card:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  function removePasteSection(id: string) {
    setPasteSections((current) => current.length === 1
      ? [createPasteSection()]
      : current.filter((section) => section.id !== id));
  }

  async function createStudySet() {
    const populatedSections = pasteSections.filter((section) => section.question.trim().length >= 3);
    if (!selectedFile && !populatedSections.length) {
      setError("Choose a PDF/image or add at least one question first.");
      return;
    }

    setError("");
    setProcessingProgress(4);
    setProcessingStep("read");
    setProcessingLabel("Reading your study material");
    navigate("processing");

    try {
      const parsedImports: ReturnType<typeof parseQuestionBankDetailed>[] = [];
      const sourceParts: string[] = [];
      const importedQuestions: Question[] = [];
      let sourceName = populatedSections.length > 1
        ? `${populatedSections.length} manually added questions`
        : "Manually added question";

      if (selectedFile) {
        sourceName = populatedSections.length ? `${selectedFile.name} + ${populatedSections.length} manual question${populatedSections.length === 1 ? "" : "s"}` : selectedFile.name;
        const extractedText = await extractPdfText(selectedFile, ({ progress, page, totalPages }) => {
          setProcessingLabel(`Reading page ${page} of ${totalPages}`);
          setProcessingProgress(Math.max(5, Math.min(52, Math.round(progress * 0.52))));
        }, { enableOcr: false });
        if (extractedText.replace(/\s/g, "").length < 30) {
          throw new Error("This PDF has little or no selectable text. Scanned-PDF OCR is not enabled yet, so try a text-based PDF or add the questions manually.");
        }
        sourceParts.push(extractedText);
        const parsedFile = parseQuestionBankDetailed(extractedText);
        parsedImports.push(parsedFile);
        importedQuestions.push(...parsedFile.questions);
      }

      setProcessingStep("detect");
      setProcessingLabel("Preparing questions and answer choices");
      setProcessingProgress(58);

      const manualQuestions = populatedSections.map((section, sectionIndex) => {
        const enteredAnswers = section.answers.filter((answer) => answer.text.trim());
        const optionDrafts = enteredAnswers.length >= 2 ? enteredAnswers : section.answers.slice(0, Math.max(2, section.answers.length));
        const options = optionDrafts.map((answer) => ({ id: uid(), text: answer.text.trim() }));
        const correctOptionIds = options
          .filter((_, optionIndex) => optionDrafts[optionIndex]?.correct)
          .map((option) => option.id);
        const topic = section.topic.trim() || section.title.trim() || "General";
        const question: Question = {
          id: uid(),
          question: section.question.trim(),
          options,
          correctOptionId: correctOptionIds[0] ?? null,
          correctOptionIds,
          selectionMode: section.selectionMode === "multiple" || correctOptionIds.length > 1 ? "multiple" : "single",
          explanation: "",
          status: correctOptionIds.length ? "verified" : "review",
          topic,
          importWarnings: options.length < 2 ? ["Add at least two answer choices."] : undefined
        };
        const sourceLines = [
          `${sectionIndex + 1}. ${section.question.trim()}`,
          ...optionDrafts.map((answer, answerIndex) => `${String.fromCharCode(65 + answerIndex)}. ${answer.text.trim()}`),
          correctOptionIds.length
            ? `Answer: ${optionDrafts.map((answer, answerIndex) => answer.correct ? String.fromCharCode(65 + answerIndex) : "").filter(Boolean).join(", ")}`
            : ""
        ].filter(Boolean);
        sourceParts.push(sourceLines.join("\n"));
        return question;
      });
      importedQuestions.push(...manualQuestions);

      const sourceText = sourceParts.join("\n\n");
      let questions = ensureQuestionTopics(dedupeImportedQuestions(importedQuestions));
      const aiWarnings: string[] = [];

      setProcessingStep("answers");
      setProcessingLabel(aiEnhanced ? "AI is reviewing the import" : "Matching answers and checking structure");
      setProcessingProgress(72);

      if (aiEnhanced) {
        try {
          const assisted = await assistImportWithAi(sourceText, questions, studyTitle || stripExtension(sourceName));
          questions = ensureQuestionTopics(assisted.questions);
          aiWarnings.push(...assisted.warnings);
        } catch (aiError) {
          const message = aiError instanceof Error ? aiError.message : "AI import assistance was unavailable.";
          aiWarnings.push(`AI assistance could not complete: ${message} Local extraction was kept.`);
          if (!questions.length && sourceText.trim()) questions = ensureQuestionTopics(generateLocalQuestions(sourceText));
        }
      } else if (!questions.length && sourceText.trim()) {
        questions = ensureQuestionTopics(generateLocalQuestions(sourceText));
      }

      if (!questions.length) {
        throw new Error("No usable questions were found. Try a clearer question bank, add a manual question, or enable AI import assistance.");
      }

      setProcessingStep("finish");
      setProcessingLabel("Preparing import preview");
      setProcessingProgress(94);
      await delay(350);

      const parsedExpected = parsedImports.reduce(
        (sum, parsed) => sum + (parsed.detectedQuestionNumbers.length || parsed.highestQuestionNumber || parsed.questions.length),
        0
      );
      const expected = parsedExpected + manualQuestions.length;
      const parserWarnings = [...new Set([...parsedImports.flatMap((parsed) => parsed.warnings), ...aiWarnings])];
      const issues = validateQuestions(questions, expected || questions.length);
      setPendingImport({
        title: studyTitle.trim() || stripExtension(sourceName),
        sourceName,
        questions,
        expected: expected || questions.length,
        parserWarnings,
        selectedIds: questions.map((question) => question.id),
        issues
      });
      setProcessingProgress(100);
      await delay(180);
      navigate("import-preview");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The study set could not be created.";
      setError(message);
      navigate("upload");
    }
  }

  function updatePendingQuestion(questionId: string, patch: Partial<Question>) {
    setPendingImport((current) => {
      if (!current) return current;
      const questions = current.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question);
      return { ...current, questions, issues: validateQuestions(questions, current.expected) };
    });
  }

  function updatePendingAnswer(questionId: string, optionId: string) {
    setPendingImport((current) => {
      if (!current) return current;
      const questions = current.questions.map((question) => {
        if (question.id !== questionId) return question;
        const multiple = isMultipleQuestion(question);
        const ids = getCorrectIds(question);
        const next = multiple ? (ids.includes(optionId) ? ids.filter((id) => id !== optionId) : [...ids, optionId]) : [optionId];
        return { ...question, correctOptionId: next[0] ?? null, correctOptionIds: next, status: next.length ? "verified" as const : "review" as const };
      });
      return { ...current, questions, issues: validateQuestions(questions, current.expected) };
    });
  }

  function togglePendingQuestion(questionId: string) {
    setPendingImport((current) => {
      if (!current) return current;
      const selectedIds = current.selectedIds.includes(questionId)
        ? current.selectedIds.filter((id) => id !== questionId)
        : [...current.selectedIds, questionId];
      return { ...current, selectedIds };
    });
  }

  function selectPendingQuestions(mode: "all" | "clean" | "none") {
    setPendingImport((current) => {
      if (!current) return current;
      const errorIds = new Set(current.issues.filter((issue) => issue.severity === "error").map((issue) => issue.questionId).filter(Boolean));
      const selectedIds = mode === "all" ? current.questions.map((question) => question.id)
        : mode === "clean" ? current.questions.filter((question) => !errorIds.has(question.id)).map((question) => question.id)
        : [];
      return { ...current, selectedIds };
    });
  }

  function confirmPendingImport() {
    if (!pendingImport) return;
    const questions = pendingImport.questions.filter((question) => pendingImport.selectedIds.includes(question.id));
    if (!questions.length) {
      setToast("Select at least one question to continue");
      return;
    }
    const now = new Date().toISOString();
    const set: StudySet = {
      id: uid(),
      title: pendingImport.title,
      sourceName: pendingImport.sourceName,
      createdAt: now,
      updatedAt: now,
      questions,
      attempts: []
    };
    setStudySets((current) => [set, ...current]);
    setActiveSetId(set.id);
    setEditingQuestionId(set.questions[0]?.id ?? null);
    clearUploadDraft();
    setSelectedFile(null);
    setRecoveredFileName("");
    setPasteSections([createPasteSection()]);
    setStudyTitle("");
    setPendingImport(null);
    setToast(`${questions.length} questions added`);
    navigate("editor");
  }

  async function assistImportWithAi(sourceText: string, questions: Question[], title: string): Promise<{ questions: Question[]; warnings: string[] }> {
    const response = await fetch("/api/ai-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        sourceText,
        questions: questions.map((question) => ({
          clientId: question.id,
          question: question.question,
          options: question.options.map((option) => option.text),
          correctIndexes: getCorrectIds(question)
            .map((id) => question.options.findIndex((option) => option.id === id))
            .filter((index) => index >= 0),
          selectionMode: isMultipleQuestion(question) ? "multiple" : "single",
          explanation: question.explanation,
          topic: question.topic ?? "General",
          sourcePage: question.sourcePage ?? null,
          importWarnings: question.importWarnings ?? []
        }))
      })
    });

    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      questions?: Array<{
        clientId: string;
        question: string;
        options: string[];
        correctIndexes: number[];
        selectionMode: "single" | "multiple";
        explanation: string;
        topic: string;
        sourcePage: number | null;
        confidence: number;
        changed: boolean;
        changes: string[];
        reviewRequired: boolean;
      }>;
      warnings?: string[];
      summary?: { reviewed: number; repaired: number; lowConfidence: number; generated: number };
    };

    if (!response.ok || !payload.questions) {
      throw new Error(payload.error || "AI import assistance failed.");
    }

    const existingById = new Map(questions.map((question) => [question.id, question]));
    const returnedIds = new Set<string>();
    const repaired = payload.questions.map((item) => {
      returnedIds.add(item.clientId);
      const existing = existingById.get(item.clientId);
      const optionTexts = Array.isArray(item.options) ? item.options.filter((text) => String(text).trim()).slice(0, 8) : [];
      const options = optionTexts.map((text, index) => ({
        id: existing?.options[index]?.id ?? uid(),
        text: String(text).trim()
      }));
      const correctOptionIds = [...new Set((item.correctIndexes ?? [])
        .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length)
        .map((index) => options[index].id))];
      const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
      const notes = Array.isArray(item.changes) ? item.changes.filter(Boolean).slice(0, 8) : [];
      const reviewRequired = Boolean(item.reviewRequired) || confidence < 0.75 || correctOptionIds.length === 0;
      return {
        id: existing?.id ?? uid(),
        question: String(item.question || existing?.question || "Untitled question").trim(),
        options: options.length >= 2 ? options : existing?.options ?? options,
        correctOptionId: correctOptionIds[0] ?? null,
        correctOptionIds,
        selectionMode: item.selectionMode === "multiple" || correctOptionIds.length > 1 ? "multiple" as const : "single" as const,
        explanation: String(item.explanation || existing?.explanation || "").trim(),
        status: reviewRequired ? "review" as const : "verified" as const,
        sourcePage: item.sourcePage ?? existing?.sourcePage,
        topic: String(item.topic || existing?.topic || "General").trim() || "General",
        importWarnings: [
          ...(existing?.importWarnings ?? []),
          ...notes,
          ...(confidence < 0.75 ? [`AI confidence is ${Math.round(confidence * 100)}%; verify this question.`] : [])
        ].filter(Boolean),
        aiConfidence: confidence,
        aiChanged: Boolean(item.changed),
        aiNotes: notes
      } satisfies Question;
    });

    const missing = questions
      .filter((question) => !returnedIds.has(question.id))
      .map((question) => ({
        ...question,
        status: "review" as const,
        importWarnings: [...(question.importWarnings ?? []), "AI did not return this question; local extraction was preserved for review."],
        aiConfidence: 0,
        aiChanged: false,
        aiNotes: ["Local extraction preserved"]
      }));

    const summary = payload.summary;
    const summaryNote = summary
      ? `AI reviewed ${summary.reviewed}, repaired ${summary.repaired}, generated ${summary.generated}, and flagged ${summary.lowConfidence} low-confidence question${summary.lowConfidence === 1 ? "" : "s"}.`
      : "AI import assistance completed.";

    return {
      questions: [...repaired, ...missing],
      warnings: [summaryNote, ...(payload.warnings ?? [])]
    };
  }

  function updateActiveSet(updater: (set: StudySet) => StudySet) {
    if (!activeSetId) return;
    setStudySets((current) => current.map((set) => set.id === activeSetId
      ? { ...updater(set), updatedAt: new Date().toISOString() }
      : set));
  }

  function updateQuestion(questionId: string, patch: Partial<Question>) {
    updateActiveSet((set) => ({
      ...set,
      questions: set.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question)
    }));
  }

  function updateOption(questionId: string, optionId: string, text: string) {
    updateActiveSet((set) => ({
      ...set,
      questions: set.questions.map((question) => question.id === questionId
        ? { ...question, options: question.options.map((option) => option.id === optionId ? { ...option, text } : option) }
        : question)
    }));
  }

  function markCorrect(questionId: string, optionId: string) {
    const question = activeSet?.questions.find((item) => item.id === questionId);
    if (!question) return;
    const multiple = isMultipleQuestion(question);
    const currentIds = getCorrectIds(question);
    const nextIds = multiple
      ? currentIds.includes(optionId)
        ? currentIds.filter((id) => id !== optionId)
        : [...currentIds, optionId]
      : [optionId];
    updateQuestion(questionId, {
      correctOptionId: nextIds[0] ?? null,
      correctOptionIds: nextIds,
      status: nextIds.length ? "verified" : "review"
    });
  }

  function setSelectionMode(questionId: string, mode: "single" | "multiple") {
    const question = activeSet?.questions.find((item) => item.id === questionId);
    if (!question) return;
    const currentIds = getCorrectIds(question);
    const nextIds = mode === "single" ? currentIds.slice(0, 1) : currentIds;
    updateQuestion(questionId, {
      selectionMode: mode,
      correctOptionId: nextIds[0] ?? null,
      correctOptionIds: nextIds,
      status: nextIds.length ? "verified" : "review"
    });
    setToast(mode === "multiple" ? "Multiple-answer mode enabled" : "Single-answer mode enabled");
  }

  function addOption(questionId: string) {
    updateActiveSet((set) => ({
      ...set,
      questions: set.questions.map((question) => question.id === questionId
        ? { ...question, options: [...question.options, { id: uid(), text: `Option ${String.fromCharCode(65 + question.options.length)}` }] }
        : question)
    }));
  }

  function removeOption(questionId: string, optionId: string) {
    const question = activeSet?.questions.find((item) => item.id === questionId);
    if (!question || question.options.length <= 2) {
      setToast("A multiple-choice question needs at least two options");
      return;
    }
    updateActiveSet((set) => ({
      ...set,
      questions: set.questions.map((item) => item.id === questionId
        ? {
            ...item,
            options: item.options.filter((option) => option.id !== optionId),
            correctOptionId: getCorrectIds(item).filter((id) => id !== optionId)[0] ?? null,
            correctOptionIds: getCorrectIds(item).filter((id) => id !== optionId),
            status: getCorrectIds(item).filter((id) => id !== optionId).length ? item.status : "review"
          }
        : item)
    }));
  }

  function addQuestion() {
    const options = ["Option A", "Option B", "Option C", "Option D"].map((text) => ({ id: uid(), text }));
    const question: Question = {
      id: uid(),
      question: "New question",
      options,
      correctOptionId: null,
      correctOptionIds: [],
      selectionMode: "single",
      explanation: "",
      status: "review"
    };
    updateActiveSet((set) => ({ ...set, questions: [...set.questions, question] }));
    setEditingQuestionId(question.id);
    setToast("Question added");
  }

  function duplicateQuestion(questionId: string) {
    const original = activeSet?.questions.find((question) => question.id === questionId);
    if (!original) return;
    const optionMap = new Map<string, string>();
    const options = original.options.map((option) => {
      const newId = uid();
      optionMap.set(option.id, newId);
      return { id: newId, text: option.text };
    });
    const copy: Question = {
      ...original,
      id: uid(),
      question: `${original.question} (copy)`,
      options,
      correctOptionId: original.correctOptionId ? optionMap.get(original.correctOptionId) ?? null : null,
      correctOptionIds: getCorrectIds(original).map((id) => optionMap.get(id)).filter((id): id is string => Boolean(id))
    };
    updateActiveSet((set) => ({ ...set, questions: [...set.questions, copy] }));
    setEditingQuestionId(copy.id);
    setToast("Question duplicated");
  }

  function deleteQuestion(questionId: string) {
    if (!activeSet || activeSet.questions.length <= 1) {
      setToast("A study set needs at least one question");
      return;
    }
    const index = activeSet.questions.findIndex((question) => question.id === questionId);
    const next = activeSet.questions[index + 1] ?? activeSet.questions[index - 1];
    updateActiveSet((set) => ({ ...set, questions: set.questions.filter((question) => question.id !== questionId) }));
    setEditingQuestionId(next?.id ?? null);
    setToast("Question deleted");
  }

  function bulkDeleteQuestions(questionIds: string[]) {
    if (!activeSet || !questionIds.length) return;
    if (questionIds.length >= activeSet.questions.length) {
      setToast("Keep at least one question in the study set");
      return;
    }
    if (!window.confirm(`Delete ${questionIds.length} selected question${questionIds.length === 1 ? "" : "s"}?`)) return;
    const ids = new Set(questionIds);
    const remaining = activeSet.questions.filter((question) => !ids.has(question.id));
    updateActiveSet((set) => ({ ...set, questions: remaining }));
    if (editingQuestionId && ids.has(editingQuestionId)) setEditingQuestionId(remaining[0]?.id ?? null);
    setToast(`${questionIds.length} questions deleted`);
  }

  function bulkSetStatus(questionIds: string[], status: "verified" | "review") {
    const ids = new Set(questionIds);
    updateActiveSet((set) => ({
      ...set,
      questions: set.questions.map((question) => ids.has(question.id)
        ? { ...question, status: status === "verified" && !hasValidAnswer(question) ? "review" : status }
        : question)
    }));
    setToast(status === "verified" ? "Selected questions checked" : "Selected questions marked for review");
  }

  function bulkSetTopic(questionIds: string[], topic: string) {
    const ids = new Set(questionIds);
    updateActiveSet((set) => ({ ...set, questions: set.questions.map((question) => ids.has(question.id) ? { ...question, topic } : question) }));
    setToast(`Topic changed to ${topic}`);
  }

  function deleteStudySet(setId: string) {
    const set = studySets.find((item) => item.id === setId);
    if (!set || !window.confirm(`Delete “${set.title}”?`)) return;
    setStudySets((current) => current.filter((item) => item.id !== setId));
    if (activeSetId === setId) setActiveSetId(null);
    setToast("Study set deleted");
    navigate("library");
  }

  function openSetup() {
    if (!activeSet) return;
    const verified = activeSet.questions.filter(isVerifiedQuestion);
    if (!verified.length) {
      setToast("Mark at least one correct answer before starting an exam");
      return;
    }
    setSettings((current) => ({ ...current, questionCount: Math.min(current.questionCount || verified.length, verified.length) }));
    navigate("setup");
  }

  function beginExam(questionIds?: string[]) {
    if (!activeSet) return;
    let pool = activeSet.questions.filter(isVerifiedQuestion);
    if (questionIds?.length) pool = pool.filter((question) => questionIds.includes(question.id));
    if (!questionIds?.length && settings.topicFilter && settings.topicFilter !== "All topics") {
      pool = pool.filter((question) => (question.topic || "General") === settings.topicFilter);
    }
    if (!questionIds?.length && settings.weakAreasOnly) {
      const weak = new Set(weakTopics(activeSet.attempts));
      if (weak.size) pool = pool.filter((question) => weak.has(question.topic || "General"));
    }
    if (!pool.length) {
      setToast("No verified questions match these filters");
      return;
    }

    const count = Math.min(questionIds?.length || settings.questionCount || pool.length, pool.length);
    const selected = settings.shuffleQuestions ? shuffle(pool).slice(0, count) : pool.slice(0, count);
    const examQuestions: ExamQuestion[] = selected.map((question) => {
      const options = question.options.map((option) => ({ ...option, originalId: option.id }));
      return { ...question, options: settings.shuffleAnswers ? shuffle(options) : options };
    });

    const session: ExamSession = {
      questions: examQuestions,
      responses: {},
      flagged: {},
      currentIndex: 0,
      startedAt: Date.now(),
      remainingSeconds: settings.timed ? settings.minutes * 60 : 0,
      lifelines: {
        fiftyFiftyUsed: false,
        audiencePollUsed: false,
        timeFreezeUsed: false,
        clueUsed: false,
        removedOptionIds: {},
        audiencePolls: {},
        clues: {}
      }
    };
    setExam(session);
    setResultDetails([]);
    setSubmitReviewOpen(false);
    clearExamRecovery();
    navigate("exam");
  }

  function answerQuestion(optionId: string) {
    if (!exam) return;
    const question = exam.questions[exam.currentIndex];
    const current = exam.responses[question.id] ?? [];
    const next = isMultipleQuestion(question)
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : [optionId];
    setExam({ ...exam, responses: { ...exam.responses, [question.id]: next } });
  }

  function toggleFlag() {
    if (!exam) return;
    const question = exam.questions[exam.currentIndex];
    setExam({ ...exam, flagged: { ...exam.flagged, [question.id]: !exam.flagged[question.id] } });
  }

  function moveQuestion(index: number) {
    if (!exam) return;
    setExam({ ...exam, currentIndex: Math.min(Math.max(index, 0), exam.questions.length - 1) });
  }

  function useFiftyFifty() {
    if (!exam || !settings.lifelineFiftyFifty) return;
    const question = exam.questions[exam.currentIndex];
    const lifelines = exam.lifelines;
    if (lifelines?.fiftyFiftyUsed) {
      setToast("50:50 has already been used in this exam");
      return;
    }
    if (isMultipleQuestion(question)) {
      setToast("50:50 is available only for single-answer questions");
      return;
    }
    const correctIds = new Set(getCorrectIds(question));
    const selected = new Set(exam.responses[question.id] ?? []);
    const wrong = question.options.filter((option) => !correctIds.has(option.id));
    if (wrong.length <= 1) {
      setToast("This question already has only two choices");
      return;
    }
    const preferred = wrong.filter((option) => !selected.has(option.id));
    const candidates = [...shuffle(preferred), ...shuffle(wrong.filter((option) => selected.has(option.id)))];
    const removeCount = Math.max(1, question.options.length - 2);
    const removed = candidates.slice(0, removeCount).map((option) => option.id);
    setExam({
      ...exam,
      responses: { ...exam.responses, [question.id]: (exam.responses[question.id] ?? []).filter((id) => !removed.includes(id)) },
      lifelines: {
        fiftyFiftyUsed: true,
        audiencePollUsed: lifelines?.audiencePollUsed ?? false,
        timeFreezeUsed: lifelines?.timeFreezeUsed ?? false,
        clueUsed: lifelines?.clueUsed ?? false,
        removedOptionIds: { ...(lifelines?.removedOptionIds ?? {}), [question.id]: removed },
        audiencePolls: lifelines?.audiencePolls ?? {},
        clues: lifelines?.clues ?? {},
        timerFrozenUntil: lifelines?.timerFrozenUntil
      }
    });
    setToast("50:50 removed two incorrect choices");
  }

  function useAudiencePoll() {
    if (!exam || !settings.lifelineAudiencePoll) return;
    const question = exam.questions[exam.currentIndex];
    const lifelines = exam.lifelines;
    if (lifelines?.audiencePollUsed) {
      setToast("Audience Poll has already been used in this exam");
      return;
    }
    if (isMultipleQuestion(question)) {
      setToast("Audience Poll is available only for single-answer questions");
      return;
    }
    const removed = new Set(lifelines?.removedOptionIds?.[question.id] ?? []);
    const visible = question.options.filter((option) => !removed.has(option.id));
    const correctId = getCorrectIds(question)[0];
    if (!correctId || visible.length < 2) return;
    const correctPercent = visible.length === 2
      ? 68 + Math.floor(Math.random() * 18)
      : 52 + Math.floor(Math.random() * 24);
    const wrong = visible.filter((option) => option.id !== correctId);
    const remainder = 100 - correctPercent;
    const weights = wrong.map(() => Math.random() + 0.25);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const allocations = weights.map((weight) => Math.floor((weight / weightTotal) * remainder));
    let unassigned = remainder - allocations.reduce((sum, value) => sum + value, 0);
    for (let index = 0; unassigned > 0 && wrong.length > 0; index = (index + 1) % wrong.length) {
      allocations[index] += 1;
      unassigned -= 1;
    }
    const poll: Record<string, number> = { [correctId]: correctPercent };
    wrong.forEach((option, index) => { poll[option.id] = allocations[index] ?? 0; });
    setExam({
      ...exam,
      lifelines: {
        fiftyFiftyUsed: lifelines?.fiftyFiftyUsed ?? false,
        audiencePollUsed: true,
        timeFreezeUsed: lifelines?.timeFreezeUsed ?? false,
        clueUsed: lifelines?.clueUsed ?? false,
        removedOptionIds: lifelines?.removedOptionIds ?? {},
        audiencePolls: { ...(lifelines?.audiencePolls ?? {}), [question.id]: poll },
        clues: lifelines?.clues ?? {},
        timerFrozenUntil: lifelines?.timerFrozenUntil
      }
    });
    setToast("The audience has voted");
  }

  function useTimeFreeze() {
    if (!exam || !settings.lifelineTimeFreeze) return;
    if (!settings.timed) {
      setToast("Time Freeze is available only in timed exams");
      return;
    }
    const lifelines = exam.lifelines;
    if (lifelines?.timeFreezeUsed) {
      setToast("Time Freeze has already been used in this exam");
      return;
    }
    setExam({
      ...exam,
      lifelines: {
        fiftyFiftyUsed: lifelines?.fiftyFiftyUsed ?? false,
        audiencePollUsed: lifelines?.audiencePollUsed ?? false,
        timeFreezeUsed: true,
        clueUsed: lifelines?.clueUsed ?? false,
        removedOptionIds: lifelines?.removedOptionIds ?? {},
        audiencePolls: lifelines?.audiencePolls ?? {},
        clues: lifelines?.clues ?? {},
        timerFrozenUntil: Date.now() + 60_000
      }
    });
    setToast("Timer frozen for 60 seconds");
  }

  function useClue() {
    if (!exam || !settings.lifelineClue) return;
    const question = exam.questions[exam.currentIndex];
    const lifelines = exam.lifelines;
    if (lifelines?.clueUsed) {
      setToast("Clue has already been used in this exam");
      return;
    }
    const clue = question.explanation.trim()
      || [question.sourcePage ? `Review source page ${question.sourcePage}.` : "", question.topic ? `Focus on the ${question.topic} concept.` : ""].filter(Boolean).join(" ")
      || "Compare each choice with the exact wording of the question and eliminate answers that introduce unrelated details.";
    setExam({
      ...exam,
      lifelines: {
        fiftyFiftyUsed: lifelines?.fiftyFiftyUsed ?? false,
        audiencePollUsed: lifelines?.audiencePollUsed ?? false,
        timeFreezeUsed: lifelines?.timeFreezeUsed ?? false,
        clueUsed: true,
        removedOptionIds: lifelines?.removedOptionIds ?? {},
        audiencePolls: lifelines?.audiencePolls ?? {},
        clues: { ...(lifelines?.clues ?? {}), [question.id]: clue },
        timerFrozenUntil: lifelines?.timerFrozenUntil
      }
    });
    setToast("Clue revealed");
  }

  function requestExamSubmit() {
    if (!exam) return;
    setSubmitReviewOpen(true);
  }

  function finalizeExam(autoSubmitted = false) {
    if (!exam || !activeSet) return;
    const details = exam.questions.map((question) => {
      const selectedOptionIds = exam.responses[question.id] ?? [];
      const correctOptionIds = getCorrectIds(question);
      return {
        question,
        selectedOptionIds,
        correct: selectedOptionIds.length > 0 && sameAnswerSet(selectedOptionIds, correctOptionIds)
      };
    });
    const correct = details.filter((detail) => detail.correct).length;
    const total = details.length;
    const score = Math.round((correct / total) * 100);
    const durationSeconds = Math.max(0, Math.round((Date.now() - exam.startedAt) / 1000));
    const attempt = {
      id: uid(),
      date: new Date().toISOString(),
      score,
      correct,
      total,
      durationSeconds,
      results: details.map((detail) => ({
        questionId: detail.question.id,
        topic: detail.question.topic || "General",
        correct: detail.correct
      }))
    };
    updateActiveSet((set) => ({ ...set, attempts: [attempt, ...set.attempts].slice(0, 30) }));
    setExam({ ...exam, submittedAt: Date.now() });
    setResultDetails(details);
    setSubmitReviewOpen(false);
    clearExamRecovery();
    setRecoveryAvailable(false);
    if (autoSubmitted) setToast("Time expired — the exam was submitted");
    navigate("results");
  }

  const allAttempts = useMemo(() => studySets.flatMap((set) => set.attempts.map((attempt) => ({ ...attempt, setTitle: set.title }))), [studySets]);
  const averageScore = allAttempts.length ? Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / allAttempts.length) : 0;

  return (
    <div className="app-root">
      {view === "exam" ? (
        <ExamView
          exam={exam}
          settings={settings}
          onAnswer={answerQuestion}
          onFlag={toggleFlag}
          onMove={moveQuestion}
          onSubmit={requestExamSubmit}
          reviewOpen={submitReviewOpen}
          onCloseReview={() => setSubmitReviewOpen(false)}
          onConfirmSubmit={() => finalizeExam(false)}
          onFiftyFifty={useFiftyFifty}
          onAudiencePoll={useAudiencePoll}
          onTimeFreeze={useTimeFreeze}
          onClue={useClue}
        />
      ) : view === "results" ? (
        <ResultsView
          details={resultDetails}
          settings={settings}
          exam={exam}
          onRetake={() => beginExam()}
          onRetakeWrong={() => beginExam(resultDetails.filter((detail) => !detail.correct).map((detail) => detail.question.id))}
          onDashboard={() => navigate("dashboard")}
        />
      ) : (
        <Shell
          view={view}
          theme={theme}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((current) => !current)}
          onNavigate={navigate}
          onTheme={toggleTheme}
          onNew={newStudySet}
        >
          {view === "dashboard" && (
            <Dashboard
              studySets={studySets}
              attempts={allAttempts.length}
              averageScore={averageScore}
              onNew={newStudySet}
              onOpen={openSet}
              onNavigate={navigate}
              recoveryAvailable={recoveryAvailable}
              onResumeExam={resumeRecoveredExam}
            />
          )}
          {view === "library" && (
            <LibraryView
              studySets={studySets}
              search={search}
              onSearch={setSearch}
              onOpen={openSet}
              onNew={newStudySet}
            />
          )}
          {view === "performance" && <PerformanceView studySets={studySets} attempts={allAttempts} averageScore={averageScore} />}
          {view === "upload" && (
            <UploadView
              file={selectedFile}
              pasteSections={pasteSections}
              title={studyTitle}
              dragging={dragging}
              aiEnhanced={aiEnhanced}
              aiConfigured={aiConfigured}
              recoveredFileName={recoveredFileName}
              error={error}
              fileInputRef={fileInputRef}
              onFile={(file) => { setSelectedFile(file); if (file) setRecoveredFileName(""); }}
              onUpdatePasteSection={updatePasteSection}
              onAddPasteSection={addPasteSection}
              onRemovePasteSection={removePasteSection}
              onTitle={setStudyTitle}
              onDragging={setDragging}
              onAi={setAiEnhanced}
              onClearDraft={clearStudyDraft}
              onCreate={createStudySet}
              onCancel={() => navigate("dashboard")}
            />
          )}
          {view === "processing" && (
            <ProcessingView
              fileName={selectedFile?.name || (pasteSections.filter((section) => section.question.trim()).length > 1
                ? `${pasteSections.filter((section) => section.question.trim()).length} manual questions`
                : pasteSections.find((section) => section.question.trim())?.title || "Manually added question")}
              progress={processingProgress}
              step={processingStep}
              activeLabel={processingLabel}
            />
          )}
          {view === "import-preview" && pendingImport && (
            <ImportPreviewView
              pending={pendingImport}
              onToggle={togglePendingQuestion}
              onSelectMode={selectPendingQuestions}
              onUpdateQuestion={updatePendingQuestion}
              onUpdateAnswer={updatePendingAnswer}
              onBack={() => navigate("upload")}
              onConfirm={confirmPendingImport}
            />
          )}
          {view === "editor" && activeSet && editingQuestion && (
            <EditorView
              studySet={activeSet}
              question={editingQuestion}
              onSelect={setEditingQuestionId}
              onUpdateQuestion={updateQuestion}
              onUpdateOption={updateOption}
              onMarkCorrect={markCorrect}
              onSelectionMode={setSelectionMode}
              onAddOption={addOption}
              onRemoveOption={removeOption}
              onAddQuestion={addQuestion}
              onDuplicate={duplicateQuestion}
              onDelete={deleteQuestion}
              onBulkDelete={bulkDeleteQuestions}
              onBulkStatus={bulkSetStatus}
              onBulkTopic={bulkSetTopic}
              onDeleteSet={deleteStudySet}
              onSetup={openSetup}
              onDashboard={() => navigate("dashboard")}
            />
          )}
          {view === "setup" && activeSet && (
            <SetupView
              studySet={activeSet}
              settings={settings}
              onSettings={setSettings}
              onBack={() => navigate("editor")}
              onStart={() => beginExam()}
            />
          )}
        </Shell>
      )}
      {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span><span>{toast}</span><i /></div>}
    </div>
  );
}

interface ShellProps {
  view: View;
  theme: "light" | "dark";
  sidebarOpen: boolean;
  children: React.ReactNode;
  onToggleSidebar: () => void;
  onNavigate: (view: View) => void;
  onTheme: () => void;
  onNew: () => void;
}

function Shell({ view, theme, sidebarOpen, children, onToggleSidebar, onNavigate, onTheme, onNew }: ShellProps) {
  const nav = [
    { id: "dashboard" as View, label: "Home", icon: Home },
    { id: "library" as View, label: "Library", icon: Library },
    { id: "performance" as View, label: "Performance", icon: BarChart3 }
  ];
  return (
    <div className="app-shell">
      <button className="mobile-menu" type="button" aria-label="Toggle navigation" onClick={onToggleSidebar}><Menu size={20} /></button>
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={onToggleSidebar} />}
      <aside className={`sidebar streamlined-sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="brand" type="button" onClick={() => onNavigate("dashboard")}>
          <span className="brand-mark">Q</span>
          <span><strong>QuizForge</strong><small>Study smarter</small></span>
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => onNavigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <button className="primary-button sidebar-create-button" type="button" onClick={onNew}><Plus size={17} /> Create study set</button>
        <div className="sidebar-spacer" />
        <p className="local-workspace-note"><CheckCircle2 size={15} /> Saved locally in this browser</p>
      </aside>
      <main className="main-content">
        <header className="global-topbar simplified-topbar">
          <div className="mobile-brand"><span className="brand-mark">Q</span><strong>QuizForge</strong></div>
          <div className="global-actions"><button className="icon-button" type="button" aria-label="Toggle theme" onClick={onTheme}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button></div>
        </header>
        <div key={view} className="view-transition">{children}</div>
      </main>
    </div>
  );
}


interface DashboardProps {
  studySets: StudySet[];
  attempts: number;
  averageScore: number;
  onNew: () => void;
  onOpen: (setId: string, target?: View) => void;
  onNavigate: (view: View) => void;
  recoveryAvailable: boolean;
  onResumeExam: () => void;
}

function Dashboard({ studySets, attempts, averageScore, onNew, onOpen, onNavigate, recoveryAvailable, onResumeExam }: DashboardProps) {
  const recent = studySets.slice(0, 3);
  const totalQuestions = studySets.reduce((sum, set) => sum + set.questions.length, 0);
  return (
    <div className="page-wrap dashboard-page">
      <section className="welcome-row">
        <div><p className="eyebrow">QUIZFORGE</p><h1>Build your next practice exam</h1><p>Import a PDF, add questions manually, and study with a focused mock-exam experience.</p></div>
      </section>
      {recoveryAvailable && <section className="recovery-banner"><span className="recovery-icon"><ArchiveRestore size={20} /></span><div><strong>Unfinished exam recovered</strong><p>Your answers, timer, flags, and current question were saved automatically.</p></div><button className="primary-button compact" type="button" onClick={onResumeExam}>Resume exam <ChevronRight size={15} /></button></section>}
      <section className="hero-card streamlined-hero">
        <div className="hero-copy">
          <span className="pill"><FileText size={14} /> SMART PDF IMPORT</span>
          <h2>From study material to a <em>practice exam.</em></h2>
          <p>Review detected questions before saving, edit anything that needs attention, and create randomized tests when you are ready.</p>
          <div className="hero-actions"><button className="primary-button large" type="button" onClick={onNew}><Plus size={18} /> Create study set <ChevronRight size={17} /></button></div>
          <div className="privacy-line"><Check size={15} /> Text-based PDF extraction happens in your browser</div>
        </div>
        <div className="upload-visual" aria-hidden="true">
          <div className="upload-orbit orbit-one" /><div className="upload-orbit orbit-two" />
          <div className="file-card rear"><span>PDF</span><i /><i /><i /></div>
          <div className="file-card front"><div className="file-icon">PDF</div><strong>Reviewer.pdf</strong><small>Ready to review</small><div className="mini-progress"><span /></div></div>
          <div className="floating-chip chip-one">Questions detected</div><div className="floating-chip chip-two">Answer key matched <Check size={12} /></div>
        </div>
      </section>
      <section className="metric-grid" aria-label="Study overview">
        <Metric label="Study sets" value={studySets.length} note="Saved locally" icon={<BookOpen size={18} />} />
        <Metric label="Questions" value={totalQuestions} note="Across your library" icon={<CircleHelp size={18} />} />
        <Metric label="Attempts" value={attempts} note="Completed exams" icon={<Clock3 size={18} />} />
        <Metric label="Average" value={attempts ? `${averageScore}%` : "—"} note="All attempts" icon={<BarChart3 size={18} />} />
      </section>
      <section className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h3>{studySets.length ? "Continue studying" : "Start your first study set"}</h3></div>{studySets.length > 3 && <button className="text-button" type="button" onClick={() => onNavigate("library")}>View all <ChevronRight size={15} /></button>}</section>
      {studySets.length ? <section className="study-grid">{recent.map((set, index) => <StudyCard key={set.id} studySet={set} index={index} onOpen={onOpen} />)}<button className="new-card" type="button" onClick={onNew}><span className="new-icon"><Plus size={22} /></span><strong>Create a study set</strong><p>Import a PDF or add your own questions.</p></button></section> : <section className="empty-library-hero"><span><BookOpen size={28} /></span><h3>No study sets yet</h3><p>Create one from a text-based PDF or build the questions manually.</p><button className="primary-button" type="button" onClick={onNew}><Plus size={17} /> Create study set</button></section>}
    </div>
  );
}


function Metric({ label, value, note, icon }: { label: string; value: string | number; note: string; icon: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-icon">{icon}</div><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>;
}

function StudyCard({ studySet, index, onOpen }: { studySet: StudySet; index: number; onOpen: (setId: string, target?: View) => void }) {
  const verified = studySet.questions.filter((question) => question.correctOptionId).length;
  const best = bestScore(studySet.attempts);
  const shades = ["purple", "cyan", "orange"];
  return (
    <article className="study-card">
      <div className="study-top"><span className={`subject-icon ${shades[index % shades.length]}`}>{studySet.title.slice(0, 2).toUpperCase()}</span><span className={`status ${verified === studySet.questions.length ? "ready" : "draft"}`}>{verified === studySet.questions.length ? "Ready" : "Review"}</span></div>
      <h4>{studySet.title}</h4>
      <p>{studySet.questions.length} questions · Updated {formatDate(studySet.updatedAt)}</p>
      <div className="progress-meta"><span>{studySet.attempts.length ? "Best score" : "Answers verified"}</span><strong>{studySet.attempts.length ? `${best}%` : `${Math.round((verified / studySet.questions.length) * 100)}%`}</strong></div>
      <div className="progress-track"><span style={{ width: `${studySet.attempts.length ? best : (verified / studySet.questions.length) * 100}%` }} /></div>
      <button className="card-button" type="button" onClick={() => onOpen(studySet.id, studySet.attempts.length ? "setup" : "editor")}>{studySet.attempts.length ? "Practice again" : "Review questions"}<ChevronRight size={14} /></button>
    </article>
  );
}

interface LibraryProps {
  studySets: StudySet[];
  search: string;
  onSearch: (value: string) => void;
  onOpen: (setId: string, target?: View) => void;
  onNew: () => void;
}

function LibraryView({ studySets, search, onSearch, onOpen, onNew }: LibraryProps) {
  const filtered = studySets.filter((set) => set.title.toLowerCase().includes(search.toLowerCase()) || set.sourceName.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="page-wrap">
      <div className="page-head"><div><p className="eyebrow">YOUR LIBRARY</p><h1>Study sets</h1><p>Manage extracted questions and start new practice attempts.</p></div><button className="primary-button" type="button" onClick={onNew}><Plus size={17} /> New set</button></div>
      <label className="search-box"><Search size={18} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search study sets" /></label>
      <section className="library-list">
        {filtered.map((set, index) => (
          <article className="library-row" key={set.id}>
            <span className={`subject-icon ${["purple", "cyan", "orange"][index % 3]}`}>{set.title.slice(0, 2).toUpperCase()}</span>
            <div className="library-copy"><strong>{set.title}</strong><span>{set.questions.length} questions · {set.attempts.length} attempt{set.attempts.length === 1 ? "" : "s"} · {set.sourceName}</span></div>
            <div className="library-score"><small>Best score</small><strong>{set.attempts.length ? `${bestScore(set.attempts)}%` : "—"}</strong></div>
            <button className="secondary-button compact" type="button" onClick={() => onOpen(set.id)}>Open <ChevronRight size={15} /></button>
          </article>
        ))}
        {!filtered.length && <div className="empty-state"><FolderOpen size={35} /><strong>No study sets found</strong><p>Try another search or create a new set.</p></div>}
      </section>
    </div>
  );
}

function PerformanceView({ studySets, attempts, averageScore }: { studySets: StudySet[]; attempts: Array<{ id: string; score: number; date: string; setTitle: string; correct: number; total: number; durationSeconds: number; results?: Array<{ questionId: string; topic: string; correct: boolean }> }>; averageScore: number }) {
  const best = attempts.reduce((score, attempt) => Math.max(score, attempt.score), 0);
  const recent = [...attempts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const topicStats = computeTopicPerformance(attempts);
  const weakest = topicStats[0];
  return (
    <div className="page-wrap">
      <div className="page-head"><div><p className="eyebrow">PERFORMANCE</p><h1>Your progress</h1><p>Track scores, identify weak topics, and build targeted practice exams.</p></div></div>
      <section className="metric-grid performance-metrics">
        <Metric label="Average score" value={attempts.length ? `${averageScore}%` : "—"} note={`${attempts.length} completed attempts`} icon={<BarChart3 size={18} />} />
        <Metric label="Personal best" value={attempts.length ? `${best}%` : "—"} note="Highest attempt" icon={<Sparkles size={18} />} />
        <Metric label="Weakest topic" value={weakest ? `${weakest.accuracy}%` : "—"} note={weakest?.topic ?? "More attempts needed"} icon={<Target size={18} />} />
        <Metric label="Questions practiced" value={attempts.reduce((sum, attempt) => sum + attempt.total, 0)} note="All attempts" icon={<CircleHelp size={18} />} />
      </section>

      <section className="performance-panel topic-performance-panel">
        <div className="section-heading"><div><p className="eyebrow">TOPIC BREAKDOWN</p><h3>Where to focus next</h3></div></div>
        {topicStats.length ? <div className="topic-performance-list">{topicStats.map((topic) => <article className="topic-performance-row" key={topic.topic}><div className="topic-performance-copy"><span className="topic-icon"><Tag size={15} /></span><div><strong>{topic.topic}</strong><small>{topic.correct} of {topic.total} correct · {topic.attempts} attempt{topic.attempts === 1 ? "" : "s"}</small></div></div><div className="topic-performance-bar"><span style={{ width: `${topic.accuracy}%` }} /></div><strong className={topic.accuracy >= 70 ? "good-score" : "low-score"}>{topic.accuracy}%</strong></article>)}</div> : <div className="empty-state compact-empty"><Target size={34} /><strong>No topic data yet</strong><p>New attempts will record per-topic accuracy automatically.</p></div>}
      </section>

      <section className="performance-panel">
        <div className="section-heading"><div><p className="eyebrow">RECENT ATTEMPTS</p><h3>Exam history</h3></div></div>
        {recent.length ? recent.map((attempt) => (
          <div className="attempt-row" key={`${attempt.date}-${attempt.setTitle}`}>
            <div><strong>{attempt.setTitle}</strong><span>{formatDate(attempt.date)} · {formatDuration(attempt.durationSeconds)}</span></div>
            <div className="attempt-bar"><span style={{ width: `${attempt.score}%` }} /></div>
            <strong className={attempt.score >= 70 ? "good-score" : "low-score"}>{attempt.score}%</strong>
          </div>
        )) : <div className="empty-state compact-empty"><BarChart3 size={34} /><strong>No attempts yet</strong><p>Complete a mock exam to see your results here.</p></div>}
      </section>
    </div>
  );
}

interface UploadProps {
  file: File | null;
  pasteSections: PasteSection[];
  title: string;
  dragging: boolean;
  aiEnhanced: boolean;
  aiConfigured: boolean;
  recoveredFileName?: string;
  error: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
  onUpdatePasteSection: (id: string, patch: Partial<PasteSection>) => void;
  onAddPasteSection: () => void;
  onRemovePasteSection: (id: string) => void;
  onTitle: (title: string) => void;
  onDragging: (dragging: boolean) => void;
  onAi: (enabled: boolean) => void;
  onClearDraft: () => void;
  onCreate: () => void;
  onCancel: () => void;
}

function UploadView({
  file,
  pasteSections,
  title,
  dragging,
  aiEnhanced,
  aiConfigured,
  recoveredFileName,
  error,
  fileInputRef,
  onFile,
  onUpdatePasteSection,
  onAddPasteSection,
  onRemovePasteSection,
  onTitle,
  onDragging,
  onAi,
  onClearDraft,
  onCreate,
  onCancel
}: UploadProps) {
  function acceptFile(candidate?: File) {
    if (!candidate) return;
    const supported = candidate.type === "application/pdf" || /\.pdf$/i.test(candidate.name);
    if (!supported) return;
    onFile(candidate);
    if (!title.trim()) onTitle(stripExtension(candidate.name));
  }

  function updateAnswer(section: PasteSection, answerId: string, patch: Partial<PasteAnswerDraft>) {
    onUpdatePasteSection(section.id, {
      answers: section.answers.map((answer) => answer.id === answerId ? { ...answer, ...patch } : answer)
    });
  }

  function toggleCorrect(section: PasteSection, answerId: string) {
    const target = section.answers.find((answer) => answer.id === answerId);
    if (!target) return;
    onUpdatePasteSection(section.id, {
      answers: section.answers.map((answer) => {
        if (section.selectionMode === "multiple") return answer.id === answerId ? { ...answer, correct: !answer.correct } : answer;
        return { ...answer, correct: answer.id === answerId ? !target.correct : false };
      })
    });
  }

  function setSelectionMode(section: PasteSection, selectionMode: "single" | "multiple") {
    const firstCorrect = section.answers.find((answer) => answer.correct)?.id;
    onUpdatePasteSection(section.id, {
      selectionMode,
      answers: selectionMode === "single"
        ? section.answers.map((answer) => ({ ...answer, correct: answer.id === firstCorrect }))
        : section.answers
    });
  }

  function addAnswer(section: PasteSection) {
    onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true, answers: [...section.answers, createPasteAnswer()] });
  }

  function removeAnswer(section: PasteSection, answerId: string) {
    if (section.answers.length <= 2) return;
    onUpdatePasteSection(section.id, { answers: section.answers.filter((answer) => answer.id !== answerId) });
  }

  const completedSections = pasteSections.filter((section) => section.question.trim().length >= 3).length;
  const expandedCount = pasteSections.filter((section) => section.expanded).length;

  return (
    <div className="page-wrap upload-page streamlined-builder-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">CREATE STUDY SET</p>
          <h1>Import a PDF or build it manually</h1>
          <p>Use a text-based PDF, or add questions one by one in the manual builder.</p>
        </div>
        <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
      </div>

      {recoveredFileName && !file && <div className="recovery-note"><ArchiveRestore size={18} /><span><strong>Draft restored.</strong> Your manual questions were recovered. Reselect “{recoveredFileName}” only if you still want to import that PDF.</span></div>}
      {error && <div className="error-banner"><X size={18} /><span>{error}</span></div>}

      <section className="streamlined-create-panel">
        <label className="field-label" htmlFor="set-title">Study set title</label>
        <input id="set-title" className="text-input set-title-input" value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Example: Biology Midterm Reviewer" />

        <div
          className={`drop-zone compact-drop-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); onDragging(true); }}
          onDragLeave={() => onDragging(false)}
          onDrop={(event) => { event.preventDefault(); onDragging(false); acceptFile(event.dataTransfer.files?.[0]); }}
        >
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => acceptFile(event.target.files?.[0])} />
          <div className="drop-zone-copy">
            <span className="big-upload"><Upload size={24} /></span>
            <span><strong>{file ? file.name : "Drop a text-based PDF here"}</strong><small>{file ? `${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)} MB · ready to import` : "or browse your computer"}</small></span>
          </div>
          <div className="drop-zone-actions">
            {file && <button className="icon-button" type="button" aria-label="Remove PDF" onClick={() => onFile(null)}><X size={16} /></button>}
            <button className="secondary-button compact" type="button" onClick={() => fileInputRef.current?.click()}>{file ? "Replace" : "Browse PDF"}</button>
          </div>
        </div>
        <p className="scan-coming-soon"><AlertTriangle size={14} /> Scanned-image PDF OCR is temporarily unavailable. Text-based PDFs work normally.</p>

        <div className="or-divider"><span>or build questions manually</span></div>

        <div className="manual-builder-heading simplified-heading">
          <div>
            <p className="eyebrow">MANUAL BUILDER</p>
            <h2>Questions stay compact until you open them.</h2>
            <p>Only one question opens at a time, so long reviewers remain easy to scan.</p>
          </div>
          {expandedCount > 0 && <button className="text-button" type="button" onClick={() => pasteSections.forEach((section) => onUpdatePasteSection(section.id, { expanded: false }))}>Collapse all</button>}
        </div>

        <div className="manual-question-list accordion-list">
          {pasteSections.map((section, index) => {
            const answerCount = section.answers.filter((answer) => answer.text.trim()).length;
            const correctCount = section.answers.filter((answer) => answer.correct).length;
            const complete = Boolean(section.question.trim().length >= 3 && answerCount >= 2 && correctCount > 0);
            const summary = section.question.trim() || "Untitled question";
            return (
              <article className={`manual-question-card accordion-card ${section.expanded ? "expanded" : "collapsed"}`} key={section.id}>
                <div className="manual-question-head accordion-head">
                  <button className="manual-question-toggle" type="button" onClick={() => onUpdatePasteSection(section.id, { expanded: !section.expanded })} aria-expanded={section.expanded}>
                    <span className="manual-question-number">{index + 1}</span>
                    <span className="manual-question-summary">
                      <strong>Question {index + 1}</strong>
                      <b>{summary}</b>
                      <small>{answerCount} choice{answerCount === 1 ? "" : "s"} · {correctCount ? `${correctCount} correct` : "correct answer not selected"}</small>
                    </span>
                    <span className={`question-completion ${complete ? "complete" : "needs"}`}>{complete ? <CheckCircle2 size={15} /> : <CircleHelp size={15} />}{complete ? "Complete" : "Needs attention"}</span>
                    <ChevronRight className={`accordion-chevron ${section.expanded ? "open" : ""}`} size={18} />
                  </button>
                  <button className="remove-section-button" type="button" aria-label={`Remove question ${index + 1}`} onClick={() => onRemovePasteSection(section.id)}><Trash2 size={17} /></button>
                </div>

                {section.expanded && (
                  <div className="accordion-content">
                    <div className="manual-question-tabs" role="tablist" aria-label={`Question ${index + 1} editor tabs`}>
                      <button type="button" role="tab" aria-selected={section.activeTab === "question"} className={section.activeTab === "question" ? "active" : ""} onClick={() => onUpdatePasteSection(section.id, { activeTab: "question", expanded: true })}><CircleHelp size={17} /> Question</button>
                      <button type="button" role="tab" aria-selected={section.activeTab === "answers"} className={section.activeTab === "answers" ? "active" : ""} onClick={() => onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true })}><CheckCircle2 size={17} /> Answers <span>{section.answers.length}</span></button>
                    </div>

                    {section.activeTab === "question" ? (
                      <div className="manual-tab-panel question-tab-panel" role="tabpanel">
                        <label className="field-label" htmlFor={`manual-question-${section.id}`}>Question text</label>
                        <textarea id={`manual-question-${section.id}`} className="manual-question-input" value={section.question} onChange={(event) => onUpdatePasteSection(section.id, { question: event.target.value })} placeholder="Example: What is the capital of Japan?" />
                        <label className="single-meta-field"><span>Topic</span><input className="text-input" value={section.topic} onChange={(event) => onUpdatePasteSection(section.id, { topic: event.target.value })} placeholder="General" /></label>
                        <div className="manual-panel-footer"><span>Saved automatically in this browser.</span><button className="primary-button compact" type="button" onClick={() => onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true })}>Continue to answers <ChevronRight size={16} /></button></div>
                      </div>
                    ) : (
                      <div className="manual-tab-panel answers-tab-panel" role="tabpanel">
                        <div className="manual-answers-toolbar">
                          <div><strong>Answer choices</strong><small>Choose whether one or several answers are correct.</small></div>
                          <div className="manual-mode-toggle" aria-label="Correct-answer mode"><button type="button" className={section.selectionMode === "single" ? "active" : ""} onClick={() => setSelectionMode(section, "single")}>Single correct</button><button type="button" className={section.selectionMode === "multiple" ? "active" : ""} onClick={() => setSelectionMode(section, "multiple")}>Multiple correct</button></div>
                        </div>
                        <div className="manual-answer-list">
                          {section.answers.map((answer, answerIndex) => (
                            <div className={`manual-answer-row ${answer.correct ? "correct" : ""}`} key={answer.id}>
                              <span className="manual-answer-letter">{String.fromCharCode(65 + answerIndex)}</span>
                              <input value={answer.text} onChange={(event) => updateAnswer(section, answer.id, { text: event.target.value })} placeholder={`Answer choice ${String.fromCharCode(65 + answerIndex)}`} aria-label={`Question ${index + 1} answer ${String.fromCharCode(65 + answerIndex)}`} />
                              <button className={`manual-correct-button ${answer.correct ? "selected" : ""}`} type="button" onClick={() => toggleCorrect(section, answer.id)} aria-label={answer.correct ? "Unmark correct answer" : "Mark correct answer"}><Check size={17} /><span>{answer.correct ? "Correct" : "Mark correct"}</span></button>
                              <button className="manual-remove-answer" type="button" disabled={section.answers.length <= 2} onClick={() => removeAnswer(section, answer.id)} aria-label={`Remove answer ${String.fromCharCode(65 + answerIndex)}`}><X size={16} /></button>
                            </div>
                          ))}
                        </div>
                        <button className="add-answer-button" type="button" onClick={() => addAnswer(section)}><Plus size={17} /> Add answer choice</button>
                        <div className="manual-panel-footer"><button className="text-button" type="button" onClick={() => onUpdatePasteSection(section.id, { activeTab: "question", expanded: true })}><ChevronLeft size={15} /> Back to question</button><button className="secondary-button compact" type="button" onClick={() => onUpdatePasteSection(section.id, { expanded: false })}>Done with question {index + 1}</button></div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <button className="add-paste-section-button add-manual-question-button" type="button" onClick={onAddPasteSection}><span><Plus size={20} /></span><strong>Add question</strong><small>The current question collapses and the new question opens automatically</small></button>

        {aiConfigured && <label className="switch-row ai-import-switch"><span><Bot size={19} /><span><strong>AI import assistance</strong><small>Review the local extraction, repair clear formatting problems, add confidence notes, and flag uncertain answers before saving.</small></span></span><input type="checkbox" checked={aiEnhanced} onChange={(event) => onAi(event.target.checked)} /></label>}

        <div className="create-builder-footer">
          <div><strong>{file ? "PDF ready" : `${completedSections} manual question${completedSections === 1 ? "" : "s"}`}</strong><small>{aiEnhanced ? "AI assistance is enabled; extracted text will be sent securely to your server-side AI endpoint." : "Your document and draft stay local in this browser."}</small></div>
          <button className="primary-button create-button" type="button" onClick={onCreate}><Sparkles size={18} /> Review study set <ChevronRight size={17} /></button>
        </div>
        {(title.trim() || completedSections || file) && <button className="text-button clear-draft-button" type="button" onClick={onClearDraft}>Clear saved draft</button>}
      </section>
    </div>
  );
}


function ProcessingView({ fileName, progress, step, activeLabel }: { fileName: string; progress: number; step: ProcessingStep; activeLabel: string }) {
  const steps: Array<{ id: ProcessingStep; label: string }> = [
    { id: "read", label: activeLabel },
    { id: "detect", label: "Detecting questions and choices" },
    { id: "answers", label: activeLabel },
    { id: "finish", label: "Preparing the review screen" }
  ];
  const currentIndex = steps.findIndex((item) => item.id === step);
  return (
    <div className="processing-page">
      <section className="processing-card">
        <div className="processor"><Sparkles size={30} /></div>
        <span className="pill"><WandSparkles size={14} /> BUILDING STUDY SET</span>
        <h1>Turning your material into a mock exam</h1>
        <p>{fileName}</p>
        <div className="process-progress"><span style={{ width: `${progress}%` }} /></div>
        <strong className="progress-number">{progress}%</strong>
        <div className="process-list">
          {steps.map((item, index) => (
            <div className={`process-step ${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}`} key={item.id}>
              <span className="step-dot">{index < currentIndex ? <Check size={15} /> : index + 1}</span><span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}


interface ImportPreviewProps {
  pending: PendingImport;
  onToggle: (questionId: string) => void;
  onSelectMode: (mode: "all" | "clean" | "none") => void;
  onUpdateQuestion: (questionId: string, patch: Partial<Question>) => void;
  onUpdateAnswer: (questionId: string, optionId: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

function ImportPreviewView({ pending, onToggle, onSelectMode, onUpdateQuestion, onUpdateAnswer, onBack, onConfirm }: ImportPreviewProps) {
  const [filter, setFilter] = useState<"issues" | "missing" | "all">(() => pending.issues.some((issue) => issue.questionId) ? "issues" : "all");
  const [query, setQuery] = useState("");
  const issuesByQuestion = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    pending.issues.forEach((issue) => {
      if (!issue.questionId) return;
      map.set(issue.questionId, [...(map.get(issue.questionId) ?? []), issue]);
    });
    return map;
  }, [pending.issues]);
  const errorCount = pending.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = pending.issues.filter((issue) => issue.severity === "warning").length;
  const verifiedCount = pending.questions.filter(isVerifiedQuestion).length;
  const selected = new Set(pending.selectedIds);
  const matchesSearch = (question: Question) => `${question.question} ${question.topic ?? ""}`.toLowerCase().includes(query.toLowerCase());
  const attentionQuestions = pending.questions.filter((question) => (issuesByQuestion.get(question.id)?.length ?? 0) > 0 && matchesSearch(question));
  const cleanQuestions = pending.questions.filter((question) => !(issuesByQuestion.get(question.id)?.length ?? 0) && matchesSearch(question));
  const missingQuestions = pending.questions.filter((question) => !isVerifiedQuestion(question) && matchesSearch(question));

  function renderQuestionCard(question: Question) {
    const questionIssues = issuesByQuestion.get(question.id) ?? [];
    const included = selected.has(question.id);
    const correctIds = getCorrectIds(question);
    const questionNumber = pending.questions.indexOf(question) + 1;
    return (
      <article className={`import-question-card ${included ? "included" : "excluded"}`} key={question.id}>
        <div className="import-question-top">
          <label className="include-check"><input type="checkbox" checked={included} onChange={() => onToggle(question.id)} /><span>Include</span></label>
          <span className="question-index">Question {questionNumber}</span>
          <input className="topic-input" value={question.topic ?? "General"} onChange={(event) => onUpdateQuestion(question.id, { topic: event.target.value })} aria-label={`Topic for question ${questionNumber}`} />
          <span className={`status ${isVerifiedQuestion(question) ? "ready" : "draft"}`}>{isVerifiedQuestion(question) ? "Answer ready" : "Needs answer"}</span>
        </div>
        <textarea className="import-question-text" value={question.question} onChange={(event) => onUpdateQuestion(question.id, { question: event.target.value })} />
        {question.aiConfidence !== undefined && (
          <div className={`ai-review-strip ${question.aiConfidence >= 0.85 ? "high" : question.aiConfidence >= 0.75 ? "medium" : "low"}`}>
            <Bot size={16} />
            <span><strong>AI reviewed · {Math.round(question.aiConfidence * 100)}% confidence</strong><small>{question.aiChanged ? (question.aiNotes?.[0] ?? "Formatting or answer structure was repaired.") : "No clear repair was needed."}</small></span>
            {question.aiChanged && <span className="ai-repaired-badge"><WandSparkles size={13} /> Repaired</span>}
          </div>
        )}
        <div className="import-option-grid">
          {question.options.map((option, optionIndex) => {
            const correct = correctIds.includes(option.id);
            return <button type="button" className={`import-option ${correct ? "correct" : ""}`} key={option.id} onClick={() => onUpdateAnswer(question.id, option.id)}><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option.text}</b>{correct && <Check size={15} />}</button>;
          })}
        </div>
        {questionIssues.length > 0 ? <div className="question-issue-list">{questionIssues.map((issue) => <div className={`question-issue ${issue.severity}`} key={issue.id}>{issue.severity === "error" ? <CircleHelp size={14} /> : <AlertTriangle size={14} />}<span><strong>{issue.title}</strong>{issue.message}</span></div>)}</div> : <div className="question-clean"><CheckCircle2 size={15} /> Structure looks good</div>}
      </article>
    );
  }

  return (
    <div className="page-wrap import-preview-page streamlined-import-preview">
      <div className="page-head">
        <div><p className="eyebrow">IMPORT REVIEW</p><h1>Fix only what needs attention</h1><p>Problem questions appear first. Clean questions stay collapsed until you need them.</p></div>
        <div className="toolbar"><button className="ghost-button" type="button" onClick={onBack}><ChevronLeft size={16} /> Back</button><button className="primary-button" type="button" onClick={onConfirm}>Save {pending.selectedIds.length} questions <ChevronRight size={16} /></button></div>
      </div>

      <section className="import-overview-grid compact-overview">
        <Metric label="Prepared" value={pending.questions.length} note={`${pending.expected} detected in source`} icon={<Layers3 size={18} />} />
        <Metric label="Answers found" value={verifiedCount} note={`${pending.questions.length - verifiedCount} need an answer`} icon={<CheckCircle2 size={18} />} />
        <Metric label="Warnings" value={warningCount} note="Review recommended" icon={<AlertTriangle size={18} />} />
        <Metric label="Blocking" value={errorCount} note="Fix or exclude" icon={<CircleHelp size={18} />} />
      </section>

      {(pending.parserWarnings.length > 0 || pending.issues.some((issue) => !issue.questionId)) && <section className="import-global-notes"><AlertTriangle size={19} /><div><strong>Source-level notes</strong>{[...pending.parserWarnings, ...pending.issues.filter((issue) => !issue.questionId).map((issue) => issue.message)].slice(0, 4).map((message) => <p key={message}>{message}</p>)}</div></section>}

      <section className="import-toolbar card-surface simplified-import-toolbar">
        <label className="search-box import-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions or topics" /></label>
        <div className="segmented-control" aria-label="Import filters">
          <button type="button" className={filter === "issues" ? "active" : ""} onClick={() => setFilter("issues")}>Needs attention <span>{attentionQuestions.length}</span></button>
          <button type="button" className={filter === "missing" ? "active" : ""} onClick={() => setFilter("missing")}>Missing answers <span>{missingQuestions.length}</span></button>
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        </div>
        <div className="toolbar import-select-actions"><button className="text-button" type="button" onClick={() => onSelectMode("all")}>Select all</button><button className="text-button" type="button" onClick={() => onSelectMode("clean")}>Select clean</button><button className="text-button" type="button" onClick={() => onSelectMode("none")}>Clear</button></div>
      </section>

      <section className="import-question-list">
        {filter === "issues" && attentionQuestions.map(renderQuestionCard)}
        {filter === "missing" && missingQuestions.map(renderQuestionCard)}
        {filter === "all" && attentionQuestions.map(renderQuestionCard)}
        {filter === "all" && cleanQuestions.length > 0 && (
          <details className="clean-question-disclosure">
            <summary><span><CheckCircle2 size={18} /><strong>View {cleanQuestions.length} clean question{cleanQuestions.length === 1 ? "" : "s"}</strong><small>These questions passed the structural checks.</small></span><ChevronRight size={18} /></summary>
            <div className="clean-question-content">{cleanQuestions.map(renderQuestionCard)}</div>
          </details>
        )}
        {((filter === "issues" && !attentionQuestions.length) || (filter === "missing" && !missingQuestions.length) || (filter === "all" && !attentionQuestions.length && !cleanQuestions.length)) && <div className="empty-state"><CheckCircle2 size={34} /><strong>No questions match this view</strong><p>Try another filter or search term.</p></div>}
      </section>
      <div className="sticky-import-footer"><span><strong>{pending.selectedIds.length}</strong> of {pending.questions.length} selected</span><button className="primary-button" type="button" onClick={onConfirm}>Save to library <ChevronRight size={16} /></button></div>
    </div>
  );
}


interface EditorProps {
  studySet: StudySet;
  question: Question;
  onSelect: (id: string) => void;
  onUpdateQuestion: (id: string, patch: Partial<Question>) => void;
  onUpdateOption: (questionId: string, optionId: string, text: string) => void;
  onMarkCorrect: (questionId: string, optionId: string) => void;
  onSelectionMode: (questionId: string, mode: "single" | "multiple") => void;
  onAddOption: (questionId: string) => void;
  onRemoveOption: (questionId: string, optionId: string) => void;
  onAddQuestion: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onBulkStatus: (ids: string[], status: "verified" | "review") => void;
  onBulkTopic: (ids: string[], topic: string) => void;
  onDeleteSet: (id: string) => void;
  onSetup: () => void;
  onDashboard: () => void;
}

function EditorView({ studySet, question, onSelect, onUpdateQuestion, onUpdateOption, onMarkCorrect, onSelectionMode, onAddOption, onRemoveOption, onAddQuestion, onDuplicate, onDelete, onBulkDelete, onBulkStatus, onBulkTopic, onDeleteSet, onSetup, onDashboard }: EditorProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "review">("all");
  const [topicFilter, setTopicFilter] = useState("All topics");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTopic, setBulkTopic] = useState("General");
  const index = studySet.questions.findIndex((item) => item.id === question.id);
  const verified = studySet.questions.filter(isVerifiedQuestion).length;
  const next = studySet.questions[index + 1];
  const previous = studySet.questions[index - 1];
  const correctIds = getCorrectIds(question);
  const ready = isVerifiedQuestion(question);
  const answerReady = hasValidAnswer(question);
  const multiple = isMultipleQuestion(question);
  const topics = availableTopics(studySet.questions);
  const filteredQuestions = studySet.questions.filter((item) => {
    const matchesQuery = `${item.question} ${item.topic ?? "General"}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "verified" ? isVerifiedQuestion(item) : !isVerifiedQuestion(item));
    const matchesTopic = topicFilter === "All topics" || (item.topic ?? "General") === topicFilter;
    return matchesQuery && matchesStatus && matchesTopic;
  });
  const selectedSet = new Set(selectedIds);
  const allVisibleSelected = filteredQuestions.length > 0 && filteredQuestions.every((item) => selectedSet.has(item.id));

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      if (allVisibleSelected) filteredQuestions.forEach((item) => currentSet.delete(item.id));
      else filteredQuestions.forEach((item) => currentSet.add(item.id));
      return [...currentSet];
    });
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  return (
    <div className="page-wrap editor-page">
      <div className="page-head">
        <div><button className="breadcrumb-button" type="button" onClick={onDashboard}>Dashboard</button><span className="breadcrumb-separator">/</span><span>Review questions</span><h1>Review extracted questions</h1><p>Search, filter, edit, and update several questions at once.</p></div>
        <div className="toolbar"><button className="ghost-button danger-ghost" type="button" onClick={() => onDeleteSet(studySet.id)}><Trash2 size={16} /> Delete set</button><button className="primary-button" type="button" onClick={onSetup}>Set up exam <ChevronRight size={16} /></button></div>
      </div>

      <section className="bulk-editor-toolbar">
        <label className="search-box bulk-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search question text or topic" /></label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "verified" | "review")} aria-label="Filter by status"><option value="all">All statuses</option><option value="verified">Verified</option><option value="review">Needs review</option></select>
        <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} aria-label="Filter by topic"><option>All topics</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select>
        <button className="secondary-button compact" type="button" onClick={toggleAllVisible}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button>
      </section>

      {selectedIds.length > 0 && (
        <section className="bulk-action-bar">
          <div><span className="bulk-count">{selectedIds.length}</span><strong>questions selected</strong><button className="text-button" type="button" onClick={clearSelection}>Clear</button></div>
          <div className="bulk-actions">
            <button className="secondary-button compact" type="button" onClick={() => onBulkStatus(selectedIds, "review")}><CircleHelp size={15} /> Mark review</button>
            <label className="bulk-topic-control"><Tag size={15} /><input value={bulkTopic} onChange={(event) => setBulkTopic(event.target.value)} placeholder="Topic" /><button type="button" onClick={() => onBulkTopic(selectedIds, bulkTopic.trim() || "General")}>Apply</button></label>
            <button className="ghost-button danger-ghost compact" type="button" onClick={() => { onBulkDelete(selectedIds); clearSelection(); }}><Trash2 size={15} /> Delete</button>
          </div>
        </section>
      )}

      <div className="editor-layout">
        <aside className="editor-sidebar">
          <div className="set-summary"><div className="set-file-icon"><FileText size={21} /></div><strong>{studySet.title}</strong><span>{studySet.sourceName}</span><div className="summary-grid"><div><strong>{studySet.questions.length}</strong><small>Questions</small></div><div><strong>{verified}</strong><small>Verified</small></div><div><strong>{studySet.questions.length - verified}</strong><small>Review</small></div></div></div>
          <div className="question-list filtered-list">
            {filteredQuestions.map((item) => {
              const itemIndex = studySet.questions.indexOf(item);
              return (
                <div className={`question-list-row ${item.id === question.id ? "active" : ""} ${item.status === "review" ? "warn" : ""}`} key={item.id}>
                  <label className="question-select"><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`Select question ${itemIndex + 1}`} /></label>
                  <button className="question-open" type="button" onClick={() => onSelect(item.id)}><span>{itemIndex + 1}</span><span className="question-list-copy"><b>{item.question}</b><small>{item.topic ?? "General"}</small></span>{isVerifiedQuestion(item) ? <Check size={14} /> : <CircleHelp size={14} />}</button>
                </div>
              );
            })}
            {!filteredQuestions.length && <div className="question-list-empty"><Filter size={22} /><span>No matching questions</span></div>}
          </div>
          <button className="ghost-button full-button" type="button" onClick={onAddQuestion}><Plus size={16} /> Add question</button>
        </aside>

        <section className="question-editor-card" key={question.id}>
          <div className="editor-card-head"><div><div className="editor-status-line"><span className={`status ${ready ? "ready" : "draft"}`}>{ready ? `${correctIds.length} answer${correctIds.length === 1 ? "" : "s"} verified` : "Needs review"}</span>{question.sourcePage && <span className="page-chip">Page {question.sourcePage}</span>}<span className="page-chip topic-chip"><Tag size={11} /> {question.topic ?? "General"}</span></div><h2>Question {index + 1}</h2><p>{multiple ? "This is a multiple-answer question. Select every correct choice." : ready ? "The detected answer is selected. You can still change it." : "Select the correct option before using this question in an exam."}</p></div><div className="editor-actions"><button className="icon-button" type="button" title="Duplicate" onClick={() => onDuplicate(question.id)}><Copy size={17} /></button><button className="icon-button danger-icon" type="button" title="Delete" onClick={() => onDelete(question.id)}><Trash2 size={17} /></button></div></div>
          <div className="editor-meta-grid"><div className="form-group"><label htmlFor="question-topic">Topic</label><input id="question-topic" className="text-input" value={question.topic ?? "General"} onChange={(event) => onUpdateQuestion(question.id, { topic: event.target.value })} /></div><div className="form-group"><label htmlFor="question-status">Review status</label><select id="question-status" className="text-input" value={question.status} onChange={(event) => onUpdateQuestion(question.id, { status: event.target.value as "verified" | "review" })}><option value="verified" disabled={!answerReady}>Verified</option><option value="review">Needs review</option></select></div></div>
          <div className="form-group"><label htmlFor="question-text">Question</label><textarea id="question-text" className="question-input" value={question.question} onChange={(event) => onUpdateQuestion(question.id, { question: event.target.value })} /></div>
          <div className="form-group"><div className="label-row answer-heading"><div><label>Answer choices</label><small>{multiple ? "Check all correct answers." : "Choose one correct answer."}</small></div><select className="answer-mode-select" aria-label="Answer selection mode" value={multiple ? "multiple" : "single"} onChange={(event) => onSelectionMode(question.id, event.target.value as "single" | "multiple")}><option value="single">Single answer</option><option value="multiple">Multiple answers</option></select></div><div className="answer-grid">
            {question.options.map((option, optionIndex) => {
              const selected = correctIds.includes(option.id);
              return <div className={`answer-row ${selected ? "correct" : ""}`} key={option.id}><span className="answer-letter">{String.fromCharCode(65 + optionIndex)}</span><input value={option.text} onChange={(event) => onUpdateOption(question.id, option.id, event.target.value)} aria-label={`Answer ${String.fromCharCode(65 + optionIndex)}`} /><button className={`correct-radio ${selected ? "selected" : ""}`} type="button" title={selected ? "Correct answer selected" : "Mark as correct"} onClick={() => onMarkCorrect(question.id, option.id)}><Check size={16} /></button><button className="remove-option" type="button" title="Remove option" onClick={() => onRemoveOption(question.id, option.id)}><X size={15} /></button></div>;
            })}
          </div><button className="text-button add-option" type="button" onClick={() => onAddOption(question.id)}><Plus size={15} /> Add answer choice</button></div>
          <div className="form-group"><label htmlFor="explanation">Explanation</label><textarea id="explanation" className="explanation-input" value={question.explanation} onChange={(event) => onUpdateQuestion(question.id, { explanation: event.target.value })} placeholder="Explain why the selected answer is correct." /></div>
          <div className="editor-footer"><span>Changes save automatically in this browser.</span><div className="toolbar"><button className="ghost-button" type="button" disabled={!previous} onClick={() => previous && onSelect(previous.id)}><ChevronLeft size={16} /> Previous</button><button className="primary-button" type="button" onClick={() => next ? onSelect(next.id) : onSetup}>{next ? "Next question" : "Set up exam"}<ChevronRight size={16} /></button></div></div>
        </section>
      </div>
    </div>
  );
}

function SetupView({ studySet, settings, onSettings, onBack, onStart }: { studySet: StudySet; settings: ExamSettings; onSettings: (settings: ExamSettings) => void; onBack: () => void; onStart: () => void }) {
  const verified = studySet.questions.filter(isVerifiedQuestion);
  const topics = availableTopics(verified);
  const weak = weakTopics(studySet.attempts);
  const hasExplanations = verified.some((question) => question.explanation.trim().length > 0);
  const filtered = verified.filter((question) => {
    const topicMatch = !settings.topicFilter || settings.topicFilter === "All topics" || (question.topic ?? "General") === settings.topicFilter;
    const weakMatch = !settings.weakAreasOnly || weak.length === 0 || weak.includes(question.topic ?? "General");
    return topicMatch && weakMatch;
  });
  const preview = filtered[0] ?? verified[0];
  const update = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => onSettings({ ...settings, [key]: value });
  const maxQuestions = Math.max(1, filtered.length);
  const selectedCount = Math.min(settings.questionCount, maxQuestions);
  return (
    <div className="page-wrap setup-page">
      <div className="page-head"><div><button className="breadcrumb-button" type="button" onClick={onBack}>Review questions</button><span className="breadcrumb-separator">/</span><span>Exam setup</span><h1>Customize your mock exam</h1><p>Choose topics, weak areas, question count, timing, and randomization.</p></div></div>
      <div className="setup-grid">
        <section className="setup-panel"><h2>Exam preferences</h2><p>These settings apply only to the next attempt.</p>
          <div className="setting-row"><div className="setting-copy"><strong>Topic</strong><small>Practice the whole set or focus on one topic.</small></div><select value={settings.topicFilter ?? "All topics"} onChange={(event) => { update("topicFilter", event.target.value); onSettings({ ...settings, topicFilter: event.target.value, questionCount: Math.min(settings.questionCount, verified.filter((q) => event.target.value === "All topics" || (q.topic ?? "General") === event.target.value).length || 1) }); }}><option>All topics</option>{topics.map((topic) => <option key={topic}>{topic}</option>)}</select></div>
          <ToggleSetting label="Focus on weak areas" description={weak.length ? `Prioritize ${weak.join(", ")}.` : "Completing a few attempts will identify weak topics."} checked={Boolean(settings.weakAreasOnly)} onChange={(value) => update("weakAreasOnly", value)} />
          <div className="setting-row"><div className="setting-copy"><strong>Number of questions</strong><small>{filtered.length} verified questions match your filters.</small></div><select value={selectedCount} onChange={(event) => update("questionCount", Number(event.target.value))}>{Array.from({ length: maxQuestions }, (_, index) => index + 1).filter((value) => value === maxQuestions || value % 5 === 0 || value === 1).map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          <ToggleSetting label="Shuffle questions" description="Use a different question order for every attempt." checked={settings.shuffleQuestions} onChange={(value) => update("shuffleQuestions", value)} />
          <ToggleSetting label="Shuffle answer choices" description="Randomize the choice order without changing the answer key." checked={settings.shuffleAnswers} onChange={(value) => update("shuffleAnswers", value)} />
          <ToggleSetting label="Timed exam" description="Show a countdown while answering." checked={settings.timed} onChange={(value) => update("timed", value)} />
          <div className={`setting-row ${!settings.timed ? "disabled-setting" : ""}`}><div className="setting-copy"><strong>Time limit</strong><small>Select the exam duration.</small></div><select disabled={!settings.timed} value={settings.minutes} onChange={(event) => update("minutes", Number(event.target.value))}>{[5, 10, 20, 30, 45, 60, 90].map((value) => <option value={value} key={value}>{value} minutes</option>)}</select></div>
          {hasExplanations && <ToggleSetting label="Show explanations" description="Display available explanations in the answer review." checked={settings.showExplanations} onChange={(value) => update("showExplanations", value)} />}
          <section className="lifeline-settings">
            <div className="lifeline-settings-head"><span><ShieldCheck size={18} /></span><div><strong>Practice lifelines</strong><small>Turn each aid on or off for this attempt. Every enabled lifeline can be used once.</small></div></div>
            <div className="lifeline-toggle-grid">
              <LifelineToggle icon={<Scissors size={17} />} label="50:50" description="Remove incorrect choices until two remain." checked={Boolean(settings.lifelineFiftyFifty)} onChange={(value) => update("lifelineFiftyFifty", value)} />
              <LifelineToggle icon={<Users size={17} />} label="Audience Poll" description="Show a simulated vote for the current question." checked={Boolean(settings.lifelineAudiencePoll)} onChange={(value) => update("lifelineAudiencePoll", value)} />
              <LifelineToggle icon={<Snowflake size={17} />} label="Time Freeze" description="Pause a timed exam for 60 seconds." checked={Boolean(settings.lifelineTimeFreeze)} onChange={(value) => update("lifelineTimeFreeze", value)} disabled={!settings.timed} />
              <LifelineToggle icon={<Lightbulb size={17} />} label="Clue" description="Reveal the saved explanation or a source-page hint." checked={Boolean(settings.lifelineClue)} onChange={(value) => update("lifelineClue", value)} />
            </div>
          </section>
        </section>
        <aside className="preview-panel"><div className="preview-header"><span className="pill"><Target size={13} /> EXAM PREVIEW</span><h2>{studySet.title}</h2><p>{settings.weakAreasOnly && weak.length ? `Weak-area mode: ${weak.join(", ")}` : settings.topicFilter && settings.topicFilter !== "All topics" ? settings.topicFilter : "Mixed-topic practice"}</p></div>{preview && <div className="exam-preview-card"><span>{isMultipleQuestion(preview) ? "MULTIPLE ANSWERS" : "QUESTION 01"}</span><h3>{preview.question}</h3>{preview.options.slice(0, 3).map((option, index) => <div className="mini-answer" key={option.id}><span>{String.fromCharCode(65 + index)}</span>{option.text}</div>)}</div>}<div className="exam-details"><div><strong>{Math.min(settings.questionCount, filtered.length)}</strong><small>Questions</small></div><div><strong>{settings.timed ? `${settings.minutes}m` : "∞"}</strong><small>Time limit</small></div><div><strong>{filtered.length ? new Set(filtered.map((q) => q.topic ?? "General")).size : 0}</strong><small>Topics</small></div></div><button className="primary-button start-button" type="button" disabled={!filtered.length} onClick={onStart}>Start mock exam <ChevronRight size={17} /></button></aside>
      </div>
    </div>
  );
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row"><div className="setting-copy"><strong>{label}</strong><small>{description}</small></div><input className="switch-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function LifelineToggle({ icon, label, description, checked, onChange, disabled = false }: { icon: React.ReactNode; label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className={`lifeline-toggle-card ${checked ? "enabled" : ""} ${disabled ? "disabled" : ""}`}><span className="lifeline-toggle-icon">{icon}</span><span className="lifeline-toggle-copy"><strong>{label}</strong><small>{description}</small></span><input className="switch-input" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}


function ExamView({
  exam,
  settings,
  onAnswer,
  onFlag,
  onMove,
  onSubmit,
  reviewOpen,
  onCloseReview,
  onConfirmSubmit,
  onFiftyFifty,
  onAudiencePoll,
  onTimeFreeze,
  onClue
}: {
  exam: ExamSession | null;
  settings: ExamSettings;
  onAnswer: (id: string) => void;
  onFlag: () => void;
  onMove: (index: number) => void;
  onSubmit: () => void;
  reviewOpen: boolean;
  onCloseReview: () => void;
  onConfirmSubmit: () => void;
  onFiftyFifty: () => void;
  onAudiencePoll: () => void;
  onTimeFreeze: () => void;
  onClue: () => void;
}) {
  const [navFilter, setNavFilter] = useState<"all" | "unanswered" | "flagged" | "incomplete">("all");
  const [navOpen, setNavOpen] = useState(false);
  if (!exam) return null;
  const question = exam.questions[exam.currentIndex];
  const selected = exam.responses[question.id] ?? [];
  const lifelines = exam.lifelines ?? {
    fiftyFiftyUsed: false,
    audiencePollUsed: false,
    timeFreezeUsed: false,
    clueUsed: false,
    removedOptionIds: {},
    audiencePolls: {},
    clues: {}
  };
  const removedIds = new Set(lifelines.removedOptionIds?.[question.id] ?? []);
  const audiencePoll = lifelines.audiencePolls?.[question.id];
  const clue = lifelines.clues?.[question.id];
  const freezeSeconds = Math.max(0, Math.ceil(((lifelines.timerFrozenUntil ?? 0) - Date.now()) / 1000));
  const hasMultipleQuestions = exam.questions.some(isMultipleQuestion);
  const statusFor = (item: ExamQuestion) => {
    const responses = exam.responses[item.id] ?? [];
    const expected = isMultipleQuestion(item) ? Math.max(2, getCorrectIds(item).length) : 1;
    const incomplete = responses.length > 0 && responses.length < expected;
    return { unanswered: responses.length === 0, incomplete, answered: responses.length > 0 && !incomplete, flagged: Boolean(exam.flagged[item.id]) };
  };
  const counts = exam.questions.reduce((acc, item) => {
    const status = statusFor(item);
    if (status.unanswered) acc.unanswered += 1;
    if (status.incomplete) acc.incomplete += 1;
    if (status.answered) acc.answered += 1;
    if (status.flagged) acc.flagged += 1;
    return acc;
  }, { unanswered: 0, incomplete: 0, answered: 0, flagged: 0 });
  const visibleQuestions = exam.questions
    .map((item, index) => ({ item, index, status: statusFor(item) }))
    .filter(({ status }) => navFilter === "all" || status[navFilter]);
  const multiple = isMultipleQuestion(question);
  const expectedSelections = Math.max(2, getCorrectIds(question).length);
  const progressPercent = Math.round((counts.answered / Math.max(1, exam.questions.length)) * 100);
  const lifelinesEnabled = Boolean(
    settings.lifelineFiftyFifty
    || settings.lifelineAudiencePoll
    || settings.lifelineTimeFreeze
    || settings.lifelineClue
  );

  function moveFromNavigator(index: number) {
    onMove(index);
    setNavOpen(false);
  }

  return (
    <div className="exam-shell streamlined-exam-shell">
      <header className="exam-topbar">
        <div className="exam-brand"><span className="brand-mark">Q</span><span><strong>QuizForge Exam</strong><small>{question.topic ?? "Practice mode"}</small></span></div>
        <button className="exam-nav-trigger" type="button" onClick={() => setNavOpen(true)}><Menu size={17} /> Questions</button>
        <div className="exam-meta">
          <div className="autosave-status"><CheckCircle2 size={15} /><span>Saved</span></div>
          <div className={`timer ${freezeSeconds > 0 ? "frozen" : ""}`}><Clock3 size={17} /><span>{settings.timed ? formatDuration(exam.remainingSeconds) : "Untimed"}</span><small>{freezeSeconds > 0 ? `frozen ${freezeSeconds}s` : settings.timed ? "remaining" : "no limit"}</small></div>
          <button className="primary-button compact" type="button" onClick={onSubmit}>Review & submit</button>
        </div>
      </header>
      {navOpen && <button className="exam-nav-scrim" type="button" aria-label="Close question navigator" onClick={() => setNavOpen(false)} />}
      <div className="exam-body">
        <aside className={`exam-nav simplified-exam-nav ${navOpen ? "open" : ""}`}>
          <div className="exam-nav-heading"><div><h2>Questions</h2><p>{counts.answered} of {exam.questions.length} complete</p></div><button className="icon-button exam-nav-close" type="button" aria-label="Close navigator" onClick={() => setNavOpen(false)}><X size={17} /></button></div>
          <div className="exam-nav-progress"><div><strong>{progressPercent}%</strong><small>progress</small></div><span><i style={{ width: `${progressPercent}%` }} /></span></div>
          <div className="exam-nav-filters compact-filters">
            <button type="button" className={navFilter === "all" ? "active" : ""} onClick={() => setNavFilter("all")}>All <span>{exam.questions.length}</span></button>
            <button type="button" className={navFilter === "unanswered" ? "active" : ""} onClick={() => setNavFilter("unanswered")}>Unanswered <span>{counts.unanswered}</span></button>
            {hasMultipleQuestions && <button type="button" className={navFilter === "incomplete" ? "active" : ""} onClick={() => setNavFilter("incomplete")}>Incomplete <span>{counts.incomplete}</span></button>}
            <button type="button" className={navFilter === "flagged" ? "active" : ""} onClick={() => setNavFilter("flagged")}>Flagged <span>{counts.flagged}</span></button>
          </div>
          <div className="question-dots">{visibleQuestions.map(({ item, index, status }) => <button key={item.id} type="button" aria-label={`Go to question ${index + 1}`} className={`question-dot ${index === exam.currentIndex ? "current" : status.answered ? "answered" : ""} ${status.incomplete ? "incomplete" : ""} ${status.flagged ? "flagged" : ""}`} onClick={() => moveFromNavigator(index)}>{index + 1}</button>)}</div>
          {!visibleQuestions.length && <div className="nav-empty">No questions in this filter.</div>}
        </aside>

        <main className="exam-main">
          <div className="exam-progress"><span>Question {exam.currentIndex + 1} of {exam.questions.length}</span><span>{Math.round(((exam.currentIndex + 1) / exam.questions.length) * 100)}%</span></div>
          <div className="exam-progress-track"><span style={{ width: `${((exam.currentIndex + 1) / exam.questions.length) * 100}%` }} /></div>
          <section className="exam-question-card" key={question.id}>
            <div className="question-kicker"><span>{multiple ? "MULTIPLE ANSWERS" : "MULTIPLE CHOICE"} · {question.topic ?? "General"}</span><button className={`flag-button ${exam.flagged[question.id] ? "flagged" : ""}`} type="button" onClick={onFlag}><Flag size={15} /> {exam.flagged[question.id] ? "Flagged" : "Flag for review"}</button></div>
            <h1>{question.question}</h1>

            {lifelinesEnabled && (
              <section className="lifeline-bar" aria-label="Exam lifelines">
                <div className="lifeline-bar-title"><ShieldCheck size={16} /><span><strong>Lifelines</strong><small>Each can be used once</small></span></div>
                <div className="lifeline-actions">
                  {settings.lifelineFiftyFifty && <button className={`lifeline-button ${lifelines.fiftyFiftyUsed ? "used" : ""}`} type="button" disabled={lifelines.fiftyFiftyUsed || multiple || question.options.length <= 2} onClick={onFiftyFifty}><Scissors size={16} /><span>50:50</span></button>}
                  {settings.lifelineAudiencePoll && <button className={`lifeline-button ${lifelines.audiencePollUsed ? "used" : ""}`} type="button" disabled={lifelines.audiencePollUsed || multiple} onClick={onAudiencePoll}><Users size={16} /><span>Audience</span></button>}
                  {settings.lifelineTimeFreeze && <button className={`lifeline-button ${lifelines.timeFreezeUsed ? "used" : ""} ${freezeSeconds > 0 ? "active" : ""}`} type="button" disabled={lifelines.timeFreezeUsed || !settings.timed} onClick={onTimeFreeze}><Snowflake size={16} /><span>{freezeSeconds > 0 ? `${freezeSeconds}s` : "Freeze"}</span></button>}
                  {settings.lifelineClue && <button className={`lifeline-button ${lifelines.clueUsed ? "used" : ""}`} type="button" disabled={lifelines.clueUsed} onClick={onClue}><Lightbulb size={16} /><span>Clue</span></button>}
                </div>
              </section>
            )}

            {clue && <div className="lifeline-clue"><Lightbulb size={18} /><div><strong>Your clue</strong><p>{clue}</p></div></div>}
            {audiencePoll && <div className="audience-summary"><Users size={16} /><span>The audience has voted. Percentages appear beside each remaining choice.</span></div>}
            {multiple && <div className="selection-hint"><Sparkles size={15} /><span>Select all correct answers{getCorrectIds(question).length > 1 ? ` (${expectedSelections} expected)` : ""}.</span></div>}
            <div className="exam-options">
              {question.options.map((option, index) => {
                if (removedIds.has(option.id)) return null;
                const isSelected = selected.includes(option.id);
                const pollValue = audiencePoll?.[option.id];
                return (
                  <button className={`exam-option ${isSelected ? "selected" : ""} ${pollValue !== undefined ? "with-poll" : ""}`} key={option.id} type="button" onClick={() => onAnswer(option.id)}>
                    <span className="option-letter">{String.fromCharCode(65 + index)}</span>
                    <span className="option-text">{option.text}</span>
                    {pollValue !== undefined && <span className="audience-poll"><i style={{ width: `${pollValue}%` }} /><b>{pollValue}%</b></span>}
                    {isSelected && <span className="option-check"><Check size={18} /></span>}
                  </button>
                );
              })}
            </div>
            <div className="exam-footer"><button className="ghost-button" type="button" disabled={exam.currentIndex === 0} onClick={() => onMove(exam.currentIndex - 1)}><ChevronLeft size={16} /> Previous</button>{exam.currentIndex < exam.questions.length - 1 ? <button className="primary-button" type="button" onClick={() => onMove(exam.currentIndex + 1)}>Next question <ChevronRight size={16} /></button> : <button className="primary-button" type="button" onClick={onSubmit}>Review exam <Check size={16} /></button>}</div>
          </section>
        </main>
      </div>
      {reviewOpen && <div className="modal-backdrop exam-review-backdrop"><section className="submit-review-modal" role="dialog" aria-modal="true" aria-labelledby="submit-review-title"><button className="modal-close" type="button" aria-label="Close review" onClick={onCloseReview}><X size={18} /></button><span className="modal-success-orb review-orb"><ListFilter size={28} /></span><p className="eyebrow">FINAL REVIEW</p><h2 id="submit-review-title">Ready to submit?</h2><p>Check unanswered, incomplete, and flagged questions before your answers are scored.</p><div className="submit-review-stats"><button type="button" onClick={() => { setNavFilter("unanswered"); onCloseReview(); setNavOpen(true); }}><strong>{counts.unanswered}</strong><small>Unanswered</small></button>{hasMultipleQuestions && <button type="button" onClick={() => { setNavFilter("incomplete"); onCloseReview(); setNavOpen(true); }}><strong>{counts.incomplete}</strong><small>Incomplete</small></button>}<button type="button" onClick={() => { setNavFilter("flagged"); onCloseReview(); setNavOpen(true); }}><strong>{counts.flagged}</strong><small>Flagged</small></button><div><strong>{counts.answered}</strong><small>Complete</small></div></div><div className="submit-question-grid">{exam.questions.map((item, index) => { const status = statusFor(item); return <button key={item.id} type="button" className={`${status.answered ? "complete" : status.incomplete ? "incomplete" : "unanswered"} ${status.flagged ? "flagged" : ""}`} onClick={() => { onMove(index); onCloseReview(); }}>{index + 1}</button>; })}</div><div className="submit-review-actions"><button className="ghost-button" type="button" onClick={onCloseReview}>Return to exam</button><button className="primary-button" type="button" onClick={onConfirmSubmit}>Submit now <Check size={16} /></button></div></section></div>}
    </div>
  );
}


function ResultsView({ details, settings, exam, onRetake, onRetakeWrong, onDashboard }: { details: ResultDetail[]; settings: ExamSettings; exam: ExamSession | null; onRetake: () => void; onRetakeWrong: () => void; onDashboard: () => void }) {
  const correct = details.filter((detail) => detail.correct).length;
  const total = details.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const pass = percent >= 70;
  const wrong = details.filter((detail) => !detail.correct);
  const timeUsed = exam ? Math.max(0, Math.round(((exam.submittedAt ?? Date.now()) - exam.startedAt) / 1000)) : 0;
  return (
    <div className="results-page">
      {pass && <div className="confetti" aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}</div>}
      <div className="results-wrap"><section className="results-hero"><div className="score-ring" style={{ "--score": `${percent}%` } as React.CSSProperties}><div className="score-value"><strong>{percent}%</strong><small>FINAL SCORE</small></div></div><div className="results-copy"><span className="pill"><Sparkles size={14} /> {pass ? "TARGET REACHED" : "KEEP PRACTICING"}</span><h1>{pass ? "Great work!" : "You’re making progress."}</h1><p>{pass ? "You passed this mock exam. Review anything you missed to make the next attempt stronger." : "Review the correct answers and explanations below, then retake the questions you missed."}</p><div className="result-stats"><div><strong>{correct}/{total}</strong><small>Correct answers</small></div><div><strong>{formatDuration(timeUsed)}</strong><small>Time used</small></div><div><strong>{wrong.length}</strong><small>Need review</small></div></div><div className="results-actions"><button className="white-button" type="button" onClick={onRetake}>Retake exam</button>{wrong.length > 0 && <button className="outline-light" type="button" onClick={onRetakeWrong}>Retake incorrect</button>}<button className="outline-light" type="button" onClick={onDashboard}>Dashboard</button></div></div></section>
        <section className="review-section"><div className="section-heading"><div><p className="eyebrow">ANSWER REVIEW</p><h2>Learn from every question</h2></div></div>{details.map((detail, index) => {
          const selectedOptions = detail.question.options.filter((option) => detail.selectedOptionIds.includes(option.id));
          const correctIds = getCorrectIds(detail.question);
          const correctOptions = detail.question.options.filter((option) => correctIds.includes(option.id));
          const selectedText = selectedOptions.map((option) => option.text).join(" • ");
          const correctText = correctOptions.map((option) => option.text).join(" • ");
          return <article className={`review-card ${detail.correct ? "correct-review" : "wrong-review"}`} key={detail.question.id}><div className="review-head"><span className={`review-badge ${detail.correct ? "" : "wrong"}`}>{detail.correct ? <Check size={18} /> : <X size={18} />}</span><div><h3>{index + 1}. {detail.question.question}</h3><p>{detail.correct ? "Correct answer" : selectedText ? `Your answer: ${selectedText}` : "No answer selected"}</p></div></div>{!detail.correct && <div className="correct-answer-callout"><strong>Correct answer{correctOptions.length > 1 ? "s" : ""}</strong><span>{correctText || "Unavailable"}</span></div>}{settings.showExplanations && detail.question.explanation && <div className="review-explanation"><Sparkles size={16} /><span>{detail.question.explanation}</span></div>}</article>;
        })}</section>
      </div>
    </div>
  );
}


function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default App;
