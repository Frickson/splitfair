
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
// Receipt analysis uses Gemini via a protected Supabase Edge Function.
// The Gemini API key is never present in browser source code.
async function scanReceiptWithGemini(file,onProgress=()=>{}){
  if(!file?.type.startsWith('image/')||file.size>15*1024*1024||file.size===0)throw Error('Choose an image under 15 MB.');
  onProgress('Preparing photo for AI analysis…');
  const img=new Image(),url=URL.createObjectURL(file);
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Image could not be opened. Try JPEG or PNG.'));img.src=url;});
    const maxSide=1500,ratio=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw Error('Image processing unavailable.');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(Error('Could not compress receipt.')),'image/jpeg',0.75));
    if(blob.size>2_900_000)throw Error('Compressed photo is too large. Try a smaller image.');
    onProgress('Sending receipt securely for Gemini analysis…');
    const imageBase64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(Error('Could not read compressed receipt.'));
      reader.readAsDataURL(blob);
    });
    const {data,error}=await client.functions.invoke('scan-receipt',{body:{image:imageBase64,mimeType:'image/jpeg'}});
    if(error){
      let details=error.message||'AI scan failed';
      try{if(error.context?.json){const body=await error.context.json();details=body.error||details}}catch{}
      throw Error(details);
    }
    if(data?.error)throw Error(data.error);
    return data;
  }finally{URL.revokeObjectURL(url)}
}
const $=id=>document.getElementById(id);
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=(id,yes=true)=>$(id).classList.toggle('hidden',!yes);
let client,current=null,groups=[],group=null,members=[],expenses=[],payments=[],edit=null,selected=new Set(),channel=null;
const cfg=window.SPLITFAIR_CONFIG||{};
const notify=(message)=>{const el=$('toast');el.textContent=message;show('toast');setTimeout(()=>show('toast',false),5000)};
const amount=s=>{s=String(s).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null};
const money=n=>new Intl.NumberFormat('en-SG',{style:'currency',currency:group?.currency||'SGD'}).format(n/100);
const person=id=>members.find(m=>m.user_id===id)?.display_name||'Member';
const view=v=>['setup','auth','workspace','groupDialog','profileDialog','paymentDialog'].forEach(id=>show(id,id===v));
const unwrap=(r)=>{if(r.error)throw r.error;return r.data};
const equal=(n,ids)=>Object.fromEntries(ids.map((id,i)=>[id,Math.floor(n/ids.length)+(i<n%ids.length?1:0)]));
// Invite tokens are the existing random group invite codes; no separate referral database is needed.
const INVITE_KEY='splitfair-pending-invite-v1';
const INVITE_MAX_AGE=48*60*60*1000;
const validInvite=code=>/^[A-F0-9]{18}$/.test(code);
function captureInviteLink(){
 const url=new URL(window.location.href);
 const raw=url.searchParams.get('invite');
 if(raw===null)return;
 const code=raw.trim().toUpperCase();
 if(validInvite(code))localStorage.setItem(INVITE_KEY,JSON.stringify({code,savedAt:Date.now()}));
 else queueMicrotask(()=>notify('This referral link is invalid. Ask your friend for a new link.'));
 url.searchParams.delete('invite');
 history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
function pendingInvite(){
 try{
  const item=JSON.parse(localStorage.getItem(INVITE_KEY)||'null');
  if(item&&validInvite(item.code)&&Number.isFinite(item.savedAt)&&Date.now()-item.savedAt>=0&&Date.now()-item.savedAt<INVITE_MAX_AGE)return item.code;
 }catch(e){}
 localStorage.removeItem(INVITE_KEY);
 return null;
}
let inviteJoining=false;
async function acceptPendingInvite(user){
 const code=pendingInvite();
 if(!code||inviteJoining)return null;
 inviteJoining=true;
 const meta=user.user_metadata||{};
 const displayName=String(meta.display_name||meta.full_name||meta.name||user.email?.split('@')[0]||'Member').trim().slice(0,80)||'Member';
 try{
  const id=unwrap(await client.rpc('join_split_group',{p_code:code,p_display_name:displayName}));
  localStorage.removeItem(INVITE_KEY);
  notify('Referral accepted! You joined the group.');
  return id;
 }catch(err){
  // Do not retry a permanently invalid code on every reload. Transient errors can be retried.
  if(/invalid invite code|invalid invite details/i.test(err.message||''))localStorage.removeItem(INVITE_KEY);
  notify('Could not join from referral link: '+(err.message||'Please try again.'));
  return null;
 }finally{inviteJoining=false}
}
const calculate=()=>{
 const b=Object.fromEntries(members.map(x=>[x.user_id,0]));
 for(const e of expenses){b[e.paid_by]=(b[e.paid_by]||0)+Number(e.amount_cents);for(const [id,v] of Object.entries(e.shares))b[id]=(b[id]||0)-Number(v)}
 for(const p of payments){b[p.from_user]=(b[p.from_user]||0)+Number(p.amount_cents);b[p.to_user]=(b[p.to_user]||0)-Number(p.amount_cents)}
 const d=Object.entries(b).filter(x=>x[1]<0).map(([id,n])=>({id,n:-n})).sort((a,b)=>b.n-a.n);
 const c=Object.entries(b).filter(x=>x[1]>0).map(([id,n])=>({id,n})).sort((a,b)=>b.n-a.n);
 let i=0,j=0;const settle=[];
 while(i<d.length&&j<c.length){const n=Math.min(d[i].n,c[j].n);if(n)settle.push({from:d[i].id,to:c[j].id,n});d[i].n-=n;c[j].n-=n;if(!d[i].n)i++;if(!c[j].n)j++}
 return {b,settle};
};
async function loadGroups(preferred){
 current=unwrap(await client.auth.getUser()).user;
 if(!current){view('auth');return}
 const joinedByReferral=await acceptPendingInvite(current);
 $('identity').textContent=current.email||'';
 show('logout');show('openProfile');
 const memberships=unwrap(await client.from('group_members').select('group_id').eq('user_id',current.id));
 const ids=memberships.map(x=>x.group_id);
 if(!ids.length){groups=[];group=null;view('workspace');show('noGroups');show('groupContent',false);show('groupShare',false);$('groupSelect').innerHTML='';return}
 groups=unwrap(await client.from('groups').select('*').in('id',ids).order('created_at',{ascending:false}));
 group=groups.find(x=>x.id===(joinedByReferral||preferred||localStorage.getItem('splitfair-last-group')))||groups[0];
 $('groupSelect').innerHTML=groups.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
 $('groupSelect').value=group.id;
 view('workspace');show('noGroups',false);show('groupContent');
 await loadGroup();
}
async function loadGroup(){
 if(!group)return;
 const id=group.id;localStorage.setItem('splitfair-last-group',id);
 const results=await Promise.all([
 client.from('group_members').select('*').eq('group_id',id).order('joined_at'),
 client.from('expenses').select('*').eq('group_id',id).order('created_at',{ascending:false}),
 client.from('payments').select('*').eq('group_id',id).order('created_at',{ascending:false})
 ]);
 const [m,e,p]=results.map(unwrap);
 if(group?.id!==id)return;
 members=m;expenses=e;payments=p;resetForm();render();
 if(channel)await client.removeChannel(channel);
 channel=client.channel('splitfair-'+id)
 .on('postgres_changes',{event:'*',schema:'public',table:'expenses',filter:'group_id=eq.'+id},refresh)
 .on('postgres_changes',{event:'*',schema:'public',table:'payments',filter:'group_id=eq.'+id},refresh)
 .on('postgres_changes',{event:'*',schema:'public',table:'group_members',filter:'group_id=eq.'+id},refresh).subscribe();
}
let busy=false;
async function refresh(){if(busy||!group)return;busy=true;try{
 const id=group.id;const [m,e,p]=await Promise.all([
 client.from('group_members').select('*').eq('group_id',id).order('joined_at'),
 client.from('expenses').select('*').eq('group_id',id).order('created_at',{ascending:false}),
 client.from('payments').select('*').eq('group_id',id).order('created_at',{ascending:false})]);
 members=unwrap(m);expenses=unwrap(e);payments=unwrap(p);if(group?.id===id)render();
 }catch(e){notify(e.message)}finally{busy=false}}
function render(){
 $('groupShare').innerHTML='<div class="row"><span>Invite code: <strong>'+safe(group.invite_code)+'</strong></span><div class="actions"><button type="button" id="copyInvite" class="btn slim">Copy code</button><button type="button" id="generateReferral" class="btn slim primary">Generate referral link</button></div></div><div id="referralResult" class="hidden" style="margin-top:12px"><label class="tiny" for="referralUrl">Share this group referral link</label><div class="row"><input id="referralUrl" readonly aria-label="Group referral link" style="flex:1;min-width:170px"><button type="button" id="copyReferral" class="btn slim">Copy link</button></div></div><div class="tiny muted" style="margin-top:10px">Anyone with the link can join this group automatically after signing in. Share it only with people you trust.</div>';
 show('groupShare');
 $('copyInvite').onclick=()=>navigator.clipboard.writeText(group.invite_code).then(()=>notify('Invite code copied')).catch(()=>notify('Copy the code above'));
 $('generateReferral').onclick=()=>{
  const referral=new URL(location.origin+location.pathname);
  referral.searchParams.set('invite',group.invite_code);
  const link=referral.toString();
  $('referralUrl').value=link;
  show('referralResult');
  const copy=()=>navigator.clipboard.writeText(link).then(()=>notify('Referral link copied — send it to your friends.')).catch(()=>{ $('referralUrl').select();notify('Select and copy the link above.'); });
  $('copyReferral').onclick=copy;
  copy();
 };
 $('members').innerHTML=members.map(m=>'<span class="member">'+safe(m.display_name)+(m.user_id===current.id?' (you)':'')+'</span>').join('');
 $('memberCount').textContent=members.length+' people';
 $('spent').textContent=money(expenses.reduce((s,x)=>s+Number(x.amount_cents),0));
 $('count').textContent=expenses.length;
 const result=calculate();$('owed').textContent=money(result.settle.reduce((s,x)=>s+x.n,0));
 $('balances').innerHTML=members.map(m=>'<div class="balance"><span>'+safe(m.display_name)+'</span><strong class="'+(result.b[m.user_id]>0?'positive':result.b[m.user_id]<0?'negative':'')+'">'+money(result.b[m.user_id]||0)+'</strong></div>').join('');
 $('settlements').innerHTML=result.settle.length?result.settle.map(x=>'<div class="settlement"><span>'+safe(person(x.from))+' pays '+safe(person(x.to))+'</span><div class="actions"><strong>'+money(x.n)+'</strong><button class="btn slim" data-pay="'+x.from+'|'+x.to+'|'+x.n+'" '+(x.from===current.id?'':'disabled')+'>Record paid</button></div></div>').join(''):'<div class="empty">All settled ✓</div>';
 const history=[...expenses.map(x=>({...x,type:'expense'})),...payments.map(x=>({...x,type:'payment'}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 $('historyCount').textContent=history.length+' items';
 $('history').innerHTML=history.length?history.map(x=>'<div class="history"><div class="info"><strong>'+safe(x.type==='expense'?x.title:'Payment recorded')+'</strong><div class="sub">'+(x.type==='expense'?'Paid by '+safe(person(x.paid_by)):safe(person(x.from_user))+' → '+safe(person(x.to_user)))+' · '+new Date(x.created_at).toLocaleDateString('en-SG')+'</div></div><div><div class="money">'+money(Number(x.amount_cents))+'</div><div class="actions">'+(x.type==='payment'&&x.proof_path?'<button class="btn slim" data-view-proof="'+safe(x.id)+'">View proof</button>':'')+
 (x.type==='expense'&&x.receipt_path?'<button class="btn slim" data-view-receipt="'+safe(x.id)+'">View receipt</button><button class="btn slim" data-download-receipt="'+safe(x.id)+'">Download</button>':'')+
 (x.type==='expense'&&x.created_by===current.id?'<button class="btn slim" data-attach-receipt="'+safe(x.id)+'">'+(x.receipt_path?'Replace receipt':'Attach receipt')+'</button>':'')+
 (x.created_by===current.id?(x.type==='expense'?'<button class="btn slim" data-edit="'+x.id+'">Edit</button>':'')+'<button class="btn slim danger" data-delete="'+x.type+'|'+x.id+'">'+(x.type==='payment'?'Undo':'Delete')+'</button>':'')+'</div></div></div>').join(''):'<div class="empty">No expenses yet</div>';
 $('payer').innerHTML=members.map(m=>'<option value="'+m.user_id+'">'+safe(m.display_name)+'</option>').join('');
 if(!edit)$('payer').value=current.id;
 renderPeople();
}
function renderPeople(){
 if(!members.length)return;
 if(!selected.size&&!edit)selected=new Set(members.map(m=>m.user_id));
 $('participants').innerHTML=members.map(m=>'<div class="splitrow"><label><input type="checkbox" data-part="'+m.user_id+'" '+(selected.has(m.user_id)?'checked':'')+'><span class="who">'+safe(m.display_name)+'</span></label></div>').join('');
 renderShares();
}
function renderShares(){
 const mode=$('splitMode').value,ids=members.filter(m=>selected.has(m.user_id));
 show('shareInputs',mode!=='equal');
 if(mode==='equal')return;
 $('shareInputs').innerHTML=ids.map(m=>'<div class="splitrow"><span>'+safe(m.display_name)+'</span><input type="number" min="0" step="0.01" data-share="'+m.user_id+'" placeholder="'+(mode==='percent'?'%':'Amount')+'"></div>').join('');
 if(mode==='percent'){ids.forEach((m,i)=>{const base=Math.floor(10000/ids.length),extra=i<10000%ids.length?1:0;document.querySelector('[data-share="'+m.user_id+'"]').value=((base+extra)/100).toFixed(2)})}
 if(edit&&mode==='exact'){const e=expenses.find(x=>x.id===edit);for(const m of ids){document.querySelector('[data-share="'+m.user_id+'"]').value=(Number(e?.shares?.[m.user_id]||0)/100).toFixed(2)}}
}
function resetForm(){edit=null;clearReceiptUi();$('expenseForm').reset();$('expenseHeading').textContent='Add expense';$('saveExpense').textContent='+ Add expense';show('cancelEdit',false);selected=new Set(members.map(m=>m.user_id));renderPeople();if(current)$('payer').value=current.id}
$('participants').onchange=e=>{const id=e.target.dataset.part;if(!id)return;if(e.target.checked)selected.add(id);else selected.delete(id);renderShares()};
$('splitMode').onchange=renderShares;
$('cancelEdit').onclick=resetForm;

// Receipt photos are analyzed by Gemini and retained only after an expense is saved.
let pendingReceiptFile=null;
let receiptPreviewUrl=null, receiptBusy=false, receiptToken=0;
function clearReceiptUi(){
 receiptToken++;pendingReceiptFile=null;
 if(receiptPreviewUrl){URL.revokeObjectURL(receiptPreviewUrl);receiptPreviewUrl=null}
 $('receiptImage').value='';$('receiptCamera').value='';
 $('receiptPreview').removeAttribute('src');
 $('receiptRecognizedText').textContent='';
 $('receiptDetected').textContent='';
 $('receiptScanStatus').textContent='Receipt photos are analyzed with Gemini. Your selected photo is kept private with the expense when you save.';
 delete $('receiptScanStatus').dataset.state;
 show('receiptScanResult',false);
}
$('pickReceipt').onclick=()=>$('receiptImage').click();
$('takeReceipt').onclick=()=>$('receiptCamera').click();
async function handleReceiptPhoto(file){
 if(!file||receiptBusy)return;
 if(!file.type.startsWith('image/')||file.size>15*1024*1024||file.size===0){
  notify('Choose a receipt image under 15 MB. JPEG or PNG works best.');return;
 }
 clearReceiptUi();
 pendingReceiptFile=file;
 const ticket=receiptToken;
 const startingGroup=group?.id;
 receiptBusy=true;
 $('pickReceipt').disabled=true;$('takeReceipt').disabled=true;$('saveExpense').disabled=true;
 const status=$('receiptScanStatus');
 status.dataset.state='pending';
 receiptPreviewUrl=URL.createObjectURL(file);
 $('receiptPreview').src=receiptPreviewUrl;
 show('receiptScanResult');
 try {
  const data=await scanReceiptWithGemini(file,message=>{if(ticket===receiptToken)status.textContent=message});
  if(ticket!==receiptToken||group?.id!==startingGroup)return;
  const nameField=$('expenseTitle'),amountField=$('expenseAmount');
  const filled=[];
  // The scanner assists data entry; it does not save anything automatically.
  // For an existing expense being edited, don't unexpectedly replace a description.
  if(data.merchant&&(!edit||!nameField.value.trim())){
   nameField.value=data.merchant.slice(0,160);
   nameField.dispatchEvent(new Event('input',{bubbles:true}));
   filled.push('description');
  }
  if(typeof data.total==='number'&&data.total>0){
   amountField.value=data.total.toFixed(2);
   amountField.dispatchEvent(new Event('input',{bubbles:true}));
   filled.push('amount');
  }
  const parts=[];
  if(data.merchant)parts.push('Merchant: '+data.merchant);
  if(typeof data.total==='number')parts.push('Final total: '+data.total.toFixed(2));
  if(data.currency)parts.push('Currency: '+data.currency);
  if(data.date)parts.push('Receipt date: '+data.date);
  const detected=$('receiptDetected');
  detected.textContent=parts.join(' · ')||'No directly visible merchant name detected.';
  // An inferred merchant is a suggestion, not a name printed on the receipt.
  if(!data.merchant && data.merchant_suggestion){
    const suggestion=String(data.merchant_suggestion).trim().slice(0,160);
    const confidence=['high','medium','low'].includes(data.merchant_confidence)?data.merchant_confidence:'low';
    const wrapper=document.createElement('div');
    wrapper.style.marginTop='10px';
    const label=document.createElement('p');
    label.className='tiny';
    label.textContent='Possible restaurant (inferred from menu items, '+confidence+' confidence): '+suggestion;
    wrapper.appendChild(label);
    if(data.merchant_evidence){
      const why=document.createElement('p');
      why.className='tiny muted';
      why.textContent='Why: '+String(data.merchant_evidence).slice(0,250);
      wrapper.appendChild(why);
    }
    const use=document.createElement('button');
    use.type='button';use.className='btn slim';
    use.textContent='Use suggested restaurant';
    use.onclick=()=>{
      nameField.value=suggestion;
      nameField.dispatchEvent(new Event('input',{bubbles:true}));
      notify('Suggested restaurant selected — please verify it.');
      use.disabled=true;use.textContent='Selected';
    };
    wrapper.appendChild(use);
    detected.appendChild(wrapper);
  }
  $('receiptRecognizedText').textContent=[
   data.notes?'Notes: '+data.notes:'',
   data.merchant_suggestion?'Suggested merchant (not printed): '+data.merchant_suggestion+' ('+(data.merchant_confidence||'unverified')+')':'',
   (data.items||[]).length?'Items:\n'+data.items.map(x=>x.description+' · Qty '+(x.quantity??'?')+' · '+(x.total?.toFixed(2)??'?')).join('\n'):'',
   typeof data.subtotal==='number'?'Subtotal: '+data.subtotal.toFixed(2):'',
   typeof data.tax==='number'?'Tax: '+data.tax.toFixed(2):'',
   typeof data.fees==='number'?'Fees: '+data.fees.toFixed(2):''
  ].filter(Boolean).join('\n\n')||'No additional details were returned.';
  const hasAny=filled.length>0;
  status.dataset.state=hasAny?'success':'error';
  status.textContent=!hasAny
    ?'OCR finished, but no bill amount or merchant was identified. See the recognized text below, or enter details manually.'
    : '✓ Auto-filled '+filled.join(' and ')+'. Please review the amount and split before saving. '
      +(typeof data.total!=='number'?'The total could not be recognized.':'');
  if(hasAny){
   notify('Receipt scanned — '+filled.join(' and ')+' filled in.');
   if(typeof data.total==='number')amountField.scrollIntoView({behavior:'smooth',block:'center'});
  }
 }catch(err){
  if(ticket===receiptToken){
   status.dataset.state='error';
   status.textContent='OCR could not start or finish: '+(err?.message||'Unknown error')+'. Check your connection, refresh, or enter the amount manually.';
   notify('Receipt scan failed. See the detailed message above.');
   console.warn('SplitFair OCR error:',err);
  }
 }finally{
  receiptBusy=false;
  $('pickReceipt').disabled=false;$('takeReceipt').disabled=false;$('saveExpense').disabled=false;
 }
}
$('receiptImage').onchange=e=>handleReceiptPhoto(e.target.files?.[0]);
$('receiptCamera').onchange=e=>handleReceiptPhoto(e.target.files?.[0]);

const RECEIPT_BUCKET='splitfair-expense-receipts';
let historyReceiptTarget=null, viewerObjectUrl=null,viewerFileName='receipt.jpg', viewerDownloadBlob=null;
const jpegReceipt=async file=>{
 if(!file||!file.type.startsWith('image/')||file.size>15*1024*1024||file.size===0)
  throw Error('Choose a receipt photo under 15 MB.');
 const blobUrl=URL.createObjectURL(file);
 try{
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Receipt image could not be opened.'));img.src=blobUrl;});
  const max=2100, scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('Image processing is unavailable.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const output=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(Error('Could not compress receipt.')),'image/jpeg',0.82));
  if(output.size>5*1024*1024)throw Error('Receipt photo remains above 5 MB. Choose a smaller photo.');
  return output;
 }finally{URL.revokeObjectURL(blobUrl)}
};
async function attachExpenseReceipt(expense,file){
 if(!expense||expense.created_by!==current?.id)throw Error('Only the expense creator can attach a receipt.');
 if(!group||expense.group_id!==group.id)throw Error('Select the correct group.');
 const blob=await jpegReceipt(file);
 const path=expense.group_id+'/'+expense.id+'/'+crypto.randomUUID()+'.jpg';
 const uploaded=await client.storage.from(RECEIPT_BUCKET).upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});
 if(uploaded.error)throw uploaded.error;
 let saved=false;
 try{
  const update=await client.from('expenses').update({receipt_path:path})
   .eq('id',expense.id).eq('group_id',expense.group_id).eq('created_by',current.id)
   .select('id,receipt_path').single();
  if(update.error)throw update.error;
  saved=true;
 }finally{
  if(!saved){
   const cleanup=await client.storage.from(RECEIPT_BUCKET).remove([path]);
   if(cleanup.error)console.warn('SplitFair receipt cleanup failed',cleanup.error);
  }
 }
 if(expense.receipt_path&&expense.receipt_path!==path){
  const cleanup=await client.storage.from(RECEIPT_BUCKET).remove([expense.receipt_path]);
  if(cleanup.error)console.warn('Old receipt cleanup failed',cleanup.error);
 }
 return path;
}
function closeReceiptViewer(){
 $('receiptViewer').close();
 $('receiptViewerImage').removeAttribute('src');
 if(viewerObjectUrl){URL.revokeObjectURL(viewerObjectUrl);viewerObjectUrl=null}
 viewerDownloadBlob=null;
}
$('closeReceiptViewer').onclick=closeReceiptViewer;
$('receiptViewer').addEventListener('close',()=>{
 $('receiptViewerImage').removeAttribute('src');
 if(viewerObjectUrl){URL.revokeObjectURL(viewerObjectUrl);viewerObjectUrl=null}
 viewerDownloadBlob=null;
});
function triggerReceiptDownload(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('downloadViewedReceipt').onclick=()=>{
 if(viewerDownloadBlob)triggerReceiptDownload(viewerDownloadBlob,viewerFileName);
};
async function getExpenseReceipt(expense){
 if(!expense?.receipt_path)throw Error('No receipt is attached.');
 const {data,error}=await client.storage.from(RECEIPT_BUCKET).download(expense.receipt_path);
 if(error)throw error;
 return data;
}
$('historyReceiptFile').onchange=async e=>{
 const file=e.target.files?.[0],targetId=historyReceiptTarget;
 e.target.value='';historyReceiptTarget=null;
 if(!file||!targetId)return;
 const expense=expenses.find(x=>x.id===targetId);
 if(!expense)return notify('Expense no longer exists.');
 try{
  notify('Saving receipt to private group storage…');
  await attachExpenseReceipt(expense,file);
  notify('Receipt saved. Group members can view or download it.');
  await refresh();
 }catch(err){notify('Unable to save receipt: '+(err.message||'Unknown error'))}
};

$('expenseForm').onsubmit=async event=>{
 event.preventDefault();if(!group||receiptBusy)return;
 const n=amount($('expenseAmount').value),ids=members.filter(m=>selected.has(m.user_id)).map(m=>m.user_id),mode=$('splitMode').value;
 if(!n||n>100000000000||!ids.length){notify('Enter valid amount and participants');return}
 let shares=equal(n,ids);
 if(mode!=='equal'){
  const raw=Object.fromEntries([...document.querySelectorAll('[data-share]')].map(e=>[e.dataset.share,e.value]));
  if(mode==='exact'){shares={};for(const id of ids){const v=amount(raw[id]);if(v===null){notify('Invalid split amount');return}shares[id]=v}if(Object.values(shares).reduce((a,b)=>a+b,0)!==n){notify('Shares must equal bill amount');return}}
  else {const parts=ids.map(id=>{const v=raw[id];return {id,percentage:/^\d+(?:\.\d{1,2})?$/.test(v)?Math.round(Number(v)*100):-1}});if(parts.some(x=>x.percentage<0)||parts.reduce((s,x)=>s+x.percentage,0)!==10000){notify('Percentages must total 100%');return}
    const values=parts.map((x,i)=>({id:x.id,index:i,exact:n*x.percentage/10000}));
    const base=values.map(x=>({...x,cents:Math.floor(x.exact)}));let leftover=n-base.reduce((s,x)=>s+x.cents,0);
    const order=[...base].sort((a,b)=>(b.exact-b.cents)-(a.exact-a.cents)||a.index-b.index);
    for(let i=0;i<leftover;i++)order[i%order.length].cents++;
    shares=Object.fromEntries(base.map(x=>[x.id,x.cents]));
  }
 }
 const payload={group_id:group.id,title:$('expenseTitle').value.trim(),amount_cents:n,paid_by:$('payer').value,shares,created_by:current.id};
 if(!payload.title){notify('Description required');return}
 try{
  const oldExpense=edit?expenses.find(x=>x.id===edit):null;
  const saved=unwrap(edit
   ?await client.from('expenses').update(payload).eq('id',edit).eq('group_id',group.id).select('id,group_id,created_by,receipt_path').single()
   :await client.from('expenses').insert(payload).select('id,group_id,created_by,receipt_path').single());
  const receiptToSave=pendingReceiptFile;
  let message=edit?'Expense updated':'Expense added';
  if(receiptToSave){
   try{await attachExpenseReceipt(oldExpense||saved,receiptToSave);message+=' with receipt'}
   catch(err){message+='; receipt upload failed: '+(err.message||'Unknown error')+'. You can attach it from History.'}
  }
  resetForm();await refresh();notify(message);
 }catch(e){notify(e.message)}
};
$('history').onclick=async e=>{
 const receiptButton=e.target.closest('[data-view-receipt],[data-download-receipt],[data-attach-receipt]');
 if(receiptButton){
  const expense=expenses.find(x=>x.id===(receiptButton.dataset.viewReceipt||receiptButton.dataset.downloadReceipt||receiptButton.dataset.attachReceipt));
  if(!expense)return;
  if(receiptButton.hasAttribute('data-attach-receipt')){
   if(expense.created_by!==current.id)return;
   historyReceiptTarget=expense.id;
   $('historyReceiptFile').click();
   return;
  }
  const downloading=receiptButton.hasAttribute('data-download-receipt');
  const original=receiptButton.textContent;
  receiptButton.disabled=true;receiptButton.textContent=downloading?'Downloading…':'Loading…';
  try{
   const blob=await getExpenseReceipt(expense);
   const filename='splitfair-receipt-'+expense.id.slice(0,8)+'.jpg';
   if(downloading)triggerReceiptDownload(blob,filename);
   else{
    if($('receiptViewer').open)closeReceiptViewer();
    if(viewerObjectUrl)URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl=URL.createObjectURL(blob);
    viewerDownloadBlob=blob;viewerFileName=filename;
    $('receiptViewerTitle').textContent='Receipt — '+expense.title;
    $('receiptViewerImage').src=viewerObjectUrl;
    $('receiptViewer').showModal();
   }
  }catch(err){notify('Unable to load receipt: '+(err.message||'Unknown error'))}
  finally{receiptButton.disabled=false;receiptButton.textContent=original}
  return;
 }
 const proofButton=e.target.closest('[data-view-proof]');
 if(proofButton){
  const payment=payments.find(x=>x.id===proofButton.dataset.viewProof);
  if(!payment?.proof_path)return;
  const original=proofButton.textContent;proofButton.disabled=true;proofButton.textContent='Opening…';
  try{
   const {data,error}=await client.storage.from('splitfair-payment-proofs').createSignedUrl(payment.proof_path,60);
   if(error)throw error;
   window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }catch(err){notify('Unable to open proof: '+(err.message||'Unknown error'))}
  finally{proofButton.disabled=false;proofButton.textContent=original}
  return;
 }
 const editButton=e.target.closest('[data-edit]'),deleteButton=e.target.closest('[data-delete]');
 if(editButton){const x=expenses.find(x=>x.id===editButton.dataset.edit);if(!x)return;edit=x.id;selected=new Set(Object.keys(x.shares));$('expenseTitle').value=x.title;$('expenseAmount').value=(Number(x.amount_cents)/100).toFixed(2);$('splitMode').value='exact';renderPeople();$('payer').value=x.paid_by;$('expenseHeading').textContent='Edit expense';$('saveExpense').textContent='Save changes';show('cancelEdit');$('expenseForm').scrollIntoView();return}
 if(!deleteButton)return;const [type,id]=deleteButton.dataset.delete.split('|');
 if(!confirm('Delete this '+type+'?'))return;
 try{
  const previous=type==='payment'?payments.find(x=>x.id===id):expenses.find(x=>x.id===id);
  unwrap(await client.from(type==='expense'?'expenses':'payments').delete().eq('id',id).eq('group_id',group.id));
  if(type==='expense'&&previous?.receipt_path){
   const cleanup=await client.storage.from(RECEIPT_BUCKET).remove([previous.receipt_path]);
   if(cleanup.error)notify('Expense removed, but receipt cleanup failed: '+cleanup.error.message);
  }
  if(previous?.proof_path){
   const cleanup=await client.storage.from('splitfair-payment-proofs').remove([previous.proof_path]);
   if(cleanup.error)notify('Payment removed, but proof cleanup failed: '+cleanup.error.message);
  }
  notify('Deleted');await refresh();
 }catch(err){notify(err.message)}
};
let pendingPayment=null,proofPreviewUrl=null;
function closePaymentDialog(){
 pendingPayment=null;$('paymentForm').reset();
 if(proofPreviewUrl){URL.revokeObjectURL(proofPreviewUrl);proofPreviewUrl=null}
 show('paymentPreview',false);view('workspace');
}
$('settlements').onclick=e=>{
 const button=e.target.closest('[data-pay]');if(!button)return;
 const [from,to,n]=button.dataset.pay.split('|');if(from!==current.id)return;
 pendingPayment={groupId:group.id,from,to,amount:Number(n)};
 $('paymentSummary').textContent='Record '+money(Number(n))+' paid to '+person(to)+'?';
 $('paymentForm').reset();show('paymentPreview',false);view('paymentDialog');
};
$('closePayment').onclick=closePaymentDialog;
$('cancelPayment').onclick=closePaymentDialog;
$('paymentProof').onchange=()=>{
 const file=$('paymentProof').files?.[0];
 if(proofPreviewUrl){URL.revokeObjectURL(proofPreviewUrl);proofPreviewUrl=null}
 show('paymentPreview',false);
 if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880||file.size===0){
  $('paymentProof').value='';notify('Please choose a PNG, JPEG or WebP image up to 5 MB.');return;
 }
 proofPreviewUrl=URL.createObjectURL(file);$('paymentPreview').src=proofPreviewUrl;show('paymentPreview');
};
$('paymentForm').onsubmit=async e=>{
 e.preventDefault();const pending=pendingPayment;if(!pending||pending.from!==current?.id||pending.groupId!==group?.id)return;
 const file=$('paymentProof').files?.[0]||null;
 if(file&&(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880||file.size===0)){
  notify('Please choose a PNG, JPEG or WebP image up to 5 MB.');return;
 }
 const button=$('submitPayment');button.disabled=true;button.textContent='Saving payment…';
 let proofPath=null;
 try{
  if(file){
   const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];
   proofPath=pending.groupId+'/'+current.id+'/'+crypto.randomUUID()+'.'+extension;
   const upload=await client.storage.from('splitfair-payment-proofs').upload(proofPath,file,{contentType:file.type,upsert:false});
   if(upload.error)throw upload.error;
  }
  const saved=await client.from('payments').insert({
   group_id:pending.groupId,from_user:pending.from,to_user:pending.to,
   amount_cents:pending.amount,created_by:current.id,proof_path:proofPath
  });
  if(saved.error)throw saved.error;
  proofPath=null;closePaymentDialog();notify('Payment recorded');await refresh();
 }catch(err){
  if(proofPath)await client.storage.from('splitfair-payment-proofs').remove([proofPath]).catch(()=>{});
  notify('Unable to save payment: '+(err.message||'Unknown error'));
 }finally{button.disabled=false;button.textContent='Confirm payment'}
};
$('groupSelect').onchange=async e=>{group=groups.find(x=>x.id===e.target.value);try{await loadGroup()}catch(err){notify(err.message)}};
$('reload').onclick=refresh;
const currentProfileName=()=>{
 const meta=current?.user_metadata||{};
 return String(meta.display_name||members.find(m=>m.user_id===current?.id)?.display_name||meta.full_name||meta.name||current?.email?.split('@')[0]||'').trim().slice(0,80);
};
$('openProfile').onclick=()=>{
 if(!current)return;
 $('profileName').value=currentProfileName();$('profileEmail').value=current.email||'';
 view('profileDialog');
};
$('closeProfile').onclick=()=>view('workspace');
$('profileForm').onsubmit=async e=>{
 e.preventDefault();if(!current)return;
 const displayName=$('profileName').value.trim();
 if(displayName.length<1||displayName.length>80){notify('Display name must be 1–80 characters.');return}
 const button=$('saveProfile');button.disabled=true;button.textContent='Saving…';
 try{
  const result=await client.auth.updateUser({data:{display_name:displayName}});
  if(result.error)throw result.error;
  current=result.data.user;
  const updated=await client.from('group_members').update({display_name:displayName}).eq('user_id',current.id);
  if(updated.error)throw updated.error;
  $('identity').textContent=displayName+' · '+(current.email||'');
  view('workspace');notify('Profile saved.');
  if(group)await refresh();
 }catch(err){notify('Profile not fully saved: '+(err.message||'Unknown error'))}
 finally{button.disabled=false;button.textContent='Save profile'}
};
let mode='create';
const dialog=v=>{mode=v;$('dialogTitle').textContent=v==='create'?'Create group':'Join group';$('groupSubmit').textContent=v==='create'?'Create group':'Join group';show('newGroupFields',v==='create');show('joinGroupFields',v==='join');$('displayName').value=currentProfileName();view('groupDialog')};
$('openCreate').onclick=()=>dialog('create');$('openJoin').onclick=()=>dialog('join');$('closeDialog').onclick=()=>view('workspace');
$('groupForm').onsubmit=async e=>{
 e.preventDefault();const nickname=$('displayName').value.trim();if(!nickname){notify('Enter your name');return}
 try{const r=mode==='create'?await client.rpc('create_split_group',{p_name:$('newGroupName').value.trim(),p_currency:$('newCurrency').value,p_display_name:nickname}):await client.rpc('join_split_group',{p_code:$('inviteCode').value.trim(),p_display_name:nickname});
 const id=unwrap(r);$('groupForm').reset();notify(mode==='create'?'Group created':'Joined group');await loadGroups(id)}catch(err){notify(err.message)}
};
// Google OAuth uses Supabase as the callback host and returns to GitHub Pages after login.
let googleLoginActive=false;
$('googleLogin').onclick=async()=>{
  if(googleLoginActive)return;
  googleLoginActive=true;
  const button=$('googleLogin');button.disabled=true;button.textContent='Opening Google sign-in…';
  try{
    const {error}=await client.auth.signInWithOAuth({
      provider:'google',
      options:{redirectTo:'https://frickson.github.io/splitfair/'}
    });
    if(error)throw error;
  }catch(err){
    const message=/provider.*(disabled|not enabled|unsupported)/i.test(err?.message||'')
      ?'Google login is not enabled in Supabase yet. Configure Google OAuth in Supabase Authentication → Providers.'
      :'Google sign-in failed: '+(err?.message||'unknown error');
    $('authStatus').textContent=message;show('authStatus');notify(message);
  }finally{
    googleLoginActive=false;button.disabled=false;button.textContent='Continue with Google';
  }
};
let authRequestActive=false;
$('authForm').onsubmit=async e=>{
 e.preventDefault();
 if(authRequestActive)return;
 const submit=$('authForm').querySelector('button');
 const last=Number(sessionStorage.getItem('splitfair-last-email-request')||0);
 if(Date.now()-last<60000){$('authStatus').textContent='A login email was just requested. Check your inbox and wait at least 60 seconds before trying again.';show('authStatus');return}
 authRequestActive=true;submit.disabled=true;
 try{
   unwrap(await client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:'https://frickson.github.io/splitfair/'}}));
   sessionStorage.setItem('splitfair-last-email-request',String(Date.now()));
   $('authStatus').textContent='Check your inbox for the sign-in link. It should return to https://frickson.github.io/splitfair/.';
   show('authStatus');
 }catch(err){
   const rateLimited=err?.status===429||/rate.?limit|too many/i.test(err?.message||'');
   sessionStorage.setItem('splitfair-last-email-request',String(Date.now()));
   $('authStatus').textContent=rateLimited?'Supabase email sending limit reached (built-in service: 2 emails per hour per project). Try later, or ask the administrator to configure custom SMTP.':'Login email failed: '+(err?.message||'unknown error');
   show('authStatus');
   notify($('authStatus').textContent);
 }finally{
   authRequestActive=false;
   setTimeout(()=>{submit.disabled=false},60000);
 }
};
$('logout').onclick=async()=>{await client.auth.signOut();location.reload()};
$('setupForm').onsubmit=e=>{e.preventDefault();localStorage.setItem('splitfair-config',JSON.stringify({url:$('projectUrl').value.trim(),anonKey:$('publicKey').value.trim()}));location.reload()};
async function init(){
 const saved=JSON.parse(localStorage.getItem('splitfair-config')||'{}');const url=cfg.url||saved.url,key=cfg.anonKey||saved.anonKey;
 if(!url||!key){view('setup');return}
 client=createClient(url,key,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){current=null;view('auth')}if(event==='SIGNED_IN'&&session?.user&&!current){queueMicrotask(()=>loadGroups().catch(e=>notify(e.message))) }});
 try{const {data:{session}}=await client.auth.getSession();if(session?.user)await loadGroups();else {view('auth');if(pendingInvite()){$('authStatus').textContent='You were invited to a SplitFair group. Sign in with Google to join automatically.';show('authStatus')}}}catch(e){view('auth');notify(e.message)}
}
captureInviteLink();
init();
