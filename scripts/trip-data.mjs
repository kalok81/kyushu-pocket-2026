// Upload or download the private trip data kept in Firestore (trip/data, trip/geo, trip/content).
// Uses your own Google login: run `gcloud auth login` first. Keep the JSON file out of this repository.
//   node scripts/trip-data.mjs check    private/trip.json
//   node scripts/trip-data.mjs upload   private/trip.json
//   node scripts/trip-data.mjs download private/trip.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const PROJECT = 'kyushu-2e307', DOCS = ['data', 'geo', 'content'];
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/trip/`;
const [mode, file] = process.argv.slice(2);
if (!['check', 'upload', 'download'].includes(mode) || !file) {
 console.error('Usage: node scripts/trip-data.mjs check|upload|download <file.json>');process.exit(1);
}

function check(trip) {
 const { data, geo, content } = trip;
 assert(data && Array.isArray(data.tabs), 'Invalid travel data');
 const flights = data.tabs.find(t => t.id === 0);
 assert(flights, 'Missing flight information');
 const publicRows = new Set([2, 7, 8, 9, 10]);
 for (const row of flights.rows) if (!publicRows.has(row.row)) assert(!row.cells.some(c => c.text || c.note || c.url), 'Passenger and booking fields must not be uploaded');
 assert(data.baggage?.length === 2, 'Missing anonymous baggage summary');
 for (const [id, points] of Object.entries(geo?.places || {})) {
  assert(/^p\d+$/.test(id) && points.length, 'Invalid place coordinates');
  for (const p of points) assert(Number.isFinite(p.lat) && p.lat > 32 && p.lat < 34.3 && Number.isFinite(p.lng) && p.lng > 129 && p.lng < 132 && /^https?:\/\//.test(p.source), 'Invalid coordinate or source');
 }
 assert(content?.base?.title && Array.isArray(content.hotels) && content.hotels.length && content.suggestions, 'Missing page content');
 for (const h of content.hotels) assert(h.title?.length && h.target && /^https:\/\//.test(h.site) && h.notebook?.title, 'Invalid hotel entry');
 for (const g of content.gifts || []) assert(g.name && /^p\d+$/.test(g.placeId) && (g.price === null || Number.isFinite(g.price)), 'Invalid souvenir entry');
 for (const a of content.areas || []) assert(a.region && a.name && Number.isFinite(a.lat) && Number.isFinite(a.lng) && typeof a.kw === 'string', 'Invalid sub-area');
 for (const [day, stops] of Object.entries(content.suggestions)) assert(/^[1-7]$/.test(day) && stops.every(s => s.time && s.title), 'Invalid suggested itinerary');
 for (const id of DOCS) assert(Buffer.byteLength(JSON.stringify(trip[id])) < 1_000_000, `trip/${id} is over the Firestore document limit`);
}

function headers() {
 const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
 return { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };
}

if (mode === 'download') {
 const h = headers(), trip = {};
 for (const id of DOCS) {
  const res = await fetch(base + id, { headers: h });
  if (!res.ok) throw new Error(`Download trip/${id} failed: ${res.status} ${await res.text()}`);
  trip[id] = JSON.parse((await res.json()).fields.json.stringValue);
 }
 writeFileSync(file, JSON.stringify(trip, null, 1));
 console.log(`Saved trip data to ${file}`);
} else {
 const trip = JSON.parse(readFileSync(file, 'utf8'));
 check(trip);
 console.log('Trip data checks passed.');
 if (mode === 'upload') {
  const h = headers();
  for (const id of DOCS) {
   const body = { fields: { json: { stringValue: JSON.stringify(trip[id]) }, updated: { timestampValue: new Date().toISOString() } } };
   const res = await fetch(base + id, { method: 'PATCH', headers: h, body: JSON.stringify(body) });
   if (!res.ok) throw new Error(`Upload trip/${id} failed: ${res.status} ${await res.text()}`);
   console.log(`Uploaded trip/${id}`);
  }
 }
}
