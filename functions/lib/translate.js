// Traditional Chinese names for places, shopping items and expenses (translateNames trigger).
import { cloudEvent } from '@google-cloud/functions-framework';
import { getFirestore } from 'firebase-admin/firestore';
import { PLACES_API_KEY, askDeepSeek, tripInfo, useQuota } from './base.js';

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
// A place's name as Google Maps shows it in Hong Kong Chinese: the shop found by its name next to its position (300 m).
// Used when it has Chinese characters and no kana (e.g. 可麗露Carandonel, 湖畔咖啡廳 Cafe La Ruche); otherwise its
// romanised name (Pan Stock Tenjin) is a hint for the model.
const HAN = /[\u4e00-\u9fff]/, KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;
async function googleName(name, lat, lng) {
 if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
 const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': PLACES_API_KEY.value().trim(), 'X-Goog-FieldMask': 'places.displayName,places.location' },
  body: JSON.stringify({ textQuery: name, languageCode: 'zh-HK', maxResultCount: 1, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } } }),
  signal: AbortSignal.timeout(10_000),
 }).catch(() => null);
 const p = res?.ok ? (await res.json()).places?.[0] : null, at = p?.location;
 if (!at) return '';
 const r = Math.PI / 180, d = 2 * 6371e3 * Math.asin(Math.sqrt(Math.sin(((at.latitude - lat) * r) / 2) ** 2 + Math.cos(lat * r) * Math.cos(at.latitude * r) * Math.sin(((at.longitude - lng) * r) / 2) ** 2));
 return d < 300 ? String(p.displayName?.text || '').trim().slice(0, 120) : '';
}
const zhPrompt = (t, kind, names, hint = '') => `Translate these ${kind} from a trip to ${tripInfo(t).place} into Traditional Chinese as used in Hong Kong.
Reply with JSON only: {"names": [string, ...]} with exactly ${names.length} entries in the same order.
- Use the name Hong Kong people use when there is one (e.g. ドン・キホーテ → 唐吉訶德, ファミリーマート → 全家便利店, セブンイレブン → 7-Eleven, 一蘭 → 一蘭); otherwise translate the meaning naturally in Hong Kong wording (e.g. 三文魚, not 鮭魚).
- Keep brand names written in Latin letters that have no common Chinese name, and keep quantities and sizes (×2, 100g).
- Never give back Japanese kana as they are: a kana brand becomes its Latin name if it has one, else a Chinese rendering, and say what kind of shop it is when the name does not (e.g. パンストック天神店 → Pain Stock 麵包店 天神店, 食堂 おわん → Owan 食堂, うま馬 祇園本店 → Umauma 博多拉麵 祇園本店).
- A shop or place named only in Latin letters or kana also gets Chinese: what kind of place it is (e.g. CARANDONEL → Carandonel 可麗露店).
- If an entry is already Traditional Chinese (a Japanese original in brackets after it is fine), return it unchanged.${hint ? `\n- Google Maps calls the first one "${hint}"; use it for the brand's spelling.` : ''}
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
 // a place: Google Maps' Chinese name when it has one
 const google = m[2] === 'places' ? await googleName(names[0], d.lat, d.lng).catch(() => '') : '';
 if (google && HAN.test(google) && !KANA.test(google) && google !== names[0].trim()) return save(ref, m[2], key, [google]);
 let got;
 try {
  got = (await askDeepSeek(zhPrompt(tripDoc, kind, names, google), [], { think: false })).names;
 } catch (e) {
  console.error('translate', path, e?.message);
  return;
 }
 if (!Array.isArray(got) || got.length !== names.length) return console.error('translate: wrong reply', path);
 await save(ref, m[2], key, got.map((z, i) => (typeof z === 'string' && z.trim() && z.trim() !== names[i].trim() ? z.trim().slice(0, 120) : '')));
});
// The name may have changed while Google or the model was answering: only the matching text is written.
async function save(ref, col, key, zh) {
 await getFirestore().runTransaction(async tx => {
  const now = await tx.get(ref);
  if (!now.exists || ZH_SOURCES[col](now.data()).names.join('\n') !== key) return;
  tx.update(ref, { zh: zh[0], zhFor: key, ...(col === 'expenses' ? { itemsZh: zh.slice(1) } : {}) });
 });
}
