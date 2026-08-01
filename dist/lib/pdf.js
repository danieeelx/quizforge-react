import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
export async function extractPdfText(file, onProgress) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(itemsToLines(content.items).join("\n"));
        onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
    }
    return pages.join("\n\n");
}
function itemsToLines(items) {
    const rows = [];
    for (const item of items) {
        const text = String(item.str ?? "").trim();
        if (!text)
            continue;
        const x = Number(item.transform?.[4] ?? 0);
        const y = Number(item.transform?.[5] ?? 0);
        let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5);
        if (!row) {
            row = { y, entries: [] };
            rows.push(row);
        }
        row.entries.push({ x, text, width: Number(item.width ?? 0) });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((row) => {
        row.entries.sort((a, b) => a.x - b.x);
        let line = "";
        let previousEnd = 0;
        row.entries.forEach((entry, index) => {
            if (index > 0 && entry.x - previousEnd > 2)
                line += " ";
            line += entry.text;
            previousEnd = entry.x + Math.max(entry.width, entry.text.length * 4);
        });
        return line.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
}
