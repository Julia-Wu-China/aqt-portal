import { getDepartments, json, cors } from '../_lib/wecom.js';

export async function onRequestOptions() { return cors(); }

export async function onRequestGet(context) {
  try {
    return json(200, { departments: await getDepartments(context.env) });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
