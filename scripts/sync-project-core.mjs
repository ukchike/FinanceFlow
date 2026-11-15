import { readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../project-core.mjs", import.meta.url), "utf8");
const android = source.replace(/^export /gm, "") + "\nwindow.FinanceFlowProject = { summarizeProject };\n";
await writeFile(new URL("../financeflow-android/app/src/main/assets/project-core.js", import.meta.url), android);
console.log("Synchronized the shared project calculations to the Android WebView assets.");
