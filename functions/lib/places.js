// Google Maps place lookup (探索 / 住宿 自動填寫) and place photos.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import sharp from 'sharp';
import { getFirestore } from 'firebase-admin/firestore';
import { DEEPSEEK_API_KEY, PLACES_API_KEY, askDeepSeek, deepseekTool, requireMember, tripInfo, useQuota } from './base.js';

// Place lookup: a companion pastes a Google Maps link on 探索; we resolve it (short links included),
// then ask the Places API for the details that pre-fill the place form.
// Names compared without case, spaces, brackets or punctuation.
export const bareName = x => String(x).toLowerCase().normalize('NFKC').replace(/[\s（）()【】「」・･,，、.。:：\-－−&＆’'!！?？]/g, '');
// The Google place found for a name the AI gave is that place when they share a distinctive word: a word of the AI's
// name (3+ letters, or 2+ other characters) that is not part of the address, so an area (博多, 空港) alone never matches.
export function sameShop(aiName, g) {
 const name = bareName(g.displayName.text), address = bareName(g.formattedAddress || '');
 const words = String(aiName).normalize('NFKC').split(/[\s（）()【】「」・･,，、/]+/).map(bareName).filter(w => w.length >= (/^[a-z0-9]+$/.test(w) ? 3 : 2));
 return words.some(w => name.includes(w) && !address.includes(w));
}
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
 // Maps URLs with a place id (…/maps/search/?api=1&query=…&query_place_id=…, or q=place_id:…) name the place exactly
 const placeId = url.searchParams.get('query_place_id') || q?.match(/^place_id:([\w-]+)/)?.[1] || null;
 // exact: the place's own pin (!3d…!4d…), not just where the map was looking (@…)
 return { query: placeId ? null : name || (coords ? null : q) || null, at, exact: /!3d-?\d/.test(url.href), placeId };
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
export async function placesApi(path, fields, body) {
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
export const langFor = country => ({ JP: 'ja', KR: 'ko' })[country] || 'zh-TW';
const metersApart = (a, b) => {
 if (!a || !b) return 0;
 const r = Math.PI / 180, la = a.latitude ?? a.lat, lo = a.longitude ?? a.lng;
 const h = Math.sin(((b.lat - la) * r) / 2) ** 2 + Math.cos(la * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - lo) * r) / 2) ** 2;
 return 12742000 * Math.asin(Math.sqrt(h));
};
const search = async (kind, body, country) => (await placesApi(`places:${kind}`, SEARCH_FIELDS, { languageCode: langFor(country), maxResultCount: 1, ...(country && kind === 'searchText' ? { regionCode: country } : {}), ...body })).places?.[0];
// The neighbourhood name: in Japan the town (浅草) is sublocality_level_2 and the deeper levels are block numbers (２丁目, ３).
const district = p => {
 const c = p?.addressComponents || [], named = t => t && !/^[\d０-９\-−－]+(丁目|番地?|号)?$/.test(t) && !/丁目$/.test(t);
 const pick = t => c.find(x => x.types?.includes(t) && named(x.longText))?.longText;
 return pick('sublocality_level_1') || pick('sublocality_level_2') || pick('neighborhood') || pick('locality') || pick('administrative_area_level_2') || '';
};

function category(types = []) {
 const t = types.join(' ');
 if (/train_station|subway_station|bus_station|transit_station|transit_depot|light_rail_station|airport|ferry_terminal/.test(t)) return '交通';
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

// The first search result that is a Tabelog restaurant page whose title shares a word with the place's name, as its
// Japanese page (https://tabelog.com/{pref}/{area}/{sub}/{id}/).
function tabelogPage(results, name) {
 const n = t => String(t).toLowerCase().replace(/[\s（）()【】「」・･,，、.。:：\-－−&＆’'!！?？]/g, '');
 const words = String(name).split(/[\s（）()【】「」・･,，、]+/).map(n).filter(w => w.length >= (/^[a-z0-9]+$/.test(w) ? 4 : 2));
 for (const r of results) {
  const m = String(r.url).match(/^https:\/\/tabelog\.com\/(?:[a-z]{2}\/)?([a-z]+\/A\d+\/A\d+\/\d+)\//);
  if (m && words.some(w => n(r.title).includes(w))) return `https://tabelog.com/${m[1]}/`;
 }
 return '';
}
tabelogPage.wait = p => Promise.race([p, new Promise(r => setTimeout(() => r(''), 20_000))]);
// One Google Maps photo as a 640px JPEG, with its author (Google asks for the credit to be shown).
async function placePhotoJpeg(ph) {
 const media = await (await fetch(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': PLACES_API_KEY.value().trim() }, signal: AbortSignal.timeout(15_000) })).json();
 if (!media.photoUri) return null;
 const buf = Buffer.from(await (await fetch(media.photoUri, { signal: AbortSignal.timeout(15_000) })).arrayBuffer());
 const photo = (await sharp(buf, { failOn: 'none' }).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
 return photo.length <= 300000 ? { photo, photoBy: String(ph.authorAttributions?.[0]?.displayName || '').slice(0, 60) } : null;
}
export const lookupPlace = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [PLACES_API_KEY, DEEPSEEK_API_KEY], memory: '256MiB', timeoutSeconds: 60, maxInstances: 3 }, async req => {
 await requireMember(req);
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
 const { query, at, exact, placeId } = parseMapsUrl(url);
 const bias = at && { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: 300 } };
 // name: the form's name and address, for links that carry neither (Google's own …/?cid=… links)
 const hint = typeof req.data?.name === 'string' ? req.data.name.trim().slice(0, 200) : '';
 let place = placeId
  ? await placesApi(`places/${placeId}?languageCode=${langFor(country)}`, SEARCH_FIELDS.replace(/places\./g, '')).catch(() => null)
  : query
  ? await search('searchText', { textQuery: query, ...(bias && { locationBias: bias }) }, country)
  : at ? await search('searchNearby', { rankPreference: 'DISTANCE', locationRestriction: { circle: { ...bias.circle, radius: 50 } } }, country)
  : hint ? await search('searchText', { textQuery: hint }, country) : null;
 // A shared place named only by an area word ("博多" → 博多区) or found far from its own pin: the place at the pin
 // (博多駅) is the one meant
 const AREA = /^(political|locality|sublocality.*|administrative_area.*|neighborhood|route|postal_code|country)$/;
 if (place && query && exact && ((place.types || []).every(t => AREA.test(t)) || metersApart(place.location, at) > 300)) {
  const d = 0.001; // about 100 m: the name searched again only right around the pin
  // Google ranks these differently from one call to the next, so the one closest to the pin wins
  const near = (await placesApi('places:searchText', SEARCH_FIELDS, { textQuery: query, languageCode: langFor(country), maxResultCount: 10, ...(country ? { regionCode: country } : {}), locationRestriction: { rectangle: { low: { latitude: at.lat - d, longitude: at.lng - d }, high: { latitude: at.lat + d, longitude: at.lng + d } } } }).catch(() => null))?.places || [];
  const pinned = near.sort((a, b) => metersApart(a.location, at) - metersApart(b.location, at))[0];
  if (pinned) place = pinned;
 }
 if (!place) throw new HttpsError('not-found', '找不到這個地點，請手動輸入。');
 // photos: up to 8 of the place's Google Maps photos, to pick another one when the first is wrong
 if (req.data?.photos === true) {
  const list = (await placesApi(`places/${place.id}`, 'photos').catch(() => ({}))).photos || [];
  const photos = (await Promise.all(list.slice(0, 8).map(ph => placePhotoJpeg(ph).catch(() => null)))).filter(Boolean);
  return { photos };
 }
 // highlights: the place form asks for 必吃・必買・特色 too (one AI use; left out when the day's AI uses are spent).
 const wantHighlights = req.data?.highlights === true;
 const wantPhoto = req.data?.photo === true;
 const detail = await placesApi(`places/${place.id}?languageCode=zh-TW`, DETAIL_FIELDS + (wantHighlights ? HIGHLIGHT_FIELDS : '') + (wantPhoto ? ',photos' : '')).catch(() => ({}));
 // photo: the place's first Google Maps photo
 let photo = null, photoBy = '';
 if (wantPhoto && detail.photos?.length)
  try {
   ({ photo = null, photoBy = '' } = (await placePhotoJpeg(detail.photos[0])) || {});
  } catch (e) {
   console.error('place photo', e?.message);
  }
 // Restaurants and cafés in Japan: their Tabelog page (reviews and table booking), found with DeepSeek Search and
 // kept only when the page is one restaurant whose name matches (list and review pages are skipped).
 const placeName = place.displayName?.text || query || '';
 const tabelogP = wantHighlights && country === 'JP' && /restaurant|cafe|coffee|bakery|bar\b|food|meal|ramen|sushi|izakaya|dessert|confectionery/.test((place.types || []).join(' '))
  ? deepseekTool('search', { query: `site:tabelog.com ${placeName} ${district(place)}`.slice(0, 128), count: 6 }).then(r => tabelogPage(r?.results || [], placeName), () => '')
  : Promise.resolve('');
 let ai = {};
 if (wantHighlights)
  try {
   await useQuota(req.auth.uid, 'ai');
   const trip = typeof req.data?.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(req.data.trip) ? (await getFirestore().doc(`trips/${req.data.trip}`).get()).data() : null;
   ai = await placeHighlights(trip, place.displayName?.text || query || '', detail.primaryTypeDisplayName?.text || '', detail, price(place.priceRange));
  } catch (e) {
   console.error('highlights', e?.message);
  }
 const tabelog = await tabelogPage.wait(tabelogP);
 return {
  tabelog,
  photo: photo && photo.length <= 300000 ? photo : null,
  photoBy,
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
