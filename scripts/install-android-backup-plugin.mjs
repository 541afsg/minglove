import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android/app/src/main/java/com/shiguangbiji/app");
const pluginSource = resolve(root, "scripts/android/BackupExportPlugin.java");
const pluginTarget = resolve(androidRoot, "BackupExportPlugin.java");
const mainActivityPath = resolve(androidRoot, "MainActivity.java");

await mkdir(androidRoot, { recursive: true });
await copyFile(pluginSource, pluginTarget);

let mainActivity = await readFile(mainActivityPath, "utf8");
if (!mainActivity.includes("BackupExportPlugin.class")) {
  const packageLine = /^package\s+[^;]+;\s*/m;
  if (!packageLine.test(mainActivity)) throw new Error("无法安全修改 Android MainActivity：未找到 package 声明。");
  mainActivity = mainActivity.replace(packageLine, (line) => `${line}\nimport android.os.Bundle;\nimport com.shiguangbiji.app.BackupExportPlugin;\n`);

  const classOpen = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/;
  if (!classOpen.test(mainActivity)) throw new Error("无法安全修改 Android MainActivity：类结构与预期不符。");
  mainActivity = mainActivity.replace(classOpen, `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(BackupExportPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n`);
  await writeFile(mainActivityPath, mainActivity, "utf8");
}

console.log("Registered the Android backup file-save plugin.");
