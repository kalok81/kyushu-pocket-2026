// A whole plan day in one AI request (planDay): routes, arrangement, suggestions.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { DEEPSEEK_API_KEY, PLACES_API_KEY, RAPIDAPI_KEY, askDeepSeek, requireMember, useQuota } from './base.js';
import { mins, naviRoutes, placeText } from './routes.js';

// A whole day of the plan in one AI request (DeepSeek), for the plan page's tools:
// - routes: the way to go for every leg (stop to stop), as aiRoutes' first option;
// - arrange: the order of the stops, times and legs, keeping fixed times, with warnings about opening hours;
// - suggest: up to 6 places from the explore list that fit the day.
// Times and fares are estimates; the page labels them so.
const metres = (a, b) => {
 if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
 const r = x => (x * Math.PI) / 180, dl = r(b.lat - a.lat), dg = r(b.lng - a.lng);
 return Math.round(2 * 6371e3 * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dg / 2) ** 2)));
};
// Walking legs (under 1.5 km apart) come from Google Maps instead of the AI: real paths and times.
async function googleWalk(a, b) {
 const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': PLACES_API_KEY.value().trim(), 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' },
  body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } }, travelMode: 'WALK', units: 'METRIC' }),
  signal: AbortSignal.timeout(15_000),
 }).catch(() => null);
 const r = res?.ok ? (await res.json()).routes?.[0] : null;
 return r ? { minutes: Math.max(1, mins(r.duration)), meters: r.distanceMeters || 0 } : null;
}
const WALK_MAX = 1500;
const walkLeg = (k, w) => ({ k, minutes: w.minutes, meters: w.meters, fare: null, confidence: 'high', source: 'google', steps: [{ mode: 'WALK', vehicle: '', line: '', from: '', to: '', minutes: w.minutes }] });
const LEG_SHAPE = '{"k": string, "minutes": number, "fare": number or null, "confidence": "high" | "medium" | "low", "steps": [{"mode": "WALK" | "TRANSIT" | "TAXI" | "DRIVE", "vehicle": "SUBWAY" | "HEAVY_RAIL" | "HIGH_SPEED_TRAIN" | "BUS" | "TRAM" | "MONORAIL" | "FERRY" | "", "line": string, "from": string, "to": string, "minutes": number}]}';
const LEG_RULES = cur => `- A leg is the way from the stop before to stop k. Use real line, station and stop names as written on local signs (Japanese in Japan, Korean in Korea); do not invent lines or stations. Walk when the places are under about 1 km apart. minutes: door to door including walking and waiting. fare: per adult in ${cur} (IC card fare), null if unknown or walking. confidence: high only if you know these exact lines run there.`;
export const planDay = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY, PLACES_API_KEY, RAPIDAPI_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 3 }, async req => {
 await requireMember(req);
 const d = req.data || {}, mode = d.mode;
 if (!['routes', 'arrange', 'suggest'].includes(mode)) throw new HttpsError('invalid-argument', 'mode');
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : 0);
 const point = p => (p && typeof p === 'object' ? { k: text(p.k, 12), name: text(p.name, 80), address: text(p.address, 200), ...(Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : {}) } : null);
 const stops = (Array.isArray(d.stops) ? d.stops : []).slice(0, 25).map(s => ({ ...point(s), type: text(s.type, 40), hours: text(s.hours, 300), time: text(s.time, 30), fixed: s.fixed === true, stay: num(s.stay, 600) })).filter(s => s.k && s.name);
 const start = point(d.start), end = point(d.end);
 const cur = typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency) ? d.currency : 'JPY';
 const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '', where = text(d.region, 80), weekday = text(d.weekday, 10);
 const startTime = /^\d{2}:\d{2}$/.test(d.startTime || '') ? d.startTime : '';
 const day = `${date} (${weekday})${where ? ` in ${where}` : ''}`;
 const placeLine = p => `${p.k}: ${placeText(p)}`;
 // Google walking times for close legs (at most 12 per request, one maps use)
 const walks = async pairs => {
  const near = pairs.filter(([, a, b]) => metres(a, b) != null && metres(a, b) < WALK_MAX).slice(0, 12);
  if (!near.length) return {};
  await useQuota(req.auth.uid, 'maps');
  const got = await Promise.all(near.map(([k, a, b]) => googleWalk(a, b).then(w => [k, w])));
  return Object.fromEntries(got.filter(([, w]) => w).map(([k, w]) => [k, walkLeg(k, w)]));
 };
 // Train and bus legs in Japan: NAVITIME's first route at the leg's time (at most 10 per request)
 const naviLegs = async list => {
  if (trip?.country && trip.country !== 'JP' && d.country !== 'JP') return {};
  const got = {};
  for (const [k, a, b, time] of list.filter(([, a, b, time]) => a?.lat != null && b?.lat != null && time).slice(0, 10)) {
   const o = await naviRoutes(req.auth.uid, a, b, `${date}T${time.padStart(5, '0')}`, 1).catch(() => null);
   if (o?.[0]) got[k] = { k, ...o[0], confidence: 'high', source: 'navitime' };
  }
  return got;
 };
 const trip = typeof d.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(d.trip) ? (await getFirestore().doc(`trips/${d.trip}`).get()).data() : null;
 let prompt, walked = {};
 if (mode === 'routes') {
  const all = (Array.isArray(d.legs) ? d.legs : []).slice(0, 25).map(l => ({ k: text(l.k, 12), from: point(l.from), to: point(l.to), time: text(l.time, 5) })).filter(l => l.k && l.from?.name && l.to?.name);
  if (!all.length) throw new HttpsError('invalid-argument', '沒有需要查詢的交通。');
  walked = await walks(all.map(l => [l.k, l.from, l.to]));
  Object.assign(walked, date ? await naviLegs(all.filter(l => !walked[l.k]).map(l => [l.k, l.from, l.to, l.time || '09:00'])) : {});
  const legs = all.filter(l => !walked[l.k]);
  if (!legs.length) return { legs: Object.values(walked) };
  await useQuota(req.auth.uid, 'ai');
  prompt = `You are a local transport expert helping Hong Kong travellers on ${day}.
For each leg below give the one most practical way to go (usually public transport; walk if close; taxi only when nothing else is sensible).
Legs:
${legs.map(l => `${l.k}: from ${placeText(l.from)} to ${placeText(l.to)}${l.time ? `, leaving about ${l.time}` : ''}${metres(l.from, l.to) != null ? ` (${metres(l.from, l.to)} m apart in a straight line)` : ''}`).join('\n')}
Reply with JSON only: {"legs": [${LEG_SHAPE}]}
${LEG_RULES(cur)}`;
 } else if (mode === 'arrange') {
  if (stops.length < 2) throw new HttpsError('invalid-argument', '最少要有兩個站點。');
  await useQuota(req.auth.uid, 'ai');
  prompt = `You plan a day of sightseeing for Hong Kong travellers on ${day}.
Put the stops below in a sensible order and give each a visit time, so the day flows with little back-tracking, places are visited while open (mind the weekday and closing days), meals fall at meal times (lunch about 11:30–13:30, dinner about 18:00–20:00) and there is time to get between them.
${start ? `The day starts from ${placeText(start)} at ${startTime || '09:00'}.` : `The day starts at ${startTime || '09:00'}${stops[0]?.type.startsWith('hotel: where the day starts') ? `, leaving ${stops[0].name}` : ''}; nothing before that time.`}${end ? `\nThe night is spent at ${placeText(end)}.` : ''}
Stops (k: name, address, position; type; opening hours as noted by the traveller; time = fixed means it must stay at that time; stay = minutes the traveller plans there):
${stops.map(s => `${placeLine(s)}${s.type ? `; ${s.type}` : ''}${s.hours ? `; hours: ${s.hours.replace(/\s+/g, ' ')}` : ''}${s.time ? (s.fixed ? `; time = fixed ${s.time}` : `; planned ${s.time}`) : ''}${s.stay ? `; stay ${s.stay} min` : ''}`).join('\n')}
Reply with JSON only:
{"order": [k, ...], "times": {"k": "HH:MM–HH:MM"}, "legs": [${LEG_SHAPE}], "warnings": {"k": string}, "advice": string}
- order: every stop exactly once. A stop marked fixed keeps its time; order the others around it. A hotel stop that starts the day goes first.
- "planned" times show the part of the day the traveller meant (breakfast, lunch, dinner, hotel check-in, evening walks, night views): keep each stop in that part of the day unless a clearly better order needs a small shift. Hotel check-in not before 15:00; evening and night spots after dark.
- times: start–end for each stop, using the planned stay or a usual visit length (meal about 60 min, café 40, viewpoint or tower 30, shrine or park 45, museum or ropeway 60–90, shop 30–60). Stations, bus stops and airports (type "transport stop") are only where they change: 5 minutes. A hotel where the day starts or ends gets one time only ("HH:MM": leaving, or getting back), no range; a hotel in the middle of the day is a check-in or luggage stop of about 15 minutes, unless the traveller planned a meal or bath there (a planned range or the name says so). Times must not overlap, and the gap before a stop must fit its leg.
- legs: one leg per stop after the first (k = that stop), the way from the stop before it.
- warnings: only real problems, in Traditional Chinese as used in Hong Kong, short (e.g. "星期一休息", "18:00 關門，可能趕不及", "要預約"). Leave out stops without problems.
- advice: one or two sentences in Traditional Chinese (Hong Kong) about the plan, e.g. what to book or what could be dropped.
${LEG_RULES(cur)}`;
 } else {
  const cands = (Array.isArray(d.candidates) ? d.candidates : []).slice(0, 40).map(c => ({ k: text(c.k, 40), name: text(c.name, 80), area: text(c.area, 60), type: text(c.type, 40), note: text(c.note, 120), hours: text(c.hours, 200), saved: c.saved === true, km: typeof c.km === 'number' && Number.isFinite(c.km) ? Math.round(c.km * 10) / 10 : null })).filter(c => c.k && c.name);
  if (!cands.length) throw new HttpsError('invalid-argument', '沒有可以推薦的地點。');
  await useQuota(req.auth.uid, 'ai');
  prompt = `You help Hong Kong travellers fill a day on ${day}.
Already planned: ${stops.length ? stops.map(s => `${s.name}${s.time ? ` (${s.time})` : ''}${s.type ? ` [${s.type}]` : ''}`).join('; ') : 'nothing yet'}.
From their own list of places below, pick up to 6 that fit this day best: close to the planned stops or the area, open that weekday, filling what is missing (e.g. lunch, dinner, a café break, a sight, souvenirs) and not repeating what is planned. Prefer starred places (saved) when they fit.
Places (k: name; area; type; note; hours; km from the day's stops; saved):
${cands.map(c => `${c.k}: ${c.name}; ${c.area}; ${c.type}; ${c.note}; ${c.hours.replace(/\s+/g, ' ')}; ${c.km ?? '?'} km${c.saved ? '; saved' : ''}`).join('\n')}
Reply with JSON only: {"picks": [{"k": string, "reason": string}], "advice": string}
- reason: why it fits, in Traditional Chinese as used in Hong Kong, at most 30 characters (e.g. "午餐時間就近，步行 5 分鐘").
- advice: one short sentence in Traditional Chinese (Hong Kong) about the day.`;
 }
 let r;
 try { r = await askDeepSeek(prompt, [], { think: false }); } catch (e) { console.error('planDay', mode, e?.message); throw new HttpsError('unavailable', 'AI 暫時未能分析，請稍後再試。'); }
 const keys = new Set(stops.map(s => s.k));
 const legs = (Array.isArray(r?.legs) ? r.legs : []).slice(0, 25).map(l => ({
  k: text(String(l?.k ?? ''), 12), minutes: num(l?.minutes, 1440),
  confidence: ['high', 'medium', 'low'].includes(l?.confidence) ? l.confidence : 'low',
  fare: typeof l?.fare === 'number' && l.fare > 0 && l.fare < 1e6 ? { currency: cur, amount: Math.round(l.fare * 100) / 100 } : null,
  steps: (Array.isArray(l?.steps) ? l.steps : []).slice(0, 10).map(s => ({ mode: ['WALK', 'TRANSIT', 'TAXI', 'DRIVE'].includes(s?.mode) ? s.mode : 'TRANSIT', vehicle: text(s?.vehicle, 30), line: text(s?.line, 60), from: text(s?.from, 60), to: text(s?.to, 60), minutes: num(s?.minutes, 1440) })),
 })).filter(l => l.k && l.steps.length);
 if (mode === 'routes') return { legs: [...legs.filter(l => !walked[l.k]), ...Object.values(walked)] };
 if (mode === 'suggest') return { picks: (Array.isArray(r?.picks) ? r.picks : []).slice(0, 6).map(p => ({ k: text(String(p?.k ?? ''), 40), reason: text(p?.reason, 60) })).filter(p => p.k), advice: text(r?.advice, 200) };
 // arrange: every stop once (unknown keys dropped, forgotten ones kept at the end in their old order)
 const order = [...new Set((Array.isArray(r?.order) ? r.order : []).map(k => String(k)).filter(k => keys.has(k)))];
 for (const s of stops) if (!order.includes(s.k)) order.push(s.k);
 const clock = /^\d{1,2}:\d{2}(\s*[–~\-－]\s*\d{1,2}:\d{2})?$/;
 const times = Object.fromEntries(Object.entries(r?.times && typeof r.times === 'object' ? r.times : {}).filter(([k, v]) => keys.has(k) && typeof v === 'string' && clock.test(v.trim())).map(([k, v]) => [k, v.trim().replace(/\s*[~\-－]\s*/, '–')]));
 // the hotel the day starts from stays first
 const startK = stops.find(x => x.fixed && /^hotel: where the day starts/.test(x.type))?.k;
 if (startK != null && order[0] !== startK) order.splice(0, order.length, startK, ...order.filter(k => k !== startK));
 // fixed times stay as the traveller set them (the model sometimes moves them anyway), e.g. leaving the hotel
 for (const st of stops) if (st.fixed && clock.test(st.time.replace(/\s+/g, ''))) times[st.k] = st.time.replace(/\s*[~\-－]\s*/, '–');
 // the departure time chosen on the form is when the starting hotel is left
 if (startTime && startK != null) times[startK] = startTime;
 // a hotel at the start or end of the day is a time only (leaving, getting back)
 for (const k of [order[0], order.at(-1)]) if (/^hotel: where the day/.test(stops.find(x => x.k === k)?.type || '') && times[k]) times[k] = times[k].split('–')[0];
 const warnings = Object.fromEntries(Object.entries(r?.warnings && typeof r.warnings === 'object' ? r.warnings : {}).filter(([k, v]) => keys.has(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 80)]));
 // close stops in the chosen order walk by Google's times
 const at = Object.fromEntries(stops.map(s => [s.k, s]));
 const near = await walks(order.slice(1).map((k, j) => [k, at[order[j]], at[k]]));
 const endOf = k => String(times[k] || '').match(/(\d{1,2}:\d{2})\s*$/)?.[1] || '';
 if (date) Object.assign(near, await naviLegs(order.slice(1).map((k, j) => [k, at[order[j]], at[k], endOf(order[j])]).filter(([k]) => !near[k])));
 return { order, times, legs: [...legs.filter(l => !near[l.k]), ...Object.values(near)], warnings, advice: text(r?.advice, 300) };
});
