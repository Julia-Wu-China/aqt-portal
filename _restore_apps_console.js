/**
 * 应用批量恢复脚本（浏览器控制台版）
 * 使用方法：
 * 1. 用全局管理员身份在浏览器打开 https://aqtapp.airquality.com.cn
 * 2. 输入管理员密码完成登录（右上角齿轮 → 管理员登录）
 * 3. 按 F12 打开控制台，把本文件内容完整粘贴回车
 * 4. 根据实际情况修改下面的 apps 数组（名称/URL/分类ID/开发人等）
 * 5. 再次回车执行
 * 6. 等待提示「已恢复 X 个应用」
 */

(async function restoreApps() {
  // 当前全部分类（打印出来供你参考 ID）
  const cats = state.categories.map(c => ({ id: c.id, name: c.name, parent_id: c.parent_id }));
  console.log('当前分类列表（请根据 id 填写 category_id）：', cats);

  // ==================== 在这里填写要恢复的 10 个应用 ====================
  const apps = [
    // 示例：
    // { name: '云之家', url: 'https://www.yunzhijia.com', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },

    // 请把你丢失的 10 个应用按下面格式补充完整：
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 },
    { name: '', url: '', category_id: 1, open_mode: 'modal', description: '', developer_userid: '', visibility_dept_ids: [], client_visible: 1 }
  ];
  // ===================================================================

  // 过滤掉空名称
  const toCreate = apps.filter(a => a.name && a.url);
  if (toCreate.length === 0) {
    console.error('没有可恢复的应用，请先填写 apps 数组里的 name 和 url');
    return;
  }

  // 默认全公司可见（13 个部门）
  const allDeptIds = (state.departments || []).map(d => d.id);

  let created = 0;
  for (const app of toCreate) {
    try {
      const payload = {
        name: app.name,
        url: app.url,
        category_id: app.category_id,
        open_mode: app.open_mode || 'modal',
        description: app.description || '',
        developer_userid: app.developer_userid || undefined,
        visibility_dept_ids: app.visibility_dept_ids && app.visibility_dept_ids.length ? app.visibility_dept_ids : allDeptIds,
        visibility_user_ids: app.visibility_user_ids || [],
        client_visible: app.client_visible !== undefined ? app.client_visible : 1
      };
      offlineBackend.createApp(payload);
      created++;
      console.log('已创建：' + app.name);
    } catch (e) {
      console.error('创建失败：' + app.name + ' - ' + e.message);
    }
  }

  // 同步到服务端
  if (created > 0) {
    console.log('正在同步到服务端…');
    await forceSyncToServer();
    showToast('已恢复 ' + created + ' 个应用');
  }
})();
