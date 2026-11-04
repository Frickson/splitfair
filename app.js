
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/+esm';
const $=id=>document.getElementById(id);
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=(id,yes=true)=>$(id).classList.toggle('hidden',!yes);
let client,current=null,groups=[],group=null,members=[],expenses=[],payments=[],edit=null,selected=new Set(),channel=null;
const cfg=window.SPLITFAIR_CONFIG||{};
const notify=(message)=>{const el=$('toast');el.textContent=message;show('toast');setTimeout(()=>show('toast',false),5000)};
const amount=s=>{s=String(s).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null};
const money=n=>new Intl.NumberFormat('en-SG',{style:'currency',currency:group?.currency||'SGD'}).format(n/100);
const person=id=>members.find(m=>m.user_id===id)?.display_name||'Member';
const view=v=>['setup','auth','workspace','groupDialog'].forEach(id=>show(id,id===v));
const unwrap=(r)=>{if(r.error)throw r.error;return r.data};
const equal=(n,ids)=>Object.fromEntries(ids.map((id,i)=>[id,Math.floor(n/ids.length)+(i<n%ids.length?1:0)]));
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
 $('identity').textContent=current.email||'';
 show('logout');
 const memberships=unwrap(await client.from('group_members').select('group_id').eq('user_id',current.id));
 const ids=memberships.map(x=>x.group_id);
 if(!ids.length){groups=[];group=null;view('workspace');show('noGroups');show('groupContent',false);show('groupShare',false);$('groupSelect').innerHTML='';return}
 groups=unwrap(await client.from('groups').select('*').in('id',ids).order('created_at',{ascending:false}));
 group=groups.find(x=>x.id===(preferred||localStorage.getItem('splitfair-last-group')))||groups[0];
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
 $('groupShare').innerHTML='<div class="row"><span>Invite code: <strong>'+safe(group.invite_code)+'</strong></span><button id="copyInvite" class="btn slim">Copy</button></div><div class="tiny muted">Share privately. Anyone signed in with the code can join.</div>';
 show('groupShare');$('copyInvite').onclick=()=>navigator.clipboard.writeText(group.invite_code).then(()=>notify('Invite code copied')).catch(()=>notify('Copy the code above'));
 $('members').innerHTML=members.map(m=>'<span class="member">'+safe(m.display_name)+(m.user_id===current.id?' (you)':'')+'</span>').join('');
 $('memberCount').textContent=members.length+' people';
 $('spent').textContent=money(expenses.reduce((s,x)=>s+Number(x.amount_cents),0));
 $('count').textContent=expenses.length;
 const result=calculate();$('owed').textContent=money(result.settle.reduce((s,x)=>s+x.n,0));
 $('balances').innerHTML=members.map(m=>'<div class="balance"><span>'+safe(m.display_name)+'</span><strong class="'+(result.b[m.user_id]>0?'positive':result.b[m.user_id]<0?'negative':'')+'">'+money(result.b[m.user_id]||0)+'</strong></div>').join('');
 $('settlements').innerHTML=result.settle.length?result.settle.map(x=>'<div class="settlement"><span>'+safe(person(x.from))+' pays '+safe(person(x.to))+'</span><div class="actions"><strong>'+money(x.n)+'</strong><button class="btn slim" data-pay="'+x.from+'|'+x.to+'|'+x.n+'" '+(x.from===current.id?'':'disabled')+'>Record paid</button></div></div>').join(''):'<div class="empty">All settled ✓</div>';
 const history=[...expenses.map(x=>({...x,type:'expense'})),...payments.map(x=>({...x,type:'payment'}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 $('historyCount').textContent=history.length+' items';
 $('history').innerHTML=history.length?history.map(x=>'<div class="history"><div class="info"><strong>'+safe(x.type==='expense'?x.title:'Payment recorded')+'</strong><div class="sub">'+(x.type==='expense'?'Paid by '+safe(person(x.paid_by)):safe(person(x.from_user))+' → '+safe(person(x.to_user)))+' · '+new Date(x.created_at).toLocaleDateString('en-SG')+'</div></div><div><div class="money">'+money(Number(x.amount_cents))+'</div><div class="actions">'+(x.created_by===current.id?(x.type==='expense'?'<button class="btn slim" data-edit="'+x.id+'">Edit</button>':'')+'<button class="btn slim danger" data-delete="'+x.type+'|'+x.id+'">'+(x.type==='payment'?'Undo':'Delete')+'</button>':'')+'</div></div></div>').join(''):'<div class="empty">No expenses yet</div>';
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
function resetForm(){edit=null;$('expenseForm').reset();$('expenseHeading').textContent='Add expense';$('saveExpense').textContent='+ Add expense';show('cancelEdit',false);selected=new Set(members.map(m=>m.user_id));renderPeople();if(current)$('payer').value=current.id}
$('participants').onchange=e=>{const id=e.target.dataset.part;if(!id)return;if(e.target.checked)selected.add(id);else selected.delete(id);renderShares()};
$('splitMode').onchange=renderShares;
$('cancelEdit').onclick=resetForm;
$('expenseForm').onsubmit=async event=>{
 event.preventDefault();if(!group)return;
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
 try{unwrap(edit?await client.from('expenses').update(payload).eq('id',edit).eq('group_id',group.id):await client.from('expenses').insert(payload));notify(edit?'Expense updated':'Expense added');resetForm();await refresh()}catch(e){notify(e.message)}
};
$('history').onclick=async e=>{
 const editButton=e.target.closest('[data-edit]'),deleteButton=e.target.closest('[data-delete]');
 if(editButton){const x=expenses.find(x=>x.id===editButton.dataset.edit);if(!x)return;edit=x.id;selected=new Set(Object.keys(x.shares));$('expenseTitle').value=x.title;$('expenseAmount').value=(Number(x.amount_cents)/100).toFixed(2);$('splitMode').value='exact';renderPeople();$('payer').value=x.paid_by;$('expenseHeading').textContent='Edit expense';$('saveExpense').textContent='Save changes';show('cancelEdit');$('expenseForm').scrollIntoView();return}
 if(!deleteButton)return;const [type,id]=deleteButton.dataset.delete.split('|');
 if(!confirm('Delete this '+type+'?'))return;
 try{unwrap(await client.from(type==='expense'?'expenses':'payments').delete().eq('id',id).eq('group_id',group.id));notify('Deleted');await refresh()}catch(err){notify(err.message)}
};
$('settlements').onclick=async e=>{
 const button=e.target.closest('[data-pay]');if(!button)return;
 const [from,to,n]=button.dataset.pay.split('|');if(from!==current.id)return;
 if(!confirm('Record '+money(Number(n))+' paid to '+person(to)+'? This does not transfer money.'))return;
 try{unwrap(await client.from('payments').insert({group_id:group.id,from_user:from,to_user:to,amount_cents:Number(n),created_by:current.id}));notify('Payment recorded');await refresh()}catch(err){notify(err.message)}
};
$('groupSelect').onchange=async e=>{group=groups.find(x=>x.id===e.target.value);try{await loadGroup()}catch(err){notify(err.message)}};
$('reload').onclick=refresh;
let mode='create';
const dialog=v=>{mode=v;$('dialogTitle').textContent=v==='create'?'Create group':'Join group';$('groupSubmit').textContent=v==='create'?'Create group':'Join group';show('newGroupFields',v==='create');show('joinGroupFields',v==='join');view('groupDialog')};
$('openCreate').onclick=()=>dialog('create');$('openJoin').onclick=()=>dialog('join');$('closeDialog').onclick=()=>view('workspace');
$('groupForm').onsubmit=async e=>{
 e.preventDefault();const nickname=$('displayName').value.trim();if(!nickname){notify('Enter your name');return}
 try{const r=mode==='create'?await client.rpc('create_split_group',{p_name:$('newGroupName').value.trim(),p_currency:$('newCurrency').value,p_display_name:nickname}):await client.rpc('join_split_group',{p_code:$('inviteCode').value.trim(),p_display_name:nickname});
 const id=unwrap(r);$('groupForm').reset();notify(mode==='create'?'Group created':'Joined group');await loadGroups(id)}catch(err){notify(err.message)}
};
$('authForm').onsubmit=async e=>{e.preventDefault();try{unwrap(await client.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+location.pathname}}));$('authStatus').textContent='Check your email for the sign-in link.';show('authStatus')}catch(err){notify(err.message)}};
$('logout').onclick=async()=>{await client.auth.signOut();location.reload()};
$('setupForm').onsubmit=e=>{e.preventDefault();localStorage.setItem('splitfair-config',JSON.stringify({url:$('projectUrl').value.trim(),anonKey:$('publicKey').value.trim()}));location.reload()};
async function init(){
 const saved=JSON.parse(localStorage.getItem('splitfair-config')||'{}');const url=cfg.url||saved.url,key=cfg.anonKey||saved.anonKey;
 if(!url||!key){view('setup');return}
 client=createClient(url,key,{auth:{persistSession:true,detectSessionInUrl:true,autoRefreshToken:true}});
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){current=null;view('auth')}if(event==='SIGNED_IN'&&session?.user&&!current){queueMicrotask(()=>loadGroups().catch(e=>notify(e.message))) }});
 try{const {data:{session}}=await client.auth.getSession();if(session?.user)await loadGroups();else view('auth')}catch(e){view('auth');notify(e.message)}
}
init();
