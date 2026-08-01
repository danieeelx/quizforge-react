import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface PositionedEntry {
  x: number;
  text: string;
  width: number;
  correct: boolean;
}

/**
 * Extracts readable lines and adds two invisible parser markers:
 * [[PAGE n]] identifies page boundaries and [[CORRECT]] identifies options
 * whose A/B/C label is rendered in red. The latter is common in reviewer PDFs.
 */
export async function extractPdfText(file: File, onProgress?: (progress: number) => void): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: true });
    const items = (content.items as TextItemLike[]).filter((item) => typeof item.str === "string");
    const redItems = await detectRedAnswerLabels(page, items);
    const lines = itemsToLines(items, redItems);
    pages.push(`[[PAGE ${pageNumber}]]\n${lines.join("\n")}`);
    onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
  }
  return pages.join("\n\n");
}

async function detectRedAnswerLabels(page: any, items: TextItemLike[]): Promise<Set<number>> {
  const matches = new Set<number>();
  if (typeof document === "undefined") return matches;

  // Only render when option-like text exists. This avoids unnecessary canvas work
  // for ordinary notes that do not contain a question bank.
  const candidateIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => /^\s*[A-H]\s*[).:-]/i.test(String(item.str ?? "")) || /^\s*[A-H]\s*$/i.test(String(item.str ?? "")));
  if (!candidateIndexes.length) return matches;

  try {
    const scale = 1.6;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return matches;

    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    await page.render({ canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;

    for (const { item, index } of candidateIndexes) {
      if (hasRedPixels(item, viewport, context, canvas.width, canvas.height)) matches.add(index);
    }
  } catch {
    // Text extraction should still succeed if a browser cannot render a page.
  }
  return matches;
}

function hasRedPixels(
  item: TextItemLike,
  viewport: any,
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
  const tx = pdfjsLib.Util.transform(viewport.transform, transform);
  const fontHeight = Math.max(8, Math.hypot(tx[2], tx[3]));
  const estimatedWidth = Math.max(10, Number(item.width ?? 10) * viewport.scale);
  const x = Math.max(0, Math.floor(tx[4] - 3));
  const y = Math.max(0, Math.floor(tx[5] - fontHeight - 4));
  const width = Math.max(1, Math.min(canvasWidth - x, Math.ceil(Math.min(estimatedWidth + 8, 90))));
  const height = Math.max(1, Math.min(canvasHeight - y, Math.ceil(fontHeight + 9)));
  if (width <= 0 || height <= 0) return false;

  const pixels = context.getImageData(x, y, width, height).data;
  let redPixels = 0;
  let coloredPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const alpha = pixels[offset + 3];
    if (alpha < 30 || (red > 242 && green > 242 && blue > 242)) continue;
    coloredPixels += 1;
    if (red > 145 && red > green * 1.35 && red > blue * 1.35) redPixels += 1;
  }
  return redPixels >= 3 && redPixels / Math.max(1, coloredPixels) > 0.025;
}

function itemsToLines(items: TextItemLike[], redItems: Set<number>): string[] {
  const rows: Array<{ y: number; entries: PositionedEntry[] }> = [];

  items.forEach((item, index) => {
    const text = String(item.str ?? "").trim();
    if (!text) return;
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (!row) {
      row = { y, entries: [] };
      rows.push(row);
    }
    row.entries.push({
      x,
      text,
      width: Number(item.width ?? 0),
      correct: redItems.has(index)
    });
  });

  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.entries.sort((a, b) => a.x - b.x);
      let line = "";
      let previousEnd = 0;
      let correct = false;
      row.entries.forEach((entry, index) => {
        if (index > 0 && entry.x - previousEnd > 1.5) line += " ";
        line += entry.text;
        previousEnd = entry.x + Math.max(entry.width, entry.text.length * 3.2);
        correct = correct || entry.correct;
      });
      const cleaned = line.replace(/\s+/g, " ").trim();
      if (correct && /^\s*[A-H]\s*[).:-]/i.test(cleaned)) return `[[CORRECT]] ${cleaned}`;
      return cleaned;
    })
    .filter(Boolean);
}
