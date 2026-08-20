const tokenCache = { token: null, expire: 0 };
const appTokenCache = { token: null, expire: 0 };

async function getAccessToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.expire) return tokenCache.token;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${env.WECOM_CORPID}&corpsecret=${env.WECOM_CONTACT_SECRET}`;
  const r = await (await fetch(url)).json();
  if (r.errcode) throw new Error(`gettoken errcode=${r.errcode}: ${r.errmsg}`);
  tokenCache.token = r.access_token;
  tokenCache.expire = Date.now() + (r.expires_in - 200) * 1000;
  return r.access_token;
}

async function callWecom(env, apiPath) {
  const token = await getAccessToken(env);
  const sep = apiPath.includes('?') ? '&' : '?';
  const r = await (await fetch(`https://qyapi.weixin.qq.com/cgi-bin${apiPath}${sep}access_token=${token}`)).json();
  return r;
}

async function getAppAccessToken(env) {
  if (appTokenCache.token && Date.now() < appTokenCache.expire) return appTokenCache.token;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${env.WECOM_CORPID}&corpsecret=${env.WECOM_APP_SECRET}`;
  const r = await (await fetch(url)).json();
  if (r.errcode) throw new Error(`app gettoken errcode=${r.errcode}: ${r.errmsg}`);
  appTokenCache.token = r.access_token;
  appTokenCache.expire = Date.now() + (r.expires_in - 200) * 1000;
  return r.access_token;
}

export async function getUseridByCode(env, code) {
  const token = await getAppAccessToken(env);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${token}&code=${code}`;
  const r = await (await fetch(url)).json();
  if (r.errcode) throw new Error(`getuserinfo errcode=${r.errcode}: ${r.errmsg}`);
  return r.userid || null;
}

export function makeToken(userId) {
  return 'wecom.' + btoa(JSON.stringify({ userId, ts: Date.now() }));
}

export function parseToken(token) {
  if (!token || !token.startsWith('wecom.')) return null;
  try { return JSON.parse(atob(token.replace(/^wecom\./, ''))); }
  catch { return null; }
}

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

export async function getDepartments(env) {
  const r = await callWecom(env, '/department/list');
  if (r.errcode) throw new Error(`department/list errcode=${r.errcode}: ${r.errmsg}`);
  return (r.department || []).map(d => {
    const c = colorFor(d.id);
    return { id: d.id, name: d.name, color_primary: c.primary, color_soft: c.soft };
  });
}

export async function getUsers(env) {
  const r = await callWecom(env, '/user/list?department_id=1&fetch_child=1');
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
      is_super_admin: 0,
    };
  });
}

export function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

export function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}
