// Receipt reader (DeepSeek, run in the background on receiptJobs) and Google Maps place lookup for the travel guide.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { cloudEvent } from '@google-cloud/functions-framework';
import { defineSecret } from 'firebase-functions/params';
import { randomInt } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sharp from 'sharp';

initializeApp();
const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const PLACES_API_KEY = defineSecret('PLACES_API_KEY');
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Daily limits per companion, so a leaked login cannot run up the AI or Google Maps bill.
const DAILY = { ai: 80, maps: 300, tr: 300 };

// Counts one use in usage/{uid}_{UTC date} (no client access: firestore.rules has no match for it).
async function useQuota(uid, kind) {
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
const tripInfo = t => ({ place: t?.destination || 'abroad', cur: t?.currency || 'JPY', home: t?.homeCurrency || 'HKD' });
const receiptPrompt = t => { const { place, cur, home } = tripInfo(t); return `You read shop receipts photographed by travellers in ${place} (sometimes at home).
Reply with JSON only, in this shape:
{"merchant": string, "total": number, "currency": "${cur}" | "${home}" | "OTHER", "date": "YYYY-MM-DD" or null, "items": [{"name": string, "amount": number}], "category": "food" | "transport" | "shopping" | "stay" | "fun" | "other", "confidence": "high" | "medium" | "low", "part": "whole" | "top" | "middle" | "bottom"}
- merchant: the shop name as printed (keep the original language), at most 60 characters.
- The receipt may come as several photos (strips of a long receipt, or separate shots of its top and bottom, possibly overlapping and in any order): treat them as one receipt and do not count repeated lines twice.
- total: the amount actually paid, tax and service included (e.g. 合計 / お買上計 / 税込 / 免税合計 / 합계 / 결제금액 / 總計 / Total / Grand total). Not the cash tendered, change, subtotal before tax or tax lines.
- currency: ${cur} for the local currency, ${home} if the receipt is in ${home}, otherwise OTHER.
- items: up to 30 line items with their printed prices (quantity included in the name, e.g. ×2); empty list if unreadable.
- category: food for restaurants, cafés, snacks and drinks; transport for trains, buses, taxis, fuel, parking and transit cards; shopping for shops, supermarkets, convenience-store goods, drugstores and souvenirs; stay for hotels and lodging; fun for tickets, attractions, onsen and entertainment; other otherwise.
- confidence: low if the photo is blurry, cut off, or not a receipt.
- part: whole if the photos show the complete receipt from the shop name to the total; top if the total is cut off; bottom if the shop name/header is cut off; middle if both are cut off.
If it is not a receipt, return total 0 and confidence "low".`; };

async function isMember(token) {
 if (!token?.email || token.email_verified !== true) return false;
 const doc = await getFirestore().doc('config/members').get();
 return (doc.get('emails') || []).includes(token.email.toLowerCase());
}

function clean(r, t) {
 const { cur, home } = tripInfo(t);
 const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7 ? Math.round(v * 100) / 100 : 0);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 return {
  merchant: text(r.merchant, 60),
  total: num(r.total),
  currency: [cur, home].includes(r.currency) ? r.currency : 'OTHER',
  date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
  items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).map(i => ({ name: text(i?.name, 40), amount: num(i?.amount) })).filter(i => i.name),
  category: ['food', 'transport', 'shopping', 'stay', 'fun', 'other'].includes(r.category) ? r.category : 'other',
  confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
  part: ['whole', 'top', 'middle', 'bottom'].includes(r.part) ? r.part : 'whole',
 };
}

const readReceipt = (images, t) => askDeepSeek(receiptPrompt(t), images).then(r => clean(r, t));

// think: false turns off the model's reasoning, for plain tasks such as translating names (it can otherwise spend its
// whole token budget thinking and return nothing).
async function askDeepSeek(prompt, images, { think = true } = {}) {
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
async function deepseekTool(tool, body) {
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
const productPrompt = t => { const { place, cur, home } = tripInfo(t); return `You identify products that travellers in ${place} photograph to put on a shopping list (packages, labels, price tags, shelves, screenshots).
Reply with JSON only, in this shape:
{"name": string, "spec": string, "detail": string, "category": "drug" | "food" | "fashion" | "home" | "stationery" | "toys" | "electronics" | "other", "price": number or null, "currency": "${cur}" | "${home}", "place": string, "confidence": "high" | "medium" | "low"}
- name: the product in Traditional Chinese (Hong Kong usage), with the brand and the original-language product name in brackets when different, at most 80 characters.
- spec: size, quantity or variant printed on it (e.g. 100g, 30枚入, mint), at most 30 characters; empty if unknown.
- detail: one short Traditional Chinese line on what it is or what it is for, at most 60 characters.
- category: drug for cosmetics, skincare, hair care, beauty tools, medicine, patches and supplements (drugstore goods); food for snacks, sweets, drinks, instant food and condiments; fashion for clothes, shoes, bags, wallets and accessories; home for kitchen and household goods; stationery for pens, notebooks and office goods; toys for toys, games, figures, character and idol goods; electronics for gadgets and appliances; other otherwise.
- price: only if a price tag or label with this product's price is visible (tax-included price if both are shown); otherwise null.
- currency: ${cur} unless the price is clearly in ${home}.
- place: a shop name only if it is visible in the photo (price tag, shelf sign, bag); otherwise empty.
- confidence: low if the photo is unclear or shows no identifiable product.`; };

function cleanProduct(r, t) {
 const { cur, home } = tripInfo(t);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 && r.price <= 1e7 ? Math.round(r.price * 100) / 100 : null;
 const cats = ['drug', 'food', 'fashion', 'home', 'stationery', 'toys', 'electronics', 'other'];
 return { name: text(r.name, 80), qty: text(r.spec, 30), detail: text(r.detail, 500), cat: cats.includes(r.category) ? r.category : 'other', place: text(r.place, 200), price, currency: r.currency === home ? home : cur, confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low' };
}

// ---- Products from a web link: a product page (title, description, price, main picture) or a picture itself ----
// Only public http(s) addresses on ports 80/443 are fetched (no private or local networks), at most 4 redirects,
// 3 MB, 15 s; pictures are shrunk to an 800px JPEG for the AI and the shopping list.
const privateIp = ip => {
 if (isIP(ip) === 6) {
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return privateIp(l.slice(7));
  return l === '::' || l === '::1' || /^f[cd]/.test(l) || l.startsWith('fe80');
 }
 const [a, b] = ip.split('.').map(Number);
 return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
async function safeFetch(link, maxBytes = 3e6) {
 let url = new URL(link);
 for (let hop = 0; hop < 5; hop++) {
  if (!['http:', 'https:'].includes(url.protocol) || (url.port && !['80', '443'].includes(url.port))) throw new HttpsError('invalid-argument', '只支援一般 http／https 網址。');
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new HttpsError('invalid-argument', '未能開啟這個網址。');
  const res = await fetch(url, {
   redirect: 'manual',
   headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PocketTravel/1.0)', Accept: 'text/html,image/*;q=0.9,*/*;q=0.5', 'Accept-Language': 'ja,zh-TW;q=0.9,en;q=0.7' },
   signal: AbortSignal.timeout(15_000),
  });
  const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
  if (next) { url = new URL(next, url); continue; }
  if (!res.ok)
   throw new HttpsError('not-found', [401, 403, 429].includes(res.status) || res.headers.get('server') === 'cloudflare'
    ? `這個網站不讓程式讀取（${res.status}）。請在手機截圖後直接貼上，AI 會讀截圖。`
    : `網頁未能開啟（${res.status}）。可以截圖後直接貼上。`);
  const chunks = []; let size = 0;
  for await (const c of res.body) { size += c.length; if (size > maxBytes) throw new HttpsError('invalid-argument', '網頁或圖片太大。'); chunks.push(c); }
  return { url, type: res.headers.get('content-type') || '', buf: Buffer.concat(chunks) };
 }
 throw new HttpsError('invalid-argument', '網址轉址太多次。');
}
const smallJpeg = async buf => (await sharp(buf, { failOn: 'none' }).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()).toString('base64');
const decodeEntities = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
// The page's product facts: Open Graph / product meta tags, JSON-LD Product, <title>, and the start of its text.
function pageFacts(html, base) {
 const meta = k => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*>`, 'i'))?.[0]; return m ? decodeEntities(m.match(/content=["']([^"']*)/i)?.[1] || '') : ''; };
 let product = null;
 for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
   const walk = v => (Array.isArray(v) ? v.flatMap(walk) : v && typeof v === 'object' ? [v, ...walk(v['@graph'] || [])] : []);
   product ??= walk(JSON.parse(m[1])).find(x => [].concat(x['@type']).includes('Product'));
  } catch {}
 }
 const offer = [].concat(product?.offers || [])[0] || {};
 const image = [].concat(product?.image || [])[0];
 const picture = meta('og:image') || meta('twitter:image') || (typeof image === 'string' ? image : image?.url) || '';
 const text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
 return {
  site: meta('og:site_name') || base.hostname,
  title: (product?.name || meta('og:title') || decodeEntities(html.match(/<title[^>]*>([^<]*)/i)?.[1] || '')).trim().slice(0, 200),
  description: String(product?.description || meta('og:description') || meta('description')).trim().slice(0, 600),
  brand: String(product?.brand?.name || product?.brand || '').slice(0, 80),
  price: String(offer.price || meta('product:price:amount') || '').slice(0, 30),
  currency: String(offer.priceCurrency || meta('product:price:currency') || '').slice(0, 10),
  picture: picture ? new URL(decodeEntities(picture), base).href : '',
  text: decodeEntities(text).trim().slice(0, 3000),
 };
}
const decodeHtml = ({ buf, type }) => {
 const cs = (type.match(/charset=([\w-]+)/i)?.[1] || buf.subarray(0, 4000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
 try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
};
// Returns { image (base64 JPEG or null), facts (page facts or null) } for a product page or picture link.
async function readProductLink(link) {
 let got;
 try {
  got = await safeFetch(link);
 } catch (e) {
  // Sites that block cloud servers (Cloudflare and the like): ask DeepSeek's Fetch for the page text instead.
  if (!/不讓程式讀取/.test(e?.message || '')) throw e;
  const page = await deepseekTool('fetch', { url: link });
  if (!page?.content) throw e;
  const base = new URL(link);
  return { image: null, facts: { site: base.hostname, title: String(page.title || '').slice(0, 200), description: '', brand: '', price: '', currency: '', picture: '', text: String(page.content).replace(/\s+/g, ' ').slice(0, 3000) }, link };
 }
 if (got.type.startsWith('image/')) return { image: await smallJpeg(got.buf), facts: null, link: got.url.href };
 if (!/html|xml/.test(got.type)) throw new HttpsError('invalid-argument', '這個連結不是網頁或圖片。');
 const facts = pageFacts(decodeHtml(got), got.url);
 let image = null;
 if (facts.picture) image = await safeFetch(facts.picture).then(p => (p.type.startsWith('image/') ? smallJpeg(p.buf) : null)).catch(() => null);
 return { image, facts, link: got.url.href };
}
const pagePrompt = (t, f) => `${productPrompt(t)}
The traveller pasted a link to this web page instead of a photo; the picture (if any) is the page's main image.
If the page is not about one specific product (a home, category, search or shop page), reply with an empty name and confidence low.
Use the page for the name, spec and detail; the price only if it is in ${tripInfo(t).cur} or ${tripInfo(t).home}; place: the shop or brand selling it if clear.
Page: ${JSON.stringify({ site: f.site, title: f.title, brand: f.brand, description: f.description, price: f.price, currency: f.currency, text: f.text.slice(0, 2000) })}`;

// ---- Notes and coupons: fill the 共用 form from a photo (coupon, sign, menu, timetable) or a web page ----
const noteFillPrompt = (t, mode, f) => { const { place } = tripInfo(t); return `Travellers in ${place} keep notes and coupons in a shared trip app. ${f ? 'They pasted a link to the web page below' : 'They added the photo'} to a ${mode === 'coupon' ? 'coupon' : 'note'}.
Reply with JSON only, in this shape:
{"kind": "coupon" | "note", "title": string, "text": string, "code": string, "until": "YYYY-MM-DD" or null, "place": string}
- kind: coupon if it is a discount, voucher, coupon or special offer; otherwise note.
- title: for a coupon, the shop and the offer in short (e.g. "Bic Camera 免稅 10% + 5%"); for a note, a short heading. Traditional Chinese (Hong Kong usage), keeping shop and product names as written, at most 60 characters.
- text: for a coupon, the discount and its conditions (minimum spend, items, passport, how to use); for a note, the useful points in short lines (what, where, when, prices, opening hours, booking). Traditional Chinese, at most 400 characters; keep names, numbers, times and addresses exactly.
- code: a coupon or promo code exactly as printed (letters and digits); empty if none.
- until: the last day it is valid; if the year is not shown, use the next such date; null if not shown.
- place: the shop, venue or branch it is for, as written; empty if unclear.${f ? `
Page: ${JSON.stringify({ site: f.site, title: f.title, description: f.description, text: f.text.slice(0, 2500) })}` : ''}`; };
function cleanNoteFill(r) {
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 return {
  kind: r.kind === 'coupon' ? 'coupon' : 'note',
  title: text(r.title, 80),
  text: text(r.text, 1000),
  code: text(r.code, 60),
  until: typeof r.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.until) ? r.until : '',
  place: text(r.place, 120),
 };
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
  return { images: snap.get('images') ?? (snap.get('image') != null ? [snap.get('image')] : []), url: snap.get('url') || '', mode: snap.get('mode') || 'note', kind: snap.get('kind') || 'receipt', by: snap.get('by'), byName: snap.get('byName') };
 });
 if (job === null) return;
 const { images } = job;
 const tripDoc = (await getFirestore().doc(`trips/${trip}`).get()).data();
 try {
  if (job.kind === 'noteFill') {
   // 共用 form: a photo or a web page link; the page fills the empty fields of the note or coupon being written.
   await useQuota(job.by, 'ai');
   let facts = null, pics = images.filter(validImage).slice(0, 1);
   if (job.url) {
    const got = await readProductLink(job.url).catch(e => {
     if (e instanceof HttpsError) throw e;
     throw new HttpsError('unavailable', '未能開啟這個網址（網站可能不允許讀取），可以改為截圖。');
    });
    facts = got.facts;
    if (got.image && !pics.length) pics = [got.image];
   }
   if (!pics.length && !facts) throw new HttpsError('invalid-argument', '沒有相片或網頁可以分析。');
   const result = cleanNoteFill(await askDeepSeek(noteFillPrompt(tripDoc, job.mode, facts), pics));
   if (!result.title && !result.text) throw new HttpsError('not-found', 'AI 未能讀出內容，請自行填寫。');
   await ref.update({ status: 'done', result, images: FieldValue.delete(), doneAt: Date.now() });
   return;
  }
  if (job.url && job.kind === 'product') {
   // Web link instead of a photo: a product page or a picture.
   await useQuota(job.by, 'ai');
   const got = await readProductLink(job.url).catch(e => {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('unavailable', '未能開啟這個網址（網站可能不允許讀取），可以改為截圖上載。');
   });
   const pics = got.image ? [got.image] : [];
   const { confidence, ...item } = cleanProduct(await askDeepSeek(got.facts ? pagePrompt(tripDoc, got.facts) : productPrompt(tripDoc), pics), tripDoc);
   if (!item.name || confidence === 'low') throw new HttpsError('not-found', '這個連結看不到特定商品，請貼上產品頁面或產品圖片。');
   await getFirestore().collection(`trips/${trip}/shopping`).add({ ...item, url: got.link.slice(0, 500), photo: got.image && got.image.length <= 400000 ? got.image : null, bought: false, boughtBy: null, boughtAt: null, ai: true, by: job.by, byName: job.byName, at: Date.now(), createdAt: FieldValue.serverTimestamp() });
   await ref.delete();
   return;
  }
  if (!Array.isArray(images) || !images.length || images.length > 4 || !images.every(validImage)) throw new HttpsError('invalid-argument', '相片格式不正確或太大。');
  await useQuota(job.by, 'ai');
  if (job.kind === 'productFill') {
   // Photo added in the shopping form: return the details so the page can fill the empty fields.
   const { confidence: _c, ...result } = cleanProduct(await askDeepSeek(productPrompt(tripDoc), images), tripDoc);
   if (!result.name) throw new HttpsError('not-found', '認不出物品，請手動輸入。');
   await ref.update({ status: 'done', result, images: FieldValue.delete(), doneAt: Date.now() });
   return;
  }
  if (job.kind === 'product') {
   // Product photo: add the item straight to the shared shopping list (with the photo) and drop the job.
   const { confidence: _confidence, ...item } = cleanProduct(await askDeepSeek(productPrompt(tripDoc), images), tripDoc);
   if (!item.name) throw new HttpsError('not-found', '認不出物品，可以重試或手動輸入。');
   const db = getFirestore();
   await db.collection(`trips/${trip}/shopping`).add({ ...item, photo: images[0].length <= 400000 ? images[0] : null, bought: false, boughtBy: null, boughtAt: null, ai: true, by: job.by, byName: job.byName, at: Date.now(), createdAt: FieldValue.serverTimestamp() });
   await ref.delete();
   return;
  }
  const result = await readReceipt(images, tripDoc);
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

// Hours and type label in Chinese; name and address in the language chosen by langFor.
const SEARCH_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'types', 'websiteUri', 'googleMapsUri', 'priceRange', 'addressComponents'].map(f => 'places.' + f).join(',');
const DETAIL_FIELDS = 'regularOpeningHours.weekdayDescriptions,primaryTypeDisplayName';
// For 必吃・必買・特色 and a tidy 參考價格與營業時間 (place form only): Google's summary and visitors' reviews, billed at the Atmosphere tier.
const HIGHLIGHT_FIELDS = ',editorialSummary,reviews';
const highlightPrompt = (t, name, type, summary, reviews, hours, priceRange) => `A traveller is adding a place to a trip to ${tripInfo(t).place}: ${name}${type ? ` (${type})` : ''}.
From Google's data and visitors' reviews below, fill two fields of their place note, in Traditional Chinese as used in Hong Kong.
Reply with JSON only: {"type": string, "highlights": string, "priceHours": string}
- type (類型): what kind of place it is in 2–6 Chinese characters, as specific as the text allows (e.g. 拉麵、咖啡店、居酒屋、甜品店、藥妝店、百貨公司、寺院、神社、展望台、溫泉), not just 餐廳 or 商店 when something more exact is known.
- highlights (必吃・必買・特色): what to eat, buy or not miss, about 120 Chinese characters, short points joined by "、" or "；", e.g. "招牌豚骨拉麵、可加辣度；必試替玉；晚上人少". Only what the text supports: dishes, products, souvenirs, views, tips (queues, best time to go). No ratings, no generic praise.
- priceHours (參考價格與營業時間): two short lines. Line 1 "價格：…" from the price range or prices mentioned in reviews (e.g. "價格：每人約 ¥1,000–2,000", "價格：免費入場", "價格：拉麵 ¥980 起"); leave the line out if nothing says. Line 2 "時間：…" summing up the opening hours compactly (e.g. "時間：每日 11:00–22:00；星期三休息", "時間：24 小時營業", "時間：平日 10:00–20:00，週末 9:00–21:00").
- Empty string for a field the text says nothing about.
Opening hours: ${JSON.stringify(hours)}
Price range: ${JSON.stringify(priceRange || '')}
Description: ${JSON.stringify(summary || '')}
Reviews: ${JSON.stringify(reviews)}`;
async function placeHighlights(t, name, type, detail, priceRange) {
 const reviews = (detail.reviews || []).map(r => String(r.originalText?.text || r.text?.text || '').slice(0, 600)).filter(Boolean).slice(0, 5);
 const summary = detail.editorialSummary?.text || '', hours = detail.regularOpeningHours?.weekdayDescriptions || [];
 if (!reviews.length && !summary && !hours.length) return {};
 const r = await askDeepSeek(highlightPrompt(t, name, type, summary, reviews, hours, priceRange), [], { think: false });
 const field = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 return { type: field(r?.type, 20), highlights: field(r?.highlights, 300), priceHours: field(r?.priceHours, 300) };
}
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
// Names and addresses in Japanese for trips in Japan (as on signs); elsewhere in Traditional Chinese.
// Local script where travellers need it to match signs and show drivers (Japan, Korea); Chinese elsewhere.
const langFor = country => ({ JP: 'ja', KR: 'ko' })[country] || 'zh-TW';
const search = async (kind, body, country) => (await placesApi(`places:${kind}`, SEARCH_FIELDS, { languageCode: langFor(country), maxResultCount: 1, ...(country && kind === 'searchText' ? { regionCode: country } : {}), ...body })).places?.[0];
// The neighbourhood name: in Japan the town (浅草) is sublocality_level_2 and the deeper levels are block numbers (２丁目, ３).
const district = p => {
 const c = p?.addressComponents || [], named = t => t && !/^[\d０-９\-−－]+(丁目|番地?|号)?$/.test(t) && !/丁目$/.test(t);
 const pick = t => c.find(x => x.types?.includes(t) && named(x.longText))?.longText;
 return pick('sublocality_level_1') || pick('sublocality_level_2') || pick('neighborhood') || pick('locality') || pick('administrative_area_level_2') || '';
};

function category(types = []) {
 const t = types.join(' ');
 if (/restaurant|cafe|coffee|bakery|bar\b|food|meal|ramen|sushi|izakaya|dessert|confectionery/.test(t)) return '餐廳';
 if (/tourist_attraction|park|museum|shrine|temple|place_of_worship|zoo|aquarium|hot_spring|spa|observation|landmark|garden|beach/.test(t)) return '景點';
 if (/store|shop|mall|market|supermarket|department/.test(t)) return '商店';
 return '';
}
function price(range) {
 const amount = p => p && `${{ JPY: '¥', KRW: '₩', TWD: 'NT$', HKD: 'HK$', THB: '฿', CNY: '¥', USD: 'US$', EUR: '€', GBP: '£' }[p.currencyCode] || p.currencyCode + ' '}${Number(p.units || 0).toLocaleString('en-US')}`;
 if (!range) return '';
 if (range.endPrice && Number(range.startPrice?.units || 0) <= 1) return `${amount(range.endPrice)} 以下`;
 return [amount(range.startPrice), amount(range.endPrice)].filter(Boolean).join('–');
}

export const lookupPlace = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [PLACES_API_KEY, DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 await useQuota(req.auth.uid, 'maps');
 // Either a Google Maps link, or plain text (a shop name and/or address, e.g. a shopping item's 購買地點).
 const text = req.data?.query, country = typeof req.data?.country === 'string' && /^[A-Z]{2}$/.test(req.data.country) ? req.data.country : '';
 if (typeof text === 'string') {
  if (!text.trim() || text.length > 300) throw new HttpsError('invalid-argument', '請輸入店名或地址。');
  const place = await search('searchText', { textQuery: text.trim() }, country);
  if (!place) throw new HttpsError('not-found', '找不到這個地點。');
  return { name: place.displayName?.text || '', address: place.formattedAddress || '', lat: place.location?.latitude ?? null, lng: place.location?.longitude ?? null };
 }
 const raw = req.data?.url;
 if (typeof raw !== 'string' || raw.length > 2000) throw new HttpsError('invalid-argument', '請貼上 Google 地圖的連結。');
 const url = await resolveMapsUrl(raw.trim().match(/https:\/\/\S+/)?.[0] || raw.trim());
 const { query, at } = parseMapsUrl(url);
 const bias = at && { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: 300 } };
 const place = query
  ? await search('searchText', { textQuery: query, ...(bias && { locationBias: bias }) }, country)
  : at ? await search('searchNearby', { rankPreference: 'DISTANCE', locationRestriction: { circle: { ...bias.circle, radius: 50 } } }, country) : null;
 if (!place) throw new HttpsError('not-found', '找不到這個地點，請手動輸入。');
 // highlights: the place form asks for 必吃・必買・特色 too (one AI use; left out when the day's AI uses are spent).
 const wantHighlights = req.data?.highlights === true;
 const detail = await placesApi(`places/${place.id}?languageCode=zh-TW`, DETAIL_FIELDS + (wantHighlights ? HIGHLIGHT_FIELDS : '')).catch(() => ({}));
 let ai = {};
 if (wantHighlights)
  try {
   await useQuota(req.auth.uid, 'ai');
   const trip = typeof req.data?.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(req.data.trip) ? (await getFirestore().doc(`trips/${req.data.trip}`).get()).data() : null;
   ai = await placeHighlights(trip, place.displayName?.text || query || '', detail.primaryTypeDisplayName?.text || '', detail, price(place.priceRange));
  } catch (e) {
   console.error('highlights', e?.message);
  }
 return {
  highlights: ai.highlights || '',
  priceHours: ai.priceHours || '',
  name: place.displayName?.text || query || '',
  address: place.formattedAddress || '',
  lat: place.location?.latitude ?? at?.lat ?? null,
  lng: place.location?.longitude ?? at?.lng ?? null,
  hours: (detail.regularOpeningHours?.weekdayDescriptions || []).join('\n'),
  price: price(place.priceRange),
  category: category(place.types),
  type: ai.type || detail.primaryTypeDisplayName?.text || '',
  website: place.websiteUri || '',
  mapsUrl: place.googleMapsUri || url.href,
  district: district(place),
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
export const manageTrip = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 40, maxInstances: 3 }, async req => {
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

// Route suggestions between two plan stops (Routes API): public transport, walking or driving, with alternatives
// summarised for the plan (lines, stations, times, fare). Times are the destination's local time.
const ZONES = { JP: 'Asia/Tokyo', KR: 'Asia/Seoul', TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau', CN: 'Asia/Shanghai', TH: 'Asia/Bangkok', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', ID: 'Asia/Jakarta', GB: 'Europe/London', FR: 'Europe/Paris', DE: 'Europe/Berlin', IT: 'Europe/Rome', ES: 'Europe/Madrid', NL: 'Europe/Amsterdam', CH: 'Europe/Zurich', US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland' };
// The UTC instant of a wall-clock time ('YYYY-MM-DDTHH:mm') in a time zone.
function zonedToUtc(local, zone) {
 const guess = Date.parse(local + ':00Z');
 const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
 return new Date(guess - (Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - guess));
}
const point = v => v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180
 ? { location: { latLng: { latitude: v.lat, longitude: v.lng } } }
 : typeof v?.address === 'string' && v.address.trim() ? { address: v.address.trim().slice(0, 200) } : null;
const mins = d => Math.max(0, Math.round(parseInt(d || '0', 10) / 60));
const ROUTE_FIELDS = ['duration', 'distanceMeters', 'travelAdvisory.transitFare', 'legs.steps.travelMode', 'legs.steps.staticDuration', 'legs.steps.distanceMeters', 'legs.steps.transitDetails'].map(f => 'routes.' + f).join(',');

export const suggestRoutes = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 40, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 const d = req.data || {}, origin = point(d.origin), destination = point(d.destination);
 if (!origin || !destination) throw new HttpsError('invalid-argument', '起點或終點沒有位置資料。');
 const mode = ['TRANSIT', 'WALK', 'DRIVE'].includes(d.mode) ? d.mode : 'TRANSIT';
 const country = typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country) ? d.country : '';
 const zone = ZONES[country] || 'UTC';
 await useQuota(req.auth.uid, 'maps');
 // Timetables only reach a few weeks ahead: for a past or far-off date, use the same weekday and time next week.
 let when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.time || '') ? zonedToUtc(d.time, zone) : null, estimated = false;
 if (when && (when < Date.now() + 10 * 60e3 || when > Date.now() + 60 * 864e5)) {
  const days = Math.ceil((Date.now() + 864e5 - when) / (7 * 864e5)) * 7;
  when = new Date(when.getTime() + days * 864e5); estimated = true;
 }
 const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': PLACES_API_KEY.value().trim(), 'X-Goog-FieldMask': ROUTE_FIELDS },
  body: JSON.stringify({ origin, destination, travelMode: mode, computeAlternativeRoutes: mode !== 'WALK', languageCode: langFor(country), units: 'METRIC', ...(country ? { regionCode: country } : {}), ...(mode === 'TRANSIT' && when ? { departureTime: when.toISOString() } : {}) }),
  signal: AbortSignal.timeout(20_000),
 });
 if (!res.ok) { console.error('Routes request failed', res.status, (await res.text()).slice(0, 500)); throw new HttpsError('unavailable', '未能查詢路線，請稍後再試。'); }
 const routes = (await res.json()).routes || [];
 const clock = t => t ? new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)) : '';
 const options = routes.slice(0, 6).map(r => {
  const leg = r.legs?.[0] || {}, steps = [];
  for (const s of leg.steps || []) {
   if (s.travelMode === 'TRANSIT' && s.transitDetails) {
    const t = s.transitDetails, line = t.transitLine || {}, sd = t.stopDetails || {};
    steps.push({ mode: 'TRANSIT', vehicle: line.vehicle?.type || '', line: (line.nameShort || line.name || line.vehicle?.name?.text || '').slice(0, 60), headsign: (t.headsign || '').slice(0, 60), from: (sd.departureStop?.name || '').slice(0, 60), to: (sd.arrivalStop?.name || '').slice(0, 60), stops: t.stopCount || 0, depart: clock(sd.departureTime), arrive: clock(sd.arrivalTime), minutes: mins(s.staticDuration) });
   } else {
    const m = mins(s.staticDuration), last = steps.at(-1);
    if (last && last.mode === s.travelMode) { last.minutes += m; last.meters += s.distanceMeters || 0; } else steps.push({ mode: s.travelMode || mode, minutes: m, meters: s.distanceMeters || 0 });
   }
  }
  const fare = r.travelAdvisory?.transitFare;
  return { minutes: mins(r.duration), meters: r.distanceMeters || 0, fare: fare?.currencyCode ? { currency: fare.currencyCode, amount: Number(fare.units || 0) + (fare.nanos || 0) / 1e9 } : null, steps: steps.filter(s => s.mode === 'TRANSIT' || s.minutes > 0) };
 });
 // Alternatives that differ only in departure time are the same way to go: keep the first of each.
 const seen = new Set(), unique = options.filter(o => { const k = o.steps.map(x => x.mode === 'TRANSIT' ? `${x.line}|${x.from}|${x.to}` : x.mode).join('>'); return !seen.has(k) && seen.add(k); });
 return { options: unique.slice(0, 4), estimated, when: when ? when.toISOString() : null };
});

// AI route advice (DeepSeek) for a plan link, mainly where Google offers no public transport data (Japan).
// Returns options in the same shape as suggestRoutes; times and fares are the model's estimates.
const placeText = p => [p?.name, p?.address, Number.isFinite(p?.lat) && Number.isFinite(p?.lng) ? `(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})` : ''].filter(Boolean).join(' ').slice(0, 300);
export const aiRoutes = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 const d = req.data || {}, from = placeText(d.origin), to = placeText(d.destination);
 if (!from || !to) throw new HttpsError('invalid-argument', '起點或終點沒有資料。');
 await useQuota(req.auth.uid, 'ai');
 const where = String(d.destination?.region || d.place || '').slice(0, 80), when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.time || '') ? d.time.replace('T', ' ') : '';
 const cur = typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency) ? d.currency : 'JPY';
 const prompt = `You are a local transport expert helping Hong Kong travellers${where ? ` in ${where}` : ''}.
Suggest the practical ways to get from A to B${when ? ` leaving around ${when} local time` : ''}.
A: ${from}
B: ${to}
Reply with JSON only:
{"options": [{"title": string, "minutes": number, "fare": number or null, "confidence": "high" | "medium" | "low", "steps": [{"mode": "WALK" | "TRANSIT" | "TAXI" | "DRIVE", "vehicle": "SUBWAY" | "HEAVY_RAIL" | "HIGH_SPEED_TRAIN" | "BUS" | "TRAM" | "MONORAIL" | "FERRY" | "" , "line": string, "from": string, "to": string, "minutes": number}], "note": string}], "advice": string}
- Up to 4 options, best first: e.g. fastest, cheapest, fewest transfers, taxi if sensible. Only one option if there is clearly one sensible way (e.g. a short walk).
- Use real line, station and stop names as written on local signs (Japanese in Japan, Korean in Korea); do not invent lines or stations. If unsure of a detail, say so in note.
- minutes: door-to-door total including walking and typical waiting; steps' minutes add up roughly to it. Walking steps have empty line/from/to.
- confidence: high only if you know these exact lines and stations run between A and B; low if the route, times or fare are guesses.
- fare: per adult in ${cur} (IC card fare where it applies), null if unknown.
- title, note and advice in Traditional Chinese as used in Hong Kong, short. note: what to watch out for (exit to use, transfer, last train, crowding). advice: one or two sentences comparing the options.`;
 let r;
 try { r = await askDeepSeek(prompt, []); } catch (e) { console.error('aiRoutes', e?.message); throw new HttpsError('unavailable', 'AI 暫時未能分析路線，請稍後再試。'); }
 const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : 0);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const options = (Array.isArray(r?.options) ? r.options : []).slice(0, 4).map(o => ({
  title: text(o.title, 40), minutes: num(o.minutes, 1440), note: text(o.note, 200),
  confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low',
  fare: typeof o.fare === 'number' && o.fare > 0 && o.fare < 1e6 ? { currency: cur, amount: Math.round(o.fare * 100) / 100 } : null,
  steps: (Array.isArray(o.steps) ? o.steps : []).slice(0, 10).map(s => ({ mode: ['WALK', 'TRANSIT', 'TAXI', 'DRIVE'].includes(s.mode) ? s.mode : 'TRANSIT', vehicle: text(s.vehicle, 30), line: text(s.line, 60), from: text(s.from, 60), to: text(s.to, 60), minutes: num(s.minutes, 1440) })),
 })).filter(o => o.steps.length);
 return { options, advice: text(r?.advice, 300) };
});

// Names in another language (explore places, shopping items, expenses and their receipt lines) get a Traditional
// Chinese translation next to the original: zh (and itemsZh for expense lines), with zhFor holding the text it
// translates, so an edited name is translated again and an unchanged one never is. Runs on every write to those
// collections; names already in Traditional Chinese are left alone without asking the model.
const NEEDS_ZH = /[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]|[A-Za-z]{3,}|[駅鉄県広沢気楽売焼円区国学会黒済渋豊発対応関観館変図価産専続薬単営転徳様総帯処鶏麺団湯]/;
const ZH_SOURCES = {
 places: d => ({ kind: 'shops and places', names: [String(d.fields?.[1] || '')] }),
 shopping: d => ({ kind: 'products on a shopping list', names: [String(d.name || '')] }),
 expenses: d => ({ kind: 'shop names and receipt lines', names: [String(d.title || ''), ...(Array.isArray(d.items) ? d.items : []).map(i => String(i?.name || ''))] }),
};
const zhPrompt = (t, kind, names) => `Translate these ${kind} from a trip to ${tripInfo(t).place} into Traditional Chinese as used in Hong Kong.
Reply with JSON only: {"names": [string, ...]} with exactly ${names.length} entries in the same order.
- Use the name Hong Kong people use when there is one (e.g. ドン・キホーテ → 唐吉訶德, ファミリーマート → 全家便利店, セブンイレブン → 7-Eleven, 一蘭 → 一蘭); otherwise translate the meaning naturally in Hong Kong wording (e.g. 三文魚, not 鮭魚).
- Keep brand names written in Latin letters that have no common Chinese name, and keep quantities and sizes (×2, 100g).
- If an entry is already Traditional Chinese, return it unchanged.
Names: ${JSON.stringify(names)}`;
cloudEvent('translateNames', async event => {
 const path = String(event.subject || '').replace(/^documents\//, '');
 const m = path.match(/^trips\/([A-Za-z0-9_-]+)\/(places|shopping|expenses)\/[A-Za-z0-9_-]+$/);
 if (!m) return;
 const ref = getFirestore().doc(path), snap = await ref.get();
 if (!snap.exists || snap.get('deleted')) return;
 const d = snap.data(), { kind, names } = ZH_SOURCES[m[2]](d), key = names.join('\n');
 if (!names[0].trim() || d.zhFor === key || !names.some(n => NEEDS_ZH.test(n))) return;
 try {
  await useQuota(d.by, 'tr');
 } catch {
  return;
 }
 const tripDoc = (await getFirestore().doc(`trips/${m[1]}`).get()).data();
 let got;
 try {
  got = (await askDeepSeek(zhPrompt(tripDoc, kind, names), [], { think: false })).names;
 } catch (e) {
  console.error('translate', path, e?.message);
  return;
 }
 if (!Array.isArray(got) || got.length !== names.length) return console.error('translate: wrong reply', path);
 const zh = got.map((z, i) => (typeof z === 'string' && z.trim() && z.trim() !== names[i].trim() ? z.trim().slice(0, 120) : ''));
 // The name may have changed while the model was answering: only the matching text is written.
 await getFirestore().runTransaction(async tx => {
  const now = await tx.get(ref);
  if (!now.exists || ZH_SOURCES[m[2]](now.data()).names.join('\n') !== key) return;
  tx.update(ref, { zh: zh[0], zhFor: key, ...(m[2] === 'expenses' ? { itemsZh: zh.slice(1) } : {}) });
 });
});

// 購物 › 購買地點: search the web (DeepSeek Search) for where an item is sold, then let the model pick the places at
// or near the trip's destination. Returns up to 4 places as shop name + area (as on local signs) with a short reason.
const buyPrompt = (t, item, results) => `Hong Kong travellers on a trip to ${tripInfo(t).place} want to buy this item: ${JSON.stringify(item)}.
From the web search results below, list where they can buy it at or near the destination of the trip.
Reply with JSON only: {"places": [{"name": string, "why": string}], "note": string}
- places: up to 4, best first (shops at main stations, airports and popular shopping areas first). name: the shop or counter name and its area or building as written locally, short enough to search on Google Maps (e.g. "ふくや 博多デイトス売店", "福岡空港 国内線 ANA FESTA"). why: at most 20 Traditional Chinese characters (e.g. "博多站內，營業至 21:00").
- Only places the results support; do not invent shops. No places if the results show none near the destination.
- note: at most 60 Traditional Chinese characters (Hong Kong usage) for anything important, e.g. that it is mainly sold elsewhere (北海道限定) or only at the airport; empty otherwise.
Search results: ${JSON.stringify(results)}`;
export const findBuyPlaces = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 90, maxInstances: 3 }, async req => {
 if (!req.auth) throw new HttpsError('unauthenticated', '請先登入。');
 if (!(await isMember(req.auth.token))) throw new HttpsError('permission-denied', '這個帳戶未在旅伴名單。');
 const d = req.data || {}, text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const item = { name: text(d.name, 80), spec: text(d.qty, 30), detail: text(d.detail, 200) };
 if (!item.name) throw new HttpsError('invalid-argument', '請先輸入物品名稱。');
 await useQuota(req.auth.uid, 'ai');
 const trip = typeof d.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(d.trip) ? (await getFirestore().doc(`trips/${d.trip}`).get()).data() : null;
 const where = tripInfo(trip).place, name = item.name.replace(/[（(].*?[)）]/g, ' ').trim().slice(0, 60);
 const searches = await Promise.all([`${name} 販売店 ${where}`, `${name} 哪裡買 ${where}`].map(q => deepseekTool('search', { query: q.slice(0, 128), count: 6 })));
 const results = searches.flatMap(r => r?.results || []).filter((r, i, all) => all.findIndex(x => x.url === r.url) === i)
  .slice(0, 10).map(r => ({ title: String(r.title || '').slice(0, 120), url: r.url, summary: String(r.summary || r.snippet || '').slice(0, 700) }));
 if (!results.length) throw new HttpsError('not-found', '網上找不到這件物品的購買地點。');
 const r = await askDeepSeek(buyPrompt(trip, item, results), [], { think: false });
 const places = (Array.isArray(r?.places) ? r.places : []).slice(0, 4).map(p => ({ name: text(p?.name, 100), why: text(p?.why, 40) })).filter(p => p.name);
 return { places, note: text(r?.note, 120), sources: [...new Set(results.slice(0, 3).map(x => new URL(x.url).hostname))] };
});
