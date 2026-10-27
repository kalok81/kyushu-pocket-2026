// Products: AI product reading, local names and reviews, product and article links, note fill prompts, 購買地點 search.
import { isIP } from 'node:net';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';
import { getFirestore } from 'firebase-admin/firestore';
import { DEEPSEEK_API_KEY, PLACES_API_KEY, askDeepSeek, deepseekTool, requireMember, tripInfo, useQuota } from './base.js';
import { langFor, placesApi, sameShop } from './places.js';

// Product names as sold locally (Japanese in Japan, Korean in Korea), so they match the shelves; Chinese goes under it.
const LOCAL_NAMES = { JP: ['Japanese', 'Japan', '東京ばな奈 見ぃつけたっ", "肌ラボ 極潤 ヒアルロン液', /[\u3040-\u30ff]{2,}/g], KR: ['Korean', 'Korea', '이니스프리 그린티 씨드 세럼', /[\uac00-\ud7af]{2,}/g] };
export const productPrompt = t => { const { place, cur, home } = tripInfo(t), local = LOCAL_NAMES[t?.country]; return `You identify products that travellers in ${place} photograph to put on a shopping list (packages, labels, price tags, shelves, screenshots).
Reply with JSON only, in this shape:
{"name": string, "shownName": string, "spec": string, "detail": string, "category": "drug" | "food" | "fashion" | "home" | "stationery" | "toys" | "electronics" | "other", "price": number or null, "currency": "${cur}" | "${home}", "place": string, "confidence": "high" | "medium" | "low"}
- name: ${local ? `the name it is sold under in ${local[1]}'s shops, in ${local[0]} as on the local package (brand first, e.g. "${local[2]}"), but only when that ${local[0]} name is actually shown in the photo, the page or the search results. Otherwise keep the name exactly as shown (English or Chinese): never translate a name into ${local[0]} yourself or make one up` : 'the product name in its original language, as printed on the package or product page (brand first)'}, at most 80 characters. Do not translate it into Chinese and do not add a translation in brackets: a Traditional Chinese translation is added separately.
- shownName: the product name exactly as it is written in the photo, page or results (any language), at most 80 characters.
- spec: size, quantity or variant printed on it, at most 30 characters, in numbers and Traditional Chinese only (Hong Kong usage; units such as g, ml, cm may stay), e.g. 100g, 30 片裝, 12 個裝, 薄荷味, 清爽型; translate Japanese or English (30枚入 → 30 片裝, mint → 薄荷味); empty if unknown.
- detail: one short line on what it is or what it is for, at most 60 characters, always in Traditional Chinese as used in Hong Kong (translate it when the photo or page is in Japanese, English or another language; never Japanese).
- category: drug for cosmetics, skincare, hair care, beauty tools, medicine, patches and supplements (drugstore goods); food for snacks, sweets, drinks, instant food and condiments; fashion for clothes, shoes, bags, wallets and accessories; home for kitchen and household goods; stationery for pens, notebooks and office goods; toys for toys, games, figures, character and idol goods; electronics for gadgets and appliances; other otherwise.
- price: only if a price tag or label with this product's price is visible (tax-included price if both are shown); otherwise null.
- currency: ${cur} unless the price is clearly in ${home}.
- place: a shop name only if it is visible in the photo (price tag, shelf sign, bag); otherwise empty.
- confidence: low if the photo is unclear or shows no identifiable product.`; };

// source: the text the model read (page, search results), when there is one. A Japanese name (with kana; hangul for
// Korea) is kept only when it is in that text; otherwise the model translated or guessed it, and the name as shown
// (or typed) is used.
export function cleanProduct(r, t, source = '', typed = '') {
 const { cur, home } = tripInfo(t);
 const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const flat = v => String(v).normalize('NFKC').replace(/\s+/g, '');
 const kana = flat(text(r.name, 80)).match(LOCAL_NAMES[t?.country]?.[3] || /[\u3040-\u30ff]{2,}/g) || [];
 const found = !source || kana.every(k => flat(source).includes(k));
 const name = found ? text(r.name, 80) : text(r.shownName, 80) || typed || text(r.name, 80);
 const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 && r.price <= 1e7 ? Math.round(r.price * 100) / 100 : null;
 const cats = ['drug', 'food', 'fashion', 'home', 'stationery', 'toys', 'electronics', 'other'];
 return { name, qty: text(r.spec, 30), detail: text(r.detail, 500), cat: cats.includes(r.category) ? r.category : 'other', place: text(r.place, 200), price, currency: r.currency === home ? home : cur, confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low' };
}
// A product read from a photo or page with no local name on it (an English label): search the web for the name it is
// sold under at the destination, kept only when the search results show it (never a translation).
const localNamePrompt = (t, item, results) => `Travellers photographed this product: ${JSON.stringify({ name: item.name, spec: item.qty, detail: item.detail })}.
From the web search results below, give the name this same product is sold under in ${LOCAL_NAMES[t.country][1]}, in ${LOCAL_NAMES[t.country][0]} exactly as written in the results (brand first, same variant).
Reply with JSON only: {"name": string}. Empty name if the results do not show this product's ${LOCAL_NAMES[t.country][0]} name; never translate it yourself.
Search results: ${JSON.stringify(results)}`;
// 備註 (detail), 數量／規格 (qty) and 評價 (reviews) are for the travellers: Chinese only, apart from names. Kana,
// hangul or English words left in them, or Japanese counters (枚入) in the spec, are translated.
const NOT_ZH = { detail: /[\u3040-\u30ff\uac00-\ud7af]|[A-Za-z]{4,}/, qty: /[\u3040-\u30ff\uac00-\ud7af]|[A-Za-z]{3,}|[枚入]/, reviews: /[\u3040-\u30ff\uac00-\ud7af]{2,}|\b[a-z]{4,}\b(?![.])/ };
async function zhDetail(item, t) {
 const bad = Object.keys(NOT_ZH).filter(k => NOT_ZH[k].test(item[k] || ''));
 if (!bad.length) return item;
 const r = await askDeepSeek(`Rewrite these fields of a shopping list item in Traditional Chinese as used in Hong Kong; keep brand, product, shop and site names as written, and numbers and units (g, ml).
- detail: a product note, at most 60 characters.
- qty: size, quantity or variant, numbers and Chinese only, at most 30 characters (30枚入 → 30 片裝, 12個入 → 12 個裝, mint → 薄荷味, refill → 補充裝).
- reviews: a summary of user reviews; translate every Japanese, English or other word into Chinese, keeping product, brand and site names (and the last line 來源：…) as written; keep the length and line breaks.
Reply with JSON only: {${bad.map(k => `"${k}": string`).join(', ')}}
Fields: ${JSON.stringify(Object.fromEntries(bad.map(k => [k, item[k]])))}`, [], { think: false }).catch(() => null);
 const out = { ...item };
 for (const k of bad) if (typeof r?.[k] === 'string' && r[k].trim()) out[k] = r[k].trim().slice(0, { qty: 30, detail: 500, reviews: 1000 }[k]);
 return out;
}
// 評價: what users say about the product (reviews in Chinese, English or Japanese on the web), summed up in Traditional
// Chinese with the sites it comes from. Empty when the search finds no reviews of this product.
const reviewPrompt = (item, results) => `Travellers are thinking of buying this product: ${JSON.stringify({ name: item.name, spec: item.qty, detail: item.detail })}.
From the web search results below (reviews in any language), sum up what users say about this same product, in Traditional Chinese as used in Hong Kong.
Reply with JSON only: {"reviews": string, "sites": [number, ...]}
- reviews: at most 220 Chinese characters. First the rating if the results show a real score, with the number of reviews when shown (e.g. "@cosme 5.4/7（1,203 篇）", "Amazon 4.3/5"); leave out a score of 0 or a site with no score. Then 優點：… and 缺點：… in short points, then who it suits (適合…). Only what the results say about this product (not another product or variant). Write it all in Chinese: translate Japanese, English and other words, keeping only product, brand and site names as written. If the results have no user reviews of this product, reply with an empty string (do not write that none were found).
- sites: the numbers of the results the summary comes from.
Search results: ${JSON.stringify(results.map((r, i) => ({ n: i + 1, title: r.title, text: r.summary })))}`;
async function productReviews(item, t) {
 const name = String(item.name || '').replace(/[（(].*?[)）]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
 if (!name) return '';
 const queries = [`${name} 評價 心得`, `${name} review`, ...(t?.country === 'JP' ? [`${name} 口コミ`] : [])];
 const searches = await Promise.all(queries.map(q => deepseekTool('search', { query: q.slice(0, 128), count: 5 })));
 const results = searches.flatMap(r => r?.results || []).filter((r, i, all) => r.url && all.findIndex(x => x.url === r.url) === i).slice(0, 12)
  .map(r => ({ url: r.url, title: String(r.title || '').slice(0, 120), summary: String(r.summary || r.snippet || '').slice(0, 600) }));
 if (!results.length) return '';
 const r = await askDeepSeek(reviewPrompt(item, results), [], { think: false }).catch(() => null);
 const text = typeof r?.reviews === 'string' ? r.reviews.trim().slice(0, 600) : '';
 // "no reviews found" written out instead of left empty
 if (!text || (/沒有找到|未見|找不到|無法總結|未有.*評/.test(text) && !/優點/.test(text))) return '';
 const sites = [...new Set((Array.isArray(r.sites) ? r.sites : []).map(n => results[Number(n) - 1]?.url).filter(Boolean).map(u => new URL(u).hostname.replace(/^www\./, '')))].slice(0, 3);
 return `${text}${sites.length ? `\n來源：${sites.join('、')}` : ''}`.slice(0, 1000);
}
// The product's local name and Chinese fields, then its reviews.
export async function finishProduct(item, t) {
 const done = await withLocalName(item, t);
 const reviews = await productReviews(done, t).catch(() => '');
 return reviews ? zhDetail({ ...done, reviews }, t) : done;
}
async function withLocalName(item, t) {
 item = await zhDetail(item, t);
 const script = LOCAL_NAMES[t?.country]?.[3];
 if (!script || !item.name || String(item.name).normalize('NFKC').match(script)) return item;
 const s = await deepseekTool('search', { query: `${item.name.replace(/[（(].*?[)）]/g, ' ').trim()} ${t.country === 'KR' ? '정품' : '公式'}`.slice(0, 128), count: 6 });
 const results = (s?.results || []).slice(0, 6).map(r => ({ title: String(r.title || '').slice(0, 120), summary: String(r.summary || r.snippet || '').slice(0, 500) }));
 if (!results.length) return item;
 const r = await askDeepSeek(localNamePrompt(t, item, results), [], { think: false }).catch(() => null);
 const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 80) : '';
 const flat = v => String(v).normalize('NFKC').replace(/\s+/g, ''), runs = flat(name).match(script) || [];
 return runs.length && runs.every(k => flat(JSON.stringify(results)).includes(k)) ? { ...item, name } : item;
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
 // Pages without image tags: the first product-looking <img> (not logos, icons or banners).
 const imgs = [...html.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)].map(m => decodeEntities(m[1])).filter(u => !/logo|icon|sprite|banner|btn|button|common|header|footer|sns|badge|loading|blank/i.test(u));
 const firstImg = imgs.find(u => /product|item|goods|upload|img\/|images\//i.test(u)) || imgs[0] || '';
 // The product's own picture first: JSON-LD, then an <img> named after the page (…/details/cleandental_premium-cool/ →
 // cleandental_premium-cool_9B180_main.jpg), then the share image unless it is the site's own for every page
 // (…/common/ogp.jpg, a logo), which comes last.
 const slug = decodeURIComponent(base.pathname.split('/').filter(Boolean).pop() || '').replace(/\.\w+$/, '').toLowerCase();
 const named = slug.length >= 4 && !/^(index|detail|details|item|product|products|goods)$/.test(slug) ? imgs.find(u => u.toLowerCase().includes(slug)) : '';
 const share = meta('og:image') || meta('twitter:image'), siteWide = /ogp|og[-_]?image|common|default|logo|share|site[-_]?image|noimage/i.test(share);
 const picture = (typeof image === 'string' ? image : image?.url) || named || (siteWide ? '' : share) || firstImg || share;
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
export async function readProductLink(link) {
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
 const html = decodeHtml(got), facts = pageFacts(html, got.url);
 let image = null;
 if (facts.picture) image = await safeFetch(facts.picture).then(p => (p.type.startsWith('image/') ? smallJpeg(p.buf) : null)).catch(() => null);
 return { image, facts, link: got.url.href, html, base: got.url };
}
export const pagePrompt = (t, f) => `${productPrompt(t)}
The traveller pasted a link to this web page instead of a photo; the picture (if any) is the page's main image.
If the page is not about one specific product (a home, category, search or shop page), reply with an empty name and confidence low.
Use the page for the name, spec and detail (detail still in Traditional Chinese); the price only if it is in ${tripInfo(t).cur} or ${tripInfo(t).home}; place: the shop or brand selling it if clear.
Page: ${JSON.stringify({ site: f.site, title: f.title, brand: f.brand, description: f.description, price: f.price, currency: f.currency, text: f.text.slice(0, 2000) })}`;

// ---- Articles that list several products (手信推介, 必買清單): the whole page through DeepSeek Fetch (Markdown, with its
// pictures as ![](url)), the model lists each product, and each gets a small picture for the traveller to choose from.
const articlePrompt = (t, page, pics) => `${productPrompt(t)}
This time the traveller pasted a link to an article or list that recommends several products. List every specific product it recommends, in the order of the article, instead of one product.
Reply with JSON only: {"items": [{"name": string, "shownName": string, "spec": string, "detail": string, "category": string, "price": number or null, "currency": string, "place": string, "image": string}]}
- Up to 15 items; same rules as above for each field. detail: what it is and why the article recommends it, at most 60 characters.
- place: where the article says to buy it (shop, station, airport), at most 80 characters; empty if not said.
- image: the number of the article's picture of that product from the Pictures list (by its heading and alt text); 0 if none.
- Skip things that are not products to buy (restaurants, sights, hotels). Empty list if the page recommends no products.
Article title: ${JSON.stringify(page.title || '')}
Article (Markdown): ${String(page.content).slice(0, 14000)}
Pictures (in page order, with the heading they come under): ${JSON.stringify((pics || []).map(({ n, alt, heading }) => ({ n, alt, heading })))}`;
// The article's pictures in page order, each with its alt text and the heading above it (lazy-loaded data-src first).
export function articlePictures(html, base) {
 const out = [];
 let heading = '';
 for (const m of html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<img\b[^>]*>/gi)) {
  if (m[1] !== undefined) { heading = decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 80); continue; }
  const tag = m[0], attr = k => tag.match(new RegExp(`\\s${k}=["']([^"']+)["']`, 'i'))?.[1];
  const src = attr('data-src') || attr('data-lazy-src') || attr('data-original') || attr('src');
  if (!src || src.startsWith('data:') || /logo|icon|sprite|avatar|banner|pixel|placeholder|\.svg|\.gif/i.test(src)) continue;
  try { out.push({ n: out.length + 1, url: new URL(decodeEntities(src), base).href, alt: decodeEntities(attr('alt') || '').slice(0, 80), heading }); } catch {}
 }
 return out.slice(0, 80);
}
export async function articleItems(url, t, pics) {
 const page = await deepseekTool('fetch', { url });
 if (!page?.content) return null;
 const r = await askDeepSeek(articlePrompt(t, page, pics), [], { think: false });
 const items = (Array.isArray(r?.items) ? r.items : []).slice(0, 15).map(x => ({ ...cleanProduct({ ...x, confidence: 'high' }, t, page.content), image: pics?.[Number(x?.image) - 1]?.url || '' }))
  .filter(x => x.name);
 // Pictures: 480px JPEGs, fetched in parallel (the job document stays well under Firestore's 1 MB). The article's own
 // picture when it has one; else the main picture of a product page found by searching the product's name.
 // (pictures smaller than 240×180 are logos and icons, not product photos)
 const thumb = async u => {
  const g = await safeFetch(u);
  if (!g.type.startsWith('image/')) return null;
  const { width = 0, height = 0 } = await sharp(g.buf, { failOn: 'none' }).metadata();
  if (width < 240 || height < 180) return null;
  return (await sharp(g.buf, { failOn: 'none' }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
 };
 const own = new URL(url).hostname;
 const searched = async name => {
  const found = await deepseekTool('search', { query: name.replace(/[（(].*?[)）]/g, ' ').trim().slice(0, 100), count: 5 });
  for (const r of (found?.results || []).filter(r => { try { return new URL(r.url).hostname !== own; } catch { return false; } }).slice(0, 3)) {
   const pic = await safeFetch(r.url).then(g => (/html/.test(g.type) ? pageFacts(decodeHtml(g), g.url).picture : ''), () => '');
   const got = pic && (await thumb(pic).catch(() => null));
   if (got) return got;
  }
  return null;
 };
 const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
 const choices = await Promise.all(items.map(async ({ image, confidence: _c, ...x }) => ({
  ...x,
  photo: (image && (await thumb(image).catch(() => null))) || (await within(searched(x.name).catch(() => null), 30_000)),
 })));
 let size = 0;
 for (const c of choices) if (c.photo && (size += c.photo.length) > 700000) c.photo = null;
 return { choices, title: String(page.title || '').slice(0, 120), link: url.slice(0, 500) };
}

// ---- Notes and coupons: fill the 共用 form from a photo (coupon, sign, menu, timetable) or a web page ----
export const noteFillPrompt = (t, mode, f) => { const { place } = tripInfo(t); return `Travellers in ${place} keep notes and coupons in a shared trip app. ${f ? 'They pasted a link to the web page below' : 'They added the photo'} to a ${mode === 'coupon' ? 'coupon' : 'note'}.
Reply with JSON only, in this shape:
{"kind": "coupon" | "note", "title": string, "text": string, "code": string, "until": "YYYY-MM-DD" or null, "place": string}
- kind: coupon if it is a discount, voucher, coupon or special offer; otherwise note.
- title: for a coupon, the shop and the offer in short (e.g. "Bic Camera 免稅 10% + 5%"); for a note, a short heading. Traditional Chinese (Hong Kong usage), keeping shop and product names as written, at most 60 characters.
- text: for a coupon, the discount and its conditions (minimum spend, items, passport, how to use); for a note, the useful points in short lines (what, where, when, prices, opening hours, booking). Traditional Chinese, at most 400 characters; keep names, numbers, times and addresses exactly.
- code: a coupon or promo code exactly as printed (letters and digits); empty if none.
- until: the last day it is valid; if the year is not shown, use the next such date; null if not shown.
- place: the shop, venue or branch it is for, as written; empty if unclear.${f ? `
Page: ${JSON.stringify({ site: f.site, title: f.title, description: f.description, text: f.text.slice(0, 2500) })}` : ''}`; };
export function cleanNoteFill(r) {
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

// 購物 › 購買地點: search the web (DeepSeek Search) for where an item is sold, then let the model pick the places at
// or near the trip's destination. Returns up to 4 places as shop name + area (as on local signs) with a short reason.
const buyPrompt = (t, item, results) => `Hong Kong travellers on a trip to ${tripInfo(t).place} want to buy this item: ${JSON.stringify(item)}.
From the web search results below, list where they can buy it at or near the destination of the trip.
Reply with JSON only: {"places": [{"name": string, "why": string}], "note": string}
- places: up to 6, best first (shops at main stations, airports and popular shopping areas first). name: the shop or counter name and its area or building as written locally, short enough to search on Google Maps (e.g. "ふくや 博多デイトス売店", "福岡空港 国内線 ANA FESTA"). why: at most 20 Traditional Chinese characters (e.g. "博多站內，營業至 21:00").
- Only places the results support; do not invent shops. No places if the results show none near the destination.
- note: at most 60 Traditional Chinese characters (Hong Kong usage) for anything important, e.g. that it is mainly sold elsewhere (北海道限定) or only at the airport; empty otherwise.
Search results: ${JSON.stringify(results)}`;
// full: the traveller only typed a name; also identify the product (name, spec, detail, category, usual price).
const productInfoPrompt = (t, typed, results) => `${productPrompt(t)}
This time there is no photo: the traveller typed ${JSON.stringify(typed)}. Identify the product from the web search results below.
- price: the usual retail price in ${tripInfo(t).cur} (tax included) if the results show one, else null.
- place: empty (where to buy is worked out separately).
- confidence: low if the results do not clearly show which product this is.
- Also add "page": the url of the result that best shows this exact product with a picture (the maker's product page or a shop's product page; not a blog, list or search page); empty if none.
Search results: ${JSON.stringify(results)}`;
// Each shop the AI names is looked up on Google Maps near the trip: kept (with Google's name, address, position and
// link) only when the place found shares a distinctive word with the AI's name — a word of the name that is not part
// of the address, so an area (博多, 空港) alone never matches. Shops Google cannot find are dropped.
const BUY_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri'].map(f => 'places.' + f).join(',');
async function checkOnMaps(p, t) {
 const c = t?.center, country = /^[A-Z]{2}$/.test(t?.country || '') ? t.country : '';
 const r = await placesApi('places:searchText', BUY_FIELDS, {
  textQuery: p.name, languageCode: langFor(country), maxResultCount: 1, ...(country ? { regionCode: country } : {}),
  ...(Number.isFinite(c?.lat) && Number.isFinite(c?.lng) ? { locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 50000 } } } : {}),
 }).catch(() => null);
 const g = r?.places?.[0];
 if (!g?.displayName?.text) return null;
 if (!sameShop(p.name, g)) return null;
 return { id: g.id, name: g.displayName.text.slice(0, 100), address: String(g.formattedAddress || '').slice(0, 200), lat: g.location?.latitude ?? null, lng: g.location?.longitude ?? null, mapsUrl: String(g.googleMapsUri || '').slice(0, 300), why: p.why };
}
export const findBuyPlaces = onCall({ region: 'asia-northeast1', enforceAppCheck: true, secrets: [DEEPSEEK_API_KEY, PLACES_API_KEY], memory: '256MiB', timeoutSeconds: 90, maxInstances: 3 }, async req => {
 await requireMember(req);
 const d = req.data || {}, text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
 const item = { name: text(d.name, 80), spec: text(d.qty, 30), detail: text(d.detail, 200) };
 if (!item.name) throw new HttpsError('invalid-argument', '請先輸入物品名稱。');
 await useQuota(req.auth.uid, 'ai');
 const trip = typeof d.trip === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(d.trip) ? (await getFirestore().doc(`trips/${d.trip}`).get()).data() : null;
 const where = tripInfo(trip).place, name = item.name.replace(/[（(].*?[)）]/g, ' ').trim().slice(0, 60);
 const full = d.full === true;
 const queries = [`${name} 販売店 ${where}`, `${name} 哪裡買 ${where}`, ...(full ? [name, `${name} 価格 内容量`] : [])];
 const searches = await Promise.all(queries.map(q => deepseekTool('search', { query: q.slice(0, 128), count: 6 })));
 const tidy = rs => rs.filter((r, i, all) => all.findIndex(x => x.url === r.url) === i).map(r => ({ title: String(r.title || '').slice(0, 120), url: r.url, summary: String(r.summary || r.snippet || '').slice(0, 700) }));
 const results = tidy(searches.slice(0, 2).flatMap(r => r?.results || [])).slice(0, 10), about = tidy(searches.slice(2).flatMap(r => r?.results || [])).slice(0, 8);
 if (!results.length && !about.length) throw new HttpsError('not-found', '網上找不到這件物品。');
 const [r, info, reviews] = await Promise.all([
  results.length ? askDeepSeek(buyPrompt(trip, item, results), [], { think: false }) : {},
  full && about.length ? askDeepSeek(productInfoPrompt(trip, item.name, about), [], { think: false }).catch(() => null) : null,
  full ? productReviews(item, trip).catch(() => '') : '',
 ]);
 const product = info && info.confidence !== 'low' ? await zhDetail(cleanProduct(info, trip, JSON.stringify(about), item.name), trip) : null;
 // A picture for the item: the main image of the product page the model chose, else of the next product results.
 let photo = null;
 if (product && d.photo === true) {
  const pages = [info.page, ...about.map(r => r.url)].filter((u, i, all) => typeof u === 'string' && /^https?:\/\//.test(u) && all.indexOf(u) === i).slice(0, 3);
  for (const u of pages) {
   photo = await readProductLink(u).then(g => g.image, () => null);
   if (photo) break;
  }
 }
 const named = (Array.isArray(r?.places) ? r.places : []).slice(0, 6).map(p => ({ name: text(p?.name, 100), why: text(p?.why, 40) })).filter(p => p.name);
 const checked = await Promise.all(named.map(p => checkOnMaps(p, trip)));
 const places = checked.filter((p, i) => p && checked.findIndex(q => q?.id === p.id) === i).slice(0, 4).map(({ id: _id, ...p }) => p);
 return { places, dropped: named.length - checked.filter(Boolean).length, note: text(r?.note, 120), product, reviews: reviews ? (await zhDetail({ reviews }, trip)).reviews : '', photo: photo && photo.length <= 400000 ? photo : null, sources: [...new Set([...results, ...about].slice(0, 3).map(x => new URL(x.url).hostname))] };
});
