// Bundles the tracking script (src/tracker) into public/rz.js.
// Runs automatically before `next dev` / `next build` (predev / prebuild) and via `npm run widget:build`.

import { build } from "esbuild";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "src/tracker/index.ts");
const outfile = resolve(root, "public/rz.js");
/** The tracker must stay tiny: it is loaded on every page of every tracked website. */
const MAX_GZIP = 2 * 1024;

if (!existsSync(entry)) {
  console.log("[tracker] src/tracker/index.ts not found: skipping public/rz.js");
  process.exit(0);
}

try {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2017",
    platform: "browser",
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    write: false,
    logLevel: "warning",
  });

  const code = result.outputFiles[0].contents;
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, code);

  const gz = gzipSync(code, { level: 9 }).length;
  console.log(`[tracker] public/rz.js  ${code.length} B raw, ${gz} B gzip`);
  if (gz > MAX_GZIP) {
    console.error(`[tracker] gzip size ${gz} B exceeds the ${MAX_GZIP} B budget`);
    process.exit(1);
  }
} catch (err) {
  console.error("[tracker] build failed:", err && err.message ? err.message : err);
  process.exit(1);
}
