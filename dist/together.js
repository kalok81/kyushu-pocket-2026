'use strict';
// Sign-in gate, trip data and shared notes/expenses/stops/shopping list for travel companions (Firebase).
// Trip data lives in Firestore (trip/data, trip/geo, trip/content); the public site holds no trip details.
window.Together=(()=>{
 // Firebase web config is public by design; access is enforced by firestore.rules and the member list.
 const config={apiKey:'AIzaSyC_qsxlY9mX0OKK5bIXwUXvrrxCOFnc18M',authDomain:'kyushu-2e307.firebaseapp.com',projectId:'kyushu-2e307',storageBucket:'kyushu-2e307.firebasestorage.app',messagingSenderId:'672657048901',appId:'1:672657048901:web:d1e2f7dd92389f78f3ea2c'};
 const tabs={notes:'筆記',expenses:'開支',stops:'共用行程'};
 const state={status:'idle',error:'',user:null,tab:'notes',day:1,notes:[],expenses:[],stops:[],members:[],shopping:[],places:[],placesLoaded:false,shopFilter:'todo',shopEdit:null,trip:{}};
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
 function stop(){unsub.forEach(u=>u());unsub=[];Object.assign(state,{notes:[],expenses:[],stops:[],members:[],shopping:[],places:[],placesLoaded:false,trip:{}})}
 function listen(){
  const {fs,db}=fb;
  const watch=name=>fs.onSnapshot(fs.collection(db,name),{includeMetadataChanges:true},snap=>{
   state[name]=snap.docs.map(d=>({...d.data(),id:d.id,pending:d.metadata.hasPendingWrites})).sort((a,b)=>(b.at||0)-(a.at||0));
   if(state.status!=='ready'){state.status='ready';saveProfile()}
   if(name==='places'){state.placesLoaded=true;if(started)T().applyPlaceEdits(state.places);else start()}
   refresh();
  },err=>{stop();state.status=err.code==='permission-denied'?'denied':'error';state.error=err.code==='permission-denied'?'':'同步失敗，請稍後再試。';refresh()});
  const fail=err=>{stop();state.status=err.code==='permission-denied'?'denied':'error';state.error=err.code==='permission-denied'?'':'同步失敗，請稍後再試。';refresh()};
  const watchTrip=id=>fs.onSnapshot(fs.doc(db,'trip',id),snap=>{
   if(!snap.exists()){if(!snap.metadata.fromCache){state.empty=true;refresh()}return}
   state.empty=false;
   const json=snap.get('json');if(started&&json!==state.trip[id]&&!staleNotice){staleNotice=true;toast('旅程資料已更新，重新整理網頁即可看到。')}
   state.trip[id]=json;start();
  },fail);
  unsub=['notes','expenses','stops','members','shopping','places'].map(watch).concat(['data','geo','content'].map(watchTrip));
 }
 function start(){
  const t=state.trip;if(started||!t.data||!t.geo||!t.content||!state.placesLoaded)return;
  try{const data=JSON.parse(t.data),geo=JSON.parse(t.geo),content=JSON.parse(t.content);started=true;window.TRIP_GEO=geo;document.body.classList.remove('locked');window.startTrip(data,content);T().applyPlaceEdits(state.places)}
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
 async function shrink(file,max=1600,quality=.85){
  const img=await createImageBitmap(file,{imageOrientation:'from-image'}),k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');
  c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.close?.();
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',quality));
  return new Promise((ok,fail)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]);fr.onerror=fail;fr.readAsDataURL(blob)});
 }
 async function scan(file){
  const f=$('[data-tg-form="expense"]'),btn=f?.querySelector('[data-tg="scan"]'),info=$('#tgScanInfo');if(!f)return;
  if(!navigator.onLine)return toast('分析收據需要網絡，可以先手動輸入。');
  btn.disabled=true;btn.textContent='分析中…';info.textContent='正在讀取收據，大約需要數秒至半分鐘。';
  try{
   const r=(await (await callable('scanReceipt',70000))({image:await shrink(file)})).data;
   if(!r.total){info.textContent='讀不到金額，請手動輸入。';return}
   const el=f.elements;if(r.merchant)el.title.value=r.merchant;el.amount.value=r.total;if(r.currency!=='OTHER')el.currency.value=r.currency;
   const day=r.date&&T().days.find(d=>d.iso===r.date.replaceAll('-','/'));if(day)el.day.value=day.n;
   info.textContent=(r.currency==='OTHER'?'⚠️ 收據不是日圓或港幣，請自行換算。':r.confidence==='low'?'⚠️ 相片不太清楚，請仔細檢查。':'已填入，請檢查。')+(r.items.length?' 項目：'+r.items.map(i=>`${i.name} ${i.amount}`).join('、'):'');
   el.title.focus();
  }catch(e){info.textContent=e?.message&&e.code?.startsWith('functions/')?e.message:'未能分析收據，請手動輸入。';console.error(e)}
  finally{btn.disabled=false;btn.textContent='📷 影收據／上載收據'}
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
 const stopSort=(a,b)=>String(a.time||'').localeCompare(String(b.time||''))||(a.at||0)-(b.at||0);

 function noteItem(n){const place=n.placeName?`<span class="badge">${esc(n.placeName)}</span>`:'',day=n.day?`<span class="badge">${esc(dayLabel(n.day))}</span>`:'';return `<article class="tg-item">${meta(n,day+place)}<p class="tg-text">${esc(n.text)}</p>${del('notes',n)}</article>`}
 function stopItem(s){return `<article class="tg-item tg-stop"><div class="time">${esc(s.time||'—')}</div><div>${meta(s)}<h3>${esc(s.title)}</h3>${s.detail?`<p class="tg-text">${esc(s.detail)}</p>`:''}<div class="links"><a class="action" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.title)}" target="_blank" rel="noopener noreferrer">導航 ↗</a>${del('stops',s)}</div></div></article>`}
 function expenseItem(e){return `<article class="tg-item">${meta(e,`<span class="badge">${esc(dayLabel(e.day))}</span>`)}<div class="tg-expense"><h3>${esc(e.title)}</h3><b>${esc(S.format(S.toMinor(e.amount,e.currency),e.currency))}</b></div><p class="note">${esc(nameOf(e.paidBy))} 付款 · 分給 ${esc((e.split||[]).map(nameOf).join('、'))}</p>${del('expenses',e)}</article>`}
 function summary(){
  const bal=S.balances(state.expenses),cs=Object.keys(bal);
  if(!cs.length)return '';
  return `<section class="panel tg-summary"><h3>分帳結算</h3>${cs.map(c=>{const total=state.expenses.filter(e=>e.currency===c).reduce((t,e)=>t+S.toMinor(e.amount,c),0),moves=S.settle(bal[c]);return `<div class="tg-currency"><div class="eyebrow">${c} · 合共 ${esc(S.format(total,c))}</div>${moves.length?moves.map(m=>`<p><b>${esc(nameOf(m.from))}</b> 要畀 <b>${esc(nameOf(m.to))}</b> ${esc(S.format(m.amount,c))}</p>`).join(''):'<p>已經清數。</p>'}</div>`}).join('')}<p class="note">日圓和港幣分開計算，不作匯率換算。</p></section>`;
 }

 function statusBar(){const online=navigator.onLine,pending=['notes','expenses','stops','shopping'].reduce((t,k)=>t+state[k].filter(x=>x.pending).length,0);return `<span>已登入：<b>${esc(me().name)}</b></span><span class="tg-pending-${online?'on':'off'}">${online?pending?`${pending} 項同步中…`:'已同步':'離線中 · 修改會在有網絡時同步'}</span><button class="smallbtn" data-tg="logout">登出</button>`}
 function lists(){
  if(state.tab==='notes')return state.notes.length?state.notes.map(noteItem).join(''):'<div class="empty"><h2>還沒有筆記</h2><p>寫下提醒、想吃的東西或任何旅程點滴。</p></div>';
  if(state.tab==='expenses')return summary()+(state.expenses.length?state.expenses.map(expenseItem).join(''):'<div class="empty"><h2>還沒有開支</h2><p>每筆開支記下誰付款、分給誰，網站會計算誰要畀誰。</p></div>');
  const ss=state.stops.filter(s=>s.day===state.day).sort(stopSort);
  return ss.length?ss.map(stopItem).join(''):`<div class="empty"><h2>${esc(dayLabel(state.day))}</h2><p>這天還沒有共用行程。原有行程在「行程」頁。</p></div>`;
 }
 function forms(){
  if(state.tab==='notes')return `<form class="panel tg-form" data-tg-form="note"><label>筆記<textarea name="text" rows="3" maxlength="1000" required placeholder="例如：別府那天記得帶毛巾"></textarea></label><label>關於<select name="day"><option value="">整個旅程</option>${dayOptions(0)}</select></label><button type="submit" class="locate-button">加入筆記</button></form>`;
  if(state.tab==='expenses'){const ps=people();return `<form class="panel tg-form" data-tg-form="expense"><div class="tg-scan"><button type="button" class="action primary" data-tg="scan">📷 影收據／上載收據</button><input type="file" accept="image/*" id="tgReceipt" hidden><p class="note" id="tgScanInfo">AI 會讀出店名、金額及日期並填入下面，請檢查後才儲存。相片不會保存。</p></div><label>項目<input name="title" maxlength="80" required placeholder="例如：一蘭晚餐"></label><div class="tg-row"><label>金額<input name="amount" type="number" inputmode="decimal" min="0.01" max="10000000" step="0.01" required></label><label>貨幣<select name="currency"><option value="JPY">日圓 ¥</option><option value="HKD">港幣 HK$</option></select></label></div><div class="tg-row"><label>誰付款<select name="paidBy">${ps.map(p=>`<option value="${esc(p.id)}"${p.id===state.user.uid?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>日子<select name="day">${dayOptions(today())}</select></label></div><fieldset><legend>分給</legend>${ps.map(p=>`<label class="tg-check"><input type="checkbox" name="split" value="${esc(p.id)}" checked> ${esc(p.name)}</label>`).join('')}</fieldset><p class="note">旅伴第一次登入後，才會出現在名單中。</p><button type="submit" class="locate-button">記下開支</button></form>`}
  return `<div class="chips" role="group" aria-label="選擇日子">${T().days.map(d=>`<button class="chip ${d.n===state.day?'active':''}" data-tg-stopday="${d.n}" aria-pressed="${d.n===state.day}">D${d.n}</button>`).join('')}</div><form class="panel tg-form" data-tg-form="stop"><div class="tg-row"><label>時間<input name="time" maxlength="20" placeholder="14:00–15:30"></label><label>地點或活動<input name="title" maxlength="80" required placeholder="例如：中洲屋台"></label></div><label>細節<textarea name="detail" rows="2" maxlength="500" placeholder="交通、預約或提醒（可留空）"></textarea></label><button type="submit" class="locate-button">加入 ${esc(dayLabel(state.day))}</button></form>`;
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
  const ss=state.stops.filter(s=>s.day===n).sort(stopSort),ns=state.notes.filter(x=>x.day===n);
  return {sig:'ready',shell:'<div data-tg-live="list"></div>',live:{list:`<div class="sectionhead"><h2>旅伴共用</h2><a class="action" href="#together?tab=stops&day=${n}">＋ 加入</a></div>${ss.length||ns.length?ss.map(stopItem).join('')+ns.map(noteItem).join(''):'<p class="note">這天還沒有旅伴加入的行程或筆記。</p>'}`}};
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
  return `<article class="tg-item shop-item${x.bought?' bought':''}">${x.photo?`<img class="shop-thumb" src="${photoSrc(x.photo)}" alt="${esc(x.name)}" data-shop-zoom>`:''}<div>${meta(x)}<div class="tg-expense"><h3>${esc(x.name)}${x.qty?` <small>· ${esc(x.qty)}</small>`:''}</h3>${price}</div>${x.detail?`<p class="tg-text">${esc(x.detail)}</p>`:''}${x.place?`<p class="shop-place">📍 ${esc(x.place)} <a class="action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}" target="_blank" rel="noopener noreferrer">地圖 ↗</a></p>`:''}${x.bought?`<p class="note">✓ ${esc(x.boughtBy||'旅伴')} 已買 · ${esc(when(x.boughtAt))}</p>`:''}<div class="links"><button class="action${x.bought?'':' primary'}" data-shop-toggle="${esc(x.id)}">${x.bought?'↺ 改回未買':'✓ 已買'}</button><button class="smallbtn" data-shop-edit="${esc(x.id)}">編輯</button>${del('shopping',x)}</div></div></article>`;
 }
 function shopPage(){
  if(state.status!=='ready')return {sig:'wait',shell:'<div class="empty"><h2>正在連接…</h2></div>'};
  const edit=state.shopping.find(x=>x.id===state.shopEdit);if(state.shopEdit&&!edit){state.shopEdit=null;shopPhoto=null}
  const todo=state.shopping.filter(x=>!x.bought),shown=state.shopFilter==='todo'?todo:state.shopFilter==='done'?state.shopping.filter(x=>x.bought):state.shopping;
  const filters=[['todo','未買',todo.length],['done','已買',state.shopping.length-todo.length],['all','全部',state.shopping.length]].map(([k,t,n])=>`<button class="chip ${state.shopFilter===k?'active':''}" data-shop-filter="${k}" aria-pressed="${state.shopFilter===k}">${t} ${n}</button>`).join('');
  const list=shown.length?[...shown].sort((a,b)=>a.bought-b.bought||(b.at||0)-(a.at||0)).map(shopItem).join(''):`<div class="empty"><h2>${state.shopFilter==='done'?'還沒有已買的東西':'清單是空的'}</h2><p>${state.shopFilter==='done'?'買了之後按「✓ 已買」。':'把想買的東西加進來，旅伴都看得到。'}</p></div>`;
  return {sig:['shop',state.shopEdit||'',state.user.uid].join('|'),shell:`<div class="tg-status" data-tg-live="status"></div>${shopForm(edit)}<div class="chips" role="group" aria-label="篩選" data-tg-live="filters"></div><div class="tg-list" data-tg-live="list"></div>`,live:{status:statusBar(),filters,list}};
 }
 function renderShopping(){return `${header('SHOPPING LIST','要買的，都記下來。','相片、地點和價錢 · 旅伴共用，買了就打勾')}<div id="shopPage"></div>`}
 async function pickShopPhoto(file){
  try{let b=await shrink(file,900,.7);if(b.length>380000)b=await shrink(file,600,.6);shopPhoto=b;const p=$('#shopPreview');if(p)p.innerHTML=shopPreview()}
  catch(e){toast('未能讀取這張相片。');console.error(e)}
 }
 function paint(el,{sig,shell,live={}}){if(el.dataset.sig!==sig){el.innerHTML=shell;el.dataset.sig=sig}for(const [k,v] of Object.entries(live)){const l=el.querySelector(`[data-tg-live="${k}"]`);if(l)l.innerHTML=v}}
 function refresh(){
  if(!started&&!$('#tgPage'))$('#app').innerHTML=header('KYUSHU 2026','九州口袋旅伴')+'<div id="tgPage"></div>';
  const p=$('#tgPage');if(p)paint(p,page());
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
  if(f.dataset.tgForm==='expense'){const amount=Number(v.get('amount')),split=v.getAll('split').map(String);if(!str('title')||!(amount>0)||amount>1e7)return toast('請輸入項目和金額。');if(!split.length)return toast('請最少選一位分帳旅伴。');add('expenses',{title:str('title').slice(0,80),amount:Math.round(amount*100)/100,currency:v.get('currency')==='HKD'?'HKD':'JPY',paidBy:str('paidBy'),split,day:day||today()})}
  if(f.dataset.tgForm==='stop'){if(!str('title'))return;add('stops',{day:state.day,time:str('time').slice(0,20),title:str('title').slice(0,80),detail:str('detail').slice(0,500)})}
  if(f.dataset.tgForm==='shop'){
   const price=v.get('price')===''?null:Number(v.get('price'));if(!str('name'))return;if(price!=null&&!(price>=0&&price<=1e7))return toast('價錢不正確。');
   const item={name:str('name').slice(0,80),qty:str('qty').slice(0,30),detail:str('detail').slice(0,500),place:str('place').slice(0,200),price:price==null?null:Math.round(price*100)/100,currency:v.get('currency')==='HKD'?'HKD':'JPY',photo:shopPhoto};
   if(state.shopEdit){update('shopping',state.shopEdit,item);toast('已儲存')}else add('shopping',{...item,bought:false,boughtBy:null,boughtAt:null});
   state.shopEdit=null;shopPhoto=null;$('#shopPage').dataset.sig='';refresh();return;
  }
  f.reset();
 });
 document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el)return;const d=el.dataset;
  if(d.tg==='login')login();
  if(d.tg==='logout'&&fb)logout();
  if(d.tg==='scan')$('#tgReceipt')?.click();
  if(d.tg==='retry'){if(fb&&state.user){state.status='checking';refresh();listen()}else load().catch(()=>{})}
  if(d.tgTab){state.tab=d.tgTab;refresh()}
  if(d.tgStopday){state.day=Number(d.tgStopday);refresh()}
  if(d.tgDel){const [name,id]=d.tgDel.split(':');remove(name,id)}
  if(d.tg==='shopPhoto')$('#shopPhotoInput')?.click();
  if(d.tg==='shopPhotoClear'){shopPhoto=null;$('#shopPreview').innerHTML=''}
  if(d.tg==='shopCancel'){state.shopEdit=null;shopPhoto=null;refresh()}
  if(d.shopFilter){state.shopFilter=d.shopFilter;refresh()}
  if(d.shopEdit){const x=state.shopping.find(i=>i.id===d.shopEdit);if(x){state.shopEdit=x.id;shopPhoto=x.photo||null;refresh();$('#shopPage')?.scrollIntoView({behavior:'smooth'})}}
  if(d.shopToggle){const x=state.shopping.find(i=>i.id===d.shopToggle);if(x)update('shopping',x.id,x.bought?{bought:false,boughtBy:null,boughtAt:null}:{bought:true,boughtBy:me().name,boughtAt:Date.now()})}
 });
 document.addEventListener('change',e=>{if(e.target.id==='tgReceipt'&&e.target.files[0]){scan(e.target.files[0]);e.target.value=''}if(e.target.id==='shopPhotoInput'&&e.target.files[0]){pickShopPhoto(e.target.files[0]);e.target.value=''}});
 document.addEventListener('click',e=>{const img=e.target.closest('[data-shop-zoom]');if(img)img.classList.toggle('zoom')});
 addEventListener('online',refresh);addEventListener('offline',refresh);
 load().catch(()=>{});
 return Object.freeze({render,renderShopping,refresh,lookupPlace,savePlace,deletePlace,restorePlace});
})();
