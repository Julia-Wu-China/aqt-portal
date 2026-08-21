/**
 * 从用户备份文件恢复门户数据（完整恢复：分类 + 应用 + 回收站）
 * 用法：node _restore_from_backup.js <备份文件路径>
 * 密码：优先取环境变量 ADMIN_PASSWORD，其次读 .env 文件
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------- 配置 ----------
const API_BASE = 'https://aqtapp.airquality.com.cn';
const BACKUP_FILE = process.argv[2] || 'D:/Desktop/爱优特应用门户备份_20260820.json';

// 读取 ADMIN_PASSWORD：环境变量优先，其次 .env
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^ADMIN_PASSWORD=(.+)$/m);
    if (m) ADMIN_PASSWORD = m[1].trim();
  } catch (e) { /* 忽略 */ }
}
if (!ADMIN_PASSWORD) {
  console.error('未找到 ADMIN_PASSWORD，请设置环境变量或 .env');
  process.exit(1);
}

function makeAdminToken() {
  const payload = Buffer.from(JSON.stringify({ userId: 'portal_admin', ts: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex').slice(0, 16);
  return 'admin.' + payload + '.' + sig;
}

function request(method, p, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(API_BASE + p, {
      method,
      headers: Object.assign({
        'Authorization': 'Bearer ' + makeAdminToken(),
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0
      }, extraHeaders || {})
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let obj = null;
        try { obj = JSON.parse(raw); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: obj || raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // 1. 读备份
  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  if (!backup.apps || !backup.categories) {
    console.error('备份文件格式不正确，缺少 apps/categories');
    process.exit(1);
  }
  console.log('备份文件: ' + BACKUP_FILE);
  console.log('  导出时间:', backup.exported_at, '(UTC)');
  console.log('  分类:', backup.categories.length, '个 | 应用:', backup.apps.length, '个');

  // 2. 先看服务端当前状态
  const before = await request('GET', '/api/store/status');
  console.log('\n服务端当前状态:', JSON.stringify(before.body.store || before.body));

  // 3. 构造完整 store（保留备份的分类，追加应用；服务端空库，直接整体覆盖）
  const store = {
    version: 1,                    // 空库特许，服务端会重置为 1
    categories: backup.categories,
    apps: backup.apps,
    trash: []
  };

  // 4. 当前服务端是否有数据（有则必须带正确的 version，避免 409）
  const curStore = before.body.store;
  if (curStore && (curStore.categories > 0 || curStore.apps > 0 || curStore.trash > 0)) {
    // 非空库：带当前 version 走乐观锁
    store.version = curStore.version;
    console.log('\n服务端已有数据（version=' + curStore.version + '），将带 version 覆盖写入');
  } else {
    console.log('\n服务端为空库，直接写入');
  }

  // 5. PUT
  console.log('\n正在恢复数据到线上...');
  const res = await request('PUT', '/api/portal-data', store);
  console.log('PUT 响应:', res.status, JSON.stringify(res.body).slice(0, 300));

  if (res.status !== 200) {
    console.error('\n恢复失败！');
    process.exit(1);
  }

  // 6. 验证
  console.log('\n正在验证...');
  const after = await request('GET', '/api/portal-data');
  if (after.status === 200 && after.body) {
    const d = after.body;
    console.log('验证通过:');
    console.log('  version   =', d.version);
    console.log('  categories=', (d.categories || []).length);
    console.log('  apps      =', (d.apps || []).length);
    console.log('  trash     =', (d.trash || []).length);
    console.log('\n应用列表:');
    (d.apps || []).forEach(a => console.log('  - ' + a.name + ' (分类id=' + a.category_id + ')'));
  } else {
    console.error('验证失败:', after.status, JSON.stringify(after.body));
    process.exit(1);
  }
})().catch(e => { console.error('脚本错误:', e.message); process.exit(1); });
