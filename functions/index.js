// Receipt reader (DeepSeek, run in the background on receiptJobs) and Google Maps place lookup for the travel guide.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { cloudEvent } from '@google-cloud/functions-framework';
import { defineSecret } from 'firebase-functions/params';
import { randomInt } from 'node:crypto';

initializeApp();
const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const PLACES_API_KEY = defineSecret('PLACES_API_KEY');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PROMPT = `You read shop receipts photographed by travellers in Japan (sometimes Hong Kong).
Reply with JSON only, in this shape:
{"merchant": string, "total": number, "currency": "JPY" | "HKD" | "OTHER", "date": "YYYY-MM-DD" or null, "items": [{"name": string, "amount": number}], "confidence": "high" | "medium" | "low", "part": "whole" | "top" | "middle" | "bottom"}
- merchant: the shop name as printed (keep Japanese), at most 60 characters.
- The receipt may come as several photos (strips of a long receipt, or separate shots of its top and bottom, possibly overlapping and in any order): treat them as one receipt and do not count repeated lines twice.
- total: the amount actually paid, tax included (合計 / お買上計 / 税込 / お支払 / お会計 / ご請求額 / 免税合計 / 免税対象合計). Not the cash tendered (お預り), change (お釣り), subtotal before tax (小計) or tax lines (消費税).
- currency: JPY for yen (¥, 円), HKD for Hong Kong dollars, otherwise OTHER.
- items: up to 30 line items with their printed prices (quantity included in the name, e.g. ×2); empty list if unreadable.
- confidence: low if the photo is blurry, cut off, or not a receipt.
- part: whole if the photos show the complete receipt from the shop name to the total; top if the total is cut off; bottom if the shop name/header is cut off; middle if both are cut off.
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
  items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).map(i => ({ name: text(i?.name, 40), amount: num(i?.amount) })).filter(i => i.name),
  confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
  part: ['whole', 'top', 'middle', 'bottom'].includes(r.part) ? r.part : 'whole',
 };
}

const readReceipt = images => askDeepSeek(PROMPT, images).then(clean);

async function askDeepSeek(prompt, images) {
 // DeepSeek's JSON mode can return empty content (or run out of tokens on long replies): log why and retry once.
 for (let attempt = 1; attempt <= 2; attempt++) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
   method: 'POST',
   headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY.value().trim()}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({
    model: 'deepseek-flash',
    response_format: { type: 'json_object' },
    max_tokens: 8000,
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
const PRODUCT_PROMPT = `You identify products that travellers in Japan photograph to put on a shopping list (packages, labels, price tags, shelves, screenshots).
Reply with JSON only, in this shape:
{"name": string, "spec": string, "detail": string, "price": number or null, "currency": "JPY" | "HKD", "place": string, "confidence": "high" | "medium" | "low"}
- name: the product in Traditional Chinese (Hong Kong usage), with the brand and the original Japanese/English product name in brackets when different, at most 80 characters.
- spec: size, quantity or variant printed on it (e.g. 100g, 30枚入, ミント味), at most 30 characters; empty if unknown.
- detail: one short Traditional Chinese line on what it is or what it is for, at most 60 characters.
- price: only if a price tag or label with this product's price is visible (tax-included price if both are shown); otherwise null.
- place: a shop name only if it is visible in the photo (price tag, shelf sign, bag); otherwise empty.
- confidence: low if the photo is unclear or shows no identifiable product.`;

function cleanProduct(r) {
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 && r.price <= 1e7 ? Math.round(r.price * 100) / 100 : null;
 return { name: text(r.name, 80), qty: text(r.spec, 30), detail: text(r.detail, 500), place: text(r.place, 200), price, currency: r.currency === 'HKD' ? 'HKD' : 'JPY', confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low' };
}

const validImage = image => typeof image === 'string' && /^[A-Za-z0-9+/=]+$/.test(image) && image.length * 0.75 <= MAX_IMAGE_BYTES;

// Background receipts and product photos (kind: 'product'): the page stores shrunk photos in receiptJobs (Firestore keeps unsent writes on the
// phone and retries after a reload), and this trigger reads it server-side even if the page was closed.
// Only members can create jobs (firestore.rules). Photos are removed when the page adds or discards the job.
// Deployed with gcloud as a plain CloudEvent function (Eventarc, Firestore document.written on trips/{trip}/receiptJobs/{id}).
// The event subject names the document; the job is read fresh here, so the event payload encoding does not matter.
cloudEvent('processReceipt', async event => {
 const path = String(event.subject || '').replace(/^documents\//, '');
 const m = path.match(/^trips\/([A-Za-z0-9_-]+)\/receiptJobs\/[A-Za-z0-9]+$/);
 if (!m) return;
 const trip = m[1];
 const ref = getFirestore().doc(path);
 const job = await getFirestore().runTransaction(async tx => {
  const snap = await tx.get(ref);
  if (!snap.exists || snap.get('status') !== 'pending') return null;
  tx.update(ref, { status: 'processing', startedAt: Date.now() });
  return { images: snap.get('images') ?? [snap.get('image')], kind: snap.get('kind') || 'receipt', by: snap.get('by'), byName: snap.get('byName') };
 });
 if (job === null) return;
 const { images } = job;
 try {
  if (!Array.isArray(images) || !images.length || images.length > 4 || !images.every(validImage)) throw new HttpsError('invalid-argument', '相片格式不正確或太大。');
  if (job.kind === 'productFill') {
   // Photo added in the shopping form: return the details so the page can fill the empty fields.
   const { confidence: _c, ...result } = cleanProduct(await askDeepSeek(PRODUCT_PROMPT, images));
   if (!result.name) throw new HttpsError('not-found', '認不出物品，請手動輸入。');
   await ref.update({ status: 'done', result, images: FieldValue.delete(), doneAt: Date.now() });
   return;
  }
  if (job.kind === 'product') {
   // Product photo: add the item straight to the shared shopping list (with the photo) and drop the job.
   const { confidence: _confidence, ...item } = cleanProduct(await askDeepSeek(PRODUCT_PROMPT, images));
   if (!item.name) throw new HttpsError('not-found', '認不出物品，可以重試或手動輸入。');
   const db = getFirestore();
   await db.collection(`trips/${trip}/shopping`).add({ ...item, photo: images[0].length <= 400000 ? images[0] : null, bought: false, boughtBy: null, boughtAt: null, ai: true, by: job.by, byName: job.byName, at: Date.now(), createdAt: FieldValue.serverTimestamp() });
   await ref.delete();
   return;
  }
  const result = await readReceipt(images);
  // No readable total line: fall back to the item sum, flagged so the page asks the traveller to check it.
  const itemSum = Math.round(result.items.reduce((t, i) => t + i.amount, 0) * 100) / 100;
  if (!result.total && itemSum > 0) Object.assign(result, { total: itemSum, totalFromItems: true, confidence: 'low' });
  // Photos stay on the job until the traveller adds or discards it, so partial shots can still be merged or retried.
  await ref.update(result.total
   ? { status: 'done', result, error: FieldValue.delete(), doneAt: Date.now() }
   : { status: 'failed', error: '讀不到金額，可以重試或手動輸入。', result, doneAt: Date.now() });
 } catch (e) {
  await ref.update({ status: 'failed', error: e instanceof HttpsError ? e.message : job.kind !== 'receipt' ? '未能辨識物品，請稍後再試。' : '未能分析收據，請稍後再試。', doneAt: Date.now() });
 }
});

// Place lookup: a companion pastes a Google Maps link on 探索; we resolve it (short links included),
// then ask the Places API for the details that pre-fill the place form.
const MAPS_HOST = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.(com|co\.jp|com\.hk))$/;

async function resolveMapsUrl(raw) {
 let url;
 try { url = new URL(raw); } catch { throw new HttpsError('invalid-argument', '連結格式不正確。'); }
 for (let hop = 0; hop < 5; hop++) {
  if (url.protocol !== 'https:' || !MAPS_HOST.test(url.hostname)) throw new HttpsError('invalid-argument', '請貼上 Google 地圖的連結。');
  if (!/goo\.gl$/.test(url.hostname)) return url;
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const next = res.headers.get('location');
  if (!next) throw new HttpsError('not-found', '未能打開這個地圖連結。');
  url = new URL(next, url);
 }
 throw new HttpsError('invalid-argument', '連結轉址次數太多。');
}

function parseMapsUrl(url) {
 const path = decodeURIComponent(url.pathname);
 const name = path.match(/\/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ');
 const pin = url.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || path.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
 const q = url.searchParams.get('q') || url.searchParams.get('query');
 const coords = q?.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
 const at = pin ? { lat: +pin[1], lng: +pin[2] } : coords ? { lat: +coords[1], lng: +coords[2] } : null;
 return { query: name || (coords ? null : q) || null, at };
}

// Name and address in Japanese (as on signs and in the Sheet); hours and type label in Chinese.
const SEARCH_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'types', 'websiteUri', 'googleMapsUri', 'priceRange'].map(f => 'places.' + f).join(',');
const DETAIL_FIELDS = 'regularOpeningHours.weekdayDescriptions,primaryTypeDisplayName';
async function placesApi(path, fields, body) {
 const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': PLACES_API_KEY.value().trim(), 'X-Goog-FieldMask': fields },
  body: body && JSON.stringify(body),
  signal: AbortSignal.timeout(15_000),
 });
 if (!res.ok) {
  console.error('Places request failed', res.status, (await res.text()).slice(0, 500));
  throw new HttpsError('unavailable', '暫時未能查詢地點，請稍後再試。');
 }
 return res.json();
}
const search = async (kind, body) => (await placesApi(`places:${kind}`, SEARCH_FIELDS, { languageCode: 'ja', maxResultCount: 1, ...body })).places?.[0];

function category(types = []) {
 const t = types.join(' ');
 if (/restaurant|cafe|coffee|bakery|bar\b|food|meal|ramen|sushi|izakaya|dessert|confectionery/.test(t)) return '餐廳';
 if (/tourist_attraction|park|museum|shrine|temple|place_of_worship|zoo|aquarium|hot_spring|spa|observation|landmark|garden|beach/.test(t)) return '景點';
 if (/store|shop|mall|market|supermarket|department/.test(t)) return '商店';
 return '';
}
function price(range) {
 const amount = p => p && `${p.currencyCode === 'JPY' ? '¥' : p.currencyCode + ' '}${Number(p.units || 0).toLocaleString('en-US')}`;
 if (!range) return '';
 if (range.endPrice && Number(range.startPrice?.units || 0) <= 1) return `${amount(range.endPrice)} 以下`;
 return [amount(range.startPrice), amount(range.endPrice)].filter(Boolean).join('–');
}

export const lookupPlace = onCall({ region: 'asia-northeast1', secrets: [PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 40, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 // Either a Google Maps link, or plain text (a shop name and/or address, e.g. a shopping item's 購買地點).
 const text = req.data?.query;
 if (typeof text === 'string') {
  if (!text.trim() || text.length > 300) throw new HttpsError('invalid-argument', '請輸入店名或地址。');
  const place = await search('searchText', { textQuery: text.trim(), regionCode: 'JP' });
  if (!place) throw new HttpsError('not-found', '找不到這個地點。');
  return { name: place.displayName?.text || '', address: place.formattedAddress || '', lat: place.location?.latitude ?? null, lng: place.location?.longitude ?? null };
 }
 const raw = req.data?.url;
 if (typeof raw !== 'string' || raw.length > 2000) throw new HttpsError('invalid-argument', '請貼上 Google 地圖的連結。');
 const url = await resolveMapsUrl(raw.trim().match(/https:\/\/\S+/)?.[0] || raw.trim());
 const { query, at } = parseMapsUrl(url);
 const bias = at && { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: 300 } };
 const place = query
  ? await search('searchText', { textQuery: query, ...(bias && { locationBias: bias }) })
  : at ? await search('searchNearby', { rankPreference: 'DISTANCE', locationRestriction: { circle: { ...bias.circle, radius: 50 } } }) : null;
 if (!place) throw new HttpsError('not-found', '找不到這個地點，請手動輸入。');
 const detail = await placesApi(`places/${place.id}?languageCode=zh-TW`, DETAIL_FIELDS).catch(() => ({}));
 return {
  name: place.displayName?.text || query || '',
  address: place.formattedAddress || '',
  lat: place.location?.latitude ?? at?.lat ?? null,
  lng: place.location?.longitude ?? at?.lng ?? null,
  hours: (detail.regularOpeningHours?.weekdayDescriptions || []).join('\n'),
  price: price(place.priceRange),
  category: category(place.types),
  type: detail.primaryTypeDisplayName?.text || '',
  website: place.websiteUri || '',
  mapsUrl: place.googleMapsUri || url.href,
 };
});

// Trips: create a trip, change its details, and add or remove companions. Trip documents are only written here
// (firestore.rules deny client writes), so the member list and the site allowlist (config/members) stay in step.
const CURRENCIES = ['JPY', 'HKD', 'KRW', 'TWD', 'THB', 'CNY', 'SGD', 'MYR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'VND', 'PHP', 'IDR'];
const ACCOUNT_DOMAIN = 'kyushu-trip.invalid';
const dateOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
function tripFields(d) {
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const out = { name: text(d.name, 60), destination: text(d.destination, 80), startDate: d.startDate, endDate: d.endDate, currency: d.currency, homeCurrency: d.homeCurrency || 'HKD' };
 if (!out.name || !out.destination) throw new HttpsError('invalid-argument', '請填旅程名稱和目的地。');
 if (!dateOk(out.startDate) || !dateOk(out.endDate) || out.endDate < out.startDate) throw new HttpsError('invalid-argument', '日期不正確。');
 if ((Date.parse(out.endDate) - Date.parse(out.startDate)) / 864e5 > 59) throw new HttpsError('invalid-argument', '旅程最多 60 天。');
 if (!CURRENCIES.includes(out.currency) || !CURRENCIES.includes(out.homeCurrency)) throw new HttpsError('invalid-argument', '貨幣不支援。');
 return out;
}
async function geocode(text) {
 try {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': PLACES_API_KEY.value().trim(), 'X-Goog-FieldMask': 'places.location,places.addressComponents' }, body: JSON.stringify({ textQuery: text, maxResultCount: 1, languageCode: 'zh-TW' }), signal: AbortSignal.timeout(15_000) });
  const p = (await res.json()).places?.[0];
  return p?.location ? { lat: p.location.latitude, lng: p.location.longitude, country: p.addressComponents?.find(c => c.types?.includes('country'))?.shortText || '' } : null;
 } catch { return null; }
}
export const manageTrip = onCall({ region: 'asia-northeast1', secrets: [PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 40, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未獲准使用。');
 const db = getFirestore(), me = req.auth.token.email.toLowerCase(), d = req.data || {}, action = d.action;
 if (action === 'create') {
  const fields = tripFields(d), place = await geocode(fields.destination);
  const ref = db.collection('trips').doc();
  await ref.set({ ...fields, generic: true, center: place ? { lat: place.lat, lng: place.lng } : null, country: place?.country || '', members: [me], createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
 }
 const ref = db.doc(`trips/${String(d.trip || '').replace(/[^A-Za-z0-9_-]/g, '')}`), trip = await ref.get();
 if (!trip.exists || !(trip.get('members') || []).includes(me)) throw new HttpsError('permission-denied', '你不是這個旅程的旅伴。');
 if (action === 'update') {
  const fields = tripFields({ ...trip.data(), ...d });
  const center = fields.destination !== trip.get('destination') ? await geocode(fields.destination) : null;
  await ref.update({ ...fields, ...(center ? { center: { lat: center.lat, lng: center.lng }, country: center.country } : {}) });
  return { ok: true };
 }
 if (action === 'addMember') {
  const allow = getFirestore().doc('config/members');
  let email, password = null;
  if (d.kind === 'google') {
   email = String(d.email || '').trim().toLowerCase();
   if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError('invalid-argument', '電郵不正確。');
  } else {
   const id = String(d.id || '').trim().toLowerCase();
   if (!/^[a-z0-9._-]{2,30}$/.test(id)) throw new HttpsError('invalid-argument', '帳號 ID 只可用英文字母、數字、點、底線或連字號（2–30 字）。');
   email = `${id}@${ACCOUNT_DOMAIN}`;
   const { getAuth } = await import('firebase-admin/auth');
   const exists = await getAuth().getUserByEmail(email).then(() => true, () => false);
   if (!exists) {
    password = Array.from({ length: 10 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[randomInt(31)]).join('');
    await getAuth().createUser({ email, password, displayName: String(d.name || id).slice(0, 40), emailVerified: true });
   }
  }
  await allow.set({ emails: FieldValue.arrayUnion(email) }, { merge: true });
  await ref.update({ members: FieldValue.arrayUnion(email) });
  return { email, password };
 }
 if (action === 'removeMember') {
  const email = String(d.email || '').toLowerCase();
  if (email === me) throw new HttpsError('invalid-argument', '不可以移除自己。');
  await ref.update({ members: FieldValue.arrayRemove(email) });
  return { ok: true };
 }
 throw new HttpsError('invalid-argument', '未知的操作。');
});
