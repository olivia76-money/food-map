// Best-effort public metadata reader. Does not bypass login, platform blocks or access private content.
const hosts = new Set(['www.instagram.com','instagram.com','www.facebook.com','facebook.com','m.facebook.com','web.facebook.com','fb.watch','www.threads.net','threads.net','www.threads.com','threads.com']);
const reply=(code,data)=>({statusCode:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(data)});
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,v)=>{const a={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};if(v[0]==='#'){let n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' '}return a[v.toLowerCase()]||' '});
function meta(html,property){let tags=html.match(/<meta\b[^>]*>/gi)||[];for(const tag of tags){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[m[1].toLowerCase()]=m[2]??m[3];if((attrs.property||attrs.name||'').toLowerCase()===property.toLowerCase())return decode(attrs.content||'').slice(0,3500)}return ''}
exports.handler=async(event)=>{
 try{
  const input=event.queryStringParameters?.url;
  if(!input||input.length>1600)return reply(400,{error:'請提供社群貼文網址'});
  const u=new URL(input);
  if(u.protocol!=='https:'||!hosts.has(u.hostname.toLowerCase())||u.username||u.password||u.port)return reply(400,{error:'目前僅支援 Instagram、Facebook、Threads HTTPS 網址'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
  let res;try{res=await fetch(u.href,{redirect:'manual',signal:controller.signal,headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; FoodMapMetadataPreview/1.0)'}})}finally{clearTimeout(timer)}
  if(!res.ok)return reply(200,{available:false,reason:'平台未提供公開頁面（HTTP '+res.status+'）',title:'',description:''});
  const ct=res.headers.get('content-type')||'';
  if(!ct.includes('text/html'))return reply(200,{available:false,reason:'頁面不是可讀取的 HTML',title:'',description:''});
  const reader=res.body?.getReader();if(!reader)return reply(200,{available:false,reason:'沒有可讀取的頁面內容',title:'',description:''});
  let chunks=[],total=0;while(total<700000){let {done,value}=await reader.read();if(done)break;chunks.push(value);total+=value.length}await reader.cancel().catch(()=>{});
  let bytes=new Uint8Array(Math.min(total,700000)),offset=0;for(const c of chunks){const n=Math.min(c.length,bytes.length-offset);bytes.set(c.subarray(0,n),offset);offset+=n;if(offset>=bytes.length)break}
  const html=new TextDecoder('utf-8').decode(bytes);
  const title=meta(html,'og:title')||meta(html,'twitter:title');
  const description=meta(html,'og:description')||meta(html,'twitter:description')||meta(html,'description');
  if(!description&&!title)return reply(200,{available:false,reason:'平台未提供公開的貼文摘要',title:'',description:''});
  return reply(200,{available:true,title,description,source:'public-page-metadata',limitations:'僅公開頁面中可取得的標題及摘要；不包含影片、留言、登入後內容。'});
 }catch(e){return reply(200,{available:false,reason:'無法讀取公開貼文摘要（平台限制或網路問題）',title:'',description:''})}
};
