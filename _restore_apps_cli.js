/**
 * 应用批量恢复脚本（命令行版）
 * 使用方法：
 * 1. 在本文件顶部填写 ADMIN_PASSWORD（你部署在 Render 上的管理员密码）
 * 2. 在 apps 数组里填写要恢复的 10 个应用
 * 3. 运行：node _restore_apps_cli.js
 *
 * 注意：此脚本会读取服务端当前分类，并 PUT 完整的 portal-data（保留现有分类，追加应用）。
 */

const crypto = require('crypto');
const https = require('https');

// ==================== 填写管理员密码 ====================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.error('请先设置环境变量 ADMIN_PASSWORD，或在本文件里填写密码');
  process.exit(1);
}

const API_BASE = 'https://aqtapp.airquality.com.cn';

function makeAdminToken() {
  const payload = Buffer.from(JSON.stringify({ userId: 'portal_admin', ts: Date.now() })).toString('base64');
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex').slice(0, 16);
  return 'admin.' + payload + '.' + sig;
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(API_BASE + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + makeAdminToken(),
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const obj = JSON.parse(raw);
          if (res.statusCode >= 400) reject(Object.assign(new Error(obj.error || raw), { status: res.statusCode, body: obj }));
          else resolve(obj);
        } catch (e) { reject(new Error(raw)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ==================== 填写要恢复的 10 个应用 ====================
const appsToRestore = [
  // 示例：
  // { name: '云之家', url: 'https://www.yunzhijia.com', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },

  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 },
  { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 }
];
// ===================================================================

(async () => {
  const toCreate = appsToRestore.filter(a => a.name && a.url);
  if (toCreate.length === 0) {
    console.error('没有可恢复的应用，请先填写 appsToRestore 数组');
    process.exit(1);
  }

  console.log('读取服务端当前数据…');
  const current = await request('GET', '/api/portal-data');
  console.log('当前：分类 ' + current.categories.length + '，应用 ' + current.apps.length + '，version ' + current.version);

  const categories = current.categories;
  const allDeptIds = [1,2,3,4,5,6,7,8,9,10,11,12,13]; // 默认 13 个部门，脚本里固定

  const newApps = toCreate.map(app => {
    const id = 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    return {
      id,
      name: app.name,
      url: app.url,
      description: app.description || '',
      category_id: app.category_id,
      open_mode: app.open_mode || 'modal',
      icon_url: app.icon_url || '',
      creator_userid: app.creator_userid || 'portal_admin',
      creator_name: app.creator_name || '吴彤',
      developer_userid: app.developer_userid || null,
      developer_name: app.developer_name || null,
      visibility_dept_ids: app.visibility_dept_ids && app.visibility_dept_ids.length ? app.visibility_dept_ids : allDeptIds,
      visibility_user_ids: app.visibility_user_ids || [],
      client_visible: app.client_visible !== undefined ? app.client_visible : 1,
      created_at: Date.now()
    };
  });

  const payload = {
    version: current.version,
    categories,
    apps: [...current.apps, ...newApps],
    trash: current.trash || []
  };

  console.log('准备写入 ' + newApps.length + ' 个新应用…');
  const res = await request('PUT', '/api/portal-data', payload);
  console.log('写入成功：', res);
})().catch(e => {
  console.error('恢复失败：', e.message, e.body || '');
  process.exit(1);
});
