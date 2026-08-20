import { json, cors } from '../../../_lib/wecom.js';

export async function onRequestOptions() { return cors(); }

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.WECOM_APP_SECRET || !env.WECOM_AGENT_ID) {
    return json(500, { error: '未配置应用 Secret 或 AgentId' });
  }
  const origin = new URL(request.url).origin;
  const redirectUri = encodeURIComponent(origin + '/');
  const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${env.WECOM_CORPID}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=aqt&agentid=${env.WECOM_AGENT_ID}#wechat_redirect`;
  return Response.redirect(authUrl, 302);
}
