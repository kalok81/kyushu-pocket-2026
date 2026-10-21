'use strict';
window.MapPicker=(()=>{
 let loading;
 function load(){if(window.L)return Promise.resolve();if(loading)return loading;loading=new Promise((resolve,reject)=>{const css=document.createElement('link');css.rel='stylesheet';css.href='vendor/leaflet/leaflet.css';document.head.append(css);const js=document.createElement('script');js.src='vendor/leaflet/leaflet.js';js.onload=resolve;js.onerror=()=>{loading=null;js.remove();reject(new Error('load'))};document.head.append(js)});return loading}
 const areas=[['博多站',33.5902,130.4206],['天神',33.5904,130.3997],['太宰府',33.5215,130.5349],['別府',33.2796,131.5013],['由布院',33.2631,131.3616],['唐津',33.4476,129.9680]];
 async function open({places,coordinates,radius,category,initial,onConfirm,openDialog,esc}){
  const dialog=document.querySelector('#detail');
  openDialog(`<div class="eyebrow">CHOOSE A POINT</div><h2 class="detailtitle">在地圖放一個 Pin</h2><p class="nearby-help">點一下地圖或拖動紅色圖釘，選好後查看 ${radius} 米內已加入的地點。毋須開啟手機定位。</p><div id="mapLoad" role="status">正在載入地圖…</div><div id="mapPickerContent" hidden><div class="map-toolbar"><select id="mapArea" aria-label="跳至區域"><option value="">跳至區域</option>${areas.map((a,i)=>`<option value="${i}">${a[0]}</option>`).join('')}</select><button class="action" id="pinAtCenter">把 Pin 放到地圖中央</button></div><div id="pinMap" class="pin-map" role="region" aria-label="選取位置的地圖；可用方向鍵移動，再按把 Pin 放到地圖中央"></div><div class="map-legend"><b>● 紅色 Pin：選取位置</b>　<em>● 綠點：已加入的地點</em>　圓圈：${radius} 米</div><p id="pinFeedback" class="map-feedback" role="status" aria-live="polite"></p><button class="locate-button map-confirm" id="confirmPin">以此位置查看附近 →</button><p class="note">地圖由 OpenStreetMap 提供，會載入你查看範圍的地圖圖塊。選取位置只保留在本次網頁，不會寫入 Sheet 或分享連結。</p></div>`);
  const mount=document.querySelector('#mapPickerContent');dialog.classList.add('map-picker-dialog');let map;const cleanup=()=>{if(map)map.remove();dialog.classList.remove('map-picker-dialog')};dialog.addEventListener('close',cleanup,{once:true});
  try{await load();if(!dialog.open||document.querySelector('#mapPickerContent')!==mount)return;document.querySelector('#mapLoad').textContent='';document.querySelector('#mapPickerContent').hidden=false;
   const L=window.L,start=initial?[initial.lat,initial.lng]:areas[0].slice(1);let selected={lat:start[0],lng:start[1]};
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
 return Object.freeze({open});
})();
