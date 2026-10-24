import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {categories,criteria} from './constants.ts';
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const BOOTSTRAP_HASH='c82545e899fc7f781572752154ce951b2b3aa5d9d990e75a9e31c8a591c5ffc6';
const ALLOWED_ORIGIN='https://juancastorenac18.github.io';
const competition={name:'II Jornada Nacional de Voces',date:'2026-10-24',startTime:'10:00',location:'En cada estatal',categories,criteria};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status});}
async function query(q:any){const {data,error}=await q;if(error){if(error.code==='23505')fail('Ya existe un registro con esos datos.',409);throw error;}return data||[];}
async function allRows(table:string){let out:any[]=[];for(let offset=0;;offset+=500){const page=await query(db.from(table).select('*').order('id').range(offset,offset+499));out.push(...page);if(page.length<500)return out;}}
async function member(request:Request){
 const token=request.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)fail('Inicia sesión para continuar.',401);
 const {data,error}=await db.auth.getUser(token);if(error||!data.user)fail('Tu sesión venció. Vuelve a iniciar sesión.',401);
 const m=(await query(db.from('voces_members').select('*').eq('uid',data.user.id)))[0];
 if(!m||!m.active)fail('Tu cuenta no tiene acceso activo. Consulta al administrador.',403);return m;
}
async function createMember(b:any,role:string){
 const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
 if(!name||name.length>150||email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail('Escribe un nombre y un correo válido.');
 if(password.length<12||password.length>128)fail('Usa una contraseña de 12 a 128 caracteres.');
 const {data,error}=await db.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)fail('No se pudo crear la cuenta. Revisa el correo y la contraseña.',400);
 try{return (await query(db.from('voces_members').insert({uid:data.user.id,email,name,role,active:true}).select('*')))[0];}catch(e){await db.auth.admin.deleteUser(data.user.id);throw e;}
}
function requireRole(m:any,...roles:string[]){if(!roles.includes(m.role))fail('No tienes permiso para realizar esta acción.',403);}
function safeMember(m:any){return {id:m.id,name:m.name,username:m.email,email:m.email,role:m.role,active:!!m.active};}
async function roster(){return (await allRows('voces_participants')).map(row=>({...row.data,id:row.id,folio:`VOC-${String(row.seq).padStart(3,'0')}`,drawOrder:row.draw})).sort((a,b)=>order(a.categoryId)-order(b.categoryId)||(a.drawOrder||9999)-(b.drawOrder||9999)||a.name.localeCompare(b.name,'es'));}
const order=(id:string)=>categories.find(c=>c.id===id)?.order||99;
function clean(body:any){return {name:String(body.name||'').trim(),age:Number(body.age),categoryId:String(body.categoryId||''),seccional:String(body.seccional||'').trim(),curp:String(body.curp||'').trim().toUpperCase(),songTitle:String(body.songTitle||'').trim(),lyricAuthor:String(body.lyricAuthor||'').trim(),musicAuthor:String(body.musicAuthor||'').trim(),eligibility:String(body.eligibility||'').trim()};}
function validate(p:ReturnType<typeof clean>){
 if([p.name,p.seccional,p.curp,p.songTitle,p.lyricAuthor,p.musicAuthor].some(x=>!x))fail('Completa nombre, seccional, CURP, canción y autores.');
 if(Object.values(p).some(x=>typeof x==='string'&&x.length>500))fail('Los campos admiten hasta 500 caracteres.');
 if(!Number.isInteger(p.age)||p.age<3||p.age>110)fail('La edad debe estar entre 3 y 110 años.');
 if(!/^[A-Z0-9]{18}$/.test(p.curp))fail('La CURP debe tener 18 caracteres alfanuméricos.');
 if(!categories.some(c=>c.id===p.categoryId))fail('Selecciona una categoría válida.');
 const ranges:Record<string,number[]>={infantil_a:[3,8],infantil_b:[9,12],juvenil_a:[13,15],juvenil_b:[16,19],libre_estudiantil:[20,110],libre_obrero:[40,110]};
 const r=ranges[p.categoryId];if(r&&(p.age<r[0]||p.age>r[1]))fail('La edad no corresponde a la categoría seleccionada.');
 if(['libre_obrero','semiprofesional'].includes(p.categoryId)&&!p.eligibility)fail('Anota el respaldo de elegibilidad para esta categoría.');
}
const safeJudge=(p:any)=>({id:p.id,folio:p.folio,name:p.name,age:p.age,categoryId:p.categoryId,songTitle:p.songTitle,drawOrder:p.drawOrder});
async function scoreData(){const judges=await query(db.from('voces_members').select('id,name').eq('active',true).eq('role','judge'));const map=new Map(judges.map((j:any)=>[j.id,j.name]));return (await allRows('voces_scores')).filter(s=>map.has(s.judge_id)).map(s=>({...s.data,judgeName:map.get(s.judge_id)}));}
async function results(){
 const judges=await query(db.from('voces_members').select('id').eq('role','judge').eq('active',true)),scores=await scoreData(),people=await roster();
 const participants=people.map(p=>{
  const entries=scores.filter(s=>s.participantId===p.id);
  const perCriterion=Object.fromEntries(criteria.map(c=>[c,entries.length?entries.reduce((n,s)=>n+s.scores[c],0)/entries.length:null]));
  const average=entries.length?Number((criteria.reduce((n,c)=>n+(perCriterion[c]??0),0)/criteria.length).toFixed(2)):null;
  return {...p,average,perCriterion,judgeDetails:entries.map(s=>({judgeName:s.judgeName,scores:s.scores,updatedAt:s.updatedAt})),judgeCount:entries.length,activeJudges:judges.length,complete:judges.length>0&&entries.length===judges.length,place:null as number|null};
 }).sort((a,b)=>order(a.categoryId)-order(b.categoryId)||(b.average??-1)-(a.average??-1)||a.name.localeCompare(b.name,'es'));
 for(const c of categories){let previous:number|null=null,place=0;participants.filter(p=>p.categoryId===c.id&&p.average!==null).forEach((p,i)=>{if(previous!==p.average)place=i+1;p.place=place;previous=p.average})}
 return {participants,activeJudges:judges.length,scoreCount:scores.length};
}
async function body(request:Request){const raw=await request.text();if(raw.length>262144)fail('Solicitud demasiado grande.',413);try{return JSON.parse(raw||'{}')}catch{fail('Contenido inválido.')}}
async function handler(request:Request){
 try{
  const url=new URL(request.url),route=url.pathname.replace(/^.*\/voces-api/,''),method=request.method;
  if(route==='/api/setup/status'&&method==='GET'){
   const owners=await query(db.from('voces_members').select('id').eq('role','admin'));return json({complete:owners.length>0,competition});
  }
  if(route==='/api/setup'&&method==='POST'){
   const b=await body(request),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(b.code||'')));
   const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(hash!==BOOTSTRAP_HASH)fail('Código de activación incorrecto.',403);
   if((await query(db.from('voces_members').select('id').eq('role','admin'))).length)fail('La administración ya está configurada.',409);
   await createMember(b,'admin');return json({ok:true},201);
  }
  const user=await member(request);
  if(route==='/api/me'&&method==='GET')return json({user:safeMember(user),competition});
  if(route==='/api/participants'&&method==='GET'){
   const people=await roster();return json({participants:user.role==='admin'?people:user.role==='judge'?people.map(safeJudge):people.map(({curp,eligibility,...p})=>p)});
  }
  if(route==='/api/participants'&&method==='POST'){
   requireRole(user,'admin','registration');const p=clean(await body(request));validate(p);const id=crypto.randomUUID();
   try{await query(db.from('voces_participants').insert({id,category:p.categoryId,section:p.seccional.toLowerCase(),data:{...p,createdAt:new Date().toISOString()}}));}catch(e:any){if(/UNIQUE/.test(e.message))fail('Ya existe un concursante de esa categoría y seccional.',409);throw e}
   return json({participant:(await roster()).find(p=>p.id===id)},201);
  }
  const pm=route.match(/^\/api\/participants\/([\w-]+)$/);
  if(pm&&(method==='PATCH'||method==='DELETE')){
   requireRole(user,'admin');if(!(await query(db.from('voces_participants').select('id').eq('id',pm[1]))).length)fail('Concursante no encontrado.',404);
   if(method==='DELETE'){await query(db.from('voces_participants').delete().eq('id',pm[1]));return json({ok:true});}
   const p=clean(await body(request));validate(p);try{await query(db.from('voces_participants').update({category:p.categoryId,section:p.seccional.toLowerCase(),data:{...p,updatedAt:new Date().toISOString()}}).eq('id',pm[1]));}catch(e:any){if(/UNIQUE/.test(e.message))fail('Ya existe un concursante de esa categoría y seccional.',409);throw e}
   return json({participant:(await roster()).find(p=>p.id===pm[1])});
  }
  const mm=route.match(/^\/api\/(judges|registrars)(?:\/([\w-]+))?$/);
  if(mm){requireRole(user,'admin');const role=mm[1]==='judges'?'judge':'registration',key=mm[1]==='judges'?'judge':'registrar';
   if(method==='GET'&&!mm[2])return json({[mm[1]]:(await query(db.from('voces_members').select('*').eq('role',role).order('name'))).map(safeMember)});
   if(method==='POST'&&!mm[2]){
    const m=await createMember(await body(request),role);return json({[key]:safeMember(m)},201);
   }
   if(method==='PATCH'&&mm[2]){const b=await body(request);if(typeof b.active!=='boolean')fail('Estado inválido.');const change=await query(db.from('voces_members').update({active:b.active}).eq('id',mm[2]).eq('role',role).select('id'));if(!change.length)fail('Cuenta no encontrada.',404);return json({ok:true});}
  }
  if(route==='/api/raffle'&&method==='POST'){
   requireRole(user,'admin');const people=await roster(),commands:any[]=[];
   for(const c of categories){const group=people.filter(p=>p.categoryId===c.id);for(let i=group.length-1;i>0;i--){const random=crypto.getRandomValues(new Uint32Array(1))[0];const j=random%(i+1);[group[i],group[j]]=[group[j],group[i]]}group.forEach((p,i)=>commands.push({id:p.id,draw:i+1}))}
   if(commands.length)await query(db.rpc('voces_save_draw',{assignments:commands}));return json({participants:await roster()});
  }
  if(route==='/api/judge/participants'&&method==='GET'){
   requireRole(user,'judge');const mine=(await query(db.from('voces_scores').select('data').eq('judge_id',user.id))).map(x=>x.data);return json({participants:(await roster()).map(p=>({...safeJudge(p),myScore:mine.find(s=>s.participantId===p.id)||null})),criteria});
  }
  const sm=route.match(/^\/api\/scores\/([\w-]+)$/);
  if(sm&&method==='POST'){
   requireRole(user,'judge');if(!(await query(db.from('voces_participants').select('id').eq('id',sm[1]))).length)fail('Concursante no encontrado.',404);
   const b=await body(request),values:Record<string,number>={};for(const c of criteria){const n=b.scores?.[c];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>10)fail(`Asigna una calificación de 0 a 10 para ${c}.`);values[c]=Math.round(n*2)/2;}
   const score={judgeId:user.id,participantId:sm[1],scores:values,comment:String(b.comment||'').slice(0,500),updatedAt:new Date().toISOString()};
   await query(db.from('voces_scores').upsert({judge_id:user.id,participant_id:sm[1],data:score},{onConflict:'judge_id,participant_id'}));return json({score});
  }
  if(route==='/api/results'&&method==='GET'){requireRole(user,'admin');return json(await results());}
  if(route==='/api/export.csv'&&method==='GET'){
   requireRole(user,'admin');const result=await results();const cell=(v:any)=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
   const rows=[['Lugar','Folio','Participante','Categoría','Seccional','Canción',...criteria,'Promedio','Jueces','Estado'],...result.participants.map(p=>[p.place,p.folio,p.name,categories.find(c=>c.id===p.categoryId)?.name,p.seccional,p.songTitle,...criteria.map(c=>p.perCriterion[c]),p.average,`${p.judgeCount}/${p.activeJudges}`,p.complete?'Completo':'Parcial'])];
   return new Response('\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="resultados-voces.csv"','Cache-Control':'no-store'}});
  }
  return json({error:'Ruta no encontrada.'},404);
 }catch(e:any){if(!e.status)console.error(e);return json({error:e.status?e.message:'No se pudo completar la operación. Intenta nuevamente.'},e.status||500);}
}


Deno.serve(async request=>{
 const origin=request.headers.get('origin');
 const headers={'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Cache-Control':'no-store'};
 if(origin&&origin!==ALLOWED_ORIGIN)return new Response('Origen no autorizado',{status:403,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 const result=await handler(request);const finalHeaders=new Headers(result.headers);for(const [k,v]of Object.entries(headers))finalHeaders.set(k,v);
 return new Response(result.body,{status:result.status,headers:finalHeaders});
});
