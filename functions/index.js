// Receipt reader: a signed-in travel companion sends a receipt photo, DeepSeek reads it,
// and the page pre-fills the expense form. Photos are not stored.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PROMPT = `You read shop receipts photographed by travellers in Japan (sometimes Hong Kong).
Reply with JSON only, in this shape:
{"merchant": string, "total": number, "currency": "JPY" | "HKD" | "OTHER", "date": "YYYY-MM-DD" or null, "items": [{"name": string, "amount": number}], "confidence": "high" | "medium" | "low"}
- merchant: the shop name as printed (keep Japanese), at most 60 characters.
- total: the amount actually paid, tax included (合計 / お買上計 / 税込). Not the cash tendered (お預り) or change (お釣り).
- currency: JPY for yen (¥, 円), HKD for Hong Kong dollars, otherwise OTHER.
- items: up to 8 main line items with their printed prices; empty list if unreadable.
- confidence: low if the photo is blurry, cut off, or not a receipt.
If it is not a receipt, return total 0 and confidence "low".`;

async function isMember(token) {
 if (!token?.email || token.email_verified !== true) return false;
 const doc = await getFirestore().doc('config/members').get();
 return (doc.get('emails') || []).includes(token.email.toLowerCase());
}

function clean(r) {
 const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7 ? Math.round(v * 100) / 100 : 0);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 return {
  merchant: text(r.merchant, 60),
  total: num(r.total),
  currency: ['JPY', 'HKD'].includes(r.currency) ? r.currency : 'OTHER',
  date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
  items: (Array.isArray(r.items) ? r.items : []).slice(0, 8).map(i => ({ name: text(i?.name, 40), amount: num(i?.amount) })).filter(i => i.name),
  confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
 };
}

export const scanReceipt = onCall({ region: 'asia-northeast1', secrets: [DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 const image = req.data?.image;
 if (typeof image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image) || image.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpsError('invalid-argument', '相片格式不正確或太大。');

 const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY.value().trim()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
   model: 'deepseek-flash',
   response_format: { type: 'json_object' },
   max_tokens: 1500,
   messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }] }],
  }),
  signal: AbortSignal.timeout(50_000),
 });
 if (!res.ok) {
  console.error('DeepSeek request failed', res.status, (await res.text()).slice(0, 500));
  throw new HttpsError('unavailable', '暫時未能分析收據，請稍後再試。');
 }
 const content = (await res.json()).choices?.[0]?.message?.content;
 try {
  return clean(JSON.parse(content));
 } catch {
  console.error('Unreadable model reply', String(content).slice(0, 500));
  throw new HttpsError('internal', '未能讀取收據內容，請手動輸入。');
 }
});
