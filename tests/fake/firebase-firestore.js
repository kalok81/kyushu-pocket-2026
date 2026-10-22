// In-memory Firestore: one fictional trip created on the site (generic), everything else starts empty.
const TRIP={name:'測試旅程',destination:'日本東京',startDate:'2030-04-01',endDate:'2030-04-03',currency:'JPY',homeCurrency:'HKD',country:'JP',generic:true,center:{lat:35.681,lng:139.767},members:['amy@kyushu-trip.invalid']};
const store={},ls=[];let n=0;
globalThis.__fakeStore=store; // lets tests play the part of the Cloud Functions
const col=c=>store[c]??={};
const snapOf=r=>r.id?{exists:()=>!!col(r.c)[r.id],data:()=>col(r.c)[r.id],get:k=>col(r.c)[r.id]?.[k],metadata:{fromCache:false,hasPendingWrites:false}}:{docs:Object.entries(col(r.c)).map(([id,d])=>({id,data:()=>d,metadata:{hasPendingWrites:false}}))};
// Like Firestore, listeners hear about writes asynchronously.
const emit=()=>setTimeout(()=>ls.forEach(([r,f])=>f(snapOf(r))));
export const initializeFirestore=()=>({}),getFirestore=()=>({}),persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),serverTimestamp=()=>'ts',terminate=async()=>{},clearIndexedDbPersistence=async()=>{};
export const collection=(db,...p)=>({c:p[p.length-1]}),doc=(db,...p)=>!p.length&&db?.c?{c:db.c,id:'auto'+(++n)}:p.length%2?{c:p[0].c,id:'auto'+(++n)}:{c:p[p.length-2],id:p[p.length-1]};
export const query=r=>r,where=()=>null,increment=v=>v;
export async function getDocs(){return {docs:[{id:'test-trip',data:()=>TRIP}]}}
export function onSnapshot(r,o,f){if(typeof o==='function')f=o;ls.push([r,f]);setTimeout(()=>f(snapOf(r)));return()=>{}}
export async function addDoc(r,d){col(r.c)['d'+(++n)]=d;emit()}
export async function setDoc(r,d){col(r.c)[r.id]={...col(r.c)[r.id],...d};emit()}
export async function updateDoc(r,d){col(r.c)[r.id]={...col(r.c)[r.id],...d};emit()}
export async function deleteDoc(r){delete col(r.c)[r.id];emit()}
