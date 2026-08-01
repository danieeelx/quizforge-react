import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArchiveRestore, BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, CheckCircle2, CircleHelp, Clock3, Copy, FileText, Filter, Flag, FolderOpen, GripVertical, Home, Image, Layers3, Library, ListFilter, Menu, Moon, Plus, ScanText, Search, Sparkles, Sun, Tag, Target, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { createDemoSet } from "./data/demo.js";
import { combinePastedQuestionsAndAnswers } from "./lib/paste.js";
import { extractImageText, extractPdfText } from "./lib/pdf.js";
import { generateLocalQuestions, parseQuestionBankDetailed } from "./lib/parser.js";
import { clearExamRecovery, clearUploadDraft, loadExamRecovery, loadStudySets, loadTheme, loadUploadDraft, saveExamRecovery, saveStudySets, saveTheme, saveUploadDraft } from "./lib/storage.js";
import { bestScore, formatDate, formatDuration, shuffle, stripExtension, uid } from "./lib/utils.js";
import { availableTopics, computeTopicPerformance, ensureQuestionTopics, weakTopics } from "./lib/topics.js";
import { validateQuestions } from "./lib/validation.js";
function createPasteSection() {
    return {
        id: uid(),
        title: "",
        questions: "",
        answers: ""
    };
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
    weakAreasOnly: false
};
function App() {
    const [view, setView] = useState("dashboard");
    const [theme, setTheme] = useState(() => loadTheme());
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [studySets, setStudySets] = useState(() => {
        const stored = loadStudySets();
        return stored.length ? stored : [createDemoSet()];
    });
    const [initialUploadDraft] = useState(() => loadUploadDraft());
    const [initialExamRecovery] = useState(() => loadExamRecovery());
    const [activeSetId, setActiveSetId] = useState(null);
    const [editingQuestionId, setEditingQuestionId] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [recoveredFileName, setRecoveredFileName] = useState(initialUploadDraft?.fileName ?? "");
    const [pasteSections, setPasteSections] = useState(() => initialUploadDraft?.pasteSections?.length ? initialUploadDraft.pasteSections : [createPasteSection()]);
    const [studyTitle, setStudyTitle] = useState(initialUploadDraft?.title ?? "");
    const [aiEnhanced, setAiEnhanced] = useState(initialUploadDraft?.aiEnhanced ?? false);
    const [ocrEnabled, setOcrEnabled] = useState(initialUploadDraft?.ocrEnabled ?? true);
    const [aiConfigured, setAiConfigured] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [processingStep, setProcessingStep] = useState("read");
    const [processingLabel, setProcessingLabel] = useState("Reading document text");
    const [settings, setSettings] = useState(defaultSettings);
    const [exam, setExam] = useState(null);
    const [resultDetails, setResultDetails] = useState([]);
    const [toast, setToast] = useState(initialUploadDraft ? "Your unfinished paste draft was recovered" : "");
    const [importSummary, setImportSummary] = useState(null);
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
        const hasDraftContent = Boolean(studyTitle.trim() || pasteSections.some((section) => section.title.trim() || section.questions.trim() || section.answers.trim()) || selectedFile);
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
        setOcrEnabled(true);
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
        setPasteSections((current) => current.map((section) => section.id === id ? { ...section, ...patch } : section));
    }
    function addPasteSection() {
        setPasteSections((current) => [...current, createPasteSection()]);
        window.setTimeout(() => {
            document.querySelector(".paste-section-card:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 60);
    }
    function removePasteSection(id) {
        setPasteSections((current) => current.length === 1
            ? [createPasteSection()]
            : current.filter((section) => section.id !== id));
    }
    async function createStudySet() {
        const populatedSections = pasteSections.filter((section) => section.questions.trim().length >= 10);
        if (!selectedFile && !populatedSections.length) {
            setError("Choose a PDF/image or paste questions into at least one section first.");
            return;
        }
        setError("");
        setProcessingProgress(4);
        setProcessingStep("read");
        setProcessingLabel("Reading document text");
        navigate("processing");
        try {
            const parsedImports = [];
            const sourceParts = [];
            const importedQuestions = [];
            let sourceName = populatedSections.length > 1 ? `${populatedSections.length} pasted sections` : "Pasted study material";
            if (selectedFile) {
                sourceName = selectedFile.name;
                const isImageFile = selectedFile.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(selectedFile.name);
                const extractedText = isImageFile
                    ? await extractImageText(selectedFile, ({ progress, stage, page, totalPages }) => {
                        setProcessingLabel(stage === "ocr" ? `OCR scanning image ${page} of ${totalPages}` : "Reading image text");
                        setProcessingProgress(Math.max(5, Math.min(52, Math.round(progress * 0.52))));
                    })
                    : await extractPdfText(selectedFile, ({ progress, stage, page, totalPages }) => {
                        setProcessingLabel(stage === "ocr" ? `OCR scanning page ${page} of ${totalPages}` : `Reading page ${page} of ${totalPages}`);
                        setProcessingProgress(Math.max(5, Math.min(52, Math.round(progress * 0.52))));
                    }, { enableOcr: ocrEnabled });
                if (extractedText.replace(/\s/g, "").length < 30) {
                    throw new Error("This file did not produce enough readable text. Turn on OCR or try a clearer scan.");
                }
                sourceParts.push(extractedText);
                const parsedFile = parseQuestionBankDetailed(extractedText);
                parsedImports.push(parsedFile);
                importedQuestions.push(...parsedFile.questions);
            }
            setProcessingStep("detect");
            setProcessingLabel("Detecting questions and choices");
            setProcessingProgress(58);
            for (const section of populatedSections) {
                const sectionText = combinePastedQuestionsAndAnswers(section.questions, section.answers);
                sourceParts.push(sectionText);
                const parsedSection = parseQuestionBankDetailed(sectionText);
                const sectionQuestions = parsedSection.questions.map((question) => ({
                    ...question,
                    topic: section.title.trim() || question.topic
                }));
                parsedImports.push({ ...parsedSection, questions: sectionQuestions });
                importedQuestions.push(...sectionQuestions);
            }
            const sourceText = sourceParts.join("\n\n");
            let questions = ensureQuestionTopics(dedupeImportedQuestions(importedQuestions));
            setProcessingStep("answers");
            setProcessingLabel("Matching answers and checking structure");
            setProcessingProgress(72);
            if (aiEnhanced) {
                questions = ensureQuestionTopics(await generateWithAi(sourceText, studyTitle || stripExtension(sourceName)));
            }
            else if (questions.length < 2) {
                questions = ensureQuestionTopics(generateLocalQuestions(sourceText));
            }
            if (!questions.length) {
                throw new Error("No usable questions were found. Try a clearer question bank, paste content, or enable AI generation.");
            }
            setProcessingStep("finish");
            setProcessingLabel("Preparing import preview");
            setProcessingProgress(94);
            await delay(350);
            const expected = parsedImports.reduce((sum, parsed) => sum + (parsed.detectedQuestionNumbers.length || parsed.highestQuestionNumber || parsed.questions.length), 0);
            const parserWarnings = [...new Set(parsedImports.flatMap((parsed) => parsed.warnings))];
            const issues = validateQuestions(questions, aiEnhanced ? questions.length : expected || questions.length);
            setPendingImport({
                title: studyTitle.trim() || stripExtension(sourceName),
                sourceName,
                questions,
                expected: aiEnhanced ? questions.length : expected || questions.length,
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
        setImportSummary({
            title: set.title,
            extracted: questions.length,
            expected: pendingImport.expected,
            verified: questions.filter(isVerifiedQuestion).length,
            warnings: pendingImport.issues.filter((issue) => issue.severity !== "info").slice(0, 3).map((issue) => issue.message)
        });
        clearUploadDraft();
        setSelectedFile(null);
        setRecoveredFileName("");
        setPasteSections([createPasteSection()]);
        setStudyTitle("");
        setPendingImport(null);
        setToast(`${questions.length} questions added`);
        navigate("editor");
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
            remainingSeconds: settings.timed ? settings.minutes * 60 : 0
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
    return (_jsxs("div", { className: "app-root", children: [view === "exam" ? (_jsx(ExamView, { exam: exam, settings: settings, onAnswer: answerQuestion, onFlag: toggleFlag, onMove: moveQuestion, onSubmit: requestExamSubmit, reviewOpen: submitReviewOpen, onCloseReview: () => setSubmitReviewOpen(false), onConfirmSubmit: () => finalizeExam(false) })) : view === "results" ? (_jsx(ResultsView, { details: resultDetails, settings: settings, exam: exam, onRetake: () => beginExam(), onRetakeWrong: () => beginExam(resultDetails.filter((detail) => !detail.correct).map((detail) => detail.question.id)), onDashboard: () => navigate("dashboard") })) : (_jsxs(Shell, { view: view, theme: theme, sidebarOpen: sidebarOpen, onToggleSidebar: () => setSidebarOpen((current) => !current), onNavigate: navigate, onTheme: toggleTheme, onNew: newStudySet, children: [view === "dashboard" && (_jsx(Dashboard, { studySets: studySets, attempts: allAttempts.length, averageScore: averageScore, onNew: newStudySet, onOpen: openSet, onNavigate: navigate, recoveryAvailable: recoveryAvailable, onResumeExam: resumeRecoveredExam })), view === "library" && (_jsx(LibraryView, { studySets: studySets, search: search, onSearch: setSearch, onOpen: openSet, onNew: newStudySet })), view === "performance" && _jsx(PerformanceView, { studySets: studySets, attempts: allAttempts, averageScore: averageScore }), view === "upload" && (_jsx(UploadView, { file: selectedFile, pasteSections: pasteSections, title: studyTitle, dragging: dragging, aiEnhanced: aiEnhanced, aiConfigured: aiConfigured, ocrEnabled: ocrEnabled, recoveredFileName: recoveredFileName, error: error, fileInputRef: fileInputRef, onFile: (file) => { setSelectedFile(file); if (file)
                            setRecoveredFileName(""); }, onUpdatePasteSection: updatePasteSection, onAddPasteSection: addPasteSection, onRemovePasteSection: removePasteSection, onTitle: setStudyTitle, onDragging: setDragging, onAi: setAiEnhanced, onOcr: setOcrEnabled, onClearDraft: clearStudyDraft, onCreate: createStudySet, onCancel: () => navigate("dashboard") })), view === "processing" && (_jsx(ProcessingView, { fileName: selectedFile?.name || (pasteSections.filter((section) => section.questions.trim()).length > 1
                            ? `${pasteSections.filter((section) => section.questions.trim()).length} pasted sections`
                            : pasteSections.find((section) => section.questions.trim())?.title || "Pasted study material"), progress: processingProgress, step: processingStep, activeLabel: processingLabel })), view === "import-preview" && pendingImport && (_jsx(ImportPreviewView, { pending: pendingImport, onToggle: togglePendingQuestion, onSelectMode: selectPendingQuestions, onUpdateQuestion: updatePendingQuestion, onUpdateAnswer: updatePendingAnswer, onBack: () => navigate("upload"), onConfirm: confirmPendingImport })), view === "editor" && activeSet && editingQuestion && (_jsx(EditorView, { studySet: activeSet, question: editingQuestion, onSelect: setEditingQuestionId, onUpdateQuestion: updateQuestion, onUpdateOption: updateOption, onMarkCorrect: markCorrect, onSelectionMode: setSelectionMode, onAddOption: addOption, onRemoveOption: removeOption, onAddQuestion: addQuestion, onDuplicate: duplicateQuestion, onDelete: deleteQuestion, onBulkDelete: bulkDeleteQuestions, onBulkStatus: bulkSetStatus, onBulkTopic: bulkSetTopic, onDeleteSet: deleteStudySet, onSetup: openSetup, onDashboard: () => navigate("dashboard") })), view === "setup" && activeSet && (_jsx(SetupView, { studySet: activeSet, settings: settings, onSettings: setSettings, onBack: () => navigate("editor"), onStart: () => beginExam() }))] })), toast && _jsxs("div", { className: "toast", role: "status", children: [_jsx("span", { className: "toast-icon", children: _jsx(Check, { size: 15 }) }), _jsx("span", { children: toast }), _jsx("i", {})] }), importSummary && _jsx(ImportSummaryModal, { summary: importSummary, onClose: () => setImportSummary(null) })] }));
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
function Dashboard({ studySets, attempts, averageScore, onNew, onOpen, onNavigate, recoveryAvailable, onResumeExam }) {
    const recent = studySets.slice(0, 3);
    const totalQuestions = studySets.reduce((sum, set) => sum + set.questions.length, 0);
    return (_jsxs("div", { className: "page-wrap dashboard-page", children: [_jsx("section", { className: "welcome-row", children: _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR PERSONAL EXAM BUILDER" }), _jsx("h1", { children: "Welcome back, Daniel" }), _jsx("p", { children: "Create a new test or continue one of your saved study sets." })] }) }), recoveryAvailable && _jsxs("section", { className: "recovery-banner", children: [_jsx("span", { className: "recovery-icon", children: _jsx(ArchiveRestore, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: "Unfinished exam recovered" }), _jsx("p", { children: "Your answers, timer, flags, and current question were saved automatically." })] }), _jsxs("button", { className: "primary-button compact", type: "button", onClick: onResumeExam, children: ["Resume exam ", _jsx(ChevronRight, { size: 15 })] })] }), _jsxs("section", { className: "hero-card", children: [_jsxs("div", { className: "hero-copy", children: [_jsxs("span", { className: "pill", children: [_jsx(Sparkles, { size: 14 }), " AI-POWERED STUDY"] }), _jsxs("h2", { children: ["Turn any PDF into a ", _jsx("em", { children: "practice exam." })] }), _jsx("p", { children: "Upload a reviewer, lecture notes, or a question bank. QuizForge extracts questions, identifies available answers, and builds a customizable mock test." }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { className: "primary-button large", type: "button", onClick: onNew, children: [_jsx(Upload, { size: 18 }), " Upload PDF ", _jsx(ChevronRight, { size: 17 })] }), _jsxs("button", { className: "secondary-button large", type: "button", onClick: onNew, children: [_jsx(FileText, { size: 18 }), " Paste text"] })] }), _jsxs("div", { className: "privacy-line", children: [_jsx(Check, { size: 15 }), " PDF extraction happens in your browser"] })] }), _jsxs("div", { className: "upload-visual", "aria-hidden": "true", children: [_jsx("div", { className: "upload-orbit orbit-one" }), _jsx("div", { className: "upload-orbit orbit-two" }), _jsxs("div", { className: "file-card rear", children: [_jsx("span", { children: "PDF" }), _jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("div", { className: "file-card front", children: [_jsx("div", { className: "file-icon", children: "PDF" }), _jsx("strong", { children: "Reviewer.pdf" }), _jsx("small", { children: "Ready to transform" }), _jsx("div", { className: "mini-progress", children: _jsx("span", {}) })] }), _jsx("div", { className: "floating-chip chip-one", children: "24 questions" }), _jsxs("div", { className: "floating-chip chip-two", children: ["Answer key found ", _jsx(Check, { size: 12 })] })] })] }), _jsxs("section", { className: "metric-grid", "aria-label": "Study overview", children: [_jsx(Metric, { label: "Study sets", value: studySets.length, note: "Saved locally", icon: _jsx(BookOpen, { size: 18 }) }), _jsx(Metric, { label: "Questions", value: totalQuestions, note: "Across your library", icon: _jsx(CircleHelp, { size: 18 }) }), _jsx(Metric, { label: "Attempts", value: attempts, note: "Completed exams", icon: _jsx(Clock3, { size: 18 }) }), _jsx(Metric, { label: "Average", value: attempts ? `${averageScore}%` : "—", note: "All attempts", icon: _jsx(BarChart3, { size: 18 }) })] }), _jsxs("section", { className: "section-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "YOUR LIBRARY" }), _jsx("h3", { children: "Continue studying" })] }), _jsxs("button", { className: "text-button", type: "button", onClick: () => onNavigate("library"), children: ["View all ", _jsx(ChevronRight, { size: 15 })] })] }), _jsxs("section", { className: "study-grid", children: [recent.map((set, index) => _jsx(StudyCard, { studySet: set, index: index, onOpen: onOpen }, set.id)), _jsxs("button", { className: "new-card", type: "button", onClick: onNew, children: [_jsx("span", { className: "new-icon", children: _jsx(Plus, { size: 22 }) }), _jsx("strong", { children: "Create a study set" }), _jsx("p", { children: "Upload a PDF, paste notes, or begin with your own questions." })] })] })] }));
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
function UploadView({ file, pasteSections, title, dragging, aiEnhanced, aiConfigured, ocrEnabled, recoveredFileName, error, fileInputRef, onFile, onUpdatePasteSection, onAddPasteSection, onRemovePasteSection, onTitle, onDragging, onAi, onOcr, onClearDraft, onCreate, onCancel }) {
    function acceptFile(candidate) {
        if (!candidate)
            return;
        const supported = candidate.type === "application/pdf" || candidate.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp)$/i.test(candidate.name);
        if (!supported)
            return;
        onFile(candidate);
        if (!title.trim())
            onTitle(stripExtension(candidate.name));
    }
    const completedSections = pasteSections.filter((section) => section.questions.trim().length >= 10).length;
    return (_jsxs("div", { className: "page-wrap upload-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "NEW STUDY SET" }), _jsx("h1", { children: "Create from your material" }), _jsx("p", { children: "Upload a PDF, paste questions and answers separately, or combine both sources." })] }), _jsx("button", { className: "ghost-button", type: "button", onClick: onCancel, children: "Cancel" })] }), recoveredFileName && !file && _jsxs("div", { className: "recovery-note", children: [_jsx(ArchiveRestore, { size: 18 }), _jsxs("span", { children: [_jsx("strong", { children: "Draft restored." }), " Paste content was recovered. For security, browsers cannot restore the previously selected file, so reselect \u201C", recoveredFileName, "\u201D if needed."] })] }), error && _jsxs("div", { className: "error-banner", children: [_jsx(X, { size: 18 }), _jsx("span", { children: error })] }), _jsxs("section", { className: "upload-layout", children: [_jsxs("div", { className: "upload-form-panel", children: [_jsx("label", { className: "field-label", htmlFor: "set-title", children: "Study set title" }), _jsx("input", { id: "set-title", className: "text-input", value: title, onChange: (event) => onTitle(event.target.value), placeholder: "Example: Biology Midterm Reviewer" }), _jsxs("div", { className: `drop-zone ${dragging ? "dragging" : ""}`, onDragOver: (event) => { event.preventDefault(); onDragging(true); }, onDragLeave: () => onDragging(false), onDrop: (event) => { event.preventDefault(); onDragging(false); acceptFile(event.dataTransfer.files?.[0]); }, children: [_jsx("input", { ref: fileInputRef, type: "file", accept: "application/pdf,.pdf,image/png,image/jpeg,image/webp", onChange: (event) => acceptFile(event.target.files?.[0]) }), _jsx("div", { className: "big-upload", children: _jsx(Upload, { size: 28 }) }), _jsx("h3", { children: file ? "Your file is ready" : "Drop a PDF or image here" }), _jsx("p", { children: "Text PDFs are fastest. Scanned PDFs, screenshots, and photos can be read with OCR." }), file && (_jsxs("div", { className: "file-selected", children: [_jsx("span", { className: "pdf", children: file.type.startsWith("image/") ? "IMG" : "PDF" }), _jsxs("span", { children: [_jsx("strong", { children: file.name }), _jsxs("small", { children: [Math.max(0.1, file.size / 1024 / 1024).toFixed(1), " MB \u00B7 Ready to analyze"] })] }), _jsx("button", { type: "button", "aria-label": "Remove PDF", onClick: () => onFile(null), children: _jsx(X, { size: 16 }) })] })), _jsx("button", { className: "secondary-button", type: "button", onClick: () => fileInputRef.current?.click(), children: file ? "Choose another file" : "Browse files" })] }), _jsx("div", { className: "or-divider", children: _jsx("span", { children: "or build from pasted content" }) }), _jsxs("div", { className: "paste-builder-heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "PASTE BUILDER" }), _jsx("h2", { children: "Questions and answers, kept separate." }), _jsx("p", { children: "Each section can hold one chapter, reviewer, or batch of questions. Add as many as you need." })] }), _jsxs("button", { className: "secondary-button add-section-top", type: "button", onClick: onAddPasteSection, children: [_jsx(Plus, { size: 17 }), " Add section"] })] }), _jsx("div", { className: "paste-section-list", children: pasteSections.map((section, index) => (_jsxs("article", { className: "paste-section-card", children: [_jsxs("div", { className: "paste-section-head", children: [_jsx("div", { className: "section-number", children: _jsx("span", { children: String(index + 1).padStart(2, "0") }) }), _jsxs("div", { children: [_jsxs("strong", { children: ["Paste section ", index + 1] }), _jsx("small", { children: section.questions.trim() ? "Content added" : "Waiting for questions" })] }), _jsx("button", { className: "remove-section-button", type: "button", "aria-label": `Remove paste section ${index + 1}`, onClick: () => onRemovePasteSection(section.id), children: _jsx(Trash2, { size: 16 }) })] }), _jsxs("label", { className: "field-label", htmlFor: `section-title-${section.id}`, children: ["Section title ", _jsx("span", { children: "optional" })] }), _jsx("input", { id: `section-title-${section.id}`, className: "text-input", value: section.title, onChange: (event) => onUpdatePasteSection(section.id, { title: event.target.value }), placeholder: "Example: Chapter 1 \u2014 Platform Basics" }), _jsxs("div", { className: "paste-columns", children: [_jsxs("label", { className: "paste-column", htmlFor: `questions-${section.id}`, children: [_jsxs("span", { className: "paste-column-title", children: [_jsx(CircleHelp, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: "Questions" }), _jsx("small", { children: "Include the choices under every question." })] })] }), _jsx("textarea", { id: `questions-${section.id}`, className: "paste-input paste-questions", value: section.questions, onChange: (event) => onUpdatePasteSection(section.id, { questions: event.target.value }), placeholder: `1. What is the capital of Japan?
A. Seoul
B. Tokyo
C. Beijing
D. Bangkok

2. Which...
A. ...
B. ...
C. ...
D. ...` })] }), _jsxs("label", { className: "paste-column", htmlFor: `answers-${section.id}`, children: [_jsxs("span", { className: "paste-column-title answer-title", children: [_jsx(Check, { size: 17 }), _jsxs("span", { children: [_jsx("strong", { children: "Answers" }), _jsx("small", { children: "Numbered or one answer per line both work." })] })] }), _jsx("textarea", { id: `answers-${section.id}`, className: "paste-input paste-answers", value: section.answers, onChange: (event) => onUpdatePasteSection(section.id, { answers: event.target.value }), placeholder: `1. B
2. D
3. A, C

Or simply:
B
D
A, C` })] })] }), _jsxs("div", { className: "paste-format-hints", children: [_jsxs("span", { children: [_jsx(Check, { size: 13 }), " A\u2013D choices supported"] }), _jsxs("span", { children: [_jsx(Check, { size: 13 }), " Choose-two/three supported"] }), _jsxs("span", { children: [_jsx(Check, { size: 13 }), " Answer-only lines auto-numbered"] })] })] }, section.id))) }), _jsxs("button", { className: "add-paste-section-button", type: "button", onClick: onAddPasteSection, children: [_jsx("span", { children: _jsx(Plus, { size: 20 }) }), _jsx("strong", { children: "Add another paste section" }), _jsx("small", { children: "Create another Questions + Answers pair" })] }), _jsxs("label", { className: "switch-row", children: [_jsxs("span", { children: [_jsx(ScanText, { size: 19 }), _jsxs("span", { children: [_jsx("strong", { children: "OCR for scans and photos" }), _jsx("small", { children: "Automatically reads pages with little or no selectable text. OCR is slower and requires an internet connection to load the OCR engine." })] })] }), _jsx("input", { type: "checkbox", checked: ocrEnabled, onChange: (event) => onOcr(event.target.checked) })] }), _jsxs("label", { className: `switch-row ${!aiConfigured ? "disabled" : ""}`, children: [_jsxs("span", { children: [_jsx(WandSparkles, { size: 19 }), _jsxs("span", { children: [_jsx("strong", { children: "AI-enhanced generation" }), _jsx("small", { children: aiConfigured ? "Generate stronger questions from ordinary notes." : "Add OPENAI_API_KEY to .env to enable this option." })] })] }), _jsx("input", { type: "checkbox", checked: aiEnhanced, disabled: !aiConfigured, onChange: (event) => onAi(event.target.checked) })] }), _jsxs("button", { className: "primary-button create-button", type: "button", onClick: onCreate, children: [_jsx(Sparkles, { size: 18 }), " Create study set ", _jsxs("span", { className: "create-count", children: [file ? "PDF" : completedSections || 0, file && completedSections ? ` + ${completedSections} section${completedSections === 1 ? "" : "s"}` : ""] }), _jsx(ChevronRight, { size: 17 })] }), _jsxs("p", { className: "privacy-note", children: [_jsx(Check, { size: 14 }), " Local mode keeps document text in your browser. AI mode sends extracted text to your configured server API."] })] }), _jsxs("aside", { className: "upload-side", children: [_jsx("p", { className: "eyebrow", children: "WHAT HAPPENS NEXT" }), _jsx("h2", { children: "Paste in batches without mixing your answers into the questions." }), _jsx("p", { children: "QuizForge parses every section independently, then combines them into one editable study set." }), _jsxs("div", { className: "feature-list", children: [_jsx(Feature, { number: "01", icon: _jsx(Image, { size: 18 }), title: "Upload or scan", text: "Use text PDFs, scanned PDFs, screenshots, or photos." }), _jsx(Feature, { number: "02", icon: _jsx(Check, { size: 18 }), title: "Add answer key", text: "Paste answers separately, even one letter per line." }), _jsx(Feature, { number: "03", icon: _jsx(Plus, { size: 18 }), title: "Add more sections", text: "Keep chapters and question batches organized." }), _jsx(Feature, { number: "04", icon: _jsx(BarChart3, { size: 18 }), title: "Review and practice", text: "Verify, shuffle, time, submit, and score." })] })] })] })] }));
}
function Feature({ number, icon, title, text }) {
    return _jsxs("div", { className: "feature-row", children: [_jsx("span", { className: "feature-number", children: number }), _jsx("span", { className: "feature-icon", children: icon }), _jsxs("div", { children: [_jsx("strong", { children: title }), _jsx("small", { children: text })] })] });
}
function ProcessingView({ fileName, progress, step, activeLabel }) {
    const steps = [
        { id: "read", label: activeLabel },
        { id: "detect", label: "Detecting questions and choices" },
        { id: "answers", label: "Matching correct answers" },
        { id: "finish", label: "Preparing the review screen" }
    ];
    const currentIndex = steps.findIndex((item) => item.id === step);
    return (_jsx("div", { className: "processing-page", children: _jsxs("section", { className: "processing-card", children: [_jsx("div", { className: "processor", children: _jsx(Sparkles, { size: 30 }) }), _jsxs("span", { className: "pill", children: [_jsx(WandSparkles, { size: 14 }), " BUILDING STUDY SET"] }), _jsx("h1", { children: "Turning your material into a mock exam" }), _jsx("p", { children: fileName }), _jsx("div", { className: "process-progress", children: _jsx("span", { style: { width: `${progress}%` } }) }), _jsxs("strong", { className: "progress-number", children: [progress, "%"] }), _jsx("div", { className: "process-list", children: steps.map((item, index) => (_jsxs("div", { className: `process-step ${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}`, children: [_jsx("span", { className: "step-dot", children: index < currentIndex ? _jsx(Check, { size: 15 }) : index + 1 }), _jsx("span", { children: item.label })] }, item.id))) })] }) }));
}
function ImportPreviewView({ pending, onToggle, onSelectMode, onUpdateQuestion, onUpdateAnswer, onBack, onConfirm }) {
    const [filter, setFilter] = useState("all");
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
    const filtered = pending.questions.filter((question) => {
        const issues = issuesByQuestion.get(question.id) ?? [];
        const matchesFilter = filter === "all" || (filter === "issues" && issues.length > 0) || (filter === "missing" && !isVerifiedQuestion(question));
        const haystack = `${question.question} ${question.topic ?? ""}`.toLowerCase();
        return matchesFilter && haystack.includes(query.toLowerCase());
    });
    const selected = new Set(pending.selectedIds);
    return (_jsxs("div", { className: "page-wrap import-preview-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "IMPORT PREVIEW" }), _jsx("h1", { children: "Check the import before saving" }), _jsx("p", { children: "QuizForge validates question structure, answer keys, duplicates, and suspicious choices before anything enters your library." })] }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button", type: "button", onClick: onBack, children: [_jsx(ChevronLeft, { size: 16 }), " Back"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirm, children: ["Add ", pending.selectedIds.length, " questions ", _jsx(ChevronRight, { size: 16 })] })] })] }), _jsxs("section", { className: "import-overview-grid", children: [_jsx(Metric, { label: "Prepared", value: pending.questions.length, note: `${pending.expected} detected in source`, icon: _jsx(Layers3, { size: 18 }) }), _jsx(Metric, { label: "Answers found", value: verifiedCount, note: `${pending.questions.length - verifiedCount} need an answer`, icon: _jsx(CheckCircle2, { size: 18 }) }), _jsx(Metric, { label: "Warnings", value: warningCount, note: "Review recommended", icon: _jsx(AlertTriangle, { size: 18 }) }), _jsx(Metric, { label: "Blocking issues", value: errorCount, note: "Fix or exclude", icon: _jsx(CircleHelp, { size: 18 }) })] }), (pending.parserWarnings.length > 0 || pending.issues.some((issue) => !issue.questionId)) && (_jsxs("section", { className: "import-global-notes", children: [_jsx(AlertTriangle, { size: 19 }), _jsxs("div", { children: [_jsx("strong", { children: "Source-level notes" }), [...pending.parserWarnings, ...pending.issues.filter((issue) => !issue.questionId).map((issue) => issue.message)].slice(0, 4).map((message) => _jsx("p", { children: message }, message))] })] })), _jsxs("section", { className: "import-toolbar card-surface", children: [_jsxs("label", { className: "search-box import-search", children: [_jsx(Search, { size: 17 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search questions or topics" })] }), _jsxs("div", { className: "segmented-control", "aria-label": "Import filters", children: [_jsx("button", { type: "button", className: filter === "all" ? "active" : "", onClick: () => setFilter("all"), children: "All" }), _jsx("button", { type: "button", className: filter === "issues" ? "active" : "", onClick: () => setFilter("issues"), children: "Has issues" }), _jsx("button", { type: "button", className: filter === "missing" ? "active" : "", onClick: () => setFilter("missing"), children: "Missing answers" })] }), _jsxs("div", { className: "toolbar import-select-actions", children: [_jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("all"), children: "Select all" }), _jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("clean"), children: "Select clean only" }), _jsx("button", { className: "text-button", type: "button", onClick: () => onSelectMode("none"), children: "Clear" })] })] }), _jsxs("section", { className: "import-question-list", children: [filtered.map((question, index) => {
                        const questionIssues = issuesByQuestion.get(question.id) ?? [];
                        const included = selected.has(question.id);
                        const correctIds = getCorrectIds(question);
                        return (_jsxs("article", { className: `import-question-card ${included ? "included" : "excluded"}`, children: [_jsxs("div", { className: "import-question-top", children: [_jsxs("label", { className: "include-check", children: [_jsx("input", { type: "checkbox", checked: included, onChange: () => onToggle(question.id) }), _jsx("span", { children: "Include" })] }), _jsxs("span", { className: "question-index", children: ["Question ", pending.questions.indexOf(question) + 1] }), _jsx("input", { className: "topic-input", value: question.topic ?? "General", onChange: (event) => onUpdateQuestion(question.id, { topic: event.target.value }), "aria-label": `Topic for question ${index + 1}` }), _jsx("span", { className: `status ${isVerifiedQuestion(question) ? "ready" : "draft"}`, children: isVerifiedQuestion(question) ? "Answer ready" : "Needs answer" })] }), _jsx("textarea", { className: "import-question-text", value: question.question, onChange: (event) => onUpdateQuestion(question.id, { question: event.target.value }) }), _jsx("div", { className: "import-option-grid", children: question.options.map((option, optionIndex) => {
                                        const correct = correctIds.includes(option.id);
                                        return _jsxs("button", { type: "button", className: `import-option ${correct ? "correct" : ""}`, onClick: () => onUpdateAnswer(question.id, option.id), children: [_jsx("span", { children: String.fromCharCode(65 + optionIndex) }), _jsx("b", { children: option.text }), correct && _jsx(Check, { size: 15 })] }, option.id);
                                    }) }), questionIssues.length > 0 ? _jsx("div", { className: "question-issue-list", children: questionIssues.map((issue) => _jsxs("div", { className: `question-issue ${issue.severity}`, children: [issue.severity === "error" ? _jsx(CircleHelp, { size: 14 }) : _jsx(AlertTriangle, { size: 14 }), _jsxs("span", { children: [_jsx("strong", { children: issue.title }), issue.message] })] }, issue.id)) }) : _jsxs("div", { className: "question-clean", children: [_jsx(CheckCircle2, { size: 15 }), " Structure looks good"] })] }, question.id));
                    }), !filtered.length && _jsxs("div", { className: "empty-state", children: [_jsx(Filter, { size: 34 }), _jsx("strong", { children: "No questions match this filter" }), _jsx("p", { children: "Try a different filter or search term." })] })] }), _jsxs("div", { className: "sticky-import-footer", children: [_jsxs("span", { children: [_jsx("strong", { children: pending.selectedIds.length }), " of ", pending.questions.length, " questions selected"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirm, children: ["Save to library ", _jsx(ChevronRight, { size: 16 })] })] })] }));
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
    return (_jsxs("div", { className: "page-wrap editor-page", children: [_jsxs("div", { className: "page-head", children: [_jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onDashboard, children: "Dashboard" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Review questions" }), _jsx("h1", { children: "Review extracted questions" }), _jsx("p", { children: "Search, filter, edit, and update several questions at once." })] }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button danger-ghost", type: "button", onClick: () => onDeleteSet(studySet.id), children: [_jsx(Trash2, { size: 16 }), " Delete set"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: onSetup, children: ["Set up exam ", _jsx(ChevronRight, { size: 16 })] })] })] }), _jsxs("section", { className: "bulk-editor-toolbar", children: [_jsxs("label", { className: "search-box bulk-search", children: [_jsx(Search, { size: 17 }), _jsx("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search question text or topic" })] }), _jsxs("select", { value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), "aria-label": "Filter by status", children: [_jsx("option", { value: "all", children: "All statuses" }), _jsx("option", { value: "verified", children: "Verified" }), _jsx("option", { value: "review", children: "Needs review" })] }), _jsxs("select", { value: topicFilter, onChange: (event) => setTopicFilter(event.target.value), "aria-label": "Filter by topic", children: [_jsx("option", { children: "All topics" }), topics.map((topic) => _jsx("option", { children: topic }, topic))] }), _jsx("button", { className: "secondary-button compact", type: "button", onClick: toggleAllVisible, children: allVisibleSelected ? "Clear visible" : "Select visible" })] }), selectedIds.length > 0 && (_jsxs("section", { className: "bulk-action-bar", children: [_jsxs("div", { children: [_jsx("span", { className: "bulk-count", children: selectedIds.length }), _jsx("strong", { children: "questions selected" }), _jsx("button", { className: "text-button", type: "button", onClick: clearSelection, children: "Clear" })] }), _jsxs("div", { className: "bulk-actions", children: [_jsxs("button", { className: "secondary-button compact", type: "button", onClick: () => onBulkStatus(selectedIds, "verified"), children: [_jsx(CheckCircle2, { size: 15 }), " Check answers"] }), _jsxs("button", { className: "secondary-button compact", type: "button", onClick: () => onBulkStatus(selectedIds, "review"), children: [_jsx(CircleHelp, { size: 15 }), " Mark review"] }), _jsxs("label", { className: "bulk-topic-control", children: [_jsx(Tag, { size: 15 }), _jsx("input", { value: bulkTopic, onChange: (event) => setBulkTopic(event.target.value), placeholder: "Topic" }), _jsx("button", { type: "button", onClick: () => onBulkTopic(selectedIds, bulkTopic.trim() || "General"), children: "Apply" })] }), _jsxs("button", { className: "ghost-button danger-ghost compact", type: "button", onClick: () => { onBulkDelete(selectedIds); clearSelection(); }, children: [_jsx(Trash2, { size: 15 }), " Delete"] })] })] })), _jsxs("div", { className: "editor-layout", children: [_jsxs("aside", { className: "editor-sidebar", children: [_jsxs("div", { className: "set-summary", children: [_jsx("div", { className: "set-file-icon", children: _jsx(FileText, { size: 21 }) }), _jsx("strong", { children: studySet.title }), _jsx("span", { children: studySet.sourceName }), _jsxs("div", { className: "summary-grid", children: [_jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: verified }), _jsx("small", { children: "Verified" })] }), _jsxs("div", { children: [_jsx("strong", { children: studySet.questions.length - verified }), _jsx("small", { children: "Review" })] })] })] }), _jsxs("div", { className: "question-list filtered-list", children: [filteredQuestions.map((item) => {
                                        const itemIndex = studySet.questions.indexOf(item);
                                        const itemCorrectIds = getCorrectIds(item);
                                        return (_jsxs("div", { className: `question-list-row ${item.id === question.id ? "active" : ""} ${item.status === "review" ? "warn" : ""}`, children: [_jsx("label", { className: "question-select", children: _jsx("input", { type: "checkbox", checked: selectedSet.has(item.id), onChange: () => toggleSelected(item.id), "aria-label": `Select question ${itemIndex + 1}` }) }), _jsxs("button", { className: "question-open", type: "button", onClick: () => onSelect(item.id), children: [_jsx("span", { children: itemIndex + 1 }), _jsxs("span", { className: "question-list-copy", children: [_jsx("b", { children: item.question }), _jsx("small", { children: item.topic ?? "General" })] }), isVerifiedQuestion(item) ? _jsx(Check, { size: 14 }) : _jsx(CircleHelp, { size: 14 })] }), _jsx("div", { className: "quick-answer-key", "aria-label": `Quick answer key for question ${itemIndex + 1}`, children: item.options.map((option, optionIndex) => _jsx("button", { type: "button", className: itemCorrectIds.includes(option.id) ? "selected" : "", onClick: () => onMarkCorrect(item.id, option.id), children: String.fromCharCode(65 + optionIndex) }, option.id)) })] }, item.id));
                                    }), !filteredQuestions.length && _jsxs("div", { className: "question-list-empty", children: [_jsx(Filter, { size: 22 }), _jsx("span", { children: "No matching questions" })] })] }), _jsxs("button", { className: "ghost-button full-button", type: "button", onClick: onAddQuestion, children: [_jsx(Plus, { size: 16 }), " Add question"] })] }), _jsxs("section", { className: "question-editor-card", children: [_jsxs("div", { className: "editor-card-head", children: [_jsxs("div", { children: [_jsxs("div", { className: "editor-status-line", children: [_jsx("span", { className: `status ${ready ? "ready" : "draft"}`, children: ready ? `${correctIds.length} answer${correctIds.length === 1 ? "" : "s"} verified` : "Needs review" }), question.sourcePage && _jsxs("span", { className: "page-chip", children: ["Page ", question.sourcePage] }), _jsxs("span", { className: "page-chip topic-chip", children: [_jsx(Tag, { size: 11 }), " ", question.topic ?? "General"] })] }), _jsxs("h2", { children: ["Question ", index + 1] }), _jsx("p", { children: multiple ? "This is a multiple-answer question. Select every correct choice." : ready ? "The detected answer is selected. You can still change it." : "Select the correct option before using this question in an exam." })] }), _jsxs("div", { className: "editor-actions", children: [_jsx("button", { className: "icon-button", type: "button", title: "Duplicate", onClick: () => onDuplicate(question.id), children: _jsx(Copy, { size: 17 }) }), _jsx("button", { className: "icon-button danger-icon", type: "button", title: "Delete", onClick: () => onDelete(question.id), children: _jsx(Trash2, { size: 17 }) })] })] }), _jsxs("div", { className: "editor-meta-grid", children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-topic", children: "Topic" }), _jsx("input", { id: "question-topic", className: "text-input", value: question.topic ?? "General", onChange: (event) => onUpdateQuestion(question.id, { topic: event.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-status", children: "Review status" }), _jsxs("select", { id: "question-status", className: "text-input", value: question.status, onChange: (event) => onUpdateQuestion(question.id, { status: event.target.value }), children: [_jsx("option", { value: "verified", disabled: !answerReady, children: "Verified" }), _jsx("option", { value: "review", children: "Needs review" })] })] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "question-text", children: "Question" }), _jsx("textarea", { id: "question-text", className: "question-input", value: question.question, onChange: (event) => onUpdateQuestion(question.id, { question: event.target.value }) })] }), _jsxs("div", { className: "form-group", children: [_jsxs("div", { className: "label-row answer-heading", children: [_jsxs("div", { children: [_jsx("label", { children: "Answer choices" }), _jsx("small", { children: multiple ? "Check all correct answers." : "Choose one correct answer." })] }), _jsxs("select", { className: "answer-mode-select", "aria-label": "Answer selection mode", value: multiple ? "multiple" : "single", onChange: (event) => onSelectionMode(question.id, event.target.value), children: [_jsx("option", { value: "single", children: "Single answer" }), _jsx("option", { value: "multiple", children: "Multiple answers" })] })] }), _jsx("div", { className: "answer-grid", children: question.options.map((option, optionIndex) => {
                                            const selected = correctIds.includes(option.id);
                                            return _jsxs("div", { className: `answer-row ${selected ? "correct" : ""}`, children: [_jsx(GripVertical, { className: "drag-handle", size: 17 }), _jsx("span", { className: "answer-letter", children: String.fromCharCode(65 + optionIndex) }), _jsx("input", { value: option.text, onChange: (event) => onUpdateOption(question.id, option.id, event.target.value), "aria-label": `Answer ${String.fromCharCode(65 + optionIndex)}` }), _jsx("button", { className: `correct-radio ${selected ? "selected" : ""}`, type: "button", title: selected ? "Correct answer selected" : "Mark as correct", onClick: () => onMarkCorrect(question.id, option.id), children: _jsx(Check, { size: 16 }) }), _jsx("button", { className: "remove-option", type: "button", title: "Remove option", onClick: () => onRemoveOption(question.id, option.id), children: _jsx(X, { size: 15 }) })] }, option.id);
                                        }) }), _jsxs("button", { className: "text-button add-option", type: "button", onClick: () => onAddOption(question.id), children: [_jsx(Plus, { size: 15 }), " Add answer choice"] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "explanation", children: "Explanation" }), _jsx("textarea", { id: "explanation", className: "explanation-input", value: question.explanation, onChange: (event) => onUpdateQuestion(question.id, { explanation: event.target.value }), placeholder: "Explain why the selected answer is correct." })] }), _jsxs("div", { className: "editor-footer", children: [_jsx("span", { children: "Changes save automatically in this browser." }), _jsxs("div", { className: "toolbar", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: !previous, onClick: () => previous && onSelect(previous.id), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), _jsxs("button", { className: "primary-button", type: "button", onClick: () => next ? onSelect(next.id) : onSetup, children: [next ? "Next question" : "Set up exam", _jsx(ChevronRight, { size: 16 })] })] })] })] }, question.id)] })] }));
}
function SetupView({ studySet, settings, onSettings, onBack, onStart }) {
    const verified = studySet.questions.filter(isVerifiedQuestion);
    const topics = availableTopics(verified);
    const weak = weakTopics(studySet.attempts);
    const filtered = verified.filter((question) => {
        const topicMatch = !settings.topicFilter || settings.topicFilter === "All topics" || (question.topic ?? "General") === settings.topicFilter;
        const weakMatch = !settings.weakAreasOnly || weak.length === 0 || weak.includes(question.topic ?? "General");
        return topicMatch && weakMatch;
    });
    const preview = filtered[0] ?? verified[0];
    const update = (key, value) => onSettings({ ...settings, [key]: value });
    const maxQuestions = Math.max(1, filtered.length);
    const selectedCount = Math.min(settings.questionCount, maxQuestions);
    return (_jsxs("div", { className: "page-wrap setup-page", children: [_jsx("div", { className: "page-head", children: _jsxs("div", { children: [_jsx("button", { className: "breadcrumb-button", type: "button", onClick: onBack, children: "Review questions" }), _jsx("span", { className: "breadcrumb-separator", children: "/" }), _jsx("span", { children: "Exam setup" }), _jsx("h1", { children: "Customize your mock exam" }), _jsx("p", { children: "Choose topics, weak areas, question count, timing, and randomization." })] }) }), _jsxs("div", { className: "setup-grid", children: [_jsxs("section", { className: "setup-panel", children: [_jsx("h2", { children: "Exam preferences" }), _jsx("p", { children: "These settings apply only to the next attempt." }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Topic" }), _jsx("small", { children: "Practice the whole set or focus on one topic." })] }), _jsxs("select", { value: settings.topicFilter ?? "All topics", onChange: (event) => { update("topicFilter", event.target.value); onSettings({ ...settings, topicFilter: event.target.value, questionCount: Math.min(settings.questionCount, verified.filter((q) => event.target.value === "All topics" || (q.topic ?? "General") === event.target.value).length || 1) }); }, children: [_jsx("option", { children: "All topics" }), topics.map((topic) => _jsx("option", { children: topic }, topic))] })] }), _jsx(ToggleSetting, { label: "Focus on weak areas", description: weak.length ? `Prioritize ${weak.join(", ")}.` : "Completing a few attempts will identify weak topics.", checked: Boolean(settings.weakAreasOnly), onChange: (value) => update("weakAreasOnly", value) }), _jsxs("div", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Number of questions" }), _jsxs("small", { children: [filtered.length, " verified questions match your filters."] })] }), _jsx("select", { value: selectedCount, onChange: (event) => update("questionCount", Number(event.target.value)), children: Array.from({ length: maxQuestions }, (_, index) => index + 1).filter((value) => value === maxQuestions || value % 5 === 0 || value === 1).map((value) => _jsx("option", { value: value, children: value }, value)) })] }), _jsx(ToggleSetting, { label: "Shuffle questions", description: "Use a different question order for every attempt.", checked: settings.shuffleQuestions, onChange: (value) => update("shuffleQuestions", value) }), _jsx(ToggleSetting, { label: "Shuffle answer choices", description: "Randomize the choice order without changing the answer key.", checked: settings.shuffleAnswers, onChange: (value) => update("shuffleAnswers", value) }), _jsx(ToggleSetting, { label: "Timed exam", description: "Show a countdown while answering.", checked: settings.timed, onChange: (value) => update("timed", value) }), _jsxs("div", { className: `setting-row ${!settings.timed ? "disabled-setting" : ""}`, children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: "Time limit" }), _jsx("small", { children: "Select the exam duration." })] }), _jsx("select", { disabled: !settings.timed, value: settings.minutes, onChange: (event) => update("minutes", Number(event.target.value)), children: [5, 10, 20, 30, 45, 60, 90].map((value) => _jsxs("option", { value: value, children: [value, " minutes"] }, value)) })] }), _jsx(ToggleSetting, { label: "Show explanations", description: "Display explanations in the answer review.", checked: settings.showExplanations, onChange: (value) => update("showExplanations", value) })] }), _jsxs("aside", { className: "preview-panel", children: [_jsxs("div", { className: "preview-header", children: [_jsxs("span", { className: "pill", children: [_jsx(Target, { size: 13 }), " EXAM PREVIEW"] }), _jsx("h2", { children: studySet.title }), _jsx("p", { children: settings.weakAreasOnly && weak.length ? `Weak-area mode: ${weak.join(", ")}` : settings.topicFilter && settings.topicFilter !== "All topics" ? settings.topicFilter : "Mixed-topic practice" })] }), preview && _jsxs("div", { className: "exam-preview-card", children: [_jsx("span", { children: isMultipleQuestion(preview) ? "MULTIPLE ANSWERS" : "QUESTION 01" }), _jsx("h3", { children: preview.question }), preview.options.slice(0, 3).map((option, index) => _jsxs("div", { className: "mini-answer", children: [_jsx("span", { children: String.fromCharCode(65 + index) }), option.text] }, option.id))] }), _jsxs("div", { className: "exam-details", children: [_jsxs("div", { children: [_jsx("strong", { children: Math.min(settings.questionCount, filtered.length) }), _jsx("small", { children: "Questions" })] }), _jsxs("div", { children: [_jsx("strong", { children: settings.timed ? `${settings.minutes}m` : "∞" }), _jsx("small", { children: "Time limit" })] }), _jsxs("div", { children: [_jsx("strong", { children: filtered.length ? new Set(filtered.map((q) => q.topic ?? "General")).size : 0 }), _jsx("small", { children: "Topics" })] })] }), _jsxs("button", { className: "primary-button start-button", type: "button", disabled: !filtered.length, onClick: onStart, children: ["Start mock exam ", _jsx(ChevronRight, { size: 17 })] })] })] })] }));
}
function ToggleSetting({ label, description, checked, onChange }) {
    return _jsxs("label", { className: "setting-row", children: [_jsxs("div", { className: "setting-copy", children: [_jsx("strong", { children: label }), _jsx("small", { children: description })] }), _jsx("input", { className: "switch-input", type: "checkbox", checked: checked, onChange: (event) => onChange(event.target.checked) })] });
}
function ExamView({ exam, settings, onAnswer, onFlag, onMove, onSubmit, reviewOpen, onCloseReview, onConfirmSubmit }) {
    const [navFilter, setNavFilter] = useState("all");
    if (!exam)
        return null;
    const question = exam.questions[exam.currentIndex];
    const selected = exam.responses[question.id] ?? [];
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
    const visibleQuestions = exam.questions.map((item, index) => ({ item, index, status: statusFor(item) })).filter(({ status }) => navFilter === "all" || status[navFilter]);
    const multiple = isMultipleQuestion(question);
    const expectedSelections = Math.max(2, getCorrectIds(question).length);
    return (_jsxs("div", { className: "exam-shell", children: [_jsxs("header", { className: "exam-topbar", children: [_jsxs("div", { className: "exam-brand", children: [_jsx("span", { className: "brand-mark", children: "Q" }), _jsxs("span", { children: [_jsx("strong", { children: "QuizForge Exam" }), _jsx("small", { children: question.topic ?? "Practice mode" })] })] }), _jsxs("div", { className: "exam-meta", children: [_jsxs("div", { className: "autosave-status", children: [_jsx(CheckCircle2, { size: 15 }), _jsx("span", { children: "Saved" })] }), _jsxs("div", { className: "timer", children: [_jsx(Clock3, { size: 17 }), _jsx("span", { children: settings.timed ? formatDuration(exam.remainingSeconds) : "Untimed" }), _jsx("small", { children: settings.timed ? "remaining" : "no limit" })] }), _jsx("button", { className: "primary-button compact", type: "button", onClick: onSubmit, children: "Review & submit" })] })] }), _jsxs("div", { className: "exam-body", children: [_jsxs("aside", { className: "exam-nav", children: [_jsx("h2", { children: "Question navigator" }), _jsxs("p", { children: [counts.answered, " complete \u00B7 ", counts.unanswered, " unanswered"] }), _jsxs("div", { className: "exam-nav-filters", children: [_jsxs("button", { type: "button", className: navFilter === "all" ? "active" : "", onClick: () => setNavFilter("all"), children: ["All ", _jsx("span", { children: exam.questions.length })] }), _jsxs("button", { type: "button", className: navFilter === "unanswered" ? "active" : "", onClick: () => setNavFilter("unanswered"), children: ["Unanswered ", _jsx("span", { children: counts.unanswered })] }), _jsxs("button", { type: "button", className: navFilter === "incomplete" ? "active" : "", onClick: () => setNavFilter("incomplete"), children: ["Incomplete ", _jsx("span", { children: counts.incomplete })] }), _jsxs("button", { type: "button", className: navFilter === "flagged" ? "active" : "", onClick: () => setNavFilter("flagged"), children: ["Flagged ", _jsx("span", { children: counts.flagged })] }), _jsxs("button", { type: "button", className: navFilter === "answered" ? "active" : "", onClick: () => setNavFilter("answered"), children: ["Complete ", _jsx("span", { children: counts.answered })] })] }), _jsx("div", { className: "question-dots", children: visibleQuestions.map(({ item, index, status }) => _jsx("button", { type: "button", className: `question-dot ${index === exam.currentIndex ? "current" : status.answered ? "answered" : ""} ${status.incomplete ? "incomplete" : ""} ${status.flagged ? "flagged" : ""}`, onClick: () => onMove(index), children: index + 1 }, item.id)) }), !visibleQuestions.length && _jsx("div", { className: "nav-empty", children: "No questions in this filter." }), _jsxs("div", { className: "exam-legend", children: [_jsxs("span", { children: [_jsx("i", { className: "legend-current" }), " Current"] }), _jsxs("span", { children: [_jsx("i", { className: "legend-answered" }), " Complete"] }), _jsxs("span", { children: [_jsx("i", { className: "legend-incomplete" }), " Incomplete"] }), _jsxs("span", { children: [_jsx("i", { className: "legend-flagged" }), " Flagged"] }), _jsxs("span", { children: [_jsx("i", {}), " Unanswered"] })] })] }), _jsxs("main", { className: "exam-main", children: [_jsxs("div", { className: "exam-progress", children: [_jsxs("span", { children: ["Question ", exam.currentIndex + 1, " of ", exam.questions.length] }), _jsxs("span", { children: [Math.round(((exam.currentIndex + 1) / exam.questions.length) * 100), "%"] })] }), _jsx("div", { className: "exam-progress-track", children: _jsx("span", { style: { width: `${((exam.currentIndex + 1) / exam.questions.length) * 100}%` } }) }), _jsxs("section", { className: "exam-question-card", children: [_jsxs("div", { className: "question-kicker", children: [_jsxs("span", { children: [multiple ? "MULTIPLE ANSWERS" : "MULTIPLE CHOICE", " \u00B7 ", question.topic ?? "General"] }), _jsxs("button", { className: `flag-button ${exam.flagged[question.id] ? "flagged" : ""}`, type: "button", onClick: onFlag, children: [_jsx(Flag, { size: 15 }), " ", exam.flagged[question.id] ? "Flagged" : "Flag for review"] })] }), _jsx("h1", { children: question.question }), multiple && _jsxs("div", { className: "selection-hint", children: [_jsx(Sparkles, { size: 15 }), _jsxs("span", { children: ["Select all correct answers", getCorrectIds(question).length > 1 ? ` (${expectedSelections} expected)` : "", "."] })] }), _jsx("div", { className: "exam-options", children: question.options.map((option, index) => {
                                            const isSelected = selected.includes(option.id);
                                            return _jsxs("button", { className: `exam-option ${isSelected ? "selected" : ""}`, type: "button", onClick: () => onAnswer(option.id), children: [_jsx("span", { className: "option-letter", children: String.fromCharCode(65 + index) }), _jsx("span", { children: option.text }), isSelected && _jsx("span", { className: "option-check", children: _jsx(Check, { size: 18 }) })] }, option.id);
                                        }) }), _jsxs("div", { className: "exam-footer", children: [_jsxs("button", { className: "ghost-button", type: "button", disabled: exam.currentIndex === 0, onClick: () => onMove(exam.currentIndex - 1), children: [_jsx(ChevronLeft, { size: 16 }), " Previous"] }), exam.currentIndex < exam.questions.length - 1 ? _jsxs("button", { className: "primary-button", type: "button", onClick: () => onMove(exam.currentIndex + 1), children: ["Next question ", _jsx(ChevronRight, { size: 16 })] }) : _jsxs("button", { className: "primary-button", type: "button", onClick: onSubmit, children: ["Review exam ", _jsx(Check, { size: 16 })] })] })] }, question.id)] })] }), reviewOpen && _jsx("div", { className: "modal-backdrop exam-review-backdrop", children: _jsxs("section", { className: "submit-review-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "submit-review-title", children: [_jsx("button", { className: "modal-close", type: "button", "aria-label": "Close review", onClick: onCloseReview, children: _jsx(X, { size: 18 }) }), _jsx("span", { className: "modal-success-orb review-orb", children: _jsx(ListFilter, { size: 28 }) }), _jsx("p", { className: "eyebrow", children: "FINAL REVIEW" }), _jsx("h2", { id: "submit-review-title", children: "Ready to submit?" }), _jsx("p", { children: "Check unanswered, incomplete, and flagged questions before your answers are scored." }), _jsxs("div", { className: "submit-review-stats", children: [_jsxs("button", { type: "button", onClick: () => { setNavFilter("unanswered"); onCloseReview(); }, children: [_jsx("strong", { children: counts.unanswered }), _jsx("small", { children: "Unanswered" })] }), _jsxs("button", { type: "button", onClick: () => { setNavFilter("incomplete"); onCloseReview(); }, children: [_jsx("strong", { children: counts.incomplete }), _jsx("small", { children: "Incomplete" })] }), _jsxs("button", { type: "button", onClick: () => { setNavFilter("flagged"); onCloseReview(); }, children: [_jsx("strong", { children: counts.flagged }), _jsx("small", { children: "Flagged" })] }), _jsxs("div", { children: [_jsx("strong", { children: counts.answered }), _jsx("small", { children: "Complete" })] })] }), _jsx("div", { className: "submit-question-grid", children: exam.questions.map((item, index) => { const status = statusFor(item); return _jsx("button", { type: "button", className: `${status.answered ? "complete" : status.incomplete ? "incomplete" : "unanswered"} ${status.flagged ? "flagged" : ""}`, onClick: () => { onMove(index); onCloseReview(); }, children: index + 1 }, item.id); }) }), _jsxs("div", { className: "submit-review-actions", children: [_jsx("button", { className: "ghost-button", type: "button", onClick: onCloseReview, children: "Return to exam" }), _jsxs("button", { className: "primary-button", type: "button", onClick: onConfirmSubmit, children: ["Submit now ", _jsx(Check, { size: 16 })] })] })] }) })] }));
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
