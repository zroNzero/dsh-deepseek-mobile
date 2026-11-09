/**
 * Plain-GET parallel Termux fetcher (build-environment helper).
 *
 * USTC's mirror rejects multi-megabyte range spans, so the upstream
 * registry.downloadTo() retries forever on git/cmake/python. This helper does
 * one streaming GET per package with bounded concurrency, verifies SHA-256, and
 * writes the same .cache/debs/manifest.json schema build-runtime.mjs consumes.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, createWriteStream, renameSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import http from "node:http";
import {
  fetchBuffer,
  parsePackagesIndex,
  resolveClosure,
  sha256Hex,
} from "./lib/registry.mjs";
import { SEED_PACKAGES, TERMUX_REPO } from "./lib/seeds.mjs";

const CACHE = process.env.KXXY_CACHE ?? join(process.cwd(), ".cache", "debs");
const CONCURRENCY = Number(process.env.KXXY_DL_CONCURRENCY ?? 8);
const safeName = (s) => s.replace(/[:*?"<>|\\/]/g, "_");

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { "user-agent": "kxxy-build/1.0", connection: "close" } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        return download(new URL(res.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
      }
      if (code !== 200) { res.resume(); return reject(new Error("HTTP " + code)); }
      const part = dest + "." + process.pid + ".part";
      const out = createWriteStream(part);
      res.pipe(out);
      out.on("finish", () => out.close(() => { try { renameSync(part, dest); resolve(); } catch (e) { reject(e); } }));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.setTimeout(180000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  console.log(`[1/3] index ${TERMUX_REPO}`);
  const indexText = (await fetchBuffer(`${TERMUX_REPO}/dists/stable/main/binary-aarch64/Packages`)).toString("utf8");
  const index = parsePackagesIndex(indexText);
  console.log(`      ${index.size} packages`);

  const { ordered, missing } = resolveClosure(index, SEED_PACKAGES);
  if (missing.length) console.warn(`      missing: ${missing.join(", ")}`);
  const pkgs = ordered.filter((n) => index.has(n));
  const total = pkgs.reduce((s, n) => s + index.get(n).size, 0);
  console.log(`[2/3] closure ${pkgs.length} packages, ${(total / 1024 / 1024).toFixed(1)} MiB`);

  const queue = pkgs.slice();
  const results = new Map();
  const failed = [];
  let done = 0;

  async function fetchOne(name) {
    const pkg = index.get(name);
    const dest = join(CACHE, safeName(`${name}_${pkg.version}_${pkg.arch}.deb`));
    const ok = () => !pkg.sha256 || (existsSync(dest) && sha256Hex(readFileSync(dest)) === pkg.sha256);
    if (existsSync(dest) && statSync(dest).size > 0 && ok()) {
      results.set(name, { name, version: pkg.version, arch: pkg.arch, file: dest.split(/[\\/]/).pop(), size: pkg.size, sha256: pkg.sha256, depends: pkg.depends });
      done++;
      return;
    }
    if (existsSync(dest)) rmSync(dest, { force: true });
    try {
      await download(`${TERMUX_REPO}/${pkg.filename}`, dest);
      if (!ok()) throw new Error("sha256 mismatch");
      results.set(name, { name, version: pkg.version, arch: pkg.arch, file: dest.split(/[\\/]/).pop(), size: pkg.size, sha256: pkg.sha256, depends: pkg.depends });
      done++;
      if (done % 10 === 0 || done === pkgs.length) console.log(`      ${done}/${pkgs.length}`);
    } catch (e) {
      console.error(`      FAIL ${name}: ${e.message}`);
      failed.push(name);
    }
  }

  async function worker() {
    while (queue.length) await fetchOne(queue.shift());
  }

  console.log(`[3/3] downloading with ${CONCURRENCY} workers -> ${CACHE}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed.length) {
    console.log(`      retrying ${failed.length} failed packages...`);
    for (const name of failed.splice(0)) {
      await new Promise((r) => setTimeout(r, 500));
      await fetchOne(name);
    }
  }

  const packages = pkgs.map((n) => results.get(n)).filter(Boolean);
  if (packages.length !== pkgs.length) throw new Error(`incomplete: ${packages.length}/${pkgs.length} debs`);
  writeFileSync(join(CACHE, "manifest.json"), JSON.stringify({
    repo: TERMUX_REPO,
    arch: "aarch64",
    generatedAt: new Date().toISOString(),
    seeds: SEED_PACKAGES,
    packages,
  }, null, 2));
  console.log(`done: ${packages.length} debs -> ${join(CACHE, "manifest.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
