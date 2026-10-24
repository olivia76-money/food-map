const json=(code,data)=>({statusCode:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const clean=s=>String(s||'').trim().slice(0,200);
const norm=s=>clean(s).replace(/[\s,，、·（）()]/g,'').replace(/(?:[\u4e00-\u9fff]{1,8}[里村])(?=[\u4e00-\u9fff]{1,16}(?:路|街|大道))/g,'').replace(/臺/g,'台').toLowerCase();
const districtOf=s=>{const m=clean(s).replace(/臺/g,'台').match(/([\u4e00-\u9fff]{1,6}(?:區|鄉|鎮))/);return m?m[1]:''};
const cityOf=s=>{const m=clean(s).replace(/臺/g,'台').match(/([\u4e00-\u9fff]{2,4}[縣市])/);return m?m[1]:''};
const districtEnglish={"Xinxing":"新興區","Sinsing":"新興區","Lingya":"苓雅區","Cianjin":"前金區","Qianjin":"前金區","Yancheng":"鹽埕區","Gushan":"鼓山區","Zuoying":"左營區","Sanmin":"三民區","Nanzi":"楠梓區","Nanzih":"楠梓區","Qianzhen":"前鎮區","Cianjhen":"前鎮區","Xiaogang":"小港區","Fengshan":"鳳山區","Niaosong":"鳥松區","Renwu":"仁武區","Daliao":"大寮區","Luzhu":"路竹區","Taoyuan":"桃源區","Liouguei":"六龜區","Liugui":"六龜區","Yongan":"永安區","Yong'an":"永安區","Gangshan":"岡山區","Qiaotou":"橋頭區","Dashe":"大社區","Linyuan":"林園區","Dagang":"大樹區","Daliao":"大寮區"};
function translatedDistrict(v){if(!v)return '';for(const [en,zh] of Object.entries(districtEnglish))if(new RegExp('^'+en+'(?: District)?$','i').test(v.trim()))return zh;return /[\u4e00-\u9fff]/.test(v)?v:''}
const roadNumber=s=>{const m=norm(s).match(/([\u4e00-\u9fff]{1,12}(?:路|街|巷))([0-9]+)號/);return m?m[1]+m[2]:null};
const hostOK=h=>['maps.app.goo.gl','maps.google.com','www.google.com','google.com'].includes(h);
async function resolveGoogle(input){if(!input)return '';try{let u=new URL(input);if(u.protocol!=='https:'||!hostOK(u.hostname))return '';for(let i=0;i<5;i++){let res=await fetch(u.href,{redirect:'manual',signal:AbortSignal.timeout(4500)});if(![301,302,303,307,308].includes(res.status))break;let v=new URL(res.headers.get('location'),u);if(v.protocol!=='https:'||!hostOK(v.hostname))break;u=v;}return u.href}catch{return ''}}
function parseGoogle(url){if(!url)return {name:'',lat:null,lng:null};let u=new URL(url);let m=u.pathname.match(/\/place\/([^/]+)/);let name=m?decodeURIComponent(m[1].replace(/\+/g,' ')):u.searchParams.get('query')||u.searchParams.get('q')||'';let coords=url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);return {name,lat:coords?Number(coords[1]):null,lng:coords?Number(coords[2]):null,featureId:u.searchParams.get('ftid')||null};}
// V9: only explicitly requested coordinates or an owner-verified exact place.
// Never assume Google map viewport coordinates are the restaurant location.
const ownerVerifiedPlaces={
 '0x346e051853d87415:0x413c868f00f1bb0e':{
  name:'大韓食堂（復興店）',address:'高雄市新興區復興一路85號',
  lat:22.631793,lng:120.308086
 }
};
function trustedGoogleCoordinates(url,name,address){
 if(!url)return null;
 let u;try{u=new URL(url)}catch{return null}
 const fid=u.searchParams.get('ftid');
 const known=ownerVerifiedPlaces[fid];
 if(known){
  const nameOK=norm(name).includes(norm('大韓食堂'));
  const addrOK=norm(address).includes(norm('復興一路85號'))&&norm(address).includes(norm('新興區'));
  if(nameOK&&addrOK)return {...known,source:'使用者已核對的 Google Maps 地點',verified:true};
 }
 const raw=u.searchParams.get('query')||u.searchParams.get('q');
 const match=raw&&raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
 if(match){
  const lat=Number(match[1]),lng=Number(match[2]);
  if(lat>=21&&lat<=26&&lng>=119&&lng<=123)
   return {name:name||'Google Maps 座標',address:address||'',lat,lng,source:'Google Maps 明確座標查詢',verified:true};
 }
 return null;
}
async function googlePlaces(name,address){let key=process.env.GOOGLE_PLACES_API_KEY;if(!key)return null;let q=[name,address].filter(Boolean).join(' ');let res=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location'},body:JSON.stringify({textQuery:q,languageCode:'zh-TW',regionCode:'TW',pageSize:5}),signal:AbortSignal.timeout(8500)});if(!res.ok)throw Error('Google Places 查詢未成功（請檢查 API 設定）');let data=await res.json();return (data.places||[]).map(p=>({name:p.displayName?.text||'',address:p.formattedAddress||'',lat:p.location?.latitude,lng:p.location?.longitude,placeId:p.id})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));}
// Respect the public Nominatim service's low-volume usage policy: at most one request per second.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function addressVariants(address){
 const original=clean(address).replace(/臺/g,'台').replace(/\s+/g,'').replace(/^台灣(?:省)?/,'').replace(/^\d{3,6}(?=[\u4e00-\u9fff])/,'');
 const withoutVillage=original.replace(/([區鄉鎮市])[^區鄉鎮市]{1,10}里(?=[^里]*?(?:路|街|大道))/,'$1');
 const withoutDistrict=withoutVillage.replace(/^(.{2,3}[縣市])(.{1,8}[區鄉鎮市])/,'$1');
 return [...new Set([original,withoutVillage,withoutDistrict].filter(Boolean))];
}
function streetNumber(address){const a=norm(address);const m=a.match(/([\u4e00-\u9fff]{1,16}(?:路|街|大道))(\d+(?:之\d+)?)號/);return m?{street:m[1],number:m[2]}:null}
async function osmSearch(name,address){
 const variants=addressVariants(address);const street=streetNumber(address);
 const queries=[...variants];
 // A postal-code-free street address often works better for Taiwanese OSM entries.
 const plain=variants[1]||variants[0]||'';
 if(plain)queries.push(plain.replace(/^(高雄市|台北市|臺北市|台中市|臺中市|新北市)/,'$1 '));
 if(street){queries.push(street.street+street.number+'號 高雄市');queries.push(street.street+' '+street.number+' 高雄');}
 if(name)queries.push(name+' '+(address.match(/.{2,3}[縣市].{1,8}區/)||[''])[0]);
 const candidates=[];let requests=0;let serviceError=false;const attempts=[];
 for(const q of [...new Set(queries.filter(Boolean))].slice(0,5)){
  if(requests)await sleep(1150);requests++;
  try{
   const url='https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=tw&accept-language=zh-TW&q='+encodeURIComponent(q);
   const res=await fetch(url,{headers:{'User-Agent':'FoodMapPersonal/3.0 (personal restaurant map; Netlify Functions)','Accept':'application/json'},signal:AbortSignal.timeout(8000)});
   if(!res.ok){serviceError=true;attempts.push({query:q,httpStatus:res.status,count:0});continue}
   const arr=await res.json();attempts.push({query:q,httpStatus:res.status,count:arr.length});
   for(const p of arr){const lat=Number(p.lat),lng=Number(p.lon);if(Number.isFinite(lat)&&Number.isFinite(lng)&&!candidates.some(x=>x.lat===lat&&x.lng===lng))candidates.push({name:p.name||p.display_name?.split(',')[0]||'',address:p.display_name||'',lat,lng,osmType:p.type||'',osmClass:p.class||''})}
   if(candidates.some(p=>norm(p.address).includes(norm(street?.street||'')+street?.number)))break;
  }catch(e){serviceError=true;attempts.push({query:q,error:e?.name==='TimeoutError'?'timeout':'network_error',count:0})}
 }
 return {candidates,requests,serviceError,attempts};
}
// Optional independent open-data source. Photon indexes OpenStreetMap data, but coverage is not guaranteed.
async function photonSearch(name,address){
 const attempts=[],candidates=[];
 const region=(address.match(/[^\s,，]{2,3}[縣市]/)||[])[0]||'';
 const queries=[name&&region?name+' '+region:'',name||''].filter(Boolean);
 for(const q of [...new Set(queries)].slice(0,2)){
  try{
   const u='https://photon.komoot.io/api/?limit=8&lang=en&q='+encodeURIComponent(q);
   const r=await fetch(u,{headers:{'User-Agent':'FoodMapPersonal/6.0 (personal restaurant map)','Accept':'application/json'},signal:AbortSignal.timeout(7500)});
   if(!r.ok){attempts.push({query:q,httpStatus:r.status,count:0});continue}
   const data=await r.json();const features=data.features||[];
   attempts.push({query:q,httpStatus:r.status,count:features.length});
   for(const f of features){const a=f.properties||{},co=f.geometry?.coordinates||[];const lat=Number(co[1]),lng=Number(co[0]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<21||lat>26||lng<119||lng>123)continue;
    const adr=[a.housenumber&&a.street?a.street+' '+a.housenumber:[a.street,a.housenumber].filter(Boolean).join(' '),a.district,a.city,a.state,a.country].filter(Boolean).join(', ');
    const district=translatedDistrict(a.district)||translatedDistrict(a.city)||translatedDistrict(a.county);
    const city=/kaohsiung/i.test([a.city,a.state].join(' '))?'高雄市':(/[\u4e00-\u9fff]/.test(a.state||'')?a.state:'');
    const display=[city,district,[a.street,a.housenumber].filter(Boolean).join(' '),a.name].filter(Boolean).join(' ');
    if(!candidates.some(x=>x.lat===lat&&x.lng===lng))candidates.push({name:a.name||'',address:adr,displayAddress:display||adr,lat,lng,osmType:a.type||'',osmClass:a.osm_key||'',source:'Photon',district,city,street:a.street||'',houseNumber:String(a.housenumber||'')});
   }
  }catch(e){attempts.push({query:q,error:e?.name==='TimeoutError'?'timeout':'network_error',count:0})}
 }
 return {attempts,candidates};
}
function pick(candidates,name,address){
 const n=norm(name),a=norm(address),street=streetNumber(address),wantedDistrict=districtOf(address),wantedCity=cityOf(address);
 const seen=new Set();let rejected=0;
 const scored=candidates.map(p=>{
  const pn=norm(p.name),pa=norm(p.address),pd=norm(p.district||'');
  const exactName=!!n&&!!pn&&(pn.includes(n)||n.includes(pn));
  const streetMatch=!!street&&(pa.includes(norm(street.street))||norm(p.street||'').includes(norm(street.street)));
  const numberMatch=!!street&&(String(p.houseNumber||'')===street.number||new RegExp('(?:^|[^0-9])'+street.number+'(?:號|,|$)').test(pa));
  const fullAddress=!!a&&pa.includes(a);
  const districtMatch=!!wantedDistrict&&(pd===norm(wantedDistrict)||pa.includes(norm(wantedDistrict)));
  const cityMatch=!!wantedCity&&(norm(p.city||'')===norm(wantedCity)||pa.includes(norm(wantedCity))||/kaohsiung/i.test(pa)&&wantedCity==='高雄市');
  const otherDistrict=Object.values(districtEnglish).some(d=>d!==wantedDistrict&&(pd===norm(d)||(!pd&&pa.includes(norm(d)))));
  const wrongDistrict=!!wantedDistrict&&(otherDistrict||pd&&pd!==norm(wantedDistrict));
  const wrongCity=!!wantedCity&&p.city&&norm(p.city)!==norm(wantedCity);
  if(wrongDistrict||wrongCity){rejected++;return null}
  // Do not offer generic administrative-area centroids as restaurant pins.
  // Require both street+house number, or the restaurant name and matching district.
  if(!(streetMatch&&numberMatch)&&!(exactName&&districtMatch)){rejected++;return null}
  const key=String(p.lat.toFixed(5))+','+String(p.lng.toFixed(5));
  if(seen.has(key)){rejected++;return null}seen.add(key);
  const score=(exactName?6:0)+(streetMatch?2:0)+(numberMatch?5:0)+(fullAddress?6:0)+(districtMatch?3:0)+(cityMatch?1:0);
  return {...p,score,verifiedStreet:streetMatch&&numberMatch,verifiedDistrict:districtMatch};
 }).filter(Boolean).sort((x,y)=>y.score-x.score);
 const best=scored[0];
 // Only an unambiguous exact street+house number can be saved automatically.
 if(best&&best.verifiedStreet&&(!wantedDistrict||best.verifiedDistrict)&&(!scored[1]||best.score>scored[1].score))return {status:'matched',place:best,rejectedCount:rejected};
 return {status:'candidates',candidates:scored.slice(0,8),rejectedCount:rejected};
}
exports.handler=async event=>{try{let p=event.queryStringParameters||{};let name=clean(p.name),address=clean(p.address);if(!name&&!address)return json(400,{error:'缺少餐廳名稱或地址'});let resolved=await resolveGoogle(p.url);let hint=parseGoogle(resolved);if(!name)name=hint.name;
 const trusted=trustedGoogleCoordinates(resolved||p.url,name,address);
 if(trusted)return json(200,{status:'matched',place:trusted,provider:trusted.source,
  resolvedGoogleUrl:resolved||null,googleFeatureId:hint.featureId||null,
  diagnostics:{queriesAttempted:0,source:'verified-google-link',ownerVerified:!!ownerVerifiedPlaces[hint.featureId]},
  reason:'matched',notice:'只採用已核對的地點或明確座標網址，不使用地圖視角座標'});let candidates=null,provider='OpenStreetMap';try{candidates=await googlePlaces(name,address);if(candidates)provider='Google Places'}catch(e){return json(502,{error:e.message})}let diagnostics={};if(!candidates){const osm=await osmSearch(name,address);candidates=osm.candidates;diagnostics={queriesAttempted:osm.requests,serviceError:osm.serviceError,attempts:osm.attempts,candidateCount:osm.candidates.length};if(!candidates.length&&name){const photon=await photonSearch(name,address);candidates=photon.candidates;diagnostics.photonAttempts=photon.attempts;diagnostics.photonCandidateCount=photon.candidates.length;provider='OpenStreetMap / Photon'}}let result=pick(candidates,name,address);diagnostics.rejectedCount=result.rejectedCount||0;diagnostics.acceptedCandidateCount=result.status==='matched'?1:(result.candidates||[]).length;return json(200,{...result,provider,resolvedGoogleUrl:resolved||null,googleFeatureId:hint.featureId||null,googleCoordinateSuggestion:hint.lat>=21&&hint.lat<=26&&hint.lng>=119&&hint.lng<=123?{lat:hint.lat,lng:hint.lng,verified:false}:null,diagnostics,reason:result.status==='matched'?'matched':candidates.length?'ambiguous_or_unverified':'no_results',notice:'未驗證的地圖視角座標不會自動採用'})}catch(e){return json(502,{error:'地點查詢服務暫時無法使用'})}};
