/**
 * 爱优特应用门户 - 企业微信通讯录对接后端（零依赖，Node.js 原生）
 * 部署在 aqtapp.airquality.com.cn，提供 /api/departments /api/users
 * 读取公司企业微信通讯录（部门 + 成员），供前端门户调用
 *
 * 启动：node server.js
 *   或带环境变量：
 *   WECOM_CONTACT_SECRET=xxx ADMIN_USERIDS=zhangsan,lisi node server.js
 */

// ===== 加载本地 .env（零依赖；生产环境用真实环境变量，优先级更高） =====
try {
  const fs = require('fs'), p = require('path');
  const envFile = p.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  }
} catch (e) { /* .env 读取失败不阻断启动 */ }

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== 凭证配置 =====
const CORPID = process.env.WECOM_CORPID || '';
const CONTACT_SECRET = process.env.WECOM_CONTACT_SECRET || '';
const APP_SECRET = process.env.WECOM_APP_SECRET || '';
const AGENT_ID = process.env.WECOM_AGENT_ID || '';
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://aqtapp.airquality.com.cn';
// 门户管理员密码：仅存于服务端环境变量，绝不写入前端源码。
// 规则：任何企微账号输入正确密码即可成为全局管理员（无账号白名单限制）。
// 生产环境请在 Render 服务 Environment 中配置 ADMIN_PASSWORD。
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// 门户数据持久化：配置 DATABASE_URL（Render Postgres）后使用 PostgreSQL 存储；
// 未配置时回退到本地 JSON 文件（data/portal-store.json，注意 Render 免费实例磁盘重启会清空）。
const DATABASE_URL = process.env.DATABASE_URL || '';

// ===== access_token 缓存（企微 token 有效期 7200s，提前 200s 续） =====
let tokenCache = { token: null, expire: 0 };
let appTokenCache = { token: null, expire: 0 };

function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expire) {
    return Promise.resolve(tokenCache.token);
  }
  return new Promise((resolve, reject) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORPID}&corpsecret=${CONTACT_SECRET}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.errcode) {
            reject(new Error(`gettoken errcode=${r.errcode}: ${r.errmsg}`));
            return;
          }
          tokenCache = { token: r.access_token, expire: Date.now() + (r.expires_in - 200) * 1000 };
          resolve(r.access_token);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function callWecom(apiPath) {
  return getAccessToken().then(token => new Promise((resolve, reject) => {
    const sep = apiPath.includes('?') ? '&' : '?';
    const url = `https://qyapi.weixin.qq.com/cgi-bin${apiPath}${sep}access_token=${token}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  }));
}

// ===== 应用 access_token（用于 OAuth 网页授权） =====
function getAppAccessToken() {
  if (appTokenCache.token && Date.now() < appTokenCache.expire) {
    return Promise.resolve(appTokenCache.token);
  }
  return new Promise((resolve, reject) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORPID}&corpsecret=${APP_SECRET}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.errcode) { reject(new Error(`app gettoken errcode=${r.errcode}: ${r.errmsg}`)); return; }
          appTokenCache = { token: r.access_token, expire: Date.now() + (r.expires_in - 200) * 1000 };
          resolve(r.access_token);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ===== OAuth：用 code 换取 userid =====
async function getUseridByCode(code) {
  const token = await getAppAccessToken();
  return new Promise((resolve, reject) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token}&code=${code}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.errcode) { reject(new Error(`getuserinfo errcode=${r.errcode}: ${r.errmsg}`)); return; }
          resolve(r.userid || null);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ===== Token 生成与解析 =====
function makeToken(userId) {
  const payload = JSON.stringify({ userId, ts: Date.now() });
  return 'wecom.' + Buffer.from(payload).toString('base64');
}
function parseToken(token) {
  if (!token || !token.startsWith('wecom.')) return null;
  try { return JSON.parse(Buffer.from(token.replace(/^wecom\./, ''), 'base64').toString()); }
  catch { return null; }
}
// 管理员 token：独立前缀 admin.，payload 为 {userId:'portal_admin', ts} 的 base64，
// 并附带 HMAC-SHA256 签名（密钥为 ADMIN_PASSWORD）。无密码或签名错误均视为无效，
// 防止任何人构造 admin token 调用管理接口。
function makeAdminToken() {
  if (!ADMIN_PASSWORD) return null;
  const payload = Buffer.from(JSON.stringify({ userId: 'portal_admin', ts: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex').slice(0, 16);
  return 'admin.' + payload + '.' + sig;
}
function parseAdminToken(token) {
  if (!token || !token.startsWith('admin.')) return null;
  if (!ADMIN_PASSWORD) return null;
  try {
    const parts = token.replace(/^admin\./, '').split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expect = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex').slice(0, 16);
    if (sig !== expect) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64').toString());
    return (p && p.userId === 'portal_admin') ? p : null;
  } catch { return null; }
}
function readBody(req) {
  return new Promise(resolve => { let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d)); });
}

// ===== 部门配色池（企微部门无颜色字段，门户自定义） =====
const COLOR_POOL = [
  { primary: '#1E6FBA', soft: '#E6F0FA' },
  { primary: '#D04545', soft: '#FBE9E9' },
  { primary: '#2E8B57', soft: '#E6F4EC' },
  { primary: '#7B4FBA', soft: '#F0EAF7' },
  { primary: '#B5690D', soft: '#FBF1E0' },
  { primary: '#0E8C9B', soft: '#E0F3F5' },
  { primary: '#4A5B6B', soft: '#ECEFF2' },
  { primary: '#9B2B5A', soft: '#F7E6EE' },
];
const colorFor = id => COLOR_POOL[Math.abs(id) % COLOR_POOL.length];

// ===== 业务接口 =====
async function getDepartments() {
  const r = await callWecom('/department/list');
  if (r.errcode) throw new Error(`department/list errcode=${r.errcode}: ${r.errmsg}`);
  return (r.department || []).map(d => {
    const c = colorFor(d.id);
    // 透传 parentid（企微根部门 parentid=1 自指），前端据此计算部门层级深度
    return { id: d.id, name: d.name, parent_id: (d.parentid != null ? d.parentid : null), color_primary: c.primary, color_soft: c.soft };
  });
}

async function getUsers() {
  // department_id=1 是根部门，fetch_child=1 递归取全部子部门成员
  const r = await callWecom('/user/list?department_id=1&fetch_child=1');
  if (r.errcode) throw new Error(`user/list errcode=${r.errcode}: ${r.errmsg}`);
  const map = new Map();
  (r.userlist || []).forEach(u => { if (!map.has(u.userid)) map.set(u.userid, u); });
  return Array.from(map.values()).map(u => {
    const deptIds = u.department || [];
    const leaderFlags = u.is_leader_in_dept || [];
    const leadDepts = deptIds.filter((_, i) => leaderFlags[i] === 1);
    return {
      id: 'wecom_' + u.userid,
      wecom_userid: u.userid,
      name: u.name || u.userid,
      dept_ids: deptIds,
      lead_dept_ids: leadDepts,
      is_super_admin: 0   // 全局管理员由门户密码登录独立判定，不来自企微通讯录
    };
  });
}

// ===== 门户数据持久化存储（PostgreSQL 优先，本地 JSON 文件回退） =====
// 数据结构：单行 KV，key='portal'，value 为整体 JSON：
//   { version: <乐观锁版本号>, categories: [...], apps: [...], trash: [...] }
// 版本号用于防止并发覆盖：前端 PUT 时必须携带其拉取时的 version，
// 若与服务端当前 version 不一致则返回 409 + 最新数据，前端刷新后重试。
const STORE_FILE = path.join(__dirname, 'data', 'portal-store.json');
const DEFAULT_STORE = { version: 1, categories: [], apps: [], trash: [] };
let storeMode = 'file';
let pgPool = null;

if (DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL !== '0' ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000,
      max: 5
    });
    storeMode = 'pg';
  } catch (e) {
    console.error('[store] pg 库加载失败，回退本地文件存储：' + e.message);
  }
}

async function initStore() {
  if (storeMode === 'pg') {
    try {
      await pgPool.query(
        'CREATE TABLE IF NOT EXISTS portal_store (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at BIGINT NOT NULL)'
      );
      await pgPool.query(
        'CREATE TABLE IF NOT EXISTS portal_store_backup (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at BIGINT NOT NULL)'
      );
      console.log('[store] PostgreSQL 存储就绪');
      return;
    } catch (e) {
      console.error('[store] PostgreSQL 建表失败，回退本地文件存储：' + e.message);
      storeMode = 'file';
    }
  }
  console.log('[store] 本地文件存储：' + STORE_FILE + (DATABASE_URL ? '（DATABASE_URL 连接失败，数据重启可能丢失）' : '（未配置 DATABASE_URL，生产请配置 Render Postgres）'));
}

/* 存储架构（2026-08-20 加固，解决「PUT 200 但数据读不回」）：
   - 双写：PG 与本地文件都写。PG 失败不阻断文件写入。
   - 读取：PG 优先；PG 无数据时回退读文件；文件有数据且 PG 可用时回填 PG。
   - 回读自校验：writeStore 写完后立即 readStore 校验，读不到就抛错，前端才能感知失败。 */
async function readStoreFromPg() {
  if (storeMode !== 'pg') return null;
  try {
    const r = await pgPool.query('SELECT value FROM portal_store WHERE key=$1', ['portal']);
    if (r.rows.length === 0) return null;
    const v = JSON.parse(r.rows[0].value);
    return (v && v.categories && v.apps) ? v : null;
  } catch (e) { console.error('[store] PostgreSQL 读取失败：' + e.message); return null; }
}
function readStoreFromFile() {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const v = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return (v && v.categories && v.apps) ? v : null;
  } catch (e) { console.error('[store] 文件读取失败：' + e.message); return null; }
}
async function writeStoreToPg(store) {
  if (storeMode !== 'pg') return false;
  try {
    await pgPool.query(
      'INSERT INTO portal_store (key, value, updated_at) VALUES ($1,$2,$3) ' +
      'ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=$3',
      ['portal', JSON.stringify(store), Date.now()]
    );
    return true;
  } catch (e) { console.error('[store] PostgreSQL 写入失败：' + e.message); return false; }
}
function writeStoreToFile(store) {
  try {
    if (!fs.existsSync(path.dirname(STORE_FILE))) fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
    return true;
  } catch (e) { console.error('[store] 文件写入失败：' + e.message); return false; }
}

async function readStore() {
  let fromPg = await readStoreFromPg();
  if (fromPg) return fromPg;
  const fromFile = readStoreFromFile();
  if (fromFile) {
    // 文件有数据但 PG 没有 → 回填 PG（双写兜底自愈）
    if (storeMode === 'pg') { writeStoreToPg(fromFile); }
    return fromFile;
  }
  return null;
}

/* 回退读取备份：主存储（PG+文件）都读不到时，尝试从备份恢复现场数据。
   用途：防止 Render 免费 PG 假空 / 实例重启丢文件时，把"空库"返回给前端，
   触发种子注入（种子 apps=[]）把真实数据覆盖成 0 应用。 */
async function readBackup() {
  if (storeMode === 'pg') {
    try {
      const r = await pgPool.query('SELECT value FROM portal_store_backup WHERE key=$1', ['portal']);
      if (r.rows.length > 0) {
        const v = JSON.parse(r.rows[0].value);
        if (v && v.categories && v.apps) return v;
      }
    } catch (e) { console.error('[store] 备份表读取失败：' + e.message); }
  }
  try {
    const backupFile = STORE_FILE.replace('.json', '-backup.json');
    if (fs.existsSync(backupFile)) {
      const v = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
      if (v && v.categories && v.apps) return v;
    }
  } catch (e) { console.error('[store] 备份文件读取失败：' + e.message); }
  return null;
}

async function writeStore(store) {
  const pgOk = await writeStoreToPg(store);   // PG 失败不阻断
  const fileOk = writeStoreToFile(store);     // 文件始终写（双保险）
  if (!pgOk && !fileOk) {
    throw new Error('数据存储失败：PostgreSQL 与本地文件均写入失败');
  }
  // 回读自校验：写入后必须能读回，否则视为失败（杜绝「PUT 200 但数据丢失」）
  const back = await readStore();
  if (!back || (back.version !== store.version) ||
      (back.categories || []).length !== (store.categories || []).length ||
      (back.apps || []).length !== (store.apps || []).length) {
    throw new Error('数据写入后无法读回（存储不一致），请检查 DATABASE_URL 配置或磁盘权限');
  }
  if (!pgOk) console.warn('[store] PG 不可用，已写本地文件（部署/重启会丢，请配置 DATABASE_URL）');
}

function isAuthed(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  return !!(parseAdminToken(token) || parseToken(token));
}

// ===== 静态文件（Render 同域托管前端，消除跨域与 GitHub Pages 不稳定问题） =====
const INDEX_HTML = fs.existsSync(path.join(__dirname, 'index.html'))
  ? fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  : '<!DOCTYPE html><html><body><h1>index.html 未找到</h1></body></html>';
const VERIFY_FILES = {};
['WW_verify_aluUvkMMhpVILogR.txt'].forEach(f => {
  const fp = path.join(__dirname, f);
  if (fs.existsSync(fp)) VERIFY_FILES['/' + f] = fs.readFileSync(fp, 'utf8');
});

// ===== HTTP 服务 =====
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];
  const query = new URLSearchParams(req.url.split('?')[1] || '');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  // OAuth 授权跳转（不需要 CONTACT_SECRET）
  if (url === '/api/auth/wecom/authorize' && req.method === 'GET') {
    if (!APP_SECRET || !AGENT_ID) { json(500, { error: '未配置应用 Secret 或 AgentId' }); return; }
    const redirectUri = encodeURIComponent(FRONTEND_URL + '/');
    const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${CORPID}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=aqt&agentid=${AGENT_ID}#wechat_redirect`;
    res.writeHead(302, { Location: authUrl }); res.end(); return;
  }

  // 企微可信域名校验文件
  if (req.method === 'GET' && VERIFY_FILES[url]) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(VERIFY_FILES[url]); return;
  }
  // 前端页面（同域托管）；禁用缓存，避免 CDN/浏览器缓存旧版页面导致问题反复出现
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(INDEX_HTML); return;
  }

  // ===== 门户数据持久化（分类 / 应用 / 回收站，全公司共享） =====
  // GET：无需鉴权（内部系统，数据不敏感）；PUT：必须已登录（wecom. / admin. token）
  if (url === '/api/portal-data' && req.method === 'GET') {
    let store = await readStore();
    // 空库保护（2026-08-21 加固）：主存储读不到且备份有历史数据时，返回 503 而不是"假空"。
    // 前端收到 503 会保留本地数据并提示，绝不触发种子迁移覆盖（种子 apps=[] 曾导致应用全丢）。
    if (!store) {
      const backup = await readBackup();
      if (backup) {
        json(503, {
          error: '数据暂不可用（存储恢复中），请稍后刷新页面',
          backup: {
            version: backup.version,
            categories: (backup.categories || []).length,
            apps: (backup.apps || []).length,
            trash: (backup.trash || []).length
          }
        });
        return;
      }
      // 备份也没有：真空库（全新部署），正常返回空结构
      json(200, JSON.parse(JSON.stringify(DEFAULT_STORE)));
      return;
    }
    json(200, store);
    return;
  }
  // 存储诊断端点（内部排查用）：查看存储模式 / PG 状态 / 文件状态 / 当前数据摘要
  if (url === '/api/store/status' && req.method === 'GET') {
    const fileInfo = fs.existsSync(STORE_FILE) ? { exists: true, bytes: fs.statSync(STORE_FILE).size } : { exists: false };
    let pgOk = null;
    if (storeMode === 'pg') {
      try {
        const r = await pgPool.query('SELECT 1 AS ok');
        pgOk = r.rows.length > 0;
      } catch (e) { pgOk = false; }
    }
    const store = await readStore();
    let backupInfo = { exists: false };
    let pgDiag = null;
    try {
      if (storeMode === 'pg') {
        const br = await pgPool.query('SELECT updated_at FROM portal_store_backup WHERE key=$1', ['portal']);
        if (br.rows.length > 0) backupInfo = { exists: true, updated_at: br.rows[0].updated_at };
        // 深度诊断：直接查两张表的行数与 value 摘要（排查主表写入是否真的落盘）
        const mainRow = await pgPool.query('SELECT key, length(value::text) AS len, left(value::text, 120) AS head FROM portal_store WHERE key=$1', ['portal']);
        const bakRow = await pgPool.query('SELECT key, length(value::text) AS len, left(value::text, 120) AS head FROM portal_store_backup WHERE key=$1', ['portal']);
        pgDiag = {
          mainTable: mainRow.rows.length > 0 ? { len: mainRow.rows[0].len, head: mainRow.rows[0].head } : { len: 0, head: '(无行)' },
          backupTable: bakRow.rows.length > 0 ? { len: bakRow.rows[0].len, head: bakRow.rows[0].head } : { len: 0, head: '(无行)' }
        };
      }
      const backupFile = STORE_FILE.replace('.json', '-backup.json');
      if (fs.existsSync(backupFile)) backupInfo.file = { exists: true, bytes: fs.statSync(backupFile).size };
    } catch (e) { backupInfo.error = e.message; }
    json(200, {
      storeMode,
      pgOk,
      file: fileInfo,
      backup: backupInfo,
      pgDiag,
      store: store ? {
        version: store.version,
        categories: (store.categories || []).length,
        apps: (store.apps || []).length,
        trash: (store.trash || []).length
      } : null,
      tip: storeMode === 'file' ? '当前为文件存储，Render 部署/重启会丢数据，请配置 DATABASE_URL' : 'PostgreSQL 存储'
    });
    return;
  }
  if (url === '/api/portal-data' && req.method === 'PUT') {
    if (!isAuthed(req)) { json(401, { error: '未登录或登录已过期' }); return; }
    let store = await readStore();
    if (!store) store = JSON.parse(JSON.stringify(DEFAULT_STORE));
    const body = JSON.parse(await readBody(req) || '{}');
    const clientVer = Number(body.version) || 0;
    const hasData = (store.categories || []).length > 0 || (store.apps || []).length > 0 || (store.trash || []).length > 0;
    if (clientVer !== store.version && hasData) {
      // 乐观锁冲突：返回最新数据，前端刷新本地并提示用户重试（防止静默覆盖他人修改）
      json(409, Object.assign({ error: '数据已被他人修改' }, store));
      return;
    }
    // 破坏性变更保护：当前存在应用且请求把 apps 清空时，拒绝写入（防止误操作/恶意清空）。
    // 仅当 URL 带 ?force=1 时允许。
    const currentApps = (store.apps || []).length;
    const incomingApps = Array.isArray(body.apps) ? body.apps.length : currentApps;
    if (currentApps > 0 && incomingApps === 0 && query.get('force') !== '1') {
      json(400, { error: '检测到清空全部应用的操作，已被拒绝。如需强制清空，请在请求中添加 ?force=1' });
      return;
    }
    // 空库防覆盖（2026-08-21 加固，第二道保险）：主存储当前读不到数据（PG 假空/文件丢失），
    // 但备份里有历史数据时，拒绝 0 应用写入。防止前端种子注入（种子 apps=[]）把真实数据覆盖掉。
    if (incomingApps === 0 && !hasData) {
      const backup = await readBackup();
      if (backup && ((backup.apps || []).length > 0 || (backup.categories || []).length > 0) && query.get('force') !== '1') {
        json(400, { error: '服务端暂未读取到主存储数据（可能存储恢复中），为避免覆盖历史数据已拒绝写入。请刷新页面重试；如确需强制覆盖，请使用 ?force=1' });
        return;
      }
    }
    // 写入前先把旧数据备份（本地文件也备份一份）
    const oldStore = JSON.parse(JSON.stringify(store));
    try {
      if (storeMode === 'pg') {
        await pgPool.query(
          'INSERT INTO portal_store_backup (key, value, updated_at) VALUES ($1,$2,$3) ' +
          'ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=$3',
          ['portal', JSON.stringify(oldStore), Date.now()]
        );
      }
      const backupFile = STORE_FILE.replace('.json', '-backup.json');
      fs.writeFileSync(backupFile, JSON.stringify(oldStore, null, 2));
    } catch (backupErr) {
      console.error('[portal-data] 备份失败（继续写入）：', backupErr.message);
    }
    // 空库特许：没有任何真实数据时允许任意 version 写入（解决首次初始化/存储漂移导致的版本号不一致）
    store = {
      version: hasData ? store.version + 1 : 1,
      categories: Array.isArray(body.categories) ? body.categories : store.categories,
      apps: Array.isArray(body.apps) ? body.apps : store.apps,
      trash: Array.isArray(body.trash) ? body.trash : store.trash
    };
    try {
      if (storeMode === 'pg') {
        await pgPool.query(
          'INSERT INTO portal_store_backup (key, value, updated_at) VALUES ($1,$2,$3) ' +
          'ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=$3',
          ['portal', JSON.stringify(store), Date.now()]
        );
      }
      const backupFile = STORE_FILE.replace('.json', '-backup.json');
      fs.writeFileSync(backupFile, JSON.stringify(store, null, 2));
    } catch (backupErr) {
      console.error('[portal-data] 备份失败（继续写入）：', backupErr.message);
    }
    try {
      await writeStore(store);
    } catch (e) {
      console.error('[portal-data] PUT 写入失败：', e.message);
      json(500, { error: '服务端存储失败：' + e.message });
      return;
    }
    json(200, { ok: true, version: store.version });
    return;
  }

  if (!CONTACT_SECRET) {
    json(500, { error: '未配置通讯录同步 Secret（WECOM_CONTACT_SECRET）' });
    return;
  }

  try {
    if (url === '/api/auth/wecom/callback' && req.method === 'GET') {
      const code = query.get('code');
      if (!code) throw new Error('缺少 code 参数');
      const userid = await getUseridByCode(code);
      if (!userid) throw new Error('无法获取用户身份');
      const users = await getUsers();
      const u = users.find(x => x.wecom_userid === userid);
      if (!u) throw new Error('用户不在通讯录中: ' + userid);
      json(200, { token: makeToken(u.id), user: u });
    } else if (url === '/api/auth/me' && req.method === 'GET') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
      if (parseAdminToken(token)) {
        json(200, { user: { id:'portal_admin', wecom_userid:'portal_admin', name:'吴彤', dept_ids:[], lead_dept_ids:[], is_super_admin:1 } });
      } else {
        const p = parseToken(token);
        if (!p) { json(200, { user: null }); return; }
        const users = await getUsers();
        const u = users.find(x => x.id === p.userId);
        json(200, { user: u || null });
      }
    } else if (url === '/api/auth/login' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const users = await getUsers();
      const u = users.find(x => x.wecom_userid === body.wecom_userid);
      if (!u) throw new Error('用户不存在: ' + body.wecom_userid);
      json(200, { token: makeToken(u.id), user: u });
    } else if (url === '/api/auth/admin-login' && req.method === 'POST') {
      // 门户管理员密码登录：任何企微账号输入正确密码即可成为全局管理员。
      // 密码只存在服务端环境变量 ADMIN_PASSWORD，前端源码不含任何密码。
      const body = JSON.parse(await readBody(req) || '{}');
      if (!ADMIN_PASSWORD) {
        json(500, { error: '管理员密码未配置（请在服务端设置 ADMIN_PASSWORD 环境变量）' });
        return;
      }
      if (String(body.password || '') !== ADMIN_PASSWORD) {
        json(401, { error: '管理员密码错误' });
        return;
      }
      json(200, {
        token: makeAdminToken(),
        user: { id: 'portal_admin', wecom_userid: 'portal_admin', name: '吴彤', dept_ids: [], lead_dept_ids: [], is_super_admin: 1 }
      });
    } else if (url === '/api/departments') {
      json(200, { departments: await getDepartments() });
    } else if (url === '/api/users') {
      json(200, { users: await getUsers() });
    } else {
      json(404, { error: 'not found' });
    }
  } catch (e) {
    console.error('[ERROR]', e.message);
    // 企微 60020：服务器出口 IP 不在应用「企业可信IP」白名单 → 返回结构化提示，前端展示给使用方
    const msg = String(e.message);
    const ipMatch = msg.match(/from ip:\s*([\d.]+)/);
    if (ipMatch && /errcode=60020/.test(msg)) {
      const fromIp = ipMatch[1];
      json(500, {
        error: '企业微信拒绝了当前服务器 IP（errcode 60020）',
        code: 'WECOM_IP_NOT_ALLOWED',
        from_ip: fromIp,
        fix_guide: '登录企业微信管理后台 work.weixin.qq.com → 应用管理 → 自建应用 → 爱优特应用门户 → 企业可信IP → 将白名单内原第二条 IP 更换为 ' + fromIp + ' → 保存后等待 5-10 分钟生效'
      });
      return;
    }
    json(500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`爱优特门户后端运行: http://localhost:${PORT}`);
  console.log(`corpid      = ${CORPID}`);
  console.log(`通讯录secret= ${CONTACT_SECRET ? '已配置' : '未配置'}`);
  console.log(`应用secret  = ${APP_SECRET ? '已配置' : '未配置'}`);
  console.log(`agentid     = ${AGENT_ID || '未配置'}`);
  console.log(`前端地址    = ${FRONTEND_URL}`);
  initStore();
});
