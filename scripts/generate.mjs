#!/usr/bin/env node
// NovelAI 直连 API 生成脚本（技能 novelai-image 专用，无第三方依赖，Node 18+）
//
// 用法：
//   NAI_TOKEN_FILE=<token文件> node generate.mjs --prompt "1girl, ..." [--model v4.5-full]
//     [--negative "..."] [--width 832 --height 1216] [--steps 23] [--scale 5]
//     [--sampler k_euler_ancestral] [--seed N] [--n 2] [--out DIR] [--attempts 5]
//     [--concurrency 2] [--timeout-ms 120000] [--prompts-file FILE] [--no-quality] [--quiet]
//
// 令牌来源（四选一，优先级从高到低）：--token-file、环境变量 NAI_TOKEN_FILE、环境变量 NAI_TOKEN、
// 技能目录凭据文件 credentials/api-token.txt（首次 --save-credential 保存后自动生效，免登录直连）。
// 脚本不打印令牌；除凭据文件外，不把令牌写入任何输出文件。
//
// --save-credential：只把本次令牌写入 <技能目录>/credentials/api-token.txt（0600）然后退出，不生成图片。
// 用途：首次登录/拿到令牌后保存一次，之后运行脚本无需再传令牌。
//
// 请求安全约束（强制）：仅 https；host 只允许 image.novelai.net / api.novelai.net；
// 解析 DNS 后拒绝环回、私有和保留地址。

import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HOST_ALLOWLIST = new Set(["image.novelai.net", "api.novelai.net"]);
const PRIMARY_ENDPOINT = { url: "https://image.novelai.net/ai/generate-image", timeoutMs: null };
const FALLBACK_ENDPOINT = { url: "https://api.novelai.net/ai/generate-image", timeoutMs: 8000 };
// 凭据长期保存的唯一位置（0600，仅含令牌本身）；打包/分享技能前应删除 credentials 目录
const CRED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "credentials", "api-token.txt");

const MODELS = {
  "v5-full": {
    id: "nai-diffusion-5-full", label: "V5Full", paramsVersion: 4,
    quality: ", very aesthetic, masterpiece, no text", steps: 23, scale: 6,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: false,
  },
  "v5-curated": {
    id: "nai-diffusion-5-curated", label: "V5Curated", paramsVersion: 4,
    quality: ", very aesthetic, masterpiece, no text", steps: 23, scale: 6,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: false,
  },
  "v4.5-full": {
    id: "nai-diffusion-4-5-full", label: "V4.5Full", paramsVersion: 4,
    quality: ", very aesthetic, masterpiece, no text", steps: 23, scale: 5,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: true,
  },
  "v4.5-curated": {
    id: "nai-diffusion-4-5-curated", label: "V4.5Curated", paramsVersion: 4,
    quality: ", location, masterpiece, no text, -0.8::feet::, rating:general", steps: 23, scale: 5,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: false,
  },
  "v4-full": {
    id: "nai-diffusion-4-full", label: "V4Full", paramsVersion: 4,
    quality: ", no text, best quality, very aesthetic, absurdres", steps: 23, scale: 5,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: false,
  },
  "v4-curated": {
    id: "nai-diffusion-4-curated", label: "V4Curated", paramsVersion: 4,
    quality: ", rating:general, amazing quality, very aesthetic, absurdres", steps: 23, scale: 5,
    uc: "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
    verified: false,
  },
};

function parseArgs(argv) {
  const a = {
    n: 1, attempts: 5, out: "nai-output", quality: true, quiet: false,
    concurrency: 1, timeoutMs: 120000, prompts: [], fallback: false, blockNsfw: false, saveCredential: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail(`missing value for ${k}`); return argv[++i]; };
    switch (k) {
      case "--prompt": a.prompts.push(next()); break;
      case "--prompt-file":
      case "--prompts-file": {
        const p = next();
        const text = fs.readFileSync(p, "utf8");
        for (const line of text.split(/\r?\n/)) {
          const t = line.trim();
          if (t && !t.startsWith("#")) a.prompts.push(t);
        }
        break;
      }
      case "--model": a.model = next(); break;
      case "--negative": a.negative = next(); break;
      case "--width": a.width = Number(next()); break;
      case "--height": a.height = Number(next()); break;
      case "--steps": a.steps = Number(next()); break;
      case "--scale": a.scale = Number(next()); break;
      case "--sampler": a.sampler = next(); break;
      case "--seed": a.seed = Number(next()); break;
      case "--n": a.n = Number(next()); break;
      case "--out": a.out = next(); break;
      case "--attempts": a.attempts = Number(next()); break;
      case "--concurrency": a.concurrency = Number(next()); break;
      case "--timeout-ms": a.timeoutMs = Number(next()); break;
      case "--token-file": a.tokenFile = next(); break;
      case "--save-credential": a.saveCredential = true; break;
      case "--no-quality": a.quality = false; break;
      case "--quiet": a.quiet = true; break;
      case "--fallback": a.fallback = true; break;
      case "--block-nsfw": a.blockNsfw = true; break;
      default: fail(`unknown argument: ${k}`);
    }
  }
  if (a.prompts.length === 0 && !a.saveCredential) fail("--prompt or --prompts-file is required (omit only with --save-credential)");
  a.model = a.model || "v4.5-full";
  if (!MODELS[a.model]) fail(`unknown model "${a.model}". available: ${Object.keys(MODELS).join(", ")}`);
  if (!Number.isInteger(a.n) || a.n < 1 || a.n > 32) fail("--n must be 1..32");
  if (!Number.isInteger(a.attempts) || a.attempts < 1 || a.attempts > 20) fail("--attempts must be 1..20");
  if (!Number.isInteger(a.concurrency) || a.concurrency < 1 || a.concurrency > 4) fail("--concurrency must be 1..4");
  if (!Number.isInteger(a.timeoutMs) || a.timeoutMs < 5000 || a.timeoutMs > 600000) fail("--timeout-ms must be 5000..600000");
  if (a.seed !== undefined && (!Number.isInteger(a.seed) || a.seed < 0 || a.seed >= 2 ** 32)) fail("--seed must be a uint32");
  return a;
}

function fail(msg) {
  console.error("ERROR: " + msg);
  process.exit(2);
}

function log(quiet, msg) { if (!quiet) console.error(msg); }

function assertSafeEndpoint(u) {
  const url = new URL(u);
  if (url.protocol !== "https:") throw new Error(`blocked non-https endpoint: ${u}`);
  if (!HOST_ALLOWLIST.has(url.hostname)) throw new Error(`blocked non-allowlisted host: ${url.hostname}`);
}

function isPrivateIp(ip) {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (/^f[cd]/.test(v6)) return true;
    if (/^fe[89ab]/.test(v6)) return true;
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

const dnsOk = new Map();
async function assertPublicHost(hostname) {
  if (dnsOk.has(hostname)) return;
  const { address } = await dns.lookup(hostname);
  if (isPrivateIp(address)) throw new Error(`blocked private/reserved address for ${hostname}: ${address}`);
  dnsOk.set(hostname, true);
}

function applyQuality(prompt, quality) {
  const t = prompt.trim();
  if (!quality) return t;
  const i = t.indexOf("|");
  if (i === -1) return t + quality;
  return t.slice(0, i).trimEnd() + quality + " " + t.slice(i);
}

function buildPayload(args, cfg, promptText, seed) {
  const prompt = args.quality ? applyQuality(promptText, cfg.quality) : promptText.trim();
  let uc = (args.negative !== undefined ? args.negative : cfg.uc).trim();
  if (args.blockNsfw && !/(^|,)\s*nsfw\s*(,|$)/i.test(uc)) uc = uc ? `nsfw, ${uc}` : "nsfw";
  return {
    input: prompt,
    model: cfg.id,
    action: "generate",
    parameters: {
      params_version: cfg.paramsVersion,
      width: args.width, height: args.height,
      scale: args.scale, sampler: args.sampler, steps: args.steps,
      seed, n_samples: 1,
      ucPresetId: args.blockNsfw ? "heavy" : "none",
      qualityPresetId: args.quality ? "standard" : "none",
      autoSmea: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      cfg_rescale: 0,
      noise_schedule: "karras",
      legacy_v3_extend: false,
      skip_cfg_above_sigma: null,
      use_coords: false,
      legacy_uc: false,
      normalize_reference_strength_multiple: true,
      inpaintImg2ImgStrength: 1,
      characterPrompts: [],
      tag_hint_qt: 1,
      tag_hint_uc_preset: 2,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
      image_format: "png",
      negative_prompt: uc,
      v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
      v4_negative_prompt: { caption: { base_caption: uc, char_captions: [] }, legacy_uc: false },
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithWatch({ url, token, body, timeoutMs, quiet, label }) {
  const started = Date.now();
  const beat = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    log(quiet, `  ${label} waiting ${s}s / ${Math.round(timeoutMs / 1000)}s`);
  }, 5000);
  if (typeof beat.unref === "function") beat.unref();
  const timeoutPromise = new Promise((_, reject) => {
    const t = setTimeout(() => {
      reject(Object.assign(new Error(`timeout after ${timeoutMs}ms on ${url}`), { timedOut: true }));
    }, timeoutMs);
    if (typeof t.unref === "function") t.unref();
  });
  try {
    const res = await Promise.race([
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
      }),
      timeoutPromise,
    ]);
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, elapsedMs: Date.now() - started };
  } catch (e) {
    if (e.timedOut) throw e;
    throw new Error(`network error on ${url}: ${e.message}`);
  } finally {
    clearInterval(beat);
  }
}

async function callGenerate(token, payload, args, label) {
  let lastErr = null;
  const body = JSON.stringify(payload);
  const endpoints = args.fallback ? [PRIMARY_ENDPOINT, FALLBACK_ENDPOINT] : [PRIMARY_ENDPOINT];
  for (let attempt = 1; attempt <= args.attempts; attempt++) {
    for (const ep of endpoints) {
      assertSafeEndpoint(ep.url);
      await assertPublicHost(new URL(ep.url).hostname);
      const timeoutMs = ep.timeoutMs ?? args.timeoutMs;
      let got;
      try {
        got = await fetchWithWatch({
          url: ep.url, token, body, timeoutMs, quiet: args.quiet, label,
        });
      } catch (e) {
        lastErr = e;
        log(args.quiet, `  ${label} ${e.message}`);
        continue;
      }
      if (got.res.status === 200) {
        return {
          buf: got.buf, endpoint: ep.url, attempt,
          contentType: got.res.headers.get("content-type"),
          elapsedMs: got.elapsedMs,
        };
      }
      const text = got.buf.toString("utf8").slice(0, 500);
      lastErr = new Error(`HTTP ${got.res.status} on ${ep.url}: ${text}`);
      log(args.quiet, `  ${label} ${lastErr.message.slice(0, 180)}`);
      const retryable = got.res.status === 429 || /concurrency/i.test(text);
      if (got.res.status === 401) throw new Error(`令牌失效（401，来源: ${args.tokenSource ?? "unknown"}）——回阶段零重新获取令牌并用 --save-credential 刷新，或在浏览器重新登录提取`);
      if (got.res.status === 402) throw new Error("Anlas 不足（402）——改用 v4.5-full 普通尺寸免费，或充值/降低参数");
      if (got.res.status === 403) throw new Error(`请求被拒绝（403，可能为内容政策）: ${text}`);
      if (got.res.status === 400 || got.res.status === 404 || got.res.status === 405 || got.res.status === 415 || got.res.status === 422) continue;
      if (retryable) {
        const waitMs = Math.min(8000, 1000 * (2 ** (attempt - 1)));
        log(args.quiet, `  ${label} concurrent lock, waiting ${waitMs / 1000}s then retry`);
        await sleep(waitMs);
        break;
      }
      throw lastErr;
    }
    if (attempt < args.attempts && !/429|concurrency/i.test(lastErr.message)) {
      log(args.quiet, `  ${label} attempt ${attempt} failed (${lastErr.message.slice(0, 120)}), retrying in 1s...`);
      await sleep(1000);
    }
  }
  throw new Error(`并发/网络重试 ${args.attempts} 次后仍失败: ${lastErr.message}`);
}

function unzipFiles(buf) {
  const eocd = buf.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (eocd !== -1) {
    const count = buf.readUInt16LE(eocd + 10);
    let ptr = buf.readUInt32LE(eocd + 16);
    const files = [];
    for (let i = 0; i < count; i++) {
      if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
      const method = buf.readUInt16LE(ptr + 10);
      const csize = buf.readUInt32LE(ptr + 20);
      const usize = buf.readUInt32LE(ptr + 24);
      const nameLen = buf.readUInt16LE(ptr + 28);
      const extraLen = buf.readUInt16LE(ptr + 30);
      const commentLen = buf.readUInt16LE(ptr + 32);
      const lho = buf.readUInt32LE(ptr + 42);
      const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
      const lnLen = buf.readUInt16LE(lho + 26);
      const leLen = buf.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lnLen + leLen;
      let data;
      if (method === 8) data = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + csize));
      else data = buf.subarray(dataStart, dataStart + usize);
      if (data.length !== usize) throw new Error(`zip entry "${name}" size mismatch (${data.length} != ${usize})`);
      files.push({ name, data });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngs = [];
  let pos = 0;
  while (true) {
    const start = buf.indexOf(sig, pos);
    if (start === -1) break;
    const iend = buf.indexOf("IEND", start);
    if (iend === -1) break;
    pngs.push({ name: `image_${pngs.length}.png`, data: buf.subarray(start, iend + 8) });
    pos = iend + 8;
  }
  return pngs;
}

function pad2(x) { return String(x).padStart(2, "0"); }
function timestamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function generateOne(job, args, cfg, tok, outDir, manifestPath) {
  const { index, total, prompt, seed } = job;
  const label = `[${index}/${total}]`;
  const payload = buildPayload(args, cfg, prompt, seed);
  log(args.quiet, `${label} model=${cfg.id} ${args.width}x${args.height} steps=${args.steps} scale=${args.scale} seed=${seed}${cfg.verified ? "" : " (model id unverified)"}`);
  const { buf, endpoint, attempt, contentType, elapsedMs } = await callGenerate(tok, payload, args, label);
  const pngs = unzipFiles(buf).filter((f) => f.name.toLowerCase().endsWith(".png"));
  if (pngs.length === 0) {
    throw new Error(`response contained no PNG data (content-type: ${contentType}; head: ${JSON.stringify(buf.subarray(0, 120).toString("latin1"))})`);
  }
  const ts = timestamp();
  const files = [];
  pngs.forEach((png, j) => {
    const name = pngs.length > 1
      ? `NAI_${cfg.label}_${ts}_${String(j + 1).padStart(2, "0")}.png`
      : `NAI_${cfg.label}_${ts}.png`;
    const fp = path.join(outDir, name);
    fs.writeFileSync(fp, png.data);
    files.push(fp);
  });
  const record = {
    ts: new Date().toISOString(), file: files.map((f) => path.resolve(f)),
    model: args.model, model_id: cfg.id, prompt: payload.input, negative: payload.parameters.negative_prompt,
    width: args.width, height: args.height, steps: args.steps, scale: args.scale,
    sampler: args.sampler, seed, n: pngs.length,
    endpoint, attempts_used: attempt, elapsed_ms: elapsedMs, via: "api-script",
  };
  fs.appendFileSync(manifestPath, JSON.stringify(record) + "\n");
  log(args.quiet, `  ${label} saved ${files.length} file(s) in ${(elapsedMs / 1000).toFixed(1)}s, attempts=${attempt}`);
  return record;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = MODELS[args.model];

  let tok = null;
  let tokSource = null;
  if (args.tokenFile) { tok = fs.readFileSync(args.tokenFile, "utf8").trim(); tokSource = "--token-file"; }
  else if (process.env.NAI_TOKEN_FILE) { tok = fs.readFileSync(process.env.NAI_TOKEN_FILE, "utf8").trim(); tokSource = "env NAI_TOKEN_FILE"; }
  else if (process.env.NAI_TOKEN) { tok = process.env.NAI_TOKEN.trim(); tokSource = "env NAI_TOKEN"; }
  else if (fs.existsSync(CRED_FILE)) { tok = fs.readFileSync(CRED_FILE, "utf8").trim(); tokSource = "saved credential"; }
  if (!tok) fail(`no token: pass --token-file / NAI_TOKEN_FILE / NAI_TOKEN once, then run with --save-credential to store it at ${CRED_FILE}`);

  const tokenKind = tok.startsWith("pst-") ? "persistent-api-token" : tok.startsWith("eyJ") ? "session-jwt" : "unknown-format";
  if (tokenKind === "unknown-format") log(args.quiet, "note: token is neither pst-… nor a JWT; using it anyway");

  if (args.saveCredential) {
    fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true });
    fs.writeFileSync(CRED_FILE, tok + "\n", { mode: 0o600 });
    try { fs.chmodSync(CRED_FILE, 0o600); } catch {}
    log(args.quiet, `credential saved (${tokenKind}) -> ${CRED_FILE}`);
    console.log(JSON.stringify({ ok: true, saved: CRED_FILE, tokenKind }, null, 1));
    return;
  }

  args.tokenSource = `${tokSource} (${tokenKind})`;
  log(args.quiet, `token source: ${args.tokenSource}`);

  args.width = args.width ?? 832;
  args.height = args.height ?? 1216;
  args.steps = args.steps ?? cfg.steps;
  args.scale = args.scale ?? cfg.scale;
  args.sampler = args.sampler ?? "k_euler_ancestral";

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.jsonl");

  const jobs = [];
  for (const prompt of args.prompts) {
    for (let k = 0; k < args.n; k++) {
      jobs.push({
        prompt,
        seed: args.seed !== undefined ? args.seed : crypto.randomInt(0, 2 ** 32),
      });
    }
  }
  jobs.forEach((j, i) => { j.index = i + 1; j.total = jobs.length; });

  const t0 = Date.now();
  const results = await mapPool(jobs, args.concurrency, (job) =>
    generateOne(job, args, cfg, tok, outDir, manifestPath));
  const totalMs = Date.now() - t0;
  log(args.quiet, `done ${results.length} image(s) in ${(totalMs / 1000).toFixed(1)}s (concurrency=${args.concurrency})`);
  console.log(JSON.stringify({
    ok: true,
    files: results.flatMap((r) => r.file),
    manifest: manifestPath,
    elapsed_ms: totalMs,
    concurrency: args.concurrency,
    records: results,
  }, null, 1));
}

main().catch((e) => {
  console.error("ERROR: " + e.message);
  process.exit(1);
});
