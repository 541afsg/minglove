import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile("dist/icon.svg", "utf8");
const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
const artworkStart = svg.indexOf('  <g filter="url(#paperShadow)">');
const artworkEnd = svg.lastIndexOf("</svg>");
const backgroundStart = svg.indexOf('  <rect width="512" height="512" fill="url(#background)"/>');

if (!defs || artworkStart < 0 || backgroundStart < 0 || artworkEnd <= artworkStart) {
  throw new Error("The 拾光笔记 SVG icon no longer has the expected artwork structure.");
}

const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}<g transform="translate(46 46) scale(.82)">${svg.slice(artworkStart, artworkEnd)}</g></svg>`;
const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${svg.slice(backgroundStart, artworkStart)}</svg>`;

await mkdir("assets", { recursive: true });
await Promise.all([
  sharp("dist/icon-512.png").resize(1024, 1024).png().toFile("assets/icon-only.png"),
  sharp(Buffer.from(foregroundSvg)).resize(1024, 1024).png().toFile("assets/icon-foreground.png"),
  sharp(Buffer.from(backgroundSvg)).resize(1024, 1024).png().toFile("assets/icon-background.png"),
]);

console.log("Generated 1024px 拾光笔记 Android launcher icons.");
