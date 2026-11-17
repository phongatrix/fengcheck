#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHẠY TỰ ĐỘNG APP CHẤM THI OMR — MỘT FILE DUY NHẤT, CHẠY TRÊN LINUX VÀ WINDOWS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Việc script làm, theo thứ tự (bỏ qua bước nào đã xong):
 *    1. Kiểm tra Node.js + npm (yêu cầu Node ≥ 18.17; khuyến nghị ≥ 20).
 *    2. Cài dependencies: `npm ci` (có package-lock) hoặc `npm install`.
 *       Tự cài lại khi package.json mới hơn lần cài trước.
 *    3. Build production: `npm run build` — chỉ khi chưa có .next hoặc mã nguồn
 *       mới hơn build gần nhất.
 *    4. Chọn cổng: mặc định 3210; nếu đang bận thì thử 3211…3220.
 *    5. Chạy `next start` và CHỜ tới khi HTTP trả 200 rồi in địa chỉ.
 *
 *  CÁCH DÙNG
 *    Linux/macOS :  node run.mjs            (hoặc ./run.mjs  — đã có shebang)
 *    Windows     :  node run.mjs            (hoặc bấm đúp start.cmd)
 *
 *  TUỲ CHỌN
 *    --dev              chạy `next dev` thay vì production
 *    --no-build         không build (dùng .next sẵn có)
 *    --rebuild          build lại kể cả khi đã có .next
 *    --reinstall        xoá node_modules rồi cài lại từ đầu
 *    --port=3210        chỉ định cổng
 *    --test             chạy test suite (vitest) rồi mới chạy app
 *    --force            nếu cổng bận thì KILL tiến trình đang giữ cổng
 *    --help             in trợ giúp
 *
 *  GHI CHÚ VẬN HÀNH
 *    • Dữ liệu bài thi/đáp án/kết quả nằm trong IndexedDB của TRÌNH DUYỆT theo
 *      origin (localhost:3210 ≠ localhost:3000) → luôn dùng cùng một cổng nếu
 *      muốn giữ dữ liệu cũ.
 *    • Sau mỗi lần build lại phải RELOAD trang 1 lần (service worker giữ chunk
 *      cũ, nếu không sẽ treo "Đang xử lý...").
 *    • Webcam chỉ hoạt động trên localhost hoặc HTTPS.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const IS_WIN = process.platform === "win32";
const NPM = IS_WIN ? "npm.cmd" : "npm";
const MIN_NODE = [18, 17, 0];
const DEFAULT_PORT = 3210;
const PORT_TRIES = 10;

// ───────────────────────────── tuỳ chọn dòng lệnh ─────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const OPT = {
  dev: has("--dev"),
  noBuild: has("--no-build"),
  rebuild: has("--rebuild"),
  reinstall: has("--reinstall"),
  test: has("--test"),
  force: has("--force"),
  help: has("--help") || has("-h"),
  port: Number(valueOf("--port", "")) || null,
};

// ─────────────────────────────── tiện ích in ấn ───────────────────────────────
const C = process.stdout.isTTY && !IS_WIN
  ? { r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", g: "\x1b[32m", y: "\x1b[33m", red: "\x1b[31m", cy: "\x1b[36m" }
  : { r: "", b: "", dim: "", g: "", y: "", red: "", cy: "" };

const log = (...a) => console.log(...a);
const step = (n, msg) => log(`\n${C.b}${C.cy}[${n}]${C.r} ${msg}`);
const ok = (msg) => log(`   ${C.g}✓${C.r} ${msg}`);
const warn = (msg) => log(`   ${C.y}!${C.r} ${msg}`);
const fail = (msg) => log(`   ${C.red}✗${C.r} ${msg}`);
const dim = (msg) => log(`   ${C.dim}${msg}${C.r}`);

function die(msg, hint) {
  fail(msg);
  if (hint) log(`\n${hint}\n`);
  process.exit(1);
}

// ───────────────────────────── chạy lệnh con ──────────────────────────────────
/** Chạy lệnh đồng bộ, in nguyên output, trả exit code. */
function runSync(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: IS_WIN, // .cmd trên Windows cần shell
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: "utf8",
    timeout: opts.timeout ?? 0,
  });
  if (opts.quiet) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return res.status ?? 1;
}

/** Chạy lệnh bất đồng bộ (dùng cho next start / next dev — tiến trình dài). */
function runDetached(cmd, args, env = {}) {
  return spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WIN,
    env: { ...process.env, ...env },
  });
}

// ─────────────────────────── 1. kiểm tra Node/npm ─────────────────────────────
function checkToolchain() {
  step(1, "Kiểm tra Node.js và npm");

  const nodeVer = process.versions.node;
  const [maj, min, pat] = nodeVer.split(".").map(Number);
  const tooOld =
    maj < MIN_NODE[0] ||
    (maj === MIN_NODE[0] && min < MIN_NODE[1]) ||
    (maj === MIN_NODE[0] && min === MIN_NODE[1] && pat < MIN_NODE[2]);

  if (tooOld) {
    die(
      `Node.js hiện tại v${nodeVer} quá cũ — cần ≥ ${MIN_NODE.join(".")}.`,
      [
        "Cài Node.js LTS rồi chạy lại:",
        IS_WIN
          ? "  • Tải bản LTS tại https://nodejs.org  (hoặc winget install OpenJS.NodeJS.LTS)"
          : "  • Ubuntu/Debian : curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs",
        IS_WIN ? "" : "  • Fedora        : sudo dnf module install nodejs:20",
        IS_WIN ? "" : "  • macOS (brew)  : brew install node@20",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  ok(`Node.js v${nodeVer}`);

  const npmVer = runNpmVersion();
  if (!npmVer) die("Không tìm thấy npm (đi kèm Node.js).", "Cài lại Node.js từ https://nodejs.org");
  ok(`npm v${npmVer}`);
}

function runNpmVersion() {
  const res = spawnSync(NPM, ["--version"], { cwd: ROOT, shell: IS_WIN, encoding: "utf8" });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

// ────────────────────────── 2. cài dependencies ───────────────────────────────
const pkgPath = join(ROOT, "package.json");
const lockPath = join(ROOT, "package-lock.json");
/**
 * DẤU MỐC CÀI ĐẶT riêng (không dùng mtime package.json).
 *
 * Lý do: script `postbuild` của project tăng version trong package.json sau MỖI
 * lần build → mtime package.json luôn mới hơn node_modules → so mtime sẽ khiến
 * `npm ci` chạy lại mọi lần khởi động (mất 1–3 phút vô ích). Thay vào đó lưu
 * HASH của phần KHAI BÁO DEPENDENCY + lockfile vào file mốc; chỉ cài lại khi
 * thật sự thêm/bớt/nâng dependency.
 */
const stampPath = join(ROOT, "node_modules", ".deps-stamp");

/** FNV-1a 32-bit trên Buffer — hash nhanh, đủ để phát hiện thay đổi. */
function fnv1a(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Hash CHỈ những trường ảnh hưởng tới cài đặt — KHÔNG hash cả package.json.
 *
 * `version` bị postbuild đổi mỗi lần build; hash cả file sẽ khiến mỗi lần chạy
 * lại tưởng "deps đã đổi" → npm ci lại (1–3 phút). Vì vậy chỉ lấy
 * dependencies + devDependencies + overrides + engines/packageManager, cộng
 * hash lockfile (cố định khi deps không đổi).
 */
function depsHash() {
  const parts = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const relevant = JSON.stringify({
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      overrides: pkg.overrides ?? {},
      packageManager: pkg.packageManager ?? "",
      engines: pkg.engines ?? {},
    });
    parts.push(`pkg:${fnv1a(Buffer.from(relevant, "utf8"))}`);
  } catch {
    parts.push("pkg:unreadable");
  }
  if (existsSync(lockPath)) {
    const buf = readFileSync(lockPath);
    parts.push(`lock:${buf.length}:${fnv1a(buf)}`);
  } else {
    parts.push("lock:missing");
  }
  return parts.join("|");
}

function newestMtime(paths) {
  let newest = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) {
      let inner = newestMtime(readdirSync(p).map((f) => join(p, f)));
      newest = Math.max(newest, inner);
    } else {
      newest = Math.max(newest, st.mtimeMs);
    }
  }
  return newest;
}

function installDeps() {
  step(2, "Cài dependencies");

  if (OPT.reinstall && existsSync(join(ROOT, "node_modules"))) {
    warn("--reinstall: xoá node_modules…");
    runSync(IS_WIN ? "cmd" : "rm", IS_WIN ? ["/c", "rmdir", "/s", "/q", "node_modules"] : ["-rf", "node_modules"]);
  }

  const hasModules = existsSync(join(ROOT, "node_modules", "next"));
  const want = depsHash();
  const have = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : null;

  if (hasModules && have === want && !OPT.reinstall) {
    ok("Dependencies đã đúng phiên bản — bỏ qua");
    return;
  }
  if (hasModules && have !== want) warn("package.json / lockfile đã thay đổi — cài lại");
  if (!hasModules) dim("chưa có node_modules — cài mới (có thể mất 1–3 phút)");

  // npm ci: cài đúng theo lockfile, nhanh và tái lập được. Không có lock → npm install.
  const useCi = existsSync(lockPath);
  const args = useCi ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"];
  dim(`chạy: npm ${args.join(" ")}`);

  let code = runSync(NPM, args, { timeout: 0 });
  if (code !== 0 && useCi) {
    // npm ci xoá node_modules trước khi cài — nếu hỏng (lock lệch) thì thử npm install.
    warn("npm ci thất bại — thử npm install");
    code = runSync(NPM, ["install", "--no-audit", "--no-fund"]);
  }
  if (code !== 0) {
    die(
      "Cài dependencies thất bại.",
      [
        "Cách xử lý thường gặp:",
        "  • Kiểm tra mạng/proxy rồi chạy lại.",
        "  • Xoá cache:  npm cache clean --force",
        "  • Thử lại từ đầu:  node run.mjs --reinstall",
      ].join("\n"),
    );
  }
  // Ghi mốc hash — lần sau bỏ qua nếu không đổi.
  try {
    writeFileSync(stampPath, want + "\n");
  } catch {
    /* không ghi được cũng không sao, chỉ là cài lại */
  }
  ok("Đã cài dependencies");
}

// ───────────────────────────── 3. build production ────────────────────────────
const nextDir = join(ROOT, ".next");
const buildIdPath = join(nextDir, "BUILD_ID");

function buildApp() {
  if (OPT.dev) {
    dim("chế độ --dev: không cần build");
    return;
  }
  step(3, "Build production");

  const built = existsSync(buildIdPath);
  if (OPT.noBuild) {
    if (!built) die("--no-build nhưng chưa có .next/BUILD_ID.", "Bỏ --no-build hoặc chạy build trước.");
    ok("Dùng build sẵn có (--no-build)");
    return;
  }
  if (built && !OPT.rebuild) {
    /**
     * Mốc "mã nguồn": CHỈ các file/thư mục ảnh hưởng tới nội dung build.
     * KHÔNG gồm package.json — postbuild tự tăng `version` sau mỗi build nên
     * mtime của nó luôn mới hơn BUILD_ID → sẽ build lại vô ích mỗi lần chạy.
     * Thay đổi dependency đã được xử lý riêng ở bước 2 (deps-stamp).
     */
    const srcNewest = newestMtime([
      join(ROOT, "src"),
      join(ROOT, "public"),
      join(ROOT, "next.config.ts"),
      join(ROOT, "tailwind.config.ts"),
      join(ROOT, "postcss.config.mjs"),
      join(ROOT, "tsconfig.json"),
    ]);
    if (srcNewest <= statSync(buildIdPath).mtimeMs) {
      ok("Build đã mới nhất — bỏ qua (dùng --rebuild để build lại)");
      return;
    }
    warn("Mã nguồn mới hơn build gần nhất — build lại");
  }

  dim("chạy: npm run build");
  const code = runSync(NPM, ["run", "build"]);
  if (code !== 0) {
    die(
      "Build thất bại.",
      [
        "Gợi ý:",
        "  • Xem lỗi TypeScript phía trên:  npm run typecheck",
        "  • Build sạch (xoá cache):  xoá thư mục .next rồi chạy lại",
        IS_WIN ? "  • Windows: nếu lỗi đường dẫn quá dài, bật LongPathsEnabled." : "  • Linux: kiểm tra dung lượng đĩa (df -h).",
      ].join("\n"),
    );
  }
  ok("Build xong");
}

// ─────────────────────────────── 4. chọn cổng ─────────────────────────────────
/** Cổng có ai đang LISTEN không? Dùng net ổ socket của Node (không cần lsof/netstat). */
function isPortBusy(port) {
  const res = spawnSync(
    process.execPath,
    [
      "-e",
      `const net=require('net');const s=net.createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen(${port},'127.0.0.1');setTimeout(()=>process.exit(1),1500);`,
    ],
    { encoding: "utf8", timeout: 4000 },
  );
  return res.status !== 0;
}

async function httpOk(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Tìm PID đang giữ cổng (Linux: ss/lsof; Windows: netstat). Trả null nếu không xác định. */
function pidOnPort(port) {
  try {
    if (IS_WIN) {
      const r = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
      const line = String(r.stdout)
        .split(/\r?\n/)
        .find((l) => l.includes(`:${port} `) && /LISTEN/i.test(l));
      const pid = line ? line.trim().split(/\s+/).pop() : null;
      return pid && /^\d+$/.test(pid) ? Number(pid) : null;
    }
    const ss = spawnSync("ss", ["-tlnp"], { encoding: "utf8" });
    const line = String(ss.stdout)
      .split("\n")
      .find((l) => l.includes(`:${port} `));
    const m = line && line.match(/pid=(\d+)/);
    if (m) return Number(m[1]);
    const lsof = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    const p = String(lsof.stdout).trim().split("\n")[0];
    return p && /^\d+$/.test(p) ? Number(p) : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  if (!pid) return false;
  if (IS_WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", shell: false });
  else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return false;
    }
  }
  return true;
}

async function choosePort() {
  step(4, "Chọn cổng");

  if (OPT.port) {
    const busy = isPortBusy(OPT.port);
    if (busy) {
      if (OPT.force) {
        const pid = pidOnPort(OPT.port);
        warn(`Cổng ${OPT.port} đang bận (pid ${pid ?? "?"}) — --force: kill`);
        killPid(pid);
        await sleep(700);
      } else if (await httpOk(OPT.port)) {
        die(
          `Cổng ${OPT.port} đã có app trả lời HTTP 200 — có thể app đang chạy sẵn.`,
          [
            `Mở http://localhost:${OPT.port} để dùng ngay, hoặc:`,
            "  • Tắt tiến trình cũ rồi chạy lại, hoặc",
            `  • Chạy cổng khác:  node run.mjs --port=${OPT.port + 1}`,
          ].join("\n"),
        );
      } else {
        die(
          `Cổng ${OPT.port} đang bận.`,
          [`Dùng cổng khác:  node run.mjs --port=${OPT.port + 1}`, `Hoặc kill tiến trình cũ:  node run.mjs --port=${OPT.port} --force`].join("\n"),
        );
      }
    }
    ok(`Cổng ${OPT.port} trống`);
    return OPT.port;
  }

  for (let i = 0; i < PORT_TRIES; i++) {
    const port = DEFAULT_PORT + i;
    if (!isPortBusy(port)) {
      ok(port === DEFAULT_PORT ? `Cổng ${port} (mặc định)` : `Cổng ${DEFAULT_PORT} bận → dùng ${port}`);
      if (port !== DEFAULT_PORT) {
        warn(`Đổi cổng đổi origin → IndexedDB dữ liệu cũ KHÔNG dùng được ở cổng mới.`);
      }
      return port;
    }
    dim(`cổng ${port} bận, thử tiếp…`);
  }
  die(`Không còn cổng trống trong ${DEFAULT_PORT}…${DEFAULT_PORT + PORT_TRIES - 1}.`, "Tắt bớt tiến trình rồi chạy lại.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── 5. chạy app và chờ HTTP ──────────────────────────
async function startApp(port) {
  step(5, OPT.dev ? "Chạy dev server" : "Chạy app (production)");

  /**
   * Gọi binary `next` trong node_modules/.bin TRỰC TIẾP.
   * ⚠️ Không dùng `npm exec next start -p N`: npm exec hiểu `-p` là `--package`
   * và nuốt số cổng thành tên gói/thư mục → "Invalid project directory …/3210".
   * Windows có file next.cmd nên phải chạy qua shell.
   */
  const binDir = join(ROOT, "node_modules", ".bin");
  const nextBin = join(binDir, IS_WIN ? "next.cmd" : "next");
  if (!existsSync(nextBin)) {
    die("Không thấy binary next trong node_modules/.bin.", "Cài lại dependencies: node run.mjs --reinstall");
  }
  const args = OPT.dev ? ["dev", "-p", String(port)] : ["start", "-p", String(port)];

  dim(`chạy: next ${args.join(" ")}`);
  const child = spawn(nextBin, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WIN,
    env: { ...process.env, PORT: String(port) },
  });

  // Chờ tối đa 60s cho tới khi HTTP 200 — Next cần vài giây để sẵn sàng.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    await sleep(800);
    if (child.exitCode !== null) break;
    if (await httpOk(port)) {
      ready = true;
      break;
    }
  }

  const url = `http://localhost:${port}`;
  if (!ready) {
    fail("Server chưa trả HTTP 200 sau 60s.");
    if (child.exitCode === null) {
      dim("Tiến trình vẫn chạy — kiểm tra log phía trên rồi mở thủ công: " + url);
      // Treo ở đây để log tiếp tục hiển thị cho người dùng
      await new Promise(() => {});
    }
    die("Server thoát khi khởi động.", "Xem log phía trên. Nếu là lỗi cổng, dùng --port=… hoặc --force.");
  }

  log("");
  log(`${C.g}${C.b}══════════════════════════════════════════════════════════${C.r}`);
  log(`${C.g}${C.b}  App đã chạy:  ${C.cy}${url}${C.r}`);
  log(`${C.g}${C.b}══════════════════════════════════════════════════════════${C.r}`);
  log("");
  log(`  ${C.b}Việc cần làm ngay:${C.r}`);
  log(`    • Mở ${C.cy}${url}${C.r} trong Chrome/Edge (bắt buộc với webcam).`);
  log(`    • Lần đầu: tạo bài thi ở mục ${C.b}Quản lý đáp án${C.r} rồi import file Excel đáp án.`);
  log(`    • Chấm bài ở mục ${C.b}Chấm bài${C.r} → upload ảnh hoặc bật webcam.`);
  log("");
  log(`  ${C.dim}Nhấn Ctrl+C để dừng. Dữ liệu nằm trong IndexedDB của trình duyệt tại origin này.${C.r}`);
  log(`  ${C.dim}Sau mỗi lần build lại: tải lại trang 1 lần (service worker).${C.r}`);
  log("");

  const stop = () => {
    log(`\n${C.y}Đang dừng…${C.r}`);
    try {
      if (IS_WIN) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch {
      /* bỏ qua */
    }
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    log(`\n${C.dim}Server dừng (exit ${code ?? 0}).${C.r}`);
    process.exit(code ?? 0);
  });
  await new Promise(() => {}); // giữ tiến trình sống
}

// ──────────────────────────────── 6. test (tuỳ chọn) ──────────────────────────
function runTests() {
  step("4b", "Chạy test suite");
  // Gọi binary vitest trực tiếp (tránh `npx` nuốt tham số như trường hợp next).
  const bin = join(ROOT, "node_modules", ".bin", IS_WIN ? "vitest.cmd" : "vitest");
  if (!existsSync(bin)) {
    warn("Không thấy vitest — bỏ qua test");
    return;
  }
  const code = spawnSync(bin, ["run", "--maxWorkers=1"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: IS_WIN,
  }).status;
  if (code !== 0) warn("Có test fail — vẫn tiếp tục chạy app (xem log phía trên).");
  else ok("Test pass");
}

// ────────────────────────────────── main ──────────────────────────────────────
function printHelp() {
  log(`
${C.b}Chạy app chấm thi OMR — một file dùng cho Linux và Windows${C.r}

  node run.mjs [tuỳ chọn]

  --dev              chạy next dev (có hot-reload, không cần build)
  --no-build         dùng .next sẵn có, không build
  --rebuild          build lại kể cả khi đã mới
  --reinstall        xoá node_modules rồi cài lại
  --port=<n>         cổng cụ thể (mặc định ${DEFAULT_PORT})
  --test             chạy vitest trước khi chạy app
  --force            cổng bận thì kill tiến trình đang giữ cổng
  --help             in trợ giúp này

  Ví dụ:
    node run.mjs                    # cài + build + chạy ở cổng ${DEFAULT_PORT}
    node run.mjs --port=3211        # chạy cổng khác
    node run.mjs --port=${DEFAULT_PORT} --force   # kill server cũ rồi chạy lại
    node run.mjs --dev              # chế độ phát triển
`);
}

async function main() {
  if (OPT.help) return printHelp();

  log(`\n${C.b}${C.cy}  CHẤM THI OMR — khởi động tự động${C.r}`);
  log(`${C.dim}  thư mục: ${ROOT}${C.r}`);
  log(`${C.dim}  hệ thống: ${process.platform} ${process.arch}${C.r}`);

  if (!existsSync(pkgPath)) die(`Không thấy package.json trong ${ROOT}.`, "Chạy script này từ thư mục gốc của project.");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  dim(`phiên bản app: ${pkg.version ?? "?"} · ${pkg.name ?? ""}`);

  checkToolchain();
  installDeps();
  buildApp();
  if (OPT.test) runTests();
  const port = await choosePort();
  await startApp(port);
}

main().catch((err) => {
  fail(err?.stack ?? String(err));
  die("Khởi động thất bại.");
});
