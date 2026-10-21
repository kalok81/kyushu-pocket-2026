'use strict';
// Public place coordinates only. Device positions stay in memory in app.js.
window.Nearby=Object.freeze({
 distance(a,b){const rad=Math.PI/180,dl=(b.lat-a.lat)*rad,dn=(b.lng-a.lng)*rad,h=Math.sin(dl/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dn/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))},
 find(places,coordinates,position,radius,category='全部'){
  if(!position||!Number.isFinite(position.lat)||!Number.isFinite(position.lng)||![100,200,500].includes(radius))return [];
  return places.filter(p=>category==='全部'||p.cats.includes(category)).flatMap(p=>{
   const candidates=(coordinates[p.id]||[]).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lng)).map(c=>({point:c,distance:this.distance(position,c)})).sort((a,b)=>a.distance-b.distance);
   return candidates.length&&candidates[0].distance<=radius+1e-6?[{place:p,...candidates[0]}]:[];
  }).sort((a,b)=>a.distance-b.distance||a.place.id.localeCompare(b.place.id));
 }
});
