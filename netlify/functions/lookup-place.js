const json=(code,data)=>({statusCode:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const clean=s=>String(s||'').trim().slice(0,200);
const norm=s=>clean(s).replace(/[\s,，、·（）()]/g,'').replace(/成功里/g,'').replace(/臺/g,'台').toLowerCase();
const roadNumber=s=>{const m=norm(s).match(/([\u4e00-\u9fff]{1,12}(?:路|街|巷))([0-9]+)號/);return m?m[1]+m[2]:null};
const hostOK=h=>['maps.app.goo.gl','maps.google.com','www.google.com','google.com'].includes(h);
async function resolveGoogle(input){if(!input)return '';try{let u=new URL(input);if(u.protocol!=='https:'||!hostOK(u.hostname))return '';for(let i=0;i<5;i++){let res=await fetch(u.href,{redirect:'manual',signal:AbortSignal.timeout(4500)});if(![301,302,303,307,308].includes(res.status))break;let v=new URL(res.headers.get('location'),u);if(v.protocol!=='https:'||!hostOK(v.hostname))break;u=v;}return u.href}catch{return ''}}
function parseGoogle(url){if(!url)return {name:'',lat:null,lng:null};let u=new URL(url);let m=u.pathname.match(/\/place\/([^/]+)/);let name=m?decodeURIComponent(m[1].replace(/\+/g,' ')):u.searchParams.get('query')||'';let coords=url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);return {name,lat:coords?Number(coords[1]):null,lng:coords?Number(coords[2]):null};}
async function googlePlaces(name,address){let key=process.env.GOOGLE_PLACES_API_KEY;if(!key)return null;let q=[name,address].filter(Boolean).join(' ');let res=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location'},body:JSON.stringify({textQuery:q,languageCode:'zh-TW',regionCode:'TW',pageSize:5}),signal:AbortSignal.timeout(8500)});if(!res.ok)throw Error('Google Places 查詢未成功（請檢查 API 設定）');let data=await res.json();return (data.places||[]).map(p=>({name:p.displayName?.text||'',address:p.formattedAddress||'',lat:p.location?.latitude,lng:p.location?.longitude,placeId:p.id})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));}
// Respect the public Nominatim service's low-volume usage policy: at most one request per second.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function addressVariants(address){
 const original=clean(address).replace(/臺/g,'台').replace(/\s+/g,'').replace(/^台灣(?:省)?/,'');
 const withoutVillage=original.replace(/([區鄉鎮市])[^區鄉鎮市]{1,10}里(?=[^里]*?(?:路|街|大道))/,'$1');
 const withoutDistrict=withoutVillage.replace(/^(.{2,3}[縣市])(.{1,8}[區鄉鎮市])/,'$1');
 return [...new Set([original,withoutVillage,withoutDistrict].filter(Boolean))];
}
function streetNumber(address){const a=norm(address);const m=a.match(/([\u4e00-\u9fff]{1,16}(?:路|街|大道))(\d+(?:之\d+)?)號/);return m?{street:m[1],number:m[2]}:null}
async function osmSearch(name,address){
 const variants=addressVariants(address);const street=streetNumber(address);
 const queries=[...variants];
 if(street){queries.push(street.street+street.number+'號 高雄市');queries.push(street.street+' '+street.number+' 高雄');}
 if(name)queries.push(name+' '+(address.match(/.{2,3}[縣市].{1,8}區/)||[''])[0]);
 const candidates=[];let requests=0;let serviceError=false;
 for(const q of [...new Set(queries.filter(Boolean))].slice(0,5)){
  if(requests)await sleep(1150);requests++;
  try{
   const url='https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=tw&accept-language=zh-TW&q='+encodeURIComponent(q);
   const res=await fetch(url,{headers:{'User-Agent':'FoodMapPersonal/3.0 (personal restaurant map; Netlify Functions)','Accept':'application/json'},signal:AbortSignal.timeout(8000)});
   if(!res.ok){serviceError=true;continue}
   const arr=await res.json();
   for(const p of arr){const lat=Number(p.lat),lng=Number(p.lon);if(Number.isFinite(lat)&&Number.isFinite(lng)&&!candidates.some(x=>x.lat===lat&&x.lng===lng))candidates.push({name:p.name||p.display_name?.split(',')[0]||'',address:p.display_name||'',lat,lng,osmType:p.type||'',osmClass:p.class||''})}
   if(candidates.some(p=>norm(p.address).includes(norm(street?.street||'')+street?.number)))break;
  }catch{serviceError=true}
 }
 return {candidates,requests,serviceError};
}
function pick(candidates,name,address){
 const n=norm(name),a=norm(address),street=streetNumber(address);
 const scored=candidates.map(p=>{
  const pn=norm(p.name),pa=norm(p.address);
  const exactName=!!n&&!!pn&&(pn.includes(n)||n.includes(pn));
  const streetMatch=!!street&&pa.includes(norm(street.street));
  const numberMatch=!!street&&new RegExp('(?:^|[^0-9])'+street.number+'(?:號|,|$)').test(pa);
  const fullAddress=!!a&&pa.includes(a);
  const score=(exactName?6:0)+(streetMatch?2:0)+(numberMatch?5:0)+(fullAddress?6:0);
  return {...p,score,verifiedStreet:streetMatch&&numberMatch};
 }).sort((x,y)=>y.score-x.score);
 const best=scored[0];
 // A matching street AND house number, or matching full address, is required.
 // Matching the business name alone is not enough to assert a precise pin.
 if(best&&(best.verifiedStreet||best.score>=12)&&(!scored[1]||best.score>scored[1].score))return {status:'matched',place:best};
 return {status:'candidates',candidates:scored.slice(0,8)};
}
exports.handler=async event=>{try{let p=event.queryStringParameters||{};let name=clean(p.name),address=clean(p.address);if(!name&&!address)return json(400,{error:'缺少餐廳名稱或地址'});let resolved=await resolveGoogle(p.url);let hint=parseGoogle(resolved);if(!name)name=hint.name;let candidates=null,provider='OpenStreetMap';try{candidates=await googlePlaces(name,address);if(candidates)provider='Google Places'}catch(e){return json(502,{error:e.message})}let diagnostics={};if(!candidates){const osm=await osmSearch(name,address);candidates=osm.candidates;diagnostics={queriesAttempted:osm.requests,serviceError:osm.serviceError}}let result=pick(candidates,name,address);return json(200,{...result,provider,resolvedGoogleUrl:resolved||null,diagnostics,reason:result.status==='matched'?'matched':candidates.length?'ambiguous_or_unverified':'no_results',notice:'未驗證的地圖視角座標不會自動採用'})}catch(e){return json(502,{error:'地點查詢服務暫時無法使用'})}};
