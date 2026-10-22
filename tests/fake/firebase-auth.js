// One account: amy / pw12345678 (account IDs sign in as {id}@kyushu-trip.invalid).
let cb,user=null;
export const getAuth=()=>({});export class GoogleAuthProvider{}
export function onAuthStateChanged(a,f){cb=f;setTimeout(()=>f(user))}
export async function signInWithEmailAndPassword(a,e,p){if(e==='amy@kyushu-trip.invalid'&&p==='pw12345678'){user={uid:'u1',displayName:'Amy',email:e};cb(user)}else{const x=new Error('bad');x.code='auth/invalid-credential';throw x}}
export async function signInWithPopup(){}export async function signInWithRedirect(){}
export async function signOut(){user=null;cb(null)}
