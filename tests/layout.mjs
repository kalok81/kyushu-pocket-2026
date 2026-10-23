// Layout check: every page and the main dialogs at phone, tablet and desktop widths with long sample data.
// Fails on page-wide horizontal scrolling, content off screen, clipped or spilling text and uneven button rows.
// Run: cd tests && npm run layout   (SHOTS=dir also saves screenshots)
import { chromium } from 'playwright';
import { createServer } from 'node:http';import { readFile, mkdir } from 'node:fs/promises';import { join, extname, normalize } from 'node:path';
import seeded from './layout-seed.mjs';
const root=new URL('../dist/',import.meta.url).pathname,fake=new URL('./fake/',import.meta.url).pathname,out=process.env.SHOTS;
if(out)await mkdir(out,{recursive:true});
const shot=(pg,name,full=true)=>out?pg.screenshot({path:`${out}/${name}.png`,fullPage:full}):null;
const storage='export const getStorage=()=>({}),ref=(s,p)=>({p}),getBlob=async()=>new Blob(["%PDF-1.4"],{type:"application/pdf"}),uploadBytes=async()=>{},deleteObject=async()=>{};';
const srv=createServer(async(q,r)=>{let p=normalize(decodeURIComponent(new URL(q.url,'http://x').pathname)).replace(/^(\.\.[/\\])+/,'');if(p==='/')p='/index.html';try{const b=await readFile(join(root,p));r.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(p)]||'application/octet-stream'});r.end(b)}catch{r.writeHead(404);r.end()}}).listen(0);const base=`http://localhost:${srv.address().port}`;
const days=['2030-03-31','2030-04-01','2030-04-02','2030-04-03','2030-04-04','2030-04-05','2030-04-06'];
const weather={daily:{time:days,weather_code:[0,61,3,1,95,2,0],temperature_2m_max:[20,18,21,22,19,23,24],temperature_2m_min:[11,10,12,13,12,14,15],precipitation_probability_max:[0,80,20,10,90,5,0]}};
const checks=()=>{
 const W=innerWidth,res=[],vis=e=>{const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&e.getClientRects().length};
 const name=e=>{let s=e.tagName.toLowerCase();if(e.id)s+='#'+e.id;if(e.className&&typeof e.className==='string')s+='.'+e.className.trim().split(/\s+/).slice(0,2).join('.');const t=(e.innerText||e.value||'').trim().replace(/\s+/g,' ').slice(0,40);return s+(t?` "${t}"`:'')};
 const scroller=e=>{for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a);if(/(auto|scroll)/.test(s.overflowX)&&a.scrollWidth>a.clientWidth)return true}return false};
 if(document.documentElement.scrollWidth>W+1)res.push(['PAGE-HSCROLL',`page is ${document.documentElement.scrollWidth}px wide in ${W}px`]);
 const root=document.querySelector('#detail[open]')||document.body;
 for(const e of root.querySelectorAll('*')){
  if(!vis(e)||e.closest('.leaflet-container,#printArea,.swal2-container .swal2-file,svg,.sr-only'))continue;
  const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
  if((r.right>W+1||r.left<-1)&&!scroller(e)&&!e.closest('.ui-toast,.swal2-toast,.skip-link'))res.push(['OFFSCREEN',`${name(e)} spans ${Math.round(r.left)}–${Math.round(r.right)}`]);
  const s=getComputedStyle(e);
  const leafText=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if(leafText&&e.scrollWidth>e.clientWidth+2&&s.overflowX!=='visible'&&s.textOverflow!=='ellipsis'&&s.webkitLineClamp==='none'&&!/(auto|scroll)/.test(s.overflowX)&&!['INPUT','TEXTAREA','SELECT'].includes(e.tagName))res.push(['CLIPPED',`${name(e)} needs ${e.scrollWidth}px, has ${e.clientWidth}px`]);
  if(leafText&&s.overflowX==='visible'&&e.scrollWidth>e.clientWidth+2&&e.clientWidth>0&&s.display!=='inline')res.push(['TEXT-SPILLS',`${name(e)} text ${e.scrollWidth}px in ${e.clientWidth}px box`]);
  if(leafText&&r.width<60&&r.height>3*parseFloat(s.lineHeight||s.fontSize*1.4)&&e.innerText.trim().length>4)res.push(['NARROW-WRAP',`${name(e)} ${Math.round(r.width)}px wide, ${Math.round(r.height)}px tall`]);
 }
 // uneven button heights within one row
 for(const row of root.querySelectorAll('.links,.plan-tools,.chips,.topactions,.tg-row,.place-admin,.stop-edit,.ui-actions,.searchrow,.map-toolbar,.shop-actions,.ticket-bottom')){
  if(!vis(row))continue;const bs=[...row.children].filter(c=>vis(c)&&/^(A|BUTTON)$/.test(c.tagName)&&/action|chip|smallbtn|locate|button|btn|swal2/.test(c.className+c.tagName));
  const lines=new Map();for(const b of bs){const r=b.getBoundingClientRect();const k=Math.round(r.top/6);(lines.get(k)||lines.set(k,[]).get(k)).push(r.height)}
  for(const hs of lines.values())if(hs.length>1&&Math.max(...hs)-Math.min(...hs)>4)res.push(['UNEVEN-ROW',`${name(row)} heights ${hs.map(Math.round).join('/')}`]);
 }
 // a single word/character per line in buttons
 for(const b of root.querySelectorAll('button,.action,.chip,.badge')){if(!vis(b))continue;const r=b.getBoundingClientRect(),lh=parseFloat(getComputedStyle(b).lineHeight)||18;if(r.height>lh*2.6+20&&(b.innerText||'').trim().length<14)res.push(['BUTTON-WRAP',`${name(b)} ${Math.round(r.width)}×${Math.round(r.height)}`])}
 return [...new Map(res.map(x=>[x.join('|'),x])).values()];
};
const b=await chromium.launch(),report={};
for(const w of [320,390,768,1280]){
 const pg=await b.newPage({viewport:{width:w,height:w<700?780:900}});const errs=[];pg.on('pageerror',e=>errs.push(String(e)));
 await pg.route('**/vendor/firebase/*.js',r=>{const f=r.request().url().split('/').pop().split('?')[0];f==='firebase-firestore.js'?r.fulfill({body:seeded,contentType:'text/javascript'}):f==='firebase-storage.js'?r.fulfill({body:storage,contentType:'text/javascript'}):r.fulfill({path:fake+f,contentType:'text/javascript'})});
 await pg.route('https://api.open-meteo.com/**',r=>r.fulfill({json:weather,headers:{'Access-Control-Allow-Origin':'*'}}));
 await pg.route('https://open.er-api.com/**',r=>r.fulfill({json:{result:'success',time_last_update_unix:1900000000,rates:{HKD:1,JPY:19.6}},headers:{'Access-Control-Allow-Origin':'*'}}));
 await pg.route(/tile\.openstreetmap|google\.com\/recaptcha/,r=>r.abort());
 await pg.goto(base+'/#home');await shot(pg,`${w}-login`);report[`${w} login`]=await pg.evaluate(checks);
 await pg.fill('[name=id]','amy');await pg.fill('[name=password]','pw12345678');await pg.click('[data-tg-form=login] button');await pg.waitForSelector('.hero h1');
 const states=[['home','#home'],['plan1','#plan?day=1'],['plan2','#plan?day=2'],['explore','#explore'],['nearby','#nearby'],['flights','#flights'],['hotels','#hotels'],['shopping','#shopping'],['notes','#together?tab=notes'],['expenses','#together?tab=expenses'],['checklist','#together?tab=checklist'],['trips','#trips'],['notebook','#notebook']];
 for(const [k,h] of states){await pg.goto(base+'/'+h);await pg.waitForTimeout(900);await shot(pg,`${w}-${k}`);report[`${w} ${k}`]=await pg.evaluate(checks)}
 await pg.goto(base+'/#shopping');await pg.waitForTimeout(600);const grid=pg.locator('[data-shop-view=grid]');if(await grid.count()){await grid.click();await pg.waitForTimeout(400);await shot(pg,`${w}-shopgrid`);report[`${w} shopgrid`]=await pg.evaluate(checks)}
 const dialogs=[
  ['place','#explore',async()=>{await pg.locator('#results [data-place]').first().click()}],
  ['placeform','#explore',async()=>{await pg.locator('#results [data-place]').first().click();await pg.click('#detail [data-place-edit]')}],
  ['stopform','#plan?day=1',async()=>{await pg.click('[data-plan-pick]');await pg.click('#detail [data-stop-new]')}],
  ['picker','#plan?day=1',async()=>{await pg.click('[data-plan-pick]')}],
  ['route','#plan?day=1',async()=>{await pg.locator('[data-route-link]').nth(2).click();await pg.click('#routeGo');await pg.waitForSelector('#routeResults .notice');await pg.click('[data-route-ai]');await pg.waitForTimeout(500)}],
  ['daymenu','#plan?day=1',async()=>{await pg.click('.day-more summary');await pg.waitForTimeout(200)}],
  ['stopmenu','#plan?day=1',async()=>{await pg.locator('[data-stop-more]').last().click();await pg.waitForTimeout(200)}],
  ['daymap','#plan?day=1',async()=>{await pg.click('.day-more summary');await pg.click('[data-day-map]');await pg.waitForTimeout(600)}],
  ['menu','#home',async()=>{await pg.click('#menuBtn');await pg.waitForTimeout(300)}],
  ['notesheet','#together?tab=notes',async()=>{await pg.click('[data-tg=newEntry]');await pg.click('[data-note-kind=coupon]')}],
  ['expensesheet','#together?tab=expenses',async()=>{await pg.click('[data-tg=newEntry]')}],
  ['shopsheet','#shopping',async()=>{await pg.click('[data-tg=shopAdd]')}],
  ['hotelform','#hotels',async()=>{await pg.click('[data-hotel-new]')}],
  ['flightform','#flights',async()=>{await pg.click('[data-flight-new]')}],
  ['docs','#hotels',async()=>{await pg.locator('[data-docs]').nth(1).click();await pg.waitForTimeout(400)}],
  ['confirm','#hotels',async()=>{await pg.locator('.card.hotel .more summary').first().click();await pg.locator('[data-hotel-del]').first().click();await pg.waitForSelector('.ui-pop');await pg.waitForTimeout(500)}],
  ['ratePrompt','#together?tab=expenses',async()=>{await pg.locator('.tg-fx summary').click();await pg.locator('[data-fx-set]').first().click();await pg.waitForSelector('.ui-pop');await pg.waitForTimeout(500)}],
 ];
 for(const [k,h,open] of dialogs){try{await pg.goto(base+'/'+h);await pg.waitForTimeout(700);await open();await pg.waitForTimeout(400);await shot(pg,`${w}-dlg-${k}`,false);report[`${w} dlg-${k}`]=await pg.evaluate(checks)}catch(e){report[`${w} dlg-${k}`]=[['SCRIPT',String(e).slice(0,150)]]}
  await pg.keyboard.press('Escape');await pg.keyboard.press('Escape')}
 if(errs.length)report[`${w} page-errors`]=errs.map(e=>['PAGEERROR',e]);
 await pg.close();
}
await b.close();srv.close();
const bad=Object.entries(report).filter(([,v])=>v.length);
for(const [k,v] of bad)console.log(`\n## ${k}\n`+v.map(x=>`  ${x[0]}: ${x[1]}`).join('\n'));
if(bad.length){console.error(`\nLayout check found problems in ${bad.length} views.`);process.exit(1)}
console.log(`Layout check passed (${Object.keys(report).length} views).`);
