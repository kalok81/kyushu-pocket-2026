export const getFunctions=()=>({});
// Canned route suggestions; other functions are unavailable in tests.
export const httpsCallable=(f,name)=>async data=>{
 if(name==='suggestRoutes'){window.routeRequest=data;return {data:{estimated:false,options:data.mode==='WALK'?[{minutes:12,meters:950,fare:null,steps:[{mode:'WALK',minutes:12,meters:950}]}]:[{minutes:14,meters:3200,fare:{currency:'JPY',amount:210},steps:[{mode:'WALK',minutes:4,meters:300},{mode:'TRANSIT',vehicle:'SUBWAY',line:'銀座線',headsign:'渋谷',from:'上野',to:'淺草',stops:3,depart:'10:07',arrive:'10:12',minutes:5},{mode:'WALK',minutes:5,meters:400}]}]}}}
 const e=new Error('not available in tests');e.code='functions/unavailable';throw e};
