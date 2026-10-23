import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
// The public site is only a shell: trip details live in Firestore. Only these files may be published.
const allowed = new Set(['.nojekyll','index.html','app.js','style.css','design.css','nearby.js','weather.js','map-picker.js','split.js','together.js','kit.js','vendor/firebase/firebase-app.js','vendor/firebase/firebase-auth.js','vendor/firebase/firebase-firestore.js','vendor/firebase/firebase-functions.js','vendor/firebase/firebase-storage.js','vendor/firebase/firebase-app-check.js','vendor/firebase/LICENSE','vendor/heic2any/heic2any.min.js','vendor/sweetalert2/sweetalert2.all.min.js','vendor/sweetalert2/LICENSE','ui.js','vendor/heic2any/LICENSE','vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css','vendor/leaflet/LICENSE']);
const published = readdirSync('dist', { recursive: true, withFileTypes: true }).filter(f => f.isFile()).map(f => (f.parentPath + '/' + f.name).replace(/^dist\//, ''));
for (const f of published) assert(allowed.has(f), `Unexpected file in dist: ${f} (trip data must go to Firestore, not the public site)`);
for (const f of allowed) assert(published.includes(f), `Missing website asset: ${f}`);
for (const f of ['kit.js','app.js','weather.js','map-picker.js','together.js','split.js','nearby.js','ui.js']) execFileSync(process.execPath, ['--check', 'dist/' + f]);
for (const f of ['index.html','app.js','together.js']) {
 const s = readFileSync('dist/' + f, 'utf8');
 assert(!/spreadsheets\/d\/|TRIP_DATA\s*=|\bUO\d{3}\b/.test(s), `Trip details found in dist/${f}`);
}
for (const f of ['auth','firestore','app-check']) {
 const js = readFileSync(`dist/vendor/firebase/firebase-${f}.js`, 'utf8');
 assert(js.includes('from"./firebase-app.js"') && !js.includes('gstatic.com/firebasejs'), 'Firebase modules must import the local copy');
}
execFileSync(process.execPath, ['scripts/build.mjs', '--check'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/test-nearby.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/test-split.mjs'], { stdio: 'inherit' });
console.log('Website shell, privacy and syntax checks passed.');
