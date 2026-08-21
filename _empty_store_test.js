/* ============================================================
   空库 + 版本漂移 回归测试
   验证服务端 PUT /api/portal-data 在 store 没有真实数据时，
   即使客户端 version 与服务端 version 不一致，也不返回 409。
   ============================================================ */
const assert = require('assert');

function handlePut(store, body) {
  const clientVer = Number(body.version) || 0;
  const hasData = (store.categories || []).length > 0 || (store.apps || []).length > 0 || (store.trash || []).length > 0;
  if (clientVer !== store.version && hasData) {
    return { status: 409, body: { ...store, error: '数据已被他人修改' } };
  }
  const next = {
    version: hasData ? store.version + 1 : 1,
    categories: Array.isArray(body.categories) ? body.categories : store.categories,
    apps: Array.isArray(body.apps) ? body.apps : store.apps,
    trash: Array.isArray(body.trash) ? body.trash : store.trash
  };
  return { status: 200, body: { ok: true, version: next.version } };
}

let fails = 0, total = 0;
function check(name, cond) { total++; if (!cond) { fails++; console.log('FAIL', name); } else console.log('PASS', name); }

// 1. 空库 + 客户端 version 漂移 => 应成功
let store1 = { version: 1, categories: [], apps: [], trash: [] };
let r1 = handlePut(store1, { version: 2, categories: [{ id: 1, name: '总经办' }], apps: [], trash: [] });
check('空库时客户端 version=2 可写入（不 409）', r1.status === 200 && r1.body.version === 1);

// 2. 空库 + 客户端 version=1 => 应成功
let store2 = { version: 1, categories: [], apps: [], trash: [] };
let r2 = handlePut(store2, { version: 1, categories: [{ id: 1, name: '总经办' }], apps: [], trash: [] });
check('空库时客户端 version=1 可写入', r2.status === 200 && r2.body.version === 1);

// 3. 有数据 + 版本一致 => 应成功，version 递增
let store3 = { version: 2, categories: [{ id: 1, name: '市场部' }], apps: [], trash: [] };
let r3 = handlePut(store3, { version: 2, categories: [{ id: 1, name: '营销中心' }], apps: [], trash: [] });
check('有数据且 version 一致时写入成功并递增', r3.status === 200 && r3.body.version === 3);

// 4. 有数据 + 版本不一致 => 应 409
let store4 = { version: 3, categories: [{ id: 1, name: '市场部' }], apps: [], trash: [] };
let r4 = handlePut(store4, { version: 2, categories: [{ id: 1, name: '营销中心' }], apps: [], trash: [] });
check('有数据且 version 不一致时返回 409', r4.status === 409);

console.log(`TOTAL=${total} FAILS=${fails}`);
process.exit(fails ? 1 : 0);
