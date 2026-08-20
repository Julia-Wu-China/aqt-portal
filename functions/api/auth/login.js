import { getUsers, makeToken, json, cors } from '../../_lib/wecom.js';

export async function onRequestOptions() { return cors(); }

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const body = await request.json();
    const users = await getUsers(env);
    const u = users.find(x => x.wecom_userid === body.wecom_userid);
    if (!u) return json(500, { error: '用户不存在: ' + body.wecom_userid });
    return json(200, { token: makeToken(u.id), user: u });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
