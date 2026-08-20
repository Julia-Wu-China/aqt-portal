/* 冒烟测试：加载门户 HTML 的主脚本，用 stub 模拟 DOM/localStorage，
   验证「分类与企微部门解耦」后的权限判定与离线后端二次校验逻辑 */
const fs = require('fs');
const html = fs.readFileSync('D:/Desktop/未完成/index.html', 'utf8');
// 提取最后一个内联 <script>（主逻辑脚本），跳过 STATIC_DEPLOY 标记与带 src 的脚本
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = matches[matches.length - 1][1];

function makeEl(id) {
  return {
    id, _l: {}, style: {}, dataset: {}, classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    innerHTML: '', textContent: '', value: '', files: [],
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    appendChild() {}, remove() {},
    querySelector() { return makeEl(id + ':q'); },
    querySelectorAll() { return []; },
    setProperty() {}, focus() {}, select() {}, click() {}
  };
}
const els = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
  createElement() { return makeEl('created'); },
  createTextNode() { return {}; },
  addEventListener() {},
  querySelectorAll() { return []; },
  querySelector() { return makeEl('q'); }
};
global.localStorage = (() => {
  const mm = new Map();
  return {
    getItem: k => (mm.has(k) ? mm.get(k) : null),
    setItem: (k, v) => mm.set(k, String(v)),
    removeItem: k => mm.delete(k),
    clear: () => mm.clear()
  };
})();
global.window = global;
global.location = { search: '', hostname: 'localhost', href: '', reload() {} };
global.history = { replaceState() {} };
global.confirm = () => true;
global.URL = class {
  static createObjectURL() { return 'blob:x'; }
  static revokeObjectURL() {}
};
global.Blob = class {};
global.FileReader = class { readAsText() {} };
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.escape = s => encodeURIComponent(s);
global.unescape = s => decodeURIComponent(s);

const test = `
;(async () => {
  const results = [];
  const check = (name, ok) => results.push([name, !!ok]);
  async function refresh() {
    state.departments = offlineBackend.departments();
    state.users = offlineBackend.mockUsers();
    state.categories = offlineBackend.listCategories();
    state.apps = offlineBackend.listApps();
  }
  async function loginAs(uid) {
    const r = await offlineBackend.login(uid);
    state.user = r.user;
    await refresh();
  }
  const catOf = id => state.categories.find(c => c.id === id);

  // ========== 种子数据 ==========
  await loginAs('demo_admin');
  check('种子分类 15 个', state.categories.length === 15);
  check('分类不再有 dept_id 字段', state.categories.every(c => !('dept_id' in c) && !('dept_name' in c)));
  check('分类均有创建人与管理员', state.categories.every(c => c.creator_userid && Array.isArray(c.manager_userids)));
  check('管理员可见全部 15 个分类', visibleCats().length === 15);

  // ========== 管理员创建测试应用 ==========
  // A1: 市场部(cat13, 授权[13]) + 可见部门[13]  → 市场部可见
  // A2: 产品部(cat5, 授权[5]) + 可见人员[emp_p1] → 产品部+指定人可见
  // A3: 客服部(cat9, 授权[9], 客户可看) + 客户可见 → 客户可见
  // A4: 质量部(cat8, 授权[8]) + 可见部门[8] → 质量部可见
  const A1 = await offlineBackend.createApp({ name: 'A1', url: 'http://a1', category_id: 13, visibility_dept_ids: [13], visibility_user_ids: [], client_visible: 1 });
  const A2 = await offlineBackend.createApp({ name: 'A2', url: 'http://a2', category_id: 5, visibility_dept_ids: [], visibility_user_ids: ['emp_p1'] });
  const A3 = await offlineBackend.createApp({ name: 'A3', url: 'http://a3', category_id: 9, visibility_dept_ids: [], visibility_user_ids: [], client_visible: 1 });
  const A4 = await offlineBackend.createApp({ name: 'A4', url: 'http://a4', category_id: 8, visibility_dept_ids: [8], visibility_user_ids: [] });
  // A6: 分类5（产品部，未授权市场部）+ 可见部门[13]（市场部） → 市场部应可见，且分类5自动带出
  const A6 = await offlineBackend.createApp({ name: 'A6', url: 'http://a6', category_id: 5, visibility_dept_ids: [13], visibility_user_ids: [] });
  await refresh();
  const byId = id => state.apps.find(a => a.id === id);

  // ========== 部门用户可见性（v2 规则：应用只看自身授权，分类未授权也自动带出） ==========
  await loginAs('emp_m1'); // 市场部普通员工 (dept 13)
  check('市场部员工可见分类13（授权部门13）', canSeeCategory(catOf(13), state.user));
  check('市场部员工可见 A1（单应用授权市场部）', canSeeApp(byId(A1.id), state.user));
  check('市场部员工可见分类5（一级分类默认全公司可见）', canSeeCategory(catOf(5), state.user));
  check('市场部员工可见 A6（分类5未授权，但应用授权了市场部）', canSeeApp(byId(A6.id), state.user));
  check('市场部员工自动带出分类5（其下 A6 可见）', visibleCats().some(c => c.id === 5));
  check('市场部员工不可见 A2（应用未授权市场部）', !canSeeApp(byId(A2.id), state.user));
  check('市场部员工不可见 A3（应用未授权市场部）', !canSeeApp(byId(A3.id), state.user));

  await loginAs('emp_p1'); // 产品部普通员工 (dept 5)
  check('产品部员工可见 A2（单应用授权人员）', canSeeApp(byId(A2.id), state.user));
  check('产品部员工不可见 A1（应用仅授权市场部）', !canSeeApp(byId(A1.id), state.user));

  await loginAs('lead_6'); // 质量部负责人 (dept 8)
  check('质量部可见 A4（分类8授权8 + 单应用授权8）', canSeeApp(byId(A4.id), state.user));

  // ========== 客户角色 ==========
  state.user = { wecom_userid: 'client_test', name: '测试客户', dept_ids: [], lead_dept_ids: [], is_super_admin: 0, is_client: 1 };
  check('客户可见 A3（应用标记客户可看）', canSeeApp(byId(A3.id), state.user));
  check('客户可见 A1（应用标记了客户可看，分类无需授权）', canSeeApp(byId(A1.id), state.user));
  check('客户不可见 A2（应用未标记客户可看）', !canSeeApp(byId(A2.id), state.user));
  check('客户可见分类13（一级分类默认客户可见）', canSeeCategory(catOf(13), state.user));
  check('客户可管理分类？否', !canManageCategory(catOf(9), state.user));

  // ========== 一级分类标题人人可见（授权只控制二级分类与内容） ==========
  await loginAs('demo_admin');
  const topX = await offlineBackend.createCategory({ name: '客户不可见顶层', parent_id: null });
  await refresh();
  state.user = { wecom_userid: 'client_test3', name: '测试客户3', dept_ids: [], lead_dept_ids: [], is_super_admin: 0, is_client: 1 };
  check('客户对未授权顶层分类内容不可见', !canSeeCategory(catOf(topX.id), state.user));
  const rootAll = state.categories.filter(c => !c.parent_id);
  check('侧边栏根集合=全部顶层分类（标题人人可见）', rootAll.some(c => c.id === topX.id));
  // 清理：管理员删除并恢复该测试分类，保持回收站计数干净
  await loginAs('demo_admin');
  await offlineBackend.deleteCategory(topX.id);
  await refresh();
  const topXEntry = offlineBackend.listTrash().find(t => t.kind === 'category' && t.item.id === topX.id);
  if (topXEntry) { await offlineBackend.restoreTrash(topXEntry.id); await refresh(); }
  check('测试顶层分类已恢复清理', state.categories.some(c => c.id === topX.id));

  // ========== 分类权限矩阵 ==========
  await loginAs('emp_m1');
  check('普通员工不可管理他人分类', !canManageCategory(catOf(13), state.user));
  check('普通员工无可编辑分类', getEditableCategories(state.user).length === 0);
  // 普通员工禁止创建顶层分类
  let eTop = false;
  try { await offlineBackend.createCategory({ name: '员工顶层', parent_id: null }); } catch (e) { eTop = true; }
  check('普通员工禁止创建顶层分类', eTop);
  // 普通员工禁止在无同部门负责人的分类下建子分类（分类1负责人是 demo_admin 部门1，员工部门13）
  let eSub = false;
  try { await offlineBackend.createCategory({ name: '员工子分类', parent_id: 1 }); } catch (e) { eSub = true; }
  check('非同部门员工禁止在该分类下建子分类', eSub);

  // 全局管理员创建顶层分类并指派负责人 lead_8（市场部）
  await loginAs('demo_admin');
  const catX = await offlineBackend.createCategory({ name: '水果分类', parent_id: null });
  check('全局管理员可创建顶层分类', !!catX.id);
  await offlineBackend.updateCategory(catX.id, { manager_userids: ['lead_8'] });
  await refresh();
  const x = state.categories.find(c => c.id === catX.id);
  check('全局管理员可指派分类负责人', (x.manager_userids || []).includes('lead_8'));

  // 同部门员工（emp_m1 部门13 = 负责人 lead_8 部门13）可在该分类下建子分类
  await loginAs('emp_m1');
  check('同部门员工可选该分类创建应用', getEditableCategories(state.user).some(c => c.id === catX.id));
  const subX = await offlineBackend.createCategory({ name: '红色', parent_id: catX.id });
  check('同部门员工可在负责人分类下创建子分类', !!subX.id);
  await refresh();
  const sub = state.categories.find(c => c.id === subX.id);
  check('子分类负责人继承上级分类负责人', (sub.manager_userids || []).includes('lead_8'));
  check('子分类负责人不含创建者自己', !(sub.manager_userids || []).includes('emp_m1'));
  check('创建者可管理自己创建的二级分类', canManageCategory(sub, state.user));
  // 负责人兜底覆盖权：lead_8 可管理员工创建的子分类
  await loginAs('lead_8');
  check('负责人可管理员工创建的子分类（兜底覆盖）', canManageCategory(state.categories.find(c => c.id === subX.id), state.user));
  // 员工不能移交负责人（仅全局管理员）
  let eMgr = false;
  try { await offlineBackend.updateCategory(subX.id, { manager_userids: ['emp_m1'] }); } catch (e) { eMgr = true; }
  check('分类负责人不能移交负责人（仅全局管理员可改）', eMgr);
  // 负责人本人可重命名所辖分类
  let d6 = false;
  try { await offlineBackend.updateCategory(catX.id, { name: '水果分类' }); } catch (e) { d6 = true; }
  check('分类负责人本人可重命名', !d6);

  // ========== 越权写操作：mock 后端二次校验应拒绝 ==========
  await loginAs('emp_o1'); // 供应链部员工（无任何分类管理权）
  let d1 = false; try { await offlineBackend.updateApp(A1.id, { name: 'hacked' }); } catch (e) { d1 = true; }
  check('mock 后端拒绝跨分类编辑', d1);
  let d2 = false; try { await offlineBackend.deleteApp(A2.id); } catch (e) { d2 = true; }
  check('mock 后端拒绝越权删除', d2);
  let d3 = false; try { await offlineBackend.updateCategory(1, { name: 'hacked' }); } catch (e) { d3 = true; }
  check('mock 后端拒绝越权改分类', d3);
  let d4 = false;
  try { await offlineBackend.updateApp(A1.id, { visibility_dept_ids: [10] }); } catch (e) { d4 = true; }
  check('员工编辑他人应用直接拒绝（含可见范围字段）', d4);

  // ========== 应用可见范围：不再强制归属部门 ==========
  await loginAs('demo_admin');
  const A5 = await offlineBackend.createApp({ name: 'A5', url: 'http://a5', category_id: 1, visibility_dept_ids: [], visibility_user_ids: [] });
  await refresh();
  check('新建应用不强制注入部门', byId(A5.id).visibility_dept_ids.length === 0);
  await offlineBackend.updateApp(A5.id, { visibility_dept_ids: [] });
  await refresh();
  check('更新可见范围也不强制注入部门', byId(A5.id).visibility_dept_ids.length === 0);

  // ========== 对外授权角标 ==========
  check('A1 有对外授权角标（允许客户查看）', isExternallyShared(byId(A1.id)));
  check('A5 无对外授权角标', !isExternallyShared(byId(A5.id)));

  // ========== 删除分类：整棵子树（分类 + 子分类 + 应用）移入回收站 ==========
  await loginAs('demo_admin');
  const AX = await offlineBackend.createApp({ name: 'AX', url: 'http://ax', category_id: catX.id, visibility_dept_ids: [8], visibility_user_ids: [] });
  await refresh();
  const before = state.categories.length;
  const appsBefore = state.apps.length;
  await offlineBackend.deleteCategory(catX.id);
  await refresh();
  check('删除分类后自身从分类表消失', state.categories.every(c => c.id !== catX.id));
  check('删除后子分类一并移入回收站（不再上移）', state.categories.every(c => c.id !== subX.id));
  check('删除后分类总数减 2（整棵子树）', state.categories.length === before - 2);
  check('删除后应用从应用表消失', state.apps.every(a => a.id !== AX.id));

  // ========== 回收站：仅全局管理员可查看 / 恢复 / 清空 ==========
  await loginAs('emp_m1');
  check('非全局管理员 listTrash 返回空', offlineBackend.listTrash().length === 0);
  let rErr = false;
  try { await offlineBackend.restoreTrash('x'); } catch (e) { rErr = true; }
  check('非全局管理员恢复被拒绝', rErr);

  await loginAs('demo_admin');
  const tr2 = offlineBackend.listTrash();
  check('回收站含 3 条（分类+子分类+应用）', tr2.length === 3);
  const catXEntry = tr2.find(t => t.kind === 'category' && t.item.id === catX.id);
  const subEntry  = tr2.find(t => t.kind === 'category' && t.item.id === subX.id);
  const axEntry   = tr2.find(t => t.kind === 'app' && t.item.id === AX.id);
  check('回收站记录含删除人与删除时间', !!catXEntry && !!catXEntry.deleted_by && !!catXEntry.deleted_at);

  // 恢复：先顶层分类 → 子分类 → 应用，原结构还原
  await offlineBackend.restoreTrash(catXEntry.id);
  await refresh();
  check('恢复后顶层分类回到分类表', state.categories.some(c => c.id === catX.id));
  await offlineBackend.restoreTrash(subEntry.id);
  await refresh();
  const subR = state.categories.find(c => c.id === subX.id);
  check('恢复后子分类挂回原父分类', subR && subR.parent_id === catX.id);
  await offlineBackend.restoreTrash(axEntry.id);
  await refresh();
  const axR = state.apps.find(a => a.id === AX.id);
  check('恢复后应用挂回原分类', axR && axR.category_id === catX.id);
  check('恢复后应用可被创建人看到', canSeeApp(axR, state.user));
  check('恢复后回收站为空', offlineBackend.listTrash().length === 0);

  // 恢复时父分类不在分类表 → 应用归入未分类（category_id=null，前端有兜底可见）
  const B1 = await offlineBackend.createApp({ name: 'B1', url: 'http://b1', category_id: catX.id, visibility_dept_ids: [8], visibility_user_ids: [] });
  await offlineBackend.deleteCategory(catX.id);
  const tr3 = offlineBackend.listTrash();
  const b1Entry = tr3.find(t => t.kind === 'app' && t.item.id === B1.id);
  const catXEntry2 = tr3.find(t => t.kind === 'category' && t.item.id === catX.id);
  await offlineBackend.restoreTrash(b1Entry.id);   // 先恢复应用（父分类仍在回收站）
  await refresh();
  const b1R = state.apps.find(a => a.id === B1.id);
  check('父分类不在时恢复应用归入未分类', b1R && b1R.category_id === null);
  check('未分类应用按自身可见范围可见', canSeeApp(b1R, state.user));
  await offlineBackend.restoreTrash(catXEntry2.id);
  await refresh();
  check('恢复顶层分类回到分类表', !!state.categories.find(c => c.id === catX.id));
  // B1 场景删除 catX 时 subX 与 AX 也被再次带入回收站，一并恢复，保持环境干净
  const subX2Entry = tr3.find(t => t.kind === 'category' && t.item.id === subX.id);
  if (subX2Entry) { await offlineBackend.restoreTrash(subX2Entry.id); await refresh(); }
  const ax2Entry = tr3.find(t => t.kind === 'app' && t.item.id === AX.id);
  if (ax2Entry) { await offlineBackend.restoreTrash(ax2Entry.id); await refresh(); }

  // 删除应用 → 回收站；清空回收站
  const B2 = await offlineBackend.createApp({ name: 'B2', url: 'http://b2', category_id: catX.id, visibility_dept_ids: [8], visibility_user_ids: [] });
  await offlineBackend.deleteApp(B2.id);
  check('删除应用后回收站 +1', offlineBackend.listTrash().length === 1);
  let cErr = false;
  await loginAs('emp_m1');
  try { await offlineBackend.clearTrash(); } catch (e) { cErr = true; }
  check('非全局管理员清空被拒绝', cErr);
  await loginAs('demo_admin');
  await offlineBackend.clearTrash();
  check('全局管理员清空回收站后为空', offlineBackend.listTrash().length === 0);

  // ========== 回收站容量限制：最多 30 条 / 30 天 ==========
  const trashRaw = JSON.parse(localStorage.getItem(LS_TRASH) || '[]');
  const now = Date.now();
  for (let i = 0; i < 35; i++) {
    trashRaw.push({ id: 't_vol_' + i, kind: 'app', item: { id: 'v' + i, name: 'V' + i }, deleted_at: now - (35 - i) * 1000, deleted_by: 'demo_admin' });
  }
  localStorage.setItem(LS_TRASH, JSON.stringify(trashRaw));
  const pruned = offlineBackend.trashPrune();
  check('回收站超过 30 条时截断到 30', pruned.length === 30);
  check('截断保留最新条目', pruned.some(t => t.id === 't_vol_34'));
  check('截断丢弃最旧条目', !pruned.some(t => t.id === 't_vol_0'));
  trashRaw.push({ id: 't_expired', kind: 'app', item: { id: 'e1', name: 'E1' }, deleted_at: now - 31 * 24 * 3600 * 1000, deleted_by: 'demo_admin' });
  localStorage.setItem(LS_TRASH, JSON.stringify(trashRaw));
  const pruned2 = offlineBackend.trashPrune();
  check('超过 30 天的条目自动清除', !pruned2.some(t => t.id === 't_expired'));

  // ========== 无权限指引与回收站弹窗（按钮全开放配套） ==========
  check('无权限弹窗函数已定义', typeof showPermissionDenied === 'function' && typeof showPermissionDeniedApp === 'function' && typeof showPermissionDeniedAddApp === 'function' && typeof showPermissionDeniedAddCat === 'function');
  check('回收站弹窗函数已定义', typeof openTrash === 'function' && typeof restoreTrashEntry === 'function' && typeof clearTrashAll === 'function');
  check('回收站容量参数', TRASH_MAX === 30 && TRASH_TTL_MS === 30 * 24 * 3600 * 1000);
  const contactCat = state.categories.find(c => c.id === catX.id);
  check('分类负责人联系人含指派负责人 lead_8', catAncestorManagerContacts(contactCat).some(p => p.uid === 'lead_8'));
  check('分类创建人联系人含 demo_admin', catEmployeeContacts(contactCat).some(p => p.uid === 'demo_admin'));
  showPermissionDenied({ action: '测试弹窗', employees: [], catManagers: [] });
  check('无权限弹窗渲染不抛异常', true);

  // ========== 角色文案：优先显示最具体（层级最深）部门 ==========
  state.departments = [
    { id: 1,  name: '爱优特', parent_id: 1 },
    { id: 5,  name: '市场部', parent_id: 1 },
    { id: 51, name: '品牌组', parent_id: 5 }
  ];
  check('根部门深度=0', deptDepth(1) === 0);
  check('二级部门深度=1', deptDepth(5) === 1);
  check('三级部门深度=2', deptDepth(51) === 2);
  state.user = { wecom_userid: 't1', name: 'T1', dept_ids: [], lead_dept_ids: [1, 5], is_super_admin: 0 };
  check('多部门负责人取最深（市场部）', getUserRoleText(state.user) === '市场部负责人');
  state.user = { wecom_userid: 't2', name: 'T2', dept_ids: [1, 5, 51], lead_dept_ids: [], is_super_admin: 0 };
  check('多部门员工取最深（品牌组）', getUserRoleText(state.user) === '品牌组·员工');
  state.user = { wecom_userid: 't3', name: 'T3', dept_ids: [], lead_dept_ids: [999], is_super_admin: 0 };
  check('负责部门未知仍显示未分组负责人', getUserRoleText(state.user) === '未分组负责人');

  const fails = results.filter(r => !r[1]);
  results.forEach(r => console.log((r[1] ? 'PASS' : 'FAIL') + '  ' + r[0]));
  console.log('---');
  console.log('TOTAL=' + results.length + ' FAILS=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
`;

eval(code + test);
