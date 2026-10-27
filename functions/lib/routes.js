// Routes between plan stops: Google Routes, NAVITIME and AI route advice.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { DEEPSEEK_API_KEY, MAX_IMAGE_BYTES, PLACES_API_KEY, RAPIDAPI_KEY, askDeepSeek, requireMember, useQuota } from './base.js';
import { langFor } from './places.js';

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
export const mins = d => Math.max(0, Math.round(parseInt(d || '0', 10) / 60));
const ROUTE_FIELDS = ['duration', 'distanceMeters', 'travelAdvisory.transitFare', 'legs.steps.travelMode', 'legs.steps.staticDuration', 'legs.steps.distanceMeters', 'legs.steps.transitDetails'].map(f => 'routes.' + f).join(',');

// Japan's public transport with timetables (Google offers none for Japan): NAVITIME Route via RapidAPI (free plan,
// 500 requests a month; each companion at most DAILY.navi a day). when: local 'YYYY-MM-DDTHH:mm'. Options in the
// shape of suggestRoutes (steps with lines, stations and times); fare = ticket + unreserved express fee.
// The marketplace plan has no train timetables either (NAVITIME sells those separately, not on RapidAPI): times come
// from average running times, so each step says approx and has no train number.
// The marketplace plan has trains only (local buses need a separate contract), so routes that are mostly walking —
// where a bus is likely the way — are dropped and the AI (which knows the buses) is asked instead.
// Japan by public transport from Yahoo!乗換案内, as the traveller would look it up (one search per tap, for this small
// group): real timetables door to door, trains with their names and numbers, buses and ferries, platforms and fares.
// Read from the result page's own data (__NEXT_DATA__); if Yahoo refuses or changes it, nothing (NAVITIME is next).
// A place goes by its Japanese address when it has one (Yahoo finds the door), else by its name.
const half = t => String(t || '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
export function yahooPlace(p) {
 // a station by its own name (Yahoo then starts at the platform, not the station's street address)
 const n = half(p?.name).trim().replace(/站$/, '駅'), st = n.match(/^(?:JR\s*)?(.{1,15}?駅)(?:[\s（(].*)?$/);
 if (st) return st[1];
 const t = String(p?.address || '').trim(), m = t.match(/(北海道|東京都|京都府|大阪府|.{2,3}県).+?\d[\d０-９\-－丁目番地号の]*/);
 return (m ? m[0] : String(p?.name || t).trim()).slice(0, 80);
}
const YAHOO_VEHICLE = n => (/新幹線/.test(n) ? 'HIGH_SPEED_TRAIN' : /汽船|フェリー|旅客船|渡船/.test(n) ? 'FERRY' : /バス|交通・|ライナー/.test(n) ? 'BUS' : /地下鉄|空港線|七隈線|箱崎線/.test(n) ? 'SUBWAY' : /モノレール/.test(n) ? 'MONORAIL' : /ロープウェイ|ケーブル/.test(n) ? 'CABLE_CAR' : 'HEAVY_RAIL');
export async function yahooRoutes(uid, a, b, when, limit = 3) {
 const from = yahooPlace(a), to = yahooPlace(b), w = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d)(\d)$/.exec(when || '');
 if (!from || !to || !w) return null;
 await useQuota(uid, 'navi');
 // Yahoo gives three routes a search and cannot leave trains out: one search by rail only (up to three), one with
 // buses of which the routes that take a bus (up to three), trains first
 const search = async bus => {
  const q = new URLSearchParams({ from, to, y: w[1], m: w[2], d: w[3], hh: w[4], m1: w[5], m2: w[6], type: '1', ticket: 'ic', expkind: '1', shin: '1', ex: '1', hb: bus, al: '1', lb: bus, sr: '1', s: '0' });
  const res = await fetch(`https://transit.yahoo.co.jp/search/result?${q}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PocketTravel/1.0)', 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return console.error('Yahoo transit', res?.status), null;
  try { return JSON.parse((await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.naviSearchParam?.featureInfoList || []; } catch { return console.error('Yahoo transit: page changed'), null; }
 };
 const [rail, all] = await Promise.all([search('0'), search('1')]);
 if (!all && !rail) return null;
 const seen = new Set(), list = [...(rail || []), ...(all || [])].filter(f => { const k = f.summaryInfo?.calendarData?.description || Math.random(); return !seen.has(k) && seen.add(k); });
 const clock = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
 const span = (x, y) => (x != null && y != null ? (y - x + 1440) % 1440 : 0);
 const routes = list.map(f => {
  const e = f.edgeInfoList || [], steps = [];
  for (let i = 0; i < e.length - 1; i++) {
   const here = e[i], next = e[i + 1], name = half(here.railNameExcludingDestination || here.railName || '');
   const depart = (here.timeInfo || []).at(-1)?.time || '', arrive = (next.timeInfo || [])[0]?.time || '', min = span(clock(depart), clock(arrive));
   const station = x => half(x.stationName || x.pointName || '').replace(/\/.*$/, '').replace(/\((?:福岡|大分|山口|熊本|佐賀|長崎)県\)$/, '').slice(0, 60);
   if (!name || /^徒歩/.test(name) || /徒歩/.test(here.railName || '')) { const last = steps.at(-1); if (last?.mode === 'WALK') last.minutes += min; else steps.push({ mode: 'WALK', minutes: min, meters: 0 }); continue; }
   const plat = (here.ridingPositionInfo?.departure || []).filter(Boolean).join('');
   steps.push({ mode: 'TRANSIT', vehicle: YAHOO_VEHICLE(name), line: name.replace(/^JR/, 'JR ').slice(0, 60), headsign: half(here.destination || '').replace(/行$/, '').slice(0, 40), from: station(here), to: station(next), stops: (here.stopStationList || []).length + 1, depart, arrive, minutes: min, ...(/番線|のりば/.test(plat) ? { platform: plat.slice(0, 20) } : {}) });
  }
  const sum = f.summaryInfo || {}, t = /(?:(\d+)時間)?(\d+)分/.exec(sum.totalTime || ''), yen = Number(String(sum.totalPrice || '').replace(/[^\d]/g, ''));
  return { minutes: t ? (+t[1] || 0) * 60 + +t[2] : steps.reduce((x, s) => x + s.minutes, 0), meters: 0, fare: yen ? { currency: 'JPY', amount: yen } : null, steps: steps.filter(x => x.mode === 'TRANSIT' || x.minutes > 0) };
 }).filter(o => o.steps.some(x => x.mode === 'TRANSIT'));
 const byBus = o => o.steps.some(x => x.vehicle === 'BUS'), trains = routes.filter(o => !byBus(o)).slice(0, 3), buses = routes.filter(byBus).slice(0, 3);
 return [...trains, ...buses].slice(0, limit);
}
const NAVI_VEHICLE = { superexpress_train: 'HIGH_SPEED_TRAIN', bus: 'BUS', highway_bus: 'INTERCITY_BUS', ferry: 'FERRY' };
export async function naviRoutes(uid, a, b, when, limit = 3) {
 if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return null;
 await useQuota(uid, 'navi');
 const q = new URLSearchParams({ start: `${a.lat},${a.lng}`, goal: `${b.lat},${b.lng}`, start_time: `${when}:00`, datum: 'wgs84', coord_unit: 'degree', limit: String(limit) });
 const res = await fetch(`https://navitime-route-totalnavi.p.rapidapi.com/route_transit?${q}`, { headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY.value().trim(), 'X-RapidAPI-Host': 'navitime-route-totalnavi.p.rapidapi.com' }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
 if (!res?.ok) {
  console.error('NAVITIME failed', res?.status, res ? (await res.text()).slice(0, 300) : '');
  return null;
 }
 const station = x => String(x?.name || '').replace(/（[^）]*[都道府県]）$/, '').slice(0, 60);
 return ((await res.json()).items || []).map(it => {
  const secs = it.sections || [], steps = [];
  secs.forEach((s, i) => {
   if (s.type !== 'move') return;
   const minutes = Number(s.time) || 0, last = steps.at(-1);
   if (s.move === 'walk') {
    if (last?.mode === 'WALK') { last.minutes += minutes; last.meters += Number(s.distance) || 0; } else steps.push({ mode: 'WALK', minutes, meters: Number(s.distance) || 0 });
    return;
   }
   steps.push({ mode: 'TRANSIT', vehicle: NAVI_VEHICLE[s.move] || (/train/.test(s.move) ? 'HEAVY_RAIL' : ''), line: String(s.line_name || s.transport?.name || '').slice(0, 60), headsign: '', from: station(secs[i - 1]), to: station(secs[i + 1]), stops: 0, depart: String(s.from_time || '').slice(11, 16), arrive: String(s.to_time || '').slice(11, 16), minutes, approx: !(s.transport?.links || []).some(l => String(l.is_timetable) === 'true') });
  });
  const f = it.summary?.move?.fare || {}, amount = (Number(f.unit_48 ?? f.unit_0) || 0) + (Number(f.unit_1) || 0);
  return { minutes: Number(it.summary?.move?.time) || 0, meters: Number(it.summary?.move?.distance) || 0, fare: amount ? { currency: 'JPY', amount } : null, steps: steps.filter(x => x.mode === 'TRANSIT' || x.minutes > 0) };
 }).filter(o => o.steps.some(x => x.mode === 'TRANSIT') && o.steps.reduce((t, x) => t + (x.mode === 'WALK' ? x.minutes : 0), 0) <= 15);
}

export const suggestRoutes = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [PLACES_API_KEY, RAPIDAPI_KEY], memory: '256MiB', timeoutSeconds: 40, maxInstances: 3 }, async req => {
 await requireMember(req);
 const d = req.data || {}, origin = point(d.origin), destination = point(d.destination);
 if (!origin || !destination) throw new HttpsError('invalid-argument', '起點或終點沒有位置資料。');
 const mode = ['TRANSIT', 'WALK', 'DRIVE'].includes(d.mode) ? d.mode : 'TRANSIT';
 const country = typeof d.country === 'string' && /^[A-Z]{2}$/.test(d.country) ? d.country : '';
 const zone = ZONES[country] || 'UTC';
 // Japan by public transport: Yahoo!乗換案内 (real timetables, buses), then NAVITIME (trains, estimated times), then Google (none)
 if (mode === 'TRANSIT' && country === 'JP') {
  const ya = await yahooRoutes(req.auth.uid, { ...d.origin, ...(typeof d.originText === 'string' ? { address: d.originText.slice(0, 200) } : {}), name: String(d.originName || '').slice(0, 80) }, { ...d.destination, ...(typeof d.destinationText === 'string' ? { address: d.destinationText.slice(0, 200) } : {}), name: String(d.destinationName || '').slice(0, 80) }, String(d.time || ''), 6).catch(e => (console.error('yahoo', e?.message), null));
  if (ya?.length) return { options: ya, estimated: false, source: 'yahoo' };
 }
 if (mode === 'TRANSIT' && country === 'JP' && d.origin?.lat != null && d.destination?.lat != null) {
  const options = await naviRoutes(req.auth.uid, d.origin, d.destination, String(d.time || ''), 4).catch(e => (console.error('navi', e?.message), null));
  if (options?.length) return { options, estimated: false, source: 'navitime' };
 }
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
 // 公共交通 that is only walking is not public transport (Google has no Japanese transit, and NAVITIME's walk-heavy
 // routes were dropped as buses are likely there): none, so the page offers Google's own directions and the AI
 const ways = mode === 'TRANSIT' ? unique.filter(o => o.steps.some(s => s.mode === 'TRANSIT')) : unique;
 return { options: ways.slice(0, 4), estimated, when: when ? when.toISOString() : null, ...(mode === 'TRANSIT' && !ways.length ? { noTransit: true } : {}) };
});

// AI route advice (DeepSeek) for a plan link, mainly where Google offers no public transport data (Japan).
// Returns options in the same shape as suggestRoutes; times and fares are the model's estimates.
export const placeText = p => [p?.name, p?.address, Number.isFinite(p?.lat) && Number.isFinite(p?.lng) ? `(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})` : ''].filter(Boolean).join(' ').slice(0, 300);
export const aiRoutes = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 3 }, async req => {
 await requireMember(req);
 const d = req.data || {}, from = placeText(d.origin), to = placeText(d.destination);
 if (!from || !to) throw new HttpsError('invalid-argument', '起點或終點沒有資料。');
 if (d.image !== undefined && (typeof d.image !== 'string' || d.image.length > MAX_IMAGE_BYTES * 1.4 || !/^[A-Za-z0-9+/=]+$/.test(d.image))) throw new HttpsError('invalid-argument', '截圖太大或格式不正確。');
 await useQuota(req.auth.uid, 'ai');
 const where = String(d.destination?.region || d.place || '').slice(0, 80), when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.time || '') ? d.time.replace('T', ' ') : '';
 const cur = typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency) ? d.currency : 'JPY';
 // A screenshot of a route (Google Maps, Yahoo!乗換案内, a timetable…): the model reads it as it is
 if (d.image) return readRouteShot(d.image, from, to, typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency) ? d.currency : 'JPY');
 // Japan: the AI weighs Yahoo!乗換案内's real routes (times, train numbers, platforms, fares stay Yahoo's) and adds
 // its advice; it estimates the ways only where Yahoo has none.
 if (d.country === 'JP') {
  const real = await yahooRoutes(req.auth.uid, d.origin, d.destination, String(d.time || ''), 6).catch(() => null);
  if (real?.length) return aiOnReal(real, from, to, when, cur);
 }
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
// The real routes in a line each for the model: "0: 08:53–09:43, 50 min, ¥2430, 1 change: 博多 08:53 JR 新幹線みずほ602号 → 小倉 09:09; 小倉 09:30 JR 山陽本線 → 下関 09:43"
async function aiOnReal(real, from, to, when, cur) {
 const line = (o, i) => `${i}: ${o.minutes} min${o.fare ? `, ¥${o.fare.amount}` : ''}: ${o.steps.map(s => (s.mode === 'WALK' ? `walk ${s.minutes} min` : `${s.from} ${s.depart} ${s.line} → ${s.to} ${s.arrive}`)).join('; ')}`;
 const prompt = `You help Hong Kong travellers in Japan choose how to get from A to B${when ? ` leaving around ${when}` : ''}. These are the real routes from a Japanese timetable service:
A: ${from}
B: ${to}
${real.map(line).join('\n')}
Reply with JSON only: {"picks": [{"i": number, "title": string, "note": string}], "advice": string}
- picks: the routes worth taking, best first (at most 4), each once. title: a short label (e.g. 最快, 最平, 唔使轉車, 少行路). note: what to watch out for: transfer time, which trains a JR Pass covers (JR lines yes; buses, subways, private railways and ferries no), seat reservation, luggage, last trains.
- advice: one or two sentences comparing them.
- All text in Traditional Chinese as used in Hong Kong. Do not change any time, train, platform or fare.`;
 let r = null;
 try { r = await askDeepSeek(prompt, [], { think: false }); } catch (e) { console.error('aiRoutes real', e?.message); }
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const picks = (Array.isArray(r?.picks) ? r.picks : []).filter(p => Number.isInteger(p?.i) && real[p.i]).filter((p, k, all) => all.findIndex(x => x.i === p.i) === k);
 const order = picks.length ? picks : real.map((_, i) => ({ i }));
 return {
  source: 'yahoo',
  options: order.slice(0, 4).map(p => ({ ...real[p.i], title: text(p.title, 40), note: text(p.note, 200), confidence: 'high', source: 'yahoo' })),
  advice: text(r?.advice, 300),
 };
}
// 截圖讀取: the routes in a screenshot the traveller took (e.g. Google Maps' directions), read as shown, nothing guessed.
async function readRouteShot(image, from, to, cur) {
 const prompt = `This is a screenshot of public transport directions (Google Maps, Yahoo!乗換案内, a timetable or similar) that Hong Kong travellers took for going from A to B.
A: ${from}
B: ${to}
Read every route shown, exactly as written. Reply with JSON only:
{"options": [{"title": string, "minutes": number, "fare": number or null, "steps": [{"mode": "WALK" | "TRANSIT", "vehicle": "SUBWAY" | "HEAVY_RAIL" | "HIGH_SPEED_TRAIN" | "BUS" | "TRAM" | "MONORAIL" | "FERRY" | "", "line": string, "headsign": string, "from": string, "to": string, "depart": "HH:MM" or "", "arrive": "HH:MM" or "", "platform": string, "stops": number, "minutes": number}], "note": string}], "advice": string, "readable": boolean}
- platform: where that step's train or bus leaves from (Yahoo writes it as "[発] 8番線"; "[着] 2番線" is where the step before arrives — not this step's). Empty if not shown.
- One option per route in the picture, in the order shown. Copy line and train names (with train numbers), station and stop names, times, platforms ("3番線", "2のりば") and fares as written; leave out what is not shown (empty string or 0). Do not add anything that is not in the picture.
- fare: per adult in ${cur} as shown, null if not shown. minutes: the total shown.
- title (e.g. "08:52 發"), note (what the picture says to watch out for) and advice in Traditional Chinese as used in Hong Kong, short.
- readable: false if the picture shows no route.`;
 let r;
 try { r = await askDeepSeek(prompt, [image]); } catch (e) { console.error('route shot', e?.message); throw new HttpsError('unavailable', 'AI 暫時未能讀取截圖，請稍後再試。'); }
 if (r?.readable === false) throw new HttpsError('invalid-argument', '截圖中找不到路線，請截取路線詳情的畫面。');
 const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : 0);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const hm = v => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : '');
 const options = (Array.isArray(r?.options) ? r.options : []).slice(0, 6).map(o => ({
  title: text(o.title, 40), minutes: num(o.minutes, 1440), note: text(o.note, 200), confidence: 'high', source: 'shot',
  fare: typeof o.fare === 'number' && o.fare > 0 && o.fare < 1e6 ? { currency: cur, amount: Math.round(o.fare * 100) / 100 } : null,
  steps: (Array.isArray(o.steps) ? o.steps : []).slice(0, 12).map(s => (s?.mode === 'WALK'
   ? { mode: 'WALK', minutes: num(s.minutes, 600), meters: 0 }
   : { mode: 'TRANSIT', vehicle: text(s?.vehicle, 30), line: text(s?.line, 60), headsign: text(s?.headsign, 40), from: text(s?.from, 60), to: text(s?.to, 60), depart: hm(s?.depart), arrive: hm(s?.arrive), stops: num(s?.stops, 200), minutes: num(s?.minutes, 1440), ...(text(s?.platform, 20) ? { platform: text(s.platform, 20) } : {}) })),
 })).filter(o => o.steps.some(x => x.mode === 'TRANSIT'));
 if (!options.length) throw new HttpsError('invalid-argument', '截圖中找不到路線，請截取路線詳情的畫面。');
 return { source: 'shot', options, advice: text(r?.advice, 300) };
}
