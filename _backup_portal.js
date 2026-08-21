/**
 * 门户数据每日备份脚本（同时保活 Render 免费 PostgreSQL）
 * 用法：node _backup_portal.js [备份目录]
 * 行为：
 *   - GET https://aqtapp.airquality.com.cn/api/portal-data
 *   - 校验数据非空（分类或应用至少一项），避免把"空库"存成备份
 *   - 保存为 portal-YYYY-MM-DD.json（追加式，每天一份，不覆盖历史）
 *   - 只保留最近 30 份，自动清理更早的
 *   - 每次请求都会让 Render 免费 PG 产生活跃连接 → 防止 90 天无连接自动删库
 * 退出码：0=成功 1=失败（供自动化任务判断）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://aqtapp.airquality.com.cn';
const BACKUP_DIR = process.argv[2] || path.join('D:', 'Desktop', '爱优特门户备份');
const KEEP = 30;

function getData() {
  return new Promise((resolve, reject) => {
    const req = https.get(API_BASE + '/api/portal-data', { timeout: 30000 }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + raw.slice(0, 200)));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('响应解析失败: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.end();
  });
}

(async () => {
  const data = await getData();
  const cats = (data.categories || []).length;
  const apps = (data.apps || []).length;
  const trash = (data.trash || []).length;

  // 数据校验：禁止把空库当备份（防止"假空"期间生成一份空备份覆盖历史认知）
  if (cats === 0 && apps === 0 && trash === 0) {
    console.error('服务端返回空数据（version=' + data.version + '），已拒绝生成备份。可能存储异常，请人工检查！');
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const file = path.join(BACKUP_DIR, 'portal-' + dateStr + '.json');

  // 附加备份元信息
  const payload = {
    schema_version: 3,
    exported_at: new Date().toISOString(),
    source: 'aqtapp.airquality.com.cn',
    stats: { categories: cats, apps, trash, version: data.version },
    categories: data.categories,
    apps: data.apps,
    trash: data.trash
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));

  // 清理旧备份，保留最近 KEEP 份
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^portal-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  while (files.length > KEEP) {
    const old = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log('已清理旧备份: ' + old);
  }

  console.log('✅ 备份成功: ' + file);
  console.log('   分类=' + cats + ' 应用=' + apps + ' 回收站=' + trash + ' version=' + data.version);
  console.log('   目录现有备份 ' + files.length + ' 份（上限 ' + KEEP + ' 份）');
})().catch(e => {
  console.error('❌ 备份失败: ' + e.message);
  process.exit(1);
});
