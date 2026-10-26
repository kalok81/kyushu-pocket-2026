// Browser smoke test of the whole site against in-memory Firebase (tests/fake) and canned weather / exchange rates.
// Run: cd tests && npm ci && npx playwright install chromium && npm test
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = new URL('../dist/', import.meta.url).pathname, fake = new URL('./fake/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
 const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
 const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
 try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
 catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const days = ['2030-03-31', '2030-04-01', '2030-04-02', '2030-04-03', '2030-04-04'];
const weather = { daily: { time: days, weather_code: [0, 61, 3, 1, 95], temperature_2m_max: [20, 18, 21, 22, 19], temperature_2m_min: [11, 10, 12, 13, 12], precipitation_probability_max: [0, 80, 20, 10, 90] } };
const rates = { result: 'success', time_last_update_unix: 1900000000, rates: { HKD: 1, JPY: 20 } };

const browser = await chromium.launch(), errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/vendor/firebase/*.js', r => r.fulfill({ path: fake + r.request().url().split('/').pop().split('?')[0], contentType: 'text/javascript' }));
await page.route('https://api.open-meteo.com/**', r => r.fulfill({ json: weather, headers: { 'Access-Control-Allow-Origin': '*' } }));
await page.route('https://open.er-api.com/**', r => r.fulfill({ json: rates, headers: { 'Access-Control-Allow-Origin': '*' } }));
await page.route(/^https:\/\/(tile\.openstreetmap|www\.google)/, r => r.abort());
// The ✕ closes a sheet even with unsaved changes (tapping outside or Esc would ask first); Esc otherwise (menus).
const closeSheet = async () => ((await page.evaluate(() => document.querySelector('#detail').open)) ? page.click('#detail .dialog-close') : page.keyboard.press('Escape'));
const addShop = async (name, place) => {
 await page.click('[data-tg=shopAdd]'); await page.waitForSelector('[data-tg-form=shop]');
 await page.fill('[data-tg-form=shop] [name=name]', name); await page.click('.shop-more summary'); await page.fill('[data-tg-form=shop] [name=place]', place); await page.click('[data-tg-form=shop] button[type=submit]');
 await page.waitForFunction(() => !document.querySelector('#detail').open);
};
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.error('✗', name); throw e; } };

try {
 await step('login', async () => {
  await page.goto(base + '/#home');
  await page.fill('[name=id]', 'amy'); await page.fill('[name=password]', 'wrong'); await page.click('[data-tg-form=login] button');
  await page.waitForTimeout(300); assert(await page.locator('[name=id]').isVisible(), 'wrong password must not sign in');
  await page.fill('[name=password]', 'pw12345678'); await page.click('[data-tg-form=login] button');
  await page.waitForSelector('.hero h1'); assert.equal(await page.locator('.hero h1').innerText(), '測試旅程');
 });
 await step('every page renders', async () => {
  for (const v of ['home', 'plan', 'explore', 'nearby', 'flights', 'hotels', 'shopping', 'together', 'trips']) {
   await page.goto(`${base}/#${v}`); await page.waitForTimeout(400);
   assert((await page.locator('#app').innerText()).length > 20, `#${v} is empty`);
  }
 });
 await step('plan: add a stop, weather, print', async () => {
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('[data-plan-pick]');
  // ＋ 加入地點 › 新增地點 is the explore place form plus a time: the place is kept in 探索 and the stop points at it
  await page.click('[data-plan-pick]'); await page.click('#detail [data-stop-new]'); await page.fill('#placeForm [name=time]', '10:00'); await page.fill('#placeForm [name=f1]', '淺草寺');
  await page.fill('#placeForm [name=f0]', '淺草'); await page.locator('#placeForm [name=cats]').nth(1).check(); await page.fill('#placeForm [name=f3]', '東京都台東区浅草2-3-1'); await page.click('#placeForm button[type=submit]');
  await page.waitForSelector('.timeline h3'); assert.deepEqual(await page.locator('.timeline h3').allInnerTexts(), ['淺草寺']);
  await page.waitForSelector('.timeline [data-place]'); await page.click('.timeline [data-place]'); await page.waitForSelector('#detail .detailtitle');
  assert.equal(await page.locator('#detail .detailtitle').innerText(), '淺草寺'); await closeSheet();
  await page.goto(base + '/#explore'); await page.waitForSelector('#results .card.place'); assert.match(await page.locator('#results').innerText(), /淺草寺/);
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.timeline h3');
  await page.waitForSelector('.dayintro .weather:not([hidden])'); assert.match(await page.locator('.dayintro .weather').innerText(), /18°C · 降雨機會 80%/);
  await page.evaluate(() => { window.print = () => { window.printed = true; }; }); await page.click('.day-more summary'); await page.click('[data-plan-print]');
  assert(await page.evaluate(() => window.printed)); assert.match(await page.locator('#printArea').innerText(), /DAY 1[\s\S]*淺草寺/);
 });
 await step('expenses: home-currency stats and settlement', async () => {
  await page.goto(base + '/#together?tab=expenses'); await page.click('[data-tg=newEntry]'); await page.waitForSelector('[data-tg-form=expense]');
  const f = '[data-tg-form=expense] ';
  await page.fill(f + '[name=title]', '晚餐'); await page.fill(f + '[name=amount]', '4000'); await page.selectOption(f + '[name=category]', 'food'); await page.click(f + 'button[type=submit]');
  await page.waitForSelector('.tg-total'); await page.waitForFunction(() => document.querySelector('.tg-total b')?.textContent === 'HK$200.00');
  assert.equal(await page.locator('.tg-conv').innerText(), '≈ HK$200.00');
  assert.match(await page.locator('.tg-stats').innerText(), /🍜 餐飲/);
  // search: by title or category; nothing found
  await page.fill('#expSearch', '晚餐'); await page.waitForSelector('.exp-found'); assert.match(await page.locator('.exp-found').innerText(), /找到 1 筆 · 合計約 HK\$200\.00/);
  await page.fill('#expSearch', '餐飲'); await page.waitForFunction(() => /找到 1 筆/.test(document.querySelector('.exp-found')?.textContent));
  await page.fill('#expSearch', '拉麵'); await page.waitForFunction(() => /找不到「拉麵」/.test(document.querySelector('[data-tg-live=list]').textContent));
  await page.fill('#expSearch', ''); await page.waitForFunction(() => !document.querySelector('.exp-found') && document.querySelectorAll('[data-tg-live=list] .tg-item').length === 1);
 });
 await step('checklist: suggestions and ticks', async () => {
  await page.goto(base + '/#together?tab=checklist'); await page.click('.tg-list [data-tg=checkSuggest]');
  await page.waitForSelector('.check-row'); await page.locator('[data-check]').first().check();
  await page.waitForFunction(() => /你已完成 1／/.test(document.querySelector('.check-progress')?.textContent || ''));
 });
 await step('hotels: add, confirm popup, delete', async () => {
  await page.goto(base + '/#hotels'); await page.click('[data-hotel-new]'); await page.fill('#hotelForm [name=name]', '測試酒店'); await page.click('#hotelForm button[type=submit]');
  const delHotel = async () => { await page.click('.card.hotel .more summary'); await page.click('[data-hotel-del]:visible'); await page.waitForSelector('.ui-pop'); };
  await page.waitForSelector('.card.hotel'); await delHotel();
  await page.click('.ui-pop .btn-outline'); await page.waitForTimeout(300); assert.equal(await page.locator('.card.hotel').count(), 1, 'cancel keeps the hotel');
  await delHotel(); await page.click('.ui-pop .btn-danger');
  await page.waitForFunction(() => !document.querySelector('.card.hotel'));
 });
 await step('plan: add a hotel from 住宿 as a stop', async () => {
  await page.goto(base + '/#hotels'); await page.click('[data-hotel-new]'); await page.fill('#hotelForm [name=name]', '上野酒店'); await page.fill('#hotelForm [name=address]', '東京都台東區上野1-1');
  await page.click('#hotelForm button[type=submit]'); await page.waitForSelector('.card.hotel');
  await page.goto(base + '/#plan?day=2'); await page.waitForSelector('[data-plan-pick]'); await page.click('[data-plan-pick]');
  await page.click('[data-pp-cat=住宿]'); await page.waitForSelector('[data-pp-hotel]');
  await page.fill('#ppTime', '21:00'); await page.click('[data-pp-hotel]'); await page.waitForSelector('#ppList .badge');
  await page.fill('#ppTime', '09:00'); await page.click('[data-pp-hotel]'); await page.waitForFunction(() => /2 次/.test(document.querySelector('#ppList .badge')?.textContent || ''));
  await closeSheet(); await page.waitForSelector('.timeline h3');
  assert.deepEqual(await page.locator('.timeline h3').allInnerTexts(), ['上野酒店', '上野酒店']);
  assert.deepEqual(await page.locator('.timeline .time').allInnerTexts(), ['09:00', '21:00']);
  assert.equal(await page.locator('.timeline .stop a[href="#hotels"]').count(), 2);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/plan-hotel.png' });
 });
 await step('plan: route suggestions into 交通', async () => {
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.timeline h3');
  await page.click('[data-plan-pick]'); await page.click('[data-pp-cat=住宿]'); await page.fill('#ppTime', '08:00'); await page.click('[data-pp-hotel]'); await closeSheet();
  await page.waitForFunction(() => document.querySelectorAll('.timeline h3').length === 2);
  // one link before the first slot (from the hotel) and one between the two slots
  assert.equal(await page.locator('[data-route-link]').count(), 2); assert.match(await page.locator('[data-route-link]').first().innerText(), /由酒店出發/);
  await page.locator('[data-route-link]').nth(1).click();
  assert.match(await page.locator('#routeFrom option:checked').innerText(), /上野酒店/);
  assert.equal(await page.inputValue('#routeTime'), '08:00');
  // one row before any search: 查路線, Google 地圖, Yahoo!乗換 and AI 分析, the links filled in for the current choices
  assert.deepEqual(await page.locator('.route-actions > .btn:visible').allInnerTexts(), ['查路線', 'Google', 'Yahoo', 'AI 分析']);
  assert.equal(new Set(await page.locator('.route-actions > .btn:visible').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().top)))).size, 1, 'all four on one line');
  assert.match(await page.getAttribute('#routeGm', 'href'), /travelmode=transit/);
  assert.match(await page.getAttribute('#routeYahoo', 'href'), /transit\.yahoo\.co\.jp.*from=%E4%B8%8A%E9%87%8E%E9%85%92%E5%BA%97.*hh=08/);
  await page.fill('#routeTime', '09:30'); await page.dispatchEvent('#routeTime', 'change'); assert.match(await page.getAttribute('#routeYahoo', 'href'), /hh=09&m1=3&m2=0/);
  await page.fill('#routeTime', '08:00'); await page.dispatchEvent('#routeTime', 'change');
  // Japan by public transport: NAVITIME
  await page.click('#routeGo'); await page.waitForSelector('#routeResults [data-route-pick]');
  assert.match(await page.locator('#routeResults').innerText(), /NAVITIME/);
  await page.click('[data-route-ai]'); await page.waitForSelector('[data-route-ai-pick]');
  assert.deepEqual(await page.locator('#routeAi .route-option .route-head b').allInnerTexts(), ['最快', '的士']);
  assert.deepEqual(await page.locator('#routeAi .ai-sure').allInnerTexts(), ['把握：高', '把握：低，請核對']);
  const req = await page.evaluate(() => window.aiRequest); assert.equal(req.origin.name, '上野酒店'); assert.equal(req.destination.name, '淺草寺'); assert.equal(req.currency, 'JPY');
  await page.locator('[data-route-ai-pick]').first().click();
  await page.waitForFunction(() => /最快：.*銀座線 上野 → 淺草.*（AI 估算）/.test(document.querySelector('#routeManual textarea').value));
  await page.selectOption('#routeMode', 'WALK'); await page.click('#routeGo'); await page.waitForSelector('[data-route-pick]');
  await page.click('[data-route-pick]'); await page.waitForFunction(() => document.querySelector('#routeManual textarea').value.includes('步行約 12 分'));
  await page.fill('#routeManual textarea', '🚶 3 分 → 🚇 銀座線 上野 → 淺草（約 10:02–10:07） → 🚌 都バス 淺草 → 雷門一丁目（10:10–10:14）｜約 14 分'); await page.click('#routeManual button[type=submit]');
  await page.waitForSelector('.route-dot.has-route'); assert.match(await page.locator('[data-route-link]').nth(1).innerText(), /銀座線 上野 → 淺草/);
  // a train with a time: 查班次 opens Yahoo!乗換案内 for that station pair, day and time
  assert.equal(await page.locator('.route-checks a').count(), 1, 'trains only: the bus leg gets no 查班次 link');
  const check = new URL(await page.locator('.route-checks a').first().getAttribute('href'));
  assert.deepEqual([check.hostname, check.searchParams.get('from'), check.searchParams.get('to'), check.searchParams.get('hh'), check.searchParams.get('m1') + check.searchParams.get('m2')], ['transit.yahoo.co.jp', '上野', '淺草', '10', '02']);
  // a second choice at 10:00: the link asks which destination
  assert.equal(await page.locator('[data-stop-alt]:not(.alt-add)').count(), 0, 'not in the ⋯ menu'); await page.locator('.time [data-stop-alt]').nth(1).click(); await page.click('[data-pp-cat=住宿]'); await page.click('[data-pp-hotel]'); await closeSheet();
  await page.waitForSelector('.stop-group'); await page.locator('[data-route-link]').nth(1).click(); await page.waitForSelector('#routeTo');
  assert.deepEqual(await page.locator('#routeTo option').allInnerTexts(), ['淺草寺', '上野酒店']);
  await page.selectOption('#routeTo', { label: '上野酒店' }); assert.equal(await page.inputValue('#routeManual textarea'), '');
  await closeSheet();
 });
 await step('shopping list shows on explore and plan', async () => {
  await page.goto(base + '/#explore'); await page.click('[data-place-new]');
  await page.fill('#placeForm [name=f0]', '淺草'); await page.fill('#placeForm [name=f1]', '仲見世通り'); await page.locator('#placeForm [name=cats]').first().check(); await page.click('#detail [data-place-fav]'); await page.click('#placeForm button[type=submit]');
  await page.locator('#results .card.place', { hasText: '仲見世通り' }).locator('.save.saved').waitFor({ timeout: 5000 }); // the form's ★ saved it to 收藏
  // the same name again: asked first; 取消 keeps the form open
  await page.click('[data-place-new]'); await page.fill('#placeForm [name=f0]', '淺草'); await page.fill('#placeForm [name=f1]', '仲見世 通り'); await page.locator('#placeForm [name=cats]').first().check(); await page.click('#placeForm button[type=submit]');
  await page.waitForSelector('.ui-pop'); assert.match(await page.locator('.ui-pop').innerText(), /探索已有相似地點[\s\S]*仲見世通り/);
  await page.click('.ui-pop button:has-text("取消")').catch(() => page.keyboard.press('Escape')); await page.waitForSelector('.swal2-container', { state: 'detached' });
  assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'cancel keeps the form'); await closeSheet();
  if (await page.isVisible('.ui-pop')) await page.click('.ui-pop button:has-text("放棄")');
  await page.waitForFunction(() => !document.querySelector('#detail').open);
  assert.equal(await page.locator('#results .card.place', { hasText: '仲見世' }).count(), 1);
  await page.goto(base + '/#shopping'); await addShop('人形燒', '仲見世通り 淺草'); await addShop('御守', '淺草寺 本堂');
  await page.waitForTimeout(300);
  await page.goto(base + '/#explore'); await page.waitForSelector('#results .buy-here');
  assert.match(await page.locator('#results .card.place', { hasText: '仲見世通り' }).locator('.buy-here').innerText(), /要買：人形燒/);
  assert.match(await page.locator('#results .card.place', { hasText: '淺草寺' }).locator('.buy-here').innerText(), /要買：御守/);
  await page.click('[data-cat=購物清單]'); assert.equal(await page.locator('#results .card.place').count(), 2);
  await page.locator('#results .card.place', { hasText: '仲見世通り' }).locator('[data-place]').click(); await page.waitForSelector('#detail .detail-section >> text=購物清單（1）');
  await page.click('#detail [data-shop-open]'); await page.waitForFunction(() => /人形燒/.test(document.querySelector('#detailBody').textContent)); await closeSheet();
  // a 購買地點 that is not an explore place: its own card, and 加入探索 makes it one
  await page.goto(base + '/#shopping'); await addShop('蘋果批', 'RINGO 上野店');
  await page.goto(base + '/#explore'); await page.click('[data-cat=購物清單]'); await page.waitForSelector('.shop-spot');
  assert.match(await page.locator('.shop-spot').innerText(), /RINGO 上野店[\s\S]*要買：[\s\S]*蘋果批/);
  await page.click('[data-spot-explore]'); assert.equal(await page.inputValue('#placeForm [name=f1]'), 'RINGO 上野店');
  await page.fill('#placeForm [name=f0]', '上野'); await page.click('#placeForm button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.shop-spot') && /蘋果批/.test(document.querySelector('#results').textContent));
  await page.click('[data-cat=全部]');
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.timeline h3');
  assert.match(await page.locator('.stopcontent', { hasText: '淺草寺' }).first().innerText(), /要買：御守/);
  await page.click('[data-plan-pick]'); await page.click('[data-pp-cat=購物清單]'); await page.waitForSelector('[data-pp-spot]');
  assert.match(await page.locator('#ppList').innerText(), /仲見世通り\s*要買：人形燒/);
  await page.locator('#ppList .pp-row', { hasText: '仲見世通り' }).locator('[data-pp-spot]').click(); await closeSheet();
  await page.waitForFunction(() => [...document.querySelectorAll('.timeline h3')].some(h => h.textContent === '仲見世通り'));
  assert.match(await page.locator('.stopcontent', { hasText: '仲見世通り' }).first().innerText(), /要買：人形燒/);
 });
 await step('notebook gathers what companions entered', async () => {
  await page.goto(base + '/#notebook'); await page.waitForSelector('#notebookResults .notebook-card');
  const text = await page.locator('#notebookResults').innerText();
  for (const want of ['淺草寺', '上野酒店', '蘋果批']) assert.match(text, new RegExp(want), `notebook should list ${want}`);
  assert.equal(await page.locator('#moreNotebook').count(), 0);
  assert.doesNotMatch(await page.locator('#app').innerText(), /資料快照/);
  await page.click('[data-notebook-type=行程]'); assert.match(await page.locator('#notebookResults').innerText(), /D1 1\/4\/2030 · 10:00/);
  await page.locator('[data-notebook-record]').first().click(); await page.waitForSelector('#detail a[href^="#plan?day="]'); await closeSheet();
  await page.click('[data-notebook-type=購物]'); await page.locator('[data-notebook-record]').first().click(); await page.waitForSelector('#detailBody .shop-item');
  await closeSheet();
 });
 await step('plan stops follow their explore place', async () => {
  await page.goto(base + '/#explore'); await page.locator('#results .card.place', { hasText: '淺草寺' }).locator('[data-place]').click();
  await page.click('#detail [data-place-edit]'); await page.fill('#placeForm [name=f1]', '淺草寺（雷門）'); await page.click('#placeForm button[type=submit]');
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.timeline h3');
  assert.ok((await page.locator('.timeline h3').allInnerTexts()).includes('淺草寺（雷門）'), 'stop shows the new place name');
  const i = await page.locator('.stopcontent', { hasText: '淺草寺（雷門）' }).locator('[data-stop-more]').getAttribute('data-stop-more');
  await page.click(`[data-stop-more="${i}"]`); await page.click(`[data-stop-edit="${i}"]`); await page.waitForSelector('#stopForm');
  assert.equal(await page.locator('#stopForm [name=title]').count(), 0); assert.match(await page.locator('#stopForm .notice').innerText(), /跟隨探索地點/);
  await page.fill('#stopForm [name=time]', '10:30'); await page.click('#stopForm button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.stop')].some((s) => s.textContent.includes('10:30') && s.textContent.includes('淺草寺（雷門）')));
 });
 await step('shopping item linked to a chosen explore place', async () => {
  await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]'); await page.waitForSelector('[data-tg-form=shop]');
  await page.fill('[data-tg-form=shop] [name=name]', '雷門煎餅'); await page.click('.shop-more summary'); await page.fill('[data-tg-form=shop] [name=placeQ]', '淺草寺（雷門） · 淺草');
  await page.click('[data-tg-form=shop] button[type=submit]');
  await page.waitForSelector('.shop-item:has-text("雷門煎餅") .shop-place');
  assert.match(await page.locator('.shop-item', { hasText: '雷門煎餅' }).innerText(), /探索：\s*淺草寺（雷門）[\s\S]*淺草寺（雷門） 東京都台東区浅草2-3-1/);
  await page.goto(base + '/#explore'); await page.waitForSelector('#results .card.place');
  assert.match(await page.locator('#results .card.place', { hasText: '淺草寺（雷門）' }).locator('.buy-here').innerText(), /雷門煎餅/);
 });
 await step('notes with photos and links; coupons', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  await page.goto(base + '/#together?tab=notes'); await page.click('[data-tg=newEntry]'); await page.waitForSelector('[data-tg-form=note]');
  await page.fill('[data-tg-form=note] [name=text]', '集合地點 https://example.com/meet');
  await page.locator('#notePhotoInput').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('#notePhotoPreview img');
  await page.click('[data-tg-form=note] button[type=submit]');
  await page.waitForSelector('.tg-item .note-photo'); const note = page.locator('.tg-item', { hasText: '集合地點' });
  assert.equal(await note.locator('.tg-text a').getAttribute('href'), 'https://example.com/meet');
  assert.equal(await page.locator('#detail[open]').count(), 0, 'the sheet closes after adding');
  // ⋯ › 修改: the form opens with the note's text, link and photo; saving changes it (an emptied link and photo go)
  await note.locator('.item-top details.more > summary').click(); await page.click('[data-note-edit]:visible');
  await page.waitForSelector('[data-tg-form=note]'); assert.match(await page.locator('#detail .detailtitle').innerText(), /修改筆記/);
  assert.equal(await page.inputValue('[data-tg-form=note] [name=text]'), '集合地點 https://example.com/meet');
  assert.equal(await page.locator('[data-tg-form=note] [data-note-kind]').count(), 0, 'the kind stays');
  assert.equal(await page.locator('#notePhotoPreview img').count(), 1);
  await page.fill('[data-tg-form=note] [name=text]', '集合地點改到雷門'); await page.locator('[data-note-photo-del]').first().click();
  await page.click('[data-tg-form=note] button[type=submit]'); await page.waitForSelector('.tg-item:has-text("集合地點改到雷門")');
  const edited = await page.evaluate(() => Object.values(globalThis.__fakeStore.notes).find((n) => n.text === '集合地點改到雷門'));
  assert.deepEqual([edited.photos.length, edited.byName], [0, 'Amy']);
  await page.click('[data-tg=newEntry]'); assert.equal(await page.inputValue('[data-tg-form=note] [name=text]'), '', 'a new note starts empty'); await closeSheet();
  await page.click('[data-tg=newEntry]'); await page.click('[data-note-kind=coupon]'); await page.waitForSelector('[data-tg-form=note][data-kind=coupon]');
  await page.fill('[data-tg-form=note] [name=title]', 'Bic Camera 免稅 10%'); await page.fill('[data-tg-form=note] [name=code]', 'BIC2030');
  await page.fill('[data-tg-form=note] [name=until]', '2099-12-31'); await page.fill('[data-tg-form=note] [name=placeQ]', '淺草寺（雷門）');
  await page.locator('#notePhotoInput').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('#notePhotoPreview img');
  await page.click('[data-tg-form=note] button[type=submit]');
  await page.waitForSelector('.tg-item.coupon'); const c = page.locator('.tg-item.coupon');
  assert.match(await c.innerText(), /Bic Camera 免稅 10%[\s\S]*BIC2030[\s\S]*還有 \d+ 天/);
  await page.click('[data-note-filter=coupon]'); assert.equal(await page.locator('.tg-list .tg-item').count(), 1);
  await c.locator('[data-coupon-used]').click(); await page.waitForSelector('.tg-item.coupon.used');
  await c.locator('[data-note-photo]').click(); await page.waitForSelector('#detail .note-photo-full'); assert.match(await page.locator('#detail').innerText(), /BIC2030/);
  await closeSheet();
  await page.goto(base + '/#explore'); await page.locator('#results .card.place', { hasText: '淺草寺（雷門）' }).locator('[data-place]').click();
  await page.waitForSelector('#detail .tg-item.coupon'); await closeSheet();
 });
 await step('shopping categories: grouped list and filter', async () => {
  await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]'); await page.waitForSelector('[data-tg-form=shop]');
  await page.fill('[data-tg-form=shop] [name=name]', '化妝水'); await page.click('.shop-more summary'); await page.selectOption('[data-tg-form=shop] [name=cat]', 'drug'); await page.fill('[data-tg-form=shop] [name=forWhom]', '媽媽'); await page.fill('[data-tg-form=shop] [name=detail]', '敏感肌用'); await page.click('[data-tg-form=shop] button[type=submit]');
  await page.click('[data-shop-filter=all]'); await page.waitForSelector('.shop-cat-head');
  const heads = await page.locator('.shop-cat-head').allInnerTexts();
  assert.ok(heads[0].startsWith('💄 藥妝') && heads.some((h) => h.startsWith('🍱 食品')), heads.join(','));
  await page.click('[data-shop-cat=drug]'); await page.waitForTimeout(200);
  assert.deepEqual(await page.locator('.shop-item h3').allInnerTexts(), ['化妝水']);
  assert.match(await page.locator('.shop-item', { hasText: '化妝水' }).innerText(), /給：媽媽[\s\S]*敏感肌用/);
  await page.click('[data-shop-cat=all]');
  // adding the same item again asks first
  await page.click('[data-tg=shopAdd]'); await page.waitForSelector('[data-tg-form=shop]'); await page.fill('[data-tg-form=shop] [name=name]', '化妝水'); await page.click('[data-tg-form=shop] button[type=submit]');
  await page.waitForSelector('.ui-pop'); assert.match(await page.locator('.ui-pop').innerText(), /清單已有相似物品[\s\S]*化妝水/);
  await page.click('.ui-pop button:has-text("取消")').catch(() => page.keyboard.press('Escape')); await page.waitForSelector('.swal2-container', { state: 'detached' });
  assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'the form stays open'); await closeSheet();
  assert.equal(await page.locator('.shop-item h3', { hasText: '化妝水' }).count(), 1);
  // the tick box marks it bought; 復原 sets it back
  const tick = page.locator('.shop-item', { hasText: '化妝水' }).locator('.shop-check');
  await tick.click(); await page.waitForFunction(() => [...document.querySelectorAll('.shop-item')].some((a) => /化妝水/.test(a.textContent) && a.querySelector('.shop-check.on')) || ![...document.querySelectorAll('.shop-item')].some((a) => /化妝水/.test(a.textContent)));
  await page.click('.snack-action'); await page.click('[data-shop-filter=all]');
  await page.waitForFunction(() => [...document.querySelectorAll('.shop-item')].some((a) => /化妝水/.test(a.textContent) && a.querySelector('.shop-check:not(.on)')));
 });
 await step('shopping: product link and pasted picture go to the AI', async () => {
  await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]'); await page.waitForSelector('[data-tg-form=shop]');
  // one box for names and links; only 相片 and AI 填寫, the rest folded away
  assert.deepEqual(await page.locator('#detail .shop-actions .btn').allInnerTexts(), ['相片', 'AI 填寫']); assert.ok(await page.locator('[data-tg-form=shop] [name=qty]').isHidden());
  await page.fill('[data-tg-form=shop] [name=name]', 'https://shop.example.jp/item/123'); await page.click('[data-tg-form=shop] button[type=submit]');
  await page.waitForFunction(() => /shop\.example\.jp/.test(document.querySelector('[data-tg-live=jobs]')?.textContent || ''));
  await page.evaluate(async () => {
   const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 }), blob = await new Promise((r) => c.toBlob(r, 'image/png'));
   const dt = new DataTransfer(); dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
   document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForFunction(() => /screenshot\.png/.test(document.querySelector('[data-tg-live=jobs]')?.textContent || ''));
 });
 await step('AI fills the coupon and note forms from a photo or link', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  // stands in for processReceipt: answer the pending noteFill job
  const answer = (result) => page.evaluate(async (result) => {
   const fs = await import('./vendor/firebase/firebase-firestore.js'), jobs = globalThis.__fakeStore.receiptJobs || {};
   const id = Object.keys(jobs).filter((k) => jobs[k].kind === 'noteFill' && jobs[k].status === 'pending').sort((a, b) => jobs[b].at - jobs[a].at)[0];
   await fs.updateDoc({ c: 'receiptJobs', id }, { status: 'done', result });
   return jobs[id];
  }, result);
  await page.goto(base + '/#together?tab=notes'); await page.click('[data-tg=newEntry]'); await page.waitForSelector('[data-tg-form=note]');
  await page.click('[data-note-kind=coupon]'); await page.waitForSelector('[data-tg-form=note][data-kind=coupon]');
  await page.locator('#notePhotoInput').setInputFiles({ name: 'coupon.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /AI 正在讀取相片/.test(document.querySelector('#noteFillInfo').textContent));
  assert.equal(await page.locator('[data-tg-form=note] .ai-progress').count(), 1, 'a progress bar while the AI reads');
  const job = await answer({ kind: 'coupon', title: 'Bic Camera 免稅 10% + 5%', text: '滿 ¥5,000，出示護照', code: 'BIC555', until: '2099-01-31', place: '淺草寺 本堂' });
  assert.equal(job.mode, 'coupon'); assert.equal(job.images.length, 1);
  await page.waitForFunction(() => document.querySelector('[data-tg-form=note] [name=code]').value === 'BIC555');
  await page.waitForFunction(() => !document.querySelector('[data-tg-form=note] .ai-progress'));
  assert.equal(await page.inputValue('[data-tg-form=note] [name=title]'), 'Bic Camera 免稅 10% + 5%');
  assert.equal(await page.inputValue('[data-tg-form=note] [name=until]'), '2099-01-31');
  assert.equal(await page.inputValue('[data-tg-form=note] [name=placeQ]'), '淺草寺（雷門） · 淺草');
  await page.click('[data-note-kind=note]'); await page.waitForSelector('[data-tg-form=note]:not([data-kind])');
  await page.fill('[data-tg-form=note] [name=url]', 'https://example.com/ramen'); await page.locator('[data-tg-form=note] [name=url]').blur();
  await page.waitForFunction(() => /AI 正在讀取網頁/.test(document.querySelector('#noteFillInfo').textContent));
  const job2 = await answer({ kind: 'note', title: '一蘭 上野店', text: '24 小時營業\n天然豚骨拉麵 ¥980', code: '', until: '', place: '' });
  assert.equal(job2.url, 'https://example.com/ramen'); assert.equal(job2.mode, 'note');
  await page.waitForFunction(() => document.querySelector('[data-tg-form=note] [name=text]').value.startsWith('一蘭 上野店\n24 小時營業'));
 });
 await step('delete with undo; ☰ menu', async () => {
  await closeSheet(); await page.goto(base + '/#together?tab=notes'); await page.waitForSelector('.tg-item');
  const n = await page.locator('.tg-list .tg-item').count();
  const delFirst = async () => { await page.locator('.tg-list .tg-item .more summary').first().click(); await page.click('[data-tg-del]:visible'); };
  await delFirst(); await page.waitForSelector('#toast.snack');
  assert.equal(await page.locator('.tg-list .tg-item').count(), n - 1, 'the item disappears at once');
  await page.click('.snack-action'); await page.waitForFunction((n) => document.querySelectorAll('.tg-list .tg-item').length === n, n);
  const stored = () => page.evaluate(() => Object.keys(globalThis.__fakeStore.notes || {}).length);
  const before = await stored();
  await delFirst(); await page.waitForTimeout(500); assert.equal(await stored(), before, 'kept while 復原 is offered');
  await page.waitForFunction(() => !document.querySelector('#toast.snack'), null, { timeout: 8000 });
  await page.waitForFunction((k) => Object.keys(globalThis.__fakeStore.notes || {}).length === k - 1, before);
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.timeline h3');
  const stops = await page.locator('.timeline h3').count();
  await page.locator('[data-stop-more]').first().click(); await page.click('[data-stop-delete]:visible');
  await page.waitForFunction((k) => document.querySelectorAll('.timeline h3').length === k - 1, stops);
  await page.click('.snack-action'); await page.waitForFunction((k) => document.querySelectorAll('.timeline h3').length === k, stops);
  await page.click('#menuBtn'); await page.click('#detail a[href="#flights"]'); await page.waitForSelector('.page-head h1');
  assert.equal(await page.locator('.page-head h1').innerText(), '機票'); assert.equal(await page.locator('#detail[open]').count(), 0);
  assert.equal(await page.locator('.bottomnav a.active').innerText(), '總覽');
 });
 await step('translated names show under the original', async () => {
  // stands in for translateNames: writes zh / zhFor on the item and the place
  const translate = (c, name, zh) => page.evaluate(async ([c, name, zh]) => {
   const fs = await import('./vendor/firebase/firebase-firestore.js'), docs = globalThis.__fakeStore[c] || {};
   const id = Object.keys(docs).find((k) => (docs[k].name || docs[k].fields?.[1]) === name);
   await fs.updateDoc({ c, id }, { zh, zhFor: name });
  }, [c, name, zh]);
  await closeSheet(); await page.goto(base + '/#shopping'); await addShop('じゃがポックル', '新千歳空港');
  await translate('shopping', 'じゃがポックル', '薯條三兄弟');
  await page.waitForFunction(() => /じゃがポックル\s*薯條三兄弟/.test(document.querySelector('.tg-list').innerText));
  await page.fill('#shopSearch', '薯條'); await page.waitForFunction(() => document.querySelectorAll('.shop-item').length === 1);
  await page.fill('#shopSearch', '');
  await translate('places', '仲見世通り', '仲見世商店街');
  await page.goto(base + '/#explore'); await page.waitForSelector('#results .card.place');
  assert.match(await page.locator('#results .card.place', { hasText: '仲見世通り' }).innerText(), /仲見世商店街/);
  await page.fill('#search', '商店街'); await page.waitForTimeout(400);
  assert.equal(await page.locator('#results .card.place').count(), 1);
  await page.fill('#search', '');
 });
 await step('a place keeps its Google Maps link when edited; AI fills 必吃・必買・特色', async () => {
  const link = 'https://maps.app.goo.gl/abc123';
  await closeSheet(); await page.goto(base + '/#explore'); await page.click('[data-place-new]');
  await page.fill('#placeForm [name=mapsUrl]', link); await page.fill('#placeForm [name=f1]', '風雷神門'); await page.fill('#placeForm [name=f0]', '淺草'); await page.locator('#placeForm [name=cats]').nth(1).check();
  await page.fill('#placeForm [name=f2]', '舊類型');
  await page.locator('#placeForm [name=f2] + .field-clear').click(); assert.equal(await page.inputValue('#placeForm [name=f2]'), '', 'the × empties the field');
  await page.click('#placeLookup'); await page.waitForFunction(() => document.querySelector('#placeForm [name=f4]').value);
  assert.equal(await page.inputValue('#placeForm [name=f4]'), '大燈籠必影；仲見世買人形燒；早上 8 時前人少');
  assert.equal(await page.inputValue('#placeForm [name=f1]'), '風雷神門', 'filled fields are kept');
  assert.equal(await page.inputValue('#placeForm [name=f5]'), '價格：免費入場\n時間：24 小時開放');
  assert.equal((await page.evaluate(() => window.lookupRequest)).highlights, true);
  assert.equal((await page.evaluate(() => window.lookupRequest)).photo, true);
  await page.waitForSelector('#placePhotoBox img'); assert.match(await page.locator('#placePhotoBox figcaption').innerText(), /Tester · Google 地圖/);
  // a wrong photo: pick another Google one, or upload one's own
  await page.click('[data-place-photo-pick]'); await page.locator('[data-place-photo-use="1"]').click();
  assert.match(await page.locator('#placePhotoBox figcaption').innerText(), /Pic B · Google 地圖/);
  await page.setInputFiles('[data-place-photo-file]', { name: 'own.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64') });
  await page.waitForFunction(() => /旅伴上載/.test(document.querySelector('#placePhotoBox figcaption')?.innerText || ''));
  await page.click('#placeForm button[type=submit]');
  await page.locator('#results .card.place', { hasText: '風雷神門' }).first().locator('[data-place]').click();
  await page.click('#detail [data-place-edit]'); assert.equal(await page.inputValue('#placeForm [name=mapsUrl]'), link);
  await page.fill('#placeForm [name=f2]', '寺院'); await page.click('#placeForm button[type=submit]');
  const saved = await page.evaluate(() => Object.values(globalThis.__fakeStore.places).find((d) => d.fields[1] === '風雷神門').mapsUrl);
  assert.equal(saved, link);
  assert.equal(await page.locator('#results .card.place', { hasText: '風雷神門' }).first().locator(`a[href="${link}"]`).count(), 1, 'the card map button opens the saved link');
  assert.equal(await page.locator('#results .card.place', { hasText: '風雷神門' }).first().locator('.place-thumb').count(), 1, 'the card shows the place photo');
  await page.locator('#results .card.place', { hasText: '風雷神門' }).first().locator('[data-place]').click();
  assert.match(await page.locator('#detail .info-list').first().innerText(), /網站\s*kaminarimon\.example\.jp[\s\S]*食評及訂座\s*Tabelog/);
  await closeSheet();
 });
 await step('shopping: several 購買地點, AI finds where to buy', async () => {
  await closeSheet(); await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]');
  await page.fill('[data-tg-form=shop] [name=name]', '雷門煎餅'); await page.click('.shop-more summary'); await page.fill('[data-tg-form=shop] [name=place] >> nth=0', '仲見世通り');
  await page.click('[data-tg=shopFindAll]'); await page.waitForFunction(() => /AI 建議/.test(document.querySelector('#shopPlaceInfo').textContent));
  assert.equal(await page.inputValue('[data-tg-form=shop] [name=name]'), '浅草 雷門せんべい', 'the original-language name replaces the typed one');
  assert.match(await page.inputValue('[data-tg-form=shop] [name=reviews]'), /優點：香脆不太甜/);
  assert.equal(await page.inputValue('[data-tg-form=shop] [name=qty]'), '12枚入'); assert.equal(await page.inputValue('[data-tg-form=shop] [name=price]'), '1080');
  assert.equal((await page.evaluate(() => window.buyRequest)).full, true);
  await page.fill('[data-tg-form=shop] [name=name]', '雷門せんべい');
  assert.deepEqual(await page.locator('[data-tg-form=shop] [name=place]').evaluateAll((els) => els.map((e) => e.value)), ['仲見世通り', '淺草寺 本堂', '東京駅 一番街']);
  assert.equal((await page.evaluate(() => window.buyRequest)).name, '雷門煎餅');
  assert.match(await page.locator('#shopPlaceInfo').innerText(), /已用 Google 地圖核實[\s\S]*另有 1 間在 Google 地圖找不到/);
  await page.click('[data-tg=shopPlaceAdd]'); await page.fill('[data-tg-form=shop] [name=place] >> nth=3', '仲見世通り');
  await page.click('[data-tg-form=shop] button[type=submit]'); await page.waitForFunction(() => !document.querySelector('#detail').open);
  const item = page.locator('.shop-item', { hasText: '雷門せんべい' });
  await item.locator('.shop-place:has(.btn-icon)').nth(2).waitFor();
  assert.equal(await item.locator('.shop-place:has(.btn-icon)').count(), 3, 'one line per address, repeats dropped');
  assert.match(await item.innerText(), /探索：[\s\S]*仲見世通り[\s\S]*淺草寺（雷門）/);
  await page.goto(base + '/#explore'); await page.waitForSelector('#results .card.place');
  for (const name of ['仲見世通り', '淺草寺（雷門）']) assert.match(await page.locator('#results .card.place', { hasText: name }).first().locator('.buy-here').innerText(), /雷門せんべい/);
 });
 await step('shopping: an article link lists its products to pick from', async () => {
  await closeSheet(); await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]');
  await page.fill('[data-tg-form=shop] [name=name]', 'https://news.example.com/fukuoka-10'); await page.click('[data-tg=shopFindAll]');
  await page.evaluate(async () => {
   const fs = await import('./vendor/firebase/firebase-firestore.js'), jobs = globalThis.__fakeStore.receiptJobs || {};
   const id = Object.keys(jobs).find((k) => jobs[k].url === 'https://news.example.com/fukuoka-10');
   await fs.updateDoc({ c: 'receiptJobs', id }, { status: 'done', result: { title: '福岡手信10大推介', link: 'https://news.example.com/fukuoka-10', choices: [
    { name: '博多通饅頭（博多通りもん）', qty: '8個入', detail: '牛油奶香饅頭', cat: 'food', place: '博多駅', price: 1200, currency: 'JPY', photo: null },
    { name: '二◯加煎餅', qty: '', detail: '面具形煎餅', cat: 'food', place: '福岡空港', price: null, currency: 'JPY', photo: null },
   ] } });
  });
  await page.waitForSelector('.article-choices'); assert.match(await page.locator('.article-choices').innerText(), /找到 2 件[\s\S]*博多通饅頭[\s\S]*二◯加煎餅/);
  assert.equal(await page.locator('[data-article-add]').isDisabled(), true, 'nothing ticked yet');
  await page.locator('[data-article-pick$=":1"]').check(); await page.click('[data-article-add]');
  await page.waitForFunction(() => !document.querySelector('.article-choices'));
  await page.waitForSelector('.shop-item:has-text("二◯加煎餅")'); assert.equal(await page.locator('.shop-item:has-text("博多通饅頭")').count(), 0);
 });
 await step('the page still scrolls after deleting from a sheet', async () => {
  await closeSheet(); await page.goto(base + '/#explore'); await page.click('[data-place-new]');
  await page.fill('#placeForm [name=f1]', '刪除測試'); await page.fill('#placeForm [name=f0]', '淺草'); await page.locator('#placeForm [name=cats]').first().check();
  await page.click('#placeForm button[type=submit]');
  await page.locator('#results .card.place', { hasText: '刪除測試' }).locator('[data-place]').click();
  await page.click('#detail .more summary'); await page.click('[data-place-delete]:visible'); await page.click('.ui-pop .btn-danger');
  await page.waitForFunction(() => !document.querySelector('#detail').open);
  await page.waitForFunction(() => getComputedStyle(document.body).overflowY !== 'hidden' && !document.querySelector('.swal2-container'));
 });
 await step('plan tools: insert between stops, all transport, AI arrangement, times, drag', async () => {
  for (const name of ['上野公園', '東京國立博物館', '阿美橫丁']) {
   await page.goto(base + '/#explore'); await page.click('[data-place-new]');
   await page.fill('#placeForm [name=f0]', '上野'); await page.fill('#placeForm [name=f1]', name); await page.locator('#placeForm [name=cats]').first().check(); await page.click('#placeForm button[type=submit]');
  }
  await page.goto(base + '/#plan?day=3'); await page.waitForSelector('.journey-day');
  const titles = () => page.locator('.timeline h3').evaluateAll((hs) => hs.map((h) => h.firstChild.textContent.trim()));
  await page.click('[data-plan-pick]');
  for (let k = 0; k < 3; k++) await page.locator('[data-pp-add]').first().click();
  await closeSheet(); await page.waitForFunction(() => document.querySelectorAll('.timeline h3').length === 3);
  assert.equal(await page.locator('.plan-tools button').count(), 4);
  // ✨ AI 推薦 in the picker gives reasons; the ＋ between two stops inserts there
  const before = await titles();
  await page.locator('.stop-link .link-add').nth(1).click(); await page.waitForSelector('#ppList');
  assert.match(await page.locator('#detail .note').first().innerText(), new RegExp(`加在「${before[1]}」之前`));
  await page.click('[data-pp-cat="✨ AI 推薦"]'); await page.waitForSelector('.pp-reason');
  assert.equal((await page.evaluate(() => window.planRequest)).mode, 'suggest');
  await page.locator('#ppList [data-pp-add]').first().click(); await closeSheet();
  await page.waitForFunction(() => document.querySelectorAll('.timeline h3').length === 4);
  const four = await titles(); assert.equal(four[0], before[0]); assert.equal(four[2], before[1]);
  // 查全日交通 fills every leg in one request
  await page.click('[data-plan-routes]'); await page.waitForFunction(() => document.querySelectorAll('.route-dot.has-route').length >= 3);
  assert.match(await page.locator('.route-dot.has-route').last().innerText(), /AI 估算|步行/);
  // AI 安排: preview, then apply (with its warning), then undo
  await page.click('[data-plan-ai]'); await page.fill('#aiPlanForm [name=start]', '08:00'); await page.click('#aiPlanForm button[type=submit]'); await page.waitForSelector('[data-ai-plan-apply]');
  assert.equal((await page.evaluate(() => window.planRequest)).startTime, '08:00', 'the departure time goes to the AI');
  assert.ok(await page.locator('.ai-plan-stop').count() === 4); assert.ok(await page.locator('#aiPlanForm').isHidden());
  await page.click('[data-ai-plan-apply]'); await page.waitForSelector('.timeline .stop-warn');
  assert.deepEqual(await titles(), [...four].reverse()); assert.match(await page.locator('.timeline .time').first().innerText(), /09:00–10:00/);
  await page.click('.snack-action'); await page.waitForFunction((t) => document.querySelector('.timeline h3').firstChild.textContent.trim() === t, four[0]);
  // 推算時間 and dragging the first slot to the end
  await page.click('[data-plan-times]'); await page.waitForFunction(() => /^09:00–\d\d:\d\d/.test(document.querySelector('.timeline .time').innerText));
  // the page re-renders after each save: wait until it settles before measuring
  await page.waitForTimeout(500);
  let grip, last;
  for (let k = 0; k < 10 && !(grip && last); k++) [grip, last] = [await page.locator('.stop-grip').first().boundingBox(), await page.locator('article.stop').last().boundingBox()];
  await page.mouse.move(grip.x + 10, grip.y + 10); await page.mouse.down(); await page.mouse.move(grip.x + 10, last.y + last.height + 40, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction((t) => document.querySelector('.timeline h3').firstChild.textContent.trim() !== t, four[0]);
  assert.equal((await titles()).at(-1), four[0]);
  // a stop's own note (備註) shows on the card
  await page.waitForTimeout(500); await page.locator('[data-stop-more]').first().click(); await page.click('[data-stop-edit]:visible');
  await page.fill('#stopForm [name=note]', '僅收現金'); await page.click('#stopForm button[type=submit]');
  await page.waitForSelector('.timeline .stop-note'); assert.match(await page.locator('.timeline .stop-note').first().innerText(), /僅收現金/);
 });
 await step('方案: a second plan for a day, changed on its own, made the main one, deleted', async () => {
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('.journey-day');
  const titles = () => page.locator('.timeline h3').evaluateAll((hs) => hs.map((h) => h.firstChild.textContent.trim()));
  const main = await titles(); assert.ok(main.length >= 2);
  await page.click('.day-more summary'); await page.click('[data-plan-variant-new]:visible');
  await page.waitForSelector('.ui-pop input'); await page.fill('.ui-pop input', '早一班火車'); await page.click('.ui-pop button:has-text("儲存")');
  await page.waitForSelector('.plan-variants'); assert.deepEqual((await page.locator('.plan-variants .chip').allInnerTexts()).map((t) => t.replace(/\s+/g, '')), ['方案1主要', '早一班火車', '＋']);
  assert.match(await page.locator('.plan-variants .chip.active').innerText(), /早一班火車/);
  // the copy changes alone: delete its last stop, the main one keeps it
  await page.locator('[data-stop-more]').last().click(); await page.click('[data-stop-delete]:visible');
  if (await page.isVisible('.ui-pop')) await page.click('.ui-pop button.btn-danger, .ui-pop button:has-text("刪除")');
  await page.waitForFunction((n) => document.querySelectorAll('.timeline h3').length === n, main.length - 1);
  await page.click('[data-plan-variant="main"]'); assert.deepEqual(await titles(), main, 'the main 方案 is unchanged');
  const doc = await page.evaluate(() => globalThis.__fakeStore.planDays['1']);
  assert.deepEqual([doc.stops.length, doc.variants.length, doc.variants[0].stops.length, doc.mainName], [main.length, 1, main.length - 1, '方案 1']);
  // printing names the 方案 being printed for that day
  await page.locator('.plan-variants .chip', { hasText: '早一班火車' }).click();
  await page.evaluate(() => { window.print = () => {}; }); await page.click('.day-more summary'); await page.click('[data-plan-print]:visible');
  assert.match(await page.locator('#printArea .print-day').first().innerText(), /DAY 1 .*· 早一班火車/);
  await page.evaluate(() => { document.body.classList.remove('printing'); dispatchEvent(new Event('afterprint')); });
  await page.click('[data-plan-variant="main"]');
  // 設為主要: the copy becomes the main one (the overview uses it), the old main one becomes a 方案
  await page.locator('.plan-variants .chip', { hasText: '早一班火車' }).click();
  await page.click('.day-more summary'); await page.click('[data-plan-variant-main]:visible');
  await page.waitForFunction(() => document.querySelector('.plan-variants .chip.active')?.innerText.replace(/\s+/g, '') === '早一班火車主要');
  const after = await page.evaluate(() => globalThis.__fakeStore.planDays['1']);
  assert.deepEqual([after.stops.length, after.mainName, after.variants[0].name, after.variants[0].stops.length], [main.length - 1, '早一班火車', '方案 1', main.length]);
  // back to the old plan as main, then delete the copy
  await page.locator('.plan-variants .chip', { hasText: '方案 1' }).click(); await page.click('.day-more summary'); await page.click('[data-plan-variant-main]:visible');
  await page.locator('.plan-variants .chip', { hasText: '早一班火車' }).click(); await page.click('.day-more summary'); await page.click('[data-plan-variant-del]:visible');
  await page.click('.ui-pop button:has-text("刪除")'); await page.waitForFunction(() => !document.querySelector('.plan-variants'));
  assert.deepEqual(await titles(), main);
 });
 await step('plan picker: every category shows; a 交通 place can be added twice', async () => {
  await page.goto(base + '/#explore'); await page.click('[data-place-new]');
  await page.fill('#placeForm [name=f0]', '上野'); await page.fill('#placeForm [name=f1]', '京成上野駅'); await page.locator('#placeForm [name=cats]').nth(3).check(); await page.click('#placeForm button[type=submit]');
  await page.goto(base + '/#plan?day=5'); await page.waitForSelector('.journey-day'); await page.click('[data-plan-pick]');
  // 區域: only that area's places
  await page.selectOption('#ppArea', '淺草'); await page.waitForTimeout(200);
  assert.ok((await page.locator('#ppList .pp-row small').allInnerTexts()).every((t) => t.startsWith('淺草')), 'only 淺草 places');
  await page.selectOption('#ppArea', '');
  await page.click('[data-pp-cat=交通]');
  const row = page.locator('#ppList .pp-row', { hasText: '京成上野駅' });
  await row.locator('[data-pp-add]').click(); await row.locator('[data-pp-add]').click();
  assert.match(await row.innerText(), /已在這天行程，可再加入/);
  await closeSheet(); await page.waitForFunction(() => [...document.querySelectorAll('.timeline h3')].filter((h) => h.textContent.includes('京成上野駅')).length === 2);
 });
 await step('AI 推薦新地點: from 探索 and from a day of the plan', async () => {
  await page.goto(base + '/#explore'); await page.click('[data-discover]'); await page.fill('#discoverForm [name=area]', '上野');
  await page.click('[data-discover-kind=sight]'); await page.click('[data-discover-pref=kids]'); await page.click('#discoverForm [type=submit]');
  await page.waitForSelector('.discover-card'); assert.equal(await page.locator('.discover-card').count(), 2);
  // 再推薦更多: places not shown yet, added below; the ones shown go to the AI as already seen
  await page.click('[data-discover-more]'); await page.waitForFunction(() => document.querySelectorAll('.discover-card').length === 3);
  const moreReq = await page.evaluate(() => window.discoverRequest); assert.equal(moreReq.more, true); assert.ok(moreReq.have.includes('上野東照宮'));
  const req = await page.evaluate(() => window.discoverRequest); assert.equal(req.area, '上野'); assert.equal(req.kind, 'sight'); assert.deepEqual(req.prefs, ['kids']); assert.ok(req.have.length > 0);
  await page.locator('[data-discover-add]').first().click(); await page.waitForSelector('#placeForm');
  assert.match(await page.inputValue('#placeForm [name=mapsUrl]'), /maps\/search\/\?api=1&query=.*&query_place_id=ChIJtoshogu$/); assert.equal(await page.inputValue('#placeForm [name=f1]'), '上野東照宮');
  assert.equal((await page.evaluate(() => window.lookupRequest)).name, '上野東照宮', '自動填寫 also sends the name for links without one');
  await closeSheet();
  await page.goto(base + '/#plan?day=1'); await page.click('[data-plan-pick]'); await page.click('#detail [data-discover]');
  await page.click('#discoverForm [type=submit]'); await page.waitForSelector('.discover-card');
  const r2 = await page.evaluate(() => window.discoverRequest); assert.ok(Number.isFinite(r2.near?.lat)); assert.ok(r2.weekday);
  // from a day the area can be changed; another area searches there, not near the day's stops
  await page.fill('#discoverForm [name=area]', '銀座'); await page.click('#discoverForm [type=submit]'); await page.waitForSelector('.discover-card');
  const r3 = await page.evaluate(() => window.discoverRequest); assert.equal(r3.area, '銀座'); assert.equal(r3.near, undefined);
  assert.match(await page.locator('.discover-card').first().innerText(), /9時00分～17時30分/, "the day's opening hours");
  assert.match(await page.locator('[data-discover-add]').first().innerText(), /加入 D1/);
  await closeSheet();
 });
 await step('a sheet with an AI progress bar stays open when tapping outside', async () => {
  await page.goto(base + '/#explore'); await page.click('[data-discover]'); await page.waitForSelector('#discoverForm');
  await page.evaluate(() => document.querySelector('#discoverOut').insertAdjacentHTML('beforeend', Kit.progress({ text: '處理中' })));
  await page.mouse.click(10, 10); await page.waitForTimeout(300); assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'kept open while busy');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'Esc kept open while busy');
  await page.evaluate(() => document.querySelector('#discoverOut .ai-progress').remove());
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#detail').open);
  // a form sheet (edit an item) stays open when tapping outside, even with nothing changed
  await page.goto(base + '/#shopping'); await page.evaluate(() => document.querySelector('[data-shop-edit]').click()); await page.waitForSelector('[data-tg-form=shop]'); await page.waitForTimeout(500);
  await page.mouse.click(10, 10); await page.waitForTimeout(400); assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'edit sheet kept open');
  await closeSheet(); await page.waitForFunction(() => !document.querySelector('#detail').open);
  // 加入地點 (a search box, no form) stays open too
  await page.goto(base + '/#plan?day=1'); await page.click('[data-plan-pick]'); await page.waitForSelector('#ppSearch'); await page.waitForTimeout(500);
  await page.mouse.click(10, 10); await page.waitForTimeout(400); assert.ok(await page.evaluate(() => document.querySelector('#detail').open), 'picker kept open');
  await closeSheet(); await page.waitForFunction(() => !document.querySelector('#detail').open);
  // unsaved typing: Esc (or the back gesture) asks first
  await page.goto(base + '/#shopping'); await page.click('[data-tg=shopAdd]'); await page.fill('[data-tg-form=shop] [name=name]', '草莓大福'); await page.waitForTimeout(300);
  // Esc once the sheet has finished opening (again if the first one came during its animation)
  const tapOutside = async () => { for (let k = 0; k < 3 && !(await page.locator('.ui-pop').isVisible()); k++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } };
  await tapOutside(); assert.match(await page.locator('.ui-pop').innerText(), /放棄未儲存的內容/);
  await page.click('.ui-pop button:has-text("繼續編輯")'); await page.waitForSelector('.swal2-container', { state: 'detached' });
  assert.equal(await page.inputValue('[data-tg-form=shop] [name=name]'), '草莓大福');
  await tapOutside(); await page.click('.ui-pop button:has-text("放棄")'); await page.waitForFunction(() => !document.querySelector('#detail').open);
 });
 await step('plan: swap two days; move a stop to another day', async () => {
  await page.goto(base + '/#plan?day=3'); await page.waitForSelector('.timeline h3');
  const names = () => page.locator('.timeline h3').evaluateAll((hs) => hs.map((h) => h.firstChild.textContent.trim()));
  const d3 = await names();
  await page.click('[data-day="2"]'); await page.waitForTimeout(400); const d2 = await names(); await page.click('[data-day="3"]'); await page.waitForTimeout(400);
  await page.click('.day-more summary'); await page.click('[data-day-swap]:visible'); await page.click('[data-day-pick="2"]');
  const showing = (want) => page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('.timeline h3')].map((h) => h.firstChild.textContent.trim())) === w, JSON.stringify(want), { timeout: 8000 });
  await showing(d2); // D2's stops are now on D3
  await page.click('[data-day="2"]'); await showing(d3); // and D3's on D2
  // move the first stop of D2 to D3
  await page.locator('[data-stop-more]').first().click(); await page.click('[data-stop-to-day]:visible'); await page.click('[data-day-pick="3"]');
  await page.waitForFunction((n) => document.querySelectorAll('.timeline h3').length === n - 1, d3.length);
  await page.click('[data-day="3"]'); await page.waitForTimeout(400); assert.ok((await names()).includes(d3[0]), 'the stop is on D3');
 });
 assert.deepEqual(errors, [], 'page errors');
 console.log('Browser smoke test passed.');
} finally { await browser.close(); server.close(); }
