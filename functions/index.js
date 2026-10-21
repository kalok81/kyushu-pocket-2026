// Receipt reader: a signed-in travel companion sends a receipt photo, DeepSeek reads it,
// and the page pre-fills the expense form. Photos are not stored.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const PLACES_API_KEY = defineSecret('PLACES_API_KEY');
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
