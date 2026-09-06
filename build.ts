/**
 * Build script: bundles the entire RifeClaw CLI into a single ESM file
 * per entry point using Bun's native bundler. The output runs on plain
 * node >= 18 (no Bun runtime required for end users).
 *
 * Outputs:
 *   dist/index.js   — main CLI entry (handles all commands)
 *   dist/setup.js   — standalone setup wizard
 *   dist/doctor.js  — standalone doctor
 *   dist/env.js     — required by the bundle at runtime
 *
 * Usage:
 *   bun run build         # development build (with sourcemaps, no minify)
 *   bun run build --prod  # production build (minified, no sourcemaps)
 */

import { rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const isProd = process.argv.includes("--prod");
const root = import.meta.dir;
const outdir = join(root, "dist");

// ── Clean output directory ───────────────────────────────────────────────────
if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

// ── All entry points bundled into a single file ─────────────────────────────
// We bundle everything into one file because the user invokes `rifeclaw` from
// any directory and ESM resolution of relative `.js` imports across packages
// is unreliable without a bundler.
const result = await Bun.build({
  entrypoints: [join(root, "index.ts")],
  outdir,
  target: "node",
  format: "esm",
  splitting: false,
  minify: isProd,
  sourcemap: isProd ? "none" : "inline",
  // node:* and bun:* are runtime-provided, all npm packages stay external so
  // npm install still works for end users.
  external: [
    "node:*",
    "bun:*",
    "@clack/*",
    "@mendable/*",
    "@openrouter/*",
    "@ai-sdk/*",
    "@telegraf/*",
    "@types/*",
    "ai",
    "chalk",
    "commander",
    "diff",
    "figlet",
    "marked",
    "marked-terminal",
    "telegraf",
    "zod",
  ],
  naming: "[dir]/[name].[ext]",
});

// ── Handle build failure ─────────────────────────────────────────────────────
if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// ── Copy .env.example so `rifeclaw setup` can reference it ──────────────────
const envExampleSrc = join(root, ".env.example");
if (existsSync(envExampleSrc)) {
  copyFileSync(envExampleSrc, join(outdir, ".env.example"));
}

// ── Replace Bun shebang with node shebang for end-user compatibility ────────
// Bun adds `#!/usr/bin/env bun\n// @bun\n` automatically. We need node so
// npm-install users without Bun installed can still run the CLI.
const entryPath = join(outdir, "index.js");
if (existsSync(entryPath)) {
  const content = await Bun.file(entryPath).text();
  const fixed = content.replace(
    /^#!\/usr\/bin\/env bun\n\/\/ @bun\n/,
    "#!/usr/bin/env node\n",
  );
  await Bun.write(entryPath, fixed);
}

console.log(isProd ? "Production build complete." : "Development build complete.");
console.log(`Output: ${outdir}`);
