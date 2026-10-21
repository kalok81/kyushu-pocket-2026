// Manage who can sign in. Uses your own Google login: run `gcloud auth login` first.
//   node scripts/accounts.mjs list
//   node scripts/accounts.mjs add <id> [顯示名稱]     create an account ID with a new random password
//   node scripts/accounts.mjs reset <id>              give an account ID a new random password
//   node scripts/accounts.mjs google <gmail>          allow a Google account
//   node scripts/accounts.mjs remove <id|gmail>       remove from the member list (and delete an account ID)
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';

const PROJECT = 'kyushu-2e307', DOMAIN = 'kyushu-trip.invalid';
const auth = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
const membersDoc = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/config/members`;
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' };

async function call(url, body, method = 'POST') {
 const res = await fetch(url, { method, headers: H, body: body && JSON.stringify(body) });
 if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
 return res.json();
}
const emailOf = id => id.includes('@') ? id.toLowerCase() : `${id.toLowerCase()}@${DOMAIN}`;
const password = () => Array.from({ length: 10 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[randomInt(31)]).join('');
async function members() {
 const res = await fetch(membersDoc, { headers: H });
 if (res.status === 404) return [];
 if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
 return ((await res.json()).fields?.emails?.arrayValue?.values || []).map(v => v.stringValue);
}
async function saveMembers(emails) {
 await call(`${membersDoc}?updateMask.fieldPaths=emails`, { fields: { emails: { arrayValue: { values: [...new Set(emails)].map(stringValue => ({ stringValue })) } } } }, 'PATCH');
}
async function lookup(email) { return (await call(`${auth}:lookup`, { email: [email] })).users?.[0]; }

const [cmd, arg, name] = process.argv.slice(2);
if (cmd === 'list') {
 for (const e of await members()) console.log(e.endsWith('@' + DOMAIN) ? `帳號 ${e.split('@')[0]}` : `Google ${e}`);
} else if (cmd === 'add' && /^[a-z0-9._-]{2,30}$/i.test(arg || '')) {
 const email = emailOf(arg), pw = password();
 if (await lookup(email)) throw new Error(`帳號 ${arg} 已存在；要換密碼請用 reset`);
 await call(auth, { email, password: pw, displayName: name || arg, emailVerified: true });
 await saveMembers([...await members(), email]);
 console.log(`已建立帳號 ${arg.toLowerCase()}，密碼：${pw}\n請把密碼私下交給旅伴；這個密碼不會再顯示。`);
} else if (cmd === 'reset' && arg) {
 const user = await lookup(emailOf(arg)), pw = password();
 if (!user) throw new Error(`找不到帳號 ${arg}`);
 await call(`${auth}:update`, { localId: user.localId, password: pw });
 console.log(`帳號 ${arg} 的新密碼：${pw}`);
} else if (cmd === 'google' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(arg || '')) {
 await saveMembers([...await members(), arg.toLowerCase()]);
 console.log(`已加入 Google 帳戶 ${arg.toLowerCase()}`);
} else if (cmd === 'remove' && arg) {
 const email = emailOf(arg);
 await saveMembers((await members()).filter(e => e !== email));
 const user = email.endsWith('@' + DOMAIN) && await lookup(email);
 if (user) await call(`${auth}:delete`, { localId: user.localId });
 console.log(`已移除 ${arg}`);
} else {
 console.error('Usage: node scripts/accounts.mjs list | add <id> [name] | reset <id> | google <gmail> | remove <id|gmail>');
 process.exit(1);
}
