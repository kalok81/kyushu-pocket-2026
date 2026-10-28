// Background AI jobs (receiptJobs): receipts, product photos and links, note and event fills, and AI 助手 (translate, ask).
import { cloudEvent } from '@google-cloud/functions-framework';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { answerQuestion, translatePhoto } from './assistant.js';
import { MAX_IMAGE_BYTES, askDeepSeek, tripInfo, useQuota } from './base.js';
import { articleItems, articlePictures, cleanEventFill, cleanNoteFill, cleanProduct, eventFillPrompt, eventVenue, finishProduct, noteFillPrompt, pagePrompt, productPrompt, readProductLink } from './products.js';

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

// The job's answer for the page (its photos are no longer needed).
const jobDone = (ref, result) => ref.update({ status: 'done', result, images: FieldValue.delete(), doneAt: Date.now() });
// A product link or picture; why: the message when the site cannot be read.
const openLink = (url, why) =>
 readProductLink(url).catch(e => {
  if (e instanceof HttpsError) throw e;
  throw new HttpsError('unavailable', why);
 });
// An AI-read item goes straight onto the shared shopping list (with its picture when small enough); the job is dropped.
async function addToList(trip, job, ref, item, photo) {
 await getFirestore().collection(`trips/${trip}/shopping`).add({ ...item, photo: photo && photo.length <= 400000 ? photo : null, bought: false, boughtBy: null, boughtAt: null, ai: true, by: job.by, byName: job.byName, at: Date.now(), createdAt: FieldValue.serverTimestamp() });
 await ref.delete();
}
// A product from its photos: read by the AI, then its local name, Chinese fields and reviews.
async function productFromPhotos(images, tripDoc, unknown) {
 const { confidence: _c, ...read } = cleanProduct(await askDeepSeek(productPrompt(tripDoc), images), tripDoc);
 if (!read.name) throw new HttpsError('not-found', unknown);
 return finishProduct(read, tripDoc);
}
const FAILED = { receipt: '未能分析收據，請稍後再試。', translate: '未能翻譯，請稍後再試。', ask: 'AI 暫時未能回答，請稍後再試。' };
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
  return { images: snap.get('images') ?? (snap.get('image') != null ? [snap.get('image')] : []), url: snap.get('url') || '', mode: snap.get('mode') || 'note', kind: snap.get('kind') || 'receipt', question: snap.get('question'), context: snap.get('context'), history: snap.get('history'), by: snap.get('by'), byName: snap.get('byName') };
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
    const got = await openLink(job.url, '未能開啟這個網址（網站可能不允許讀取），可以改為截圖。');
    facts = got.facts;
    if (got.image && !pics.length) pics = [got.image];
   }
   if (!pics.length && !facts) throw new HttpsError('invalid-argument', '沒有相片或網頁可以分析。');
   const result = cleanNoteFill(await askDeepSeek(noteFillPrompt(tripDoc, job.mode, facts), pics));
   if (!result.title && !result.text) throw new HttpsError('not-found', 'AI 未能讀出內容，請自行填寫。');
   await jobDone(ref, result);
   return;
  }
  if (job.kind === 'eventFill') {
   // 活動 form: a web page link or a poster photo; the page fills the empty fields and links the venue to 探索.
   await useQuota(job.by, 'ai');
   let facts = null, pics = images.filter(validImage).slice(0, 1);
   if (job.url) {
    const got = await openLink(job.url, '未能開啟這個網址（網站可能不允許讀取），可以改為截圖。');
    facts = got.facts;
    if (got.image && !pics.length) pics = [got.image];
   }
   if (!pics.length && !facts) throw new HttpsError('invalid-argument', '沒有相片或網頁可以分析。');
   const result = cleanEventFill(await askDeepSeek(eventFillPrompt(tripDoc, facts), pics));
   if (!result.title && !result.venue) throw new HttpsError('not-found', 'AI 未能讀出活動資料，請自行填寫。');
   const place = await eventVenue(result.venueSearch || result.venue, tripDoc).catch(() => null);
   await jobDone(ref, { ...result, ...(place ? { place } : {}) });
   return;
  }
  if (job.kind === 'ask') {
   // AI 助手: a question about the trip, answered from the summary the page sent.
   await useQuota(job.by, 'ai');
   await jobDone(ref, await answerQuestion(job, tripDoc));
   return;
  }
  if (job.url && job.kind === 'product') {
   // Web link instead of a photo: a product page or a picture.
   await useQuota(job.by, 'ai');
   const got = await openLink(job.url, '未能開啟這個網址（網站可能不允許讀取），可以改為截圖上載。');
   const pics = got.image ? [got.image] : [];
   const { confidence, ...item } = cleanProduct(await askDeepSeek(got.facts ? pagePrompt(tripDoc, got.facts) : productPrompt(tripDoc), pics), tripDoc, got.facts ? [got.facts.title, got.facts.description, got.facts.text].join(' ') : '');
   if (!item.name || confidence === 'low') {
    // Not one product: an article or list ("福岡手信10大推介"). The traveller picks from the products it names.
    const list = got.facts ? await articleItems(job.url, tripDoc, got.html && articlePictures(got.html, got.base)) : null;
    if (!list?.choices.length) throw new HttpsError('not-found', '這個連結看不到特定商品，請貼上產品頁面或產品圖片。');
    await ref.update({ status: 'done', result: list, doneAt: Date.now() });
    return;
   }
   await addToList(trip, job, ref, { ...(await finishProduct(item, tripDoc)), url: got.link.slice(0, 500) }, got.image);
   return;
  }
  if (!Array.isArray(images) || !images.length || images.length > 4 || !images.every(validImage)) throw new HttpsError('invalid-argument', '相片格式不正確或太大。');
  await useQuota(job.by, 'ai');
  if (job.kind === 'translate') {
   // AI 助手: a photographed menu or sign, translated.
   await jobDone(ref, await translatePhoto(images.slice(0, 2), tripDoc));
   return;
  }
  if (job.kind === 'productFill') {
   // Photo added in the shopping form: return the details so the page can fill the empty fields.
   const result = await productFromPhotos(images, tripDoc, '認不出物品，請手動輸入。');
   await jobDone(ref, result);
   return;
  }
  if (job.kind === 'product') {
   // Product photo: add the item straight to the shared shopping list (with the photo) and drop the job.
   const item = await productFromPhotos(images, tripDoc, '認不出物品，可以重試或手動輸入。');
   await addToList(trip, job, ref, item, images[0]);
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
  await ref.update({ status: 'failed', error: e instanceof HttpsError ? e.message : FAILED[job.kind] || '未能辨識物品，請稍後再試。', doneAt: Date.now() });
 }
});
