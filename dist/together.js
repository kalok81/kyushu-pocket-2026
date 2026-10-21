'use strict';
// Sign-in gate, trip data, shared notes/expenses/shopping list, plan edits and favourites for travel companions (Firebase).
// Trip data lives in Firestore (trip/data, trip/geo, trip/content); the public site holds no trip details.
window.Together=(()=>{
 // Firebase web config is public by design; access is enforced by firestore.rules and the member list.
 const config={apiKey:'AIzaSyC_qsxlY9mX0OKK5bIXwUXvrrxCOFnc18M',authDomain:'kyushu-2e307.firebaseapp.com',projectId:'kyushu-2e307',storageBucket:'kyushu-2e307.firebasestorage.app',messagingSenderId:'672657048901',appId:'1:672657048901:web:d1e2f7dd92389f78f3ea2c'};
 const tabs={notes:'筆記',expenses:'開支'};
 const state={status:'idle',error:'',user:null,tab:'notes',day:1,notes:[],expenses:[],members:[],shopping:[],places:[],planDays:[],placesLoaded:false,shopFilter:'todo',shopEdit:null,trip:{}};
 const T=()=>window.TripApp,S=window.Split,$=s=>document.querySelector(s);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const toast=s=>{$('#toast').textContent=s;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2600)};
 const header=(k,t,p)=>`<div class="pagehead"><div class="eyebrow">${k}</div><h1>${t}</h1>${p?`<p>${p}</p>`:''}</div>`;
 let fb,loading,unsub=[],started=false,staleNotice=false;

 function load(){
  if(fb)return Promise.resolve(fb);if(loading)return loading;
  state.status='loading';state.error='';refresh();
  loading=Promise.all(['app','auth','firestore'].map(n=>import(`./vendor/firebase/firebase-${n}.js`))).then(([app,auth,fs])=>{
   const a=app.initializeApp(config);
   let db;try{db=fs.initializeFirestore(a,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})})}catch{db=fs.getFirestore(a)}
   fb={app:a,auth:auth.getAuth(a),A:auth,db,fs};
   auth.onAuthStateChanged(fb.auth,user=>{stop();state.user=user;if(!user){if(started)return location.reload();state.status='signedOut';refresh();return}state.status='checking';refresh();listen()});
   return fb;
  }).catch(e=>{loading=null;state.status='error';state.error='未能載入共用功能，請檢查網絡後再試。';refresh();throw e});
  return loading;
 }
 function stop(){unsub.forEach(u=>u());unsub=[];jobs=[];Object.assign(state,{notes:[],expenses:[],members:[],shopping:[],places:[],planDays:[],placesLoaded:false,trip:{}})}
 function listen(){
  const {fs,db}=fb;
  const watch=name=>fs.onSnapshot(fs.collection(db,name),{includeMetadataChanges:true},snap=>{
   state[name]=snap.docs.map(d=>({...d.data(),id:d.id,pending:d.metadata.hasPendingWrites})).sort((a,b)=>(b.at||0)-(a.at||0));
   if(state.status!=='ready'){state.status='ready';saveProfile()}
   if(name==='places'){state.placesLoaded=true;if(started)T().applyPlaceEdits(state.places);else start()}
   if(name==='planDays'&&started)T().applyPlanEdits(planMap());
   if(name==='members'&&started)syncFavorites();
   refresh();
  },err=>{stop();state.status=err.code==='permission-denied'?'denied':'error';state.error=err.code==='permission-denied'?'':'同步失敗，請稍後再試。';refresh()});
  const fail=err=>{stop();state.status=err.code==='permission-denied'?'denied':'error';state.error=err.code==='permission-denied'?'':'同步失敗，請稍後再試。';refresh()};
  const watchTrip=id=>fs.onSnapshot(fs.doc(db,'trip',id),snap=>{
   if(!snap.exists()){if(!snap.metadata.fromCache){state.empty=true;refresh()}return}
   state.empty=false;
   const json=snap.get('json');if(started&&json!==state.trip[id]&&!staleNotice){staleNotice=true;toast('旅程資料已更新，重新整理網頁即可看到。')}
   state.trip[id]=json;start();
  },fail);
  const watchJobs=fs.onSnapshot(fs.query(fs.collection(db,'receiptJobs'),fs.where('by','==',state.user.uid)),{includeMetadataChanges:true},snap=>{jobs=snap.docs.map(d=>({...d.data(),id:d.id,uploading:d.metadata.hasPendingWrites})).sort((a,b)=>(a.at||0)-(b.at||0));renderDrafts();const sp=$('#shopPage');if(sp)paint(sp,shopPage())},e=>console.error('receipt jobs',e));
  unsub=[watchJobs,...['notes','expenses','members','shopping','places','planDays'].map(watch)].concat(['data','geo','content'].map(watchTrip));
 }
 function start(){
  const t=state.trip;if(started||!t.data||!t.geo||!t.content||!state.placesLoaded)return;
  try{const data=JSON.parse(t.data),geo=JSON.parse(t.geo),content=JSON.parse(t.content);started=true;window.TRIP_GEO=geo;document.body.classList.remove('locked');window.startTrip(data,content);T().applyPlaceEdits(state.places);T().applyPlanEdits(planMap());syncFavorites()}
  catch(e){started=false;state.status='error';state.error='旅程資料格式有誤，請重新上載。';refresh();console.error(e)}
 }
 async function logout(){
  if(!confirm('登出後，這部手機會刪除已下載的旅程資料。確定登出？'))return;
  try{await fb.A.signOut(fb.auth);await fb.fs.terminate(fb.db);await fb.fs.clearIndexedDbPersistence(fb.db)}catch{}
  location.reload();
 }
 function saveProfile(){const u=state.user;fb.fs.setDoc(fb.fs.doc(fb.db,'members',u.uid),{name:(u.displayName||u.email.split('@')[0]).slice(0,40),email:u.email,at:Date.now()},{merge:true}).catch(()=>{})}
 // Account IDs map to addresses on a reserved domain; accounts are created with scripts/accounts.mjs.
 const ACCOUNT_DOMAIN='kyushu-trip.invalid',authError=e=>({'auth/invalid-credential':'帳號或密碼不正確。','auth/wrong-password':'帳號或密碼不正確。','auth/user-not-found':'帳號或密碼不正確。','auth/invalid-email':'帳號格式不正確。','auth/too-many-requests':'嘗試次數太多，請稍後再試。','auth/network-request-failed':'未能連線，請檢查網絡。','auth/unauthorized-domain':'這個網址未加入 Firebase 登入網域。','auth/operation-not-allowed':'這種登入方式未啟用。'})[e.code]||'登入失敗，請再試。';
 async function login(){
  try{await load();const p=new fb.A.GoogleAuthProvider();try{await fb.A.signInWithPopup(fb.auth,p)}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-environment'].includes(e.code))await fb.A.signInWithRedirect(fb.auth,p);else throw e}}
  catch(e){if(e.code==='auth/popup-closed-by-user'||e.code==='auth/cancelled-popup-request')return;toast(authError(e))}
 }
 async function loginWithAccount(id,password){
  const email=id.includes('@')?id:`${id.toLowerCase()}@${ACCOUNT_DOMAIN}`;
  try{await load();await fb.A.signInWithEmailAndPassword(fb.auth,email,password)}catch(e){toast(authError(e))}
 }
 function add(name,data){
  const {fs,db}=fb,u=state.user;
  fs.addDoc(fs.collection(db,name),{...data,by:u.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()}).catch(()=>toast('未能儲存，請確認你仍在旅伴名單。'));
  toast(navigator.onLine?'已加入':'已加入，有網絡時會自動同步');
 }
 // Receipt photos are shrunk on the phone, read by the scanReceipt Cloud Function, then only fill the form.
 let functionsModule;
 const callable=async(name,timeout)=>{functionsModule??=await import('./vendor/firebase/firebase-functions.js');return functionsModule.httpsCallable(functionsModule.getFunctions(fb.app,'asia-northeast1'),name,{timeout})};
 // Browsers differ: try ImageBitmap (with and without EXIF rotation), then <img>; HEIC that the
 // browser cannot read is converted on the phone with the vendored heic2any (loaded only when needed).
 const isHeic=f=>/hei[cf]/i.test(f.type||'')||/\.hei[cf]$/i.test(f.name||'');
 const viaImg=blob=>new Promise((ok,fail)=>{const url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{ok(img);URL.revokeObjectURL(url)};img.onerror=()=>{URL.revokeObjectURL(url);fail(new Error('img'))};img.src=url});
 let heicLib;
 const loadHeic=()=>heicLib??=new Promise((ok,fail)=>{const js=document.createElement('script');js.src='vendor/heic2any/heic2any.min.js';js.onload=()=>ok(window.heic2any);js.onerror=()=>{heicLib=null;fail(new Error('heic2any'))};document.head.append(js)});
 async function decodeImage(file){
  for(const attempt of [()=>createImageBitmap(file,{imageOrientation:'from-image'}),()=>createImageBitmap(file),()=>viaImg(file)]){try{return await attempt()}catch{}}
  if(!isHeic(file))throw new Error('unsupported image');
  const out=await (await loadHeic())({blob:file,toType:'image/jpeg',quality:.9});
  return viaImg(Array.isArray(out)?out[0]:out);
 }
 // Long receipts are cut into up to three overlapping strips so the total line stays legible to the AI.
 async function receiptImages(file){
  const img=await decodeImage(file),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,parts=h/w>3.2?3:h/w>1.6?2:1,toB64=c=>new Promise(r=>c.toBlob(r,'image/jpeg',.8)).then(b=>{if(!b)throw new Error('encode');return new Promise((ok,fail)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]);fr.onerror=fail;fr.readAsDataURL(b)})});
  const strip=h/parts,overlap=strip*.08,out=[];
  for(let i=0;i<parts;i++){
   const top=Math.max(0,i*strip-overlap),bottom=Math.min(h,(i+1)*strip+overlap),sh=bottom-top,k=Math.min(1,1600/Math.max(w,sh)),c=document.createElement('canvas');
   c.width=Math.round(w*k);c.height=Math.round(sh*k);c.getContext('2d').drawImage(img,0,top,w,sh,0,0,c.width,c.height);out.push(await toB64(c));
  }
  img.close?.();return out;
 }
 async function shrink(file,max=1600,quality=.85){
  const img=await decodeImage(file),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,k=Math.min(1,max/Math.max(w,h)),c=document.createElement('canvas');
  c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close?.();
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',quality));if(!blob)throw new Error('encode');
  return new Promise((ok,fail)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]);fr.onerror=fail;fr.readAsDataURL(blob)});
 }
 const scanError=e=>/unsupported|heic|img|encode/.test(e?.message)?'未能讀取這張相片，請改用 JPG 或 PNG，或直接影相。':'未能處理這張相片。';
 // Receipts are read in the background: each photo becomes a receiptJobs document. Firestore keeps unsent
 // writes on the phone and retries after a reload, and the processReceipt function reads the receipt
 // server-side even if the page is closed. Payer and split come from the expense form when adding.
 let jobs=[];const localEdits={};
 const STUCK=3*60*1000;
 const jobState=j=>j.status==='done'?'done':j.status==='failed'?'fail':j.uploading?'upload':j.status==='processing'?'busy':'queued';
 const canRetry=j=>(j.status==='failed'&&(j.image!=null||j.images!=null))||(['pending','processing'].includes(j.status)&&!j.uploading&&Date.now()-(j.startedAt||j.at||0)>STUCK);
 function draftOf(j){
  const r=j.result||{},e={...j.edit,...localEdits[j.id]},day=r.date&&T().days.find(x=>x.iso===r.date.replaceAll('-','/'));
  return {key:j.id,file:j.file,at:j.at||0,part:r.part||(j.status==='failed'?'unknown':'whole'),photos:j.images||(j.image!=null?[j.image]:[]),status:jobState(j),error:j.error,retry:canRetry(j),title:e.title??(r.merchant||'收據'),amount:e.amount??r.total??'',currency:e.currency??(r.currency==='HKD'?'HKD':'JPY'),day:Number(e.day??(day?day.n:today())),items:r.items||[],
   warn:r.currency==='OTHER'?'⚠️ 收據不是日圓或港幣，請自行換算。':r.totalFromItems?'⚠️ 讀不到總額，已用物品合計，請對照收據。':r.confidence==='low'?'⚠️ 相片不太清楚，請仔細檢查。':''};
 }
 const drafts=()=>jobs.filter(j=>j.kind!=='product').map(draftOf);
 const draftDup=(d,all=drafts())=>{const exp={title:d.title,amount:Number(d.amount),currency:d.currency,day:Number(d.day)},earlier=all.slice(0,all.findIndex(x=>x.key===d.key)).find(x=>x.status==='done'&&x.currency===exp.currency&&Math.abs(Number(x.amount)-exp.amount)<.005&&(Number(x.day)===exp.day||sameName(x.title,exp.title)));const dup=duplicateOf(exp);return dup?`⚠️ 可能重複：${dupText(dup)} 已經記錄過。`:earlier?`⚠️ 與「${earlier.title}」可能是同一張收據。`:''};
 // Partial shots: pair them in upload order (a top/middle shot followed by the next partial ones up to a bottom
 // shot, within 10 minutes, same shop when both names are known). Several split receipts give several suggestions.
 const PART_ORDER={top:0,middle:1,unknown:1,bottom:2};
 function mergeGroups(all){
  const parts=all.filter(d=>(d.status==='done'||d.status==='fail')&&d.photos.length&&d.part!=='whole').sort((a,b)=>a.at-b.at),groups=[];
  const shop=d=>d.status==='done'&&d.title&&d.title!=='收據'?d.title:'';
  let cur=[];
  const close=()=>{if(cur.length>=2&&cur.some(d=>d.part!=='top')&&cur.some(d=>d.part!=='bottom'))groups.push(cur);cur=[]};
  for(const d of parts){
   const last=cur[cur.length-1],sameShop=!last||!shop(d)||!shop(last)||sameName(shop(d),shop(last))||shop(d).includes(shop(last))||shop(last).includes(shop(d));
   const complete=cur.some(x=>x.part==='top')&&cur.some(x=>x.part==='bottom');
   if(last&&(d.at-last.at>10*60*1000||!sameShop||cur.length>=4||complete))close();
   cur.push(d);
  }
  close();
  return groups.map(g=>g.sort((a,b)=>PART_ORDER[a.part]-PART_ORDER[b.part]));
 }
 const picked=new Set();
 function mergeDrafts(keys){
  const group=keys.map(k=>drafts().find(d=>d.key===k)).filter(Boolean).sort((a,b)=>PART_ORDER[a.part]-PART_ORDER[b.part]||a.at-b.at),images=group.flatMap(d=>d.photos);
  if(group.length<2||!images.length)return;
  if(images.length>4)return toast('同一張收據最多 4 張相片，請少揀幾張。');
  keys.forEach(k=>picked.delete(k));
  const {fs,db}=fb;
  fs.addDoc(fs.collection(db,'receiptJobs'),{images,file:group.map(d=>d.file).join(' + ').slice(0,120),status:'pending',by:state.user.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()})
   .then(()=>group.forEach(d=>{fs.deleteDoc(jobRef(d.key)).catch(()=>{});delete localEdits[d.key]}),()=>toast('未能合併，請再試。'));
  toast('已合併，正在重新分析');
 }
 const STATUS={upload:'上載中',queued:'等候分析',busy:'分析中…',done:'已讀取',fail:'未能讀取'};
 function draftHtml(d,all){
  const pick=(d.status==='done'||d.status==='fail')&&d.photos.length?`<label class="tg-pick"><input type="checkbox" data-draft-pick="${d.key}"${picked.has(d.key)?' checked':''}> 選擇</label>`:'';
  const head=`<div class="tg-meta"><span class="badge">${STATUS[d.status]}</span><span>${esc(d.file)}</span>${pick}</div>`,retry=d.retry?`<button type="button" class="smallbtn" data-draft-retry="${d.key}">重試</button>`:'',drop=`<button type="button" class="smallbtn" data-draft-drop="${d.key}">捨棄</button>`;
  if(d.status!=='done'&&d.status!=='fail')return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<div class="tg-progress tg-progress-busy"><div></div></div>${d.retry?`<p class="note">等候時間較長，可以按重試。</p><div class="links">${retry}${drop}</div>`:''}</article>`;
  if(d.status==='fail')return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<p class="note">${esc(d.error||'未能讀取。')}</p><div class="links">${retry}${drop}</div></article>`;
  const warn=draftDup(d,all)||d.warn;
  return `<article class="tg-item tg-draft" data-draft="${d.key}">${head}<div class="tg-row"><label>項目<input data-df="title" maxlength="80" value="${esc(d.title)}"></label><label>金額<input data-df="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(d.amount)}"></label></div><div class="tg-row"><label>貨幣<select data-df="currency"><option value="JPY">日圓 ¥</option><option value="HKD"${d.currency==='HKD'?' selected':''}>港幣 HK$</option></select></label><label>日子<select data-df="day">${dayOptions(d.day)}</select></label></div>${d.items.length?`<ul class="tg-lines">${d.items.map(i=>`<li><span>${esc(i.name)}</span><span>${esc(i.amount)}</span></li>`).join('')}</ul>`:''}${warn?`<p class="note tg-warn">${esc(warn)}</p>`:''}<div class="links"><button type="button" class="action primary" data-draft-add="${d.key}">加入</button>${drop}</div></article>`;
 }
 function renderDrafts(){
  const box=$('#tgDrafts');if(!box)return;
  const all=drafts();if(!all.length){box.innerHTML='';return}
  const a=document.activeElement,card=a?.closest?.('[data-draft]'),field=a?.dataset?.df;
  const finished=all.filter(d=>d.status==='done'||d.status==='fail').length,ready=all.filter(d=>d.status==='done'&&!draftDup(d,all)).length,uploading=all.filter(d=>d.status==='upload').length,pct=Math.round(finished/all.length*100);
  for(const k of [...picked])if(!all.some(d=>d.key===k&&d.photos.length))picked.delete(k);
  const suggestions=mergeGroups(all).map(g=>`<div class="notice tg-merge">🧾 ${esc(g.map(d=>d.file).join('、'))} 似乎是同一張收據的不同部分。<button type="button" class="action primary" data-tg="mergeDrafts" data-keys="${g.map(d=>d.key).join(',')}">合併並重新分析</button></div>`).join('');
  const pickedBar=picked.size>=2?`<div class="notice tg-merge">已選 ${picked.size} 張相片。<button type="button" class="action primary" data-tg="mergeDrafts" data-keys="${[...picked].join(',')}">合併所選（同一張收據）</button></div>`:'';
  box.innerHTML=`${suggestions}${pickedBar}<div class="tg-drafts-head"><b>待確認收據 ${finished}/${all.length}</b>${ready?`<button type="button" class="action primary" data-tg="draftsAddAll">全部加入（${ready}）</button>`:''}</div><div class="tg-progress" role="progressbar" aria-label="收據分析進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div><p class="note">${uploading?`${uploading} 張正在上載${navigator.onLine?'':'（離線中，有網絡時會繼續）'}。`:''}收據在背景分析，可以關閉網頁，稍後回來確認。付款人及「分給」使用下面表格的設定；有 ⚠️ 的不會在「全部加入」時加入。</p>${all.map(d=>draftHtml(d,all)).join('')}`;
  if(card&&field){const el=box.querySelector(`[data-draft="${card.dataset.draft}"] [data-df="${field}"]`);if(el)el.focus()}
 }
 async function queueReceipts(files){
  const {fs,db}=fb;
  const send=(images,file)=>fs.addDoc(fs.collection(db,'receiptJobs'),{images,file:String(file).slice(0,120),status:'pending',by:state.user.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()}).catch(e=>{toast('未能上載收據，請確認你仍在旅伴名單。');console.error(e)});
  if(files.length>10){toast('一次最多 10 張，已取頭 10 張。');files=files.slice(0,10)}
  let n=0;
  for(const f of files){
   try{let images=await receiptImages(f);if(images.join('').length>850000)images=[await shrink(f,1400,.7)];
    send(images,f.name||'相片');n++}
   catch(e){toast(`${f.name||'相片'}：${scanError(e)}`);console.error(e)}
  }
  if(n)toast(`已加入 ${n} 張收據，會在背景分析`);
 }
 // Product photos for the shopping list go through the same background jobs; the function adds the item itself.
 async function queueProducts(files){
  if(files.length>10){toast('一次最多 10 張，已取頭 10 張。');files=files.slice(0,10)}
  const {fs,db}=fb;let n=0;
  for(const f of files){
   try{let image=await shrink(f,1000,.72);if(image.length>380000)image=await shrink(f,800,.65);
    fs.addDoc(fs.collection(db,'receiptJobs'),{images:[image],kind:'product',file:String(f.name||'相片').slice(0,120),status:'pending',by:state.user.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()}).catch(e=>{toast('未能上載相片，請確認你仍在旅伴名單。');console.error(e)});n++}
   catch(e){toast(`${f.name||'相片'}：${scanError(e)}`);console.error(e)}
  }
  if(n)toast(`已加入 ${n} 張物品相片，AI 會在背景辨識並加入清單`);
 }
 function productJobsHtml(){
  const pj=jobs.filter(j=>j.kind==='product');if(!pj.length)return '';
  const busy=pj.filter(j=>j.status!=='failed').length;
  return `<div class="tg-drafts"><div class="tg-drafts-head"><b>${busy?`AI 辨識中 ${busy} 張`:'未能辨識的相片'}</b></div>${pj.map(j=>{const st=jobState(j),fail=st==='fail',retry=canRetry(j);return `<article class="tg-item tg-draft" data-draft="${esc(j.id)}"><div class="tg-meta"><span class="badge">${fail?'未能辨識':STATUS[st]}</span><span>${esc(j.file)}</span></div>${fail?`<p class="note">${esc(j.error||'未能辨識。')}</p>`:'<div class="tg-progress tg-progress-busy"><div></div></div>'}${fail||retry?`<div class="links">${retry?`<button type="button" class="smallbtn" data-draft-retry="${esc(j.id)}">重試</button>`:''}<button type="button" class="smallbtn" data-draft-drop="${esc(j.id)}">捨棄</button></div>`:''}</article>`}).join('')}</div>`;
 }
 const jobRef=id=>fb.fs.doc(fb.db,'receiptJobs',id);
 function addDraft(d,ask){
  const f=$('[data-tg-form="expense"]'),v=new FormData(f),split=v.getAll('split').map(String),amount=Number(d.amount);
  if(!String(d.title).trim()||!(amount>0)||amount>1e7){toast('請檢查項目和金額。');return false}
  if(!split.length){toast('請在下面表格最少選一位分帳旅伴。');return false}
  const exp={title:String(d.title).trim().slice(0,80),amount:Math.round(amount*100)/100,currency:d.currency,paidBy:String(v.get('paidBy')),split,day:Number(d.day),items:d.items.slice(0,30)},dup=duplicateOf(exp);
  if(dup&&ask&&!confirm(`似乎已經記錄過：\n${dupText(dup)}\n\n仍然要加入嗎？`))return false;
  add('expenses',exp);fb.fs.deleteDoc(jobRef(d.key)).catch(()=>{});jobs=jobs.filter(j=>j.id!==d.key);delete localEdits[d.key];return true;
 }
 // Place edits: new places are their own documents; edits/deletions of Sheet places use the place id as document id.
 async function lookupPlace(url){if(!navigator.onLine)throw new Error('offline');return (await (await callable('lookupPlace',45000))({url})).data}
 function savePlace({place,fields,cats,lat,lng,mapsUrl}){
  const {fs,db}=fb,data={fields,cats,lat,lng,mapsUrl,deleted:false};
  if(place?.custom){update('places',place.overlayId,data);toast('已儲存')}
  else if(place){fs.setDoc(fs.doc(db,'places',place.id),{...data,base:place.id,by:state.user.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()}).catch(()=>toast('未能儲存，請再試。'));toast('已儲存')}
  else add('places',{...data,base:null});
 }
 function deletePlace(place){
  const {fs,db}=fb;
  if(place.custom)return fs.deleteDoc(fs.doc(db,'places',place.overlayId)).catch(()=>toast('未能刪除，請再試。'));
  fs.setDoc(fs.doc(db,'places',place.id),{base:place.id,fields:place.v.map(String),cats:place.cats,lat:null,lng:null,mapsUrl:'',deleted:true,by:state.user.uid,byName:me().name,at:Date.now(),createdAt:fs.serverTimestamp()}).catch(()=>toast('未能刪除，請再試。'));
 }
 // Day plans: planDays/{day} holds the whole edited stop list for that day; deleting it restores the original.
 const planMap=()=>Object.fromEntries(state.planDays.map(d=>[Number(d.id),d]));
 function savePlanDay(day,stops){fb.fs.setDoc(fb.fs.doc(fb.db,'planDays',String(day)),{stops,by:state.user.uid,byName:me().name,at:Date.now()}).catch(()=>toast('未能儲存行程，請再試。'))}
 function resetPlanDay(day){fb.fs.deleteDoc(fb.fs.doc(fb.db,'planDays',String(day))).then(()=>toast('已還原原本行程'),()=>toast('未能還原，請再試。'))}
 // Favourites: members/{uid}.saved. The first time, seed with the old yellow Sheet records plus this device's stars.
 function syncFavorites(){
  const mine=state.members.find(m=>m.id===state.user?.uid);if(!mine||!started)return;
  if(Array.isArray(mine.saved)){T().setSaved(mine.saved);return}
  const seed=[...new Set([...T().places.filter(p=>p.marked).map(p=>p.id),...T().savedIds()])];
  saveFavorites(seed);T().setSaved(seed);
 }
 function saveFavorites(ids){fb.fs.setDoc(fb.fs.doc(fb.db,'members',state.user.uid),{saved:ids.slice(0,500)},{merge:true}).catch(()=>toast('未能同步收藏。'))}
 function restorePlace(id){fb.fs.deleteDoc(fb.fs.doc(fb.db,'places',id)).catch(()=>toast('未能還原，請再試。'))}
 function update(name,id,data){fb.fs.updateDoc(fb.fs.doc(fb.db,name,id),data).catch(()=>toast('未能儲存，請再試。'))}
 function remove(name,id){if(confirm('確定刪除？所有旅伴都會看不到這項。'))fb.fs.deleteDoc(fb.fs.doc(fb.db,name,id)).catch(()=>toast('未能刪除，請再試。'))}

 const me=()=>{const u=state.user;return {id:u.uid,name:state.members.find(m=>m.id===u.uid)?.name||u.displayName||u.email.split('@')[0]}};
 const people=()=>{const list=state.members.map(m=>({id:m.id,name:m.name||'旅伴'}));if(state.user&&!list.some(m=>m.id===state.user.uid))list.push(me());return list.sort((a,b)=>a.name.localeCompare(b.name))};
 const nameOf=uid=>people().find(p=>p.id===uid)?.name||'旅伴';
 const dayLabel=n=>{const d=T().days[n-1];return d?`D${d.n} ${d.date} ${d.region}`:''};
 const today=()=>{const now=new Date(),iso=`${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;return T().days.find(d=>d.iso===iso)?.n||1};
 const dayOptions=sel=>T().days.map(d=>`<option value="${d.n}"${d.n===sel?' selected':''}>${esc(dayLabel(d.n))}</option>`).join('');
 const when=at=>at?new Date(at).toLocaleString('zh-HK',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 const meta=(x,extra='')=>`<div class="tg-meta">${extra}<span>${esc(x.byName||'旅伴')} · ${esc(when(x.at))}</span>${x.pending?'<span class="tg-pending">未同步</span>':''}</div>`;
 const del=(name,x)=>`<button class="smallbtn" data-tg-del="${name}:${esc(x.id)}" aria-label="刪除">刪除</button>`;

 function noteItem(n){const place=n.placeName?`<span class="badge">${esc(n.placeName)}</span>`:'',day=n.day?`<span class="badge">${esc(dayLabel(n.day))}</span>`:'';return `<article class="tg-item">${meta(n,day+place)}<p class="tg-text">${esc(n.text)}</p>${del('notes',n)}</article>`}
 const itemRow=(it={})=>`<div class="tg-line-row"><input name="itemName" maxlength="40" placeholder="物品" aria-label="物品" value="${esc(it.name??'')}"><input name="itemAmount" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" placeholder="金額" aria-label="金額" value="${it.amount??''}"><button type="button" class="smallbtn" data-tg="itemDel" aria-label="移除物品">×</button></div>`;
 // Same receipt twice: same amount and currency, plus the same day or the same shop name.
 const sameName=(a,b)=>String(a).replace(/\s+/g,'').toLowerCase()===String(b).replace(/\s+/g,'').toLowerCase();
 const duplicateOf=({title,amount,currency,day})=>state.expenses.find(e=>e.currency===currency&&Math.abs(e.amount-amount)<.005&&(e.day===day||sameName(e.title,title)));
 const dupText=e=>`${dayLabel(e.day)}「${e.title}」${S.format(S.toMinor(e.amount,e.currency),e.currency)}（${e.byName||'旅伴'} 記錄）`;
 function expenseItem(e){return `<article class="tg-item">${meta(e,`<span class="badge">${esc(dayLabel(e.day))}</span>`)}<div class="tg-expense"><h3>${esc(e.title)}</h3><b>${esc(S.format(S.toMinor(e.amount,e.currency),e.currency))}</b></div>${e.items?.length?`<ul class="tg-lines">${e.items.map(i=>`<li><span>${esc(i.name)}</span>${i.amount!=null?`<span>${esc(S.format(S.toMinor(i.amount,e.currency),e.currency))}</span>`:''}</li>`).join('')}</ul>`:''}<p class="note">${esc(nameOf(e.paidBy))} 付款 · 分給 ${esc((e.split||[]).map(nameOf).join('、'))}</p>${del('expenses',e)}</article>`}
 function summary(){
  const bal=S.balances(state.expenses),cs=Object.keys(bal);
  if(!cs.length)return '';
  return `<section class="panel tg-summary"><h3>分帳結算</h3>${cs.map(c=>{const total=state.expenses.filter(e=>e.currency===c).reduce((t,e)=>t+S.toMinor(e.amount,c),0),moves=S.settle(bal[c]);return `<div class="tg-currency"><div class="eyebrow">${c} · 合共 ${esc(S.format(total,c))}</div>${moves.length?moves.map(m=>`<p><b>${esc(nameOf(m.from))}</b> 要畀 <b>${esc(nameOf(m.to))}</b> ${esc(S.format(m.amount,c))}</p>`).join(''):'<p>已經清數。</p>'}</div>`}).join('')}<p class="note">日圓和港幣分開計算，不作匯率換算。</p></section>`;
 }

 function statusBar(){const online=navigator.onLine,pending=['notes','expenses','shopping'].reduce((t,k)=>t+state[k].filter(x=>x.pending).length,0);return `<span>已登入：<b>${esc(me().name)}</b></span><span class="tg-pending-${online?'on':'off'}">${online?pending?`${pending} 項同步中…`:'已同步':'離線中 · 修改會在有網絡時同步'}</span><button class="smallbtn" data-tg="logout">登出</button>`}
 function lists(){
  if(state.tab==='notes')return state.notes.length?state.notes.map(noteItem).join(''):'<div class="empty"><h2>還沒有筆記</h2><p>寫下提醒、想吃的東西或任何旅程點滴。</p></div>';
  if(state.tab==='expenses')return summary()+(state.expenses.length?state.expenses.map(expenseItem).join(''):'<div class="empty"><h2>還沒有開支</h2><p>每筆開支記下誰付款、分給誰，網站會計算誰要畀誰。</p></div>');
 }
 function forms(){
  if(state.tab==='notes')return `<form class="panel tg-form" data-tg-form="note"><label>筆記<textarea name="text" rows="3" maxlength="1000" required placeholder="例如：別府那天記得帶毛巾"></textarea></label><label>關於<select name="day"><option value="">整個旅程</option>${dayOptions(0)}</select></label><button type="submit" class="locate-button">加入筆記</button></form>`;
  if(state.tab==='expenses'){const ps=people();return `<form class="panel tg-form" data-tg-form="expense"><div class="tg-scan"><button type="button" class="action primary" data-tg="scan">📷 影收據／上載收據（可多張）</button><input type="file" accept="image/*" id="tgReceipt" multiple hidden><p class="note">AI 在背景讀出店名、金額、日期及物品，可以關閉網頁，稍後回來確認。同一張收據分開影的相片會提示合併，也可以自己選擇合併。加入或捨棄後相片會刪除。</p></div><div id="tgDrafts" class="tg-drafts"></div><label>項目<input name="title" maxlength="80" required placeholder="例如：一蘭晚餐"></label><fieldset class="tg-lines-edit"><legend>物品（可留空）</legend><div id="tgItemRows">${itemRow()}</div><button type="button" class="smallbtn" data-tg="itemAdd">＋ 加物品</button></fieldset><div class="tg-row"><label>金額<input name="amount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" placeholder="留空＝物品合計"></label><label>貨幣<select name="currency"><option value="JPY">日圓 ¥</option><option value="HKD">港幣 HK$</option></select></label></div><div class="tg-row"><label>誰付款<select name="paidBy">${ps.map(p=>`<option value="${esc(p.id)}"${p.id===state.user.uid?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>日子<select name="day">${dayOptions(today())}</select></label></div><fieldset><legend>分給</legend>${ps.map(p=>`<label class="tg-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join('')}</fieldset><p class="note">旅伴第一次登入後，才會出現在名單中。</p><button type="submit" class="locate-button">記下開支</button></form>`}
  return '';
 }
 function page(){
  const s=state.status;
  if(['idle','loading','checking'].includes(s))return {sig:s,shell:'<div class="empty"><h2>正在連接…</h2><p>第一次載入需要數秒。</p></div>'};
  if(s==='error')return {sig:s+state.error,shell:`<div class="empty"><h2>${esc(state.error||'發生錯誤')}</h2><button class="action primary" data-tg="retry">再試</button></div>`};
  if(s==='signedOut')return {sig:s,shell:`<section class="panel tg-login"><h2>旅伴專用</h2><p>行程、地點、住宿、筆記和開支只限旅伴登入查看，不會公開在網站上。</p><form class="tg-form" data-tg-form="login"><label>帳號<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required></label><label>密碼<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="locate-button">登入</button></form><div class="tg-or">或</div><button class="action tg-google" data-tg="login">用 Google 帳戶登入</button><p class="note">這部手機會記住登入狀態，之後離線也可以查看。</p></section>`};
  if(s==='denied')return {sig:s+state.user?.uid,shell:`<section class="panel tg-login"><h2>這個帳戶未在旅伴名單</h2><p>你已用 <b>${esc(state.user?.email)}</b> 登入。請負責人把這個電郵加入 Firebase 的旅伴名單，然後按再試。</p><div class="links"><button class="action primary" data-tg="retry">再試</button><button class="action" data-tg="logout">登出／換帳戶</button></div></section>`};
  if(!started)return state.empty?{sig:'empty',shell:'<div class="empty"><h2>暫時未有旅程資料</h2><p>請負責人先上載旅程資料。</p></div>'}:{sig:'trip',shell:'<div class="empty"><h2>正在載入旅程資料…</h2></div>'};
  const sig=['ready',state.tab,state.day,state.user.uid,people().map(p=>p.id+p.name).join()].join('|');
  return {sig,shell:`<div class="tg-status" data-tg-live="status"></div><div class="chips" role="tablist">${Object.entries(tabs).map(([k,v])=>`<button class="chip ${k===state.tab?'active':''}" data-tg-tab="${k}" aria-pressed="${k===state.tab}">${v}</button>`).join('')}</div>${forms()}<div class="tg-list" data-tg-live="list"></div>`,live:{status:statusBar(),list:lists()}};
 }
 function daySlot(n){
  if(state.status!=='ready')return {sig:'wait',shell:''};
  const ns=state.notes.filter(x=>x.day===n);
  return {sig:'ready',shell:'<div data-tg-live="list"></div>',live:{list:`<div class="sectionhead"><h2>旅伴筆記</h2><a class="action" href="#together?tab=notes">＋ 加入筆記</a></div>${ns.length?ns.map(noteItem).join(''):'<p class="note">這天還沒有旅伴筆記。</p>'}`}};
 }
 function placeSlot(id){
  if(state.status!=='ready')return {sig:'out',shell:''};
  return {sig:'ready'+id,shell:`<section class="detail-section"><h3>旅伴筆記</h3><div data-tg-live="list"></div><form class="tg-form" data-tg-form="note" data-place-id="${esc(id)}"><textarea name="text" rows="2" maxlength="1000" required placeholder="寫下對這個地點的筆記"></textarea><button type="submit" class="action primary">加入筆記</button></form></section>`,live:{list:state.notes.filter(x=>x.placeId===id).map(noteItem).join('')||'<p class="note">還沒有筆記。</p>'}};
 }
 // Shopping list: item photos are stored inline (small JPEG) so they stay readable offline.
 let shopPhoto=null;
 const photoSrc=b64=>`data:image/jpeg;base64,${b64}`;
 const shopPreview=()=>shopPhoto?`<img src="${photoSrc(shopPhoto)}" alt="物品相片"><button type="button" class="smallbtn" data-tg="shopPhotoClear">移除相片</button>`:'';
 function shopForm(x){
  const v=k=>esc(x?.[k]??'');
  return `<form class="panel tg-form" data-tg-form="shop"><div class="shop-photo"><div id="shopPreview">${shopPreview()}</div><button type="button" class="action primary" data-tg="shopPhoto">📷 影相／上載圖片</button><input type="file" accept="image/*" id="shopPhotoInput" hidden></div><label>物品<input name="name" maxlength="80" required placeholder="例如：明太子禮盒" value="${v('name')}"></label><div class="tg-row"><label>數量／規格<input name="qty" maxlength="30" placeholder="例如：2 盒、M 碼" value="${v('qty')}"></label><label>給誰／備註<input name="detail" maxlength="500" placeholder="例如：媽媽、要辣味" value="${v('detail')}"></label></div><label>購買地點／地址<input name="place" maxlength="200" placeholder="例如：博多阪急 B1 或地址" value="${v('place')}"></label><div class="tg-row"><label>價錢（可留空）<input name="price" type="number" inputmode="decimal" min="0" max="10000000" step="0.01" value="${x?.price??''}"></label><label>貨幣<select name="currency"><option value="JPY">日圓 ¥</option><option value="HKD"${x?.currency==='HKD'?' selected':''}>港幣 HK$</option></select></label></div><div class="links"><button type="submit" class="locate-button">${x?'儲存修改':'加入購物清單'}</button>${x?'<button type="button" class="action" data-tg="shopCancel">取消</button>':''}</div></form>`;
 }
 function shopItem(x){
  const price=x.price!=null?`<b class="shop-price">${esc(S.format(S.toMinor(x.price,x.currency),x.currency))}</b>`:'';
  return `<article class="tg-item shop-item${x.bought?' bought':''}">${x.photo?`<img class="shop-thumb" src="${photoSrc(x.photo)}" alt="${esc(x.name)}" data-shop-zoom>`:''}<div>${meta(x,x.ai?'<span class="badge">AI 填寫</span>':'')}<div class="tg-expense"><h3>${esc(x.name)}${x.qty?` <small>· ${esc(x.qty)}</small>`:''}</h3>${price}</div>${x.detail?`<p class="tg-text">${esc(x.detail)}</p>`:''}${x.place?`<p class="shop-place">📍 ${esc(x.place)} <a class="action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}" target="_blank" rel="noopener noreferrer">地圖 ↗</a></p>`:''}${x.bought?`<p class="note">✓ ${esc(x.boughtBy||'旅伴')} 已買 · ${esc(when(x.boughtAt))}</p>`:''}<div class="links"><button class="action${x.bought?'':' primary'}" data-shop-toggle="${esc(x.id)}">${x.bought?'↺ 改回未買':'✓ 已買'}</button><button class="smallbtn" data-shop-edit="${esc(x.id)}">編輯</button>${del('shopping',x)}</div></div></article>`;
 }
 function shopPage(){
  if(state.status!=='ready')return {sig:'wait',shell:'<div class="empty"><h2>正在連接…</h2></div>'};
  const edit=state.shopping.find(x=>x.id===state.shopEdit);if(state.shopEdit&&!edit){state.shopEdit=null;shopPhoto=null}
  const todo=state.shopping.filter(x=>!x.bought),shown=state.shopFilter==='todo'?todo:state.shopFilter==='done'?state.shopping.filter(x=>x.bought):state.shopping;
  const filters=[['todo','未買',todo.length],['done','已買',state.shopping.length-todo.length],['all','全部',state.shopping.length]].map(([k,t,n])=>`<button class="chip ${state.shopFilter===k?'active':''}" data-shop-filter="${k}" aria-pressed="${state.shopFilter===k}">${t} ${n}</button>`).join('');
  const list=shown.length?[...shown].sort((a,b)=>a.bought-b.bought||(b.at||0)-(a.at||0)).map(shopItem).join(''):`<div class="empty"><h2>${state.shopFilter==='done'?'還沒有已買的東西':'清單是空的'}</h2><p>${state.shopFilter==='done'?'買了之後按「✓ 已買」。':'把想買的東西加進來，旅伴都看得到。'}</p></div>`;
  return {sig:['shop',state.shopEdit||'',state.user.uid].join('|'),shell:`<div class="tg-status" data-tg-live="status"></div>${edit?'':'<div class="panel shop-ai"><button type="button" class="locate-button" data-tg="shopAi">✨ 上載物品相片，AI 自動填寫（可多張）</button><input type="file" accept="image/*" id="shopAiInput" multiple hidden><p class="note">AI 會認出物品、規格，以及價錢牌上的價錢，自動加入清單，之後可以修改。可以關閉網頁，AI 會在背景完成。</p></div>'}<div data-tg-live="jobs"></div>${shopForm(edit)}<div class="chips" role="group" aria-label="篩選" data-tg-live="filters"></div><div class="tg-list" data-tg-live="list"></div>`,live:{status:statusBar(),jobs:productJobsHtml(),filters,list}};
 }
 function renderShopping(){return `${header('SHOPPING LIST','要買的，都記下來。','相片、地點和價錢 · 旅伴共用，買了就打勾')}<div id="shopPage"></div>`}
 async function pickShopPhoto(file){
  try{let b=await shrink(file,900,.7);if(b.length>380000)b=await shrink(file,600,.6);shopPhoto=b;const p=$('#shopPreview');if(p)p.innerHTML=shopPreview()}
  catch(e){toast('未能讀取這張相片，請改用 JPG 或 PNG，或直接影相。');console.error(e)}
 }
 function paint(el,{sig,shell,live={}}){if(el.dataset.sig!==sig){el.innerHTML=shell;el.dataset.sig=sig}for(const [k,v] of Object.entries(live)){const l=el.querySelector(`[data-tg-live="${k}"]`);if(l)l.innerHTML=v}}
 function refresh(){
  if(!started&&!$('#tgPage'))$('#app').innerHTML=header('KYUSHU 2026','九州口袋旅伴')+'<div id="tgPage"></div>';
  const p=$('#tgPage');if(p)paint(p,page());
  const box=$('#tgDrafts');if(box&&!box.childElementCount&&jobs.length)renderDrafts();
  const sp=$('#shopPage');if(sp)paint(sp,shopPage());
  document.querySelectorAll('[data-tg-day]').forEach(el=>paint(el,daySlot(Number(el.dataset.tgDay))));
  document.querySelectorAll('[data-tg-place]').forEach(el=>paint(el,placeSlot(el.dataset.tgPlace)));
 }
 function render(){
  const p=new URLSearchParams(location.hash.split('?')[1]);if(tabs[p.get('tab')])state.tab=p.get('tab');if(p.has('day'))state.day=Math.min(7,Math.max(1,Number(p.get('day'))||1));
  return `${header('TOGETHER','一起記，一起走。','筆記、開支與共用行程 · 只限旅伴登入，內容不會公開')}<div id="tgPage"></div>`;
 }

 document.addEventListener('submit',e=>{
  const f=e.target.closest('[data-tg-form]');if(!f)return;
  if(f.dataset.tgForm==='login'){e.preventDefault();const v=new FormData(f);loginWithAccount(String(v.get('id')).trim(),String(v.get('password')));return}
  if(state.status!=='ready')return;e.preventDefault();
  const v=new FormData(f),str=k=>String(v.get(k)||'').trim(),day=Number(v.get('day'))||null;
  if(f.dataset.tgForm==='note'){const placeId=f.dataset.placeId||null,place=placeId&&T().places.find(p=>p.id===placeId);if(!str('text'))return;add('notes',{text:str('text').slice(0,1000),day:placeId?null:day,placeId,placeName:place?place.v[1]:null})}
  if(f.dataset.tgForm==='expense'){
   const prices=v.getAll('itemAmount'),items=v.getAll('itemName').map((n,i)=>({name:String(n).trim().slice(0,40),amount:prices[i]===''?null:Math.round(Number(prices[i])*100)/100})).filter(i=>i.name&&(i.amount==null||(i.amount>=0&&i.amount<=1e7))).slice(0,30);
   const sum=items.reduce((t,i)=>t+(i.amount||0),0),amount=v.get('amount')===''?sum:Number(v.get('amount')),split=v.getAll('split').map(String);
   if(!str('title')||!(amount>0)||amount>1e7)return toast('請輸入項目和金額（或物品金額）。');if(!split.length)return toast('請最少選一位分帳旅伴。');
   const exp={title:str('title').slice(0,80),amount:Math.round(amount*100)/100,currency:v.get('currency')==='HKD'?'HKD':'JPY',paidBy:str('paidBy'),split,day:day||today(),items},dup=duplicateOf(exp);
   if(dup&&!confirm(`似乎已經記錄過：\n${dupText(dup)}\n\n仍然要加入嗎？`))return;
   add('expenses',exp);
   f.reset();$('#tgItemRows').innerHTML=itemRow();return;
  }
  if(f.dataset.tgForm==='shop'){
   const price=v.get('price')===''?null:Number(v.get('price'));if(!str('name'))return;if(price!=null&&!(price>=0&&price<=1e7))return toast('價錢不正確。');
   const item={name:str('name').slice(0,80),qty:str('qty').slice(0,30),detail:str('detail').slice(0,500),place:str('place').slice(0,200),price:price==null?null:Math.round(price*100)/100,currency:v.get('currency')==='HKD'?'HKD':'JPY',photo:shopPhoto};
   if(state.shopEdit){update('shopping',state.shopEdit,{...item,ai:false});toast('已儲存')}else add('shopping',{...item,bought:false,boughtBy:null,boughtAt:null});
   state.shopEdit=null;shopPhoto=null;$('#shopPage').dataset.sig='';refresh();return;
  }
  f.reset();
 });
 document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el)return;const d=el.dataset;
  if(d.tg==='login')login();
  if(d.tg==='logout'&&fb)logout();
  if(d.tg==='scan')$('#tgReceipt')?.click();
  if(d.draftDrop&&confirm('確定捨棄？')){fb.fs.deleteDoc(jobRef(d.draftDrop)).catch(()=>toast('未能刪除，請再試。'));delete localEdits[d.draftDrop]}
  if(d.tg==='mergeDrafts')mergeDrafts(d.keys.split(','));
  if(d.draftRetry)fb.fs.updateDoc(jobRef(d.draftRetry),{status:'pending',retries:fb.fs.increment(1)}).catch(()=>toast('未能重試，請再試。'));
  if(d.draftAdd){const x=drafts().find(i=>i.key===d.draftAdd);if(x&&addDraft(x,true))renderDrafts()}
  if(d.tg==='draftsAddAll'){const all=drafts(),ok=all.filter(x=>x.status==='done'&&!draftDup(x,all));let n=0;for(const x of ok)if(addDraft(x,false))n++;else break;renderDrafts();const left=drafts().filter(x=>x.status==='done').length;if(n)toast(`已加入 ${n} 筆${left?`，尚有 ${left} 筆待確認`:''}`)}
  if(d.tg==='itemAdd'){$('#tgItemRows').insertAdjacentHTML('beforeend',itemRow());$('#tgItemRows').lastElementChild.querySelector('input').focus()}
  if(d.tg==='itemDel'){const rows=$('#tgItemRows');el.closest('.tg-line-row').remove();if(!rows.children.length)rows.innerHTML=itemRow()}
  if(d.tg==='retry'){if(fb&&state.user){state.status='checking';refresh();listen()}else load().catch(()=>{})}
  if(d.tgTab){state.tab=d.tgTab;refresh()}
  if(d.tgDel){const [name,id]=d.tgDel.split(':');remove(name,id)}
  if(d.tg==='shopPhoto')$('#shopPhotoInput')?.click();
  if(d.tg==='shopAi')$('#shopAiInput')?.click();
  if(d.tg==='shopPhotoClear'){shopPhoto=null;$('#shopPreview').innerHTML=''}
  if(d.tg==='shopCancel'){state.shopEdit=null;shopPhoto=null;refresh()}
  if(d.shopFilter){state.shopFilter=d.shopFilter;refresh()}
  if(d.shopEdit){const x=state.shopping.find(i=>i.id===d.shopEdit);if(x){state.shopEdit=x.id;shopPhoto=x.photo||null;refresh();$('#shopPage')?.scrollIntoView({behavior:'smooth'})}}
  if(d.shopToggle){const x=state.shopping.find(i=>i.id===d.shopToggle);if(x)update('shopping',x.id,x.bought?{bought:false,boughtBy:null,boughtAt:null}:{bought:true,boughtBy:me().name,boughtAt:Date.now()})}
 });
 document.addEventListener('change',e=>{if(e.target.id==='tgReceipt'&&e.target.files.length){if(state.status==='ready')queueReceipts([...e.target.files]);e.target.value=''}if(e.target.id==='shopPhotoInput'&&e.target.files[0]){pickShopPhoto(e.target.files[0]);e.target.value=''}if(e.target.id==='shopAiInput'&&e.target.files.length){if(state.status==='ready')queueProducts([...e.target.files]);e.target.value=''}});
 document.addEventListener('click',e=>{const img=e.target.closest('[data-shop-zoom]');if(img)img.classList.toggle('zoom')});
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset?.df!==undefined)e.preventDefault()});
 // Draft edits are kept locally while typing and saved to the job when a field is left, so they survive reloads.
 document.addEventListener('change',e=>{const k=e.target.dataset?.draftPick;if(!k)return;e.target.checked?picked.add(k):picked.delete(k);renderDrafts()});
 document.addEventListener('input',e=>{const k=e.target.dataset?.df,card=e.target.closest?.('[data-draft]');if(!k||!card)return;(localEdits[card.dataset.draft]??={})[k]=e.target.value});
 document.addEventListener('change',e=>{const k=e.target.dataset?.df,card=e.target.closest?.('[data-draft]');if(!k||!card||!fb)return;const v=k==='day'?Number(e.target.value):k==='amount'?(e.target.value===''?'':Number(e.target.value)):e.target.value;fb.fs.updateDoc(jobRef(card.dataset.draft),{['edit.'+k]:v}).catch(()=>{});if(k!=='title')renderDrafts()});
 addEventListener('online',()=>{refresh();renderDrafts()});addEventListener('offline',()=>{refresh();renderDrafts()});
 setInterval(()=>{if(jobs.some(j=>!['done','failed'].includes(j.status)))renderDrafts()},30000);
 load().catch(()=>{});
 return Object.freeze({render,renderShopping,refresh,lookupPlace,savePlace,deletePlace,restorePlace,savePlanDay,resetPlanDay,saveFavorites});
})();
