// Firestore and Storage rules against the emulators (run with `npm test` here, which starts them).
// Amy and Bob are companions of trip t1; Eve is signed in but on no trip.
import { readFileSync } from 'node:fs';
import { test, after, before } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs, query, where, setLogLevel } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

setLogLevel('silent'); // expected denials would otherwise be logged as errors
const root = new URL('../../', import.meta.url);
const env = await initializeTestEnvironment({
 projectId: 'demo-pocket',
 firestore: { rules: readFileSync(new URL('firestore.rules', root), 'utf8') },
 storage: { rules: readFileSync(new URL('storage.rules', root), 'utf8') },
});
const user = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true });
const amy = user('amy', 'amy@kyushu-trip.invalid'), bob = user('bob', 'Bob@Example.com'), eve = user('eve', 'eve@example.com');
const db = (c) => c.firestore(), st = (c) => c.storage();
const owned = (uid, name) => ({ by: uid, byName: name, at: Date.now(), createdAt: serverTimestamp() });
const T = 'trips/t1';

before(async () => {
 await env.withSecurityRulesDisabled(async (c) => {
  const f = c.firestore();
  await setDoc(doc(f, 'config/members'), { emails: ['amy@kyushu-trip.invalid', 'bob@example.com', 'eve@example.com'] });
  await setDoc(doc(f, T), { name: 'Test', members: ['amy@kyushu-trip.invalid', 'bob@example.com'] });
  await setDoc(doc(f, 'trips/t2'), { name: 'Other', members: ['eve@example.com'] });
  await setDoc(doc(f, `${T}/receiptJobs/j1`), { by: 'amy', status: 'pending', file: 'a.jpg', image: 'x', at: 1 });
  await setDoc(doc(f, `${T}/expenses/e1`), { title: '晚餐', amount: 100, currency: 'JPY', paidBy: 'amy', split: ['amy'], day: 1, by: 'amy', byName: 'Amy', at: 1 });
  await setDoc(doc(f, `${T}/checklist/c1`), { text: '護照', group: 'pack', doneBy: [], by: 'amy', byName: 'Amy', at: 1 });
  await setDoc(doc(f, 'usage/amy_2030-01-01'), { maps: 1 });
 });
});
after(() => env.cleanup());

test('config, usage and trip documents are closed to the site', async () => {
 await assertFails(getDoc(doc(db(amy), 'config/members')));
 await assertFails(getDoc(doc(db(amy), 'usage/amy_2030-01-01')));
 await assertFails(setDoc(doc(db(amy), 'usage/amy_2030-01-01'), { maps: 0 }));
 await assertSucceeds(getDoc(doc(db(amy), T)));
 await assertFails(getDoc(doc(db(eve), T)));
 await assertFails(updateDoc(doc(db(amy), T), { name: 'x' }));
 await assertFails(getDoc(doc(db(env.unauthenticatedContext()), T)));
});

test('companions find their own trips only', async () => {
 await assertSucceeds(getDocs(query(collection(db(bob), 'trips'), where('members', 'array-contains', 'bob@example.com'))));
 await assertFails(getDocs(collection(db(bob), 'trips')));
});

test('places: companions add valid places', async () => {
 const place = { base: null, fields: Array(12).fill(''), cats: ['餐廳'], lat: 1, lng: 2, points: [], mapsUrl: '', deleted: false };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/places/p1`), { ...place, ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(eve), `${T}/places/p2`), { ...place, ...owned('eve', 'Eve') }));
 await assertFails(setDoc(doc(db(amy), `${T}/places/p3`), { ...place, fields: ['only one'], ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/places/p4`), { ...place, ...owned('bob', 'Bob') }));
});

test('shopping: valid items, explore place link, shared updates', async () => {
 const item = { name: '人形燒', qty: '', detail: '', place: '仲見世', placeId: 'u_p1', price: 800, currency: 'JPY', photo: null, bought: false, boughtBy: null, boughtAt: null };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/shopping/s1`), { ...item, ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/shopping/s2`), { ...item, currency: 'XXX', ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/shopping/s3`), { ...item, placeId: 'x'.repeat(41), ...owned('amy', 'Amy') }));
 await assertSucceeds(setDoc(doc(db(amy), `${T}/shopping/s4`), { ...item, cat: 'drug', ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/shopping/s5`), { ...item, cat: 'weapons', ...owned('amy', 'Amy') }));
 await assertSucceeds(updateDoc(doc(db(bob), `${T}/shopping/s1`), { bought: true, boughtBy: 'Bob', boughtAt: 2 }));
 await assertFails(updateDoc(doc(db(bob), `${T}/shopping/s1`), { by: 'bob' }));
});

test('expenses: only the category can change afterwards', async () => {
 await assertSucceeds(updateDoc(doc(db(bob), `${T}/expenses/e1`), { category: 'food' }));
 await assertFails(updateDoc(doc(db(bob), `${T}/expenses/e1`), { category: 'snacks' }));
 await assertFails(updateDoc(doc(db(bob), `${T}/expenses/e1`), { amount: 1 }));
 const e = { title: '巴士', amount: 210, currency: 'JPY', paidBy: 'amy', split: ['amy', 'bob'], day: 2, category: 'transport' };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/expenses/e2`), { ...e, ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/expenses/e3`), { ...e, day: 61, ...owned('amy', 'Amy') }));
});

test('checklist ticks, exchange rates, day plans', async () => {
 await assertSucceeds(updateDoc(doc(db(bob), `${T}/checklist/c1`), { doneBy: ['bob'] }));
 await assertFails(updateDoc(doc(db(bob), `${T}/checklist/c1`), { by: 'bob' }));
 await assertSucceeds(setDoc(doc(db(amy), `${T}/settings/fx`), { rates: { JPY: 0.05 }, by: 'amy', byName: 'Amy', at: 1 }));
 await assertFails(setDoc(doc(db(amy), `${T}/settings/other`), { rates: {}, by: 'amy', byName: 'Amy', at: 1 }));
 await assertSucceeds(setDoc(doc(db(amy), `${T}/planDays/3`), { stops: [{ title: '淺草寺' }], label: '淺草', by: 'amy', byName: 'Amy', at: 1 }));
 await assertFails(setDoc(doc(db(amy), `${T}/planDays/61`), { stops: [], by: 'amy', byName: 'Amy', at: 1 }));
 await assertFails(setDoc(doc(db(eve), `${T}/planDays/4`), { stops: [], by: 'eve', byName: 'Eve', at: 1 }));
});

test('product links can be sent as jobs', async () => {
 const job = { kind: 'product', file: 'shop.example.jp', status: 'pending', ...owned('amy', 'Amy') };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/receiptJobs/l1`), { ...job, url: 'https://shop.example.jp/item' }));
 await assertFails(setDoc(doc(db(amy), `${T}/receiptJobs/l2`), { ...job, url: 'file:///etc/passwd' }));
 await assertFails(setDoc(doc(db(amy), `${T}/receiptJobs/l3`), { ...job, kind: 'receipt', url: 'https://shop.example.jp' }));
});
test('receipt jobs are private to whoever sent them', async () => {
 await assertSucceeds(getDoc(doc(db(amy), `${T}/receiptJobs/j1`)));
 await assertFails(getDoc(doc(db(bob), `${T}/receiptJobs/j1`)));
});

test('storage: booking documents for the trip only, receipts under your own id', async () => {
 const pdf = new Uint8Array([37, 80, 68, 70]), jpg = new Uint8Array([255, 216, 255]);
 await assertSucceeds(uploadBytes(ref(st(amy), 'trips/t1/docs/hotels-h1-1.pdf'), pdf, { contentType: 'application/pdf' }));
 await assertSucceeds(getBytes(ref(st(bob), 'trips/t1/docs/hotels-h1-1.pdf')));
 await assertFails(getBytes(ref(st(eve), 'trips/t1/docs/hotels-h1-1.pdf')));
 await assertFails(uploadBytes(ref(st(amy), 'trips/t1/docs/x.html'), pdf, { contentType: 'text/html' }));
 await assertSucceeds(uploadBytes(ref(st(amy), 'receipts/amy/j1-0.jpg'), jpg, { contentType: 'image/jpeg' }));
 await assertFails(uploadBytes(ref(st(amy), 'receipts/bob/j1-0.jpg'), jpg, { contentType: 'image/jpeg' }));
});

test('notes with photos and links; coupons can only be marked used afterwards', async () => {
 const note = { text: '集合', day: 1, placeId: 'u_' + 'x'.repeat(20), placeName: '淺草寺', url: 'https://example.com', photos: ['abc'] };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/notes/n1`), { ...note, ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/notes/n2`), { ...note, url: 'javascript:alert(1)', ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/notes/n3`), { ...note, photos: ['a', 'b', 'c', 'd'], ...owned('amy', 'Amy') }));
 await assertFails(updateDoc(doc(db(bob), `${T}/notes/n1`), { text: 'changed' }));
 const coupon = { kind: 'coupon', title: 'Bic Camera', text: '', code: 'BIC', until: '2099-12-31', used: false, day: null, placeId: null, placeName: null };
 await assertSucceeds(setDoc(doc(db(amy), `${T}/notes/c1`), { ...coupon, ...owned('amy', 'Amy') }));
 await assertFails(setDoc(doc(db(amy), `${T}/notes/c2`), { ...coupon, title: '', ...owned('amy', 'Amy') }));
 await assertSucceeds(updateDoc(doc(db(bob), `${T}/notes/c1`), { used: true, usedBy: 'Bob', usedAt: 1 }));
 await assertFails(updateDoc(doc(db(bob), `${T}/notes/c1`), { code: 'FREE' }));
});
