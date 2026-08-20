import { parseToken, getUsers, json, cors } from '../../_lib/wecom.js';

export async function onRequestOptions() { return cors(); }

export async function onRequestGet(context) {
  const { env, request } = context;
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  if (token.indexOf('portal_admin') !== -1) {
    return json(200, { user: { id: 'portal_admin', wecom_userid: 'portal_admin', name: '吴彤', dept_ids: [], lead_dept_ids: [], is_super_admin: 1 } });
  }
  const p = parseToken(token);
  if (!p) return json(200, { user: null });
  try {
    const users = await getUsers(env);
    const u = users.find(x => x.id === p.userId);
    return json(200, { user: u || null });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
