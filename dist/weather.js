'use strict';
// Daily forecast from Open-Meteo (free, no key; only rounded coordinates are sent). Covers the past week and the next
// 16 days; each area is cached on the phone for 3 hours and reused offline.
window.Weather=(()=>{
 const KEY='pocket-weather',FRESH=3*36e5,pending=new Map();
 const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
 const write=all=>{try{localStorage.setItem(KEY,JSON.stringify(all))}catch{}};
 const CODES=[[[0],'☀️','晴'],[[1],'🌤','大致晴朗'],[[2],'⛅','局部多雲'],[[3],'☁️','陰'],[[45,48],'🌫','霧'],[[51,53,55,56,57],'🌦','毛毛雨'],[[61,63,66,80,81],'🌧','有雨'],[[65,67,82],'🌧','大雨'],[[71,73,75,77,85,86],'🌨','有雪'],[[95,96,99],'⛈','雷暴']];
 const describe=code=>{const c=CODES.find(([list])=>list.includes(code));return c?{icon:c[1],text:c[2]}:{icon:'🌡',text:''}};
 // Resolves {'YYYY-MM-DD': {code, max, min, rain}} for the area around lat/lng (about 10 km).
 function forecast(lat,lng){
  const k=`${lat.toFixed(1)},${lng.toFixed(1)}`,all=read(),hit=all[k];
  if(hit&&(Date.now()-hit.at<FRESH||!navigator.onLine))return Promise.resolve(hit.days);
  if(pending.has(k))return pending.get(k);
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&past_days=7&forecast_days=16`;
  const p=fetch(url).then(r=>r.ok?r.json():Promise.reject(r.status)).then(j=>{
   const d=j.daily,days={};d.time.forEach((t,i)=>{days[t]={code:d.weather_code[i],max:d.temperature_2m_max[i],min:d.temperature_2m_min[i],rain:d.precipitation_probability_max[i]}});
   const now=read();for(const [key,v] of Object.entries(now))if(Date.now()-v.at>7*864e5)delete now[key];
   now[k]={at:Date.now(),days};write(now);return days;
  }).catch(()=>hit?.days||null).finally(()=>pending.delete(k));
  pending.set(k,p);return p;
 }
 return Object.freeze({forecast,describe});
})();
