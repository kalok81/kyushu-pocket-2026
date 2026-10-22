export const getFunctions=()=>({});
export const httpsCallable=(f,name)=>async()=>{const e=new Error('not available in tests');e.code='functions/unavailable';throw e};
