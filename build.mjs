#!/usr/bin/env node
/*
 * Zero-dependency build: concatenates the two card modules into a single
 * dist/hierarchy-cards.js bundle. Each source file is written to be
 * self-contained (it declares its own classes and registers its own custom
 * element), so concatenation is safe.
 *
 * Run:  npm run build
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const PARTS = [
  "src/hierarchy-power-card.js",
  "src/hierarchy-energy-card.js",
];

const banner =
  `/*! ${pkg.name} v${pkg.version} — ${pkg.description}\n` +
  ` *  Source: ${PARTS.join(", ")}\n` +
  ` *  License: ${pkg.license} */`;

const chunks = [];
const defined = new Set();
for (const rel of PARTS) {
  const code = readFileSync(join(root, rel), "utf8");
  for (const m of code.matchAll(/customElements\.define\(\s*["'`]([^"'`]+)["'`]/g)) {
    defined.add(m[1]);
  }
  chunks.push(`\n/* ------------------------------------------------------------------ */\n` +
              `/* ${rel}`.padEnd(68) + ` */\n` +
              `/* ------------------------------------------------------------------ */\n\n` +
              code.trimEnd() + "\n");
}

for (const required of ["hierarchy-power-card", "hierarchy-energy-card"]) {
  if (!defined.has(required)) {
    console.error(`Build failed: no customElements.define("${required}") found in src.`);
    process.exit(1);
  }
}

mkdirSync(join(root, "dist"), { recursive: true });
const out = banner + "\n" + chunks.join("");
writeFileSync(join(root, "dist/hierarchy-cards.js"), out);
console.log(
  `Built dist/hierarchy-cards.js (${out.length} bytes) with ` +
  `${defined.size} card(s): ${[...defined].join(", ")}`
);
