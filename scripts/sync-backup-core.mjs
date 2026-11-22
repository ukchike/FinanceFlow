import { readFile, writeFile } from "node:fs/promises";
import { renderAndroidBackupCore } from "./backup-core-build.mjs";

const source = await readFile(new URL("../backup-core.mjs", import.meta.url), "utf8");
await writeFile(new URL("../financeflow-android/app/src/main/assets/backup-core.js", import.meta.url), renderAndroidBackupCore(source));
console.log("Synchronized the shared backup core to the Android WebView assets.");
