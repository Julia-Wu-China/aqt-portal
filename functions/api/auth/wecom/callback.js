import { getUseridByCode, getUsers, makeToken, json, cors } from '../../../_lib/wecom.js';

export async function onRequestOptions() { return cors(); }

export async function onRequestGet(context) {
  const { env, request } = context;
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return json(500, { error: '缺少 code 参数' });
  try {
    const userid = await getUseridByCode(env, code);
    if (!userid) return json(500, { error: '无法获取用户身份' });
    const users = await getUsers(env);
    const u = users.find(x => x.wecom_userid === userid);
    if (!u) return json(500, { error: '用户不在通讯录中: ' + userid });
    return json(200, { token: makeToken(u.id), user: u });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
