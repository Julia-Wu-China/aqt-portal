#!/usr/bin/env node
/**
 * _publish.js — 爱优特门户「一键发布」脚本（中转模式）
 *
 * 用法（在当前文件夹里执行）：
 *   node _publish.js "你的改动说明"
 *
 * 原理：
 *   当前文件夹是企微微盘同步目录，WeDrive 会在 .git/refs 里放占位文件，
 *   导致 git 引用写不进去 —— 所以不能在这里直接跑 git。
 *   本脚本改用「中转」：把改好的文件同步到一个本地隐藏仓库
 *   （C:\Users\Administrator\.aqt-portal-git\），在那里提交并推送到
 *   GitHub 仓库 main 分支，Render 服务 aqt-portal 监听到 push 自动部署。
 *
 * 发布链路：
 *   当前文件夹(改代码) → 同步 → 本地中转仓库 → git push →
 *   GitHub: https://github.com/Julia-Wu-China/aqt-portal.git (main)
 *   → Render 自动部署（服务名 aqt-portal，已存在，勿新建）→ https://aqtapp.airquality.com.cn
 *
 * 注意：
 *   - 备份包/ 、data/ 、.env 、node_modules 、.WeDrive 不会被同步/推送
 *   - 推送需要 GitHub 凭据：首次可能弹出登录窗口；失败则向门户管理员要 Token
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_URL = 'https://github.com/Julia-Wu-China/aqt-portal.git';
const BRANCH = 'main';
const WB_DIR = __dirname;                       // 当前（微盘）文件夹
const REPO_DIR = path.join(os.homedir(), '.aqt-portal-git'); // 本地中转仓库（不在微盘里）

// 不同步/不推送的目录或文件（顶层名称匹配）
const EXCLUDE = new Set(['.git', '备份包', 'data', '.env', 'node_modules', '.WeDrive', 'README-部署说明.md']);

function sh(cmd, cwd) {
  console.log('\n$ ' + cmd);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (EXCLUDE.has(name)) continue;
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function isExcluded(relPath) {
  return relPath.split(path.sep).some(seg => EXCLUDE.has(seg));
}

// 0. 提交说明
const msg = (process.argv[2] || '').trim();
if (!msg) {
  console.error('请提供提交说明，例如：node _publish.js "修复登录问题"');
  process.exit(1);
}

// 1. 准备本地中转仓库（首次 clone，之后对齐远端）
if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
  console.log('· 首次运行：克隆 GitHub 仓库到本地中转目录…');
  fs.mkdirSync(path.dirname(REPO_DIR), { recursive: true });
  sh('git clone ' + REPO_URL + ' "' + REPO_DIR + '"', path.dirname(REPO_DIR));
} else {
  console.log('· 同步本地中转仓库到远端最新状态…');
  sh('git fetch origin', REPO_DIR);
  sh('git reset --hard origin/' + BRANCH, REPO_DIR);
}

// 2. 镜像同步：微盘文件夹 → 中转仓库
console.log('\n· 正在同步改动文件（' + WB_DIR + ' → 中转仓库）…');
for (const name of fs.readdirSync(WB_DIR)) {
  if (EXCLUDE.has(name)) continue;
  copyRecursive(path.join(WB_DIR, name), path.join(REPO_DIR, name));
}
// 删除中转仓库里已被移除（或不再同步）的跟踪文件
const tracked = execSync('git ls-files', { cwd: REPO_DIR }).toString().trim().split('\n').filter(Boolean);
let removed = 0;
for (const f of tracked) {
  if (isExcluded(f) || !fs.existsSync(path.join(WB_DIR, f))) {
    const dst = path.join(REPO_DIR, f);
    if (fs.existsSync(dst)) { fs.rmSync(dst, { force: true }); removed++; }
  }
}
console.log('· 同步完成' + (removed ? '（清理 ' + removed + ' 个已移除文件）' : ''));

// 3. 提交
sh('git add -A', REPO_DIR);
const msgFile = path.join(os.tmpdir(), 'aqt_commit_msg_' + Date.now() + '.txt');
fs.writeFileSync(msgFile, msg, 'utf8');
try {
  sh('git commit -F "' + msgFile + '"', REPO_DIR);
} catch {
  console.log('\n· 提示：没有可提交的改动（文件与线上一致）');
}
fs.unlinkSync(msgFile);

// 4. 推送
try {
  sh('git push origin ' + BRANCH, REPO_DIR);
} catch (e) {
  console.error('\n❌ 推送失败。常见原因：\n  1. 本机没有 GitHub 登录凭据 → 首次推送会弹登录窗口，请登录 Julia-Wu-China 账号或提供 Token\n  2. 网络问题 → 重试一次\n  3. 其他 → 把上面报错发给门户管理员');
  process.exit(1);
}

// 5. 完成提示
console.log('\n✅ 已推送到 GitHub 仓库 aqt-portal 的 ' + BRANCH + ' 分支');
console.log('Render 服务 aqt-portal 正在自动部署，1-3 分钟后生效。');
console.log('\n验证命令：');
console.log('  curl -s https://aqtapp.airquality.com.cn/api/portal-data');
console.log('  curl -s https://aqtapp.airquality.com.cn/api/store/status');
console.log('\n期望结果：categories=14、apps=10、storeMode=pg、store 非空。');
