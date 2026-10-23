// Builds dist/kit.js, dist/app.js and dist/together.js from the feature files in src/ui, src/app and src/together: the files are joined in
// file-name order inside one function each, so they share its variables (no modules or bundler needed).
// Run after editing src/: `node scripts/build.mjs`. `--check` only reports whether dist is up to date (used by validate).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const bundles = [
 {
  out: 'dist/kit.js',
  dir: 'src/ui',
  head: '"use strict";\n// Shared UI building blocks (icons, buttons, chips, menus, sheets, undo bar) used by app.js and together.js.\n// Generated from src/ui/*.js by scripts/build.mjs — edit those files, not this one.\nwindow.Kit = (() => {\n',
  tail: '})();\n',
 },
 {
  out: 'dist/app.js',
  dir: 'src/app',
  head: '"use strict";\n// One trip (trips/{id} in Firestore): days come from its dates; places, plan, hotels and flights come from Together.\n// Generated from src/app/*.js by scripts/build.mjs — edit those files, not this one.\nwindow.startTrip = (meta = {}) => {\n',
  tail: '};\n',
 },
 {
  out: 'dist/together.js',
  dir: 'src/together',
  head: '"use strict";\n// Sign-in gate, trip choice, trip data, shared notes/expenses/shopping list, plan edits and favourites (Firebase).\n// Each trip lives under trips/{tripId} (its own member list); the public site holds no trip details.\n// Generated from src/together/*.js by scripts/build.mjs — edit those files, not this one.\nwindow.Together = (() => {\n',
  tail: '})();\n',
 },
];

const check = process.argv.includes('--check');
const stale = [];
for (const b of bundles) {
 const files = readdirSync(b.dir).filter((f) => f.endsWith('.js')).sort();
 const text = b.head + files.map((f) => readFileSync(`${b.dir}/${f}`, 'utf8').replace(/\n*$/, '\n')).join('') + b.tail;
 let current = '';
 try { current = readFileSync(b.out, 'utf8'); } catch {}
 if (current === text) continue;
 if (check) stale.push(b.out);
 else { writeFileSync(b.out, text); console.log(`Built ${b.out} from ${files.length} files.`); }
}
if (stale.length) {
 console.error(`${stale.join(', ')} out of date: run node scripts/build.mjs`);
 process.exit(1);
}
