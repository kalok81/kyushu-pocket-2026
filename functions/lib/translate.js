// Traditional Chinese names for places, shopping items and expenses (translateNames trigger).
import { cloudEvent } from '@google-cloud/functions-framework';
import { getFirestore } from 'firebase-admin/firestore';
import { askDeepSeek, tripInfo, useQuota } from './base.js';

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
