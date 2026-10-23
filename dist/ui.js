'use strict';
// Confirmations, prompts and toasts through SweetAlert2 (vendor/sweetalert2), styled with the site's buttons.
// SweetAlert2 loads after the page (it is not needed to show it); if it cannot load, the browser's own dialogs are used.
// While the detail <dialog> is open the rest of the page is inert, so popups are placed inside it.
window.UI=(()=>{
 let loading=null;
 const lib=()=>window.Swal?Promise.resolve(window.Swal):loading??=new Promise((ok,no)=>{const s=document.createElement('script');s.src='vendor/sweetalert2/sweetalert2.all.min.js?v=11.26.25';s.onload=()=>ok(window.Swal);s.onerror=()=>{loading=null;s.remove();no(new Error('sweetalert2'))};document.head.append(s)});
 const idle=window.requestIdleCallback||(f=>setTimeout(f,1500));addEventListener('load',()=>idle(()=>lib().catch(()=>{})));
 const target=()=>document.querySelector('#detail')?.open?'#detail':'body';
 const base=()=>({target:target(),heightAuto:false,buttonsStyling:false,reverseButtons:true,focusCancel:false,customClass:{popup:'ui-pop',confirmButton:'btn btn-primary',cancelButton:'btn btn-outline',input:'search',actions:'ui-actions'}});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // SweetAlert2 finishes closing (and gives the page its scrolling back) at the end of its hide animation. A popup shown
 // inside the detail sheet never gets there when the sheet closes at the same moment (a hidden element plays no
 // animation), which left the page unable to scroll: clear what it leaves behind once no popup is showing.
 const tidy=()=>setTimeout(()=>{
  if(document.querySelector('.swal2-container .swal2-popup.swal2-show'))return;
  document.querySelectorAll('.swal2-container').forEach(c=>c.remove());
  for(const el of [document.documentElement,document.body])el.classList.remove('swal2-shown','swal2-height-auto','swal2-no-backdrop','swal2-toast-shown');
  document.body.style.removeProperty('padding-right');document.body.style.removeProperty('overflow');
 },500);
 document.addEventListener('close',e=>{if(e.target?.id==='detail')tidy()},true);
 return Object.freeze({
  // Resolves true only when the confirm button is pressed (cancel, Esc or tapping outside give false).
  async confirm(title,{text='',list=null,ok='確定',cancel='取消',danger=false}={}){
   const b=base();if(danger)b.customClass.confirmButton='btn btn-danger';
   const Swal=await lib().catch(()=>null);if(!Swal)return window.confirm([title,text,...(list||[])].filter(Boolean).join('\n'));
   const r=await Swal.fire({...b,title,icon:danger?'warning':'question',...(list?{html:`${text?`<p>${esc(text)}</p>`:''}<ul class="ui-list">${list.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`}:{text}),showCancelButton:true,confirmButtonText:ok,cancelButtonText:cancel});
   tidy();return r.isConfirmed;
  },
  // Resolves the entered text, or null when cancelled.
  async prompt(title,value='',placeholder=''){
   const Swal=await lib().catch(()=>null);if(!Swal)return window.prompt(title,value);
   const r=await Swal.fire({...base(),title,input:'text',inputValue:value,inputPlaceholder:placeholder,inputAttributes:{maxlength:'60'},showCancelButton:true,confirmButtonText:'儲存',cancelButtonText:'取消'});
   tidy();return r.isConfirmed?String(r.value??''):null;
  },
  // Resolves the chosen key of options ({key: label}), or null when cancelled.
  async choose(title,options,value=''){
   const Swal=await lib().catch(()=>null);if(!Swal)return null;
   const r=await Swal.fire({...base(),title,input:'select',inputOptions:options,inputValue:value,showCancelButton:true,confirmButtonText:'儲存',cancelButtonText:'取消'});
   tidy();return r.isConfirmed?String(r.value??''):null;
  },
  toast(text){const t=target();lib().then(Swal=>Swal.fire({target:t,toast:true,position:'bottom',showConfirmButton:false,timer:2600,title:text,customClass:{popup:'ui-toast'}}),()=>{const el=document.querySelector('#toast');if(el){el.textContent=text;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2600)}})}
 });
})();
