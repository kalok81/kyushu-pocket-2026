'use strict';
// Expense splitting only. Amounts are handled in minor units (yen, HK cents) so shares always add up.
window.Split=Object.freeze({
 currencies:Object.freeze({JPY:{symbol:'¥',decimals:0},HKD:{symbol:'HK$',decimals:2},KRW:{symbol:'₩',decimals:0},TWD:{symbol:'NT$',decimals:0},THB:{symbol:'฿',decimals:2},CNY:{symbol:'CN¥',decimals:2},SGD:{symbol:'S$',decimals:2},MYR:{symbol:'RM',decimals:2},USD:{symbol:'US$',decimals:2},EUR:{symbol:'€',decimals:2},GBP:{symbol:'£',decimals:2},AUD:{symbol:'A$',decimals:2},CAD:{symbol:'C$',decimals:2},VND:{symbol:'₫',decimals:0},PHP:{symbol:'₱',decimals:2},IDR:{symbol:'Rp',decimals:0}}),
 toMinor(amount,currency){return Math.round(Number(amount)*10**this.currencies[currency].decimals)},
 format(minor,currency){const c=this.currencies[currency];return c.symbol+(minor/10**c.decimals).toLocaleString('en-US',{minimumFractionDigits:c.decimals,maximumFractionDigits:c.decimals})},
 balances(expenses){
  const out={};
  for(const e of expenses){
   if(!this.currencies[e.currency]||!e.paidBy||!Array.isArray(e.split)||!e.split.length)continue;
   const minor=this.toMinor(e.amount,e.currency);if(!Number.isFinite(minor)||minor<=0)continue;
   const b=out[e.currency]||(out[e.currency]={}),share=Math.floor(minor/e.split.length),rest=minor-share*e.split.length;
   b[e.paidBy]=(b[e.paidBy]||0)+minor;
   e.split.forEach((uid,i)=>{b[uid]=(b[uid]||0)-share-(i<rest?1:0)});
  }
  return out;
 },
 settle(balance){
  const debtors=[],creditors=[];
  for(const [uid,v] of Object.entries(balance)){if(v<0)debtors.push({uid,v:-v});else if(v>0)creditors.push({uid,v})}
  const order=(a,b)=>b.v-a.v||a.uid.localeCompare(b.uid);debtors.sort(order);creditors.sort(order);
  const moves=[];let i=0,j=0;
  while(i<debtors.length&&j<creditors.length){
   const amount=Math.min(debtors[i].v,creditors[j].v);moves.push({from:debtors[i].uid,to:creditors[j].uid,amount});
   if(!(debtors[i].v-=amount))i++;if(!(creditors[j].v-=amount))j++;
  }
  return moves;
 }
});
