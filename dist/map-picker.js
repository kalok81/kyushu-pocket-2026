'use strict';
window.MapPicker=(()=>{
 let loading;
 function load(){if(window.L)return Promise.resolve();if(loading)return loading;loading=new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='vendor/leaflet/leaflet.css';document.head.append(css);const js=document.createElement('script');js.src='vendor/leaflet/leaflet.js';js.onload=resolve;js.onerror=()=>{loading=null;js.remove();reject(new Error('load'))};document.head.append(js)});return loading}
 async function open({areas=[],places,coordinates,radius,category,initial,onConfirm,openDialog,esc}){
  const dialog=document.querySelector('#detail');
  openDialog(`${window.Kit.sheetHead("在地圖放一個 Pin")}<p class="nearby-help">點一下地圖或拖動紅色圖釘，選好後查看 ${radius} 米內已加入的地點。毋須開啟手機定位。</p><div id="mapLoad">${window.Kit.dots("正在載入地圖…")}</div><div id="mapPickerContent" hidden><div class="map-toolbar"><select id="mapArea" aria-label="跳至區域"><option value="">跳至區域</option>${areas.map((a,i)=>`<option value="${i}">${a[0]}</option>`).join('')}</select>${window.Kit.btn("把 Pin 放到地圖中央", { size: "sm", icon: "pin", attrs: { id: "pinAtCenter" } })}</div><div id="pinMap" class="pin-map" role="region" aria-label="選取位置的地圖；可用方向鍵移動，再按把 Pin 放到地圖中央"></div><div class="map-legend"><b>● 紅色 Pin：選取位置</b>　<em>● 綠點：已加入的地點</em>　圓圈：${radius} 米</div><p id="pinFeedback" class="map-feedback" role="status" aria-live="polite"></p>${window.Kit.btn("以此位置查看附近", { variant: "primary", cls: "btn-block map-confirm", attrs: { id: "confirmPin" } })}<p class="note">地圖由 OpenStreetMap 提供，會載入你查看範圍的地圖圖塊。選取位置只保留在本次網頁，不會寫入 Sheet 或分享連結。</p></div>`);
  const mount=document.querySelector('#mapPickerContent');dialog.classList.add('map-picker-dialog');let map;const cleanup=()=>{if(map)map.remove();dialog.classList.remove('map-picker-dialog')};dialog.addEventListener('close',cleanup,{once:true});
  try{await load();if(!dialog.open||document.querySelector('#mapPickerContent')!==mount)return;document.querySelector('#mapLoad').textContent='';document.querySelector('#mapPickerContent').hidden=false;
   const L=window.L,start=initial?[initial.lat,initial.lng]:areas[0]?areas[0].slice(1):(()=>{const p=Object.values(coordinates).flat()[0];return p?[p.lat,p.lng]:[35.681,139.767]})();let selected={lat:start[0],lng:start[1]};
   map=L.map('pinMap',{scrollWheelZoom:false}).setView(start,16);
   const tile=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
   tile.on('tileerror',()=>{const status=document.querySelector('#mapLoad');if(status)status.textContent='部分地圖未能載入，請檢查網絡；仍可選取位置或稍後重試。'});
   const pin=L.marker(start,{draggable:true,icon:L.divIcon({className:'map-pin',html:'<span></span>',iconSize:[32,42],iconAnchor:[16,34]}),title:'拖動選取位置',alt:'選取位置的紅色圖釘',autoPan:true}).addTo(map);
   const circle=L.circle(start,{radius,color:'#bd593b',weight:1,fillOpacity:0.08,interactive:false}).addTo(map);
   function select(latlng,name=''){selected={lat:latlng.lat,lng:latlng.lng};pin.setLatLng(latlng);circle.setLatLng(latlng);const count=window.Nearby.find(places,coordinates,selected,radius,category).length;document.querySelector('#pinFeedback').textContent=`${name?name+' · ':''}已選位置 ${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)} · ${radius}米內有 ${count} 個符合分類的地點`}
   for(const p of places)for(const c of coordinates[p.id]||[]){const dot=L.circleMarker([c.lat,c.lng],{radius:5,color:'#fff',weight:1.5,fillColor:'#173f3a',fillOpacity:0.9,bubblingMouseEvents:false}).addTo(map);dot.bindTooltip(esc(p.v[1])+(c.label?' · '+esc(c.label):''));dot.on('click',()=>select(L.latLng(c.lat,c.lng),p.v[1]))}
   map.on('click',e=>select(e.latlng));pin.on('dragend',()=>select(pin.getLatLng()));document.querySelector('#pinAtCenter').onclick=()=>select(map.getCenter());document.querySelector('#mapArea').onchange=e=>{if(e.target.value==='')return;const a=areas[Number(e.target.value)],ll=L.latLng(a[1],a[2]);map.setView(ll,16);select(ll,a[0])};
   document.querySelector('#confirmPin').onclick=()=>{onConfirm({...selected});dialog.close()};map.invalidateSize();select(pin.getLatLng());
  }catch{const status=document.querySelector('#mapLoad');if(status)status.textContent='地圖未能載入，請檢查網絡後關閉再試；你仍可使用手機定位。'}
 }
 // The day's route: numbered stops in order with the way between them along the streets (lines(stops) gives one
 // [mode, points] per leg: walking dotted, by road solid; a straight dashed line until then, or where there is none,
 // e.g. a train), a Google Maps link for directions. Tapping a stop (pin or list) shows how to get there, and
 // transit(from, to, box) puts Google's directions by public transport for that leg in the box.
 async function route({title,stops,openDialog,esc,lines,transit}){
  const dialog=document.querySelector('#detail'),pts=stops.slice(0,10);
  const gmaps=pts.length>1?`https://www.google.com/maps/dir/${pts.map(s=>`${s.lat},${s.lng}`).join('/')}`:`https://www.google.com/maps/search/?api=1&query=${pts[0].lat},${pts[0].lng}`;
  openDialog(`${window.Kit.sheetHead(esc(title), "當天路線")}<div id="mapLoad">${window.Kit.dots("正在載入地圖…")}</div><div id="routeMap" class="pin-map route-map" role="region" aria-label="當天路線地圖"></div><div id="routeInfo" class="route-info" aria-live="polite">點地圖上的號碼或下面的站點，看怎樣去。</div><div id="routeTransit"></div><ol class="route-list">${stops.map((s,k)=>`<li><button type="button" data-route-stop="${k}"><b>${s.n}</b><span>${esc(s.time)}</span>${esc(s.title)}</button></li>`).join('')}</ol>${window.Kit.btn("在 Google 地圖查看路線", { variant: "primary", cls: "btn-block route-go", href: gmaps, external: true })}<p class="note">${stops.length>10?'Google 地圖連結最多包括頭 10 個站點。':''}<span class="route-key"><i class="road"></i>道路（巴士、的士）<i class="walk"></i>步行<i class="none"></i>直線（火車或未有路線）</span>同一時間有多個選擇時，只顯示第一個；沒有座標的站點不會顯示。地圖由 OpenStreetMap 提供，路線由 Google 地圖提供。</p>`);
  dialog.classList.add('map-picker-dialog');let map;const end=()=>{if(map)map.remove();map=null;dialog.classList.remove('map-picker-dialog');dialog.removeEventListener('click',pick)};dialog.addEventListener('close',end,{once:true});
  let show=()=>{};const pick=e=>{const b=e.target.closest('[data-route-stop]');if(b)show(Number(b.dataset.routeStop),true);const t=e.target.closest('[data-route-transit]');if(t&&transit){const k=Number(t.dataset.routeTransit);t.remove();transit(stops[k-1],stops[k],document.querySelector('#routeTransit'))}};dialog.addEventListener('click',pick);
  try{await load();const el=document.querySelector('#routeMap');if(!dialog.open||!el)return;document.querySelector('#mapLoad').remove();
   const L=window.L;map=L.map(el,{scrollWheelZoom:false});
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
   const ll=stops.map(s=>[s.lat,s.lng]),style={none:{color:'#183e39',weight:3,opacity:.55,dashArray:'6 8'},WALK:{color:'#2f7d4f',weight:4,opacity:.85,dashArray:'1 7',lineCap:'round'},DRIVE:{color:'#183e39',weight:4,opacity:.8}};
   const legs=ll.slice(1).map((b,k)=>L.polyline([ll[k],b],style.none).addTo(map));
   const marks=stops.map((s,k)=>L.marker([s.lat,s.lng],{icon:L.divIcon({className:'route-pin'+(typeof s.n==='number'?'':' route-pin-start'),html:`<span>${s.n}</span>`,iconSize:[28,28],iconAnchor:[14,14]}),title:s.title,alt:`${s.n} ${s.title}`}).addTo(map).bindTooltip(esc(`${s.n}. ${s.title}`)).on('click',()=>show(k)));
   show=(k,pan)=>{const s=stops[k],info=document.querySelector('#routeInfo');if(!s||!info)return;legs.forEach((l,j)=>l.setStyle({weight:j===k-1?7:4}));document.querySelectorAll('[data-route-stop]').forEach(b=>b.classList.toggle('on',Number(b.dataset.routeStop)===k));
    info.innerHTML=`<b>${esc(String(s.n))}. ${esc(s.title)}</b>${s.time?` <small>${esc(s.time)}</small>`:''}<br>${k?`由「${esc(stops[k-1].title)}」：${s.leg?esc(s.leg):'未有交通，可在行程按「查交通」。'}`:'這天由這裏出發。'}${k&&transit?window.Kit.btn('Google 交通指引',{size:'sm',variant:'ghost',icon:'train',attrs:{'data-route-transit':k}}):''}`;const tb=document.querySelector('#routeTransit');if(tb)tb.innerHTML='';if(pan){map.panTo(ll[k]);marks[k].openTooltip()}};
   if(ll.length>1)map.fitBounds(ll,{padding:[30,30],maxZoom:16});else map.setView(ll[0],15);
   map.invalidateSize();
   if(lines&&ll.length>1)lines(stops).then(got=>{if(!map)return;got.forEach((g,k)=>{if(g&&g.pts.length>1)legs[k].setLatLngs(g.pts).setStyle(style[g.mode]||style.DRIVE)})}).catch(()=>{});
  }catch{const status=document.querySelector('#mapLoad');if(status)status.textContent='地圖未能載入，請檢查網絡；仍可按下面的 Google 地圖連結。'}
 }
 return Object.freeze({open,route,load});
})();
