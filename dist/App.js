import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArchiveRestore, BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, CheckCircle2, CircleHelp, Clock3, Copy, FileText, Filter, Flag, FolderOpen, Home, Layers3, Library, ListFilter, Menu, Moon, Plus, Search, Sparkles, Sun, Scissors, Users, Snowflake, Lightbulb, Bot, ShieldCheck, Tag, Target, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { extractPdfText } from "./lib/pdf.js";
import { generateLocalQuestions, parseQuestionBankDetailed } from "./lib/parser.js";
import { clearExamRecovery, clearUploadDraft, loadExamRecovery, loadStudySets, loadTheme, loadUploadDraft, saveExamRecovery, saveStudySets, saveTheme, saveUploadDraft } from "./lib/storage.js";
import { bestScore, formatDate, formatDuration, shuffle, stripExtension, uid } from "./lib/utils.js";
import { availableTopics, computeTopicPerformance, ensureQuestionTopics, weakTopics } from "./lib/topics.js";
import { validateQuestions } from "./lib/validation.js";
function createPasteAnswer(text = "", correct = false) {
    return { id: uid(), text, correct };
}
function createPasteSection() {
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
function normalizePasteSections(rawSections) {
    if (!Array.isArray(rawSections) || rawSections.length === 0)
        return [createPasteSection()];
    const normalized = rawSections.map((rawValue) => {
        const raw = (rawValue && typeof rawValue === "object" ? rawValue : {});
        const rawAnswers = raw.answers;
        if (typeof raw.question === "string" && Array.isArray(rawAnswers)) {
            const answers = rawAnswers
                .filter((answer) => Boolean(answer && typeof answer === "object"))
                .map((answer) => ({
                id: typeof answer.id === "string" ? answer.id : uid(),
                text: typeof answer.text === "string" ? answer.text : "",
                correct: Boolean(answer.correct)
            }));
            while (answers.length < 2)
                answers.push(createPasteAnswer());
            return {
                id: typeof raw.id === "string" ? raw.id : uid(),
                title: typeof raw.title === "string" ? raw.title : "",
                topic: typeof raw.topic === "string" && raw.topic.trim() ? raw.topic : "General",
                question: raw.question,
                answers,
                selectionMode: raw.selectionMode === "multiple" ? "multiple" : "single",
                activeTab: raw.activeTab === "answers" ? "answers" : "question",
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
        while (legacyAnswers.length < 4)
            legacyAnswers.push(createPasteAnswer());
        return {
            id: typeof raw.id === "string" ? raw.id : uid(),
            title: typeof raw.title === "string" ? raw.title : "",
            topic: typeof raw.title === "string" && raw.title.trim() ? raw.title : "General",
            question: legacyQuestion,
            answers: legacyAnswers,
            selectionMode: "single",
            activeTab: "question",
            expanded: true
        };
    });
    if (!normalized.length)
        return [createPasteSection()];
    const firstExpanded = normalized.findIndex((section) => section.expanded);
    return normalized.map((section, index) => ({ ...section, expanded: firstExpanded === -1 ? index === 0 : index === firstExpanded }));
}
function getCorrectIds(question) {
    if (Array.isArray(question.correctOptionIds) && question.correctOptionIds.length)
        return question.correctOptionIds;
    return question.correctOptionId ? [question.correctOptionId] : [];
}
function hasValidAnswer(question) {
    const ids = getCorrectIds(question);
    return ids.length > 0 && ids.every((id) => question.options.some((option) => option.id === id));
}
function isVerifiedQuestion(question) {
    return question.status !== "review" && hasValidAnswer(question);
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
function dedupeImportedQuestions(questions) {
    const seen = new Set();
    return questions.filter((question) => {
        const key = `${question.question.toLowerCase().replace(/\s+/g, " ").trim()}::${question.options
            .map((option) => option.text.toLowerCase().replace(/\s+/g, " ").trim())
            .join("||")}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
const defaultSettings = {
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
    const [view, setView] = useState("dashboard");
    const [theme, setTheme] = useState(() => loadTheme());
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [studySets, setStudySets] = useState(() => loadStudySets());
    const [initialUploadDraft] = useState(() => loadUploadDraft());
    const [initialExamRecovery] = useState(() => loadExamRecovery());
    const [activeSetId, setActiveSetId] = useState(null);
    const [editingQuestionId, setEditingQuestionId] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [recoveredFileName, setRecoveredFileName] = useState(initialUploadDraft?.fileName ?? "");
    const [pasteSections, setPasteSections] = useState(() => normalizePasteSections(initialUploadDraft?.pasteSections));
    const [studyTitle, setStudyTitle] = useState(initialUploadDraft?.title ?? "");
    const [aiEnhanced, setAiEnhanced] = useState(initialUploadDraft?.aiEnhanced ?? false);
    const [ocrEnabled] = useState(false);
    const [aiConfigured, setAiConfigured] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processingStep, setProcessingStep] = useState("read");
    const [processingLabel, setProcessingLabel] = useState("Reading document text");
    const [settings, setSettings] = useState(defaultSettings);
    const [exam, setExam] = useState(null);
    const [resultDetails, setResultDetails] = useState([]);
    const [toast, setToast] = useState(initialUploadDraft ? "Your unfinished paste draft was recovered" : "");
    const [pendingImport, setPendingImport] = useState(null);
    const [submitReviewOpen, setSubmitReviewOpen] = useState(false);
    const [recoveryAvailable, setRecoveryAvailable] = useState(Boolean(initialExamRecovery));
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
        const hasDraftContent = Boolean(studyTitle.trim() || pasteSections.some((section) => section.title.trim() || section.question.trim() || section.answers.some((answer) => answer.text.trim())) || selectedFile);
        if (!hasDraftContent)
            return;
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
            finalizeExam(true);
            return;
        }
        const timer = window.setInterval(() => {
            setExam((current) => {
                if (!current)
                    return current;
                const frozenUntil = current.lifelines?.timerFrozenUntil ?? 0;
                if (frozenUntil > Date.now())
                    return { ...current };
                return { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) };
            });
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
    function updatePasteSection(id, patch) {
        setPasteSections((current) => current.map((section) => {
            if (patch.expanded === true)
                return section.id === id ? { ...section, ...patch } : { ...section, expanded: false };
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
    function removePasteSection(id) {
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
            const parsedImports = [];
            const sourceParts = [];
            const importedQuestions = [];
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
                const question = {
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
            const aiWarnings = [];
            setProcessingStep("answers");
            setProcessingLabel(aiEnhanced ? "AI is reviewing the import" : "Matching answers and checking structure");
            setProcessingProgress(72);
            if (aiEnhanced) {
                try {
                    const assisted = await assistImportWithAi(sourceText, questions, studyTitle || stripExtension(sourceName));
                    questions = ensureQuestionTopics(assisted.questions);
                    aiWarnings.push(...assisted.warnings);
                }
                catch (aiError) {
                    const message = aiError instanceof Error ? aiError.message : "AI import assistance was unavailable.";
                    aiWarnings.push(`AI assistance could not complete: ${message} Local extraction was kept.`);
                    if (!questions.length && sourceText.trim())
                        questions = ensureQuestionTopics(generateLocalQuestions(sourceText));
                }
            }
            else if (!questions.length && sourceText.trim()) {
                questions = ensureQuestionTopics(generateLocalQuestions(sourceText));
            }
            if (!questions.length) {
                throw new Error("No usable questions were found. Try a clearer question bank, add a manual question, or enable AI import assistance.");
            }
            setProcessingStep("finish");
            setProcessingLabel("Preparing import preview");
            setProcessingProgress(94);
            await delay(350);
            const parsedExpected = parsedImports.reduce((sum, parsed) => sum + (parsed.detectedQuestionNumbers.length || parsed.highestQuestionNumber || parsed.questions.length), 0);
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
        }
        catch (caught) {
            const message = caught instanceof Error ? caught.message : "The study set could not be created.";
            setError(message);
            navigate("upload");
        }
    }
    function updatePendingQuestion(questionId, patch) {
        setPendingImport((current) => {
            if (!current)
                return current;
            const questions = current.questions.map((question) => question.id === questionId ? { ...question, ...patch } : question);
            return { ...current, questions, issues: validateQuestions(questions, current.expected) };
        });
    }
    function updatePendingAnswer(questionId, optionId) {
        setPendingImport((current) => {
            if (!current)
                return current;
            const questions = current.questions.map((question) => {
                if (question.id !== questionId)
                    return question;
                const multiple = isMultipleQuestion(question);
                const ids = getCorrectIds(question);
                const next = multiple ? (ids.includes(optionId) ? ids.filter((id) => id !== optionId) : [...ids, optionId]) : [optionId];
                return { ...question, correctOptionId: next[0] ?? null, correctOptionIds: next, status: next.length ? "verified" : "review" };
            });
            return { ...current, questions, issues: validateQuestions(questions, current.expected) };
        });
    }
    function togglePendingQuestion(questionId) {
        setPendingImport((current) => {
            if (!current)
                return current;
            const selectedIds = current.selectedIds.includes(questionId)
                ? current.selectedIds.filter((id) => id !== questionId)
                : [...current.selectedIds, questionId];
            return { ...current, selectedIds };
        });
    }
    function selectPendingQuestions(mode) {
        setPendingImport((current) => {
            if (!current)
                return current;
            const errorIds = new Set(current.issues.filter((issue) => issue.severity === "error").map((issue) => issue.questionId).filter(Boolean));
            const selectedIds = mode === "all" ? current.questions.map((question) => question.id)
                : mode === "clean" ? current.questions.filter((question) => !errorIds.has(question.id)).map((question) => question.id)
                    : [];
            return { ...current, selectedIds };
        });
    }
    function confirmPendingImport() {
        if (!pendingImport)
            return;
        const questions = pendingImport.questions.filter((question) => pendingImport.selectedIds.includes(question.id));
        if (!questions.length) {
            setToast("Select at least one question to continue");
            return;
        }
        const now = new Date().toISOString();
        const set = {
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
    async function assistImportWithAi(sourceText, questions, title) {
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.questions) {
            throw new Error(payload.error || "AI import assistance failed.");
        }
        const existingById = new Map(questions.map((question) => [question.id, question]));
        const returnedIds = new Set();
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
                selectionMode: item.selectionMode === "multiple" || correctOptionIds.length > 1 ? "multiple" : "single",
                explanation: String(item.explanation || existing?.explanation || "").trim(),
                status: reviewRequired ? "review" : "verified",
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
            };
        });
        const missing = questions
            .filter((question) => !returnedIds.has(question.id))
            .map((question) => ({
            ...question,
            status: "review",
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
    function bulkDeleteQuestions(questionIds) {
        if (!activeSet || !questionIds.length)
            return;
        if (questionIds.length >= activeSet.questions.length) {
            setToast("Keep at least one question in the study set");
            return;
        }
        if (!window.confirm(`Delete ${questionIds.length} selected question${questionIds.length === 1 ? "" : "s"}?`))
            return;
        const ids = new Set(questionIds);
        const remaining = activeSet.questions.filter((question) => !ids.has(question.id));
        updateActiveSet((set) => ({ ...set, questions: remaining }));
        if (editingQuestionId && ids.has(editingQuestionId))
            setEditingQuestionId(remaining[0]?.id ?? null);
        setToast(`${questionIds.length} questions deleted`);
    }
    function bulkSetStatus(questionIds, status) {
        const ids = new Set(questionIds);
        updateActiveSet((set) => ({
            ...set,
            questions: set.questions.map((question) => ids.has(question.id)
                ? { ...question, status: status === "verified" && !hasValidAnswer(question) ? "review" : status }
                : question)
        }));
        setToast(status === "verified" ? "Selected questions checked" : "Selected questions marked for review");
    }
    function bulkSetTopic(questionIds, topic) {
        const ids = new Set(questionIds);
        updateActiveSet((set) => ({ ...set, questions: set.questions.map((question) => ids.has(question.id) ? { ...question, topic } : question) }));
        setToast(`Topic changed to ${topic}`);
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
        if (!questionIds?.length && settings.topicFilter && settings.topicFilter !== "All topics") {
            pool = pool.filter((question) => (question.topic || "General") === settings.topicFilter);
        }
        if (!questionIds?.length && settings.weakAreasOnly) {
            const weak = new Set(weakTopics(activeSet.attempts));
            if (weak.size)
                pool = pool.filter((question) => weak.has(question.topic || "General"));
        }
        if (!pool.length) {
            setToast("No verified questions match these filters");
            return;
        }
        const count = Math.min(questionIds?.length || settings.questionCount || pool.length, pool.length);
        const selected = settings.shuffleQuestions ? shuffle(pool).slice(0, count) : pool.slice(0, count);
        const examQuestions = selected.map((question) => {
            const options = question.options.map((option) => ({ ...option, originalId: option.id }));
            return { ...question, options: settings.shuffleAnswers ? shuffle(options) : options };
        });
        const session = {
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
    function useFiftyFifty() {
        if (!exam || !settings.lifelineFiftyFifty)
            return;
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
        if (!exam || !settings.lifelineAudiencePoll)
            return;
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
        if (!correctId || visible.length < 2)
            return;
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
        const poll = { [correctId]: correctPercent };
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
        if (!exam || !settings.lifelineTimeFreeze)
            return;
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
        if (!exam || !settings.lifelineClue)
            return;
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
        if (!exam)
            return;
        setSubmitReviewOpen(true);
    }
    function finalizeExam(autoSubmitted = false) {
        if (!exam || !activeSet)
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
        if (autoSubmitted)
            setToast("Time expired — the exam was submitted");
        navigate("results");
    }
    const allAttempts = useMemo(() => studySets.flatMap((set) => set.attempts.map((attempt) => ({ ...attempt, setTitle: set.title }))), [studySets]);
    const averageScore = allAttempts.length ? Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / allAttempts.length) : 0;
    return (_jsxs("div", { className: "app-root", children: [view === "exam" ? (_jsx(ExamView, { exam: exam, settings: settings, onAnswer: answerQuestion, onFlag: toggleFlag, onMove: moveQuestion, onSubmit: requestExamSubmit, reviewOpen: submitReviewOpen, onCloseReview: () => setSubmitReviewOpen(false), onConfirmSubmit: () => finalizeExam(false), onFiftyFifty: useFiftyFifty, onAudiencePoll: useAudiencePoll, onTimeFreeze: useTimeFreeze, onClue: useClue })) : view === "results" ? (_jsx(ResultsView, { details: resultDetails, settings: settings, exam: exam, onRetake: () => beginExam(), onRetakeWrong: () => beginExam(resultDetails.filter((detail) => !detail.correct).map((detail) => detail.question.id)), onDashboard: () => navigate("dashboard") })) : (_jsxs(Shell, { view: view, theme: theme, sidebarOpen: sidebarOpen, onToggleSidebar: () => setSidebarOpen((current) => !current), onNavigate: navigate, onTheme: toggleTheme, onNew: newStudySet, children: [view === "dashboard" && (_jsx(Dashboard, { studySets: studySets, attempts: allAttempts.length, averageScore: averageScore, onNew: newStudySet, onOpen: openSet, onNavigate: navigate, recoveryAvailable: recoveryAvailable, onResumeExam: resumeRecoveredExam })), view === "library" && (_jsx(LibraryView, { studySets: studySets, search: search, onSearch: setSearch, onOpen: openSet, onNew: newStudySet })), view === "performance" && _jsx(PerformanceView, { studySets: studySets, attempts: allAttempts, averageScore: averageScore }), view === "upload" && (_jsx(UploadView, { file: selectedFile, pasteSections: pasteSections, title: studyTitle, dragging: dragging, aiEnhanced: aiEnhanced, aiConfigured: aiConfigured, recoveredFileName: recoveredFileName, error: error, fileInputRef: fileInputRef, onFile: (file) => { setSelectedFile(file); if (file)
                            setRecoveredFileName(""); }, onUpdatePasteSection: updatePasteSection, onAddPasteSection: addPasteSection, onRemovePasteSection: removePasteSection, onTitle: setStudyTitle, onDragging: setDragging, onAi: setAiEnhanced, onClearDraft: clearStudyDraft, onCreate: createStudySet, onCancel: () => navigate("dashboard") })), view === "processing" && (_jsx(ProcessingView, { fileName: selectedFile?.name || (pasteSections.filter((section) => section.question.trim()).length > 1
                            ? `${pasteSections.filter((section) => section.question.trim()).length} manual questions`
                            : pasteSections.find((section) => section.question.trim())?.title || "Manually added question"), progress: processingProgress, step: processingStep, activeLabel: processingLabel })), view === "import-preview" && pendingImport && (_jsx(ImportPreviewView, { pending: pendingImport, onToggle: togglePendingQuestion, onSelectMode: selectPendingQuestions, onUpdateQuestion: updatePendingQuestion, onUpdateAnswer: updatePendingAnswer, onBack: () => navigate("upload"), onConfirm: confirmPendingImport })), view === "editor" && activeSet && editingQuestion && (_jsx(EditorView, { studySet: activeSet, question: editingQuestion, onSelect: setEditingQuestionId, onUpdateQuestion: updateQuestion, onUpdateOption: updateOption, onMarkCorrect: markCorrect, onSelectionMode: setSelectionMode, onAddOption: addOption, onRemoveOption: removeOption, onAddQuestion: addQuestion, onDuplicate: duplicateQuestion, onDelete: deleteQuestion, onBulkDelete: bulkDeleteQuestions, onBulkStatus: bulkSetStatus, onBulkTopic: bulkSetTopic, onDeleteSet: deleteStudySet, onSetup: openSetup, onDashboard: () => navigate("dashboard") })), view === "setup" && activeSet && (_jsx(SetupView, { studySet: activeSet, settings: settings, onSettings: setSettings, onBack: () => navigate("editor"), onStart: () => beginExam() }))] })), toast && _jsxs("div", { className: "toast", role: "status", children: [_jsx("span", { className: "toast-icon", children: _jsx(Check, { size: 15 }) }), _jsx("span", { children: toast }), _jsx("i", {})] })] }));
}
function Shell({ view, theme, sidebarOpen, children, onToggleSidebar, onNavigate, onTheme, onNew }) {
    const nav = [
        { id: "dashboard", label: "Home", icon: Home },
        { id: "library", label: "Library", icon: Library },
        { id: "performance", label: "Performance", icon: BarChart3 }
    ];
    return (_jsxs("div", { className: "app-shell", children: [_jsx("button", { className: "mobile-menu", type: "button", "aria-label": "Toggle navigation", onClick: onToggleSidebar, children: _jsx(Menu, { size: 20 }) }), sidebarOpen && _jsx("button", { className: "sidebar-scrim", type: "button", "aria-label": "Close navigation", onClick: onToggleSidebar }), _jsxs("aside", { className: `sidebar streamlined-sidebar ${sidebarOpen ? "open" : ""}`, children: [_jsxs("button", { className: "brand", type: "button", onClick: () => onNavigate("dashboard"), children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsxs("span", { children: [_jsx("strong", { children: "QuizForge" }), _jsx("small", { children: "Study smarter" })] })] }), _jsx("nav", { className: "side-nav", "aria-label": "Main navigation", children: nav.map((item) => {
                            const Icon = item.icon;
                            return _jsxs("button", { type: "button", className: `nav-item ${view === item.id ? "active" : ""}`, onClick: () => onNavigate(item.id), children: [_jsx(Icon, { size: 18 }), _jsx("span", { children: item.label })] }, item.id);
                        }) }), _jsxs("button", { className: "primary-button sidebar-create-button", type: "button", onClick: onNew, children: [_jsx(Plus, { size: 17 }), " Create study set"] }), _jsx("div", { className: "sidebar-spacer" }), _jsxs("p", { className: "local-workspace-note", children: [_jsx(CheckCircle2, { size: 15 }), " Saved locally in this browser"] })] }), _jsxs("main", { className: "main-content", children: [_jsxs("header", { className: "global-topbar simplified-topbar", children: [_jsxs("div", { className: "mobile-brand", children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsx("strong", { children: "QuizForge" })] }), _jsx("div", { className: "global-actions", children: _jsx("button", { className: "icon-button", type: "button", "aria-label": "Toggle theme", onClick: onTheme, children: theme === "dark" ? _jsx(Sun, { size: 18 }) : _jsx(Moon, { size: 18 }) }) })] }), _jsx("div", { className: "view-transition", children: children }, view)] })] }));
}
function Dashboard({ studySets, attempts, averageScore, onNew, onOpen, onNavigate, recoveryAvailable, onResumeExam }) {
    const recent = studySets.slice(0, 3);
    const totalQuestions = studySets.reduce((sum, set) => sum + set.questions.length, 0);
    return (_jsxs("div", { className: "page-wrap dashboard-page", children: [_jsx("section", { className: "welcome-row", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "QUIZFORGE" }), _jsx("h1", { children: "Build your next practice exam" }), _jsx("p", { children: "Import a PDF, add questions manually, and study with a focused mock-exam experience." })] }) }), recoveryAvailable && _jsxs("section", { className: "recovery-banner", children: [_jsx("span", { className: "recovery-icon", children: _jsx(ArchiveRestore, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Unfinished exam recovered" }), _jsx("p", { children: "Your answers, timer, flags, and current question were saved automatically." })] }), _jsxs("button", { className: "primary-button compact", type: "button", onClick: onResumeExam, children: ["Resume exam ", _jsx(ChevronRight, { size: 15 })] })] }), _jsxs("section", { className: "hero-card streamlined-hero", children: [_jsxs("div", { className: "hero-copy", children: [_jsxs("span", { className: "pill", children: [_jsx(FileText, { size: 14 }), " SMART PDF IMPORT"] }), _jsxs("h2", { children: ["From study material to a ", _jsx("em", { children: "practice exam." })] }), _jsx("p", { children: "Review detected questions before saving, edit anything that needs attention, and create randomized tests when you are ready." }), _jsx("div", { className: "hero-actions", children: _jsxs("button", { className: "primary-button large", type: "button", onClick: onNew, children: [_jsx(Plus, { size: 18 }), " Create study set ", _jsx(ChevronRight, { size: 17 })] }) }), _jsxs("div", { className: "privacy-line", children: [_jsx(Check, { size: 15 }), " Text-based PDF extraction happens in your browser"] })] }), _jsxs("div", { className: "upload-visual", "aria-hidden": "true", children: [_jsx("div", { className: "upload-orbit orbit-one" }), _jsx("div", { className: "upload-orbit orbit-two" }), _jsxs("div", { className: "file-card rear", children: [_jsx("span", { children: "PDF" }), _jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("div", { className: "file-card front", children: [_jsx("div", { className: "file-icon", children: "PDF" }), _jsx("strong", { children: "Reviewer.pdf" }), _jsx("small", { children: "Ready to review" }), _jsx("div", { className: "mini-progress", children: _jsx("span", {}) })] }), _jsx("div", { className: "floating-chip chip-one", children: "Questions detected" }), _jsxs("div", { className: "floating-chip chip-two", children: ["Answer key matched ", _jsx(Check, { size: 12 })] })] })] }), _jsxs("section", { className: "metric-grid", "aria-label": "Study overview", children: [_jsx(Metric, { label: "Study sets", value: studySets.length, note: "Saved locally", icon: _jsx(BookOpen, { size: 18 }) }), _jsx(Metric, { label: "Questions", value: totalQuestions, note: "Across your library", icon: _jsx(CircleHelp, { size: 18 }) }), _jsx(Metric, { label: "Attempts", value: attempts, note: "Completed exams", icon: _jsx(Clock3, { size: 18 }) }), _jsx(Metric, { label: "Average", value: attempts ? `${averageScore}%` : "—", note: "All attempts", icon: _jsx(BarChart3, { size: 18 }) })] }), _jsxs("section", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR LIBRARY" }), _jsx("h3", { children: studySets.length ? "Continue studying" : "Start your first study set" })] }), studySets.length > 3 && _jsxs("button", { className: "text-button", type: "button", onClick: () => onNavigate("library"), children: ["View all ", _jsx(ChevronRight, { size: 15 })] })] }), studySets.length ? _jsxs("section", { className: "study-grid", children: [recent.map((set, index) => _jsx(StudyCard, { studySet: set, index: index, onOpen: onOpen }, set.id)), _jsxs("button", { className: "new-card", type: "button", onClick: onNew, children: [_jsx("span", { className: "new-icon", children: _jsx(Plus, { size: 22 }) }), _jsx("strong", { children: "Create a study set" }), _jsx("p", { children: "Import a PDF or add your own questions." })] })] }) : _jsxs("section", { className: "empty-library-hero", children: [_jsx("span", { children: _jsx(BookOpen, { size: 28 }) }), _jsx("h3", { children: "No study sets yet" }), _jsx("p", { children: "Create one from a text-based PDF or build the questions manually." }), _jsxs("button", { className: "primary-button", type: "button", onClick: onNew, children: [_jsx(Plus, { size: 17 }), " Create study set"] })] })] }));
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
    const recent = [...attempts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    const topicStats = computeTopicPerformance(attempts);
    const weakest = topicStats[0];
    return (_jsxs("div", { className: "page-wrap", children: [_jsx("div", { className: "page-head", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "PERFORMANCE" }), _jsx("h1", { children: "Your progress" }), _jsx("p", { children: "Track scores, identify weak topics, and build targeted practice exams." })] }) }), _jsxs("section", { className: "metric-grid performance-metrics", children: [_jsx(Metric, { label: "Average score", value: attempts.length ? `${averageScore}%` : "—", note: `${attempts.length} completed attempts`, icon: _jsx(BarChart3, { size: 18 }) }), _jsx(Metric, { label: "Personal best", value: attempts.length ? `${best}%` : "—", note: "Highest attempt", icon: _jsx(Sparkles, { size: 18 }) }), _jsx(Metric, { label: "Weakest topic", value: weakest ? `${weakest.accuracy}%` : "—", note: weakest?.topic ?? "More attempts needed", icon: _jsx(Target, { size: 18 }) }), _jsx(Metric, { label: "Questions practiced", value: attempts.reduce((sum, attempt) => sum + attempt.total, 0), note: "All attempts", icon: _jsx(CircleHelp, { size: 18 }) })] }), _jsxs("section", { className: "performance-panel topic-performance-panel", children: [_jsx("div", { className: "section-heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "TOPIC BREAKDOWN" }), _jsx("h3", { children: "Where to focus next" })] }) }), topicStats.length ? _jsx("div", { className: "topic-performance-list", children: topicStats.map((topic) => _jsxs("article", { className: "topic-performance-row", children: [_jsxs("div", { className: "topic-performance-copy", children: [_jsx("span", { className: "topic-icon", children: _jsx(Tag, { size: 15 }) }), _jsxs("div", { children: [_jsx("strong", { children: topic.topic }), _jsxs("small", { children: [topic.correct, " of ", topic.total, " correct \u00B7 ", topic.attempts, " attempt", topic.attempts === 1 ? "" : "s"] })] })] }), _jsx("div", { className: "topic-performance-bar", children: _jsx("span", { style: { width: `${topic.accuracy}%` } }) }), _jsxs("strong", { className: topic.accuracy >= 70 ? "good-score" : "low-score", children: [topic.accuracy, "%"] })] }, topic.topic)) }) : _jsxs("div", { className: "empty-state compact-empty", children: [_jsx(Target, { size: 34 }), _jsx("strong", { children: "No topic data yet" }), _jsx("p", { children: "New attempts will record per-topic accuracy automatically." })] })] }), _jsxs("section", { className: "performance-panel", children: [_jsx("div", { className: "section-heading", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "RECENT ATTEMPTS" }), _jsx("h3", { children: "Exam history" })] }) }), recent.length ? recent.map((attempt) => (_jsxs("div", { className: "attempt-row", children: [_jsxs("div", { children: [_jsx("strong", { children: attempt.setTitle }), _jsxs("span", { children: [formatDate(attempt.date), " \u00B7 ", formatDuration(attempt.durationSeconds)] })] }), _jsx("div", { className: "attempt-bar", children: _jsx("span", { style: { width: `${attempt.score}%` } }) }), _jsxs("strong", { className: attempt.score >= 70 ? "good-score" : "low-score", children: [attempt.score, "%"] })] }, `${attempt.date}-${attempt.setTitle}`))) : _jsxs("div", { className: "empty-state compact-empty", children: [_jsx(BarChart3, { size: 34 }), _jsx("strong", { children: "No attempts yet" }), _jsx("p", { children: "Complete a mock exam to see your results here." })] })] })] }));
}
function UploadView({ file, pasteSections, title, dragging, aiEnhanced, aiConfigured, recoveredFileName, error, fileInputRef, onFile, onUpdatePasteSection, onAddPasteSection, onRemovePasteSection, onTitle, onDragging, onAi, onClearDraft, onCreate, onCancel }) {
    function acceptFile(candidate) {
        if (!candidate)
            return;
        const supported = candidate.type === "application/pdf" || /\.pdf$/i.test(candidate.name);
        if (!supported)
            return;
        onFile(candidate);
        if (!title.trim())
            onTitle(stripExtension(candidate.name));
    }
    function updateAnswer(section, answerId, patch) {
        onUpdatePasteSection(section.id, {
            answers: section.answers.map((answer) => answer.id === answerId ? { ...answer, ...patch } : answer)
        });
    }
    function toggleCorrect(section, answerId) {
        const target = section.answers.find((answer) => answer.id === answerId);
        if (!target)
            return;
        onUpdatePasteSection(section.id, {
            answers: section.answers.map((answer) => {
                if (section.selectionMode === "multiple")
                    return answer.id === answerId ? { ...answer, correct: !answer.correct } : answer;
                return { ...answer, correct: answer.id === answerId ? !target.correct : false };
            })
        });
    }
    function setSelectionMode(section, selectionMode) {
        const firstCorrect = section.answers.find((answer) => answer.correct)?.id;
        onUpdatePasteSection(section.id, {
            selectionMode,
            answers: selectionMode === "single"
                ? section.answers.map((answer) => ({ ...answer, correct: answer.id === firstCorrect }))
                : section.answers
        });
    }
    function addAnswer(section) {
        onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true, answers: [...section.answers, createPasteAnswer()] });
    }
    function removeAnswer(section, answerId) {
        if (section.answers.length <= 2)
            return;
        onUpdatePasteSection(section.id, { answers: section.answers.filter((answer) => answer.id !== answerId) });
    }
    const completedSections = pasteSections.filter((section) => section.question.trim().length >= 3).length;
    const expandedCount = pasteSections.filter((section) => section.expanded).length;
    return (_jsxs("div", { className: "page-wrap upload-page streamlined-builder-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "CREATE STUDY SET" }), _jsx("h1", { children: "Import a PDF or build it manually" }), _jsx("p", { children: "Use a text-based PDF, or add questions one by one in the manual builder." })] }), _jsx("button", { className: "ghost-button", type: "button", onClick: onCancel, children: "Cancel" })] }), recoveredFileName && !file && _jsxs("div", { className: "recovery-note", children: [_jsx(ArchiveRestore, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "Draft restored." }), " Your manual questions were recovered. Reselect \u201C", recoveredFileName, "\u201D only if you still want to import that PDF."] })] }), error && _jsxs("div", { className: "error-banner", children: [_jsx(X, { size: 18 }), _jsx("span", { children: error })] }), _jsxs("section", { className: "streamlined-create-panel", children: [_jsx("label", { className: "field-label", htmlFor: "set-title", children: "Study set title" }), _jsx("input", { id: "set-title", className: "text-input set-title-input", value: title, onChange: (event) => onTitle(event.target.value), placeholder: "Example: Biology Midterm Reviewer" }), _jsxs("div", { className: `drop-zone compact-drop-zone ${dragging ? "dragging" : ""}`, onDragOver: (event) => { event.preventDefault(); onDragging(true); }, onDragLeave: () => onDragging(false), onDrop: (event) => { event.preventDefault(); onDragging(false); acceptFile(event.dataTransfer.files?.[0]); }, children: [_jsx("input", { ref: fileInputRef, type: "file", accept: "application/pdf,.pdf", onChange: (event) => acceptFile(event.target.files?.[0]) }), _jsxs("div", { className: "drop-zone-copy", children: [_jsx("span", { className: "big-upload", children: _jsx(Upload, { size: 24 }) }), _jsxs("span", { children: [_jsx("strong", { children: file ? file.name : "Drop a text-based PDF here" }), _jsx("small", { children: file ? `${Math.max(0.1, file.size / 1024 / 1024).toFixed(1)} MB · ready to import` : "or browse your computer" })] })] }), _jsxs("div", { className: "drop-zone-actions", children: [file && _jsx("button", { className: "icon-button", type: "button", "aria-label": "Remove PDF", onClick: () => onFile(null), children: _jsx(X, { size: 16 }) }), _jsx("button", { className: "secondary-button compact", type: "button", onClick: () => fileInputRef.current?.click(), children: file ? "Replace" : "Browse PDF" })] })] }), _jsxs("p", { className: "scan-coming-soon", children: [_jsx(AlertTriangle, { size: 14 }), " Scanned-image PDF OCR is temporarily unavailable. Text-based PDFs work normally."] }), _jsx("div", { className: "or-divider", children: _jsx("span", { children: "or build questions manually" }) }), _jsxs("div", { className: "manual-builder-heading simplified-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "MANUAL BUILDER" }), _jsx("h2", { children: "Questions stay compact until you open them." }), _jsx("p", { children: "Only one question opens at a time, so long reviewers remain easy to scan." })] }), expandedCount > 0 && _jsx("button", { className: "text-button", type: "button", onClick: () => pasteSections.forEach((section) => onUpdatePasteSection(section.id, { expanded: false })), children: "Collapse all" })] }), _jsx("div", { className: "manual-question-list accordion-list", children: pasteSections.map((section, index) => {
                            const answerCount = section.answers.filter((answer) => answer.text.trim()).length;
                            const correctCount = section.answers.filter((answer) => answer.correct).length;
                            const complete = Boolean(section.question.trim().length >= 3 && answerCount >= 2 && correctCount > 0);
                            const summary = section.question.trim() || "Untitled question";
                            return (_jsxs("article", { className: `manual-question-card accordion-card ${section.expanded ? "expanded" : "collapsed"}`, children: [_jsxs("div", { className: "manual-question-head accordion-head", children: [_jsxs("button", { className: "manual-question-toggle", type: "button", onClick: () => onUpdatePasteSection(section.id, { expanded: !section.expanded }), "aria-expanded": section.expanded, children: [_jsx("span", { className: "manual-question-number", children: index + 1 }), _jsxs("span", { className: "manual-question-summary", children: [_jsxs("strong", { children: ["Question ", index + 1] }), _jsx("b", { children: summary }), _jsxs("small", { children: [answerCount, " choice", answerCount === 1 ? "" : "s", " \u00B7 ", correctCount ? `${correctCount} correct` : "correct answer not selected"] })] }), _jsxs("span", { className: `question-completion ${complete ? "complete" : "needs"}`, children: [complete ? _jsx(CheckCircle2, { size: 15 }) : _jsx(CircleHelp, { size: 15 }), complete ? "Complete" : "Needs attention"] }), _jsx(ChevronRight, { className: `accordion-chevron ${section.expanded ? "open" : ""}`, size: 18 })] }), _jsx("button", { className: "remove-section-button", type: "button", "aria-label": `Remove question ${index + 1}`, onClick: () => onRemovePasteSection(section.id), children: _jsx(Trash2, { size: 17 }) })] }), section.expanded && (_jsxs("div", { className: "accordion-content", children: [_jsxs("div", { className: "manual-question-tabs", role: "tablist", "aria-label": `Question ${index + 1} editor tabs`, children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": section.activeTab === "question", className: section.activeTab === "question" ? "active" : "", onClick: () => onUpdatePasteSection(section.id, { activeTab: "question", expanded: true }), children: [_jsx(CircleHelp, { size: 17 }), " Question"] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": section.activeTab === "answers", className: section.activeTab === "answers" ? "active" : "", onClick: () => onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true }), children: [_jsx(CheckCircle2, { size: 17 }), " Answers ", _jsx("span", { children: section.answers.length })] })] }), section.activeTab === "question" ? (_jsxs("div", { className: "manual-tab-panel question-tab-panel", role: "tabpanel", children: [_jsx("label", { className: "field-label", htmlFor: `manual-question-${section.id}`, children: "Question text" }), _jsx("textarea", { id: `manual-question-${section.id}`, className: "manual-question-input", value: section.question, onChange: (event) => onUpdatePasteSection(section.id, { question: event.target.value }), placeholder: "Example: What is the capital of Japan?" }), _jsxs("label", { className: "single-meta-field", children: [_jsx("span", { children: "Topic" }), _jsx("input", { className: "text-input", value: section.topic, onChange: (event) => onUpdatePasteSection(section.id, { topic: event.target.value }), placeholder: "General" })] }), _jsxs("div", { className: "manual-panel-footer", children: [_jsx("span", { children: "Saved automatically in this browser." }), _jsxs("button", { className: "primary-button compact", type: "button", onClick: () => onUpdatePasteSection(section.id, { activeTab: "answers", expanded: true }), children: ["Continue to answers ", _jsx(ChevronRight, { size: 16 })] })] })] })) : (_jsxs("div", { className: "manual-tab-panel answers-tab-panel", role: "tabpanel", children: [_jsxs("div", { className: "manual-answers-toolbar", children: [_jsxs("div", { children: [_jsx("strong", { children: "Answer choices" }), _jsx("small", { children: "Choose whether one or several answers are correct." })] }), _jsxs("div", { className: "manual-mode-toggle", "aria-label": "Correct-answer mode", children: [_jsx("button", { type: "button", className: section.selectionMode === "single" ? "active" : "", onClick: () => setSelectionMode(section, "single"), children: "Single correct" }), _jsx("button", { type: "button", className: section.selectionMode === "multiple" ? "active" : "", onClick: () => setSelectionMode(section, "multiple"), children: "Multiple correct" })] })] }), _jsx("div", { className: "manual-answer-list", children: section.answers.map((answer, answerIndex) => (_jsxs("div", { className: `manual-answer-row ${answer.correct ? "correct" : ""}`, children: [_jsx("span", { className: "manual-answer-letter", children: String.fromCharCode(65 + answerIndex) }), _jsx("input", { value: answer.text, onChange: (event) => updateAnswer(section, answer.id, { text: event.target.value }), placeholder: `Answer choice ${String.fromCharCode(65 + answerIndex)}`, "aria-label": `Question ${index + 1} answer ${String.fromCharCode(65 + answerIndex)}` }), _jsxs("button", { className: `manual-correct-button ${answer.correct ? "selected" : ""}`, type: "button", onClick: () => toggleCorrect(section, answer.id), "aria-label": answer.correct ? "Unmark correct answer" : "Mark correct answer", children: [_jsx(Check, { size: 17 }), _jsx("span", { children: answer.correct ? "Correct" : "Mark correct" })] }), _jsx("button", { className: "manual-remove-answer", type: "button", disabled: section.answers.length <= 2, onClick: () => removeAnswer(section, answer.id), "aria-label": `Remove answer ${String.fromCharCode(65 + answerIndex)}`, children: _jsx(X, { size: 16 }) })] }, answer.id))) }), _jsxs("button", { className: "add-answer-button", type: "button", onClick: () => addAnswer(section), children: [_jsx(Plus, { size: 17 }), " Add answer choice"] }), _jsxs("div", { className: "manual-panel-footer", children: [_jsxs("button", { className: "text-button", type: "button", onClick: () => onUpdatePasteSection(section.id, { activeTab: "question", expanded: true }), children: [_jsx(ChevronLeft, { size: 15 }), " Back to question"] }), _jsxs("button", { className: "secondary-button compact", type: "button", onClick: () => onUpdatePasteSection(section.id, { expanded: false }), children: ["Done with question ", index + 1] })] })] }))] }))] }, section.id));
                        }) }), _jsxs("button", { className: "add-paste-section-button add-manual-question-button", type: "button", onClick: onAddPasteSection, children: [_jsx("span", { children: _jsx(Plus, { size: 20 }) }), _jsx("strong", { children: "Add question" }), _jsx("small", { children: "The current question collapses and the new question opens automatically" })] }), aiConfigured && _jsxs("label", { className: "switch-row ai-import-switch", children: [_jsxs("span", { children: [_jsx(Bot, { size: 19 }), _jsxs("span", { children: [_jsx("strong", { children: "AI import assistance" }), _jsx("small", { children: "Review the local extraction, repair clear formatting problems, add confidence notes, and flag uncertain answers before saving." })] })] }), _jsx("input", { type: "checkbox", checked: aiEnhanced, onChange: (event) => onAi(event.target.checked) })] }), _jsxs("div", { className: "create-builder-footer", children: [_jsxs("div", { children: [_jsx("strong", { children: file ? "PDF ready" : `${completedSections} manual question${completedSections === 1 ? "" : "s"}` }), _jsx("small", { children: aiEnhanced ? "AI assistance is enabled; extracted text will be sent securely to your server-side AI endpoint." : "Your document and draft stay local in this browser." })] }), _jsxs("button", { className: "primary-button create-button", type: "button", onClick: onCreate, children: [_jsx(Sparkles, { size: 18 }), " Review study set ", _jsx(ChevronRight, { size: 17 })] })] }), (title.trim() || completedSections || file) && _jsx("button", { className: "text-button clear-draft-button", type: "button", onClick: onClearDraft, children: "Clear saved draft" })] })] }));
}
function ProcessingView({ fileName, progress, step, activeLabel }) {
    const steps = [
        { id: "read", label: activeLabel },
        { id: "detect", label: "Detecting questions and choices" },
        { id: "answers", label: activeLabel },
        { id: "finish", label: "Preparing the review screen" }
    ];
    const currentIndex = steps.findIndex((item) => item.id === step);
    return (_jsx("div", { className: "processing-page", children: _jsxs("section", { className: "processing-card", children: [_jsx("div", { className: "processor", children: _jsx(Sparkles, { size: 30 }) }), _jsxs("span", { className: "pill", children: [_jsx(WandSparkles, { size: 14 }), " BUILDING STUDY SET"] }), _jsx("h1", { children: "Turning your material into a mock exam" }), _jsx("p", { children: fileName }), _jsx("div", { className: "process-progress", children: _jsx("span", { style: { width: `${progress}%` } }) }), _jsxs("strong", { className: "progress-number", children: [progress, "%"] }), _jsx("div", { className: "process-list", children: steps.map((item, index) => (_jsxs("div", { className: `process-step ${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}`, children: [_jsx("span", { className: "step-dot", children: index < currentIndex ? _jsx(Check, { size: 15 }) : index + 1 }), _jsx("span", { children: item.label })] }, item.id))) })] }) }));
}
function ImportPreviewView({ pending, onToggle, onSelectMode, onUpdateQuestion, onUpdateAnswer, onBack, onConfirm }) {
    const [filter, setFilter] = useState(() => pending.issues.some((issue) => issue.questionId) ? "issues" : "all");
    const [query, setQuery] = useState("");
    const issuesByQuestion = useMemo(() => {
        const map = new Map();
        pending.issues.forEach((issue) => {
            if (!issue.questionId)
                return;
            map.set(issue.questionId, [...(map.get(issue.questionId) ?? []), issue]);
        });
        return map;
    }, [pending.issues]);
    const errorCount = pending.issues.filter((issue) => issue.severity === "error").length;
    const warningCount = pending.issues.filter((issue) => issue.severity === "warning").length;
    const verifiedCount = pending.questions.filter(isVerifiedQuestion).length;
    const selected = new Set(pending.selectedIds);
    const matchesSearch = (question) => `${question.question} ${question.topic ?? ""}`.toLowerCase().includes(query.toLowerCase());
    const attentionQuestions = pending.questions.filter((question) => (issuesByQuestion.get(question.id)?.length ?? 0) > 0 && matchesSearch(question));
    const cleanQuestions = pending.questions.filter((question) => !(issuesByQuestion.get(question.id)?.length ?? 0) && matchesSearch(question));
    const missingQuestions = pending.questions.filter((question) => !isVerifiedQuestion(question) && matchesSearch(question));
    function renderQuestionCard(question) {
        const questionIssues = issuesByQuestion.get(question.id) ?? [];
        const included = selected.has(question.id);
        const correctIds = getCorrectIds(question);
        const questionNumber = pending.questions.indexOf(question) + 1;
        return (_jsxs("article", { className: `import-question-card ${included ? "included" : "excluded"}`, children: [_jsxs("div", { className: "import-question-top", children: [_jsxs("label", { className: "include-check", children: [_jsx("input", { type: "checkbox", checked: included, onChange: () => onToggle(question.id) }), _jsx("span", { children: "Include" })] }), _jsxs("span", { className: "question-index", children: ["Question ", questionNumber] }), _jsx("input", { className: "topic-input", value: question.topic ?? "General", onChange: (event) => onUpdateQuestion(question.id, { topic: event.target.value }), "aria-label": `Topic for question ${questionNumber}` }), _jsx("span", { className: `status ${isVerifiedQuestion(question) ? "ready" : "draft"}`, children: isVerifiedQuestion(question) ? "Answer ready" : "Needs answer" })] }), _jsx("textarea", { className: "import-question-text", value: question.question, onChange: (event) => onUpdateQuestion(question.id, { question: event.target.value }) }), question.aiConfidence !== undefined && (_jsxs("div", { className: `ai-review-strip ${question.aiConfidence >= 0.85 ? "high" : question.aiConfidence >= 0.75 ? "medium" : "low"}`, children: [_jsx(Bot, { size: 16 }), _jsxs("span", { children: [_jsxs("strong", { children: ["AI reviewed \u00B7 ", Math.round(question.aiConfidence * 100), "% confidence"] }), _jsx("small", { children: question.aiChanged ? (question.aiNotes?.[0] ?? "Formatting or answer structure was repaired.") : "No clear repair was needed." })] }), question.aiChanged && _jsxs("span", { className: "ai-repaired-badge", children: [_jsx(WandSparkles, { size: 13 }), " Repaired"] })] })), _jsx("div", { className: "import-option-grid", children: question.options.map((option, optionIndex) => {
                        const correct = correctIds.includes(option.id);
                        return _jsxs("button", { type: "button", className: `import-option ${correct ? "correct" : ""}`, onClick: () => onUpdateAnswer(question.id, option.id), children: [_jsx("span", { children: String.fromCharCode(65 + optionIndex) }), _jsx("b", { children: option.text }), correct && _jsx(Check, { size: 15 })] }, option.id);
                    }) }), questionIssues.length > 0 ? _jsx("div", { className: "question-issue-list", children: questionIssues.map((issue) => _jsxs("div", { className: `question-issue ${issue.severity}`, children: [issue.severity === "error" ? _jsx(CircleHelp, { size: 14 }) : _jsx(AlertTriangle, { size: 14 }), _jsxs("span", { children: [_jsx("strong", { children: issue.title }), issue.message] })] }, issue.id)) }) : _jsxs("div", { className: "question-clean", children: [_jsx(CheckCircle2, { size: 15 }), " Structure looks good"] })] }, question.id));
    }
    return (_jsxs("div", { className: "page-wrap import-preview-page streamlined-import-preview", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "IMPORT REVIEW" }), _jsx("h1", { children: "Fix only what needs attention" }), _jsx("p", { children: "Problem questions appear first. Clean questions stay collapsed until you need them." })] }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button", type: "button", onClick: onBack, children: [_jsx(ChevronLeft, { size: 16 }), " Back"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirm, children: ["Save ", pending.selectedIds.length, " questions ", _jsx(ChevronRight, { size: 16 })] })] })] }), _jsxs("section", { className: "import-overview-grid compact-overview", children: [_jsx(Metric, { label: "Prepared", value: pending.questions.length, note: `${pending.expected} detected in source`, icon: _jsx(Layers3, { size: 18 }) }), _jsx(Metric, { label: "Answers found", value: verifiedCount, note: `${pending.questions.length - verifiedCount} need an answer`, icon: _jsx(CheckCircle2, { size: 18 }) }), _jsx(Metric, { label: "Warnings", value: warningCount, note: "Review recommended", icon: _jsx(AlertTriangle, { size: 18 }) }), _jsx(Metric, { label: "Blocking", value: errorCount, note: "Fix or exclude", icon: _jsx(CircleHelp, { size: 18 }) })] }), (pending.parserWarnings.length > 0 || pending.issues.some((issue) => !issue.questionId)) && _jsxs("section", { className: "import-global-notes", children: [_jsx(AlertTriangle, { size: 19 }), _jsxs("div", { children: [_jsx("strong", { children: "Source-level notes" }), [...pending.parserWarnings, ...pending.issues.filter((issue) => !issue.questionId).map((issue) => issue.message)].slice(0, 4).map((message) => _jsx("p", { children: message }, message))] })] }), _jsxs("section", { className: "import-toolbar card-surface simplified-import-toolbar", children: [_jsxs("label", { className: "search-box import-search", children: [_jsx(Search, { size: 17 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search questions or topics" })] }), _jsxs("div", { className: "segmented-control", "aria-label": "Import filters", children: [_jsxs("button", { type: "button", className: filter === "issues" ? "active" : "", onClick: () => setFilter("issues"), children: ["Needs attention ", _jsx("span", { children: attentionQuestions.length })] }), _jsxs("button", { type: "button", className: filter === "missing" ? "active" : "", onClick: () => setFilter("missing"), children: ["Missing answers ", _jsx("span", { children: missingQuestions.length })] }), _jsx("button", { type: "button", className: filter === "all" ? "active" : "", onClick: () => setFilter("all"), children: "All" })] }), _jsxs("div", { className: "toolbar import-select-actions", children: [_jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("all"), children: "Select all" }), _jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("clean"), children: "Select clean" }), _jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("none"), children: "Clear" })] })] }), _jsxs("section", { className: "import-question-list", children: [filter === "issues" && attentionQuestions.map(renderQuestionCard), filter === "missing" && missingQuestions.map(renderQuestionCard), filter === "all" && attentionQuestions.map(renderQuestionCard), filter === "all" && cleanQuestions.length > 0 && (_jsxs("details", { className: "clean-question-disclosure", children: [_jsxs("summary", { children: [_jsxs("span", { children: [_jsx(CheckCircle2, { size: 18 }), _jsxs("strong", { children: ["View ", cleanQuestions.length, " clean question", cleanQuestions.length === 1 ? "" : "s"] }), _jsx("small", { children: "These questions passed the structural checks." })] }), _jsx(ChevronRight, { size: 18 })] }), _jsx("div", { className: "clean-question-content", children: cleanQuestions.map(renderQuestionCard) })] })), ((filter === "issues" && !attentionQuestions.length) || (filter === "missing" && !missingQuestions.length) || (filter === "all" && !attentionQuestions.length && !cleanQuestions.length)) && _jsxs("div", { className: "empty-state", children: [_jsx(CheckCircle2, { size: 34 }), _jsx("strong", { children: "No questions match this view" }), _jsx("p", { children: "Try another filter or search term." })] })] }), _jsxs("div", { className: "sticky-import-footer", children: [_jsxs("span", { children: [_jsx("strong", { children: pending.selectedIds.length }), " of ", pending.questions.length, " selected"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirm, children: ["Save to library ", _jsx(ChevronRight, { size: 16 })] })] })] }));
}
function EditorView({ studySet, question, onSelect, onUpdateQuestion, onUpdateOption, onMarkCorrect, onSelectionMode, onAddOption, onRemoveOption, onAddQuestion, onDuplicate, onDelete, onBulkDelete, onBulkStatus, onBulkTopic, onDeleteSet, onSetup, onDashboard }) {
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [topicFilter, setTopicFilter] = useState("All topics");
    const [selectedIds, setSelectedIds] = useState([]);
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
    function toggleSelected(id) {
        setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    }
    function toggleAllVisible() {
        setSelectedIds((current) => {
            const currentSet = new Set(current);
            if (allVisibleSelected)
                filteredQuestions.forEach((item) => currentSet.delete(item.id));
            else
                filteredQuestions.forEach((item) => currentSet.add(item.id));
            return [...currentSet];
        });
    }
    function clearSelection() {
        setSelectedIds([]);
    }
    return (_jsxs("div", { className: "page-wrap editor-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onDashboard, children: "Dashboard" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Review questions" }), _jsx("h1", { children: "Review extracted questions" }), _jsx("p", { children: "Search, filter, edit, and update several questions at once." })] }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button danger-ghost", type: "button", onClick: () => onDeleteSet(studySet.id), children: [_jsx(Trash2, { size: 16 }), " Delete set"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onSetup, children: ["Set up exam ", _jsx(ChevronRight, { size: 16 })] })] })] }), _jsxs("section", { className: "bulk-editor-toolbar", children: [_jsxs("label", { className: "search-box bulk-search", children: [_jsx(Search, { size: 17 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search question text or topic" })] }), _jsxs("select", { value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), "aria-label": "Filter by status", children: [_jsx("option", { value: "all", children: "All statuses" }), _jsx("option", { value: "verified", children: "Verified" }), _jsx("option", { value: "review", children: "Needs review" })] }), _jsxs("select", { value: topicFilter, onChange: (event) => setTopicFilter(event.target.value), "aria-label": "Filter by topic", children: [_jsx("option", { children: "All topics" }), topics.map((topic) => _jsx("option", { children: topic }, topic))] }), _jsx("button", { className: "secondary-button compact", type: "button", onClick: toggleAllVisible, children: allVisibleSelected ? "Clear visible" : "Select visible" })] }), selectedIds.length > 0 && (_jsxs("section", { className: "bulk-action-bar", children: [_jsxs("div", { children: [_jsx("span", { className: "bulk-count", children: selectedIds.length }), _jsx("strong", { children: "questions selected" }), _jsx("button", { className: "text-button", type: "button", onClick: clearSelection, children: "Clear" })] }), _jsxs("div", { className: "bulk-actions", children: [_jsxs("button", { className: "secondary-button compact", type: "button", onClick: () => onBulkStatus(selectedIds, "review"), children: [_jsx(CircleHelp, { size: 15 }), " Mark review"] }), _jsxs("label", { className: "bulk-topic-control", children: [_jsx(Tag, { size: 15 }), _jsx("input", { value: bulkTopic, onChange: (event) => setBulkTopic(event.target.value), placeholder: "Topic" }), _jsx("button", { type: "button", onClick: () => onBulkTopic(selectedIds, bulkTopic.trim() || "General"), children: "Apply" })] }), _jsxs("button", { className: "ghost-button danger-ghost compact", type: "button", onClick: () => { onBulkDelete(selectedIds); clearSelection(); }, children: [_jsx(Trash2, { size: 15 }), " Delete"] })] })] })), _jsxs("div", { className: "editor-layout", children: [_jsxs("aside", { className: "editor-sidebar", children: [_jsxs("div", { className: "set-summary", children: [_jsx("div", { className: "set-file-icon", children: _jsx(FileText, { size: 21 }) }), _jsx("strong", { children: studySet.title }), _jsx("span", { children: studySet.sourceName }), _jsxs("div", { className: "summary-grid", children: [_jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: verified }), _jsx("small", { children: "Verified" })] }), _jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length - verified }), _jsx("small", { children: "Review" })] })] })] }), _jsxs("div", { className: "question-list filtered-list", children: [filteredQuestions.map((item) => {
                                        const itemIndex = studySet.questions.indexOf(item);
                                        return (_jsxs("div", { className: `question-list-row ${item.id === question.id ? "active" : ""} ${item.status === "review" ? "warn" : ""}`, children: [_jsx("label", { className: "question-select", children: _jsx("input", { type: "checkbox", checked: selectedSet.has(item.id), onChange: () => toggleSelected(item.id), "aria-label": `Select question ${itemIndex + 1}` }) }), _jsxs("button", { className: "question-open", type: "button", onClick: () => onSelect(item.id), children: [_jsx("span", { children: itemIndex + 1 }), _jsxs("span", { className: "question-list-copy", children: [_jsx("b", { children: item.question }), _jsx("small", { children: item.topic ?? "General" })] }), isVerifiedQuestion(item) ? _jsx(Check, { size: 14 }) : _jsx(CircleHelp, { size: 14 })] })] }, item.id));
                                    }), !filteredQuestions.length && _jsxs("div", { className: "question-list-empty", children: [_jsx(Filter, { size: 22 }), _jsx("span", { children: "No matching questions" })] })] }), _jsxs("button", { className: "ghost-button full-button", type: "button", onClick: onAddQuestion, children: [_jsx(Plus, { size: 16 }), " Add question"] })] }), _jsxs("section", { className: "question-editor-card", children: [_jsxs("div", { className: "editor-card-head", children: [_jsxs("div", { children: [_jsxs("div", { className: "editor-status-line", children: [_jsx("span", { className: `status ${ready ? "ready" : "draft"}`, children: ready ? `${correctIds.length} answer${correctIds.length === 1 ? "" : "s"} verified` : "Needs review" }), question.sourcePage && _jsxs("span", { className: "page-chip", children: ["Page ", question.sourcePage] }), _jsxs("span", { className: "page-chip topic-chip", children: [_jsx(Tag, { size: 11 }), " ", question.topic ?? "General"] })] }), _jsxs("h2", { children: ["Question ", index + 1] }), _jsx("p", { children: multiple ? "This is a multiple-answer question. Select every correct choice." : ready ? "The detected answer is selected. You can still change it." : "Select the correct option before using this question in an exam." })] }), _jsxs("div", { className: "editor-actions", children: [_jsx("button", { className: "icon-button", type: "button", title: "Duplicate", onClick: () => onDuplicate(question.id), children: _jsx(Copy, { size: 17 }) }), _jsx("button", { className: "icon-button danger-icon", type: "button", title: "Delete", onClick: () => onDelete(question.id), children: _jsx(Trash2, { size: 17 }) })] })] }), _jsxs("div", { className: "editor-meta-grid", children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-topic", children: "Topic" }), _jsx("input", { id: "question-topic", className: "text-input", value: question.topic ?? "General", onChange: (event) => onUpdateQuestion(question.id, { topic: event.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-status", children: "Review status" }), _jsxs("select", { id: "question-status", className: "text-input", value: question.status, onChange: (event) => onUpdateQuestion(question.id, { status: event.target.value }), children: [_jsx("option", { value: "verified", disabled: !answerReady, children: "Verified" }), _jsx("option", { value: "review", children: "Needs review" })] })] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-text", children: "Question" }), _jsx("textarea", { id: "question-text", className: "question-input", value: question.question, onChange: (event) => onUpdateQuestion(question.id, { question: event.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsxs("div", { className: "label-row answer-heading", children: [_jsxs("div", { children: [_jsx("label", { children: "Answer choices" }), _jsx("small", { children: multiple ? "Check all correct answers." : "Choose one correct answer." })] }), _jsxs("select", { className: "answer-mode-select", "aria-label": "Answer selection mode", value: multiple ? "multiple" : "single", onChange: (event) => onSelectionMode(question.id, event.target.value), children: [_jsx("option", { value: "single", children: "Single answer" }), _jsx("option", { value: "multiple", children: "Multiple answers" })] })] }), _jsx("div", { className: "answer-grid", children: question.options.map((option, optionIndex) => {
                                            const selected = correctIds.includes(option.id);
                                            return _jsxs("div", { className: `answer-row ${selected ? "correct" : ""}`, children: [_jsx("span", { className: "answer-letter", children: String.fromCharCode(65 + optionIndex) }), _jsx("input", { value: option.text, onChange: (event) => onUpdateOption(question.id, option.id, event.target.value), "aria-label": `Answer ${String.fromCharCode(65 + optionIndex)}` }), _jsx("button", { className: `correct-radio ${selected ? "selected" : ""}`, type: "button", title: selected ? "Correct answer selected" : "Mark as correct", onClick: () => onMarkCorrect(question.id, option.id), children: _jsx(Check, { size: 16 }) }), _jsx("button", { className: "remove-option", type: "button", title: "Remove option", onClick: () => onRemoveOption(question.id, option.id), children: _jsx(X, { size: 15 }) })] }, option.id);
                                        }) }), _jsxs("button", { className: "text-button add-option", type: "button", onClick: () => onAddOption(question.id), children: [_jsx(Plus, { size: 15 }), " Add answer choice"] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "explanation", children: "Explanation" }), _jsx("textarea", { id: "explanation", className: "explanation-input", value: question.explanation, onChange: (event) => onUpdateQuestion(question.id, { explanation: event.target.value }), placeholder: "Explain why the selected answer is correct." })] }), _jsxs("div", { className: "editor-footer", children: [_jsx("span", { children: "Changes save automatically in this browser." }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: !previous, onClick: () => previous && onSelect(previous.id), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => next ? onSelect(next.id) : onSetup, children: [next ? "Next question" : "Set up exam", _jsx(ChevronRight, { size: 16 })] })] })] })] }, question.id)] })] }));
}
function SetupView({ studySet, settings, onSettings, onBack, onStart }) {
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
    const update = (key, value) => onSettings({ ...settings, [key]: value });
    const maxQuestions = Math.max(1, filtered.length);
    const selectedCount = Math.min(settings.questionCount, maxQuestions);
    return (_jsxs("div", { className: "page-wrap setup-page", children: [_jsx("div", { className: "page-head", children: _jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onBack, children: "Review questions" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Exam setup" }), _jsx("h1", { children: "Customize your mock exam" }), _jsx("p", { children: "Choose topics, weak areas, question count, timing, and randomization." })] }) }), _jsxs("div", { className: "setup-grid", children: [_jsxs("section", { className: "setup-panel", children: [_jsx("h2", { children: "Exam preferences" }), _jsx("p", { children: "These settings apply only to the next attempt." }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Topic" }), _jsx("small", { children: "Practice the whole set or focus on one topic." })] }), _jsxs("select", { value: settings.topicFilter ?? "All topics", onChange: (event) => { update("topicFilter", event.target.value); onSettings({ ...settings, topicFilter: event.target.value, questionCount: Math.min(settings.questionCount, verified.filter((q) => event.target.value === "All topics" || (q.topic ?? "General") === event.target.value).length || 1) }); }, children: [_jsx("option", { children: "All topics" }), topics.map((topic) => _jsx("option", { children: topic }, topic))] })] }), _jsx(ToggleSetting, { label: "Focus on weak areas", description: weak.length ? `Prioritize ${weak.join(", ")}.` : "Completing a few attempts will identify weak topics.", checked: Boolean(settings.weakAreasOnly), onChange: (value) => update("weakAreasOnly", value) }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Number of questions" }), _jsxs("small", { children: [filtered.length, " verified questions match your filters."] })] }), _jsx("select", { value: selectedCount, onChange: (event) => update("questionCount", Number(event.target.value)), children: Array.from({ length: maxQuestions }, (_, index) => index + 1).filter((value) => value === maxQuestions || value % 5 === 0 || value === 1).map((value) => _jsx("option", { value: value, children: value }, value)) })] }), _jsx(ToggleSetting, { label: "Shuffle questions", description: "Use a different question order for every attempt.", checked: settings.shuffleQuestions, onChange: (value) => update("shuffleQuestions", value) }), _jsx(ToggleSetting, { label: "Shuffle answer choices", description: "Randomize the choice order without changing the answer key.", checked: settings.shuffleAnswers, onChange: (value) => update("shuffleAnswers", value) }), _jsx(ToggleSetting, { label: "Timed exam", description: "Show a countdown while answering.", checked: settings.timed, onChange: (value) => update("timed", value) }), _jsxs("div", { className: `setting-row ${!settings.timed ? "disabled-setting" : ""}`, children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Time limit" }), _jsx("small", { children: "Select the exam duration." })] }), _jsx("select", { disabled: !settings.timed, value: settings.minutes, onChange: (event) => update("minutes", Number(event.target.value)), children: [5, 10, 20, 30, 45, 60, 90].map((value) => _jsxs("option", { value: value, children: [value, " minutes"] }, value)) })] }), hasExplanations && _jsx(ToggleSetting, { label: "Show explanations", description: "Display available explanations in the answer review.", checked: settings.showExplanations, onChange: (value) => update("showExplanations", value) }), _jsxs("section", { className: "lifeline-settings", children: [_jsxs("div", { className: "lifeline-settings-head", children: [_jsx("span", { children: _jsx(ShieldCheck, { size: 18 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Practice lifelines" }), _jsx("small", { children: "Turn each aid on or off for this attempt. Every enabled lifeline can be used once." })] })] }), _jsxs("div", { className: "lifeline-toggle-grid", children: [_jsx(LifelineToggle, { icon: _jsx(Scissors, { size: 17 }), label: "50:50", description: "Remove incorrect choices until two remain.", checked: Boolean(settings.lifelineFiftyFifty), onChange: (value) => update("lifelineFiftyFifty", value) }), _jsx(LifelineToggle, { icon: _jsx(Users, { size: 17 }), label: "Audience Poll", description: "Show a simulated vote for the current question.", checked: Boolean(settings.lifelineAudiencePoll), onChange: (value) => update("lifelineAudiencePoll", value) }), _jsx(LifelineToggle, { icon: _jsx(Snowflake, { size: 17 }), label: "Time Freeze", description: "Pause a timed exam for 60 seconds.", checked: Boolean(settings.lifelineTimeFreeze), onChange: (value) => update("lifelineTimeFreeze", value), disabled: !settings.timed }), _jsx(LifelineToggle, { icon: _jsx(Lightbulb, { size: 17 }), label: "Clue", description: "Reveal the saved explanation or a source-page hint.", checked: Boolean(settings.lifelineClue), onChange: (value) => update("lifelineClue", value) })] })] })] }), _jsxs("aside", { className: "preview-panel", children: [_jsxs("div", { className: "preview-header", children: [_jsxs("span", { className: "pill", children: [_jsx(Target, { size: 13 }), " EXAM PREVIEW"] }), _jsx("h2", { children: studySet.title }), _jsx("p", { children: settings.weakAreasOnly && weak.length ? `Weak-area mode: ${weak.join(", ")}` : settings.topicFilter && settings.topicFilter !== "All topics" ? settings.topicFilter : "Mixed-topic practice" })] }), preview && _jsxs("div", { className: "exam-preview-card", children: [_jsx("span", { children: isMultipleQuestion(preview) ? "MULTIPLE ANSWERS" : "QUESTION 01" }), _jsx("h3", { children: preview.question }), preview.options.slice(0, 3).map((option, index) => _jsxs("div", { className: "mini-answer", children: [_jsx("span", { children: String.fromCharCode(65 + index) }), option.text] }, option.id))] }), _jsxs("div", { className: "exam-details", children: [_jsxs("div", { children: [_jsx("strong", { children: Math.min(settings.questionCount, filtered.length) }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: settings.timed ? `${settings.minutes}m` : "∞" }), _jsx("small", { children: "Time limit" })] }), _jsxs("div", { children: [_jsx("strong", { children: filtered.length ? new Set(filtered.map((q) => q.topic ?? "General")).size : 0 }), _jsx("small", { children: "Topics" })] })] }), _jsxs("button", { className: "primary-button start-button", type: "button", disabled: !filtered.length, onClick: onStart, children: ["Start mock exam ", _jsx(ChevronRight, { size: 17 })] })] })] })] }));
}
function ToggleSetting({ label, description, checked, onChange }) {
    return _jsxs("label", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: label }), _jsx("small", { children: description })] }), _jsx("input", { className: "switch-input", type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) })] });
}
function LifelineToggle({ icon, label, description, checked, onChange, disabled = false }) {
    return _jsxs("label", { className: `lifeline-toggle-card ${checked ? "enabled" : ""} ${disabled ? "disabled" : ""}`, children: [_jsx("span", { className: "lifeline-toggle-icon", children: icon }), _jsxs("span", { className: "lifeline-toggle-copy", children: [_jsx("strong", { children: label }), _jsx("small", { children: description })] }), _jsx("input", { className: "switch-input", type: "checkbox", checked: checked, disabled: disabled, onChange: (event) => onChange(event.target.checked) })] });
}
function ExamView({ exam, settings, onAnswer, onFlag, onMove, onSubmit, reviewOpen, onCloseReview, onConfirmSubmit, onFiftyFifty, onAudiencePoll, onTimeFreeze, onClue }) {
    const [navFilter, setNavFilter] = useState("all");
    const [navOpen, setNavOpen] = useState(false);
    if (!exam)
        return null;
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
    const statusFor = (item) => {
        const responses = exam.responses[item.id] ?? [];
        const expected = isMultipleQuestion(item) ? Math.max(2, getCorrectIds(item).length) : 1;
        const incomplete = responses.length > 0 && responses.length < expected;
        return { unanswered: responses.length === 0, incomplete, answered: responses.length > 0 && !incomplete, flagged: Boolean(exam.flagged[item.id]) };
    };
    const counts = exam.questions.reduce((acc, item) => {
        const status = statusFor(item);
        if (status.unanswered)
            acc.unanswered += 1;
        if (status.incomplete)
            acc.incomplete += 1;
        if (status.answered)
            acc.answered += 1;
        if (status.flagged)
            acc.flagged += 1;
        return acc;
    }, { unanswered: 0, incomplete: 0, answered: 0, flagged: 0 });
    const visibleQuestions = exam.questions
        .map((item, index) => ({ item, index, status: statusFor(item) }))
        .filter(({ status }) => navFilter === "all" || status[navFilter]);
    const multiple = isMultipleQuestion(question);
    const expectedSelections = Math.max(2, getCorrectIds(question).length);
    const progressPercent = Math.round((counts.answered / Math.max(1, exam.questions.length)) * 100);
    const lifelinesEnabled = Boolean(settings.lifelineFiftyFifty
        || settings.lifelineAudiencePoll
        || settings.lifelineTimeFreeze
        || settings.lifelineClue);
    function moveFromNavigator(index) {
        onMove(index);
        setNavOpen(false);
    }
    return (_jsxs("div", { className: "exam-shell streamlined-exam-shell", children: [_jsxs("header", { className: "exam-topbar", children: [_jsxs("div", { className: "exam-brand", children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsxs("span", { children: [_jsx("strong", { children: "QuizForge Exam" }), _jsx("small", { children: question.topic ?? "Practice mode" })] })] }), _jsxs("button", { className: "exam-nav-trigger", type: "button", onClick: () => setNavOpen(true), children: [_jsx(Menu, { size: 17 }), " Questions"] }), _jsxs("div", { className: "exam-meta", children: [_jsxs("div", { className: "autosave-status", children: [_jsx(CheckCircle2, { size: 15 }), _jsx("span", { children: "Saved" })] }), _jsxs("div", { className: `timer ${freezeSeconds > 0 ? "frozen" : ""}`, children: [_jsx(Clock3, { size: 17 }), _jsx("span", { children: settings.timed ? formatDuration(exam.remainingSeconds) : "Untimed" }), _jsx("small", { children: freezeSeconds > 0 ? `frozen ${freezeSeconds}s` : settings.timed ? "remaining" : "no limit" })] }), _jsx("button", { className: "primary-button compact", type: "button", onClick: onSubmit, children: "Review & submit" })] })] }), navOpen && _jsx("button", { className: "exam-nav-scrim", type: "button", "aria-label": "Close question navigator", onClick: () => setNavOpen(false) }), _jsxs("div", { className: "exam-body", children: [_jsxs("aside", { className: `exam-nav simplified-exam-nav ${navOpen ? "open" : ""}`, children: [_jsxs("div", { className: "exam-nav-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: "Questions" }), _jsxs("p", { children: [counts.answered, " of ", exam.questions.length, " complete"] })] }), _jsx("button", { className: "icon-button exam-nav-close", type: "button", "aria-label": "Close navigator", onClick: () => setNavOpen(false), children: _jsx(X, { size: 17 }) })] }), _jsxs("div", { className: "exam-nav-progress", children: [_jsxs("div", { children: [_jsxs("strong", { children: [progressPercent, "%"] }), _jsx("small", { children: "progress" })] }), _jsx("span", { children: _jsx("i", { style: { width: `${progressPercent}%` } }) })] }), _jsxs("div", { className: "exam-nav-filters compact-filters", children: [_jsxs("button", { type: "button", className: navFilter === "all" ? "active" : "", onClick: () => setNavFilter("all"), children: ["All ", _jsx("span", { children: exam.questions.length })] }), _jsxs("button", { type: "button", className: navFilter === "unanswered" ? "active" : "", onClick: () => setNavFilter("unanswered"), children: ["Unanswered ", _jsx("span", { children: counts.unanswered })] }), hasMultipleQuestions && _jsxs("button", { type: "button", className: navFilter === "incomplete" ? "active" : "", onClick: () => setNavFilter("incomplete"), children: ["Incomplete ", _jsx("span", { children: counts.incomplete })] }), _jsxs("button", { type: "button", className: navFilter === "flagged" ? "active" : "", onClick: () => setNavFilter("flagged"), children: ["Flagged ", _jsx("span", { children: counts.flagged })] })] }), _jsx("div", { className: "question-dots", children: visibleQuestions.map(({ item, index, status }) => _jsx("button", { type: "button", "aria-label": `Go to question ${index + 1}`, className: `question-dot ${index === exam.currentIndex ? "current" : status.answered ? "answered" : ""} ${status.incomplete ? "incomplete" : ""} ${status.flagged ? "flagged" : ""}`, onClick: () => moveFromNavigator(index), children: index + 1 }, item.id)) }), !visibleQuestions.length && _jsx("div", { className: "nav-empty", children: "No questions in this filter." })] }), _jsxs("main", { className: "exam-main", children: [_jsxs("div", { className: "exam-progress", children: [_jsxs("span", { children: ["Question ", exam.currentIndex + 1, " of ", exam.questions.length] }), _jsxs("span", { children: [Math.round(((exam.currentIndex + 1) / exam.questions.length) * 100), "%"] })] }), _jsx("div", { className: "exam-progress-track", children: _jsx("span", { style: { width: `${((exam.currentIndex + 1) / exam.questions.length) * 100}%` } }) }), _jsxs("section", { className: "exam-question-card", children: [_jsxs("div", { className: "question-kicker", children: [_jsxs("span", { children: [multiple ? "MULTIPLE ANSWERS" : "MULTIPLE CHOICE", " \u00B7 ", question.topic ?? "General"] }), _jsxs("button", { className: `flag-button ${exam.flagged[question.id] ? "flagged" : ""}`, type: "button", onClick: onFlag, children: [_jsx(Flag, { size: 15 }), " ", exam.flagged[question.id] ? "Flagged" : "Flag for review"] })] }), _jsx("h1", { children: question.question }), lifelinesEnabled && (_jsxs("section", { className: "lifeline-bar", "aria-label": "Exam lifelines", children: [_jsxs("div", { className: "lifeline-bar-title", children: [_jsx(ShieldCheck, { size: 16 }), _jsxs("span", { children: [_jsx("strong", { children: "Lifelines" }), _jsx("small", { children: "Each can be used once" })] })] }), _jsxs("div", { className: "lifeline-actions", children: [settings.lifelineFiftyFifty && _jsxs("button", { className: `lifeline-button ${lifelines.fiftyFiftyUsed ? "used" : ""}`, type: "button", disabled: lifelines.fiftyFiftyUsed || multiple || question.options.length <= 2, onClick: onFiftyFifty, children: [_jsx(Scissors, { size: 16 }), _jsx("span", { children: "50:50" })] }), settings.lifelineAudiencePoll && _jsxs("button", { className: `lifeline-button ${lifelines.audiencePollUsed ? "used" : ""}`, type: "button", disabled: lifelines.audiencePollUsed || multiple, onClick: onAudiencePoll, children: [_jsx(Users, { size: 16 }), _jsx("span", { children: "Audience" })] }), settings.lifelineTimeFreeze && _jsxs("button", { className: `lifeline-button ${lifelines.timeFreezeUsed ? "used" : ""} ${freezeSeconds > 0 ? "active" : ""}`, type: "button", disabled: lifelines.timeFreezeUsed || !settings.timed, onClick: onTimeFreeze, children: [_jsx(Snowflake, { size: 16 }), _jsx("span", { children: freezeSeconds > 0 ? `${freezeSeconds}s` : "Freeze" })] }), settings.lifelineClue && _jsxs("button", { className: `lifeline-button ${lifelines.clueUsed ? "used" : ""}`, type: "button", disabled: lifelines.clueUsed, onClick: onClue, children: [_jsx(Lightbulb, { size: 16 }), _jsx("span", { children: "Clue" })] })] })] })), clue && _jsxs("div", { className: "lifeline-clue", children: [_jsx(Lightbulb, { size: 18 }), _jsxs("div", { children: [_jsx("strong", { children: "Your clue" }), _jsx("p", { children: clue })] })] }), audiencePoll && _jsxs("div", { className: "audience-summary", children: [_jsx(Users, { size: 16 }), _jsx("span", { children: "The audience has voted. Percentages appear beside each remaining choice." })] }), multiple && _jsxs("div", { className: "selection-hint", children: [_jsx(Sparkles, { size: 15 }), _jsxs("span", { children: ["Select all correct answers", getCorrectIds(question).length > 1 ? ` (${expectedSelections} expected)` : "", "."] })] }), _jsx("div", { className: "exam-options", children: question.options.map((option, index) => {
                                            if (removedIds.has(option.id))
                                                return null;
                                            const isSelected = selected.includes(option.id);
                                            const pollValue = audiencePoll?.[option.id];
                                            return (_jsxs("button", { className: `exam-option ${isSelected ? "selected" : ""} ${pollValue !== undefined ? "with-poll" : ""}`, type: "button", onClick: () => onAnswer(option.id), children: [_jsx("span", { className: "option-letter", children: String.fromCharCode(65 + index) }), _jsx("span", { className: "option-text", children: option.text }), pollValue !== undefined && _jsxs("span", { className: "audience-poll", children: [_jsx("i", { style: { width: `${pollValue}%` } }), _jsxs("b", { children: [pollValue, "%"] })] }), isSelected && _jsx("span", { className: "option-check", children: _jsx(Check, { size: 18 }) })] }, option.id));
                                        }) }), _jsxs("div", { className: "exam-footer", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: exam.currentIndex === 0, onClick: () => onMove(exam.currentIndex - 1), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), exam.currentIndex < exam.questions.length - 1 ? _jsxs("button", { className: "primary-button", type: "button", onClick: () => onMove(exam.currentIndex + 1), children: ["Next question ", _jsx(ChevronRight, { size: 16 })] }) : _jsxs("button", { className: "primary-button", type: "button", onClick: onSubmit, children: ["Review exam ", _jsx(Check, { size: 16 })] })] })] }, question.id)] })] }), reviewOpen && _jsx("div", { className: "modal-backdrop exam-review-backdrop", children: _jsxs("section", { className: "submit-review-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "submit-review-title", children: [_jsx("button", { className: "modal-close", type: "button", "aria-label": "Close review", onClick: onCloseReview, children: _jsx(X, { size: 18 }) }), _jsx("span", { className: "modal-success-orb review-orb", children: _jsx(ListFilter, { size: 28 }) }), _jsx("p", { className: "eyebrow", children: "FINAL REVIEW" }), _jsx("h2", { id: "submit-review-title", children: "Ready to submit?" }), _jsx("p", { children: "Check unanswered, incomplete, and flagged questions before your answers are scored." }), _jsxs("div", { className: "submit-review-stats", children: [_jsxs("button", { type: "button", onClick: () => { setNavFilter("unanswered"); onCloseReview(); setNavOpen(true); }, children: [_jsx("strong", { children: counts.unanswered }), _jsx("small", { children: "Unanswered" })] }), hasMultipleQuestions && _jsxs("button", { type: "button", onClick: () => { setNavFilter("incomplete"); onCloseReview(); setNavOpen(true); }, children: [_jsx("strong", { children: counts.incomplete }), _jsx("small", { children: "Incomplete" })] }), _jsxs("button", { type: "button", onClick: () => { setNavFilter("flagged"); onCloseReview(); setNavOpen(true); }, children: [_jsx("strong", { children: counts.flagged }), _jsx("small", { children: "Flagged" })] }), _jsxs("div", { children: [_jsx("strong", { children: counts.answered }), _jsx("small", { children: "Complete" })] })] }), _jsx("div", { className: "submit-question-grid", children: exam.questions.map((item, index) => { const status = statusFor(item); return _jsx("button", { type: "button", className: `${status.answered ? "complete" : status.incomplete ? "incomplete" : "unanswered"} ${status.flagged ? "flagged" : ""}`, onClick: () => { onMove(index); onCloseReview(); }, children: index + 1 }, item.id); }) }), _jsxs("div", { className: "submit-review-actions", children: [_jsx("button", { className: "ghost-button", type: "button", onClick: onCloseReview, children: "Return to exam" }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirmSubmit, children: ["Submit now ", _jsx(Check, { size: 16 })] })] })] }) })] }));
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
