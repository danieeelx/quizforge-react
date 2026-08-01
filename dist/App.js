import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, FileText, Flag, FolderOpen, GripVertical, Home, Library, Menu, Moon, Plus, Search, Sparkles, Sun, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { createDemoSet } from "./data/demo.js";
import { extractPdfText } from "./lib/pdf.js";
import { generateLocalQuestions, parseQuestionBankDetailed } from "./lib/parser.js";
import { loadStudySets, loadTheme, saveStudySets, saveTheme } from "./lib/storage.js";
import { bestScore, formatDate, formatDuration, shuffle, stripExtension, uid } from "./lib/utils.js";
function getCorrectIds(question) {
    if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length)
        return question.correctOptionIds;
    return question.correctOptionId ? [question.correctOptionId] : [];
}
function isVerifiedQuestion(question) {
    const ids = getCorrectIds(question);
    return ids.length > 0 && ids.every((id) => question.options.some((option) => option.id === id));
}
function isMultipleQuestion(question) {
    return question.selectionMode === "multiple" || getCorrectIds(question).length > 1 || /\bchoose\s+(?:two|three|four|five|six|seven|eight|[2-8])\b/i.test(question.question);
}
function sameAnswerSet(left, right) {
    if (left.length !== right.length)
        return false;
    const expected = new Set(right);
    return left.every((id) => expected.has(id));
}
const defaultSettings = {
    questionCount: 20,
    shuffleQuestions: true,
    shuffleAnswers: true,
    timed: true,
    minutes: 30,
    showExplanations: true
};
function App() {
    const [view, setView] = useState("dashboard");
    const [theme, setTheme] = useState(() => loadTheme());
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [studySets, setStudySets] = useState(() => {
        const stored = loadStudySets();
        return stored.length ? stored : [createDemoSet()];
    });
    const [activeSetId, setActiveSetId] = useState(null);
    const [editingQuestionId, setEditingQuestionId] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [pastedText, setPastedText] = useState("");
    const [studyTitle, setStudyTitle] = useState("");
    const [aiEnhanced, setAiEnhanced] = useState(false);
    const [aiConfigured, setAiConfigured] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processingStep, setProcessingStep] = useState("read");
    const [settings, setSettings] = useState(defaultSettings);
    const [exam, setExam] = useState(null);
    const [resultDetails, setResultDetails] = useState([]);
    const [toast, setToast] = useState("");
    const [importSummary, setImportSummary] = useState(null);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const fileInputRef = useRef(null);
    const activeSet = useMemo(() => studySets.find((set) => set.id === activeSetId) ?? null, [studySets, activeSetId]);
    const editingQuestion = useMemo(() => activeSet?.questions.find((question) => question.id === editingQuestionId) ?? activeSet?.questions[0] ?? null, [activeSet, editingQuestionId]);
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
            .then((data) => setAiConfigured(Boolean(data.aiConfigured)))
            .catch(() => setAiConfigured(false));
    }, []);
    useEffect(() => {
        if (!toast)
            return;
        const timeout = window.setTimeout(() => setToast(""), 2600);
        return () => window.clearTimeout(timeout);
    }, [toast]);
    useEffect(() => {
        if (view !== "exam" || !exam || !settings.timed)
            return;
        if (exam.remainingSeconds <= 0) {
            submitExam(true);
            return;
        }
        const timer = window.setInterval(() => {
            setExam((current) => current ? { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) } : current);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [view, exam?.remainingSeconds, settings.timed]);
    function navigate(nextView) {
        setSidebarOpen(false);
        setError("");
        setView(nextView);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function toggleTheme() {
        setTheme((current) => current === "dark" ? "light" : "dark");
    }
    function openSet(setId, target = "editor") {
        const set = studySets.find((item) => item.id === setId);
        if (!set)
            return;
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
            }
            else if (questions.length < 2) {
                questions = generateLocalQuestions(sourceText);
            }
            if (!questions.length) {
                throw new Error("No usable questions were found. Try a question bank with A–D choices, paste text, or enable AI generation.");
            }
            setProcessingStep("finish");
            setProcessingProgress(94);
            await delay(420);
            const now = new Date().toISOString();
            const set = {
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
        }
        catch (caught) {
            const message = caught instanceof Error ? caught.message : "The study set could not be created.";
            setError(message);
            navigate("upload");
        }
    }
    async function generateWithAi(text, title) {
        const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, title })
        });
        const payload = await response.json().catch(() => ({}));
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
    function updateActiveSet(updater) {
        if (!activeSetId)
            return;
        setStudySets((current) => current.map((set) => set.id === activeSetId
            ? { ...updater(set), updatedAt: new Date().toISOString() }
            : set));
    }
    function updateQuestion(questionId, patch) {
        updateActiveSet((set) => ({
            ...set,
            questions: set.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question)
        }));
    }
    function updateOption(questionId, optionId, text) {
        updateActiveSet((set) => ({
            ...set,
            questions: set.questions.map((question) => question.id === questionId
                ? { ...question, options: question.options.map((option) => option.id === optionId ? { ...option, text } : option) }
                : question)
        }));
    }
    function markCorrect(questionId, optionId) {
        const question = activeSet?.questions.find((item) => item.id === questionId);
        if (!question)
            return;
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
    function setSelectionMode(questionId, mode) {
        const question = activeSet?.questions.find((item) => item.id === questionId);
        if (!question)
            return;
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
    function addOption(questionId) {
        updateActiveSet((set) => ({
            ...set,
            questions: set.questions.map((question) => question.id === questionId
                ? { ...question, options: [...question.options, { id: uid(), text: `Option ${String.fromCharCode(65 + question.options.length)}` }] }
                : question)
        }));
    }
    function removeOption(questionId, optionId) {
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
        const question = {
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
    function duplicateQuestion(questionId) {
        const original = activeSet?.questions.find((question) => question.id === questionId);
        if (!original)
            return;
        const optionMap = new Map();
        const options = original.options.map((option) => {
            const newId = uid();
            optionMap.set(option.id, newId);
            return { id: newId, text: option.text };
        });
        const copy = {
            ...original,
            id: uid(),
            question: `${original.question} (copy)`,
            options,
            correctOptionId: original.correctOptionId ? optionMap.get(original.correctOptionId) ?? null : null,
            correctOptionIds: getCorrectIds(original).map((id) => optionMap.get(id)).filter((id) => Boolean(id))
        };
        updateActiveSet((set) => ({ ...set, questions: [...set.questions, copy] }));
        setEditingQuestionId(copy.id);
        setToast("Question duplicated");
    }
    function deleteQuestion(questionId) {
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
    function deleteStudySet(setId) {
        const set = studySets.find((item) => item.id === setId);
        if (!set || !window.confirm(`Delete “${set.title}”?`))
            return;
        setStudySets((current) => current.filter((item) => item.id !== setId));
        if (activeSetId === setId)
            setActiveSetId(null);
        setToast("Study set deleted");
        navigate("library");
    }
    function openSetup() {
        if (!activeSet)
            return;
        const verified = activeSet.questions.filter(isVerifiedQuestion);
        if (!verified.length) {
            setToast("Mark at least one correct answer before starting an exam");
            return;
        }
        setSettings((current) => ({ ...current, questionCount: Math.min(current.questionCount || verified.length, verified.length) }));
        navigate("setup");
    }
    function beginExam(questionIds) {
        if (!activeSet)
            return;
        let pool = activeSet.questions.filter(isVerifiedQuestion);
        if (questionIds?.length)
            pool = pool.filter((question) => questionIds.includes(question.id));
        if (!pool.length) {
            setToast("No verified questions are available");
            return;
        }
        const count = Math.min(questionIds?.length || settings.questionCount || pool.length, pool.length);
        let selected = settings.shuffleQuestions ? shuffle(pool).slice(0, count) : pool.slice(0, count);
        const examQuestions = selected.map((question) => {
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
    function answerQuestion(optionId) {
        if (!exam)
            return;
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
        if (!exam)
            return;
        const question = exam.questions[exam.currentIndex];
        setExam({ ...exam, flagged: { ...exam.flagged, [question.id]: !exam.flagged[question.id] } });
    }
    function moveQuestion(index) {
        if (!exam)
            return;
        setExam({ ...exam, currentIndex: Math.min(Math.max(index, 0), exam.questions.length - 1) });
    }
    function submitExam(autoSubmitted = false) {
        if (!exam || !activeSet)
            return;
        const unanswered = exam.questions.filter((question) => !(exam.responses[question.id]?.length)).length;
        if (!autoSubmitted && unanswered && !window.confirm(`Submit with ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}?`))
            return;
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
        if (autoSubmitted)
            setToast("Time expired — the exam was submitted");
        navigate("results");
    }
    const allAttempts = useMemo(() => studySets.flatMap((set) => set.attempts.map((attempt) => ({ ...attempt, setTitle: set.title }))), [studySets]);
    const averageScore = allAttempts.length ? Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / allAttempts.length) : 0;
    return (_jsxs("div", { className: "app-root", children: [view === "exam" ? (_jsx(ExamView, { exam: exam, settings: settings, onAnswer: answerQuestion, onFlag: toggleFlag, onMove: moveQuestion, onSubmit: () => submitExam(false) })) : view === "results" ? (_jsx(ResultsView, { details: resultDetails, settings: settings, exam: exam, onRetake: () => beginExam(), onRetakeWrong: () => beginExam(resultDetails.filter((detail) => !detail.correct).map((detail) => detail.question.id)), onDashboard: () => navigate("dashboard") })) : (_jsxs(Shell, { view: view, theme: theme, sidebarOpen: sidebarOpen, onToggleSidebar: () => setSidebarOpen((current) => !current), onNavigate: navigate, onTheme: toggleTheme, onNew: newStudySet, children: [view === "dashboard" && (_jsx(Dashboard, { studySets: studySets, attempts: allAttempts.length, averageScore: averageScore, onNew: newStudySet, onOpen: openSet, onNavigate: navigate })), view === "library" && (_jsx(LibraryView, { studySets: studySets, search: search, onSearch: setSearch, onOpen: openSet, onNew: newStudySet })), view === "performance" && _jsx(PerformanceView, { studySets: studySets, attempts: allAttempts, averageScore: averageScore }), view === "upload" && (_jsx(UploadView, { file: selectedFile, text: pastedText, title: studyTitle, dragging: dragging, aiEnhanced: aiEnhanced, aiConfigured: aiConfigured, error: error, fileInputRef: fileInputRef, onFile: setSelectedFile, onText: setPastedText, onTitle: setStudyTitle, onDragging: setDragging, onAi: setAiEnhanced, onCreate: createStudySet, onCancel: () => navigate("dashboard") })), view === "processing" && (_jsx(ProcessingView, { fileName: selectedFile?.name || "Pasted study material", progress: processingProgress, step: processingStep })), view === "editor" && activeSet && editingQuestion && (_jsx(EditorView, { studySet: activeSet, question: editingQuestion, onSelect: setEditingQuestionId, onUpdateQuestion: updateQuestion, onUpdateOption: updateOption, onMarkCorrect: markCorrect, onSelectionMode: setSelectionMode, onAddOption: addOption, onRemoveOption: removeOption, onAddQuestion: addQuestion, onDuplicate: duplicateQuestion, onDelete: deleteQuestion, onDeleteSet: deleteStudySet, onSetup: openSetup, onDashboard: () => navigate("dashboard") })), view === "setup" && activeSet && (_jsx(SetupView, { studySet: activeSet, settings: settings, onSettings: setSettings, onBack: () => navigate("editor"), onStart: () => beginExam() }))] })), toast && _jsxs("div", { className: "toast", role: "status", children: [_jsx("span", { className: "toast-icon", children: _jsx(Check, { size: 15 }) }), _jsx("span", { children: toast }), _jsx("i", {})] }), importSummary && _jsx(ImportSummaryModal, { summary: importSummary, onClose: () => setImportSummary(null) })] }));
}
function ImportSummaryModal({ summary, onClose }) {
    const complete = summary.expected === summary.extracted && summary.warnings.length === 0;
    return (_jsx("div", { className: "modal-backdrop", role: "presentation", children: _jsxs("section", { className: "import-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "import-title", children: [_jsxs("div", { className: `modal-success-orb ${complete ? "complete" : "warning"}`, children: [complete ? _jsx(Check, { size: 29 }) : _jsx(CircleHelp, { size: 29 }), _jsx("span", { className: "orb-ring" })] }), _jsx("button", { className: "modal-close", type: "button", "aria-label": "Close import summary", onClick: onClose, children: _jsx(X, { size: 18 }) }), _jsx("p", { className: "eyebrow", children: "PDF IMPORT COMPLETE" }), _jsx("h2", { id: "import-title", children: complete ? "Everything lined up." : "Import finished with notes." }), _jsxs("p", { className: "modal-copy", children: ["\u201C", summary.title, "\u201D is ready for review. QuizForge compared the extracted items with the numbering found in the PDF."] }), _jsxs("div", { className: "import-stats", children: [_jsxs("div", { children: [_jsx("strong", { children: summary.extracted }), _jsx("small", { children: "Questions extracted" })] }), _jsxs("div", { children: [_jsx("strong", { children: summary.expected }), _jsx("small", { children: "Numbered in PDF" })] }), _jsxs("div", { children: [_jsx("strong", { children: summary.verified }), _jsx("small", { children: "Answers detected" })] })] }), summary.warnings.length > 0 && (_jsx("div", { className: "modal-warning-list", children: summary.warnings.slice(0, 3).map((warning) => _jsxs("p", { children: [_jsx(CircleHelp, { size: 14 }), " ", warning] }, warning)) })), _jsxs("button", { className: "primary-button modal-primary", type: "button", onClick: onClose, children: ["Review questions ", _jsx(ChevronRight, { size: 16 })] })] }) }));
}
function Shell({ view, theme, sidebarOpen, children, onToggleSidebar, onNavigate, onTheme, onNew }) {
    const nav = [
        { id: "dashboard", label: "Dashboard", icon: Home },
        { id: "library", label: "Study sets", icon: Library },
        { id: "performance", label: "Performance", icon: BarChart3 }
    ];
    return (_jsxs("div", { className: "app-shell", children: [_jsx("button", { className: "mobile-menu", type: "button", "aria-label": "Toggle navigation", onClick: onToggleSidebar, children: _jsx(Menu, { size: 20 }) }), sidebarOpen && _jsx("button", { className: "sidebar-scrim", type: "button", "aria-label": "Close navigation", onClick: onToggleSidebar }), _jsxs("aside", { className: `sidebar ${sidebarOpen ? "open" : ""}`, children: [_jsxs("button", { className: "brand", type: "button", onClick: () => onNavigate("dashboard"), children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsxs("span", { children: [_jsx("strong", { children: "QuizForge" }), _jsx("small", { children: "Study smarter" })] })] }), _jsx("nav", { className: "side-nav", "aria-label": "Main navigation", children: nav.map((item) => {
                            const Icon = item.icon;
                            return (_jsxs("button", { type: "button", className: `nav-item ${view === item.id ? "active" : ""}`, onClick: () => onNavigate(item.id), children: [_jsx(Icon, { size: 18 }), _jsx("span", { children: item.label })] }, item.id));
                        }) }), _jsxs("div", { className: "sidebar-card", children: [_jsx(Sparkles, { size: 18 }), _jsx("strong", { children: "AI study mode" }), _jsx("p", { children: "Generate questions from notes when your server API key is configured." }), _jsx("button", { type: "button", onClick: onNew, children: "Try it" })] }), _jsxs("div", { className: "profile", children: [_jsx("span", { className: "avatar", children: "D" }), _jsxs("span", { children: [_jsx("strong", { children: "Daniel" }), _jsx("small", { children: "Local workspace" })] })] })] }), _jsxs("main", { className: "main-content", children: [_jsxs("header", { className: "global-topbar", children: [_jsxs("div", { className: "mobile-brand", children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsx("strong", { children: "QuizForge" })] }), _jsxs("div", { className: "global-actions", children: [_jsx("button", { className: "icon-button", type: "button", "aria-label": "Toggle theme", onClick: onTheme, children: theme === "dark" ? _jsx(Sun, { size: 18 }) : _jsx(Moon, { size: 18 }) }), _jsxs("button", { className: "primary-button compact", type: "button", onClick: onNew, children: [_jsx(Plus, { size: 17 }), " New study set"] })] })] }), _jsx("div", { className: "view-transition", children: children }, view)] })] }));
}
function Dashboard({ studySets, attempts, averageScore, onNew, onOpen, onNavigate }) {
    const recent = studySets.slice(0, 3);
    const totalQuestions = studySets.reduce((sum, set) => sum + set.questions.length, 0);
    return (_jsxs("div", { className: "page-wrap dashboard-page", children: [_jsx("section", { className: "welcome-row", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR PERSONAL EXAM BUILDER" }), _jsx("h1", { children: "Welcome back, Daniel" }), _jsx("p", { children: "Create a new test or continue one of your saved study sets." })] }) }), _jsxs("section", { className: "hero-card", children: [_jsxs("div", { className: "hero-copy", children: [_jsxs("span", { className: "pill", children: [_jsx(Sparkles, { size: 14 }), " AI-POWERED STUDY"] }), _jsxs("h2", { children: ["Turn any PDF into a ", _jsx("em", { children: "practice exam." })] }), _jsx("p", { children: "Upload a reviewer, lecture notes, or a question bank. QuizForge extracts questions, identifies available answers, and builds a customizable mock test." }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { className: "primary-button large", type: "button", onClick: onNew, children: [_jsx(Upload, { size: 18 }), " Upload PDF ", _jsx(ChevronRight, { size: 17 })] }), _jsxs("button", { className: "secondary-button large", type: "button", onClick: onNew, children: [_jsx(FileText, { size: 18 }), " Paste text"] })] }), _jsxs("div", { className: "privacy-line", children: [_jsx(Check, { size: 15 }), " PDF extraction happens in your browser"] })] }), _jsxs("div", { className: "upload-visual", "aria-hidden": "true", children: [_jsx("div", { className: "upload-orbit orbit-one" }), _jsx("div", { className: "upload-orbit orbit-two" }), _jsxs("div", { className: "file-card rear", children: [_jsx("span", { children: "PDF" }), _jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("div", { className: "file-card front", children: [_jsx("div", { className: "file-icon", children: "PDF" }), _jsx("strong", { children: "Reviewer.pdf" }), _jsx("small", { children: "Ready to transform" }), _jsx("div", { className: "mini-progress", children: _jsx("span", {}) })] }), _jsx("div", { className: "floating-chip chip-one", children: "24 questions" }), _jsxs("div", { className: "floating-chip chip-two", children: ["Answer key found ", _jsx(Check, { size: 12 })] })] })] }), _jsxs("section", { className: "metric-grid", "aria-label": "Study overview", children: [_jsx(Metric, { label: "Study sets", value: studySets.length, note: "Saved locally", icon: _jsx(BookOpen, { size: 18 }) }), _jsx(Metric, { label: "Questions", value: totalQuestions, note: "Across your library", icon: _jsx(CircleHelp, { size: 18 }) }), _jsx(Metric, { label: "Attempts", value: attempts, note: "Completed exams", icon: _jsx(Clock3, { size: 18 }) }), _jsx(Metric, { label: "Average", value: attempts ? `${averageScore}%` : "—", note: "All attempts", icon: _jsx(BarChart3, { size: 18 }) })] }), _jsxs("section", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR LIBRARY" }), _jsx("h3", { children: "Continue studying" })] }), _jsxs("button", { className: "text-button", type: "button", onClick: () => onNavigate("library"), children: ["View all ", _jsx(ChevronRight, { size: 15 })] })] }), _jsxs("section", { className: "study-grid", children: [recent.map((set, index) => _jsx(StudyCard, { studySet: set, index: index, onOpen: onOpen }, set.id)), _jsxs("button", { className: "new-card", type: "button", onClick: onNew, children: [_jsx("span", { className: "new-icon", children: _jsx(Plus, { size: 22 }) }), _jsx("strong", { children: "Create a study set" }), _jsx("p", { children: "Upload a PDF, paste notes, or begin with your own questions." })] })] })] }));
}
function Metric({ label, value, note, icon }) {
    return _jsxs("article", { className: "metric-card", children: [_jsx("div", { className: "metric-icon", children: icon }), _jsxs("div", { children: [_jsx("small", { children: label }), _jsx("strong", { children: value }), _jsx("span", { children: note })] })] });
}
function StudyCard({ studySet, index, onOpen }) {
    const verified = studySet.questions.filter((question) => question.correctOptionId).length;
    const best = bestScore(studySet.attempts);
    const shades = ["purple", "cyan", "orange"];
    return (_jsxs("article", { className: "study-card", children: [_jsxs("div", { className: "study-top", children: [_jsx("span", { className: `subject-icon ${shades[index % shades.length]}`, children: studySet.title.slice(0, 2).toUpperCase() }), _jsx("span", { className: `status ${verified === studySet.questions.length ? "ready" : "draft"}`, children: verified === studySet.questions.length ? "Ready" : "Review" })] }), _jsx("h4", { children: studySet.title }), _jsxs("p", { children: [studySet.questions.length, " questions \u00B7 Updated ", formatDate(studySet.updatedAt)] }), _jsxs("div", { className: "progress-meta", children: [_jsx("span", { children: studySet.attempts.length ? "Best score" : "Answers verified" }), _jsx("strong", { children: studySet.attempts.length ? `${best}%` : `${Math.round((verified / studySet.questions.length) * 100)}%` })] }), _jsx("div", { className: "progress-track", children: _jsx("span", { style: { width: `${studySet.attempts.length ? best : (verified / studySet.questions.length) * 100}%` } }) }), _jsxs("button", { className: "card-button", type: "button", onClick: () => onOpen(studySet.id, studySet.attempts.length ? "setup" : "editor"), children: [studySet.attempts.length ? "Practice again" : "Review questions", _jsx(ChevronRight, { size: 14 })] })] }));
}
function LibraryView({ studySets, search, onSearch, onOpen, onNew }) {
    const filtered = studySets.filter((set) => set.title.toLowerCase().includes(search.toLowerCase()) || set.sourceName.toLowerCase().includes(search.toLowerCase()));
    return (_jsxs("div", { className: "page-wrap", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR LIBRARY" }), _jsx("h1", { children: "Study sets" }), _jsx("p", { children: "Manage extracted questions and start new practice attempts." })] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onNew, children: [_jsx(Plus, { size: 17 }), " New set"] })] }), _jsxs("label", { className: "search-box", children: [_jsx(Search, { size: 18 }), _jsx("input", { value: search, onChange: (event) => onSearch(event.target.value), placeholder: "Search study sets" })] }), _jsxs("section", { className: "library-list", children: [filtered.map((set, index) => (_jsxs("article", { className: "library-row", children: [_jsx("span", { className: `subject-icon ${["purple", "cyan", "orange"][index % 3]}`, children: set.title.slice(0, 2).toUpperCase() }), _jsxs("div", { className: "library-copy", children: [_jsx("strong", { children: set.title }), _jsxs("span", { children: [set.questions.length, " questions \u00B7 ", set.attempts.length, " attempt", set.attempts.length === 1 ? "" : "s", " \u00B7 ", set.sourceName] })] }), _jsxs("div", { className: "library-score", children: [_jsx("small", { children: "Best score" }), _jsx("strong", { children: set.attempts.length ? `${bestScore(set.attempts)}%` : "—" })] }), _jsxs("button", { className: "secondary-button compact", type: "button", onClick: () => onOpen(set.id), children: ["Open ", _jsx(ChevronRight, { size: 15 })] })] }, set.id))), !filtered.length && _jsxs("div", { className: "empty-state", children: [_jsx(FolderOpen, { size: 35 }), _jsx("strong", { children: "No study sets found" }), _jsx("p", { children: "Try another search or create a new set." })] })] })] }));
}
function PerformanceView({ studySets, attempts, averageScore }) {
    const best = attempts.reduce((score, attempt) => Math.max(score, attempt.score), 0);
    const recent = attempts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    return (_jsxs("div", { className: "page-wrap", children: [_jsx("div", { className: "page-head", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "PERFORMANCE" }), _jsx("h1", { children: "Your progress" }), _jsx("p", { children: "Results are stored only in this browser." })] }) }), _jsxs("section", { className: "metric-grid performance-metrics", children: [_jsx(Metric, { label: "Average score", value: attempts.length ? `${averageScore}%` : "—", note: `${attempts.length} completed attempts`, icon: _jsx(BarChart3, { size: 18 }) }), _jsx(Metric, { label: "Personal best", value: attempts.length ? `${best}%` : "—", note: "Highest attempt", icon: _jsx(Sparkles, { size: 18 }) }), _jsx(Metric, { label: "Study sets", value: studySets.length, note: "In your library", icon: _jsx(BookOpen, { size: 18 }) }), _jsx(Metric, { label: "Questions practiced", value: attempts.reduce((sum, attempt) => sum + attempt.total, 0), note: "All attempts", icon: _jsx(CircleHelp, { size: 18 }) })] }), _jsxs("section", { className: "performance-panel", children: [_jsx("div", { className: "section-heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "RECENT ATTEMPTS" }), _jsx("h3", { children: "Exam history" })] }) }), recent.length ? recent.map((attempt) => (_jsxs("div", { className: "attempt-row", children: [_jsxs("div", { children: [_jsx("strong", { children: attempt.setTitle }), _jsxs("span", { children: [formatDate(attempt.date), " \u00B7 ", formatDuration(attempt.durationSeconds)] })] }), _jsx("div", { className: "attempt-bar", children: _jsx("span", { style: { width: `${attempt.score}%` } }) }), _jsxs("strong", { className: attempt.score >= 70 ? "good-score" : "low-score", children: [attempt.score, "%"] })] }, `${attempt.date}-${attempt.setTitle}`))) : _jsxs("div", { className: "empty-state compact-empty", children: [_jsx(BarChart3, { size: 34 }), _jsx("strong", { children: "No attempts yet" }), _jsx("p", { children: "Complete a mock exam to see your results here." })] })] })] }));
}
function UploadView({ file, text, title, dragging, aiEnhanced, aiConfigured, error, fileInputRef, onFile, onText, onTitle, onDragging, onAi, onCreate, onCancel }) {
    function acceptFile(candidate) {
        if (!candidate)
            return;
        if (!candidate.name.toLowerCase().endsWith(".pdf") && candidate.type !== "application/pdf")
            return;
        onFile(candidate);
        if (!title.trim())
            onTitle(stripExtension(candidate.name));
    }
    return (_jsxs("div", { className: "page-wrap upload-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "NEW STUDY SET" }), _jsx("h1", { children: "Create from your material" }), _jsx("p", { children: "Upload a PDF or paste text. You will review every detected answer before testing." })] }), _jsx("button", { className: "ghost-button", type: "button", onClick: onCancel, children: "Cancel" })] }), error && _jsxs("div", { className: "error-banner", children: [_jsx(X, { size: 18 }), _jsx("span", { children: error })] }), _jsxs("section", { className: "upload-layout", children: [_jsxs("div", { className: "upload-form-panel", children: [_jsx("label", { className: "field-label", htmlFor: "set-title", children: "Study set title" }), _jsx("input", { id: "set-title", className: "text-input", value: title, onChange: (event) => onTitle(event.target.value), placeholder: "Example: Biology Midterm Reviewer" }), _jsxs("div", { className: `drop-zone ${dragging ? "dragging" : ""}`, onDragOver: (event) => { event.preventDefault(); onDragging(true); }, onDragLeave: () => onDragging(false), onDrop: (event) => { event.preventDefault(); onDragging(false); acceptFile(event.dataTransfer.files?.[0]); }, children: [_jsx("input", { ref: fileInputRef, type: "file", accept: "application/pdf,.pdf", onChange: (event) => acceptFile(event.target.files?.[0]) }), _jsx("div", { className: "big-upload", children: _jsx(Upload, { size: 28 }) }), _jsx("h3", { children: file ? "Your PDF is ready" : "Drop your PDF here" }), _jsx("p", { children: "Text-based PDFs work best. Scanned image-only pages need OCR, which is not included yet." }), file && _jsxs("div", { className: "file-selected", children: [_jsx("span", { className: "pdf", children: "PDF" }), _jsxs("span", { children: [_jsx("strong", { children: file.name }), _jsxs("small", { children: [Math.max(0.1, file.size / 1024 / 1024).toFixed(1), " MB \u00B7 Ready to analyze"] })] }), _jsx("button", { type: "button", "aria-label": "Remove PDF", onClick: () => onFile(null), children: _jsx(X, { size: 16 }) })] }), _jsx("button", { className: "secondary-button", type: "button", onClick: () => fileInputRef.current?.click(), children: file ? "Choose another PDF" : "Browse files" })] }), _jsx("div", { className: "or-divider", children: _jsx("span", { children: "or paste content" }) }), _jsx("label", { className: "field-label", htmlFor: "paste-material", children: "Questions, notes, or answer key" }), _jsx("textarea", { id: "paste-material", className: "paste-input", value: text, onChange: (event) => onText(event.target.value), placeholder: `1. What is...\nA. First choice\nB. Second choice\nAnswer: B\n\nOr paste ordinary lecture notes.` }), _jsxs("label", { className: `switch-row ${!aiConfigured ? "disabled" : ""}`, children: [_jsxs("span", { children: [_jsx(WandSparkles, { size: 19 }), _jsxs("span", { children: [_jsx("strong", { children: "AI-enhanced generation" }), _jsx("small", { children: aiConfigured ? "Generate stronger questions from ordinary notes." : "Add OPENAI_API_KEY to .env to enable this option." })] })] }), _jsx("input", { type: "checkbox", checked: aiEnhanced, disabled: !aiConfigured, onChange: (event) => onAi(event.target.checked) })] }), _jsxs("button", { className: "primary-button create-button", type: "button", onClick: onCreate, children: [_jsx(Sparkles, { size: 18 }), " Create study set ", _jsx(ChevronRight, { size: 17 })] }), _jsxs("p", { className: "privacy-note", children: [_jsx(Check, { size: 14 }), " Local mode keeps document text in your browser. AI mode sends extracted text to your configured server API."] })] }), _jsxs("aside", { className: "upload-side", children: [_jsx("p", { className: "eyebrow", children: "WHAT HAPPENS NEXT" }), _jsx("h2", { children: "From document to exam in one smooth flow." }), _jsx("p", { children: "QuizForge separates extraction from testing so you can verify answers before trusting the score." }), _jsxs("div", { className: "feature-list", children: [_jsx(Feature, { number: "01", icon: _jsx(FileText, { size: 18 }), title: "Read your material", text: "Extract text from PDFs or use pasted content." }), _jsx(Feature, { number: "02", icon: _jsx(Sparkles, { size: 18 }), title: "Detect questions", text: "Recognize numbered questions, choices, inline answers, and answer keys." }), _jsx(Feature, { number: "03", icon: _jsx(Check, { size: 18 }), title: "Review answers", text: "Correct anything uncertain before exam mode." }), _jsx(Feature, { number: "04", icon: _jsx(BarChart3, { size: 18 }), title: "Practice and score", text: "Shuffle, time, submit, and review your results." })] })] })] })] }));
}
function Feature({ number, icon, title, text }) {
    return _jsxs("div", { className: "feature-row", children: [_jsx("span", { className: "feature-number", children: number }), _jsx("span", { className: "feature-icon", children: icon }), _jsxs("div", { children: [_jsx("strong", { children: title }), _jsx("small", { children: text })] })] });
}
function ProcessingView({ fileName, progress, step }) {
    const steps = [
        { id: "read", label: "Reading document text" },
        { id: "detect", label: "Detecting questions and choices" },
        { id: "answers", label: "Matching correct answers" },
        { id: "finish", label: "Preparing the review screen" }
    ];
    const currentIndex = steps.findIndex((item) => item.id === step);
    return (_jsx("div", { className: "processing-page", children: _jsxs("section", { className: "processing-card", children: [_jsx("div", { className: "processor", children: _jsx(Sparkles, { size: 30 }) }), _jsxs("span", { className: "pill", children: [_jsx(WandSparkles, { size: 14 }), " BUILDING STUDY SET"] }), _jsx("h1", { children: "Turning your material into a mock exam" }), _jsx("p", { children: fileName }), _jsx("div", { className: "process-progress", children: _jsx("span", { style: { width: `${progress}%` } }) }), _jsxs("strong", { className: "progress-number", children: [progress, "%"] }), _jsx("div", { className: "process-list", children: steps.map((item, index) => (_jsxs("div", { className: `process-step ${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}`, children: [_jsx("span", { className: "step-dot", children: index < currentIndex ? _jsx(Check, { size: 15 }) : index + 1 }), _jsx("span", { children: item.label })] }, item.id))) })] }) }));
}
function EditorView({ studySet, question, onSelect, onUpdateQuestion, onUpdateOption, onMarkCorrect, onSelectionMode, onAddOption, onRemoveOption, onAddQuestion, onDuplicate, onDelete, onDeleteSet, onSetup, onDashboard }) {
    const index = studySet.questions.findIndex((item) => item.id === question.id);
    const verified = studySet.questions.filter(isVerifiedQuestion).length;
    const next = studySet.questions[index + 1];
    const previous = studySet.questions[index - 1];
    const correctIds = getCorrectIds(question);
    const ready = isVerifiedQuestion(question);
    const multiple = isMultipleQuestion(question);
    return (_jsxs("div", { className: "page-wrap editor-page", children: [_jsxs("div", { className: "page-head editor-head", children: [_jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onDashboard, children: "Dashboard" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Review questions" }), _jsx("h1", { children: "Review extracted questions" }), _jsx("p", { children: "QuizForge found the structure; you stay in control of the answer key." })] }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button danger-ghost", type: "button", onClick: () => onDeleteSet(studySet.id), children: [_jsx(Trash2, { size: 16 }), " Delete set"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onSetup, children: ["Set up exam ", _jsx(ChevronRight, { size: 16 })] })] })] }), _jsxs("div", { className: "editor-layout", children: [_jsxs("aside", { className: "editor-sidebar", children: [_jsxs("div", { className: "set-summary", children: [_jsx("div", { className: "set-file-icon", children: _jsx(FileText, { size: 21 }) }), _jsx("strong", { children: studySet.title }), _jsx("span", { children: studySet.sourceName }), _jsxs("div", { className: "summary-grid", children: [_jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: verified }), _jsx("small", { children: "Verified" })] }), _jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length - verified }), _jsx("small", { children: "Review" })] })] })] }), _jsx("div", { className: "question-list", children: studySet.questions.map((item, itemIndex) => (_jsxs("button", { className: `${item.id === question.id ? "active" : ""} ${item.status === "review" ? "warn" : ""}`, type: "button", onClick: () => onSelect(item.id), children: [_jsx("span", { children: itemIndex + 1 }), _jsx("span", { className: "question-list-copy", children: item.question }), isVerifiedQuestion(item) ? _jsx(Check, { size: 14 }) : _jsx(CircleHelp, { size: 14 })] }, item.id))) }), _jsxs("button", { className: "ghost-button full-button", type: "button", onClick: onAddQuestion, children: [_jsx(Plus, { size: 16 }), " Add question"] })] }), _jsxs("section", { className: "question-editor-card", children: [_jsxs("div", { className: "editor-card-head", children: [_jsxs("div", { children: [_jsxs("div", { className: "editor-status-line", children: [_jsx("span", { className: `status ${ready ? "ready" : "draft"}`, children: ready ? `${correctIds.length} answer${correctIds.length === 1 ? "" : "s"} verified` : "Needs review" }), question.sourcePage && _jsxs("span", { className: "page-chip", children: ["Page ", question.sourcePage] })] }), _jsxs("h2", { children: ["Question ", index + 1] }), _jsx("p", { children: multiple ? "This is a multiple-answer question. Select every correct choice." : ready ? "The detected answer is selected. You can still change it." : "Select the correct option before using this question in an exam." })] }), _jsxs("div", { className: "editor-actions", children: [_jsx("button", { className: "icon-button", type: "button", title: "Duplicate", onClick: () => onDuplicate(question.id), children: _jsx(Copy, { size: 17 }) }), _jsx("button", { className: "icon-button danger-icon", type: "button", title: "Delete", onClick: () => onDelete(question.id), children: _jsx(Trash2, { size: 17 }) })] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-text", children: "Question" }), _jsx("textarea", { id: "question-text", className: "question-input", value: question.question, onChange: (event) => onUpdateQuestion(question.id, { question: event.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsxs("div", { className: "label-row answer-heading", children: [_jsxs("div", { children: [_jsx("label", { children: "Answer choices" }), _jsx("small", { children: multiple ? "Check all correct answers." : "Choose one correct answer." })] }), _jsxs("select", { className: "answer-mode-select", "aria-label": "Answer selection mode", value: multiple ? "multiple" : "single", onChange: (event) => onSelectionMode(question.id, event.target.value), children: [_jsx("option", { value: "single", children: "Single answer" }), _jsx("option", { value: "multiple", children: "Multiple answers" })] })] }), _jsx("div", { className: "answer-grid", children: question.options.map((option, optionIndex) => {
                                            const selected = correctIds.includes(option.id);
                                            return (_jsxs("div", { className: `answer-row ${selected ? "correct" : ""}`, children: [_jsx(GripVertical, { className: "drag-handle", size: 17 }), _jsx("span", { className: "answer-letter", children: String.fromCharCode(65 + optionIndex) }), _jsx("input", { value: option.text, onChange: (event) => onUpdateOption(question.id, option.id, event.target.value), "aria-label": `Answer ${String.fromCharCode(65 + optionIndex)}` }), _jsx("button", { className: `correct-radio ${selected ? "selected" : ""}`, type: "button", title: selected ? "Correct answer selected" : "Mark as correct", onClick: () => onMarkCorrect(question.id, option.id), children: _jsx(Check, { size: 16 }) }), _jsx("button", { className: "remove-option", type: "button", title: "Remove option", onClick: () => onRemoveOption(question.id, option.id), children: _jsx(X, { size: 15 }) })] }, option.id));
                                        }) }), _jsxs("button", { className: "text-button add-option", type: "button", onClick: () => onAddOption(question.id), children: [_jsx(Plus, { size: 15 }), " Add answer choice"] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "explanation", children: "Explanation" }), _jsx("textarea", { id: "explanation", className: "explanation-input", value: question.explanation, onChange: (event) => onUpdateQuestion(question.id, { explanation: event.target.value }), placeholder: "Explain why the selected answer is correct." })] }), _jsxs("div", { className: "editor-footer", children: [_jsx("span", { children: "Changes save automatically in this browser." }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: !previous, onClick: () => previous && onSelect(previous.id), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => next ? onSelect(next.id) : onSetup, children: [next ? "Next question" : "Set up exam", _jsx(ChevronRight, { size: 16 })] })] })] })] }, question.id)] })] }));
}
function SetupView({ studySet, settings, onSettings, onBack, onStart }) {
    const verified = studySet.questions.filter(isVerifiedQuestion);
    const preview = verified[0];
    const update = (key, value) => onSettings({ ...settings, [key]: value });
    return (_jsxs("div", { className: "page-wrap setup-page", children: [_jsx("div", { className: "page-head", children: _jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onBack, children: "Review questions" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Exam setup" }), _jsx("h1", { children: "Customize your mock exam" }), _jsx("p", { children: "Choose the number of questions, timing, and randomization." })] }) }), _jsxs("div", { className: "setup-grid", children: [_jsxs("section", { className: "setup-panel", children: [_jsx("h2", { children: "Exam preferences" }), _jsx("p", { children: "These settings apply only to the next attempt." }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Number of questions" }), _jsxs("small", { children: [verified.length, " verified questions are available."] })] }), _jsx("select", { value: Math.min(settings.questionCount, verified.length), onChange: (event) => update("questionCount", Number(event.target.value)), children: Array.from({ length: verified.length }, (_, index) => index + 1).filter((value) => value === verified.length || value % 5 === 0 || value === 1).map((value) => _jsx("option", { value: value, children: value }, value)) })] }), _jsx(ToggleSetting, { label: "Shuffle questions", description: "Use a different question order for every attempt.", checked: settings.shuffleQuestions, onChange: (value) => update("shuffleQuestions", value) }), _jsx(ToggleSetting, { label: "Shuffle answer choices", description: "Randomize the choice order without changing the answer key.", checked: settings.shuffleAnswers, onChange: (value) => update("shuffleAnswers", value) }), _jsx(ToggleSetting, { label: "Timed exam", description: "Show a countdown while answering.", checked: settings.timed, onChange: (value) => update("timed", value) }), _jsxs("div", { className: `setting-row ${!settings.timed ? "disabled-setting" : ""}`, children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Time limit" }), _jsx("small", { children: "Select the exam duration." })] }), _jsx("select", { disabled: !settings.timed, value: settings.minutes, onChange: (event) => update("minutes", Number(event.target.value)), children: [5, 10, 20, 30, 45, 60, 90].map((value) => _jsxs("option", { value: value, children: [value, " minutes"] }, value)) })] }), _jsx(ToggleSetting, { label: "Show explanations", description: "Display explanations in the answer review.", checked: settings.showExplanations, onChange: (value) => update("showExplanations", value) })] }), _jsxs("aside", { className: "preview-panel", children: [_jsxs("div", { className: "preview-header", children: [_jsxs("span", { className: "pill", children: [_jsx(Sparkles, { size: 13 }), " EXAM PREVIEW"] }), _jsx("h2", { children: studySet.title }), _jsx("p", { children: "This is how the test experience will feel." })] }), preview && _jsxs("div", { className: "exam-preview-card", children: [_jsx("span", { children: isMultipleQuestion(preview) ? "MULTIPLE ANSWERS" : "QUESTION 01" }), _jsx("h3", { children: preview.question }), preview.options.slice(0, 3).map((option, index) => _jsxs("div", { className: "mini-answer", children: [_jsx("span", { children: String.fromCharCode(65 + index) }), option.text] }, option.id))] }), _jsxs("div", { className: "exam-details", children: [_jsxs("div", { children: [_jsx("strong", { children: Math.min(settings.questionCount, verified.length) }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: settings.timed ? `${settings.minutes}m` : "∞" }), _jsx("small", { children: "Time limit" })] }), _jsxs("div", { children: [_jsx("strong", { children: "70%" }), _jsx("small", { children: "Target" })] })] }), _jsxs("button", { className: "primary-button start-button", type: "button", onClick: onStart, children: ["Start mock exam ", _jsx(ChevronRight, { size: 17 })] })] })] })] }));
}
function ToggleSetting({ label, description, checked, onChange }) {
    return _jsxs("label", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: label }), _jsx("small", { children: description })] }), _jsx("input", { className: "switch-input", type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) })] });
}
function ExamView({ exam, settings, onAnswer, onFlag, onMove, onSubmit }) {
    if (!exam)
        return null;
    const question = exam.questions[exam.currentIndex];
    const selected = exam.responses[question.id] ?? [];
    const answered = Object.values(exam.responses).filter((answer) => answer.length > 0).length;
    const multiple = isMultipleQuestion(question);
    const expectedSelections = Math.max(2, getCorrectIds(question).length);
    return (_jsxs("div", { className: "exam-shell", children: [_jsxs("header", { className: "exam-topbar", children: [_jsxs("div", { className: "exam-brand", children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsxs("span", { children: [_jsx("strong", { children: "QuizForge Exam" }), _jsx("small", { children: "Practice mode" })] })] }), _jsxs("div", { className: "exam-meta", children: [_jsxs("div", { className: "timer", children: [_jsx(Clock3, { size: 17 }), _jsx("span", { children: settings.timed ? formatDuration(exam.remainingSeconds) : "Untimed" }), _jsx("small", { children: settings.timed ? "remaining" : "no limit" })] }), _jsx("button", { className: "primary-button compact", type: "button", onClick: onSubmit, children: "Submit exam" })] })] }), _jsxs("div", { className: "exam-body", children: [_jsxs("aside", { className: "exam-nav", children: [_jsx("h2", { children: "Question navigator" }), _jsxs("p", { children: [answered, " of ", exam.questions.length, " answered"] }), _jsx("div", { className: "question-dots", children: exam.questions.map((item, index) => _jsx("button", { type: "button", className: `question-dot ${index === exam.currentIndex ? "current" : exam.responses[item.id]?.length ? "answered" : ""} ${exam.flagged[item.id] ? "flagged" : ""}`, onClick: () => onMove(index), children: index + 1 }, item.id)) }), _jsxs("div", { className: "exam-legend", children: [_jsxs("span", { children: [_jsx("i", { className: "legend-current" }), " Current"] }), _jsxs("span", { children: [_jsx("i", { className: "legend-answered" }), " Answered"] }), _jsxs("span", { children: [_jsx("i", { className: "legend-flagged" }), " Flagged"] }), _jsxs("span", { children: [_jsx("i", {}), " Not answered"] })] })] }), _jsxs("main", { className: "exam-main", children: [_jsxs("div", { className: "exam-progress", children: [_jsxs("span", { children: ["Question ", exam.currentIndex + 1, " of ", exam.questions.length] }), _jsxs("span", { children: [Math.round(((exam.currentIndex + 1) / exam.questions.length) * 100), "%"] })] }), _jsx("div", { className: "exam-progress-track", children: _jsx("span", { style: { width: `${((exam.currentIndex + 1) / exam.questions.length) * 100}%` } }) }), _jsxs("section", { className: "exam-question-card", children: [_jsxs("div", { className: "question-kicker", children: [_jsx("span", { children: multiple ? "MULTIPLE ANSWERS" : "MULTIPLE CHOICE" }), _jsxs("button", { className: `flag-button ${exam.flagged[question.id] ? "flagged" : ""}`, type: "button", onClick: onFlag, children: [_jsx(Flag, { size: 15 }), " ", exam.flagged[question.id] ? "Flagged" : "Flag for review"] })] }), _jsx("h1", { children: question.question }), multiple && _jsxs("div", { className: "selection-hint", children: [_jsx(Sparkles, { size: 15 }), _jsxs("span", { children: ["Select all correct answers", getCorrectIds(question).length > 1 ? ` (${expectedSelections} expected)` : "", "."] })] }), _jsx("div", { className: "exam-options", children: question.options.map((option, index) => {
                                            const isSelected = selected.includes(option.id);
                                            return _jsxs("button", { className: `exam-option ${isSelected ? "selected" : ""}`, type: "button", onClick: () => onAnswer(option.id), children: [_jsx("span", { className: "option-letter", children: String.fromCharCode(65 + index) }), _jsx("span", { children: option.text }), isSelected && _jsx("span", { className: "option-check", children: _jsx(Check, { size: 18 }) })] }, option.id);
                                        }) }), _jsxs("div", { className: "exam-footer", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: exam.currentIndex === 0, onClick: () => onMove(exam.currentIndex - 1), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), exam.currentIndex < exam.questions.length - 1 ? _jsxs("button", { className: "primary-button", type: "button", onClick: () => onMove(exam.currentIndex + 1), children: ["Next question ", _jsx(ChevronRight, { size: 16 })] }) : _jsxs("button", { className: "primary-button", type: "button", onClick: onSubmit, children: ["Finish exam ", _jsx(Check, { size: 16 })] })] })] }, question.id)] })] })] }));
}
function ResultsView({ details, settings, exam, onRetake, onRetakeWrong, onDashboard }) {
    const correct = details.filter((detail) => detail.correct).length;
    const total = details.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    const pass = percent >= 70;
    const wrong = details.filter((detail) => !detail.correct);
    const timeUsed = exam ? Math.max(0, Math.round(((exam.submittedAt ?? Date.now()) - exam.startedAt) / 1000)) : 0;
    return (_jsxs("div", { className: "results-page", children: [pass && _jsx("div", { className: "confetti", "aria-hidden": "true", children: Array.from({ length: 20 }, (_, index) => _jsx("i", { style: { "--i": index } }, index)) }), _jsxs("div", { className: "results-wrap", children: [_jsxs("section", { className: "results-hero", children: [_jsx("div", { className: "score-ring", style: { "--score": `${percent}%` }, children: _jsxs("div", { className: "score-value", children: [_jsxs("strong", { children: [percent, "%"] }), _jsx("small", { children: "FINAL SCORE" })] }) }), _jsxs("div", { className: "results-copy", children: [_jsxs("span", { className: "pill", children: [_jsx(Sparkles, { size: 14 }), " ", pass ? "TARGET REACHED" : "KEEP PRACTICING"] }), _jsx("h1", { children: pass ? "Great work!" : "You’re making progress." }), _jsx("p", { children: pass ? "You passed this mock exam. Review anything you missed to make the next attempt stronger." : "Review the correct answers and explanations below, then retake the questions you missed." }), _jsxs("div", { className: "result-stats", children: [_jsxs("div", { children: [_jsxs("strong", { children: [correct, "/", total] }), _jsx("small", { children: "Correct answers" })] }), _jsxs("div", { children: [_jsx("strong", { children: formatDuration(timeUsed) }), _jsx("small", { children: "Time used" })] }), _jsxs("div", { children: [_jsx("strong", { children: wrong.length }), _jsx("small", { children: "Need review" })] })] }), _jsxs("div", { className: "results-actions", children: [_jsx("button", { className: "white-button", type: "button", onClick: onRetake, children: "Retake exam" }), wrong.length > 0 && _jsx("button", { className: "outline-light", type: "button", onClick: onRetakeWrong, children: "Retake incorrect" }), _jsx("button", { className: "outline-light", type: "button", onClick: onDashboard, children: "Dashboard" })] })] })] }), _jsxs("section", { className: "review-section", children: [_jsx("div", { className: "section-heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "ANSWER REVIEW" }), _jsx("h2", { children: "Learn from every question" })] }) }), details.map((detail, index) => {
                                const selectedOptions = detail.question.options.filter((option) => detail.selectedOptionIds.includes(option.id));
                                const correctIds = getCorrectIds(detail.question);
                                const correctOptions = detail.question.options.filter((option) => correctIds.includes(option.id));
                                const selectedText = selectedOptions.map((option) => option.text).join(" • ");
                                const correctText = correctOptions.map((option) => option.text).join(" • ");
                                return _jsxs("article", { className: `review-card ${detail.correct ? "correct-review" : "wrong-review"}`, children: [_jsxs("div", { className: "review-head", children: [_jsx("span", { className: `review-badge ${detail.correct ? "" : "wrong"}`, children: detail.correct ? _jsx(Check, { size: 18 }) : _jsx(X, { size: 18 }) }), _jsxs("div", { children: [_jsxs("h3", { children: [index + 1, ". ", detail.question.question] }), _jsx("p", { children: detail.correct ? "Correct answer" : selectedText ? `Your answer: ${selectedText}` : "No answer selected" })] })] }), !detail.correct && _jsxs("div", { className: "correct-answer-callout", children: [_jsxs("strong", { children: ["Correct answer", correctOptions.length > 1 ? "s" : ""] }), _jsx("span", { children: correctText || "Unavailable" })] }), settings.showExplanations && detail.question.explanation && _jsxs("div", { className: "review-explanation", children: [_jsx(Sparkles, { size: 16 }), _jsx("span", { children: detail.question.explanation })] })] }, detail.question.id);
                            })] })] })] }));
}
function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
export default App;
