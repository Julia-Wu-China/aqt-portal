/* 一次性补丁测试：applyDefaultCategoryVisibility —— 旧种子一级分类升级为全公司+客户可见；已自定义的不动 */
const fs = require('fs');

function makeEl(id) {
  return {
    id, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    innerHTML: '', textContent: '', value: '', checked: false, dataset: {},
    appendChild() { return this; }, remove() {}, focus() {}, blur() {}, click() {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return makeEl('q'); }, querySelectorAll() { return []; },
    insertBefore() { return this; }, contains() { return false; }, closest() { return null; }
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
global.URL = class { static createObjectURL() { return 'blob:x'; } static revokeObjectURL() {} };
global.Blob = class {};
global.FileReader = class { readAsText() {} };
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.escape = s => encodeURIComponent(s);
global.unescape = s => decodeURIComponent(s);

const code = (() => {
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return matches[matches.length - 1][1];
})();

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
  const catOf = name => state.categories.find(c => c.name === name);

  // ========== 场景1：旧种子数据（单部门可见）→ 补丁升级为全公司+客户 ==========
  await loginAs('demo_admin');
  // 模拟旧种子：把 13 个一级分类的可访问范围压回单部门形态
  const DEPT_OF = { '总经办':1,'人事部':2,'行政部':3,'财务部':4,'产品部':5,'供应链':6,'制造部':7,'质量部':8,'客服部':9,'内销部':10,'外销部':11,'销售支持部':12,'市场部':13 };
  state.categories.forEach(c => {
    if (DEPT_OF[c.name]) {
      offlineBackend.updateCategory(c.id, { visibility_dept_ids: [DEPT_OF[c.name]], client_visible: 0 });
    }
  });
  await refresh();
  check('模拟旧种子：市场部分类仅单部门可见', (catOf('市场部').visibility_dept_ids || []).length === 1);

  // 模拟管理员手动改过一个分类（产品部 = 自定义多部门 [1,5]，供应链 = 自定义清空 []）
  offlineBackend.updateCategory(catOf('产品部').id, { visibility_dept_ids: [1, 5] });
  offlineBackend.updateCategory(catOf('供应链').id, { visibility_dept_ids: [] });
  await refresh();

  // 在线模式打桩：api.put 直接成功
  let putBody = null;
  api.put = async (path, body) => { putBody = body; return { ok: true }; };
  state.offline = false;
  state.syncVersion = 5;

  await applyDefaultCategoryVisibility();

  const allDepts = state.departments.map(d => d.id);
  check('补丁后 市场部 = 全部门可见', JSON.stringify(catOf('市场部').visibility_dept_ids) === JSON.stringify(allDepts));
  check('补丁后 市场部 客户可见', catOf('市场部').client_visible === 1);
  check('补丁后 总经办 = 全部门可见', JSON.stringify(catOf('总经办').visibility_dept_ids) === JSON.stringify(allDepts));
  check('已自定义(多部门)的产品部未被改动', JSON.stringify(catOf('产品部').visibility_dept_ids) === JSON.stringify([1, 5]));
  check('已自定义(清空)的供应链未被改动', (catOf('供应链').visibility_dept_ids || []).length === 0);
  check('补丁推送到服务端一次', !!putBody && Array.isArray(putBody.categories));
  check('syncVersion 递增', state.syncVersion === 6);
  check('补丁标记已写入', localStorage.getItem('aqt_portal_v2_catvis_default_patched') === '1');

  // ========== 场景2：补丁幂等——再次执行不再改动、不再推送 ==========
  putBody = null;
  offlineBackend.updateCategory(catOf('市场部').id, { visibility_dept_ids: [13] }); // 强行改回旧形态
  await refresh();
  await applyDefaultCategoryVisibility();
  check('已打标记后不再重复补丁', (catOf('市场部').visibility_dept_ids || []).length === 1 && putBody === null);

  // ========== 场景3：新种子直接就是全公司+客户 ==========
  localStorage.clear();
  offlineBackend.init();
  await refresh();
  check('新种子 市场部 = 全部门', JSON.stringify(catOf('市场部').visibility_dept_ids) === JSON.stringify(state.departments.map(d => d.id)));
  check('新种子 总经办 客户可见', catOf('总经办').client_visible === 1);
  check('子分类 渠道投放 保持原授权', JSON.stringify(catOf('渠道投放').visibility_dept_ids) === JSON.stringify([10, 11]));

  // ========== 场景4：客户身份不触发补丁 ==========
  localStorage.clear();
  state.categories.forEach(c => { if (DEPT_OF[c.name]) offlineBackend.updateCategory(c.id, { visibility_dept_ids: [DEPT_OF[c.name]] }); });
  await refresh();
  state.user = { wecom_userid: 'client_x', name: '客户X', dept_ids: [], lead_dept_ids: [], is_super_admin: 0, is_client: 1 };
  putBody = null;
  await applyDefaultCategoryVisibility();
  check('客户身份不触发补丁、不推送', putBody === null);

  const fails = results.filter(r => !r[1]);
  results.forEach(r => console.log((r[1] ? 'PASS' : 'FAIL') + '  ' + r[0]));
  console.log('---');
  console.log('TOTAL=' + results.length + ' FAILS=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
`;

eval(code + test);
