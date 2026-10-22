'use strict';
// Confirmations, prompts and toasts through SweetAlert2 (vendor/sweetalert2), styled with the site's buttons.
// While the detail <dialog> is open the rest of the page is inert, so popups are placed inside it.
window.UI=(()=>{
 const target=()=>document.querySelector('#detail')?.open?'#detail':'body';
 const base=()=>({target:target(),heightAuto:false,buttonsStyling:false,reverseButtons:true,focusCancel:false,customClass:{popup:'ui-pop',confirmButton:'locate-button',cancelButton:'action',input:'search',actions:'ui-actions'}});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return Object.freeze({
  // Resolves true only when the confirm button is pressed (cancel, Esc or tapping outside give false).
  async confirm(title,{text='',list=null,ok='確定',cancel='取消',danger=false}={}){
   const r=await window.Swal.fire({...base(),title,icon:danger?'warning':'question',...(list?{html:`${text?`<p>${esc(text)}</p>`:''}<ul class="ui-list">${list.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`}:{text}),showCancelButton:true,confirmButtonText:ok,cancelButtonText:cancel});
   return r.isConfirmed;
  },
  // Resolves the entered text, or null when cancelled.
  async prompt(title,value='',placeholder=''){
   const r=await window.Swal.fire({...base(),title,input:'text',inputValue:value,inputPlaceholder:placeholder,inputAttributes:{maxlength:'60'},showCancelButton:true,confirmButtonText:'儲存',cancelButtonText:'取消'});
   return r.isConfirmed?String(r.value??''):null;
  },
  toast(text){window.Swal.fire({target:target(),toast:true,position:'bottom',showConfirmButton:false,timer:2600,title:text,customClass:{popup:'ui-toast'}})}
 });
})();
