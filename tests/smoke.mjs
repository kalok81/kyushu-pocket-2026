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
  await page.goto(base + '/#plan?day=1'); await page.waitForSelector('[data-stop-new]');
  await page.click('[data-stop-new]'); await page.fill('#detail form [name=time]', '10:00'); await page.fill('#detail form [name=title]', '淺草寺'); await page.click('#detail form button[type=submit]');
  await page.waitForSelector('.timeline h3'); assert.deepEqual(await page.locator('.timeline h3').allInnerTexts(), ['淺草寺']);
  await page.waitForSelector('.dayintro .weather:not([hidden])'); assert.match(await page.locator('.dayintro .weather').innerText(), /18°C · 降雨機會 80%/);
  await page.evaluate(() => { window.print = () => { window.printed = true; }; }); await page.click('[data-plan-print]');
  assert(await page.evaluate(() => window.printed)); assert.match(await page.locator('#printArea').innerText(), /DAY 1[\s\S]*淺草寺/);
 });
 await step('expenses: home-currency stats and settlement', async () => {
  await page.goto(base + '/#together?tab=expenses'); await page.waitForSelector('[data-tg-form=expense]');
  const f = '[data-tg-form=expense] ';
  await page.fill(f + '[name=title]', '晚餐'); await page.fill(f + '[name=amount]', '4000'); await page.selectOption(f + '[name=category]', 'food'); await page.click(f + 'button[type=submit]');
  await page.waitForSelector('.tg-total'); await page.waitForFunction(() => document.querySelector('.tg-total b')?.textContent === 'HK$200.00');
  assert.equal(await page.locator('.tg-conv').innerText(), '≈ HK$200.00');
  assert.match(await page.locator('.tg-stats').innerText(), /🍜 餐飲/);
 });
 await step('checklist: suggestions and ticks', async () => {
  await page.goto(base + '/#together?tab=checklist'); await page.click('.tg-list [data-tg=checkSuggest]');
  await page.waitForSelector('.check-row'); await page.locator('[data-check]').first().check();
  await page.waitForFunction(() => /你已完成 1／/.test(document.querySelector('.check-progress')?.textContent || ''));
 });
 await step('hotels: add, confirm popup, delete', async () => {
  await page.goto(base + '/#hotels'); await page.click('[data-hotel-new]'); await page.fill('#hotelForm [name=name]', '測試酒店'); await page.click('#hotelForm button[type=submit]');
  await page.waitForSelector('.card.hotel'); await page.click('[data-hotel-del]'); await page.waitForSelector('.ui-pop');
  await page.click('.ui-pop .action'); await page.waitForTimeout(300); assert.equal(await page.locator('.card.hotel').count(), 1, 'cancel keeps the hotel');
  await page.click('[data-hotel-del]'); await page.waitForSelector('.ui-pop'); await page.click('.ui-pop .locate-button');
  await page.waitForFunction(() => !document.querySelector('.card.hotel'));
 });
 await step('plan: add a hotel from 住宿 as a stop', async () => {
  await page.goto(base + '/#hotels'); await page.click('[data-hotel-new]'); await page.fill('#hotelForm [name=name]', '上野酒店'); await page.fill('#hotelForm [name=address]', '東京都台東區上野1-1');
  await page.click('#hotelForm button[type=submit]'); await page.waitForSelector('.card.hotel');
  await page.goto(base + '/#plan?day=2'); await page.waitForSelector('[data-plan-pick]'); await page.click('[data-plan-pick]');
  await page.click('[data-pp-cat=住宿]'); await page.waitForSelector('[data-pp-hotel]');
  await page.fill('#ppTime', '21:00'); await page.click('[data-pp-hotel]'); await page.waitForSelector('#ppList .badge');
  await page.keyboard.press('Escape'); await page.waitForSelector('.timeline h3');
  assert.deepEqual(await page.locator('.timeline h3').allInnerTexts(), ['上野酒店']);
  assert.equal(await page.locator('.timeline .stop a[href="#hotels"]').count(), 1);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/plan-hotel.png' });
 });
 assert.deepEqual(errors, [], 'page errors');
 console.log('Browser smoke test passed.');
} finally { await browser.close(); server.close(); }
