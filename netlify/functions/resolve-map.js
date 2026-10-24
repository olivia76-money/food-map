// Google Maps URL expander for Netlify Functions. No credentials or scraping.
const allowed = h => h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'maps.google.com' || h === 'www.google.com' || h === 'google.com' || /^www\.google\.[a-z.]+$/.test(h);
const json = (status,body) => ({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
function parsePlace(raw){
 const u=new URL(raw);const path=u.pathname;
 let name='';const m=path.match(/\/place\/([^/]+)/);
 if(m){try{name=decodeURIComponent(m[1].replace(/\+/g,' '))}catch{name=m[1]}}
 if(!name)name=u.searchParams.get('query')||u.searchParams.get('q')||'';
 // !3d/!4d are often a place's map coordinates, but may be a map viewport.
 // Only present them for explicit user confirmation; never claim verified.
 const embedded=raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
 const query=(u.searchParams.get('query')||u.searchParams.get('q')||'').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
 const coord=embedded||query;
 let suggestedCoordinates=null;
 if(coord){const lat=Number(coord[1]),lng=Number(coord[2]);if(lat>=21&&lat<=26&&lng>=119&&lng<=123)suggestedCoordinates={lat,lng,source:embedded?'google-map-embedded':'google-map-query',verified:false}}
 const viewport=raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
 return {name:name.slice(0,180),address:'',lat:null,lng:null,suggestedCoordinates,unverifiedMapCoordinates:!!suggestedCoordinates||!!viewport,featureId:u.searchParams.get('ftid')||null};
}
exports.handler=async(event)=>{
 try{
  const input=event.queryStringParameters?.url;
  if(!input||input.length>1800)return json(400,{error:'請提供有效的 Google Maps 網址'});
  let url=new URL(input);
  if(url.protocol!=='https:'||!allowed(url.hostname.toLowerCase())||url.username||url.password||url.port)return json(400,{error:'只接受 Google Maps HTTPS 網址'});
  let current=url.href;
  for(let i=0;i<6;i++){
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6000);
   let res;
   try{res=await fetch(current,{method:'GET',redirect:'manual',signal:controller.signal,headers:{'User-Agent':'FoodMapTest/1.0','Accept':'text/html'}})}finally{clearTimeout(timer)}
   if([301,302,303,307,308].includes(res.status)){
    const location=res.headers.get('location');if(!location)break;
    const next=new URL(location,current);
    if(next.protocol!=='https:'||!allowed(next.hostname.toLowerCase())||next.username||next.password||next.port)return json(422,{error:'短網址導向了非 Google 網站，已停止解析'});
    current=next.href;continue;
   }
   break;
  }
  return json(200,{resolvedUrl:current,...parsePlace(current),verified:false,source:'google-url-redirect'});
 }catch(e){return json(502,{error:'Google Maps 網址無法展開，可能是網路或平台限制'})}
};
