import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("index.html", "dist/index.html"),
  copyFile("src/styles.css", "dist/styles.css")
]);
console.log("QuizForge assets copied to dist.");
