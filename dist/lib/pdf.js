import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
/**
 * Extracts readable lines and adds parser markers:
 * [[PAGE n]] identifies page boundaries and [[CORRECT]] identifies answer labels
 * rendered in red. Scanned or image-only pages can optionally fall back to OCR.
 */
export async function extractPdfText(file, onProgress, options = {}) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: true });
        const items = content.items.filter((item) => typeof item.str === "string");
        const redItems = await detectRedAnswerLabels(page, items);
        let lines = itemsToLines(items, redItems);
        const readableLength = lines.join(" ").replace(/\s/g, "").length;
        const shouldOcr = Boolean(options.forceOcr || (options.enableOcr && readableLength < 45));
        if (shouldOcr) {
            const ocrText = await ocrPdfPage(page, (pageProgress) => {
                const completed = pageNumber - 1;
                const combined = ((completed + pageProgress) / pdf.numPages) * 100;
                onProgress?.({ progress: Math.round(combined), stage: "ocr", page: pageNumber, totalPages: pdf.numPages });
            });
            if (ocrText.trim().length > readableLength) {
                lines = ocrText.replace(/\r/g, "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
            }
        }
        pages.push(`[[PAGE ${pageNumber}]]\n${lines.join("\n")}`);
        onProgress?.({ progress: Math.round((pageNumber / pdf.numPages) * 100), stage: shouldOcr ? "ocr" : "text", page: pageNumber, totalPages: pdf.numPages });
    }
    return pages.join("\n\n");
}
export async function extractImageText(file, onProgress) {
    const text = await runOcr(file, (value) => onProgress?.({ progress: Math.round(value * 100), stage: "ocr", page: 1, totalPages: 1 }));
    return `[[PAGE 1]]\n${text}`;
}
async function ocrPdfPage(page, onProgress) {
    const viewport = page.getViewport({ scale: 2.1 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("OCR could not create a page image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
    return runOcr(canvas, onProgress);
}
async function runOcr(image, onProgress) {
    const engine = window.Tesseract;
    if (!engine) {
        throw new Error("OCR could not load. Check your internet connection, refresh the page, and try again.");
    }
    const result = await engine.recognize(image, "eng", {
        logger: (message) => {
            if (typeof message.progress === "number")
                onProgress?.(message.progress);
        }
    });
    return result.data?.text?.trim() ?? "";
}
async function detectRedAnswerLabels(page, items) {
    const matches = new Set();
    if (typeof document === "undefined")
        return matches;
    const candidateIndexes = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => /^\s*[A-H]\s*[).:-]/i.test(String(item.str ?? "")) || /^\s*[A-H]\s*$/i.test(String(item.str ?? "")));
    if (!candidateIndexes.length)
        return matches;
    try {
        const scale = 1.6;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context)
            return matches;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
        for (const { item, index } of candidateIndexes) {
            if (hasRedPixels(item, viewport, context, canvas.width, canvas.height))
                matches.add(index);
        }
    }
    catch {
        // Text extraction should still succeed if a browser cannot render a page.
    }
    return matches;
}
function hasRedPixels(item, viewport, context, canvasWidth, canvasHeight) {
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const tx = pdfjsLib.Util.transform(viewport.transform, transform);
    const fontHeight = Math.max(8, Math.hypot(tx[2], tx[3]));
    const estimatedWidth = Math.max(10, Number(item.width ?? 10) * viewport.scale);
    const x = Math.max(0, Math.floor(tx[4] - 3));
    const y = Math.max(0, Math.floor(tx[5] - fontHeight - 4));
    const width = Math.max(1, Math.min(canvasWidth - x, Math.ceil(Math.min(estimatedWidth + 8, 90))));
    const height = Math.max(1, Math.min(canvasHeight - y, Math.ceil(fontHeight + 9)));
    if (width <= 0 || height <= 0)
        return false;
    const pixels = context.getImageData(x, y, width, height).data;
    let redPixels = 0;
    let coloredPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        if (alpha < 30 || (red > 242 && green > 242 && blue > 242))
            continue;
        coloredPixels += 1;
        if (red > 145 && red > green * 1.35 && red > blue * 1.35)
            redPixels += 1;
    }
    return redPixels >= 3 && redPixels / Math.max(1, coloredPixels) > 0.025;
}
function itemsToLines(items, redItems) {
    const rows = [];
    items.forEach((item, index) => {
        const text = String(item.str ?? "").trim();
        if (!text)
            return;
        const x = Number(item.transform?.[4] ?? 0);
        const y = Number(item.transform?.[5] ?? 0);
        let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5);
        if (!row) {
            row = { y, entries: [] };
            rows.push(row);
        }
        row.entries.push({ x, text, width: Number(item.width ?? 0), correct: redItems.has(index) });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map((row) => {
        row.entries.sort((a, b) => a.x - b.x);
        let line = "";
        let previousEnd = 0;
        let correct = false;
        row.entries.forEach((entry, index) => {
            if (index > 0 && entry.x - previousEnd > 1.5)
                line += " ";
            line += entry.text;
            previousEnd = entry.x + Math.max(entry.width, entry.text.length * 3.2);
            correct = correct || entry.correct;
        });
        const cleaned = line.replace(/\s+/g, " ").trim();
        if (correct && /^\s*[A-H]\s*[).:-]/i.test(cleaned))
            return `[[CORRECT]] ${cleaned}`;
        return cleaned;
    }).filter(Boolean);
}
