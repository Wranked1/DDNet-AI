const STREAM=(()=>{try{return location.pathname==='/stream'||/[?&]view=stream(&|$)/.test(location.search)}catch{return false}})();
if(STREAM)document.documentElement.classList.add('stream');

const NICKS=(()=>{if(!STREAM)return '';try{const v=new URLSearchParams(location.search).get('nicks');return v==='on'?'':v==='off'?'off':'id'}catch{return 'id'}})();
const nickIds=new Map();

let nicksChanged=false;
const nickLabel=(id)=>NICKS==='id'?'#'+id:'';
function hideNicks(f){
 if(!NICKS)return;
 for(const t of [...(f.tees||[]),...(f.players||[])]){if(t.id===f.selfId||typeof t.name!=='string')continue;if(t.name.length>1&&nickIds.get(t.name)!==t.id){nickIds.set(t.name,t.id);nicksChanged=true}t.name=nickLabel(t.id);t.clan=''}
}
function hideNicksIn(text){
 if(!NICKS)return text;

 text=text.replace(/(called (?:for )?vote to .*?) ?\((.*)\)$/i,'$1');
 if(!nickIds.size)return text;
 const names=[...nickIds.keys()].sort((a,b)=>b.length-a.length).map((n)=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 return text.replace(new RegExp('(?<![\\p{L}\\p{N}_])(?:'+names.join('|')+')(?![\\p{L}\\p{N}_])','gu'),(m)=>nickLabel(nickIds.get(m))||'…');
}

{const mini=()=>{try{document.documentElement.classList.toggle('mini',STREAM||/[?&]view=mini(&|$)/.test(location.search)||location.hash==='#mini')}catch{}};mini();try{addEventListener('hashchange',mini)}catch{}}

const embedded=(()=>{try{return window.self!==window.top}catch{return true}})();
if(embedded)document.documentElement.classList.add('embedded');

const THEMES=['light','dark','auto'];
const themeOf=(v)=>THEMES.includes(v)?v:null;
const themeFor=(pref,sysDark)=>pref==='dark'||(pref!=='light'&&sysDark)?'dark':'light';
let themePref='auto';
try{themePref=themeOf(new URLSearchParams(location.search).get('theme'))||'auto'}catch{}
const themeMq=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
function applyTheme(){try{document.documentElement.dataset.theme=themeFor(themePref,!!(themeMq&&themeMq.matches))}catch{}}
applyTheme();
try{if(themeMq)themeMq.addEventListener('change',applyTheme)}catch{}
try{addEventListener('message',(e)=>{if(e.source!==window.parent)return;const d=e.data;if(d&&d.ddai==='theme'&&themeOf(d.theme)){themePref=d.theme;applyTheme()}})}catch{}

{
 let tip=null,cur=null,timer=0;
 const hide=()=>{clearTimeout(timer);cur=null;if(tip)tip.hidden=true};
 const place=(el)=>{
  const r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  const x=Math.max(6,Math.min(innerWidth-w-6,r.left+r.width/2-w/2));
  const y=r.bottom+8+h<=innerHeight-6?r.bottom+8:Math.max(6,r.top-h-8);
  tip.style.left=x+'px';tip.style.top=y+'px';
 };
 document.addEventListener('mouseover',(e)=>{
  const el=e.target instanceof Element?e.target.closest('[title],[data-tip]'):null;
  if(el&&el.hasAttribute('title')){const v=el.getAttribute('title')||'';el.removeAttribute('title');el.dataset.tip=v;if(!el.textContent.trim())el.setAttribute('aria-label',v)}
  if(el===cur)return;
  hide();
  if(!el||!el.dataset.tip)return;
  cur=el;
  timer=setTimeout(()=>{
   if(cur!==el||!el.isConnected)return;
   if(!tip){tip=document.createElement('div');tip.className='tip';document.body.appendChild(tip)}
   tip.textContent=el.dataset.tip;tip.hidden=false;place(el);
  },350);
 });
 document.addEventListener('mouseout',(e)=>{if(!e.relatedTarget)hide()});
 for(const ev of ['mousedown','keydown','wheel'])document.addEventListener(ev,hide,true);
 addEventListener('blur',hide);

 try{new MutationObserver((ms)=>{for(const m of ms){const el=m.target;if(!el.hasAttribute('title')||!('tip' in el.dataset))continue;const v=el.getAttribute('title')||'';el.removeAttribute('title');el.dataset.tip=v;if(!el.textContent.trim())el.setAttribute('aria-label',v);if(el===cur&&tip&&!tip.hidden){if(v){tip.textContent=v;place(el)}else hide()}}}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['title']})}catch{}
}
const $=(s)=>document.querySelector(s);
let stick=true,lastStatus=null,lastVersion='',boot='',logKey='';
let map=null,mapName='',mapKey='',frame=null,prevFrame=null,view=null,dataFound=false;
let lines=[],chatOpen=false,chatSeen=-1,boardHeld=false;
let ac=null,muted=true;

const PVIEW=(()=>{try{return viewOf(location.search)}catch{return 'game'}})();
const IGRA=embedded&&PVIEW==='game'&&!STREAM;
const IG_FOLD='ddai.igra.fold',IG_VOL='ddai.vol',IG_STATS='ddai.igra.stats';
const igState={sel:'a',fold:false,vol:70,pend:{},sw:{},at:0,launch:null,stats:'',skins:null,r:null,note:0,edit:null};

if(embedded)try{const raw=localStorage.getItem(IG_VOL),v=Number(raw);if(raw!==null&&Number.isFinite(v))igState.vol=Math.max(0,Math.min(100,v))}catch{}
if(embedded)try{igState.statsOpen=localStorage.getItem(IG_STATS)==='1'}catch{}
if(embedded)try{igState.fold=localStorage.getItem(IG_FOLD)==='1';document.documentElement.classList.toggle('ig-folded',igState.fold)}catch{}
let relations={war:[],friend:[],ignore:[]},playersKey='',playersShown=[],partnerRowId=-1,partnerRowName='';
const hist=[],seenAt=new Map();let hix=-1;
const locale=LANG==='en'?'en-GB':'ru-RU';

function translateDom(root){
 if(LANG!=='en')return;
 for(const el of root.querySelectorAll('[data-t]')){const v=t(el.dataset.t);if(v!==el.dataset.t)el.innerHTML=v}
 const cyr=/[А-Яа-яЁё]/;
 const code=(n)=>n.parentNode&&(n.parentNode.nodeName==='SCRIPT'||n.parentNode.nodeName==='STYLE');
 const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:(n)=>code(n)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 for(let n=walk.nextNode();n;n=walk.nextNode()){
  const s=n.nodeValue;if(!cyr.test(s))continue;
  const k=s.trim(),v=t(k);if(v!==k)n.nodeValue=s.replace(k,()=>v);
 }
 for(const el of root.querySelectorAll('[title],[placeholder],[aria-label]'))for(const a of ['title','placeholder','aria-label']){
  const v=el.getAttribute(a);if(v&&cyr.test(v)){const x=t(v);if(x!==v)el.setAttribute(a,x)}
 }
}
translateDom(document.body);
document.documentElement.classList.remove('i18n-wait');
const modeNames={map:t('вид: карта'),ent:t('вид: сущности'),both:t('вид: вместе')};

for(const b of document.querySelectorAll('.tab')){
 b.addEventListener('click',()=>{
  for(const o of document.querySelectorAll('.tab'))o.className='tab'+(o===b?' on':'');
  for(const p of document.querySelectorAll('[data-pane]'))p.hidden=p.dataset.pane!==b.dataset.tab;
  if(b.dataset.tab==='cfg'){pullConfig();pullKnobs();pullLaunch();}
  if(b.dataset.tab==='clips')pullClips();
  if(b.dataset.tab!=='clips')stopClip();
 });
}

const MODE_KEY='ddai.mode',TOUR_KEY='ddai.tour.v2';
const uiModeFor=(stored,tourSeen)=>stored==='full'||stored==='simple'?stored:tourSeen?'full':'simple';
function setUiMode(m,save){
 document.documentElement.classList.toggle('simple',m==='simple');
 for(const b of document.querySelectorAll('#modesw [data-ui]')){const on=b.dataset.ui===m;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}
 if(save){try{localStorage.setItem(MODE_KEY,m)}catch{}}
}
{
 let stored=null,tourSeen=false,mini=false;try{stored=localStorage.getItem(MODE_KEY);tourSeen=localStorage.getItem(TOUR_KEY)==='seen';mini=document.documentElement.classList.contains('mini')}catch{}

 const m=embedded?'full':uiModeFor(stored,tourSeen);
 setUiMode(m,!embedded&&m!==stored&&!mini);
 for(const b of document.querySelectorAll('#modesw [data-ui]'))b.addEventListener('click',()=>setUiMode(b.dataset.ui==='full'?'full':'simple',true));
}

let logFilter='all', logFind='';
for(const b of document.querySelectorAll('[data-filter]')){
 b.addEventListener('click',()=>{
  logFilter=b.dataset.filter;
  for(const o of document.querySelectorAll('[data-filter]'))o.className='ghost'+(o===b?' on':'');
  renderLog(true);
 });
}
$('#find').addEventListener('input',(e)=>{logFind=e.target.value.toLowerCase();renderLog(true)});
for(const b of document.querySelectorAll('[data-cmd]')){
 b.addEventListener('click',()=>{if(b.closest('.ctl'))void botCmd(b.dataset.cmd,true);else{$('#i').value=b.dataset.cmd;$('#f').requestSubmit()}});
}

{
 const bar=$('#langbar');
 if(bar&&(embedded||/[?&]lang=/.test(location.search)))bar.hidden=true;
 for(const b of document.querySelectorAll('[data-lang]')){
  b.className='ghost'+(b.dataset.lang===LANG?' on':'');
  b.addEventListener('click',async()=>{if(b.dataset.lang===LANG)return;await botCmd('!lang '+b.dataset.lang);location.reload()});
 }
}

const ICONS={
 sword:'<path d="M3 13 11.5 4.5M9.5 3H13v3.5M4 10l2 2M2.5 13.5 4 12"/>',
 shield:'<path d="M8 2.2 13 4v4c0 3-2.3 5-5 6-2.7-1-5-3-5-6V4z"/>',
 stop:'<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
 target:'<circle cx="8" cy="8" r="5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
 go:'<path d="M2.5 8h10M9 4.5 12.5 8 9 11.5"/>',
 eye:'<path d="M1.5 8c2-3.5 11-3.5 13 0-2 3.5-11 3.5-13 0z"/><circle cx="8" cy="8" r="2"/>',
 respawn:'<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5"/>',
 rec:'<circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/>',
 home:'<path d="M2.5 8 8 3l5.5 5M4 7v6h8V7"/>',
 x:'<path d="M4 4l8 8M12 4l-8 8"/>',
 chat:'<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
 pencil:'<path d="M10.2 2.8l3 3L5.5 13.5 2.3 13.7l.2-3.2z"/>',
 'chev-r2':'<path d="M3.5 4l4 4-4 4M8.5 4l4 4-4 4"/>',
 'chev-l2':'<path d="M12.5 4l-4 4 4 4M7.5 4l-4 4 4 4"/>',
 copy:'<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5v-1.4a1.2 1.2 0 0 0-1.2-1.2H4.1a1.2 1.2 0 0 0-1.2 1.2v5.2a1.2 1.2 0 0 0 1.2 1.2h1.4"/>',
 vol:'<path d="M2.5 6.2h2.2L8 3.4v9.2L4.7 9.8H2.5z"/><path d="M10.6 5.9a3.2 3.2 0 0 1 0 4.2M12.3 4.2a5.6 5.6 0 0 1 0 7.6"/>',
 mute:'<path d="M2.5 6.2h2.2L8 3.4v9.2L4.7 9.8H2.5z"/><path d="M10.6 6.2l3 3.6M13.6 6.2l-3 3.6"/>',
 more:'<circle cx="3.4" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
 chart:'<path d="M3.5 13V8.5M8 13V3.5M12.5 13V6"/>'
};
function iconSvg(name){return '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[name]||'')+'</svg>'}
for(const i of document.querySelectorAll('i[data-ic]'))i.outerHTML=iconSvg(i.dataset.ic);

let replyTimer=0;

const MODE_WORD={fight:t('драться'),passive:t('не лезть'),hold:t('стоять')};
const replyText=(r)=>LANG==='en'?r.replace(/ -- /g,'; '):r
 .replace(/^goto: (?:the WB is off|duel on|cancelled), back to (fight|passive|hold)(; |$)/,(m,b,end)=>t('поход отменён, дальше: {mode}',{mode:MODE_WORD[b]})+end)
 .replace(/^goto: dropped by \?\w+\. /,t('поход отменён')+'; ')
 .replace(/(^|; )(?:stopped|mode: hold)$/,(m,p)=>p+t('бот стоит'))
 .replace(/(^|; )playing$/,(m,p)=>p+t('бот играет'))
 .replace(/(^|; )mode: passive$/,(m,p)=>p+t('бот не лезет'))
 .replace(/(^|; )mode: fight$/,(m,p)=>p+t('бот дерётся'))
 .replace(/^killed, respawning$/,t('убит, возрождается'))
 .replace(/^paused by the server: no kill sent$/,t('сервер поставил бота на паузу: kill не отправлен'))
 .replace(/^not connected: no kill sent$/,t('нет соединения: kill не отправлен'))
 .replace(/^target cleared, back to picking automatically$/,t('цель сброшена, бот выбирает сам'))
 .replace(/^target set to '(.*?)'( \(nobody by that name is on the server now\))?$/,(m,n,gone)=>t('цель: {name}',{name:n})+(gone?' '+t('(сейчас его нет на сервере)'):''))
 .replace(/^'(.*)' is the bot itself$/,(m,n)=>t('{name}: это сам бот',{name:n}))
 .replace(/^home set to tile \((-?\d+),(-?\d+)\);.*$/,(m,x,y)=>t('дом: клетка ({x}, {y})',{x,y}))
 .replace(/^home cleared.*$/,t('дом забыт'))
 .replace(/^saved (\d+)s to (.+)$/,(m,n,file)=>t('клип: {n} с в {file}',{n,file}))
 .replace(/^nothing recorded yet$/,t('записывать в клип пока нечего'))
 .replace(/^could not write the clip$/,t('клип не записался'))
 .replace(/^no tee yet$/,t('бот ещё не в игре'))
 .replace('WB: off -- it stays wherever the fight is',t('ВБ выключен: бот остаётся там, где бой'))
 .replace(/WB: off \(this map has none; it applies on (.*)\)/,(m,maps)=>t('ВБ выключен (на этой карте его нет; он работает на {maps})',{maps:maps.replace(/ and its copies with the same hall$/,' '+t('и её копиях с тем же залом'))}))
 .replace('duel: on -- fights whoever is there, no WB, no walks',t('дуэль включена: бьёт того, кто рядом, без ВБ и походов'))
 .replace(/WB: auto -- the side with fewer players playing, the one it stands on in a tie, then held/,t('ВБ: сторона, где играет меньше игроков, при равенстве та, на которой стоит, потом держит её'))
 .replace(/WB: the (left|right) side/,(m,side)=>side==='left'?t('ВБ: левая сторона'):t('ВБ: правая сторона'))
 .replace(/ \(not held while !home is set: !home off\)$/,' ('+t('не держит, пока задан дом: !home off')+')');
async function botCmd(v,show){
 let reply='';
 try{const r=await(await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:v})})).json();reply=r&&r.reply?String(r.reply):''}catch{}

 const second=lastStatus&&lastStatus.dummy&&lastStatus.dummy.name?lastStatus.dummy.name+': ':'';
 if(second&&/^!d(\s|$)/i.test(v)&&reply.startsWith(second))reply=reply.slice(second.length);
 if(show&&reply){const boxes=[$('#reply'),$('#sreply')].filter(Boolean),line=tr(replyText(reply.split('\n')[0]));for(const box of boxes){box.textContent=line;box.hidden=false}clearTimeout(replyTimer);replyTimer=setTimeout(()=>{for(const box of boxes)box.hidden=true},5000);igNote(line)}
 tick();
 return reply;
}
$('#emo').addEventListener('change',()=>{const v=$('#emo').value;if(v)botCmd('!emote '+v);$('#emo').value=''});

let panel=null,doingText='';
const MODE_CMD={fight:'!go',passive:'!mode passive',hold:'!mode hold'};
const STYLE_HINT={default:t('Обычная игра: дерётся там, где игра, ВБ не держит'),wb:t('Держит вейблок и закидывает во фриз всех, кто идёт через него'),duel:t('Один на один: бьёт соперника, никуда не уходит. Включается и сам, когда бот принял дуэль')};
for(const b of document.querySelectorAll('#modeseg [data-mode]'))b.addEventListener('click',()=>void botCmd(MODE_CMD[b.dataset.mode],true));
for(const b of document.querySelectorAll('#wbseg [data-wb]'))b.addEventListener('click',()=>void botCmd('!wb '+b.dataset.wb,true));
for(const b of document.querySelectorAll('#styleseg [data-style]'))b.addEventListener('click',()=>void botCmd('!style '+b.dataset.style,true));

for(const b of document.querySelectorAll('#sbtns [data-style]'))b.addEventListener('click',async()=>{if(lastStatus&&!(lastStatus.acting===true&&(lastStatus.mode==='fight'||lastStatus.mode==='goto')))await botCmd('!go',false);void botCmd('!style '+b.dataset.style,true)});
$('#tgtclear').addEventListener('click',()=>void botCmd('!target -',true));

$('#walkstop').addEventListener('click',()=>{if(lastStatus&&lastStatus.mode==='goto')void botCmd('!stop',true)});
$('#sstop').addEventListener('click',()=>{if(lastStatus&&lastStatus.mode==='goto')void botCmd('!stop',true)});

$('#sstoggle').addEventListener('click',()=>void botCmd(lastStatus&&lastStatus.acting===false?'!go':'!mode hold',true));
$('#aclip').addEventListener('click',()=>void botCmd('!clip',true));
$('#aspec').addEventListener('click',()=>void botCmd(panel&&panel.spectating?'!join':'!spec',true));
$('#ahome').addEventListener('click',()=>void botCmd(panel&&panel.home?'!home off':'!home',true));

$('#lowcpu').addEventListener('change',()=>void botCmd($('#lowcpu').checked?'!low on':'!low off',true));

$('#strongcpu').addEventListener('change',()=>void botCmd($('#strongcpu').checked?'!strong on':'!strong off',true));

$('#own_save').addEventListener('click',async()=>{
 const v=$('#own_nick').value.trim();
 const r=String(await botCmd(v===''?'!owner off':'!owner '+v,false)||'');
 const m=/^owner: (.+?)(?: \(nobody| --|$)/.exec(r);
 $('#own_note').textContent=v===''?t('никого не слушает'):t('хозяин: {name}',{name:m?m[1]:v})+(/nobody by that name/.test(r)?' '+t('(сейчас его нет на сервере)'):'');
 $('#own_nick').blur();
});
$('#own_llm').addEventListener('change',()=>void botCmd($('#own_llm').checked?'!llm on':'!llm off',true));

const LLM_LABELS={llm7:t('LLM7: бесплатно, без ключа (10 в минуту, 60 в час), запасной ch.at'),chat:t('ch.at: бесплатно, без ключа'),mistral:t('Mistral: бесплатный ключ'),github:t('GitHub Models: бесплатно с токеном GitHub'),sambanova:t('SambaNova: бесплатный ключ'),nvidia:t('NVIDIA NIM: бесплатный ключ'),groq:t('Groq: бесплатный ключ (30 в минуту, 14 400 в день)'),cerebras:t('Cerebras: бесплатный ключ (30 в минуту, 14 400 в день)'),gemini:t('Google Gemini: бесплатный ключ'),openrouter:t('OpenRouter: бесплатный ключ, модели с :free'),openai:t('OpenAI: платный ключ'),anthropic:t('Anthropic Claude: платный ключ'),ollama:t('Ollama: нейросеть на этом ПК')};
const LLM_KEYS={mistral:'console.mistral.ai/api-keys',github:'github.com/settings/personal-access-tokens',sambanova:'cloud.sambanova.ai/apis',nvidia:'build.nvidia.com',groq:'console.groq.com/keys',cerebras:'cloud.cerebras.ai',gemini:'aistudio.google.com/apikey',openrouter:'openrouter.ai/keys',openai:'platform.openai.com/api-keys',anthropic:'console.anthropic.com/settings/keys'};
let llmPresets=[],llmSaved={url:'',hasKey:false};

function llmKeyHint(url){$('#llm_key').placeholder=llmSaved.hasKey&&url===llmSaved.url?t('ключ сохранён; новый заменит его'):t('ключ (пусто: без ключа)')}
function llmHint(id){$('#llm_hint').textContent=LLM_KEYS[id]?t('Ключ бесплатно или за деньги берётся на {site}',{site:LLM_KEYS[id]}):id==='ollama'?t('Нужна запущенная Ollama с этой моделью'):id==='llm7'||id==='chat'?t('Ничего не нужно'):''}
async function pullLlm(){
 let d=null;try{d=await(await fetch('/api/llm',{cache:'no-store'})).json()}catch{d=null}
 if(!d||!Array.isArray(d.presets))return;
 llmPresets=d.presets;
 const sel=$('#llm_preset');sel.textContent='';
 for(const p of llmPresets){const o=document.createElement('option');o.value=p.id;o.textContent=LLM_LABELS[p.id]||p.label;sel.appendChild(o)}
 const own=document.createElement('option');own.value='custom';own.textContent=t('Свой адрес');sel.appendChild(own);
 const cur=llmPresets.find((p)=>p.url===d.url);
 sel.value=cur?cur.id:'custom';$('#llm_url').value=d.url;$('#llm_model').value=d.model;
 llmSaved={url:d.url,hasKey:d.hasKey===true};
 $('#llm_key').value='';llmKeyHint(d.url);
 llmHint(sel.value);
}
$('#llm_preset').addEventListener('change',()=>{const p=llmPresets.find((x)=>x.id===$('#llm_preset').value);if(p){$('#llm_url').value=p.url;$('#llm_model').value=p.model}llmHint($('#llm_preset').value);llmKeyHint($('#llm_url').value.trim())});
$('#llm_url').addEventListener('input',()=>llmKeyHint($('#llm_url').value.trim()));
$('#llm_save').addEventListener('click',async()=>{
 const id=$('#llm_preset').value;
 const body=id==='llm7'?null:{url:$('#llm_url').value.trim(),model:$('#llm_model').value.trim(),key:$('#llm_key').value};
 let r='';try{r=(await(await fetch('/api/llm',{method:'POST',body:JSON.stringify(body)})).json()).reply||''}catch{r=''}
 $('#llm_note').textContent=r.startsWith('no:')||r===''?t('Не сохранено: нужны адрес http(s) и название модели'):t('Сохранено');
 if(!r.startsWith('no:')&&r!=='')await botCmd('!llm on',false);
 pullLlm();
});
pullLlm();

for(const b of document.querySelectorAll('#tf_duel [data-duel]'))b.addEventListener('click',async()=>{const r=await botCmd('!duel '+b.dataset.duel,false);$('#tf_note').textContent=r?tr(replyText(r.split('\n')[0])):''});
if($('#try_sel'))$('#try_sel').addEventListener('change',async()=>{const r=await botCmd('!try '+$('#try_sel').value,false);$('#tf_note').textContent=r?tr(replyText(r.split('\n')[0])):''});
function renderTestFx(p){
 if(!p)return;
 for(const b of document.querySelectorAll('#tf_duel [data-duel]'))b.classList.toggle('on',b.dataset.duel===p.duelMode);
 const ts=$('#try_sel');
 if(ts&&ts.value!==p.tryName&&[...ts.options].some((o)=>o.value===p.tryName)){ts.value=p.tryName;if(ts._dd)ts._dd.refresh()}
}
function renderPanel(s){
 panel=s.panel||null;
 renderTestFx(panel);
 if(document.activeElement!==$('#own_nick')&&typeof s.owner==='string')$('#own_nick').value=s.owner;
 $('#own_llm').checked=s.llm===true;
 $('#lowcpu').checked=s.lowCpu===true;
 $('#strongcpu').checked=s.strong===true;

 const d=s.dummy||null;

 const pid=d&&d.phase==='online'&&Number.isFinite(d.id)&&d.id>=0?d.id:-1;
 if(pid!==partnerRowId){partnerRowId=pid;playersKey=''}

 partnerRowName=d&&d.name?String(d.name):'';
 $('#dummyrow').hidden=!d;
 if(d){
  const on=d.phase==='online';
  $('#dummychip').textContent=!on?t('не в игре'):d.frozen?t('во фризе'):d.acting?t('свободен'):t('стоит');
  $('#dummychip').className='chip '+(!on?'off':d.frozen?'frozen':'free');
  $('#dummytext').textContent=d.name+(d.wb?' · '+(d.wb==='WB left'?t('держит ВБ слева'):t('держит ВБ справа')):'')+(d.target?' · '+t('цель: {name}',{name:d.target}):'');
 }
 const mode=s.acting?s.mode:'hold';
 const tg=$('#sstoggle');if(tg){const stopped=s.acting===false;tg.textContent=stopped?t('Играть'):t('Стоп');tg.title=stopped?t('Бот стоит: запустить (!go)'):t('Остановить бота: стоит, пока не нажмёшь «Играть»');tg.disabled=s.phase!=='online'}
 for(const b of document.querySelectorAll('#modeseg [data-mode]'))b.classList.toggle('on',b.dataset.mode===mode);

 const wb=panel?panel.wbMode:null,hasWb=wb!==null&&wb!==undefined;
 const style=panel&&panel.inDuel?'duel':hasWb&&wb!=='off'?'wb':'default';
 for(const b of document.querySelectorAll('#styleseg [data-style],#sbtns [data-style]')){const on=b.dataset.style===style;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}
 for(const wbBtn of document.querySelectorAll('#styleseg [data-style=wb],#sbtns [data-style=wb]')){wbBtn.disabled=!hasWb;wbBtn.title=hasWb?STYLE_HINT.wb:t('На этой карте нет ВБ, который бот знает')}
 for(const sb of document.querySelectorAll('#sbtns [data-style]'))sb.disabled=s.phase!=='online'||(sb.dataset.style==='wb'&&!hasWb);
 for(const duelBtn of document.querySelectorAll('#styleseg [data-style=duel],#sbtns [data-style=duel]'))duelBtn.classList.toggle('auto',!!(panel&&panel.inDuel&&panel.duelMode==='auto'));
 const shint=$('#shint');if(shint)shint.textContent=STYLE_HINT[style];
 $('#wbrow').hidden=style!=='wb';
 for(const b of document.querySelectorAll('#wbseg [data-wb]'))b.classList.toggle('on',b.dataset.wb===wb);
 const pin=panel&&panel.pinnedTarget;
 $('#tgt').textContent=pin?t('только {name}',{name:pin}):t('сам выбирает');
 $('#tgt').classList.toggle('pinned',!!pin);
 $('#tgtclear').hidden=!pin;
 const walking=s.mode==='goto';
 $('#walk').hidden=!walking;
 if(walking)$('#walktext').textContent=doingText||t('идёт по !goto');
 const spec=!!(panel&&panel.spectating);
 $('#aspec').classList.toggle('on',spec);$('#aspecl').textContent=spec?t('в игру'):t('наблюдать');
 $('#aspec').title=spec?t('Бот возвращается в игру'):t('Бот уходит в наблюдатели');
 const home=!!(panel&&panel.home);
 $('#ahome').classList.toggle('on',home);$('#ahomel').textContent=home?t('забыть дом'):t('дом здесь');
 $('#ahome').title=home?t('Бот больше не возвращается к отмеченной точке'):t('Бот вернётся сюда, когда не с кем драться');
}
let voteList=[];
function renderVotes(){
 const q=($('#vfind').value||'').toLowerCase();
 const rows=voteList.filter((v)=>!q||v.toLowerCase().includes(q)).slice(0,200);
 $('#vlist').innerHTML=rows.length?rows.map((v,i)=>'<button type="button" data-vote="'+i+'">'+esc(v)+'</button>').join(''):'<div class="none">'+(voteList.length?t('ничего не нашлось'):t('сервер не предлагает голосований'))+'</div>';
 for(const b of $('#vlist').querySelectorAll('[data-vote]'))b.addEventListener('click',()=>{const v=rows[Number(b.dataset.vote)];if(v!==undefined)botCmd('!vote '+v);$('#votes').hidden=true});
}
$('#votesbtn').addEventListener('click',async()=>{
 const box=$('#votes');box.hidden=!box.hidden;if(box.hidden)return;
 try{voteList=await(await fetch('/api/votes')).json()}catch{voteList=[]}
 renderVotes();$('#vfind').focus();
});
$('#vfind').addEventListener('input',renderVotes);
$('#vfind').addEventListener('keydown',(e)=>{if(e.key==='Escape')$('#votes').hidden=true});

let voteSeen=0,voteTimer=0;
function watchVotes(){
 for(const l of lines){
  if(!(l.seq>voteSeen))continue;voteSeen=l.seq;
  const text=String(l.text||'');
  const m=text.match(/called (?:for )?vote to (?:change server option|kick|mute|move|pause) ['‘]?(.+?)['’]? ?(?:\((.*)\))?$/i)||text.match(/called (?:for )?vote to (.+)$/i);
  if(m){$('#vtext').textContent=t('Голосование: {what}',{what:m[1]+(m[2]?' ('+m[2]+')':'')});$('#voteban').hidden=false;clearTimeout(voteTimer);voteTimer=setTimeout(()=>{$('#voteban').hidden=true},30000)}
  else if(/vote (passed|failed|aborted)|vote was (passed|failed)|you voted/i.test(text)){$('#voteban').hidden=true}
 }
}
$('#clipref').addEventListener('click',pullClips);
if($('#s_update'))$('#s_update').addEventListener('click',async()=>{
 $('#s_note').textContent=t('проверяю...');
 try{const r=await(await fetch('/api/update',{method:'POST'})).json();$('#s_note').textContent=r.reply?tr(r.reply):t('готово')}
 catch{$('#s_note').textContent=t('не вышло проверить')}
});
if($('#send'))$('#send').addEventListener('click',()=>$('#f').requestSubmit());

function mss(sec){const s=Math.round(sec),h=Math.floor(s/3600),m=Math.floor(s/60)%60,r=String(s%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+r:m+':'+r}
function human(n){return n>1048576?t('{n} МБ',{n:(n/1048576).toFixed(1)}):t('{n} КБ',{n:(n/1024).toFixed(0)})}

let clipList=[],clipName='',clip=null,clipFrames=[],clipAt=0,clipPlaying=false,clipTimer=0,view2=null;
const CLIP_KINDS={'self-freeze':t('сам замёрз'),'chased-into-freeze':t('загнали во фриз'),'goto-into-freeze':t('замёрз по дороге'),'slow-rehook':t('долго не мог зацепить'),'manual':t('вручную')};
function clipTitle(name){const m=name.match(/^([a-z]+(?:-[a-z]+)*)-\d/);return m&&CLIP_KINDS[m[1]]?CLIP_KINDS[m[1]]:name.replace(/\.json$/,'')}

if($('#overlayurl'))$('#overlayurl').textContent=location.origin+'/overlay';
if($('#streamurl'))$('#streamurl').textContent=location.origin+'/stream';
async function pullDuels(){
 let got=null;try{got=await(await fetch('/api/duels')).json()}catch{got=null}
 const list=got&&Array.isArray(got.list)?got.list:[];
 const n=got&&Number.isFinite(got.n)?got.n:list.length;
 if($('#dueln'))$('#dueln').textContent=n?(got.roundsOurs||got.roundsTheirs?t('· {n} · раундов {r} : {q}, заморозил {a} : {b}',{n,r:got.roundsOurs||0,q:got.roundsTheirs||0,a:got.ours||0,b:got.theirs||0}):t('· {n} · заморозил {a} : {b}',{n,a:got.ours||0,b:got.theirs||0})):'';
 if($('#dlist'))$('#dlist').innerHTML=list.length?list.map((d)=>'<div class="drow"><span>'+esc(d.opponent)+(d.by?' <small>'+esc(t('против {name}',{name:d.by}))+'</small>':'')+'</span><b>'+esc(String(d.ours))+' : '+esc(String(d.theirs))+'</b><small>'+esc(new Date(d.at).toLocaleString(locale,{dateStyle:'short',timeStyle:'short'}))+(Number.isFinite(d.seconds)&&d.seconds>0?' · '+mss(d.seconds):'')+(d.rounds&&Number.isFinite(d.froze)?' · '+esc(t('заморозил {a} : {b}',{a:d.froze,b:d.frozen||0})):'')+'</small></div>').join('')
  :'<div class="none">'+t('дуэлей пока не было')+'</div>';
}
async function pullClips(){
 pullDuels();
 try{clipList=(await(await fetch('/api/clips')).json()).sort((a,b)=>b.when-a.when)}catch{clipList=[]}
 if($('#clipn'))$('#clipn').textContent=clipList.length?'· '+clipList.length:'';
 $('#clist').innerHTML=clipList.length?clipList.map((c,i)=>'<button type="button" data-clip="'+i+'" class="'+(c.name===clipName?'on':'')+'"><span>'+esc(clipTitle(c.name))+'</span><small>'+esc(new Date(c.when).toLocaleString(locale))+' · '+human(c.size)+'</small></button>').join('')
  :'<div class="none">'+t('записей пока нет')+'</div>';
}
$('#clist').addEventListener('click',(e)=>{const b=e.target.closest('[data-clip]');if(!b)return;const c=clipList[Number(b.dataset.clip)];if(c)openClip(c.name)});

const tileKind=(v)=>v===1?1:v===3?5:v===2?3:v===9||v===12?2:v===11||v===13?4:0;
function clipFrame(c,f){
 const who=new Map((c.players||[]).map((p)=>[p.id,p]));
 const tees=f.tees.filter((x)=>x.alive).map((x)=>{
  const p=who.get(x.id)||{name:'#'+x.id,clan:'',skin:'default'};
  return {id:x.id,name:p.name,x:Math.round(x.x),y:Math.round(x.y),frozen:x.frozen,hook:x.hookState,hx:Math.round(x.hookX),hy:Math.round(x.hookY),hooked:x.hookedPlayer,
   clan:p.clan,skin:p.skin,cc:p.cc,cb:p.cb,cf:p.cf,aim:x.angle/256,wp:x.weapon,emote:0,vx:x.vx,vy:x.vy,dir:x.direction,jumped:x.jumped,atk:50,fz:x.freezeTicksLeft,pf:0,jl:x.jumpsLeft};
 });
 const inp=(f.inputs||[]).find((i)=>i.id===c.selfId);
 let cursor;
 if(inp){const l=Math.hypot(inp.targetX,inp.targetY);if(l>=1){const k=Math.min(1,400/l);cursor={x:Math.round(inp.targetX*k),y:Math.round(inp.targetY*k)}}}
 return {tick:f.tick,selfId:c.selfId,target:f.plan&&typeof f.plan.target==='number'?f.plan.target:-1,map:c.map,tees,doing:'',goal:null,route:[],cursor,
  players:(c.players||[]).map((p)=>({id:p.id,name:p.name,clan:p.clan,score:0,ping:0,team:0,skin:p.skin,cc:p.cc,cb:p.cb,cf:p.cf}))};
}
async function openClip(name){
 stopClip();
 let c=null;try{c=await(await fetch('/clips/'+encodeURIComponent(name))).json()}catch{c=null}
 if(!c||!Array.isArray(c.frames)||!c.frames.length)return;
 clip=c;clipName=name;clipFrames=c.frames.map((f)=>clipFrame(c,f));clipAt=0;
 if(!view2){view2=createView($('#cv2'),{css:(n)=>css.getPropertyValue(n).trim(),onInfo:()=>{},t});view2.loadData(dataFound)}

 if(map&&c.map===mapName)view2.setLiveMap(map);
 else{const k=new Uint8Array(c.width*c.height);for(let i=0;i<k.length;i++)k[i]=tileKind(c.tiles[i]);view2.setLiveMap({name:c.map,width:c.width,height:c.height,k})}
 view2.loadScene(c.map);
 $('#cseek').max=String(clipFrames.length-1);$('#cseek').value='0';
 $('#cempty').hidden=true;$('#cdl').href='/clips/'+encodeURIComponent(name);$('#cdl').setAttribute('download',name);
 clipMarks();showClip();pullClips();
}
function clipMarks(){
 const box=$('#cmarks');box.innerHTML='';if(!clip)return;
 const n=clip.frames.length;let was=false;
 clip.frames.forEach((f,i)=>{
  const me=f.tees.find((x)=>x.id===clip.selfId);const fz=!!(me&&me.frozen&&me.alive);
  if(fz&&!was){const m=document.createElement('i');m.style.left=(i/Math.max(1,n-1)*100)+'%';m.title=t('сам замёрз');box.appendChild(m)}
  was=fz;
 });
}
function showClip(){
 if(!clipFrames.length||!view2)return;
 const f=clipFrames[clipAt];f._at=performance.now();view2.pushFrame(f);
 $('#cseek').value=String(clipAt);
 const t0=clipFrames[0].tick,tn=clipFrames[clipFrames.length-1].tick;
 $('#ctime').textContent=t('{a} из {b} с',{a:((f.tick-t0)/50).toFixed(1),b:((tn-t0)/50).toFixed(1)});
 const p=clip.frames[clipAt].plan;
 $('#cinfo').textContent=t('тик {tick} · кадр {i} из {n}',{tick:f.tick,i:clipAt+1,n:clipFrames.length})+
  (p?' · '+t('план: свой фриз {self}, фриз соперника {enemy}, вариантов {n}',{self:planTicks(p.selfOut),enemy:planTicks(p.enemyOut),n:p.candidates??'—'}):'');
}

function planTicks(v){return typeof v==='number'&&v>=0?String(v):'—'}
function stopClip(){clipPlaying=false;clearInterval(clipTimer);if($('#cplay'))$('#cplay').innerHTML='&#9654;'}
function playClip(){
 if(!clipFrames.length)return;
 if(clipAt>=clipFrames.length-1)clipAt=0;
 clipPlaying=true;$('#cplay').innerHTML='&#10074;&#10074;';
 clearInterval(clipTimer);

 clipTimer=setInterval(()=>{if(clipAt>=clipFrames.length-1){stopClip();return}clipAt++;showClip()},40/Number($('#cspeed').value));
}
const clipsShown=()=>!document.querySelector('[data-pane=clips]').hidden;
$('#cplay').addEventListener('click',()=>clipPlaying?stopClip():playClip());
$('#cprev').addEventListener('click',()=>{stopClip();clipAt=Math.max(0,clipAt-1);showClip()});
$('#cnext').addEventListener('click',()=>{stopClip();clipAt=Math.min(clipFrames.length-1,clipAt+1);showClip()});
$('#cspeed').addEventListener('change',()=>{if(clipPlaying)playClip()});
$('#cseek').addEventListener('input',()=>{clipAt=Number($('#cseek').value);showClip()});
document.addEventListener('keydown',(e)=>{
 if(!clipsShown()||!clipFrames.length)return;
 const a=document.activeElement;if(a&&(a.tagName==='INPUT'&&a.type!=='range'||a.tagName==='SELECT'))return;
 if(e.key===' '){e.preventDefault();clipPlaying?stopClip():playClip()}
 else if(e.key==='ArrowLeft'){e.preventDefault();stopClip();clipAt=Math.max(0,clipAt-1);showClip()}
 else if(e.key==='ArrowRight'){e.preventDefault();stopClip();clipAt=Math.min(clipFrames.length-1,clipAt+1);showClip()}
});

let cfgInfo=null,infoKey='';
function renderInfo(){
 const c=cfgInfo;if(!c)return;
 const st=lastStatus||{};
 const html=[
  cell(t('Сервер'),esc(st.server||'—')),cell(t('Состояние'),st.phase==='online'?t('в игре'):st.phase==='connecting'?t('подключается'):esc(st.offlineReason||(st.phase==='offline'?t('не в сети'):st.phase)||'—')),
  cell(t('Имя'),esc(st.name||'—')),cell(t('Карта'),esc(c.map||'—')),
  cell(t('Мозг'),esc(BRAINS[st.brain]||st.brain||'—')),cell(t('Режим'),st.acting?esc(MODES[st.mode]||st.mode||'—'):t('стоит')),
  cell(t('Версия'),esc((lastVersion||'').slice(0,7)||'—')),cell(t('Ловушек'),t('{n} тайлов',{n:c.traps||0})),
  cell(t('Память'),c.memory?t('{n} заморозок',{n:c.memory.events}):t('выключена'))
 ].join('');
 if(html!==infoKey){infoKey=html;$('#info').innerHTML=html}
}
async function pullConfig(){
 try{cfgInfo=await(await fetch('/api/config')).json();renderInfo()}catch{}
}
async function pullLaunch(){
 try{const l=await(await fetch('/api/launch')).json();
  igState.launch=l;
  for(const k of ['server','name','clan','skin','ddnetData','dummyName'])if($('#s_'+k))$('#s_'+k).value=l[k]||'';
  if($('#s_dummy'))$('#s_dummy').checked=l.dummy==='on';
  if($('#s_ddnetData')&&!l.ddnetData)$('#s_ddnetData').placeholder=l.ddnetDataFound?t('найдено: {dir}',{dir:l.ddnetDataFound}):t('не нашёл: впиши путь к папке data');
  if($('#s_skinDownload'))$('#s_skinDownload').checked=l.skinDownload!=='off';
  if($('#s_gfx'))$('#s_gfx').textContent=(l.ddnetDataNote?tr(l.ddnetDataNote)+(l.ddnetDataFound?t('; нашёл сам: {dir}',{dir:l.ddnetDataFound}):'')+'. ':'')+(l.ddnetGraphics?t('графика DDNet найдена'):t('графики DDNet нет, рисую своей'));
  loadAssets(l);
 }catch{}
}

pullLaunch();
async function saveLaunch(){
 const body={};for(const k of ['server','name','clan','skin','ddnetData','dummyName'])if($('#s_'+k))body[k]=$('#s_'+k).value.trim();
 if($('#s_dummy'))body.dummy=$('#s_dummy').checked?'on':'off';
 if($('#s_skinDownload'))body.skinDownload=$('#s_skinDownload').checked?'on':'off';
 try{const r=await(await fetch('/api/launch',{method:'POST',body:JSON.stringify(body)})).json();
  const said=r.reply?tr(r.reply):t('сохранено');
  $('#s_note').textContent=said;if($('#s_gfx'))$('#s_gfx').textContent=said;}catch{$('#s_note').textContent=t('не сохранилось')}
 pullLaunch();
}
$('#s_save').addEventListener('click',saveLaunch);
if($('#s_save2'))$('#s_save2').addEventListener('click',saveLaunch);

const KNOB_HELP={
 steps:t('На сколько шагов вперёд бот считает ход'),
 planStep:t('Длина одного шага плана в тиках (50 тиков = 1 с)'),
 population:t('Сколько вариантов хода пробует за раунд'),
 iterations:t('Сколько раундов уточнения за ход'),
 budgetMs:t('Сколько миллисекунд можно думать над одним ходом (0 здесь: 18 мс)'),
 selfHazardCost:t('Как сильно боится стоять у фриза'),
 enemyHazardWeight:t('Как сильно хочет загнать цель к фризу'),
 hammerRangePx:t('Бьёт молотком, только если цель ближе (px)'),
 shield:t('Проверяет, что ход не заведёт во фриз'),
 noThaw:t('Не выбивает замороженного врага, если тот от этого уйдёт'),
 targetHold:t('Насколько держится за одну цель'),
 launchExposure:t('Как боится, что его подкинут во фриз'),
 jumplessHazardCost:t('Как боится остаться у фриза без прыжка'),
 frozenTargetSteps:t('На сколько шагов считает, пока цель заморожена (0: как обычно)'),
 frozenThrow:t('Готовые броски замороженного во фриз (0: выкл)'),
 commitDecisions:t('Раз во сколько решений пересчитывать ход (1: каждый раз)'),
 seek:t('Идти туда, где игра, когда рядом никого'),
 wastedHammer:t('Штраф за удар молотком мимо'),
 wastedHook:t('Штраф за верёвку мимо'),
 memoryTrust:t('Насколько верить памяти карты о безопасных местах'),
 standoffPx:t('На каком расстоянии держаться от цели (px)')
};
async function pullKnobs(){
 try{const list=await(await fetch('/api/knobs')).json();
  $('#knobs').innerHTML='<tr><th>'+t('настройка')+'</th><th>'+t('сейчас')+'</th><th>'+t('по умолчанию')+'</th><th>'+t('что это')+'</th></tr>'+

   [...list].sort((a,b)=>(KNOB_HELP[b.key]?1:0)-(KNOB_HELP[a.key]?1:0)).map((k)=>'<tr class="'+(k.changed?'changed':'')+'"><td>'+esc(k.key)+'</td><td><input data-knob="'+esc(k.key)+'" value="'+esc(String(k.value))+'"></td><td class="num" style="color:var(--faint)">'+esc(String(k.def))+'</td><td class="help">'+esc(KNOB_HELP[k.key]||'')+'</td></tr>').join('');
  for(const inp of document.querySelectorAll('[data-knob]')){
   inp.addEventListener('change',async()=>{
    const key=inp.dataset.knob;const v=inp.value.trim();
    try{await fetch('/api/knobs',{method:'POST',body:JSON.stringify({key,value:v===''?undefined:v})});}catch{}
    pullKnobs();
   });
  }
 }catch{}
}
$('#tsound').addEventListener('click',()=>{muted=!muted;$('#tsound').className='ghost'+(muted?'':' on');if(!muted){audio();playSound(SND.CHAT_CLIENT,null)}});
muted=true;
$('#log').addEventListener('scroll',()=>{const e=$('#log');stick=e.scrollTop+e.clientHeight>=e.scrollHeight-24});
function cell(k,v,cls){return '<div'+(cls?' class="'+cls+'"':'')+'><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'}
const BRAINS={planner:t('планировщик'),net:t('сеть'),scripted:t('скриптовый')};
const MODES={fight:t('драться'),passive:t('не лезть'),hold:t('стоять'),goto:t('идёт')};
const WEAPONS=[t('молот'),t('пистолет'),t('дробовик'),t('гранатомёт'),t('лазер'),t('ниндзя')];
function weaponName(w){if(w==='hammer')return WEAPONS[0];const m=/^weapon(\d+)$/.exec(w||'');return m&&WEAPONS[Number(m[1])]?WEAPONS[Number(m[1])]:(w||'—')}
function esc(s){return String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

let pcHidden=false,pcKey='';
function showPcWarn(pc){
 const box=$('#pcwarn');if(!box)return;
 const files=pc&&Array.isArray(pc.fakeFiles)?pc.fakeFiles:[],ran=!!pc&&pc.ranHere===true,bad=ran||files.length>0;
 box.hidden=!bad||pcHidden;
 if(!bad)return;
 const key=JSON.stringify([ran,files]);if(key===pcKey)return;pcKey=key;
 $('#pcwtitle').textContent=ran?t('Внимание: на этом ПК запускался стилер'):t('Внимание: эта копия бота поддельная');
 $('#pcwtext').textContent=ran?t('Найдена папка %LOCALAPPDATA%\\DDNetServices. Её создаёт стилер из поддельных копий этого бота, которые раздают в Telegram. Он крадёт пароли, сессии и делает скриншоты экрана. Отключи интернет. С телефона или другого ПК смени пароли (почта, Discord, Steam, Telegram, браузер) и выйди из всех сессий. Сделай полную проверку в Защитнике Windows, а надёжнее переустанови Windows. Когда всё сделано, удали папку %LOCALAPPDATA%\\DDNetServices, и это предупреждение пропадёт.'):'';
 $('#pcwtext').hidden=!ran;
 $('#pcwfiles').textContent=files.length?t('В папке бота есть файлы, которых нет в оригинале: {files}. Удали эту копию, проверь ПК Защитником Windows и скачай бота заново.',{files:files.map((f)=>f.replace(/\//g,'\\')).join(', ')}):'';
 $('#pcwfiles').hidden=files.length===0;
}
if($('#pcwhide'))$('#pcwhide').addEventListener('click',()=>{pcHidden=true;$('#pcwarn').hidden=true});
async function tick(){
 let d;try{d=await(await fetch('/api')).json()}catch{return}
 if(!d||!d.status)return;

 if(d.boot&&d.boot!==boot){if(boot!==''){seenAt.clear();voteSeen=0;chatSeen=-1;logKey='';soundSeq=-1}boot=d.boot}
 const s=d.status,on=s.phase==='online';lastStatus=s;lastVersion=d.version||'';
 showPcWarn(s.pcCheck);
 $('#dot').className='dot '+(on?'on':s.phase==='connecting'?'':'off');
 $('#head').textContent=s.name+' · '+(on?s.server:(s.offlineReason||s.phase));
 $('.tabs .who').title=$('#head').textContent;
 const ver=d.version?t('версия {v}',{v:d.version.slice(0,7)}):t('версия неизвестна');
 $('#ver').textContent=ver;
 if($('#footver'))$('#footver').textContent=ver+' · '+(s.server||'');
 const st=d.stats||'',raw=(k)=>{const m=st.match(new RegExp(k+'=(\\S+)'));return m?m[1]:''},get=(k)=>esc(raw(k)||'—');

 const fz=$('#stfz');
 fz.textContent=!on?t('не в игре'):s.frozen?t('во фризе'):s.acting?t('свободен'):t('стоит');
 fz.className='chip '+(!on?'off':s.frozen?'frozen':'free');
 const sf=$('#sstfz');if(sf){sf.textContent=fz.textContent;sf.className=fz.className}

 const pth=s.paths;
 for(const pid of ['#stpaths','#sstpaths']){
  const pe=$(pid);if(!pe)continue;
  pe.hidden=!pth;
  if(!pth)continue;
  pe.textContent=pth.state==='building'?t('строю маршруты: {n}%',{n:pth.percent}):pth.state==='checking'?t('проверяю маршруты: {n}%',{n:pth.percent}):pth.state==='failed'?t('маршруты не построены'):t('маршруты готовы: {n} из {m}',{n:pth.walker,m:pth.walks});
  pe.className='chip '+(pth.state==='failed'?'slow':pth.state==='done'?'free':'frozen');
  pe.title=pth.state==='failed'?t('Библиотеку путей для этой карты построить не вышло, бот ходит как раньше (подробности в журнале)'):pth.state==='done'?t('Пути для этой карты построены и проверены: столько проходов из проверенных бот идёт своим поиском пути; остальные он идёт как раньше, потому что в проверке поиск не лучше'):t('Бот строит библиотеку путей для этой карты у себя в фоне и пока ходит как раньше');
 }

 const lg=s.lag,cpu=$('#stcpu');
 if(cpu){const slow=on&&!!lg&&lg.hint===true;cpu.hidden=!slow;if(slow)cpu.title=s.strong
  ?t('Бот не успевает за сервером в сильном режиме: снимок обрабатывается {ms} мс из 40, пропущено {n} в секунду. Выключи «Сильный режим» (галочка в панели выше или !strong off).',{ms:Math.round(lg.workMs),n:lg.skipped})
  :s.lowCpu
  ?t('Бот не успевает за сервером даже в режиме для слабого ПК: снимок обрабатывается {ms} мс из 40, пропущено {n} в секунду. Помогает питание от сети, режим высокой производительности, закрыть лишние программы, сервер с меньшим числом игроков.',{ms:Math.round(lg.workMs),n:lg.skipped})
  :t('Бот не успевает за сервером: снимок обрабатывается {ms} мс из 40, пропущено {n} в секунду. Включи «Режим для слабого ПК» (галочка в панели выше или !low on): бот станет считать короче и успевать. Помогает и питание от сети, режим высокой производительности, закрыть лишние программы.',{ms:Math.round(lg.workMs),n:lg.skipped})}
 const scpu=$('#sstcpu');if(scpu&&cpu){scpu.hidden=cpu.hidden;if(scpu.hidden===false)scpu.title=s.strong?t('Бот не успевает за сервером в сильном режиме. Набери !strong off внизу или выключи галочку в полном виде.'):s.lowCpu?t('Бот не успевает за сервером даже в режиме для слабого ПК. Помогает питание от сети, режим высокой производительности, закрыть лишние программы, сервер с меньшим числом игроков.'):t('Бот не успевает за сервером. Набери !low on внизу или включи «Режим для слабого ПК» в полном виде.')}

 const ds=s.panel&&s.panel.duelScore;
 const tgtText=ds?t('дуэль с {name} · заморозил {ours} : {theirs}',{name:ds.name,ours:ds.ours,theirs:ds.theirs}):s.targetName?t('цель: {name} · {n} тайлов',{name:s.targetName,n:s.targetDist!=null?Math.round(s.targetDist/32):'?'}):t('цели нет');
 $('#sttgt').textContent=tgtText;

 const walkingNow=s.mode==='goto';
 const sg=$('#sstgt');if(sg)sg.textContent=walkingNow?doingText||t('идёт по !goto'):tgtText;
 const sp=$('#sstop');if(sp)sp.hidden=!walkingNow;
 const tryName=raw('try');
 $('#grid').innerHTML=[
  cell(t('Мозг'),esc(BRAINS[raw('brain')]||raw('brain')||'—')),cell(t('Оружие'),esc(weaponName(raw('weapon')))),
  cell(t('Убил'),get('kills')),cell(t('Умер'),get('deaths')),cell(t('Сам /kill'),get('selfKills')),
  cell(t('Заморозил'),get('blocks'),'dup'),cell(t('Заморозили'),get('blockedBy'),'dup'),
  cell(t('Хуков'),get('hooksFired')),cell(t('Хаммеров'),get('hammerFires')),cell(t('Клипов'),get('clips'))
 ].join('')+(tryName&&tryName!=='off'?cell(t('Проба'),esc(tryName)):'');
 renderPanel(s);
 if(!document.querySelector('[data-pane=cfg]').hidden)renderInfo();
 igState.stats=d.stats||'';igRender();
 lines=d.lines||[];chatSounds(s.name);renderLog(false);renderChat();watchVotes();
}

let chatSoundSeq=-1;
function chatSounds(me){
 const chat=lines.filter((l)=>l.kind==='chat'||l.kind==='whisper');
 const top=chat.reduce((m,l)=>Math.max(m,l.seq||0),-1);
 if(chatSoundSeq>=0&&top<chatSoundSeq)chatSoundSeq=-1;
 if(chatSoundSeq>=0){
  const name=String(me||'').toLowerCase();
  for(const l of chat){
   if(!(l.seq>chatSoundSeq))continue;
   if(isSys(l))playSound(SND.CHAT_SERVER,null);
   else if(name&&l.from!==me&&String(l.text).toLowerCase().includes(name))playSound(SND.CHAT_HIGHLIGHT,null);
   else playSound(SND.CHAT_CLIENT,null);
  }
 }
 chatSoundSeq=top;
}

const isSys=(l)=>l.sys===true||l.from==='сервер';
const fromOf=(l)=>isSys(l)?t('сервер'):l.from;

function renderLog(force){
 const cls={chat:'chat',event:'evt',whisper:'wsp',log:''};
 const keep=(l)=>{
  if(logFilter==='chat'&&l.kind!=='chat')return false;
  if(logFilter==='evt'&&l.kind!=='event')return false;
  if(logFilter==='wsp'&&l.kind!=='whisper')return false;
  if(logFind&&!((l.from||'')+' '+l.text).toLowerCase().includes(logFind))return false;
  return true;
 };
 const key=boot+'|'+(lines.length?lines[0].seq+'-'+lines[lines.length-1].seq:'')+'|'+logFilter+'|'+logFind;
 if(!force&&key===logKey)return;
 logKey=key;
 const rows=lines.filter(keep);
 const tx=(l)=>l.kind==='chat'||l.kind==='whisper'?l.text:tr(l.text);
 $('#log').innerHTML=rows.length?rows.map((l)=>'<div class="'+(isSys(l)?'sys':(cls[l.kind]||''))+'">'+(l.from?(isSys(l)?esc(fromOf(l)):'<span class="nick" data-nick="'+esc(l.from)+'">'+esc(l.from)+'</span>')+': ':'')+esc(tx(l))+'</div>').join('')
  :'<div style="color:var(--faint)">'+t('под фильтр ничего не попало')+'</div>';
 if(stick)$('#log').scrollTop=$('#log').scrollHeight;
}

let cmdNames=[];fetch('/api/commands').then((r)=>r.json()).then((v)=>{cmdNames=v||[]}).catch(()=>{});

function completer(field,tipEl){
 let st={list:null,i:-1,head:''};
 field.addEventListener('input',()=>{st={list:null,i:-1,head:''};tipEl.textContent=''});
 return (e)=>{
  if(e.key!=='Tab')return false;

  e.preventDefault();
  const v=field.value;
  if(st.list===null){
   const m=v.match(/(\S*)$/);const word=m?m[1]:'';
   const isCmd=word.startsWith('!');
   if(!isCmd&&word.length===0){tipEl.textContent=t('наберите начало ника');return true}
   const fr=view?view.latest():null;
   const pool=isCmd?cmdNames.map((c)=>'!'+c)
    :(fr?((fr.players&&fr.players.length?fr.players:fr.tees).map((p)=>p.name).filter(Boolean)):[]);
   const low=word.toLowerCase();
   let hits=pool.filter((c)=>c.toLowerCase().startsWith(low));
   if(!hits.length&&!isCmd&&word.length>=2)hits=pool.filter((c)=>c.toLowerCase().includes(low));
   if(!hits.length){tipEl.textContent=isCmd?t('нет такой команды'):t('никого с таким ником');return true}
   st={list:hits,i:-1,head:v.slice(0,v.length-word.length)};
  }
  st.i=(st.i+(e.shiftKey?-1:1)+st.list.length)%st.list.length;
  field.value=st.head+st.list[st.i]+(st.list.length===1?' ':'');
  tipEl.textContent=st.list.length>1?t('{i} из {n} · Tab дальше',{i:st.i+1,n:st.list.length}):'';
  if(st.list.length===1)st={list:null,i:-1,head:''};
  return true;
 };
}

function insertNick(name){
 const f=chatOpen?chatField:$('#i');
 const v=f.value,at=typeof f.selectionStart==='number'&&document.activeElement===f?f.selectionStart:v.length;
 const before=v.slice(0,at),after=v.slice(at);
 const pad=before===''||/\s$/.test(before)?'':' ';
 f.value=before+pad+name+' '+after;
 f.focus();const pos=(before+pad+name+' ').length;try{f.setSelectionRange(pos,pos)}catch{}
 f.dispatchEvent(new Event('input'));
}
const chatField=$('#chatfield');
const promptFor=(v)=>v.startsWith('!')?t('Команда:'):t('Все:');
function openChat(pref){
 chatOpen=true;$('#chatin').hidden=false;$('#chatov').classList.add('open');
 if(pref!==undefined)chatField.value=pref;
 $('#chatprompt').textContent=promptFor(chatField.value);
 chatField.focus();renderChat(true);
}
function closeChat(){chatOpen=false;chatScroll=0;$('#chatin').hidden=true;$('#chatov').classList.remove('open');chatField.value='';$('#chattip').textContent='';chatField.blur();renderChat(true)}
document.addEventListener('keydown',(e)=>{

 if(STREAM)return;
 const onField=document.activeElement&&document.activeElement.tagName==='INPUT'&&document.activeElement!==chatField;
 if(onField)return;
 if(!chatOpen&&(e.key==='F3'||e.key==='F4')){e.preventDefault();botCmd(e.key==='F3'?'!yes':'!no');return}

 const game=!document.querySelector('[data-pane=game]').hidden;

 const onBtn=!!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.igra,.viewbar,.bottombar'));
 if(game&&!chatOpen&&!onBtn&&(e.key==='Enter'||e.key==='t')){e.preventDefault();openChat('')}
 else if(game&&!chatOpen&&e.key==='/'){e.preventDefault();openChat('!')}
 else if(chatOpen&&e.key==='Escape'){e.preventDefault();closeChat()}
});
chatField.addEventListener('input',()=>{
 $('#chatprompt').textContent=promptFor(chatField.value);
});
const chatTab=completer(chatField,$('#chattip'));
chatField.addEventListener('keydown',async(e)=>{
 if(chatTab(e))return;

 if(e.key==='PageUp'||e.key==='PageDown'){e.preventDefault();scrollChat(e.key==='PageUp'?5:-5);return}
 if(e.key==='ArrowUp'||e.key==='ArrowDown'){
  if(!hist.length)return;e.preventDefault();
  if(e.key==='ArrowUp')hix=hix<0?hist.length-1:Math.max(0,hix-1);
  else{hix=hix+1;if(hix>=hist.length){hix=-1;chatField.value='';return}}
  chatField.value=hist[hix];return;
 }
 if(e.key!=='Enter')return;
 e.preventDefault();
 const v=chatField.value.trim();
 if(v===''){closeChat();return}
 if(hist[hist.length-1]!==v)hist.push(v);hix=-1;
 chatField.value='';$('#chattip').textContent='';lastCmdAt=Date.now();
 try{await fetch('/cmd',{method:'POST',body:JSON.stringify({line:v})});}catch{}
 await tick();
});

let chatDrawnSeq=-1,chatDrawnOpen=false,lastCmdAt=0,chatIconsMissing=false,chatScroll=0,chatDrawnScroll=0;

function scrollChat(by){if(!chatOpen)return;chatScroll=Math.max(0,chatScroll+by);renderChat(true)}

function looksByName(name){
 const fr=view?view.latest():null;if(!fr||!name)return null;
 return (fr.players||[]).find((p)=>p.name===name)||fr.tees.find((p)=>p.name===name)||null;
}
function renderChat(force){
 const now=Date.now();
 for(const l of lines)if(l.seq!==undefined&&!seenAt.has(l.seq))seenAt.set(l.seq,chatSeen<0?now-8000:now);
 if(lines.length)chatSeen=lines[lines.length-1].seq;
 if(seenAt.size>400){const keep=new Set(lines.map((l)=>l.seq));for(const k of seenAt.keys())if(!keep.has(k))seenAt.delete(k)}
 const last=lines.length?lines[lines.length-1].seq:-1;

 const shown=STREAM?lines.filter((l)=>l.kind==='chat'&&isSys(l)):lines.filter((l)=>l.kind==='chat'||l.kind==='whisper'||(l.kind==='log'&&Date.now()-lastCmdAt<10000&&(seenAt.get(l.seq)||0)>=lastCmdAt-500));
 const N=chatOpen?14:9;
 if(chatScroll>Math.max(0,shown.length-N))chatScroll=Math.max(0,shown.length-N);
 const end=shown.length-(chatOpen?chatScroll:0);
 const rows=shown.slice(Math.max(0,end-N),end);
 const anyFading=rows.some((l)=>{const a=now-(seenAt.get(l.seq)||0);return a>15000&&a<18000});
 if(!force&&!nicksChanged&&last===chatDrawnSeq&&chatOpen===chatDrawnOpen&&chatScroll===chatDrawnScroll&&!anyFading&&!chatIconsMissing)return;
 nicksChanged=false;
 chatDrawnSeq=last;chatDrawnOpen=chatOpen;chatDrawnScroll=chatScroll;chatIconsMissing=false;
 const box=$('#chatlines');
 box.innerHTML=rows.map((l)=>{
  const age=now-(seenAt.get(l.seq)||now);
  const op=chatOpen?1:age<16000?1:age<17000?1-(age-16000)/1000:0;
  if(op<=0)return '';
  let cls=l.kind==='whisper'?'wsp':l.kind==='log'?'me':'';
  let text=l.kind==='log'?tr(l.text||''):(l.text||'');
  if(isSys(l))return '<div class="sys" style="opacity:'+op.toFixed(2)+'">*** '+esc(hideNicksIn(text))+'</div>';
  if(l.kind==='chat'&&text.startsWith('(team) ')){cls='team';text=text.slice(7)}
  if(l.kind==='chat'&&text.startsWith('*')){cls='hl';text=text.slice(1)}
  let icon='';
  const who=l.from?looksByName(l.from):null;
  if(who&&view&&view.teeIcon){icon=view.teeIcon(who,32);if(icon===null)chatIconsMissing=true}
  return '<div class="'+cls+'" style="opacity:'+op.toFixed(2)+'">'+(icon?'<img class="tee" alt="" src="'+icon+'">':'')+(l.from?'<b>'+esc(l.from)+'</b>: ':'')+esc(text)+'</div>';
 }).join('');
 if(chatOpen&&chatScroll>0)box.insertAdjacentHTML('beforeend','<div class="more">'+esc(t('↓ ещё {n} ниже · PageDown',{n:chatScroll}))+'</div>');

 try{const top=box.getBoundingClientRect().top;while(box.firstElementChild&&box.firstElementChild.getBoundingClientRect().top<top-0.5)box.removeChild(box.firstElementChild)}catch{}
}

const iTab=completer($('#i'),$('#itip'));
$('#i').addEventListener('keydown',(e)=>{
 if(iTab(e))return;
 if(e.key==='ArrowUp'){if(!hist.length)return;e.preventDefault();hix=hix<0?hist.length-1:Math.max(0,hix-1);$('#i').value=hist[hix];}
 else if(e.key==='ArrowDown'){if(hix<0)return;e.preventDefault();hix=hix+1;if(hix>=hist.length){hix=-1;$('#i').value='';}else $('#i').value=hist[hix];}
});
$('#f').addEventListener('submit',async(e)=>{e.preventDefault();const v=$('#i').value.trim();if(!v)return;
 if(hist[hist.length-1]!==v)hist.push(v);hix=-1;$('#i').value='';
 await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:v})});tick()});
tick();setInterval(tick,1000);setInterval(()=>renderChat(false),250);

const cv=$('#cv');
const css=getComputedStyle(document.documentElement);
view=createView(cv,{css:(n)=>css.getPropertyValue(n).trim(),onInfo:(i)=>info(i),t});
const zoomToSlider=(z)=>Math.round(100/z);
$('#zoom').addEventListener('input',()=>{closeCtx();view.setZoom(100/Number($('#zoom').value))});
function setFollow(on){view.follow(on);$('#follow').className='ghost'+(on?' on':'')}
$('#follow').addEventListener('click',()=>{view.spectate(-1);$('#spec').value='-1';setFollow(true)});
$('#spec').addEventListener('change',()=>{
 const v=$('#spec').value;
 if(v==='map'){$('#whole').click();return}
 if(v==='free'){setFollow(false);return}
 view.spectate(Number(v));setFollow(true);
});
$('#whole').addEventListener('click',()=>{if(!view.fit())return;setFollow(false);$('#zoom').value=zoomToSlider(view.zoom());if(embedded)$('#spec').value='map'});
$('#tmode').addEventListener('click',()=>{const next={map:'ent',ent:'both',both:'map'}[view.mode()];view.setMode(next);$('#tmode').textContent=modeNames[next];$('#tmode').className='ghost'+(next!=='map'?' on':'')});
for(const [id,key] of [['#troute','route'],['#ttraps','traps'],['#tnames','names'],['#tcursor','cursor'],['#tboard','board']]){
 $(id).addEventListener('click',()=>{const on=view.toggle(key);$(id).className='ghost'+(on?' on':'')});
}
let drag=null,moved=0;
cv.addEventListener('pointerdown',(e)=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY};moved=0;cv.className='drag';try{cv.setPointerCapture(e.pointerId)}catch{}});
cv.addEventListener('pointermove',(e)=>{if(!drag)return;moved+=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y);

 if(moved>4){view.pan(e.clientX-drag.x,e.clientY-drag.y);$('#follow').className='ghost';if(embedded&&$('#spec').value!=='free')$('#spec').value='free'}drag={x:e.clientX,y:e.clientY}});
cv.addEventListener('pointerup',(e)=>{

 if(drag&&moved<=4){const r=cv.getBoundingClientRect();const id=view.pick(e.clientX-r.left,e.clientY-r.top);
  if(id>=0){const fr=view.latest();const self=fr?fr.selfId:-1;view.spectate(id===self?-1:id);$('#spec').value=String(id===self?-1:id);setFollow(true)}}
 drag=null;cv.className=''});
cv.addEventListener('wheel',(e)=>{e.preventDefault();closeCtx();if(chatOpen){scrollChat(e.deltaY<0?3:-3);return}view.zoomBy(e.deltaY<0?1/1.1:1.1);$('#zoom').value=zoomToSlider(view.zoom())},{passive:false});

document.addEventListener('keydown',(e)=>{
 if(e.key!=='Tab'||chatOpen)return;
 const a=document.activeElement;

 if(document.querySelector('[data-pane=game]').hidden||(a&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))||(a&&a.closest&&a.closest('.igra,.viewbar,.bottombar,.dd-menu,.ig-menu')))return;
 e.preventDefault();if(!boardHeld){boardHeld=true;view.toggle('board',true)}
});
document.addEventListener('keyup',(e)=>{if(e.key==='Tab'&&boardHeld){boardHeld=false;view.toggle('board',$('#tboard').className.includes('on'))}});
let lastInfo=0;
function info(i){
 const now=performance.now();if(now-lastInfo<250)return;lastInfo=now;
 const age=frame?Math.round(now-(frame._at||now)):0;
 const live=frame?t('тик {tick} · ти {n} · {state}',{tick:frame.tick,n:frame.tees.length,state:age>1500?t('нет данных'):t('живое')}):t('нет данных');
 if($('#vinfo2'))$('#vinfo2').textContent=live+' · '+i.fps+' FPS · '+t('масштаб {z}%',{z:Math.round(100/i.zoom)});
 if($('#legend'))$('#legend').style.display=i.own?'':'none';
}
async function pullMap(name,key){
 try{const m=await(await fetch('/api/map')).json();if(!m)return;
  const raw=atob(m.kinds),k=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)k[i]=raw.charCodeAt(i);
  m.k=k;
  if(m.traps){const traps=atob(m.traps),tk=new Uint8Array(traps.length);for(let i=0;i<traps.length;i++)tk[i]=traps.charCodeAt(i);m.t=tk;}
  map=m;mapName=name;mapKey=key||name;view.setLiveMap(m);view.loadScene(name);}catch{}
}

const SND_FILES=(()=>{
 const n=(base,k)=>Array.from({length:k},(_,i)=>base+'-'+String(i+1).padStart(2,'0'));
 return [n('wp_gun_fire',3),n('wp_shotty_fire',3),n('wp_flump_launch',3),n('wp_hammer_swing',3),n('wp_hammer_hit',3),n('wp_ninja_attack',3),n('wp_flump_explo',3),n('wp_ninja_hit',3),n('wp_laser_fire',3),n('wp_laser_bnce',3),n('wp_switch',3),
  n('vo_teefault_pain_short',12),n('vo_teefault_pain_long',2),n('foley_land',4),n('foley_dbljump',3),n('foley_foot_left',4).concat(n('foley_foot_right',4)),n('foley_body_splat',3),n('vo_teefault_spawn',7),n('sfx_skid',4),n('vo_teefault_cry',2),
  n('hook_loop',2),n('hook_attach',3),n('foley_body_impact',3),n('hook_noattach',2),n('sfx_pickup_hrt',2),n('sfx_pickup_arm',4),['sfx_pickup_launcher'],['sfx_pickup_sg'],['sfx_pickup_ninja'],n('sfx_spawn_wpn',3),n('wp_noammo',5),n('sfx_hit_weak',2),
  ['sfx_msg-server'],['sfx_msg-client'],['sfx_msg-highlight'],['sfx_ctf_drop'],['sfx_ctf_rtn'],['sfx_ctf_grab_pl'],['sfx_ctf_grab_en'],['sfx_ctf_cap_pl'],[]];
})();
const SND={AIRJUMP:14,JUMP:15,HOOK_ATTACH_GROUND:21,HOOK_NOATTACH:23,CHAT_SERVER:32,CHAT_CLIENT:33,CHAT_HIGHLIGHT:34};
const SND_RANGE=1500;
const buffers=new Map();
let soundSeq=-1,soundsOk=true;
function audio(){
 try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')void ac.resume()}catch{ac=null}
 return ac;
}
function buffer(name){
 let b=buffers.get(name);
 if(!b){
  b=fetch('/assets/audio/'+name+'.wav').then((r)=>r.ok?r.arrayBuffer():null).then((raw)=>raw&&audio()?new Promise((ok)=>ac.decodeAudioData(raw,ok,()=>ok(null))):null).catch(()=>null);
  buffers.set(name,b);
 }
 return b;
}

function playSound(id,at,gain){
 if(muted||!soundsOk)return;
 const files=SND_FILES[id];if(!files||!files.length)return;

 let vol=soundGain(embedded?igState.vol:100,null,SND_RANGE),pan=0;
 if(at){
  const ear=listener();if(!ear)return;
  const dx=at.x-ear.x,dy=at.y-ear.y,d=Math.hypot(dx,dy);
  vol=soundGain(embedded?igState.vol:100,d,SND_RANGE);
  pan=Math.max(-1,Math.min(1,dx/SND_RANGE));
 }
 if(gain!==undefined)vol=gain;
 if(!(vol>0))return;
 const name=files[Math.floor(Math.random()*files.length)];
 void buffer(name).then((buf)=>{
  if(!buf||!audio()||muted)return;
  try{
   const src=ac.createBufferSource(),g=ac.createGain();src.buffer=buf;g.gain.value=vol*0.8;
   let out=g;
   if(ac.createStereoPanner){const p=ac.createStereoPanner();p.pan.value=pan;g.connect(p);out=p}
   src.connect(g);out.connect(ac.destination);src.start();
  }catch{}
 });
}

function listener(){
 const f=frame;if(!f||!f.tees)return null;
 const id=view&&view.spec&&view.spec()>=0?view.spec():f.selfId;
 const t=f.tees.find((p)=>p.id===id)||f.tees.find((p)=>p.id===f.selfId);
 return t?{x:t.x,y:t.y}:null;
}
const solidAt=(x,y)=>{if(!map||!map.k)return false;const tx=Math.floor(x/32),ty=Math.floor(y/32);if(tx<0||ty<0||tx>=map.width||ty>=map.height)return true;const k=map.k[ty*map.width+tx];return k===1||k===5};
const grounded=(t)=>solidAt(t.x-13,t.y+16)||solidAt(t.x+13,t.y+16);
let dataAsked=false;
function loadAssets(launch){
 if(!launch)return;
 const found=!!launch.ddnetGraphics;
 if(found!==dataFound||!dataAsked){dataAsked=true;dataFound=found;view.loadData(found);if(found&&mapName)view.loadScene(mapName)}

 if(!found&&launch.ddnetFetching)setTimeout(pullLaunch,3000);
}
function sounds(old,next){
 if(!next||!next.tees)return;

 const list=next.sounds||[];
 const top=list.reduce((m,s)=>Math.max(m,s.s),soundSeq);
 if(soundSeq>=0)for(const s of list)if(s.s>soundSeq)playSound(s.id,s);
 soundSeq=top;
 if(!old||!old.tees||old.selfId!==next.selfId)return;
 for(const b of next.tees){
  const a=old.tees.find((p)=>p.id===b.id);if(!a||a.frozen||b.frozen)continue;

  if(typeof a.jl==='number'&&typeof b.jl==='number'&&b.jl<a.jl){
   if(!grounded(a))playSound(SND.AIRJUMP,b);
   else if(b.id===next.selfId&&(b.jumped&1)&&!(a.jumped&1))playSound(SND.JUMP,b);
  }

  if(b.id===next.selfId&&a.hook!==5&&b.hook===5&&b.hooked<0)playSound(SND.HOOK_ATTACH_GROUND,{x:b.hx,y:b.hy});

  if(b.id===next.selfId&&a.hook===4&&b.hook>=1&&b.hook<=3&&map&&map.k){
   const tx=Math.floor(b.hx/32),ty=Math.floor(b.hy/32);
   if(tx>=0&&ty>=0&&tx<map.width&&ty<map.height&&map.k[ty*map.width+tx]===5)playSound(SND.HOOK_NOATTACH,b);
  }
 }
}

const DUP=/^\(\d+\)/;
const dupBare=(s)=>s.replace(DUP,'');
const onList=(list,p)=>{
 const n=String(p.name||'').toLowerCase();if(n==='')return false;
 const partners=relations.partner||[],entries=(relations[list]||[]).map((x)=>String(x).toLowerCase());
 const partnerish=(k)=>partners.includes(dupBare(k));
 if(entries.includes(n)&&!partnerish(n))return true;
 return entries.some((k)=>k!==''&&!partnerish(k)&&dupBare(k)===dupBare(n));
};
async function pullRelations(){try{const r=await(await fetch('/api/relations')).json();if(r&&typeof r==='object')relations=r}catch{}playersKey=''}

const partnerOf=(p)=>({partner:p.id===partnerRowId,partnerNick:(relations.partner||[]).includes(dupBare(String(p.name||'').toLowerCase()))});
const REL=[['friend',t('тима'),t('Свои: бот их не трогает')],['war',t('вар'),t('Бот бьёт их всегда')],['ignore',t('игнор'),t('Бот не трогает их и не отвечает им')]];

function markOf(p,partner){
 const partnerIn=(list)=>(relations[list]||[]).some((x)=>(relations.partner||[]).includes(dupBare(String(x).toLowerCase())));
 const clanIn=(list)=>{const c=String(p.clan||'').trim().toLowerCase();return c!==''&&(relations[list]||[]).some((x)=>{const k=String(x).toLowerCase();return k!==''&&dupBare(k)===dupBare(c)})};
 return partner?(partnerIn('friend')||clanIn('clanFriend')?'friend':partnerIn('ignore')?'ignore':partnerIn('war')||clanIn('clanWar')?'war':''):REL.map(([k])=>k).find((k)=>onList(k,p))||'';
}

let openPlayer=-1;
function renderPlayers(f){
 if(!f)return;
 const list=(f.players&&f.players.length?f.players:f.tees).filter((p)=>p.id!==f.selfId&&p.name);
 const pin=panel&&panel.pinnedTarget?String(panel.pinnedTarget):'';
 if(openPlayer>=0&&!list.some((p)=>p.id===openPlayer))openPlayer=-1;
 const key=list.map((p)=>p.id+':'+p.name+':'+(p.clan||'')).join('|')+'#'+JSON.stringify(relations)+'#'+openPlayer+'#'+pin;
 if(key!==playersKey){
  playersKey=key;playersShown=list;
  if($('#pcount'))$('#pcount').textContent=list.length?'· '+list.length:'';
  $('#plist').innerHTML=list.length?list.map((p,i)=>{

   const {partner,partnerNick}=partnerOf(p);
   const mark=markOf(p,partner);
   const icon=view&&view.teeIcon?view.teeIcon(p,32):null;
   const pinned=pin!==''&&pin===p.name;
   const open=p.id===openPlayer;
   const badge=partner?'<span class="pbadge '+(mark||'war')+'">'+esc(t('второй бот'))+'</span>':mark?'<span class="pbadge '+mark+'">'+esc(REL.find(([k])=>k===mark)[1])+'</span>':'';
   let row='<div class="prow '+mark+(open?' open':'')+(pinned?' pinned':'')+'" data-pid="'+p.id+'">'+
    '<button type="button" class="pname" data-open data-i="'+i+'" title="'+esc(p.name+(p.clan?' ['+p.clan+']':''))+'">'+(icon?'<img alt="" src="'+icon+'">':'')+'<span class="pn">'+esc(p.name)+'</span>'+(p.clan?'<small>'+esc(p.clan)+'</small>':'')+'</button>'+
    badge+'<span class="pmeta" data-meta="'+p.id+'"></span></div>';
   if(open){
    row+='<div class="pacts" data-pid="'+p.id+'">'+
     '<button type="button" class="ghost'+(pinned?' on':'')+'" data-act="target" data-i="'+i+'" title="'+esc(pinned?t('Снова выбирать цель самому'):t('Драться только с ним (!target)'))+'">'+iconSvg('target')+esc(pinned?t('не цель'):t('цель'))+'</button>'+
     '<button type="button" class="ghost" data-act="goto" data-i="'+i+'" title="'+esc(t('Идти к нему и за ним (!goto)'))+'">'+iconSvg('go')+esc(t('к нему'))+'</button>'+
     '<button type="button" class="ghost" data-act="follow" data-i="'+i+'" title="'+esc(t('Следить за ним'))+'">'+iconSvg('eye')+esc(t('смотреть'))+'</button>'+
     '<button type="button" class="ghost" data-act="nick" data-i="'+i+'" title="'+esc(t('Вставить ник в строку ввода'))+'">'+iconSvg('chat')+esc(t('ник в чат'))+'</button>'+
     (partner?'<span class="prel"><small>'+esc(mark==='friend'?t('второй бот: в тиме'):t('второй бот не в тиме: вернуть -- !friend {name} в консоли',{name:partnerRowName||p.name}))+'</small></span></div>':
     partnerNick?'<span class="prel"><small>'+esc(t('ник второго бота, но это не он: списки по нику задели бы второго бота'))+'</small></span></div>':
     '<span class="prel">'+REL.map(([k,label,title])=>'<button type="button" class="ghost'+(onList(k,p)?' on':'')+'" data-rel="'+k+'" data-i="'+i+'" title="'+esc(title)+'">'+esc(label)+'</button>').join('')+'</span></div>');
   }
   return row;
  }).join(''):'<div class="none">'+t('никого, кроме бота')+'</div>';
  if(list.length&&view&&view.teeIcon&&list.some((p)=>view.teeIcon(p,32)===null))playersKey='';
 }

 const me=f.tees.find((x)=>x.id===f.selfId);
 for(const m of document.querySelectorAll('#plist [data-meta]')){
  const id=Number(m.dataset.meta),tee=f.tees.find((x)=>x.id===id);
  const txt=!tee?'':(tee.frozen?t('фриз')+' · ':'')+(me?t('{n} т',{n:Math.round(Math.hypot(tee.x-me.x,tee.y-me.y)/32)}):'');
  if(m.textContent!==txt)m.textContent=txt;
  const row=m.parentElement;row.classList.toggle('target',f.target===id);row.classList.toggle('frozen',!!(tee&&tee.frozen));row.classList.toggle('away',!tee);
 }
}

async function toggleRel(k,p){
 const on=!onList(k,p);
 try{const r=await(await fetch('/api/relation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({list:k,name:p.name,on})})).json();if(r&&r.lists)relations=r.lists}catch{}
 playersKey='';renderPlayers(frame);
}

const pinOf=(who)=>{if(who==='b'){const b=igBotOf('b');return b&&b.panel&&b.panel.pinnedTarget?String(b.panel.pinnedTarget):''}return panel&&panel.pinnedTarget?String(panel.pinnedTarget):''};

async function playerAct(act,p,who){
 const w=who==='b'?'b':'a';

 if(act==='target'){const pinned=pinOf(w)===p.name;await botCmd(botLine(w,pinned?'!target -':'!target '+p.name),true);playersKey='';renderPlayers(frame);return}
 if(act==='goto'){await botCmd(botLine(w,'!goto @'+p.name),true);return}
 if(act==='follow'){view.spectate(p.id);$('#spec').value=String(p.id);setFollow(true)}
 if(act==='nick')insertNick(p.name);
}
$('#plist').addEventListener('click',async(e)=>{
 const b=e.target.closest('button');if(!b)return;
 const p=playersShown[Number(b.dataset.i)];if(!p)return;
 if(b.dataset.open!==undefined){openPlayer=openPlayer===p.id?-1:p.id;playersKey='';renderPlayers(frame);return}
 if(b.dataset.rel){await toggleRel(b.dataset.rel,p);return}
 await playerAct(b.dataset.act,p);
});

const cmenu=$('#cmenu');

const ctxOpen=()=>!!cmenu._rows;
function closeCtx(){if(!ctxOpen())return;cmenu._rows=null;cmenu.hidden=true;cmenu.innerHTML=''}
const liveTee=(id)=>{const f=frame;if(!f)return null;return(f.players&&f.players.length?f.players:f.tees).find((x)=>x.id===id&&x.name)||f.tees.find((x)=>x.id===id&&x.name)||null};
function ctxItems(hit,who){
 const f=frame;if(!f||!hit)return [];
 const w=who==='b'?'b':'a';
 const p=hit.id>=0?liveTee(hit.id):null;
 if(hit.id>=0&&hit.id===f.selfId)return [{ic:'eye',label:t('смотреть'),title:t('Следить за ним'),run:()=>{view.spectate(-1);$('#spec').value='-1';setFollow(true)}}];
 if(p){
  const pin=pinOf(w),pinned=pin!==''&&pin===p.name;

  const act=(a)=>()=>{const q=liveTee(p.id);if(q)void playerAct(a,q,w)};
  const rows=[
   {ic:'target',label:pinned?t('не цель'):t('цель'),on:pinned,title:pinned?t('Снова выбирать цель самому'):t('Драться только с ним (!target)'),run:act('target')},
   {ic:'go',label:t('к нему'),title:t('Идти к нему и за ним (!goto)'),run:act('goto')},
   {ic:'eye',label:t('смотреть'),title:t('Следить за ним'),run:act('follow')},
   {ic:'chat',label:t('ник в чат'),title:t('Вставить ник в строку ввода'),run:act('nick')}];
  const {partner,partnerNick}=partnerOf(p);
  if(partner||partnerNick){
   const friend=markOf(p,partner)==='friend';
   rows.push({note:partner?(friend?t('второй бот: в тиме'):t('второй бот не в тиме: вернуть -- !friend {name} в консоли',{name:partnerRowName||p.name})):t('ник второго бота, но это не он: списки по нику задели бы второго бота')});
  }else for(const [k,label,title] of REL)rows.push({label,title,on:onList(k,p),rel:k,run:()=>{const q=liveTee(p.id);if(q)void toggleRel(k,q)}});
  rows.head=p.name+(p.clan?' ['+p.clan+']':'');
  return rows;
 }
 const tx=Math.floor(hit.x/32),ty=Math.floor(hit.y/32);
 const rows=[{ic:'go',label:t('Идти сюда ({x}, {y})',{x:tx,y:ty}),title:t('Идти в эту клетку (!goto)'),run:()=>void botCmd(botLine(w,'!goto '+tx+' '+ty),true)}];
 const walking=w==='b'?(igBotOf('b')||{}).mode==='goto':!!(lastStatus&&lastStatus.mode==='goto');
 if(walking)rows.push({ic:'stop',label:t('Остановить ходьбу'),title:t('Отменить поход (!stop)'),run:()=>void botCmd(botLine(w,'!stop'),true)});
 return rows;
}
function openCtx(x,y,hit,who){
 const rows=ctxItems(hit,who);
 if(!rows.length){closeCtx();return false}
 cmenu.innerHTML=(rows.head?'<div class="cm-head">'+esc(rows.head)+'</div>':'')+rows.map((r,i)=>r.note?'<div class="cm-note">'+esc(r.note)+'</div>':
  '<button type="button" role="menuitem" class="cm-item'+(r.on?' on':'')+'"'+(r.rel?' data-rel="'+r.rel+'"':'')+' data-i="'+i+'" title="'+esc(r.title||'')+'">'+(r.ic?iconSvg(r.ic):'')+'<span>'+esc(r.label)+'</span>'+(r.rel&&r.on?'<i class="cm-on">✓</i>':'')+'</button>').join('');
 cmenu.hidden=false;

 const w=cmenu.offsetWidth,h=cmenu.offsetHeight;
 cmenu.style.left=Math.max(4,Math.min(x,innerWidth-w-4))+'px';cmenu.style.top=Math.max(4,Math.min(y,innerHeight-h-4))+'px';
 cmenu._rows=rows;
 const first=cmenu.querySelector('button');if(first)first.focus({preventScroll:true});
 return true;
}
cmenu.addEventListener('click',(e)=>{const b=e.target.closest('button.cm-item');if(!b)return;const r=cmenu._rows[Number(b.dataset.i)];closeCtx();if(r&&r.run)r.run()});
cv.addEventListener('contextmenu',(e)=>{
 if(STREAM)return;
 e.preventDefault();
 const r=cv.getBoundingClientRect();

 openCtx(e.clientX,e.clientY,view.at(e.clientX-r.left,e.clientY-r.top),IGRA?igState.sel:'a');
});

document.addEventListener('pointerdown',(e)=>{if(ctxOpen()&&!cmenu.contains(e.target))closeCtx()},true);
addEventListener('resize',closeCtx);addEventListener('blur',closeCtx);
addEventListener('scroll',(e)=>{if(e.target===document)closeCtx()},true);
document.addEventListener('keydown',(e)=>{
 if(!ctxOpen())return;
 const items=[...cmenu.querySelectorAll('button')],i=items.indexOf(document.activeElement);
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCtx();return}
 const to=e.key==='ArrowDown'?(i+1)%items.length:e.key==='ArrowUp'?(i<=0?items.length-1:i-1):e.key==='Home'?0:e.key==='End'?items.length-1:-1;
 if(to>=0){e.preventDefault();e.stopPropagation();if(items[to])items[to].focus();return}
 if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(items[i])items[i].click();else closeCtx();return}
 if(e.key==='Tab'){e.preventDefault();closeCtx()}
},true);

function setPause(on){
 if(on===view.paused())return;
 closeCtx();view.setPaused(on);
 $('#tpause').className='ghost'+(on?' on':'');$('#pausebadge').hidden=!on;
}
$('#tpause').addEventListener('click',()=>setPause(!view.paused()));
let spaceDown=false;
document.addEventListener('keydown',(e)=>{
 if(STREAM||e.key!==' '||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||chatOpen||ctxOpen())return;
 const a=document.activeElement;
 if(a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.isContentEditable||(a.closest&&a.closest('.dd,.igra,.viewbar,.bottombar,.ig-menu'))))return;
 if(document.querySelector('[data-pane=game]').hidden)return;

 e.preventDefault();spaceDown=true;
 if(!e.repeat)setPause(!view.paused());
});
document.addEventListener('keyup',(e)=>{if(e.key===' '&&spaceDown){spaceDown=false;e.preventDefault()}});
pullRelations();setInterval(pullRelations,5000);

let specKey='';
function fillSpec(f){
 const list=(f.players&&f.players.length?f.players:f.tees).filter((p)=>p.id!==f.selfId);

 const me=embedded?((f.players||[]).find((p)=>p.id===f.selfId)||{}).name||(lastStatus&&lastStatus.name)||'':'';
 const key=me+'#'+list.map((p)=>p.id+':'+p.name).join('|');if(key===specKey)return;specKey=key;
 const cur=$('#spec').value;
 $('#spec').innerHTML='<option value="-1">'+(embedded?esc(t('за {name}',{name:me||t('ботом')})):t('за ботом'))+'</option>'+(embedded?'<option value="map">'+esc(t('вся карта'))+'</option><option value="free">'+esc(t('свободная камера'))+'</option>':'')+list.map((p)=>'<option value="'+p.id+'">'+esc(p.name||('#'+p.id))+'</option>').join('');

 $('#spec').value=specValue(cur,list.map((p)=>p.id),embedded);
 if($('#spec').value==='-1'&&view.spec()>=0&&!list.some((p)=>p.id===view.spec()))view.spectate(-1);
}
let pulling=false,pulledAt=0;
async function pullFrame(){
 if(document.hidden||pulling||(embedded&&PVIEW!=='game'))return;

 const now=performance.now();
 if(lastStatus&&lastStatus.lowCpu===true&&now-pulledAt<120)return;
 pulledAt=now;
 pulling=true;
 try{const f=await(await fetch('/api/live')).json();
  if(f&&f.tees){
   f._at=performance.now();
   hideNicks(f);

   if(NICKS&&f.broadcast&&typeof f.broadcast.text==='string'){const codes=[];f.broadcast.text=hideNicksIn(f.broadcast.text.replace(/\^[0-9]{3}/g,(c)=>{codes.push(c);return '\u0001'})).replace(/\u0001/g,()=>codes.shift()||'')}
   prevFrame=frame;sounds(frame,f);frame=f;view.pushFrame(f);fillSpec(f);renderPlayers(f);igFrame();

   if(f.map&&(f.mapKey||f.map)!==mapKey)await pullMap(f.map,f.mapKey||f.map);
   if(f.doing){doingText=tr(f.doing);$('#doing').textContent=t('сейчас: {what}',{what:doingText})}
  }

  else if(f===null)view.setBroadcast(null);
 }catch{}
 pulling=false;
}

let fpsCap=60,lastDraw=-1e9;
try{const v=localStorage.getItem('ddai.fps');if(v==='30'||v==='60'||v==='0')fpsCap=Number(v)}catch{}
function loop(now){
 requestAnimationFrame(loop);
 let mini=false;try{mini=document.documentElement.classList.contains('mini')}catch{}
 const cap=mini&&!STREAM?Math.min(fpsCap||60,30):fpsCap;
 if(cap>0&&typeof now==='number'&&now-lastDraw<1000/cap-2)return;
 lastDraw=typeof now==='number'?now:0;
 if(!embedded||PVIEW==='game'){try{view.draw()}catch(err){console.error(err)}}
 if(view2&&clipsShown()){try{view2.draw()}catch(err){console.error(err)}}
}
setInterval(pullFrame,40);pullFrame();requestAnimationFrame(loop);

$('#log').addEventListener('click',(e)=>{const n=e.target.closest('[data-nick]');if(n)insertNick(n.dataset.nick)});

$('#logcopy').addEventListener('click',()=>{
 const text=[...document.querySelectorAll('#log > div')].map((d)=>d.textContent).join('\n');
 const done=()=>{$('#logcopy').textContent=t('скопировано');setTimeout(()=>{$('#logcopy').textContent=t('копировать')},1500)};
 const fallback=()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.append(ta);ta.select();try{document.execCommand('copy');done()}catch{}ta.remove()};
 try{navigator.clipboard.writeText(text).then(done,fallback)}catch{fallback()}
});

const dds=[];
function makeDd(o){
 const popup=!!o.anchor;
 const wrap=popup?null:document.createElement('span');
 let btn=null,bl=null;
 if(!popup){
  wrap.className='dd'+(o.wide?' wide':'');
  btn=document.createElement('button');btn.type='button';btn.className='ghost dd-btn';
  btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');
  if(o.title)btn.title=o.title;
  bl=document.createElement('span');bl.className='dd-bl';btn.append(bl);
 }
 const anchor=popup?o.anchor:btn;
 const menu=document.createElement('div');menu.className='dd-menu'+(o.cls?' '+o.cls:'');menu.hidden=true;menu.tabIndex=-1;
 const find=document.createElement('input');find.type='text';find.className='dd-find';find.placeholder=o.findText||t('поиск');find.setAttribute('autocomplete','off');find.spellcheck=false;find.setAttribute('aria-label',find.placeholder);
 const list=document.createElement('div');list.className='dd-list';list.setAttribute('role','listbox');
 const rest=document.createElement('div');rest.className='dd-rest';rest.hidden=true;
 menu.append(find,list,rest);
 if(popup)document.body.appendChild(menu);else{wrap.append(btn,menu);if(o.host)o.host.append(wrap)}
 let items=[],shown=[],active=-1,activeVal=null,q='',isOpen=false;
 const nodes=new Map();
 const get=()=>{try{return o.getItems(q)||[]}catch{return[]}};
 const value=()=>{try{return o.getValue?o.getValue():null}catch{return null}};
 const put=(e,v)=>{if(e.textContent!==v)e.textContent=v};
 const rowFor=(it)=>{
  let n=nodes.get(it.value);
  if(!n){
   n=document.createElement('button');n.type='button';n.className='dd-item';n.setAttribute('role','option');n.tabIndex=-1;
   for(const c of ['dd-dot','dd-l','dd-s','dd-m']){const e=document.createElement(c==='dd-dot'?'i':'span');e.className=c;n.append(e)}
   n._v=it.value;nodes.set(it.value,n);
  }
  const [dot,l,s,m]=n.children,cur=value();
  put(l,it.label);
  put(s,it.gone?t('ушёл'):(it.sub||''));s.classList.toggle('gone',!!it.gone);
  put(m,it.meta||'');
  dot.style.background=it.dot||'';dot.hidden=!it.dot;
  const full=it.label+(it.sub&&!it.gone?' ['+it.sub+']':'');if(n.title!==full)n.title=full;
  const on=cur!==null&&it.value===cur;n.classList.toggle('on',on);n.setAttribute('aria-selected',String(on));
  return n;
 };
 const keepSeen=(n)=>{if(!n)return;const a=n.offsetTop,b=a+n.offsetHeight;if(a<list.scrollTop)list.scrollTop=a;else if(b>list.scrollTop+list.clientHeight)list.scrollTop=b-list.clientHeight};
 const mark=()=>{for(const n of list.children)n.classList.remove('act');const it=shown[active];if(it){const n=nodes.get(it.value);if(n)n.classList.add('act')}};
 function setActive(i,scroll){active=i;activeVal=shown[i]?shown[i].value:null;mark();if(scroll!==false&&shown[i])keepSeen(nodes.get(shown[i].value))}
 const MAXROWS=400;
 function render(){
  items=get();
  const fl=o.filter===true||ddFilterable(items.length);
  find.hidden=!fl;
  if(!fl&&q!==''){q='';find.value=''}
  const keep=items.filter((i)=>i.keep===true),plain=items.filter((i)=>i.keep!==true);
  const all=[...keep,...(fl?ddFilter(plain,q):plain)];
  shown=all.slice(0,MAXROWS);
  rest.hidden=all.length<=MAXROWS;if(!rest.hidden)put(rest,t('ещё {n}: уточни поиск',{n:all.length-MAXROWS}));
  const live=new Set();
  shown.forEach((it,i)=>{const n=rowFor(it);live.add(it.value);if(list.children[i]!==n)list.insertBefore(n,list.children[i]||null)});
  while(list.children.length>shown.length)list.lastElementChild.remove();
  for(const [k,n] of nodes)if(!live.has(k)&&!n.isConnected)nodes.delete(k);
  if(!shown.length){if(!list.querySelector('.dd-none')){const z=document.createElement('div');z.className='dd-none';z.textContent=t('ничего не нашлось');list.append(z)}}
  else{const z=list.querySelector('.dd-none');if(z)z.remove()}
  const to=ddKeep(shown,activeVal,active);
  active=to;activeVal=shown[to]?shown[to].value:null;mark();
 }
 function place(){
  const r=anchor.getBoundingClientRect();
  const rows=Math.min(Math.max(shown.length,1),8);
  const p=ddPlace(r,innerWidth,innerHeight,{w:o.minW||224,h:rows*30+10+(find.hidden?0:46)+(rest.hidden?0:22)});
  menu.style.left=p.left+'px';menu.style.width=p.width+'px';menu.style.maxHeight=p.maxH+'px';

  if(p.up){menu.style.top='auto';menu.style.bottom=(innerHeight-r.top+4)+'px'}else{menu.style.bottom='auto';menu.style.top=p.top+'px'}
  menu.classList.toggle('up',p.up);
 }
 function label(){
  if(popup)return;
  const v=value(),its=get();
  const it=v===null?null:its.find((i)=>i.value===v);
  put(bl,it?it.label+(it.gone?' · '+t('ушёл'):''):(o.placeholder||''));
  btn.classList.toggle('dd-empty',!it);
 }
 function close(back){
  if(!isOpen)return;
  isOpen=false;menu.hidden=true;if(wrap)wrap.classList.remove('open');anchor.setAttribute('aria-expanded','false');
  if(back===true){try{anchor.focus({preventScroll:true})}catch{}}
  if(o.onClose)o.onClose();
 }
 function open(){
  if(isOpen)return;
  for(const d of dds)if(d!==api)d.close();
  q='';find.value='';activeVal=value();active=-1;
  isOpen=true;if(wrap)wrap.classList.add('open');anchor.setAttribute('aria-expanded','true');
  menu.hidden=false;render();place();
  if(activeVal===null||!shown.some((i)=>i.value===activeVal))setActive(shown.length?0:-1,false);
  (find.hidden?menu:find).focus({preventScroll:true});
  keepSeen(shown[active]?nodes.get(shown[active].value):null);
 }
 function pick(v){const it=items.find((i)=>i.value===v)||shown.find((i)=>i.value===v);close(true);if(it)o.onPick(it.value,it)}
 list.addEventListener('click',(e)=>{e.stopPropagation();const b=e.target.closest?e.target.closest('.dd-item'):null;if(b)pick(b._v)});

 list.addEventListener('contextmenu',(e)=>{const b=e.target.closest?e.target.closest('.dd-item'):null;if(!b||!o.onContext)return;e.preventDefault();const it=items.find((i)=>i.value===b._v);close();if(it)o.onContext(it,e)});
 list.addEventListener('mousemove',(e)=>{menu.classList.remove('kb');const b=e.target.closest?e.target.closest('.dd-item'):null;if(!b)return;const i=shown.findIndex((x)=>x.value===b._v);if(i>=0&&i!==active)setActive(i,false)});
 menu.addEventListener('mousedown',(e)=>{if(e.target!==find)e.preventDefault()});
 menu.addEventListener('click',(e)=>e.stopPropagation());
 find.addEventListener('input',()=>{q=find.value;activeVal=null;render();setActive(shown.length?0:-1,false);list.scrollTop=0;place()});
 menu.addEventListener('keydown',(e)=>{
  if(e.key==='Tab'){close();return}
  e.stopPropagation();
  if(e.key==='Escape'){e.preventDefault();close(true);return}
  if(e.key==='Enter'||(e.key===' '&&find.hidden)){e.preventDefault();const it=shown[active];if(it)pick(it.value);return}
  const to=ddKey(e.key,active,shown.length);
  if(to>=0){e.preventDefault();menu.classList.add('kb');setActive(to)}
 });
 menu.addEventListener('focusout',(e)=>{const to=e.relatedTarget;if(isOpen&&to&&!menu.contains(to)&&to!==anchor)close()});
 if(!popup){
  btn.addEventListener('click',(e)=>{e.stopPropagation();if(isOpen)close();else open()});
  btn.addEventListener('keydown',(e)=>{if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!isOpen){e.preventDefault();open()}});
 }
 const api={wrap,btn,menu,label,open,close,place,toggle:()=>{if(isOpen)close();else open()},isOpen:()=>isOpen,refresh:()=>{label();if(isOpen){render();place()}},contains:(n)=>menu.contains(n)||(anchor&&anchor.contains(n))};
 dds.push(api);label();
 return api;
}

function ddSelect(sel){
 const flex=sel.style&&sel.style.flex;
 const d=makeDd({wide:!!flex,title:sel.title||sel.dataset.tip||'',getItems:()=>[...sel.options].map((op)=>({value:op.value,label:op.textContent})),getValue:()=>sel.value,onPick:(v)=>{sel.value=v;sel.dispatchEvent(new Event('change'));d.label()}});
 sel.parentNode.insertBefore(d.wrap,sel);d.wrap.append(sel);sel.hidden=true;
 if(flex)d.wrap.style.flex=flex;
 try{new MutationObserver(()=>d.refresh()).observe(sel,{childList:true})}catch{}
 return d;
}

for(const id of ['#spec','#emo','#cspeed','#fpscap','#llm_preset','#try_sel']){try{if($(id))$(id)._dd=ddSelect($(id))}catch{}}

document.addEventListener('pointerdown',(e)=>{for(const d of dds)if(d.isOpen()&&!d.contains(e.target))d.close()},true);
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')for(const d of dds)d.close()});
{const again=()=>{for(const d of dds)if(d.isOpen())d.place()};addEventListener('resize',again);addEventListener('scroll',again,true)}

const rangeFill=(el)=>{const lo=Number(el.min)||0,hi=Number(el.max),v=Number(el.value);const p=hi>lo?Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100)):0;const w=p.toFixed(1)+'%';if(el.style.getPropertyValue('--p')!==w)el.style.setProperty('--p',w)};
setInterval(()=>{for(const d of dds)d.label();try{for(const r of document.querySelectorAll('input[type=range]'))rangeFill(r)}catch{}},300);
try{for(const r of document.querySelectorAll('input[type=range]')){rangeFill(r);r.addEventListener('input',()=>rangeFill(r))}}catch{}

const VIEW_KEY='ddai.view';
function saveView(){if(STREAM||(embedded&&PVIEW!=='game'))return;try{localStorage.setItem(VIEW_KEY,JSON.stringify({mode:view.mode(),zoom:Number($('#zoom').value),sound:!muted,show:Object.fromEntries(TOGGLES.map(([id,key])=>[key,$(id).className.includes('on')])),tab:(document.querySelector('.tab.on')||{dataset:{}}).dataset.tab||'game'}))}catch{}}
const TOGGLES=[['#troute','route'],['#ttraps','traps'],['#tnames','names'],['#tcursor','cursor'],['#tboard','board']];
(()=>{
 if(STREAM){
  for(const [id,key] of TOGGLES){const on=key==='names'&&NICKS!=='off';view.toggle(key,on);$(id).className='ghost'+(on?' on':'')}
  return;
 }
 let v=null;try{v=JSON.parse(localStorage.getItem(VIEW_KEY)||'null')}catch{}
 if(!v||typeof v!=='object')return;
 if(v.mode==='map'||v.mode==='ent'||v.mode==='both'){view.setMode(v.mode);$('#tmode').textContent=modeNames[v.mode];$('#tmode').className='ghost'+(v.mode!=='map'?' on':'')}
 if(v.show&&typeof v.show==='object')for(const [id,key] of TOGGLES)if(typeof v.show[key]==='boolean'){view.toggle(key,v.show[key]);$(id).className='ghost'+(v.show[key]?' on':'')}
 if(Number.isFinite(v.zoom)&&v.zoom>=3&&v.zoom<=300){$('#zoom').value=String(v.zoom);view.setZoom(100/v.zoom)}
 const mini=document.documentElement.classList.contains('mini');
 if(!mini&&!embedded&&typeof v.tab==='string'&&v.tab!=='game'){const b=document.querySelector('.tab[data-tab="'+v.tab+'"]');if(b)b.click()}
})();
for(const id of ['#tmode','#troute','#ttraps','#tnames','#tcursor','#tboard','#tsound'])$(id).addEventListener('click',()=>setTimeout(saveView,0));
$('#zoom').addEventListener('change',saveView);cv.addEventListener('wheel',()=>{clearTimeout(saveView.t);saveView.t=setTimeout(saveView,500)});
for(const b of document.querySelectorAll('.tab'))b.addEventListener('click',()=>setTimeout(saveView,0));

function acRule(r){
 const row=document.createElement('div');row.className='ac-rule';
 row.innerHTML='<input type="checkbox" class="ac-on"><input type="text" class="ac-match" maxlength="60"><span class="ac-arrow">→</span><input type="text" class="ac-reply" maxlength="200"><button type="button" class="ghost mini ac-del">✕</button>';
 row.querySelector('.ac-on').checked=r.on!==false;
 row.querySelector('.ac-match').value=r.match||'';row.querySelector('.ac-match').placeholder=t('слово: дуэль|duel');
 row.querySelector('.ac-reply').value=r.reply||'';row.querySelector('.ac-reply').placeholder=t('ответ: /accept');
 row.querySelector('.ac-del').title=t('Убрать правило');
 row.querySelector('.ac-del').addEventListener('click',()=>row.remove());
 $('#ac_rules').append(row);
}
function acFill(c){
 if(!c)return;
 $('#ac_per_on').checked=!!c.periodic.on;$('#ac_per_sec').value=String(c.periodic.everySec);$('#ac_per_text').value=c.periodic.text||'';
 $('#ac_men_on').checked=!!c.mention.on;$('#ac_men_text').value=c.mention.reply||'';
 $('#ac_rules').textContent='';for(const r of c.keywords||[])acRule(r);
 if(!(c.keywords||[]).length)acRule({on:true,match:'',reply:''});
}
async function pullAutoChat(){try{acFill(await(await fetch('/api/autochat')).json())}catch{}}
$('#ac_add').addEventListener('click',()=>acRule({on:true,match:'',reply:''}));
$('#ac_save').addEventListener('click',async()=>{
 const body={periodic:{on:$('#ac_per_on').checked,everySec:Number($('#ac_per_sec').value),text:$('#ac_per_text').value},
  mention:{on:$('#ac_men_on').checked,reply:$('#ac_men_text').value},
  keywords:[...document.querySelectorAll('#ac_rules .ac-rule')].map((r)=>({on:r.querySelector('.ac-on').checked,match:r.querySelector('.ac-match').value,reply:r.querySelector('.ac-reply').value}))};
 try{const r=await fetch('/api/autochat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const c=await r.json();
  if(r.ok&&c){acFill(c);$('#ac_note').textContent=t('сохранено')}else $('#ac_note').textContent=t('не сохранилось')}
 catch{$('#ac_note').textContent=t('не сохранилось')}
 setTimeout(()=>{$('#ac_note').textContent=''},3000);
});
for(const b of document.querySelectorAll('.tab'))b.addEventListener('click',()=>{if(b.dataset.tab==='cfg')pullAutoChat()});
pullAutoChat();

for(const b of document.querySelectorAll('[data-step]'))b.addEventListener('click',()=>{
 const f=$('#'+b.dataset.for);if(!f)return;
 const min=Number(f.min)||0,max=Number(f.max)||1e9;
 f.value=String(Math.min(max,Math.max(min,(Number(f.value)||min)+Number(b.dataset.step))));
});

$('#knobreset').addEventListener('click',async()=>{
 try{await fetch('/api/knobs',{method:'POST',body:JSON.stringify({reset:true})});$('#knobnote').textContent=t('сброшено')}catch{$('#knobnote').textContent=t('не вышло')}
 pullKnobs();setTimeout(()=>{$('#knobnote').textContent=''},3000);
});

let testWait=[];
const afterTest=(fn)=>{if(testWait)testWait.push(fn);else fn()};
if(TEST_BUILD){
 const box=$('#testbuild'),id=(Array.isArray(NEWS)&&NEWS[0]&&NEWS[0].id)||'test';
 const close=()=>{
  box.hidden=true;try{localStorage.setItem('ddai.testbuild',id)}catch{}
  const run=testWait;testWait=null;for(const fn of run||[])fn();
 };
 $('#tbadge').hidden=false;
 $('#tbadge').addEventListener('click',()=>{box.hidden=false});
 $('#testclose').addEventListener('click',close);
 $('#testok').addEventListener('click',close);
 box.addEventListener('click',(e)=>{if(e.target===box)close()});
 let seen=null,mini=false;try{seen=localStorage.getItem('ddai.testbuild');mini=document.documentElement.classList.contains('mini')}catch{}
 if(seen!==id&&!mini&&PVIEW==='game'){box.hidden=false}else testWait=null;
}else testWait=null;

{
 const steps=[
  {sel:'.game-grid>.card .view',h:t('Экран игры'),p:t('Так бот видит сервер. Колесо мыши меняет масштаб, клик по ти ставит камеру за ним. Enter открывает чат, Tab дописывает ник или команду.')},
  {sel:'.viewbar .grp:first-child',h:t('Камера'),p:t('«следить» возвращает камеру к боту, в списке можно выбрать любого игрока. «вся карта» показывает карту целиком, ползунок меняет масштаб.')},
  {sel:'#tmode',h:t('Вид'),p:t('Как в DDNet: обычная карта, сущности (где фриз и за что цепляется хук) или всё вместе.')},
  {sel:'.viewbar .grp:last-child',h:t('Что показывать'),p:t('Ники над ти, прицел бота, его маршрут, ловушки (места, откуда не выбраться), табло (как удерживать Tab) и звук игры.')},
  {sel:'#modesw',h:t('Простой и полный вид'),p:t('Простой: экран игры, что делает бот, три кнопки и чат. Полный: все панели, лог, вид экрана и настройки бота. Выбор запоминается.')},
  {sel:'#sbtns',h:t('Что делает бот'),p:t('Драться: бот дерётся там, где игра. Держать ВБ: держит вейблок и закидывает во фриз всех, кто идёт через него. Дуэль: 1 на 1, включается и сама, когда бот принял дуэль. Кнопка «Стоп» останавливает бота, «Играть» запускает снова.')},
  {sel:'#styleseg',h:t('Что делает бот'),p:t('дефолт: дерётся там, где игра. ВБ: держит вейблок и закидывает во фриз всех, кто идёт через него. дуэль: 1 на 1, включается и сама, когда бот принял дуэль.')},
  {sel:'#modeseg',h:t('Режим'),p:t('драться: бьёт тех, кто рядом. не лезть: ходит, но никого не трогает. стоять: стоит на месте.')},
  {sel:'.acts',h:t('Быстрые кнопки'),p:t('убиться: как клавиша K (kill) в DDNet, без задержки. клип: сохранить последние 30 секунд во вкладку «Записи». наблюдать: бот уходит в наблюдатели. дом: сюда бот вернётся, когда не с кем драться. И эмоция над головой.')},
  {sel:'.ctl-low',h:t('Слабый ПК'),p:t('Огромный пинг и бот стоит на месте: включи. Бот считает короче и успевает за сервером, но играет чуть слабее.')},
  {sel:'.card.players',h:t('Игроки'),p:t('Клик по нику: сделать целью, идти к нему, следить, тима, вар, игнор. Тиму (друга) бот не трогает, защищает и вытаскивает из фриза, вара бьёт первым.')},
  {sel:'.logcard',h:t('Лог'),p:t('Всё, что бот слышит и делает: чат, события, личные сообщения. Есть поиск и кнопка «копировать», чтобы скинуть лог.')},
  {sel:'#f',h:t('Команды'),p:t('Команды боту и текст в чат. !help покажет все команды. Например: !wb left, !duel on, !goto @ник, !target ник. Второму боту то же через !d, например !d wb right. С двумя ботами !target ник ставит цель обоим, !target1 ник только первому, !d target ник только второму.')},
  {sel:'.tab[data-tab="clips"]',h:t('Записи'),p:t('Клипы моментов игры и все дуэли со счётом. Там же адреса для стрима в OBS: /overlay (только счёт) и /stream (игра целиком).')},
  {sel:'.tab[data-tab="cfg"]',h:t('Настройки'),p:t('Автоматический чат (например «duel» → /duel {name}), второй бот, списки вар и тимы, настройки поиска.')},
  {sel:'#helpbtn',h:t('Всё'),p:t('Этот тур можно открыть снова кнопкой «?». Что нового в версии: клик по номеру версии рядом. Оригинал бота бесплатный и только на github.com/Wranked1/DDNet-AI и в t.me/aiddnet: если скачал или купил в другом месте, скачай оттуда.')},
 ];
 const veil=$('#spot'),hole=$('#spothole'),pop=$('#spotpop');
 let at=0,list=[];
 const shown=(s)=>{const el=document.querySelector(s.sel);if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
 const place=()=>{
  if(veil.hidden||!list.length)return;

  if(document.documentElement.classList.contains('mini')){veil.hidden=true;return}
  const el=document.querySelector(list[at].sel);if(!el)return;
  const r=el.getBoundingClientRect(),pad=6;
  const x=Math.max(4,r.left-pad),y=Math.max(4,r.top-pad),w=Math.min(innerWidth-4-x,r.width+pad*2),h=Math.min(innerHeight-4-y,r.height+pad*2);
  Object.assign(hole.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
  const pw=pop.offsetWidth,ph=pop.offsetHeight,m=12,fit=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

  let px=fit(x+w/2-pw/2,8,innerWidth-pw-8),py;
  if(y+h+m+ph<=innerHeight-8)py=y+h+m;
  else if(y-m-ph>=8)py=y-m-ph;
  else if(x+w+m+pw<=innerWidth-8){px=x+w+m;py=fit(y,8,innerHeight-ph-8)}
  else if(x-m-pw>=8){px=x-m-pw;py=fit(y,8,innerHeight-ph-8)}
  else py=fit(y+h-ph-m,8,innerHeight-ph-8);
  pop.style.left=px+'px';pop.style.top=py+'px';
 };
 const show=(i)=>{
  at=Math.max(0,Math.min(list.length-1,i));
  const s=list[at],el=document.querySelector(s.sel);
  if(el)el.scrollIntoView({block:'nearest',inline:'nearest'});
  $('#spoth').textContent=s.h;$('#spotp').textContent=s.p;
  $('#spotn').textContent=(at+1)+' / '+list.length;
  $('#spotprev').disabled=at===0;
  $('#spotnext').textContent=at===list.length-1?t('понятно'):t('дальше');
  requestAnimationFrame(place);
 };
 const open=()=>{
  const game=document.querySelector('.tab[data-tab="game"]');if(game&&!game.classList.contains('on'))game.click();
  list=steps.filter(shown);if(!list.length)return;
  veil.hidden=false;show(0);
 };
 const close=()=>{veil.hidden=true;try{localStorage.setItem(TOUR_KEY,'seen')}catch{}};
 $('#helpbtn').addEventListener('click',open);
 $('#spotx').addEventListener('click',close);
 $('#spotprev').addEventListener('click',()=>show(at-1));
 $('#spotnext').addEventListener('click',()=>{if(at===list.length-1)close();else show(at+1)});

 document.addEventListener('keydown',(e)=>{if(veil.hidden!==false)return;e.stopPropagation();if(e.key==='Escape')close();else if(e.key==='ArrowRight')show(at+1);else if(e.key==='ArrowLeft')show(at-1);else return;e.preventDefault()},true);
 addEventListener('resize',place);

 setInterval(()=>{if(!veil.hidden)place()},400);
 let seen=true;try{seen=localStorage.getItem(TOUR_KEY)==='seen'}catch{}
 let mini=false;try{mini=document.documentElement.classList.contains('mini')}catch{}

 if(embedded){if(!seen&&!mini){try{localStorage.setItem(TOUR_KEY,'seen');if(Array.isArray(NEWS)&&NEWS[0])localStorage.setItem('ddai.news',NEWS[0].id)}catch{}}}
 else if(!seen&&!mini)setTimeout(()=>afterTest(open),600);
}

{
 const list=Array.isArray(NEWS)?NEWS:[];
 const top=list[0];
 const show=()=>{
  if(!top)return;
  try{
   $('#newsver').textContent=top.id;
   const ul=$('#newslist');ul.textContent='';
   for(const line of (LANG==='en'?top.en:top.ru)||[]){const li=document.createElement('li');li.textContent=line;ul.appendChild(li)}
   $('#news').hidden=false;
  }catch{}
 };
 const close=()=>{$('#news').hidden=true;try{if(top)localStorage.setItem('ddai.news',top.id)}catch{}};
 $('#newsclose').addEventListener('click',close);
 $('#newsok').addEventListener('click',close);
 $('#news').addEventListener('click',(e)=>{if(e.target===$('#news'))close()});
 $('#ver').addEventListener('click',show);
 let seen=null,tour=null;try{seen=localStorage.getItem('ddai.news');tour=localStorage.getItem(TOUR_KEY)}catch{}
 let mini=false;try{mini=document.documentElement.classList.contains('mini')}catch{}
 if(top&&seen!==top.id){

  if(tour!=='seen'){try{localStorage.setItem('ddai.news',top.id)}catch{}}
  else if(!mini&&PVIEW==='game')afterTest(show);
 }
}

if($('#fpscap')){$('#fpscap').value=String(fpsCap);$('#fpscap').addEventListener('change',()=>{fpsCap=Number($('#fpscap').value);try{localStorage.setItem('ddai.fps',String(fpsCap))}catch{}})}

for(const b of document.querySelectorAll('[data-dcmd]'))b.addEventListener('click',()=>void botCmd('!d '+b.dataset.dcmd,true));

if(STREAM){
 const box=document.createElement('div');box.id='streamscore';box.hidden=true;
 box.innerHTML='<div class="row"><span class="n" id="ss_me"></span><span id="ss_sc"></span><span class="n" id="ss_op"></span></div><div id="ss_sub"></div>';
 document.body.appendChild(box);
 const pull=async()=>{
  let d=null;try{d=await(await fetch('/api/duelnow',{cache:'no-store'})).json()}catch{d=null}
  const cur=d&&d.now,last=d&&d.last,show=cur||last;
  box.hidden=!show;if(!show)return;
  box.classList.toggle('idle',!cur);
  $('#ss_me').textContent=cur?d.me:(last.by||d.me);
  const op=cur?cur.name:last.opponent;
  $('#ss_op').textContent=NICKS&&op?(nickIds.has(op)?nickLabel(nickIds.get(op)):NICKS==='id'?'?':''):op;
  $('#ss_sc').textContent=(cur?cur.ours:last.ours)+' : '+(cur?cur.theirs:last.theirs);
  $('#ss_sub').textContent=cur?t('дуэль'):t('прошлая дуэль');
 };
 pull();setInterval(pull,500);
}

const IG_STATE={off:t('выключен'),queued:t('ждёт запуска'),away:t('не в игре'),frozen:t('во фризе'),duel:t('дуэль'),hold:t('стоит'),'wb-left':t('держит левый ВБ'),'wb-right':t('держит правый ВБ'),goto:t('идёт к игроку'),passive:t('не лезет'),target:t('идёт к цели'),seek:t('ищет цель')};
const IG_SHORT={off:t('выкл'),queued:t('выкл'),away:t('не в игре'),frozen:t('фриз'),duel:t('дуэль'),hold:t('стоит'),'wb-left':t('левый ВБ'),'wb-right':t('правый ВБ'),goto:t('в пути'),passive:t('не лезет'),target:t('к цели'),seek:t('ищет')};
const IG_SW=[['pathfind',t('Пасфайндер'),t('Бот сам ищет путь по карте')],['preinput',t('Предвводы'),t('Ход соперника учитывается раньше')],['humanlike',t('Как человек'),t('Курсор и эмоции как у человека')],['dummy',t('Второй бот'),t('Второй бот в тиме, с ним вдвое больше нагрузки; включается при следующем запуске')],['lowCpu',t('Слабый ПК'),t('Короче расчёт, если бот не успевает за сервером')],['strong',t('Сильный'),t('Сильнее на ВБ, нужен мощный ПК')]];
const igEl=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const igPut=(e,v)=>{if(e.textContent!==v)e.textContent=v};
const igIcon=(name)=>{const s=document.createElement('span');s.className='ig-ic';s.innerHTML=iconSvg(name);return s};
const igBots=()=>botsOf(lastStatus,igState.stats,frame?frame.selfId:-1);
const igBotOf=(who)=>igBots().find((b)=>b.who===who)||null;
const igSend=(who,cmd)=>botCmd(botLine(who,cmd),true);
const igMini=()=>document.documentElement.classList.contains('mini');

function igNick(b){
 if(b.running&&b.name)return b.name;
 if(b.who==='a')return b.name||t('бот');
 const l=igState.launch||{},first=(lastStatus&&lastStatus.name)||'';
 return dummyNick(first,String(l.dummyName||''));
}

function igLook(b){
 const f=frame;let p=null;
 if(f&&b.id>=0)p=(f.players||[]).find((x)=>x.id===b.id)||(f.tees||[]).find((x)=>x.id===b.id)||null;
 if(p)return p;
 const l=igState.launch||{};
 return {skin:(b.who==='a'?l.skin:(l.dummySkin||l.skin))||'default'};
}
function igTee(img,b){
 const look=igLook(b);
 const url=view&&view.teeIcon?view.teeIcon(look,96):'';
 if(url===null){igState.retry=true;return}
 img.style.visibility=url?'visible':'hidden';
 if(url&&img.getAttribute('src')!==url)img.setAttribute('src',url);
}
function igStateOf(b){
 let s=botState(b);
 if(!b.running&&switchOn('dummy',igState.launch,lastStatus))s={key:'queued',tone:'off'};
 return {text:IG_STATE[s.key]||'',short:IG_SHORT[s.key]||'',tone:s.tone};
}

function igPend(who,field){const p=igState.pend[who+':'+field];return p&&p.until>Date.now()?p.v:null}
function igPlate(b){
 const look=igLook(b),l=igState.launch||{};
 const clan=igPend(b.who,'clan');
 const skin=igPend(b.who,'skin');
 return {
  nick:igNick(b),
  clan:clan!==null?clan:(b.running&&typeof look.clan==='string'?look.clan:(b.who==='a'?l.clan:(l.dummyClan||l.clan))||''),
  skin:skin!==null?skin:(typeof look.skin==='string'&&look.skin?look.skin:(b.who==='a'?l.skin:(l.dummySkin||l.skin))||'default'),
 };
}

const IG_BLK=[t('{n} блок'),t('{n} блока'),t('{n} блоков')];
const igBlocks=(n)=>IG_BLK[pluralIdx(n,LANG)].replace('{n}',String(n));
function igNote(text,tone){
 const n=$('#ignote');if(!n)return;
 n.textContent=text;n.title=text;n.classList.toggle('bad',tone==='bad');n.classList.add('on');
 clearTimeout(igState.note);igState.note=setTimeout(()=>{n.classList.remove('on')},5000);
}

function igWhy(text){
 const m=/^the nick is 1 to (\d+) bytes$/.exec(text),c=/^the clan is at most (\d+) bytes$/.exec(text);
 if(m)return t('Ник: от 1 до {n} байт',{n:m[1]});
 if(c)return t('Клан: не длиннее {n} байт',{n:c[1]});
 if(text==='not a skin name DDNet accepts')return t('Такое имя скина DDNet не принимает');
 return tr(text);
}
function igSaid(reply){
  const r=identityReply(reply);
  if(r.state==='wait')igNote(t('применится через {n} с',{n:r.seconds}));
  else if(r.state==='saved')igNote(t('запомнено, уйдёт на сервер, когда бот зайдёт'));
  else if(r.state==='next')igNote(t('сменится при следующем запуске: второй бот знает этого по нику'));
  else if(r.state==='error')igNote(igWhy(r.text),'bad');
  return r;
}
const igPlayers=(f)=>f?(f.players&&f.players.length?f.players:f.tees||[]):[];
const igSkip=(bots)=>bots.map((b)=>b.id).filter((i)=>i>=0);
function igColor(p){
 if(!p||p.cc!==true)return '';
 try{return 'rgb('+ddnetColor(p.cb||0).map((x)=>Math.round(x*255)).join(',')+')'}catch{return ''}
}

function igDist(p,me){
 const tee=frame&&frame.tees?frame.tees.find((x)=>x.id===p.id):null;
 return me&&tee?Math.round(Math.hypot(tee.x-me.x,tee.y-me.y)/32):-1;
}
function igMe(b){const tee=frame&&frame.tees&&b&&b.id>=0?frame.tees.find((x)=>x.id===b.id):null;return tee?{x:tee.x,y:tee.y}:null}

function igInit(){
 const r={cards:{},minis:{},seg:{}};

 for(const who of ['a','b']){
  const c=igEl('button','ig-card');c.type='button';c.dataset.who=who;
  const img=igEl('img','ig-tee');img.alt='';img.style.visibility='hidden';
  const nm=igEl('b','ig-nm'),st=igEl('small','ig-st');
  c.append(img,nm,st);r.cards[who]={root:c,img,nm,st};
  c.addEventListener('click',()=>{igState.sel=who;igRender()});
  $('#igcards').append(c);
  const m=igEl('button','ig-mini');m.type='button';m.dataset.who=who;
  const mi=igEl('img','ig-tee');mi.alt='';mi.style.visibility='hidden';
  const mn=igEl('b','ig-nm'),ms=igEl('small','ig-st');
  m.append(mi,mn,ms);r.minis[who]={root:m,img:mi,nm:mn,st:ms};
  m.addEventListener('click',()=>{igState.sel=who;igFold(false)});
  $('#igmini').append(m);
 }
 $('#igfold').addEventListener('click',()=>igFold(true));
 $('#igunfold').addEventListener('click',()=>igFold(false));
 igBuildBot(r);
 igBuildNear(r);
 igBuildSwitches(r);
 igBuildVolume();
 igBuildMore();

 for(const host of [$('#igra'),$('.viewbar'),$('.bottombar')])host.addEventListener('click',(e)=>{const b=e.target.closest?e.target.closest('button'):null;if(b&&e.detail>0&&document.activeElement===b)b.blur()});
 igState.r=r;
 igFold(igState.fold,true);
}
function igFold(on,quiet){
 igState.fold=on;
 document.documentElement.classList.toggle('ig-folded',on);
 $('#igopen').hidden=on;$('#igstrip').hidden=!on;
 if(!quiet){try{localStorage.setItem(IG_FOLD,on?'1':'0')}catch{}}
 for(const d of dds)d.close();
 igRender();
}

function igSeg(host,items,onPick){
 const root=igEl('div','ig-seg');root.setAttribute('role','group');
 const btns={};
 for(const [v,label] of items){
  const b=igEl('button','',label);b.type='button';b.dataset.v=v;
  b.addEventListener('click',()=>onPick(v));
  root.append(b);btns[v]=b;
 }
 host.append(root);
 return {root,btns,set(v,off){for(const k in btns){const on=k===v;btns[k].classList.toggle('on',on);btns[k].setAttribute('aria-pressed',String(on));btns[k].disabled=!!off&&off.includes(k)}}};
}
function igRow(host,label){const row=igEl('div','ig-row');row.append(igEl('span','ig-k',label));host.append(row);return row}

function igBuildBot(r){
 const box=$('#igbot');
 const plate=igEl('div','ig-plate');
 const mk=(field,label)=>{
  const f=igEl('span','ig-pf');f.dataset.f=field;
  if(label)f.append(igEl('span','ig-k',label));
  const b=igEl('button','ig-pbtn');b.type='button';
  const v=igEl(field==='nick'?'b':'span',field==='nick'?'ig-nick':'ig-v');
  b.append(v,igIcon('pencil'));f.append(b);
  b.addEventListener('click',()=>igEditStart(field));
  plate.append(f);
  return {root:f,btn:b,val:v};
 };
 r.plate={nick:mk('nick'),clan:mk('clan',t('клан')),skin:mk('skin',t('скин'))};
 r.plate.skin.val.hidden=true;
 box.append(plate);
 const body=igEl('div','ig-body');r.body=body;box.append(body);
 const style=igRow(body,t('режим'));
 r.seg.style=igSeg(style,[['default',t('обычный')],['wb',t('ВБ')],['duel',t('дуэль')]],(v)=>igSend(igState.sel,'!style '+v));
 const side=igRow(body,t('сторона'));
 r.seg.wb=igSeg(side,[['auto',t('авто')],['left',t('левый ВБ')],['right',t('правый ВБ')]],(v)=>igSend(igState.sel,'!wb '+v));
 const doing=igRow(body,t('делать'));
 r.seg.mode=igSeg(doing,[['fight',t('драться')],['passive',t('не лезть')],['hold',t('стоять')]],(v)=>igSend(igState.sel,'!mode '+v));
 const tgt=igRow(body,t('цель'));
 r.tdd=makeDd({host:tgt,wide:true,placeholder:t('выбирает сам'),title:t('Кого бьёт этот бот: сам выбирает или только выбранного'),
  getItems:()=>{const bots=igBots(),b=bots.find((x)=>x.who===igState.sel)||bots[0];const pin=b&&b.panel&&b.panel.pinnedTarget?b.panel.pinnedTarget:null;return [{value:'',label:t('выбирает сам')},...targetItems(igPlayers(frame),igSkip(bots),pin)]},
  getValue:()=>{const b=igBotOf(igState.sel);return b&&b.panel&&b.panel.pinnedTarget?b.panel.pinnedTarget:''},
  onPick:(v)=>igSend(igState.sel,v===''?'!target -':'!target '+v)});
 const slot=igEl('div','ig-slot'),score=igEl('div','ig-score');r.score=score;
 const sc=(k)=>{const s=igEl('span','');s.append(igEl('span','ig-k',k),igEl('b','ig-n'));score.append(s);return s};
 r.sc={blocks:sc(t('заблокал')),by:sc(t('его')),duel:sc(t('дуэль'))};

 const note=igEl('div','ig-note');note.id='ignote';note.setAttribute('role','status');
 slot.append(score,note);body.append(slot);

 const stats=igEl('div','ig-score ig-stats');stats.id='igstats';stats.hidden=true;r.stats=stats;
 r.st={};
 for(const [key,label] of [['kills',t('убил')],['deaths',t('умер')],['hooks',t('хуков')]]){const sp=igEl('span','');sp.append(igEl('span','ig-k',label),igEl('b','ig-n'));stats.append(sp);r.st[key]=sp}
 body.append(stats);

 const sbtn=igEl('button','ig-ghost ig-sbtn');sbtn.type='button';sbtn.append(igIcon('chart'),igEl('span','ig-sl',t('статистика')));sbtn.title=t('Убил, умер, хуков этого бота');sbtn.setAttribute('aria-label',t('статистика'));sbtn.setAttribute('aria-controls','igstats');sbtn.setAttribute('aria-expanded','false');
 sbtn.addEventListener('click',()=>{igState.statsOpen=!igState.statsOpen;try{localStorage.setItem(IG_STATS,igState.statsOpen?'1':'0')}catch{}igRender()});
 score.append(sbtn);r.statBtn=sbtn;
 const acts=igEl('div','ig-acts');r.acts=acts;
 const act=(icon,label,title,fn)=>{const b=igEl('button','ig-ghost');b.type='button';b.append(igIcon(icon),igEl('span','',label));b.title=title;b.addEventListener('click',fn);acts.append(b);return b};
 r.look=act('eye',t('смотреть'),t('Камера за этим ботом'),()=>{const b=igBotOf(igState.sel);if(!b||b.id<0)return;const self=frame?frame.selfId:-1;const id=b.id===self?-1:b.id;view.spectate(id);$('#spec').value=String(id);setFollow(true)});
 r.home=act('home',t('дом тут'),t('Бот вернётся сюда, когда не с кем драться'),()=>{const b=igBotOf(igState.sel);void igSend(igState.sel,b&&b.panel&&b.panel.home?'!home off':'!home')});
 r.kill=act('respawn','kill',t('Убить бота: как клавиша K (kill) в DDNet'),()=>void igSend(igState.sel,'!kill'));
 r.clip=act('rec',t('клип'),t('Сохранить последние 30 секунд во вкладку Записи'),()=>void igSend(igState.sel,'!clip'));
 r.copy=act('copy',t('как у первого'),t('Второй бот играет так же: стиль, сторона ВБ, что делать и цель первого'),async()=>{const a=igBotOf('a');if(!a)return;for(const l of copyLines(a))await botCmd(l,false);igNote(t('второй бот играет как первый'))});
 body.append(acts);

 const off=igEl('div','ig-off');r.off=off;
 r.offText=igEl('span','',t('Второй бот выключен. Его настройки сохранены.'));
 off.append(r.offText);
 const osw=igEl('button','ig-sw');osw.type='button';osw.setAttribute('role','switch');osw.setAttribute('aria-label',t('Второй бот'));osw.addEventListener('click',()=>igSwitch('dummy'));
 off.append(osw);r.offsw=osw;
 box.append(off);
}

function igEditStart(field){
 if(igState.edit)igState.edit();
 const r=igState.r,who=igState.sel,b=igBotOf(who);if(!b)return;
 const cell=r.plate[field];
 if(field==='skin'){igSkinPick(cell.btn,who);return}
 const limit=field==='nick'?15:11;
 const cur=igPlate(b)[field];
 const form=igEl('form','ig-ed');
 const input=igEl('input');input.type='text';input.value=cur;input.spellcheck=false;input.autocomplete='off';
 input.setAttribute('aria-label',field==='nick'?t('Ник'):t('Клан'));

 if(field==='clan')input.placeholder=who==='b'?t('пусто: как у первого'):t('без клана');
 const cnt=igEl('span','ig-cnt');
 const count=()=>{const v=clampBytes(input.value,limit);if(v!==input.value)input.value=v;const n=new TextEncoder().encode(input.value).length;cnt.textContent=n+'/'+limit;cnt.classList.toggle('bad',n>=limit)};
 form.append(input,cnt);
 cell.btn.hidden=true;cell.root.append(form);count();
 let open=true;
 const close=()=>{if(!open)return;open=false;form.remove();cell.btn.hidden=false;if(igState.edit===close)igState.edit=null;igRender()};
 igState.edit=close;
 input.addEventListener('input',count);
 input.addEventListener('keydown',(e)=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close()}});
 input.addEventListener('blur',()=>setTimeout(close,120));
 form.addEventListener('submit',async(e)=>{
  e.preventDefault();
  const v=input.value.trim();
  if(field==='nick'&&v===''){igNote(t('Ник не может быть пустым'),'bad');return}
  close();
  if(v===cur.trim())return;
  await igIdentity(who,field,v);
 });
 input.focus();input.select();
}

async function igIdentity(who,field,v){

 const save=identitySave(who,field,v);
 if(field==='nick'&&who==='b'){
  try{await fetch('/api/launch',{method:'POST',body:JSON.stringify(save)})}catch{}
  igNote(t('ник второго бота сменится при следующем запуске'));pullLaunch();return;
 }
 const line='!'+({nick:'nick',clan:'clan',skin:'skin'})[field]+' '+(v===''?(field==='clan'?'-':'default'):v);
 const reply=await botCmd(botLine(who,line),false);
 const sec=igSaid(String(reply||''));
 if(sec.state!=='error'&&field!=='nick')igState.pend[who+':'+field]={v,until:Date.now()+(sec.seconds+4)*1000};
 if(sec.state!=='error'&&save){try{await fetch('/api/launch',{method:'POST',body:JSON.stringify(save)})}catch{}pullLaunch()}
 igRender();
}

function igSkinPick(anchor,who){
 if(!igState.skinDd){
  igState.skinDd=makeDd({anchor,cls:'pop',filter:true,findText:t('имя скина'),
   getItems:(q)=>{const names=igState.skins||[];const typed=String(q||'').trim();return [...(typed!==''&&!names.includes(typed)?[{value:typed,label:t('взять «{name}»',{name:typed}),keep:true}]:[]),...names.map((n)=>({value:n,label:n}))]},
   getValue:()=>{const b=igBotOf(igState.skinWho);return b?igPlate(b).skin:null},
   onPick:(v)=>void igIdentity(igState.skinWho,'skin',v)});
 }
 igState.skinWho=who;
 if(igState.skinDd.isOpen()){igState.skinDd.close();return}
 const go=()=>igState.skinDd.open();
 if(igState.skins)go();
 else fetch('/api/skins').then((x)=>x.json()).then((v)=>{igState.skins=Array.isArray(v)?v:[]}).catch(()=>{igState.skins=[]}).then(go);
}
function igBuildNear(r){
 r.nlist=$('#ignlist');
 $('#igcount').addEventListener('click',()=>{if(r.all)r.all.toggle()});
 r.all=makeDd({anchor:$('#igcount'),cls:'pop all',findText:t('ник или клан'),minW:260,
  getItems:()=>{
   const bots=igBots(),b=bots.find((x)=>x.who===igState.sel)||bots[0],me=igMe(b.running?b:bots[0]);
   const by=new Map(igPlayers(frame).map((p)=>[p.name,p]));
   return targetItems(igPlayers(frame),igSkip(bots),null).map((it)=>{const p=by.get(it.value),d=p?igDist(p,me):-1;return {...it,dot:igColor(p)||'var(--off)',meta:d>=0?igBlocks(d):''}});
  },
  getValue:()=>{const b=igBotOf(igState.sel);return b&&b.panel&&b.panel.pinnedTarget?b.panel.pinnedTarget:null},
  onPick:(v)=>void igSend(igState.sel,'!target '+v),
  onContext:(it,e)=>{const p=igPlayers(frame).find((x)=>x.name===it.value);if(p)openCtx(e.clientX,e.clientY,{id:p.id,x:0,y:0},igState.sel)}});
}
function igRenderNear(bots,b){

 const r=igState.r,live=!!(b&&b.running),me=igMe(live?b:bots[0]),skip=igSkip(bots);
 const tees=frame&&frame.tees?frame.tees:[];
 const near=nearby(tees,me,skip,6);
 const total=igPlayers(frame).filter((p)=>p&&p.name&&!skip.includes(p.id)).length;
 igPut($('#igcount'),total?t('{n} на сервере',{n:total}):t('никого, кроме ботов'));
 $('#igcount').disabled=total===0||!live;
 if(!live&&r.all.isOpen())r.all.close();
 const pin=b&&b.panel&&b.panel.pinnedTarget?b.panel.pinnedTarget:'';
 const key=(frame?'f':'-')+(live?'l':'x')+near.list.map((p)=>p.id+':'+p.name).join('|')+'#'+pin+'#'+(total?'t':'');
 if(key!==igState.nearKey){
  igState.nearKey=key;
  r.nlist.textContent='';
  for(const p of near.list){
   const row=igEl('div','ig-nrow');row.dataset.id=String(p.id);
   const dot=igEl('i','ig-dot');const c=igColor(p);if(c)dot.style.background=c;else dot.classList.add('plain');
   const nm=igEl('span','ig-nn',p.name);row.title=p.name+(p.clan?' ['+p.clan+']':'')+'\n'+t('Правый клик: идти к нему, тима, вар, игнор');
   row.addEventListener('contextmenu',(e)=>{e.preventDefault();openCtx(e.clientX,e.clientY,{id:p.id,x:0,y:0},igState.sel)});
   const meta=igEl('span','ig-nm2');meta.dataset.m='1';
   const g=igEl('button','ig-ghost'+(pin===p.name?' on':''));g.type='button';g.append(igIcon('target'),igEl('span','',t('цель')));
   g.title=pin===p.name?t('Снова выбирать цель самому'):t('Драться только с ним (!target)');g.disabled=!live;
   g.addEventListener('click',()=>void igSend(igState.sel,pin===p.name?'!target -':'!target '+p.name));
   row.append(dot,nm,meta,g);r.nlist.append(row);
  }
  if(!near.list.length&&(total||!frame))r.nlist.append(igEl('div','ig-none',frame?t('рядом никого'):t('нет данных')));
 }
 for(const p of near.list){
  const row=r.nlist.querySelector('[data-id="'+p.id+'"]');if(!row)continue;
  const m=row.querySelector('[data-m]');igPut(m,p.blocks>=0?igBlocks(p.blocks):'');
 }
}
function igBuildSwitches(r){
 const box=$('#igsws');r.sw={};
 for(const [key,label,hint] of IG_SW){
  const row=igEl('div','ig-tg');
  const nm=igEl('span','',label);
  const sw=igEl('button','ig-sw');sw.type='button';sw.setAttribute('role','switch');sw.setAttribute('aria-label',label);sw.title=hint;
  sw.addEventListener('click',()=>void igSwitch(key));
  row.append(nm,sw);box.append(row);r.sw[key]=sw;
 }

 r.lag=$('#iglag');
}
const IG_LAG={plain:t('Бот не успевает за сервером: включи «Слабый ПК».'),low:t('Бот не успевает даже в режиме для слабого ПК: закрой лишние программы или выбери сервер, где меньше игроков.'),strong:t('Бот не успевает в сильном режиме: выключи «Сильный».')};
const IG_LAG_SW={plain:'lowCpu',strong:'strong'};
const igSwOn=(key)=>{const p=igState.sw[key];return p&&p.until>Date.now()?p.v:switchOn(key,igState.launch,lastStatus)};
async function igSwitch(key){
 const on=!igSwOn(key);
 igState.sw[key]={v:on,until:Date.now()+3500};igRender();
 if(key==='dummy'){
  try{await fetch('/api/launch',{method:'POST',body:JSON.stringify({dummy:on?'on':'off'})})}catch{}
  igNote(on?t('второй бот включится при следующем запуске'):t('второй бот выключится при следующем запуске'));
 }else{
  const line=switchLine(key,on);if(line)await botCmd(line,true);

  if(on&&(key==='lowCpu'||key==='strong')){const other=key==='lowCpu'?'strong':'lowCpu';igState.sw[other]={v:false,until:Date.now()+3500}}
 }
 await pullLaunch();igRender();
}

function igBuildVolume(){
 const sl=$('#igslider'),mute=$('#igmute');
 const paint=()=>{
  const v=igState.vol;
  sl.style.setProperty('--v',v+'%');sl.setAttribute('aria-valuenow',String(Math.round(v)));sl.setAttribute('aria-valuetext',muted?t('выключен'):Math.round(v)+'%');
  mute.innerHTML=iconSvg(muted||v===0?'mute':'vol');mute.classList.toggle('off',muted||v===0);
 };
 igState.paintVol=paint;
 const set=(v,keep)=>{
  igState.vol=Math.max(0,Math.min(100,Math.round(v)));
  if(!keep){try{localStorage.setItem(IG_VOL,String(igState.vol))}catch{}}

  if(muted&&igState.vol>0){muted=false;audio();$('#tsound').className='ghost on';setTimeout(saveView,0)}
  paint();
 };
 const at=(e)=>{const r=sl.getBoundingClientRect();return r.width>0?(e.clientX-r.left)/r.width*100:igState.vol};
 let drag=false;
 sl.addEventListener('pointerdown',(e)=>{if(e.button!==0)return;drag=true;try{sl.setPointerCapture(e.pointerId)}catch{}sl.focus();set(at(e))});
 sl.addEventListener('pointermove',(e)=>{if(drag)set(at(e))});
 sl.addEventListener('pointerup',(e)=>{drag=false;try{sl.releasePointerCapture(e.pointerId)}catch{}playSound(SND.HOOK_ATTACH_GROUND,null,volumeGain(igState.vol))});
 sl.addEventListener('keydown',(e)=>{
  const k={ArrowRight:5,ArrowUp:5,ArrowLeft:-5,ArrowDown:-5,PageUp:10,PageDown:-10}[e.key];
  if(k!==undefined){e.preventDefault();e.stopPropagation();set(igState.vol+k)}
  else if(e.key==='Home'){e.preventDefault();set(0)}
  else if(e.key==='End'){e.preventDefault();set(100)}
 });

 mute.addEventListener('click',()=>{if(igState.vol===0){set(70);return}$('#tsound').click();paint();setTimeout(paint,0)});
 $('#tsound').addEventListener('click',()=>setTimeout(paint,0));
 paint();
}

function igBuildMore(){
 const btn=$('#igmore');
 const menu=igEl('div','ig-menu');menu.id='igmenu';menu.setAttribute('role','menu');menu.hidden=true;menu.tabIndex=-1;
 document.body.appendChild(menu);
 let isOpen=false;
 const item=(label,hint,role)=>{
  const b=igEl('button','ig-mi');b.type='button';b.setAttribute('role',role||'menuitem');b.tabIndex=-1;
  b.append(igEl('span','ig-ml',label));if(hint)b.append(igEl('span','ig-mk',hint));
  return b;
 };
 const who=igEl('div','ig-mh');
 const spec=item('','');
 const emoHead=igEl('div','ig-mh ig-me-h',t('эмоция'));
 const emo=igEl('div','ig-me');emo.setAttribute('role','group');emo.setAttribute('aria-label',t('эмоция'));
 const EMO=[['hearts',t('сердечки')],['exclamation','!'],['question','?'],['sorry',t('извини')],['drop',t('капля')],['splat','splat'],['zzz','zzz']];
 const chips=EMO.map(([name,label])=>{const b=item(label,'');b.classList.add('ig-chip');b.dataset.v=name;b.title=t('Эмоция над головой бота');b.addEventListener('click',(e)=>{const line=emoteLine(igState.sel,name);close(e.detail===0);if(line)void botCmd(line,true)});emo.append(b);return b});
 const sep1=igEl('div','ig-ms');
 const pause=item(t('пауза картинки'),t('пробел'),'menuitemcheckbox');
 const zr=igEl('div','ig-zr');zr.setAttribute('role','group');zr.setAttribute('aria-label',t('масштаб'));
 const zl=igEl('span','ig-ml',t('масштаб'));
 const zm=item('−','');zm.classList.add('ig-zb');zm.setAttribute('aria-label',t('Отдалить'));zm.title=t('Отдалить');
 const zv=item('100%','');zv.classList.add('ig-zv');zv.title=t('Масштаб по умолчанию');
 const zp=item('+','');zp.classList.add('ig-zb');zp.setAttribute('aria-label',t('Приблизить'));zp.title=t('Приблизить');
 zr.append(zl,zm,zv,zp);
 const sep2=igEl('div','ig-ms');

 const DUP=[['#whole','menuitem'],['#tmode','menuitem'],['#ttraps','menuitemcheckbox'],['#tboard','menuitemcheckbox']].map(([sel,role])=>{const b=item('','',role);b.dataset.src=sel;b.addEventListener('click',(e)=>{const src=$(sel);if(src)src.click();if(role==='menuitem'&&sel==='#whole')close(e.detail===0);else sync()});return b});
 menu.append(who,spec,emoHead,emo,sep1,pause,zr,sep2,...DUP);
 const zoomSet=(z)=>{closeCtx();view.setZoom(z);$('#zoom').value=zoomToSlider(view.zoom());clearTimeout(saveView.t);saveView.t=setTimeout(saveView,500);sync()};
 zm.addEventListener('click',()=>zoomSet(zoomStep(view.zoom(),-1)));
 zp.addEventListener('click',()=>zoomSet(zoomStep(view.zoom(),1)));
 zv.addEventListener('click',()=>zoomSet(1));
 pause.addEventListener('click',(e)=>{setPause(!view.paused());close(e.detail===0)});
 spec.addEventListener('click',(e)=>{const b=igBotOf(igState.sel);close(e.detail===0);if(b&&b.running)void igSend(igState.sel,b.panel&&b.panel.spectating?'!join':'!spec')});
 const visible=()=>[...menu.querySelectorAll('.ig-mi')].filter((n)=>!n.hidden&&!n.disabled);
 function sync(){
  const bots=igBots(),b=bots.find((x)=>x.who===igState.sel)||bots[0];
  const live=!!(b&&b.running);
  who.textContent=t('для {nick}',{nick:igNick(b)});who.title=igNick(b);
  const sp=!!(b&&b.panel&&b.panel.spectating);
  spec.firstChild.textContent=sp?t('вернуть в игру'):t('наблюдать');spec.title=sp?t('Бот возвращается в игру'):t('Бот уходит в наблюдатели');spec.disabled=!live;
  for(const c of chips)c.disabled=!live;
  const p=view.paused();pause.setAttribute('aria-checked',String(p));pause.classList.toggle('on',p);
  zv.textContent=zoomPercent(view.zoom())+'%';
  for(const d of DUP){
   const src=$(d.dataset.src),shown=!!src&&getComputedStyle(src).display==='none';
   d.hidden=!shown;
   if(!src)continue;
   d.firstChild.textContent=src.textContent;
   if(d.getAttribute('role')==='menuitemcheckbox'){const on=src.className.includes('on');d.setAttribute('aria-checked',String(on));d.classList.toggle('on',on)}
  }
  sep2.hidden=!DUP.some((d)=>!d.hidden);
 }
 function place(){
  const r=btn.getBoundingClientRect();
  const w=264;

  menu.style.width=w+'px';menu.style.maxHeight='none';
  const p=ddPlace({left:r.right-w,right:r.right,top:r.top,bottom:r.bottom},innerWidth,innerHeight,{w,h:menu.scrollHeight+2});
  menu.style.left=p.left+'px';menu.style.width=p.width+'px';menu.style.maxHeight=p.maxH+'px';
  if(p.up){menu.style.top='auto';menu.style.bottom=(innerHeight-r.top+4)+'px'}else{menu.style.bottom='auto';menu.style.top=p.top+'px'}
 }
 function close(back){
  if(!isOpen)return;
  isOpen=false;menu.hidden=true;btn.setAttribute('aria-expanded','false');
  if(back===true){try{btn.focus({preventScroll:true})}catch{}}else if(document.activeElement&&menu.contains(document.activeElement))document.activeElement.blur();
 }
 function open(focus){
  if(isOpen)return;
  for(const d of dds)if(d!==api)d.close();
  isOpen=true;btn.setAttribute('aria-expanded','true');
  sync();menu.hidden=false;place();
  if(focus){const first=visible()[0];if(first)first.focus({preventScroll:true})}else menu.focus({preventScroll:true});
 }
 btn.addEventListener('click',(e)=>{e.stopPropagation();if(isOpen)close(e.detail===0);else open(e.detail===0)});
 btn.addEventListener('keydown',(e)=>{if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!isOpen){e.preventDefault();open(true)}});
 menu.addEventListener('mousedown',(e)=>e.preventDefault());
 menu.addEventListener('click',(e)=>e.stopPropagation());
 menu.addEventListener('keydown',(e)=>{

  if(e.key==='Tab'){close(true);return}
  e.stopPropagation();
  if(e.key==='Escape'){e.preventDefault();close(true);return}
  const list=visible(),at=list.indexOf(document.activeElement),to=moreKey(e.key,at,list.length);
  if(to>=0){e.preventDefault();list[to].focus({preventScroll:true})}
 });
 menu.addEventListener('focusout',(e)=>{const to=e.relatedTarget;if(isOpen&&to&&!menu.contains(to)&&to!==btn)close()});
 const api={close,place,sync,label(){},refresh(){},isOpen:()=>isOpen,contains:(n)=>menu.contains(n)||btn.contains(n)};
 dds.push(api);
 igState.more=api;igState.moreBtn=btn;
}
function igRender(){
 const r=igState.r;
 if(!IGRA||!r||igMini())return;
 const bots=igBots();
 const sel=bots.find((b)=>b.who===igState.sel)||bots[0];

 for(const b of bots){
  const st=igStateOf(b),nick=igNick(b);
  for(const [set,short] of [[r.cards,false],[r.minis,true]]){
   const c=set[b.who];
   igPut(c.nm,nick);c.root.title=nick;
   igPut(c.st,short?st.short:st.text);c.st.className='ig-st '+st.tone;
   c.root.classList.toggle('sel',b.who===sel.who);c.root.classList.toggle('off',!b.running);
   c.root.setAttribute('aria-pressed',String(b.who===sel.who));
   igTee(c.img,b);
  }
 }

 const live=sel.running;
 const pl=igPlate(sel);
 r.body.hidden=!live;r.off.hidden=live;

 $('#igra').classList.toggle('ig-st-open',live&&!!igState.statsOpen);
 for(const f of ['nick','clan','skin'])r.plate[f].root.hidden=!live;
 if(live){
  igPut(r.plate.nick.val,pl.nick);r.plate.nick.btn.title=sel.who==='b'?t('Ник второго бота: сменится при следующем запуске'):t('Поменять ник');
  igPut(r.plate.clan.val,pl.clan);r.plate.clan.val.hidden=!pl.clan;r.plate.clan.btn.title=t('Поменять клан');
  r.plate.skin.btn.title=t('Скин: {name}',{name:pl.skin});
  const hasWb=!!(sel.panel&&sel.panel.wbMode!==null&&sel.panel.wbMode!==undefined);
  const style=styleOf(sel.panel);
  r.seg.style.set(style,hasWb?[]:['wb']);
  r.seg.wb.set(style==='wb'&&sel.panel?sel.panel.wbMode:'',hasWb?[]:['auto','left','right']);
  r.seg.mode.set(modeOf(sel),[]);
  r.tdd.refresh();
  igPut(r.sc.blocks.lastChild,sel.blocks===null?'–':String(sel.blocks));
  igPut(r.sc.by.lastChild,sel.blockedBy===null?'–':String(sel.blockedBy));
  const duel=sel.panel&&sel.panel.duelScore;
  r.sc.duel.hidden=!duel;if(duel)igPut(r.sc.duel.lastChild,duel.ours+':'+duel.theirs);
  const home=!!(sel.panel&&sel.panel.home);
  igPut(r.home.lastChild,home?t('забыть дом'):t('дом тут'));
  r.look.disabled=sel.id<0;
  r.copy.hidden=sel.who!=='b';
  r.stats.hidden=!igState.statsOpen;
  r.statBtn.classList.toggle('on',!!igState.statsOpen);r.statBtn.setAttribute('aria-expanded',String(!!igState.statsOpen));
  if(igState.statsOpen)for(const x of statsOf(sel))igPut(r.st[x.key].lastChild,x.value);
 }else{
  const on=igSwOn('dummy');
  r.offsw.classList.toggle('on',on);r.offsw.setAttribute('aria-checked',String(on));

  igPut(r.offText,on?t('Второй бот включится при следующем запуске.'):t('Второй бот выключен. Его настройки сохранены.'));
 }
 igRenderNear(bots,sel);
 for(const [key] of IG_SW){const on=igSwOn(key);const sw=r.sw[key];sw.classList.toggle('on',on);sw.setAttribute('aria-checked',String(on))}
 const lag=lagHint(lastStatus);r.lag.hidden=!lag;
 if(lag){igPut(r.lag,t('бот не успевает'));r.lag.title=IG_LAG[lag.kind]+'\n'+t('Снимок считается {ms} мс из 40, пропущено {n} в секунду',{ms:lag.ms,n:lag.n})}
 for(const [key] of IG_SW)r.sw[key].parentElement.classList.toggle('warn',!!lag&&IG_LAG_SW[lag.kind]===key);
 igState.moreBtn.classList.toggle('on',view.paused());
 if(igState.more.isOpen())igState.more.sync();
 if(r.all.isOpen())r.all.refresh();
 if(igState.skinDd&&igState.skinDd.isOpen())igState.skinDd.refresh();
}
function igFrame(){
 if(!IGRA||!igState.r)return;
 const now=performance.now();

 if(now-igState.at<250&&!igState.retry)return;
 igState.at=now;igState.retry=false;igRender();
}

if(embedded&&!STREAM){
 document.documentElement.dataset.pv=PVIEW;
 const pane={game:'game',clips:'clips',settings:'cfg'}[PVIEW];
 for(const p of document.querySelectorAll('[data-pane]'))p.hidden=p.dataset.pane!==pane;
 if(PVIEW==='clips')pullClips();
 if(PVIEW==='settings'){pullConfig();pullKnobs();pullLaunch();pullAutoChat()}
}
if(IGRA){try{igInit()}catch(err){console.error(err)}setInterval(()=>{if(!document.hidden)pullLaunch()},5000)}
