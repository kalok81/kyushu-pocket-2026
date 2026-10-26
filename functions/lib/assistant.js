// AI 助手 (receiptJobs kinds 'translate' and 'ask'): translating a photographed menu or sign, and answering questions about the trip.
import { HttpsError } from 'firebase-functions/v2/https';
import { askDeepSeek, tripInfo } from './base.js';

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const translatePrompt = t => { const { place, cur } = tripInfo(t); return `Travellers from Hong Kong on a trip to ${place} photographed something they cannot read: a menu, sign, notice, label, ticket machine, timetable or packaging. Translate it for them.
Reply with JSON only, in this shape:
{"kind": "menu" | "sign" | "label" | "other", "title": string, "summary": string, "items": [{"original": string, "zh": string, "price": number or null, "note": string}], "tips": string}
Write every Chinese field in Traditional Chinese with Hong Kong usage (e.g. 薯仔, 士多啤梨, 雪糕, 單車).
- title: what it is, at most 20 characters (e.g. 拉麵店菜單, 停車場告示, 藥品說明).
- summary: the gist in one to three sentences. For signs, notices and labels give the full meaning, including rules, times, prices and warnings.
- items: for a menu, each dish or drink in the photo's order (at most 60): original as printed, zh a natural Hong Kong name for it, price as printed in ${cur} (the tax-included price when both are shown) or null, note what it is in at most 25 characters (main ingredients, raw, spicy, pork or beef, what a set includes, size). For anything else, each line or section of text with its translation (price null, note optional).
- tips: anything travellers should know here (order at the ticket machine, cover charge, tax, last order, allergens, how to use it), at most 60 characters, or "".
- Translate only what is in the photo; do not invent dishes or prices. If nothing is readable, return kind "other", explain in summary, and items [].`; };

function cleanTranslation(r) {
 const price = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e7 ? Math.round(v * 100) / 100 : null);
 return {
  kind: ['menu', 'sign', 'label', 'other'].includes(r?.kind) ? r.kind : 'other',
  title: text(r?.title, 40),
  summary: text(r?.summary, 600),
  items: (Array.isArray(r?.items) ? r.items : []).slice(0, 60).map(i => ({ original: text(i?.original, 120), zh: text(i?.zh, 120), price: price(i?.price), note: text(i?.note, 60) })).filter(i => i.original || i.zh),
  tips: text(r?.tips, 120),
 };
}

export async function translatePhoto(images, tripDoc) {
 const result = cleanTranslation(await askDeepSeek(translatePrompt(tripDoc), images, { think: false }));
 if (!result.summary && !result.items.length) throw new HttpsError('not-found', '讀不到相片上的文字，可以影近一點再試。');
 return result;
}

const askPrompt = (t, context, history, question) => `You are the travel assistant inside 口袋旅伴, the trip app of a group of Hong Kong travellers on a trip to ${tripInfo(t).place}.
Answer their question in Traditional Chinese, in Hong Kong Cantonese wording, practical and to the point (about 250 characters unless they ask for more).
Use their trip data below: the date and time now, each day's plan, their saved places (area, category, what to eat or buy, hours), hotels, events, the weather forecast, and where they are now when given.
- Prefer places on their list and say which day or area they fit. You may suggest well-known places that are not on the list; mark each with 「（清單外）」.
- Distances in the data are straight-line metres; walking takes about 1 minute per 80 m.
- Do not invent opening hours, prices or transport times you are not sure of; say to check instead.
- Questions about Japanese words, customs, etiquette or how to do something: answer directly.
Reply with JSON only: {"answer": string, "places": [string]}
- answer: plain text; short lists as lines starting with "• "; no Markdown headings or ** bold.
- places: up to 6 names exactly as written in their place list that the answer recommends (none for places outside the list).
Trip data:
${context}
${history.length ? `Earlier in this chat: ${JSON.stringify(history)}\n` : ''}Question: ${question}`;

export async function answerQuestion(job, tripDoc) {
 const question = text(job.question, 500);
 if (!question) throw new HttpsError('invalid-argument', '請輸入問題。');
 const history = (Array.isArray(job.history) ? job.history : []).slice(-12).map(h => ({ q: text(h?.q, 500), a: text(h?.a, 1200) })).filter(h => h.q);
 const r = await askDeepSeek(askPrompt(tripDoc, text(job.context, 60000), history, question), [], { think: false });
 const answer = text(r?.answer, 3000);
 if (!answer) throw new HttpsError('internal', 'AI 未有回答，請再問一次。');
 return { answer, places: (Array.isArray(r?.places) ? r.places : []).slice(0, 6).map(p => text(p, 100)).filter(Boolean) };
}
