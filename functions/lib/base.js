// Firebase app, secrets, daily quotas, trip context and DeepSeek calls (shared by every function).
import { initializeApp } from 'firebase-admin/app';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
export const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
export const PLACES_API_KEY = defineSecret('PLACES_API_KEY');
export const RAPIDAPI_KEY = defineSecret('RAPIDAPI_KEY');
// The browser key for Google's embedded maps (directions by public transport): only usable from the site and only for
// the Maps Embed API, handed to signed-in travellers so it is not in the public repository.
export const MAPS_EMBED_KEY = defineSecret('MAPS_EMBED_KEY');
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Daily limits per companion, so a leaked login cannot run up the AI or Google Maps bill.
const DAILY = { ai: 200, maps: 300, tr: 300, navi: 40 };

// Counts one use in usage/{uid}_{UTC date} (no client access: firestore.rules has no match for it).
export async function useQuota(uid, kind) {
 if (!uid) throw new HttpsError('failed-precondition', 'no user');
 const ref = getFirestore().doc(`usage/${uid}_${new Date().toISOString().slice(0, 10)}`);
 const n = await getFirestore().runTransaction(async tx => {
  const v = ((await tx.get(ref)).get(kind) || 0) + 1;
  tx.set(ref, { [kind]: v, at: Date.now() }, { merge: true });
  return v;
 });
 if (n > DAILY[kind]) throw new HttpsError('resource-exhausted', '今日使用次數已達上限，明天再試。');
}
// Prompts follow the trip: where the travellers are and which currencies they use.
export const tripInfo = t => ({ place: t?.destination || 'abroad', cur: t?.currency || 'JPY', home: t?.homeCurrency || 'HKD' });

async function isMember(token) {
 if (!token?.email || token.email_verified !== true) return false;
 const doc = await getFirestore().doc('config/members').get();
 return (doc.get('emails') || []).includes(token.email.toLowerCase());
}
// Callable functions: only signed-in companions on the member list.
export async function requireMember(req, denied = '這個帳戶未在旅伴名單。') {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', denied);
}

// think: false turns off the model's reasoning, for plain tasks such as translating names (it can otherwise spend its
// whole token budget thinking and return nothing).
export async function askDeepSeek(prompt, images, { think = true } = {}) {
 // DeepSeek's JSON mode can return empty content (or run out of tokens on long replies): log why and retry once.
 for (let attempt = 1; attempt <= 2; attempt++) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
   method: 'POST',
   headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY.value().trim()}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({
    model: 'deepseek-flash',
    response_format: { type: 'json_object' },
    max_tokens: 8000,
    ...(think ? {} : { thinking: { type: 'disabled' } }),
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'high' } }))] }],
   }),
   signal: AbortSignal.timeout(80_000),
  });
  if (!res.ok) {
   console.error('DeepSeek request failed', res.status, (await res.text()).slice(0, 500));
   throw new HttpsError('unavailable', '暫時未能分析收據，請稍後再試。');
  }
  const body = await res.json(), choice = body.choices?.[0];
  const content = String(choice?.message?.content || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try {
   return JSON.parse(content);
  } catch {
   console.error('Unreadable model reply', JSON.stringify({ attempt, images: images.length, finish: choice?.finish_reason, usage: body.usage, reasoning: !!choice?.message?.reasoning_content, content: content.slice(0, 300) }));
  }
 }
 throw new HttpsError('internal', '未能讀取收據內容，可以重試或手動輸入。');
}
// DeepSeek's own web tools (https://api-docs.deepseek.com/guides/search): search results with summaries, and a page as
// Markdown (it can read sites that turn away cloud servers).
export async function deepseekTool(tool, body) {
 const res = await fetch(`https://api.deepseek.com/v1/tools/${tool}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY.value().trim()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
 });
 if (!res.ok) {
  console.error(`DeepSeek ${tool} failed`, res.status, (await res.text()).slice(0, 300));
  return null;
 }
 return res.json();
}
