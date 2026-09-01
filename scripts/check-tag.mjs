#!/usr/bin/env node
// NovelAI 技能 标签核对脚本：写提示词前查询 danbooru 标签（存在性 / post 量 / 类别 / 候选写法）
// 只读查询，不携带任何凭据；仅允许 danbooru.donmai.us 系（主站优先，dapi 备份）。
//
// 用法：
//   node check-tag.mjs --tag "chen_qianyu_(arknights)" [--tag "loose socks"]
//                         [--proxy http://127.0.0.1:7897] [--quiet]
//   --proxy 可用环境变量 NAI_PROXY 代替；多个 --tag 一次查完。
//
// 判定规则（写在 SKILL.md 阶段二，这里只做查询）：
//   - exact 命中：写法存在。post_count 量级判断标签强度（角色类建议 >=1000 才算"稳"）。
//   - exact 为空或全 0 post：脚本自动跑一次 *tag* 通配，列出候选写法（可能是拼写/命名空间差异）。
//   - 网络失败：exit 2 并在 stderr 说明——这是"查不了"，不是"查无此名"，回退保守写法。
//
// 安全：host 白名单 + DNS 解析后拒绝环回/私有/保留地址（与 generate.mjs 同一套）。

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Cloudflare 对 danbooru 主站有机器人挑战：实测只有 curl 风格的 UA 能过（Node 默认/浏览器 UA 会 403）
const UA = "curl/8.7.1";
// 代理自动读取：--proxy > NAI_PROXY > 技能目录 credentials/settings.json（与 generate.mjs 同优先级）
const SETTINGS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "credentials", "settings.json");

// 主站 danbooru.donmai.us 可直接 HTTPS 访问（部分网络下 dapi 被重置，主站经代理可通）
const API_HOSTS = ["danbooru.donmai.us", "dapi.danbooru.donmai.us"];
const CATEGORY = { 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta", 6: "deprecated" };

function fail(msg) { console.error("ERROR: " + msg); process.exit(2); }

function parseArgs(argv) {
  const a = { tags: [], quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { if (i + 1 >= argv.length) fail(`missing value for ${k}`); return argv[++i]; };
    switch (k) {
      case "--tag": a.tags.push(next()); break;
      case "--proxy": a.proxy = next(); break;
      case "--quiet": a.quiet = true; break;
      default: fail(`unknown argument: ${k}`);
    }
  }
  if (a.tags.length === 0) fail("--tag is required (repeatable)");
  function loadProxyFromSettings() {
    try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); return typeof s.proxy === "string" && s.proxy.trim() ? s.proxy.trim() : null; } catch { return null; }
  }
  const proxyStr = a.proxy ?? process.env.NAI_PROXY ?? loadProxyFromSettings();
  a.proxy = proxyStr ? new URL(proxyStr) : null;
  if (a.proxy && a.proxy.protocol !== "http:") fail(`proxy must be an http:// URL (got: ${proxyStr})`);
  return a;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 通过代理 CONNECT 隧道发 HTTPS 请求（与 generate.mjs 同一实现模式）
async function fetchViaProxy({ url, timeoutMs, proxy, headers = {} }) {
  const target = new URL(url);
  const targetPort = Number(target.port) || 443;
  const socket = await new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.hostname, port: Number(proxy.port) || 80, method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: { Host: `${target.hostname}:${targetPort}` },
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`proxy CONNECT timeout after ${timeoutMs}ms`)));
    req.on("connect", (res, sock) => {
      if (res.statusCode !== 200) { sock.destroy(); reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`)); return; }
      resolve(sock);
    });
    req.on("error", reject);
    req.end();
  });
  const tlsSocket = tls.connect({ socket, servername: target.hostname });
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      host: target.hostname, path: `${target.pathname}${target.search}`, method: "GET",
      headers, createConnection: () => tlsSocket,
    }, resolve);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms on ${url}`)));
    req.on("error", reject);
    req.end();
  });
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return { status: res.statusCode, buf: Buffer.concat(chunks) };
}

async function queryTags(name, args) {
  const timeoutMs = 15000;
  let lastErr = null;
  for (const host of API_HOSTS) {
    const url = `https://${host}/tags.json?${new URLSearchParams({ "search[name_matches]": name, limit: "12" })}`;
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error("blocked non-https endpoint");
    try {
      await assertPublicHost(host);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let status, buf;
          if (args.proxy) {
            ({ status, buf } = await fetchViaProxy({ url, timeoutMs, proxy: args.proxy, headers: { "User-Agent": UA } }));
          } else {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), timeoutMs);
            const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA } });
            clearTimeout(t);
            status = res.status;
            buf = Buffer.from(await res.arrayBuffer());
          }
          if (status === 200) return { tags: JSON.parse(buf.toString("utf8")), host };
          lastErr = new Error(`HTTP ${status} from ${host}`);
          if (status === 429 && attempt === 1) { await sleep(2000); continue; }
        } catch (e) {
          lastErr = e;
          if (e.name === "AbortError") lastErr = new Error(`timeout after ${timeoutMs}ms`);
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("unknown query failure");
}

function summarize(tags) {
  return tags.map((t) => ({
    name: t.name, post_count: t.post_count, category: CATEGORY[t.category] ?? String(t.category),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];
  const hostsUsed = new Set();
  for (const tag of args.tags) {
    if (!args.quiet) console.error(`querying: ${tag}${args.proxy ? " (via proxy " + args.proxy.host + ")" : ""}`);
    const { tags: exactTags, host: exactHost } = await queryTags(tag, args);
    hostsUsed.add(exactHost);
    const exact = summarize(exactTags);
    let wildcard = [];
    if (exact.length === 0 || exact.every((t) => t.post_count === 0)) {
      if (!args.quiet) console.error(`  exact ${exact.length ? "0 post (alias/空壳)" : "none"} for "${tag}", trying *${tag}* ...`);
      const { tags: wildTags, host: wildHost } = await queryTags(`*${tag}*`, args);
      hostsUsed.add(wildHost);
      wildcard = summarize(wildTags);
    }
    results.push({ query: tag, exact, wildcard, api: exactHost });
    if (!args.quiet) {
      if (exact.length) {
        for (const t of exact) console.error(`  exact ${t.name}  post=${t.post_count}  cat=${t.category}`);
      } else if (wildcard.length) {
        console.error(`  (exact: none)`);
        for (const t of wildcard) console.error(`  candidate ${t.name}  post=${t.post_count}  cat=${t.category}`);
      } else {
        console.error(`  (none found: "${tag}" 无任何命中)`);
      }
    }
  }
  console.log(JSON.stringify({ ok: true, results, api: [...hostsUsed] }, null, 1));
}

main().catch((e) => {
  console.error("ERROR: 标签核对失败（网络/超时/被拒），不是“查无此名”：" + e.message +
    "\n  处理：回退保守写法（具名角色只写名字/作品名、不列外貌、不补不确定职能），或加 --proxy http://127.0.0.1:7897 重试");
  process.exit(2);
});
