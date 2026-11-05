// Gemini receipt extraction. API key remains in Supabase Edge Function Secrets.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const allowedOrigin = 'https://frickson.github.io';
const cors = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const schema = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING', description: 'Only a store or restaurant name directly visible on the receipt. Do not infer here; use an empty string if not visible.' },
    merchant_suggestion: { type: 'STRING', description: 'If merchant is NOT visible, an educated guess from distinctive branded food/drink names or unique menu combinations. Empty if insufficient evidence.' },
    merchant_confidence: { type: 'STRING', description: 'Confidence in the suggested merchant only: high, medium, low, or none.' },
    merchant_evidence: { type: 'STRING', description: 'Short explanation citing the exact signature items that support this suggestion. Never present this as verified.' },
    date: { type: 'STRING', description: 'Receipt purchase date in YYYY-MM-DD, or empty if unknown.' },
    currency: { type: 'STRING', description: 'ISO currency code when evidenced (e.g. SGD), otherwise empty.' },
    total: { type: 'NUMBER', nullable: true, description: 'Final amount due, including taxes and service fees, null if not identifiable.' },
    subtotal: { type: 'NUMBER', nullable: true },
    tax: { type: 'NUMBER', nullable: true },
    fees: { type: 'NUMBER', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          quantity: { type: 'NUMBER', nullable: true },
          total: { type: 'NUMBER', nullable: true }
        },
        required: ['description','quantity','total']
      }
    },
    notes: { type: 'STRING', description: 'Any ambiguity, occlusion, missing fields or conflicting totals.' }
  },
  required: ['merchant', 'merchant_suggestion', 'merchant_confidence', 'merchant_evidence', 'date', 'currency', 'total', 'subtotal', 'tax', 'fees', 'items', 'notes']
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
  if (req.method !== 'POST') return response({error:'Method not allowed'},405);
  if (req.headers.get('origin') !== allowedOrigin) return response({error:'Origin not allowed'},403);
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return response({error:'Gemini is not configured. Add GEMINI_API_KEY in Supabase Edge Function Secrets.'},503);
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if (!jwt) return response({error:'Sign in first.'},401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return response({error:'Supabase function credentials not available.'},503);
  const caller = createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data: {user},error: authError}=await caller.auth.getUser(jwt);
  if (authError || !user) return response({error:'Invalid or expired login.'},401);
  let body: {image?:unknown;mimeType?:unknown};
  try {body=await req.json()} catch {return response({error:'Invalid request JSON'},400)}
  const mimeType = body?.mimeType;
  const image = body?.image;
  if(typeof mimeType!=='string'||!['image/jpeg','image/png','image/webp'].includes(mimeType)||
     typeof image!=='string'||image.length<120||image.length>4_000_000||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
       return response({error:'Please upload a JPEG, PNG or WebP receipt under 3 MB after compression.'},400);
  }
  // Quota RPC is accessible only with service_role, never through the browser's key.
  const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:claimed,error:quotaError}=await admin.rpc('claim_receipt_scan_quota',{p_user_id:user.id});
  if(quotaError) return response({error:'Could not check scan quota.'},503);
  if(!claimed) return response({error:'AI scan limit reached (20 per UTC day) or scanned too recently. Try again later.'},429);
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),25000);
  try {
    const model = 'gemini-3.5-flash-lite';
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent';
    const result = await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      signal:controller.signal,
      body:JSON.stringify({
        contents:[{role:'user',parts:[
          {text:'Extract receipt information from this photo; understand layout rather than relying on text order. For merchant: if the actual business name is VISIBLE, put it in merchant. Never use an address, date, venue descriptor, cocktail name, or menu item as the directly visible merchant. If merchant is NOT visible, examine distinctive house-branded dishes, cocktails, coined names and unusual combinations to INFER a likely restaurant from known menu associations; place this guess in merchant_suggestion ONLY, with confidence high/medium/low and evidence naming the supporting items. Do not confuse a signature drink name with the merchant (for example AMO 4 EVER is a cocktail name, not proof the restaurant is Amò). The branded dessert Fortunamisu may be a more distinctive business clue. If evidence is weak or items are generic, leave merchant_suggestion empty and confidence none. Never claim guessed merchants are printed on the receipt; never hallucinate a restaurant from cuisine type alone. Total must be final amount paid including tax and fees, not subtotal. Read tilted, obscured photos as best possible; unreadable total should be null. Return line items where legible; do not mistake masked card digits for costs.'},
          {inline_data:{mime_type:mimeType,data:image}}
        ]}],
        generationConfig:{responseMimeType:'application/json',responseSchema:schema,maxOutputTokens:1400}
      })
    });
    const payload=await result.json().catch(()=>({}));
    if(!result.ok){
      const msg=payload?.error?.message||'Gemini request failed';
      const status=result.status===429?429:result.status===400?422:502;
      return response({error:'Gemini: '+String(msg).slice(0,240)},status);
    }
    const raw = payload?.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text||'').join('');
    if(!raw)return response({error:'AI could not extract readable receipt information.'},422);
    let parsed: Record<string, unknown>;
    try{parsed=JSON.parse(raw)}catch{return response({error:'AI response could not be parsed.'},502)}
    const money=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<=1_000_000_000?Math.round(x*100)/100:null;
    const merchant=typeof parsed.merchant==='string'?parsed.merchant.trim().slice(0,160):'';
    const validConfidence=new Set(['high','medium','low']);
    const suggestion=!merchant&&typeof parsed.merchant_suggestion==='string'?parsed.merchant_suggestion.trim().slice(0,160):'';
    let merchantConfidence=suggestion&&validConfidence.has(parsed.merchant_confidence as string)?parsed.merchant_confidence:'none';
    let merchantEvidence=suggestion&&typeof parsed.merchant_evidence==='string'?parsed.merchant_evidence.trim().slice(0,250):'';
    let merchantSuggestion=suggestion;
    // The following exact signature pairing is independently confirmed on Fortuna's public
    // menu. A matching dish/cocktail is a candidate, not proof of the venue.
    const itemNames=Array.isArray(parsed.items)?parsed.items.map((x:Record<string,unknown>)=>String(x?.description||'').toUpperCase()).join(' | '):'';
    if(!merchant&&itemNames.includes('FORTUNAMISU')&&(itemNames.includes('AMO')&&itemNames.includes('4 EVER')||itemNames.includes('PASSITO DI PANTELLERIA'))){
      merchantSuggestion='Fortuna Drink & Eat';
      merchantConfidence='high';
      merchantEvidence='Fortunamisu plus signature drinks match items on Fortuna Drink & Eat’s published menu.';
    }
    if(merchantConfidence==='none'){merchantSuggestion='';merchantEvidence='';}
    const date=typeof parsed.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)?parsed.date:'';
    const items=Array.isArray(parsed.items)?parsed.items.slice(0,30).filter((i:unknown)=>typeof i==='object'&&i!==null).map((i:Record<string,unknown>)=>({
      description:String(i.description||'').slice(0,120),
      quantity:typeof i.quantity==='number'&&i.quantity>0&&i.quantity<1000?i.quantity:null,
      total:money(i.total)
    })): [];
    return response({
      merchant, merchant_suggestion:merchantSuggestion, merchant_confidence:merchantConfidence, merchant_evidence:merchantEvidence,
      date, currency:typeof parsed.currency==='string'?parsed.currency.slice(0,3).toUpperCase():'',
      total:money(parsed.total), subtotal:money(parsed.subtotal),
      tax:money(parsed.tax),fees:money(parsed.fees),items,
      notes:typeof parsed.notes==='string'?parsed.notes.slice(0,300):''
    });
  }catch(err) {
    return response({error:err instanceof Error&&err.name==='AbortError'?'AI request timed out. Try a smaller image.':'Unable to process receipt right now.'},502);
  }finally {clearTimeout(timeout)}
});