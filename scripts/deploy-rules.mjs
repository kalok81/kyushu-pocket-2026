// Releases firestore.rules and storage.rules to the project with the gcloud login (yours, or the GitHub Actions
// deploy account): creates a ruleset from each file and points the live release at it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const P = 'kyushu-2e307';
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
// A personal gcloud login needs the project named for quota; the deploy service account belongs to it already.
const H = { Authorization: `Bearer ${token}`, ...(process.env.CI ? {} : { 'x-goog-user-project': P }), 'Content-Type': 'application/json' };
const api = `https://firebaserules.googleapis.com/v1/projects/${P}`;

async function call(url, method, body) {
 const res = await fetch(url, { method, headers: H, body: JSON.stringify(body) });
 if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 800)}`);
 return res.json();
}
for (const [file, release] of [['firestore.rules', 'cloud.firestore'], ['storage.rules', `firebase.storage/${P}.firebasestorage.app`]]) {
 const ruleset = await call(`${api}/rulesets`, 'POST', { source: { files: [{ name: file, content: readFileSync(file, 'utf8') }] } });
 await call(`${api}/releases/${release}`, 'PATCH', { release: { name: `projects/${P}/releases/${release}`, rulesetName: ruleset.name } });
 console.log(`Released ${file} → ${release}`);
}
