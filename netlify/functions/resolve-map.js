// Google Maps URL expander for Netlify Functions. No credentials or scraping.
const allowed = h => h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'maps.google.com' || h === 'www.google.com' || h === 'google.com' || /^www\.google\.[a-z.]+$/.test(h);
const json = (status,body) => ({statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
function parsePlace(raw){
 const u=new URL(raw);const path=u.pathname;
 let name='';const m=path.match(/\/place\/([^/]+)/);
 if(m){try{name=decodeURIComponent(m[1].replace(/\+/g,' '))}catch{name=m[1]}}
 if(!name)name=u.searchParams.get('query')||u.searchParams.get('q')||'';
 let lat=null,lng=null;
 const coords=raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)||raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
 if(coords){lat=Number(coords[1]);lng=Number(coords[2]);if(Math.abs(lat)>90||Math.abs(lng)>180){lat=null;lng=null}}
 // The place path often contains a business name, not a verified postal address.
 return {name:name.slice(0,180),address:'',lat:null,lng:null,unverifiedMapCoordinates:lat!==null&&lng!==null};
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
