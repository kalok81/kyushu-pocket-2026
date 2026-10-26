// Trips: create, change and share (manageTrip) and geocoding.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';
import { PLACES_API_KEY, requireMember } from './base.js';

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
 await requireMember(req, '這個帳戶未獲准使用。');
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
