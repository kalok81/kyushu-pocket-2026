// Fictional trip with lots of (long) sample data for the layout check: tests/fake/firebase-firestore.js with a filled store.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./fake/firebase-firestore.js', import.meta.url), 'utf8');
const by = { by: 'u1', byName: 'Amy', at: 1, createdAt: 'ts' };
const f12 = (area, name, type, addr, feat, price, cat, url = '', note = '') => [area, name, type, addr, feat, price, cat, '旅伴新增', '', '2026-10-22｜旅伴新增', url, note];
const P = (id, cats, fields, lat, lng) => [id, { base: null, fields, cats, lat, lng, points: [], mapsUrl: 'https://maps.google.com/?cid=' + id, deleted: false, ...by }];
const places = Object.fromEntries([
 P('p1', ['景點'], f12('淺草', '淺草寺（金龍山浅草寺）雷門・仲見世通り商店街', '寺院', '東京都台東区浅草2丁目3−1', '雷門大燈籠、五重塔、仲見世百多間小店，人形燒、炸饅頭', '免費；本堂 06:00–17:00（10月–3月 06:30 開）', '景點', 'https://www.senso-ji.jp/about/index.html https://www.youtube.com/watch?v=abcdefghijk', '早上 8 時前人少'), 35.7148, 139.7967),
 P('p2', ['餐廳'], f12('上野', '一蘭 上野店', '拉麵', '東京都台東区上野7-1-1 アトレ上野 1F', '天然豚骨拉麵，個人座位', '¥980–1,500；24 小時', '餐廳'), 35.7138, 139.7773),
 P('p3', ['商店', '手信'], f12('銀座', 'GINZA SIX ギンザシックス（Supercalifragilisticexpialidocious long name test store）', '百貨', '東京都中央区銀座6丁目10−1', '手信、限定甜品', '10:30–20:30', '商店', 'https://ginza6.tokyo/aVeryLongUrlWithoutAnyBreaksToCheckWrappingBehaviourInCards1234567890'), 35.6697, 139.7641),
 P('p4', ['餐廳'], f12('新宿', '思い出横丁', '居酒屋', '東京都新宿区西新宿1丁目2', '烤雞串', '¥2,000–4,000', '餐廳'), 35.6930, 139.6995),
 P('p5', ['景點'], f12('澀谷', 'SHIBUYA SKY 澀谷天空', '展望台', '東京都渋谷区渋谷2-24-12 渋谷スクランブルスクエア 屋上', '360 度夜景', '¥2,500；10:00–22:30', '景點'), 35.6585, 139.7022),
 P('p6', ['商店'], f12('秋葉原', 'ヨドバシカメラ マルチメディアAkiba', '電器', '東京都千代田区神田花岡町1-1', '相機、遊戲', '09:30–22:00', '商店'), 35.6987, 139.7745),
]);
const stop = (time, area, title, detail, transport = '', extra = {}) => ({ time, area, title, detail, transport, ref: '', target: title, placeId: '', ...extra });
const planDays = {
 1: { stops: [
  stop('08:00', '住宿', '上野 Hotel Sunroute Ueno（サンルート上野）', '東京都台東区東上野3-9-3', '', { hotelId: 'h1' }),
  stop('09:00–11:30', '淺草', '淺草寺（金龍山浅草寺）雷門・仲見世通り商店街', '雷門大燈籠、五重塔、仲見世', '🚶 2 分 → 🚇 東京Metro銀座線 上野 → 淺草（3 站，09:07–09:12） → 🚶 5 分｜約 14 分 · ¥180', { placeId: 'u_p1' }),
  stop('12:00–13:00', '上野', '一蘭 上野店', '天然豚骨拉麵', 'JR＋西鐵（最快較穩）：🚶 步行 5 分 → 🚆 JR山手線（外回り） 上野 → 秋葉原（約 4 分） → 🚶 步行 6 分｜約 15 分 · ¥150（AI 估算）', { placeId: 'u_p2' }),
  stop('12:00–13:00', '秋葉原', 'ヨドバシカメラ マルチメディアAkiba 8F レストラン街', '午餐另一選擇', '', { placeId: 'u_p6' }),
  stop('12:00–13:00', '上野', '阿美橫丁小食街', '午餐第三選擇：海鮮丼、串燒', ''),
  stop('14:00–18:00', '銀座', 'GINZA SIX ギンザシックス（Supercalifragilisticexpialidocious long name test store）', '手信、限定甜品', '', { placeId: 'u_p3' }),
  stop('19:00', '新宿', '思い出横丁', '晚餐', '', { placeId: 'u_p4' }),
 ], label: '淺草・上野・銀座・新宿一日遊（很長的標題測試）', by: 'u1', byName: 'Amy', at: 1 },
 2: { stops: [stop('10:00', '澀谷', 'SHIBUYA SKY 澀谷天空', '360 度夜景', '', { placeId: 'u_p5' })], by: 'u1', byName: 'Amy', at: 1 },
};
const hotels = {
 h1: { name: '上野 Hotel Sunroute Ueno（サンルート上野）', address: '東京都台東区東上野3-9-3', checkIn: '2030-04-01', checkOut: '2030-04-03', mapsUrl: 'https://maps.google.com/?cid=1', lat: 35.7105, lng: 139.7797, note: '含早餐；行李可寄存至 23:00；訂單編號請看電郵', ...by },
 h2: { name: 'Hotel Gracery Shinjuku ホテルグレイスリー新宿（Godzilla View Room）', address: '東京都新宿区歌舞伎町1-19-1 新宿東宝ビル', checkIn: '2030-04-03', checkOut: '2030-04-05', mapsUrl: '', lat: 35.6951, lng: 139.7020, note: '', docs: [{ path: 'x', name: 'booking-confirmation-gracery-shinjuku-2030-very-long-filename.pdf', type: 'application/pdf', size: 123456, by: 'u1', byName: 'Amy', at: 1 }], ...by },
};
const flights = {
 f1: { flightNo: 'CX 520', airline: '國泰航空 Cathay Pacific', from: 'HKG 香港國際機場 T1', to: 'HND 羽田機場 T3', depart: '2030-04-01T08:15', arrive: '2030-04-01T13:20', note: '行李 2 件 × 23kg；網上 check-in 出發前 48 小時開始', ...by },
 f2: { flightNo: 'UO 623', airline: 'HK Express', from: 'NRT T2', to: 'HKG', depart: '2030-04-05T21:40', arrive: '2030-04-06T01:30', note: '', ...by },
};
const expenses = {
 e1: { title: '一蘭 上野店 晚餐（三人）', amount: 4440, currency: 'JPY', paidBy: 'u1', split: ['u1', 'u2', 'u3'], day: 1, category: 'food', items: [{ name: '天然豚骨拉麵 ×3', amount: 2940 }, { name: '替玉 ×3', amount: 630 }, { name: '半熟鹽味蛋 ×3', amount: 420 }, { name: '生啤 Asahi Super Dry 中杯', amount: 450 }], ...by, at: 5 },
 e2: { title: 'Suica 增值', amount: 3000, currency: 'JPY', paidBy: 'u2', split: ['u2'], day: 1, category: 'transport', ...by, at: 4 },
 e3: { title: 'GINZA SIX 手信（Supercalifragilisticexpialidocious 限定甜品禮盒十二件裝）', amount: 12800, currency: 'JPY', paidBy: 'u3', split: ['u1', 'u3'], day: 2, category: 'shopping', ...by, at: 3 },
 e4: { title: '機場快線', amount: 115, currency: 'HKD', paidBy: 'u1', split: ['u1', 'u2', 'u3'], day: 1, ...by, at: 2 },
 e5: { title: '酒店', amount: 98000, currency: 'JPY', paidBy: 'u1', split: ['u1', 'u2', 'u3'], day: 3, category: 'stay', ...by, at: 1 },
};
const shopping = {
 s1: { name: '東京ばな奈「見ぃつけたっ」黑糖味 8 個入', qty: '2 盒', detail: '東京車站限定口味；保質期約 7 天', place: '東京駅 一番街 東京おかしランド', price: 1200, currency: 'JPY', photo: null, bought: false, boughtBy: null, boughtAt: null, ...by, at: 3 },
 s2: { name: 'Supercalifragilisticexpialidocious-extra-long-product-name-without-spaces-0123456789', qty: '', detail: '', place: '', price: null, currency: 'JPY', photo: null, bought: false, boughtBy: null, boughtAt: null, ...by, at: 2 },
 s3: { name: '白い恋人', qty: '12 枚', detail: '', place: '新千歳空港', price: 1188, currency: 'JPY', photo: null, bought: true, boughtBy: 'Bob', boughtAt: 1, ...by, at: 1 },
};
const checklist = { c1: { text: '護照（有效期最少 6 個月，請檢查簽證要求及入境登記 Visit Japan Web）', group: 'pre', doneBy: ['u2'], ...by }, c2: { text: '尿袋', group: 'pack', doneBy: [], ...by } };
const notes = { c1: { kind: 'coupon', title: 'Bic Camera ビックカメラ 免稅 10% + 5%（Supercalifragilisticexpialidocious 長名稱測試）', text: '滿 ¥5,000 用 https://www.biccamera.com/bc/c/info/coupon/very/long/link/for/testing', code: 'BICCAMERA2030SPRINGLONGCODE', until: '2030-04-03', used: false, url: 'https://www.biccamera.com', day: null, placeId: null, placeName: null, ...by }, n1: { text: '別府那天記得帶毛巾。\n第二行：AVeryLongWordWithoutSpacesToCheckWrappingInsideNotesCards_ABCDEFGHIJKLMNOPQRSTUVWXYZ', day: 1, placeId: null, placeName: null, ...by } };
const members = { u1: { name: 'Amy', email: 'amy@kyushu-trip.invalid', at: 1 }, u2: { name: 'Bob Chan Tai Man', email: 'bob@example.com', at: 1 }, u3: { name: '陳大文（Cathy）', email: 'c@example.com', at: 1 } };
const seed = { places, planDays, hotels, flights, expenses, shopping, checklist, notes, members };
let out = src.replace("const store={},ls=[];", `const store=${JSON.stringify(seed)},ls=[];`);
out = out.replace("name:'測試旅程',destination:'日本東京'", "name:'2030 東京櫻花七日遊（很長很長的旅程名稱測試）',destination:'日本東京'").replace("endDate:'2030-04-03'", "endDate:'2030-04-05'");
out = out.replace("members:['amy@kyushu-trip.invalid']}", "members:['amy@kyushu-trip.invalid','bob@example.com','c@example.com'],areas:[{name:'淺草',lat:35.7148,lng:139.7967},{name:'上野',lat:35.7138,lng:139.7773},{name:'銀座',lat:35.6717,lng:139.765},{name:'新宿',lat:35.6909,lng:139.7003},{name:'澀谷',lat:35.658,lng:139.7016},{name:'秋葉原',lat:35.6984,lng:139.7731}]}");
export default out;
