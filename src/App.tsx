import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  Flag,
  FolderOpen,
  GripVertical,
  Home,
  Library,
  Menu,
  Moon,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import type { ExamQuestion, ExamSession, ExamSettings, Question, StudySet } from "./types.js";
import { createDemoSet } from "./data/demo.js";
import { extractPdfText } from "./lib/pdf.js";
import { generateLocalQuestions, parseQuestionBankDetailed } from "./lib/parser.js";
import { loadStudySets, loadTheme, saveStudySets, saveTheme } from "./lib/storage.js";
import { bestScore, formatDate, formatDuration, shuffle, stripExtension, uid } from "./lib/utils.js";

type View = "dashboard" | "library" | "performance" | "upload" | "processing" | "editor" | "setup" | "exam" | "results";

type ProcessingStep = "read" | "detect" | "answers" | "finish";

interface ResultDetail {
  question: ExamQuestion;
  selectedOptionIds: string[];
  correct: boolean;
}

interface ImportSummary {
  title: string;
  extracted: number;
  expected: number;
  verified: number;
  warnings: string[];
}


function getCorrectIds(question: Question): string[] {
  if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length) return question.correctOptionIds;
  return question.correctOptionId ? [question.correctOptionId] : [];
}

function isVerifiedQuestion(question: Question): boolean {
  const ids = getCorrectIds(question);
  return ids.length > 0 && ids.every((id) => question.options.some((option) => option.id === id));
}

function isMultipleQuestion(question: Question): boolean {
  return question.selectionMode === "multiple" || getCorrectIds(question).length > 1 || /\bchoose\s+(?:two|three|four|five|six|seven|eight|[2-8])\b/i.test(question.question);
}

function sameAnswerSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

const defaultSettings: ExamSettings = {
  questionCount: 20,
  shuffleQuestions: true,
  shuffleAnswers: true,
  timed: true,
  minutes: 30,
  showExplanations: true
};

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => loadTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [studySets, setStudySets] = useState<StudySet[]>(() => {
    const stored = loadStudySets();
    return stored.length ? stored : [createDemoSet()];
  });
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [studyTitle, setStudyTitle] = useState("");
  const [aiEnhanced, setAiEnhanced] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("read");
  const [settings, setSettings] = useState<ExamSettings>(defaultSettings);
  const [exam, setExam] = useState<ExamSession | null>(null);
  const [resultDetails, setResultDetails] = useState<ResultDetail[]>([]);
  const [toast, setToast] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
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
      submitExam(true);
      return;
    }
    const timer = window.setInterval(() => {
      setExam((current) => current ? { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) } : current);
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
    setSettings((current) => ({ ...current, questionCount: Math.min(current.questionCount, set.questions.length) || set.questions.length }));
    navigate(target);
  }

  function newStudySet() {
    setSelectedFile(null);
    setPastedText("");
    setStudyTitle("");
    setAiEnhanced(false);
    setProcessingProgress(0);
    navigate("upload");
  }

  async function createStudySet() {
    if (!selectedFile && pastedText.trim().length < 20) {
      setError("Choose a PDF or paste enough study material first.");
      return;
    }

    setError("");
    setProcessingProgress(4);
    setProcessingStep("read");
    navigate("processing");

    try {
      let sourceText = pastedText.trim();
      let sourceName = "Pasted study material";
      if (selectedFile) {
        sourceName = selectedFile.name;
        sourceText = await extractPdfText(selectedFile, (progress) => {
          setProcessingProgress(Math.max(5, Math.min(52, Math.round(progress * 0.52))));
        });
      }

      if (sourceText.replace(/\s/g, "").length < 30) {
        throw new Error("This PDF does not appear to contain readable text. It may be scanned or image-only.");
      }

      setProcessingStep("detect");
      setProcessingProgress(58);
      const parsed = parseQuestionBankDetailed(sourceText);
      let questions = parsed.questions;

      setProcessingStep("answers");
      setProcessingProgress(72);
      if (aiEnhanced) {
        questions = await generateWithAi(sourceText, studyTitle || stripExtension(sourceName));
      } else if (questions.length < 2) {
        questions = generateLocalQuestions(sourceText);
      }

      if (!questions.length) {
        throw new Error("No usable questions were found. Try a question bank with A–D choices, paste text, or enable AI generation.");
      }

      setProcessingStep("finish");
      setProcessingProgress(94);
      await delay(420);

      const now = new Date().toISOString();
      const set: StudySet = {
        id: uid(),
        title: studyTitle.trim() || stripExtension(sourceName),
        sourceName,
        createdAt: now,
        updatedAt: now,
        questions,
        attempts: []
      };
      setStudySets((current) => [set, ...current]);
      setActiveSetId(set.id);
      setEditingQuestionId(set.questions[0]?.id ?? null);
      setProcessingProgress(100);
      const verified = questions.filter(isVerifiedQuestion).length;
      setImportSummary({
        title: set.title,
        extracted: questions.length,
        expected: aiEnhanced ? questions.length : parsed.highestQuestionNumber || questions.length,
        verified,
        warnings: aiEnhanced ? [] : parsed.warnings
      });
      setToast(`${questions.length} questions prepared`);
      await delay(280);
      navigate("editor");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The study set could not be created.";
      setError(message);
      navigate("upload");
    }
  }

  async function generateWithAi(text: string, title: string): Promise<Question[]> {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, title })
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      questions?: Array<{ question: string; options: string[]; correctIndex: number; explanation?: string }>;
    };
    if (!response.ok || !payload.questions) {
      throw new Error(payload.error || "AI generation failed. Disable AI-enhanced generation and try local extraction.");
    }
    return payload.questions.map((question) => {
      const options = question.options.map((text) => ({ id: uid(), text }));
      return {
        id: uid(),
        question: question.question,
        options,
        correctOptionId: options[question.correctIndex]?.id ?? null,
        correctOptionIds: options[question.correctIndex] ? [options[question.correctIndex].id] : [],
        selectionMode: "single",
        explanation: question.explanation ?? "",
        status: options[question.correctIndex] ? "verified" : "review"
      };
    });
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
    if (!pool.length) {
      setToast("No verified questions are available");
      return;
    }

    const count = Math.min(questionIds?.length || settings.questionCount || pool.length, pool.length);
    let selected = settings.shuffleQuestions ? shuffle(pool).slice(0, count) : pool.slice(0, count);
    const examQuestions: ExamQuestion[] = selected.map((question) => {
      const options = question.options.map((option) => ({ ...option, originalId: option.id }));
      return { ...question, options: settings.shuffleAnswers ? shuffle(options) : options };
    });

    setExam({
      questions: examQuestions,
      responses: {},
      flagged: {},
      currentIndex: 0,
      startedAt: Date.now(),
      remainingSeconds: settings.timed ? settings.minutes * 60 : 0
    });
    setResultDetails([]);
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

  function submitExam(autoSubmitted = false) {
    if (!exam || !activeSet) return;
    const unanswered = exam.questions.filter((question) => !(exam.responses[question.id]?.length)).length;
    if (!autoSubmitted && unanswered && !window.confirm(`Submit with ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}?`)) return;

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
      durationSeconds
    };
    updateActiveSet((set) => ({ ...set, attempts: [attempt, ...set.attempts].slice(0, 30) }));
    setExam({ ...exam, submittedAt: Date.now() });
    setResultDetails(details);
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
          onSubmit={() => submitExam(false)}
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
              text={pastedText}
              title={studyTitle}
              dragging={dragging}
              aiEnhanced={aiEnhanced}
              aiConfigured={aiConfigured}
              error={error}
              fileInputRef={fileInputRef}
              onFile={setSelectedFile}
              onText={setPastedText}
              onTitle={setStudyTitle}
              onDragging={setDragging}
              onAi={setAiEnhanced}
              onCreate={createStudySet}
              onCancel={() => navigate("dashboard")}
            />
          )}
          {view === "processing" && (
            <ProcessingView
              fileName={selectedFile?.name || "Pasted study material"}
              progress={processingProgress}
              step={processingStep}
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
      {importSummary && <ImportSummaryModal summary={importSummary} onClose={() => setImportSummary(null)} />}
    </div>
  );
}

function ImportSummaryModal({ summary, onClose }: { summary: ImportSummary; onClose: () => void }) {
  const complete = summary.expected === summary.extracted && summary.warnings.length === 0;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className={`modal-success-orb ${complete ? "complete" : "warning"}`}>
          {complete ? <Check size={29} /> : <CircleHelp size={29} />}
          <span className="orb-ring" />
        </div>
        <button className="modal-close" type="button" aria-label="Close import summary" onClick={onClose}><X size={18} /></button>
        <p className="eyebrow">PDF IMPORT COMPLETE</p>
        <h2 id="import-title">{complete ? "Everything lined up." : "Import finished with notes."}</h2>
        <p className="modal-copy">“{summary.title}” is ready for review. QuizForge compared the extracted items with the numbering found in the PDF.</p>
        <div className="import-stats">
          <div><strong>{summary.extracted}</strong><small>Questions extracted</small></div>
          <div><strong>{summary.expected}</strong><small>Numbered in PDF</small></div>
          <div><strong>{summary.verified}</strong><small>Answers detected</small></div>
        </div>
        {summary.warnings.length > 0 && (
          <div className="modal-warning-list">
            {summary.warnings.slice(0, 3).map((warning) => <p key={warning}><CircleHelp size={14} /> {warning}</p>)}
          </div>
        )}
        <button className="primary-button modal-primary" type="button" onClick={onClose}>Review questions <ChevronRight size={16} /></button>
      </section>
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
    { id: "dashboard" as View, label: "Dashboard", icon: Home },
    { id: "library" as View, label: "Study sets", icon: Library },
    { id: "performance" as View, label: "Performance", icon: BarChart3 }
  ];
  return (
    <div className="app-shell">
      <button className="mobile-menu" type="button" aria-label="Toggle navigation" onClick={onToggleSidebar}><Menu size={20} /></button>
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={onToggleSidebar} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="brand" type="button" onClick={() => onNavigate("dashboard")}>
          <span className="brand-mark">Q</span>
          <span><strong>QuizForge</strong><small>Study smarter</small></span>
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => onNavigate(item.id)}>
                <Icon size={18} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-card">
          <Sparkles size={18} />
          <strong>AI study mode</strong>
          <p>Generate questions from notes when your server API key is configured.</p>
          <button type="button" onClick={onNew}>Try it</button>
        </div>
        <div className="profile">
          <span className="avatar">D</span>
          <span><strong>Daniel</strong><small>Local workspace</small></span>
        </div>
      </aside>
      <main className="main-content">
        <header className="global-topbar">
          <div className="mobile-brand"><span className="brand-mark">Q</span><strong>QuizForge</strong></div>
          <div className="global-actions">
            <button className="icon-button" type="button" aria-label="Toggle theme" onClick={onTheme}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="primary-button compact" type="button" onClick={onNew}><Plus size={17} /> New study set</button>
          </div>
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
}

function Dashboard({ studySets, attempts, averageScore, onNew, onOpen, onNavigate }: DashboardProps) {
  const recent = studySets.slice(0, 3);
  const totalQuestions = studySets.reduce((sum, set) => sum + set.questions.length, 0);
  return (
    <div className="page-wrap dashboard-page">
      <section className="welcome-row">
        <div><p className="eyebrow">YOUR PERSONAL EXAM BUILDER</p><h1>Welcome back, Daniel</h1><p>Create a new test or continue one of your saved study sets.</p></div>
      </section>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="pill"><Sparkles size={14} /> AI-POWERED STUDY</span>
          <h2>Turn any PDF into a <em>practice exam.</em></h2>
          <p>Upload a reviewer, lecture notes, or a question bank. QuizForge extracts questions, identifies available answers, and builds a customizable mock test.</p>
          <div className="hero-actions">
            <button className="primary-button large" type="button" onClick={onNew}><Upload size={18} /> Upload PDF <ChevronRight size={17} /></button>
            <button className="secondary-button large" type="button" onClick={onNew}><FileText size={18} /> Paste text</button>
          </div>
          <div className="privacy-line"><Check size={15} /> PDF extraction happens in your browser</div>
        </div>
        <div className="upload-visual" aria-hidden="true">
          <div className="upload-orbit orbit-one" />
          <div className="upload-orbit orbit-two" />
          <div className="file-card rear"><span>PDF</span><i /><i /><i /></div>
          <div className="file-card front"><div className="file-icon">PDF</div><strong>Reviewer.pdf</strong><small>Ready to transform</small><div className="mini-progress"><span /></div></div>
          <div className="floating-chip chip-one">24 questions</div>
          <div className="floating-chip chip-two">Answer key found <Check size={12} /></div>
        </div>
      </section>
      <section className="metric-grid" aria-label="Study overview">
        <Metric label="Study sets" value={studySets.length} note="Saved locally" icon={<BookOpen size={18} />} />
        <Metric label="Questions" value={totalQuestions} note="Across your library" icon={<CircleHelp size={18} />} />
        <Metric label="Attempts" value={attempts} note="Completed exams" icon={<Clock3 size={18} />} />
        <Metric label="Average" value={attempts ? `${averageScore}%` : "—"} note="All attempts" icon={<BarChart3 size={18} />} />
      </section>
      <section className="section-heading">
        <div><p className="eyebrow">YOUR LIBRARY</p><h3>Continue studying</h3></div>
        <button className="text-button" type="button" onClick={() => onNavigate("library")}>View all <ChevronRight size={15} /></button>
      </section>
      <section className="study-grid">
        {recent.map((set, index) => <StudyCard key={set.id} studySet={set} index={index} onOpen={onOpen} />)}
        <button className="new-card" type="button" onClick={onNew}><span className="new-icon"><Plus size={22} /></span><strong>Create a study set</strong><p>Upload a PDF, paste notes, or begin with your own questions.</p></button>
      </section>
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

function PerformanceView({ studySets, attempts, averageScore }: { studySets: StudySet[]; attempts: Array<{ score: number; date: string; setTitle: string; correct: number; total: number; durationSeconds: number }>; averageScore: number }) {
  const best = attempts.reduce((score, attempt) => Math.max(score, attempt.score), 0);
  const recent = attempts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return (
    <div className="page-wrap">
      <div className="page-head"><div><p className="eyebrow">PERFORMANCE</p><h1>Your progress</h1><p>Results are stored only in this browser.</p></div></div>
      <section className="metric-grid performance-metrics">
        <Metric label="Average score" value={attempts.length ? `${averageScore}%` : "—"} note={`${attempts.length} completed attempts`} icon={<BarChart3 size={18} />} />
        <Metric label="Personal best" value={attempts.length ? `${best}%` : "—"} note="Highest attempt" icon={<Sparkles size={18} />} />
        <Metric label="Study sets" value={studySets.length} note="In your library" icon={<BookOpen size={18} />} />
        <Metric label="Questions practiced" value={attempts.reduce((sum, attempt) => sum + attempt.total, 0)} note="All attempts" icon={<CircleHelp size={18} />} />
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
  text: string;
  title: string;
  dragging: boolean;
  aiEnhanced: boolean;
  aiConfigured: boolean;
  error: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
  onText: (text: string) => void;
  onTitle: (title: string) => void;
  onDragging: (dragging: boolean) => void;
  onAi: (enabled: boolean) => void;
  onCreate: () => void;
  onCancel: () => void;
}

function UploadView({ file, text, title, dragging, aiEnhanced, aiConfigured, error, fileInputRef, onFile, onText, onTitle, onDragging, onAi, onCreate, onCancel }: UploadProps) {
  function acceptFile(candidate?: File) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".pdf") && candidate.type !== "application/pdf") return;
    onFile(candidate);
    if (!title.trim()) onTitle(stripExtension(candidate.name));
  }
  return (
    <div className="page-wrap upload-page">
      <div className="page-head"><div><p className="eyebrow">NEW STUDY SET</p><h1>Create from your material</h1><p>Upload a PDF or paste text. You will review every detected answer before testing.</p></div><button className="ghost-button" type="button" onClick={onCancel}>Cancel</button></div>
      {error && <div className="error-banner"><X size={18} /><span>{error}</span></div>}
      <section className="upload-layout">
        <div className="upload-form-panel">
          <label className="field-label" htmlFor="set-title">Study set title</label>
          <input id="set-title" className="text-input" value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Example: Biology Midterm Reviewer" />
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); onDragging(true); }}
            onDragLeave={() => onDragging(false)}
            onDrop={(event) => { event.preventDefault(); onDragging(false); acceptFile(event.dataTransfer.files?.[0]); }}
          >
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => acceptFile(event.target.files?.[0])} />
            <div className="big-upload"><Upload size={28} /></div>
            <h3>{file ? "Your PDF is ready" : "Drop your PDF here"}</h3>
            <p>Text-based PDFs work best. Scanned image-only pages need OCR, which is not included yet.</p>
            {file && <div className="file-selected"><span className="pdf">PDF</span><span><strong>{file.name}</strong><small>{Math.max(0.1, file.size / 1024 / 1024).toFixed(1)} MB · Ready to analyze</small></span><button type="button" aria-label="Remove PDF" onClick={() => onFile(null)}><X size={16} /></button></div>}
            <button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>{file ? "Choose another PDF" : "Browse files"}</button>
          </div>
          <div className="or-divider"><span>or paste content</span></div>
          <label className="field-label" htmlFor="paste-material">Questions, notes, or answer key</label>
          <textarea id="paste-material" className="paste-input" value={text} onChange={(event) => onText(event.target.value)} placeholder={`1. What is...\nA. First choice\nB. Second choice\nAnswer: B\n\nOr paste ordinary lecture notes.`} />
          <label className={`switch-row ${!aiConfigured ? "disabled" : ""}`}>
            <span><WandSparkles size={19} /><span><strong>AI-enhanced generation</strong><small>{aiConfigured ? "Generate stronger questions from ordinary notes." : "Add OPENAI_API_KEY to .env to enable this option."}</small></span></span>
            <input type="checkbox" checked={aiEnhanced} disabled={!aiConfigured} onChange={(event) => onAi(event.target.checked)} />
          </label>
          <button className="primary-button create-button" type="button" onClick={onCreate}><Sparkles size={18} /> Create study set <ChevronRight size={17} /></button>
          <p className="privacy-note"><Check size={14} /> Local mode keeps document text in your browser. AI mode sends extracted text to your configured server API.</p>
        </div>
        <aside className="upload-side">
          <p className="eyebrow">WHAT HAPPENS NEXT</p>
          <h2>From document to exam in one smooth flow.</h2>
          <p>QuizForge separates extraction from testing so you can verify answers before trusting the score.</p>
          <div className="feature-list">
            <Feature number="01" icon={<FileText size={18} />} title="Read your material" text="Extract text from PDFs or use pasted content." />
            <Feature number="02" icon={<Sparkles size={18} />} title="Detect questions" text="Recognize numbered questions, choices, inline answers, and answer keys." />
            <Feature number="03" icon={<Check size={18} />} title="Review answers" text="Correct anything uncertain before exam mode." />
            <Feature number="04" icon={<BarChart3 size={18} />} title="Practice and score" text="Shuffle, time, submit, and review your results." />
          </div>
        </aside>
      </section>
    </div>
  );
}

function Feature({ number, icon, title, text }: { number: string; icon: React.ReactNode; title: string; text: string }) {
  return <div className="feature-row"><span className="feature-number">{number}</span><span className="feature-icon">{icon}</span><div><strong>{title}</strong><small>{text}</small></div></div>;
}

function ProcessingView({ fileName, progress, step }: { fileName: string; progress: number; step: ProcessingStep }) {
  const steps: Array<{ id: ProcessingStep; label: string }> = [
    { id: "read", label: "Reading document text" },
    { id: "detect", label: "Detecting questions and choices" },
    { id: "answers", label: "Matching correct answers" },
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
  onDeleteSet: (id: string) => void;
  onSetup: () => void;
  onDashboard: () => void;
}

function EditorView({ studySet, question, onSelect, onUpdateQuestion, onUpdateOption, onMarkCorrect, onSelectionMode, onAddOption, onRemoveOption, onAddQuestion, onDuplicate, onDelete, onDeleteSet, onSetup, onDashboard }: EditorProps) {
  const index = studySet.questions.findIndex((item) => item.id === question.id);
  const verified = studySet.questions.filter(isVerifiedQuestion).length;
  const next = studySet.questions[index + 1];
  const previous = studySet.questions[index - 1];
  const correctIds = getCorrectIds(question);
  const ready = isVerifiedQuestion(question);
  const multiple = isMultipleQuestion(question);
  return (
    <div className="page-wrap editor-page">
      <div className="page-head editor-head">
        <div><button className="breadcrumb-button" type="button" onClick={onDashboard}>Dashboard</button><span className="breadcrumb-separator">/</span><span>Review questions</span><h1>Review extracted questions</h1><p>QuizForge found the structure; you stay in control of the answer key.</p></div>
        <div className="toolbar"><button className="ghost-button danger-ghost" type="button" onClick={() => onDeleteSet(studySet.id)}><Trash2 size={16} /> Delete set</button><button className="primary-button" type="button" onClick={onSetup}>Set up exam <ChevronRight size={16} /></button></div>
      </div>
      <div className="editor-layout">
        <aside className="editor-sidebar">
          <div className="set-summary"><div className="set-file-icon"><FileText size={21} /></div><strong>{studySet.title}</strong><span>{studySet.sourceName}</span><div className="summary-grid"><div><strong>{studySet.questions.length}</strong><small>Questions</small></div><div><strong>{verified}</strong><small>Verified</small></div><div><strong>{studySet.questions.length - verified}</strong><small>Review</small></div></div></div>
          <div className="question-list">
            {studySet.questions.map((item, itemIndex) => (
              <button key={item.id} className={`${item.id === question.id ? "active" : ""} ${item.status === "review" ? "warn" : ""}`} type="button" onClick={() => onSelect(item.id)}>
                <span>{itemIndex + 1}</span><span className="question-list-copy">{item.question}</span>{isVerifiedQuestion(item) ? <Check size={14} /> : <CircleHelp size={14} />}
              </button>
            ))}
          </div>
          <button className="ghost-button full-button" type="button" onClick={onAddQuestion}><Plus size={16} /> Add question</button>
        </aside>
        <section className="question-editor-card" key={question.id}>
          <div className="editor-card-head"><div><div className="editor-status-line"><span className={`status ${ready ? "ready" : "draft"}`}>{ready ? `${correctIds.length} answer${correctIds.length === 1 ? "" : "s"} verified` : "Needs review"}</span>{question.sourcePage && <span className="page-chip">Page {question.sourcePage}</span>}</div><h2>Question {index + 1}</h2><p>{multiple ? "This is a multiple-answer question. Select every correct choice." : ready ? "The detected answer is selected. You can still change it." : "Select the correct option before using this question in an exam."}</p></div><div className="editor-actions"><button className="icon-button" type="button" title="Duplicate" onClick={() => onDuplicate(question.id)}><Copy size={17} /></button><button className="icon-button danger-icon" type="button" title="Delete" onClick={() => onDelete(question.id)}><Trash2 size={17} /></button></div></div>
          <div className="form-group"><label htmlFor="question-text">Question</label><textarea id="question-text" className="question-input" value={question.question} onChange={(event) => onUpdateQuestion(question.id, { question: event.target.value })} /></div>
          <div className="form-group"><div className="label-row answer-heading"><div><label>Answer choices</label><small>{multiple ? "Check all correct answers." : "Choose one correct answer."}</small></div><select className="answer-mode-select" aria-label="Answer selection mode" value={multiple ? "multiple" : "single"} onChange={(event) => onSelectionMode(question.id, event.target.value as "single" | "multiple")}><option value="single">Single answer</option><option value="multiple">Multiple answers</option></select></div><div className="answer-grid">
            {question.options.map((option, optionIndex) => {
              const selected = correctIds.includes(option.id);
              return (
                <div className={`answer-row ${selected ? "correct" : ""}`} key={option.id}>
                  <GripVertical className="drag-handle" size={17} /><span className="answer-letter">{String.fromCharCode(65 + optionIndex)}</span><input value={option.text} onChange={(event) => onUpdateOption(question.id, option.id, event.target.value)} aria-label={`Answer ${String.fromCharCode(65 + optionIndex)}`} /><button className={`correct-radio ${selected ? "selected" : ""}`} type="button" title={selected ? "Correct answer selected" : "Mark as correct"} onClick={() => onMarkCorrect(question.id, option.id)}><Check size={16} /></button><button className="remove-option" type="button" title="Remove option" onClick={() => onRemoveOption(question.id, option.id)}><X size={15} /></button>
                </div>
              );
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
  const preview = verified[0];
  const update = <K extends keyof ExamSettings>(key: K, value: ExamSettings[K]) => onSettings({ ...settings, [key]: value });
  return (
    <div className="page-wrap setup-page">
      <div className="page-head"><div><button className="breadcrumb-button" type="button" onClick={onBack}>Review questions</button><span className="breadcrumb-separator">/</span><span>Exam setup</span><h1>Customize your mock exam</h1><p>Choose the number of questions, timing, and randomization.</p></div></div>
      <div className="setup-grid">
        <section className="setup-panel"><h2>Exam preferences</h2><p>These settings apply only to the next attempt.</p>
          <div className="setting-row"><div className="setting-copy"><strong>Number of questions</strong><small>{verified.length} verified questions are available.</small></div><select value={Math.min(settings.questionCount, verified.length)} onChange={(event) => update("questionCount", Number(event.target.value))}>{Array.from({ length: verified.length }, (_, index) => index + 1).filter((value) => value === verified.length || value % 5 === 0 || value === 1).map((value) => <option value={value} key={value}>{value}</option>)}</select></div>
          <ToggleSetting label="Shuffle questions" description="Use a different question order for every attempt." checked={settings.shuffleQuestions} onChange={(value) => update("shuffleQuestions", value)} />
          <ToggleSetting label="Shuffle answer choices" description="Randomize the choice order without changing the answer key." checked={settings.shuffleAnswers} onChange={(value) => update("shuffleAnswers", value)} />
          <ToggleSetting label="Timed exam" description="Show a countdown while answering." checked={settings.timed} onChange={(value) => update("timed", value)} />
          <div className={`setting-row ${!settings.timed ? "disabled-setting" : ""}`}><div className="setting-copy"><strong>Time limit</strong><small>Select the exam duration.</small></div><select disabled={!settings.timed} value={settings.minutes} onChange={(event) => update("minutes", Number(event.target.value))}>{[5, 10, 20, 30, 45, 60, 90].map((value) => <option value={value} key={value}>{value} minutes</option>)}</select></div>
          <ToggleSetting label="Show explanations" description="Display explanations in the answer review." checked={settings.showExplanations} onChange={(value) => update("showExplanations", value)} />
        </section>
        <aside className="preview-panel"><div className="preview-header"><span className="pill"><Sparkles size={13} /> EXAM PREVIEW</span><h2>{studySet.title}</h2><p>This is how the test experience will feel.</p></div>{preview && <div className="exam-preview-card"><span>{isMultipleQuestion(preview) ? "MULTIPLE ANSWERS" : "QUESTION 01"}</span><h3>{preview.question}</h3>{preview.options.slice(0, 3).map((option, index) => <div className="mini-answer" key={option.id}><span>{String.fromCharCode(65 + index)}</span>{option.text}</div>)}</div>}<div className="exam-details"><div><strong>{Math.min(settings.questionCount, verified.length)}</strong><small>Questions</small></div><div><strong>{settings.timed ? `${settings.minutes}m` : "∞"}</strong><small>Time limit</small></div><div><strong>70%</strong><small>Target</small></div></div><button className="primary-button start-button" type="button" onClick={onStart}>Start mock exam <ChevronRight size={17} /></button></aside>
      </div>
    </div>
  );
}

function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row"><div className="setting-copy"><strong>{label}</strong><small>{description}</small></div><input className="switch-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}


function ExamView({ exam, settings, onAnswer, onFlag, onMove, onSubmit }: { exam: ExamSession | null; settings: ExamSettings; onAnswer: (id: string) => void; onFlag: () => void; onMove: (index: number) => void; onSubmit: () => void }) {
  if (!exam) return null;
  const question = exam.questions[exam.currentIndex];
  const selected = exam.responses[question.id] ?? [];
  const answered = Object.values(exam.responses).filter((answer) => answer.length > 0).length;
  const multiple = isMultipleQuestion(question);
  const expectedSelections = Math.max(2, getCorrectIds(question).length);
  return (
    <div className="exam-shell">
      <header className="exam-topbar"><div className="exam-brand"><span className="brand-mark">Q</span><span><strong>QuizForge Exam</strong><small>Practice mode</small></span></div><div className="exam-meta"><div className="timer"><Clock3 size={17} /><span>{settings.timed ? formatDuration(exam.remainingSeconds) : "Untimed"}</span><small>{settings.timed ? "remaining" : "no limit"}</small></div><button className="primary-button compact" type="button" onClick={onSubmit}>Submit exam</button></div></header>
      <div className="exam-body">
        <aside className="exam-nav"><h2>Question navigator</h2><p>{answered} of {exam.questions.length} answered</p><div className="question-dots">{exam.questions.map((item, index) => <button key={item.id} type="button" className={`question-dot ${index === exam.currentIndex ? "current" : exam.responses[item.id]?.length ? "answered" : ""} ${exam.flagged[item.id] ? "flagged" : ""}`} onClick={() => onMove(index)}>{index + 1}</button>)}</div><div className="exam-legend"><span><i className="legend-current" /> Current</span><span><i className="legend-answered" /> Answered</span><span><i className="legend-flagged" /> Flagged</span><span><i /> Not answered</span></div></aside>
        <main className="exam-main"><div className="exam-progress"><span>Question {exam.currentIndex + 1} of {exam.questions.length}</span><span>{Math.round(((exam.currentIndex + 1) / exam.questions.length) * 100)}%</span></div><div className="exam-progress-track"><span style={{ width: `${((exam.currentIndex + 1) / exam.questions.length) * 100}%` }} /></div><section className="exam-question-card" key={question.id}><div className="question-kicker"><span>{multiple ? "MULTIPLE ANSWERS" : "MULTIPLE CHOICE"}</span><button className={`flag-button ${exam.flagged[question.id] ? "flagged" : ""}`} type="button" onClick={onFlag}><Flag size={15} /> {exam.flagged[question.id] ? "Flagged" : "Flag for review"}</button></div><h1>{question.question}</h1>{multiple && <div className="selection-hint"><Sparkles size={15} /><span>Select all correct answers{getCorrectIds(question).length > 1 ? ` (${expectedSelections} expected)` : ""}.</span></div>}<div className="exam-options">{question.options.map((option, index) => {
          const isSelected = selected.includes(option.id);
          return <button className={`exam-option ${isSelected ? "selected" : ""}`} key={option.id} type="button" onClick={() => onAnswer(option.id)}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span>{isSelected && <span className="option-check"><Check size={18} /></span>}</button>;
        })}</div><div className="exam-footer"><button className="ghost-button" type="button" disabled={exam.currentIndex === 0} onClick={() => onMove(exam.currentIndex - 1)}><ChevronLeft size={16} /> Previous</button>{exam.currentIndex < exam.questions.length - 1 ? <button className="primary-button" type="button" onClick={() => onMove(exam.currentIndex + 1)}>Next question <ChevronRight size={16} /></button> : <button className="primary-button" type="button" onClick={onSubmit}>Finish exam <Check size={16} /></button>}</div></section></main>
      </div>
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
