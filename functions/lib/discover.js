// AI 推薦新地點 (discoverPlaces).
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { DEEPSEEK_API_KEY, PLACES_API_KEY, askDeepSeek, deepseekTool, requireMember, tripInfo, useQuota } from './base.js';
import { bareName, langFor, placesApi, sameShop } from './places.js';

// AI 推薦新地點 (explore page and the plan's picker): places the travellers do not have yet, from a web search, each
// checked on Google Maps (kept only when found with a matching name), with rating, hours and a small photo.
const DISCOVER_KINDS = { any: ['', 'おすすめ スポット', '好去處'], sight: ['景點', '観光スポット', '景點'], food: ['餐廳', 'グルメ 人気店', '美食'], cafe: ['咖啡甜品', 'カフェ スイーツ', 'cafe 甜品'], shop: ['手信購物', 'お土産 ショップ', '手信'], onsen: ['溫泉', '日帰り温泉', '溫泉'] };
const DISCOVER_PREFS = { kids: ['親子', '子連れ'], rain: ['雨天好去（室內）', '雨の日 屋内'], night: ['夜景', '夜景'], quiet: ['人少', '穴場'], local: ['地道', '地元 人気'], photo: ['影相打卡', '映え'], elder: ['長者友善', 'バリアフリー'] };
const DISCOVER_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri', 'rating', 'userRatingCount', 'primaryTypeDisplayName', 'websiteUri', 'regularOpeningHours.weekdayDescriptions', 'photos', 'businessStatus'].map(f => 'places.' + f).join(',');
export const discoverPlaces = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY, PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 3 }, async req => {
 await requireMember(req);
 const d = req.data || {}, text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const area = text(d.area, 60), kind = DISCOVER_KINDS[d.kind] ? d.kind : 'any';
 const prefs = (Array.isArray(d.prefs) ? d.prefs : []).filter(p => DISCOVER_PREFS[p]).slice(0, 4);
 const have = (Array.isArray(d.have) ? d.have : []).slice(0, 300).map(x => text(x, 80)).filter(Boolean);
 const near = Number.isFinite(d.near?.lat) && Number.isFinite(d.near?.lng) ? { lat: d.near.lat, lng: d.near.lng } : null;
 const weekday = text(d.weekday, 10), extra = text(d.note, 120);
 const trip = typeof d.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(d.trip) ? (await getFirestore().doc(`trips/${d.trip}`).get()).data() : null;
 const where = area || tripInfo(trip).place, country = /^[A-Z]{2}$/.test(trip?.country || '') ? trip.country : '';
 await useQuota(req.auth.uid, 'ai');
 const [zhKind, jaKind, zhWord] = DISCOVER_KINDS[kind];
 const jaPrefs = prefs.map(p => DISCOVER_PREFS[p][1]).join(' '), zhPrefs = prefs.map(p => DISCOVER_PREFS[p][0]).join('、');
 const queries = [`${where} ${jaKind} ${jaPrefs}`, `${where} ${zhWord} ${zhPrefs.replace(/（.*?）/g, '')} 推介`, `${where} ${jaKind} ランキング`, ...(d.more ? [`${where} ${jaKind} 穴場 地元`, `${where} ${zhWord} 小眾 必去`] : [])];
 const searches = await Promise.all(queries.map(q => deepseekTool('search', { query: q.trim().slice(0, 128), count: 10 })));
 const results = searches.flatMap(r => r?.results || []).filter((r, i, all) => all.findIndex(x => x.url === r.url) === i).slice(0, 28)
  .map(r => ({ title: String(r.title || '').slice(0, 120), summary: String(r.summary || r.snippet || '').slice(0, 600) }));
 if (!results.length) throw new HttpsError('not-found', '網上找不到推介。');
 const prompt = `Hong Kong travellers on a trip to ${tripInfo(trip).place} want new ideas${zhKind ? ` (${zhKind})` : ''} in or near ${where}${zhPrefs ? `, preferring: ${zhPrefs}` : ''}${weekday ? `, for a ${weekday}` : ''}${extra ? `. They say: ${extra}` : ''}.
From the web search results below, pick up to 15 specific places (one shop, restaurant, sight or facility each; not areas, lists or chains in general) that are well liked and fit.
Leave out anything already on their list: ${JSON.stringify(have.slice(0, 300))}.
Reply with JSON only: {"places": [{"name": string, "reason": string, "type": string}]}
- name: as written on local signs (Japanese in Japan, Korean in Korea), with the branch or area if it helps to find it on Google Maps.
- reason: why it is worth going, at most 30 Traditional Chinese characters (Hong Kong usage), concrete (e.g. "百年老店，招牌鰻魚飯", "雨天都可以玩成日").
- type: 2–6 Chinese characters (e.g. 拉麵、神社、展望台、甜品店).
- Only places the results support; do not invent.
Search results: ${JSON.stringify(results)}`;
 let r;
 try { r = await askDeepSeek(prompt, [], { think: false }); } catch (e) { console.error('discover', e?.message); throw new HttpsError('unavailable', 'AI 暫時未能推薦，請稍後再試。'); }
 const named = (Array.isArray(r?.places) ? r.places : []).slice(0, 15).map(p => ({ name: text(p?.name, 100), reason: text(p?.reason, 60), type: text(p?.type, 20) })).filter(p => p.name);
 const known = have.map(bareName);
 const centre = near || (Number.isFinite(trip?.center?.lat) ? trip.center : null);
 await useQuota(req.auth.uid, 'maps');
 const found = await Promise.all(named.map(async p => {
  const res = await placesApi('places:searchText', DISCOVER_FIELDS, {
   textQuery: `${p.name} ${area}`.trim(), languageCode: langFor(country), maxResultCount: 1, ...(country ? { regionCode: country } : {}),
   ...(centre ? { locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: near ? 15000 : 50000 } } } : {}),
  }).catch(() => null);
  const g = res?.places?.[0];
  if (!g?.displayName?.text || (g.businessStatus && g.businessStatus !== 'OPERATIONAL')) return null;
  const name = bareName(g.displayName.text);
  if (!sameShop(p.name, g)) return null;
  if (known.some(k => k && (k.includes(name) || name.includes(k)))) return null;
  let photo = null, photoBy = '';
  const ph = g.photos?.[0];
  if (ph) try {
   const media = await (await fetch(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=480&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': PLACES_API_KEY.value().trim() }, signal: AbortSignal.timeout(15_000) })).json();
   const buf = Buffer.from(await (await fetch(media.photoUri, { signal: AbortSignal.timeout(15_000) })).arrayBuffer());
   photo = (await sharp(buf, { failOn: 'none' }).rotate().resize(360, 360, { fit: 'cover' }).jpeg({ quality: 65 }).toBuffer()).toString('base64');
   photoBy = String(ph.authorAttributions?.[0]?.displayName || '').slice(0, 60);
  } catch (e) { console.error('discover photo', e?.message); }
  return { id: g.id, name: g.displayName.text.slice(0, 100), reason: p.reason, type: p.type || text(g.primaryTypeDisplayName?.text, 20), address: String(g.formattedAddress || '').slice(0, 200), lat: g.location?.latitude ?? null, lng: g.location?.longitude ?? null, mapsUrl: String(g.googleMapsUri || '').slice(0, 300), website: String(g.websiteUri || '').slice(0, 300), rating: typeof g.rating === 'number' ? g.rating : null, ratings: g.userRatingCount || 0, hours: (g.regularOpeningHours?.weekdayDescriptions || []).slice(0, 7), photo: photo && photo.length < 120000 ? photo : null, photoBy };
 }));
 const places = found.filter((p, i) => p && found.findIndex(q => q?.id === p.id) === i).slice(0, 12).map(({ id, ...p }) => ({ ...p, placeId: id }));
 return { places, dropped: named.length - found.filter(Boolean).length };
});
