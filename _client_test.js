/* 针对性验证：客户身份进入 + 服务端空库 → 不应被登出（回归测试 2026-08-18） */
const fs = require('fs');
const html = fs.readFileSync('D:/Desktop/未完成/index.html', 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = matches[matches.length - 1][1];

function makeEl(id) {
  return {
    id, _l: {}, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
global.URL = class { static createObjectURL() { return 'blob:x'; } static revokeObjectURL() {} };
global.Blob = class {};
global.FileReader = class { readAsText() {} };
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.escape = s => encodeURIComponent(s);
global.unescape = s => decodeURIComponent(s);

// fetch stub：GET 全部返回，PUT /portal-data 返回 401（模拟客户无写权限）
let putCalled = false, logoutCalled = false;
global.fetch = async (url, opts) => {
  const method = (opts && opts.method) || 'GET';
  if (method === 'GET') {
    if (url.includes('/departments')) return { ok: true, status: 200, json: async () => ({ departments: [] }) };
    if (url.includes('/users')) return { ok: true, status: 200, json: async () => ({ users: [] }) };
    if (url.includes('/portal-data')) return { ok: true, status: 200, json: async () => ({ version: 1, categories: [], apps: [], trash: [] }) };
  }
  if (method === 'PUT' && url.includes('/portal-data')) {
    putCalled = true;
    // 真实服务端：有 Authorization 放行，无 token（客户）401
    const authed = !!(opts.headers && opts.headers.Authorization);
    return authed
      ? { ok: true, status: 200, json: async () => ({ ok: true, version: 2 }) }
      : { ok: false, status: 401, json: async () => ({ error: '未登录或登录已过期' }) };
  }
  throw new Error('unexpected fetch: ' + method + ' ' + url);
};

const test = `
;(async () => {
  const results = [];
  const check = (name, ok) => results.push([name, !!ok]);
  // 模拟「客户身份进入」
  doClientLogin();
  check('客户身份已设置', isClient(state.user));
  check('客户无 token', state.token === null);
  // enterApp → loadAllData → loadPortalData（服务端空库 + PUT 401）
  await loadAllData();
  check('客户未被登出', !logoutCalled);
  check('客户 user 仍在', isClient(state.user));
  check('客户未触发服务端写入', !putCalled);
  check('客户展示本地种子分类（15 个）', state.categories.length === 15);
  check('默认一级分类含供应链', state.categories.some(c => c.name === '供应链'));
  check('默认一级分类含制造部', state.categories.some(c => c.name === '制造部'));
  check('默认一级分类无运营部', !state.categories.some(c => c.name === '运营部'));
  const roots = state.categories.filter(c => !c.parent_id).map(c => c.name);
  const expect = ['总经办','人事部','行政部','财务部','产品部','供应链','制造部','质量部','客服部','内销部','外销部','销售支持部','市场部'];
  check('13 个默认一级分类且顺序正确', JSON.stringify(roots) === JSON.stringify(expect));
  // 登录用户场景：服务端空 → 应触发迁移
  logoutCalled = false; putCalled = false;
  state.token = 'wecom.test';
  state.user = { wecom_userid: 'emp_m1', name: '何静', dept_ids: [13], lead_dept_ids: [], is_super_admin: 0 };
  await loadAllData();
  check('登录用户触发服务端迁移', putCalled);
  check('登录用户未被登出', !logoutCalled);
  check('迁移后分类 15 个', state.categories.length === 15);

  const fails = results.filter(r => !r[1]);
  results.forEach(r => console.log((r[1] ? 'PASS' : 'FAIL') + '  ' + r[0]));
  console.log('---');
  console.log('TOTAL=' + results.length + ' FAILS=' + fails.length);
  process.exit(fails.length ? 1 : 0);
})();
`;

// 拦截 doLogout 做标记
const wrapped = code.replace('function doLogout() {', 'function doLogout() { logoutCalled = true;');
eval(wrapped + test);
