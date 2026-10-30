import { copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSource = resolve(root, "node_modules/@capacitor/core/dist/capacitor.js");
const runtimeTarget = resolve(root, "dist/capacitor.js");

await copyFile(runtimeSource, runtimeTarget);
console.log("Copied the Capacitor core runtime into the static app.");
