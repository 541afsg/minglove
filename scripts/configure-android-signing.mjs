import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base64 = process.env.SHIGUANG_ANDROID_KEYSTORE_BASE64;
const password = process.env.SHIGUANG_ANDROID_KEYSTORE_PASSWORD;
if (!base64 || !password) {
  throw new Error("GitHub Actions secrets SHIGUANG_ANDROID_KEYSTORE_BASE64 and SHIGUANG_ANDROID_KEYSTORE_PASSWORD must be set before building the APK.");
}

const keystore = Buffer.from(base64, "base64");
if (keystore.length < 1024) throw new Error("The Android signing keystore secret is invalid or incomplete.");

const appDir = resolve("android/app");
const keystorePath = resolve(appDir, "shiguang-release.jks");
await mkdir(appDir, { recursive: true });
await writeFile(keystorePath, keystore, { mode: 0o600 });
await chmod(keystorePath, 0o600);

const gradlePath = resolve(appDir, "build.gradle");
let gradle = await readFile(gradlePath, "utf8");
const blockStart = "// SHIGUANG_STABLE_SIGNING_BEGIN";
const blockEnd = "// SHIGUANG_STABLE_SIGNING_END";
const existingBlock = new RegExp(`${blockStart}[\\s\\S]*?${blockEnd}\\s*`, "g");
gradle = gradle.replace(existingBlock, "").trimEnd();
gradle += `

${blockStart}
android {
    signingConfigs {
        shiguangStable {
            storeFile file("shiguang-release.jks")
            storePassword System.getenv("SHIGUANG_ANDROID_KEYSTORE_PASSWORD")
            keyAlias "shiguang-release"
            keyPassword System.getenv("SHIGUANG_ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.shiguangStable
        }
    }
}
${blockEnd}
`;
await writeFile(gradlePath, gradle, "utf8");
console.log("Configured stable Android APK signing without printing key material.");
