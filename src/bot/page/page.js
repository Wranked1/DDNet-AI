{const mini=()=>{try{document.documentElement.classList.toggle('mini',/[?&]view=mini(&|$)/.test(location.search)||location.hash==='#mini')}catch{}};mini();try{addEventListener('hashchange',mini)}catch{}}

const embedded=(()=>{try{return window.self!==window.top}catch{return true}})();
if(embedded)document.documentElement.classList.add('embedded');
const $=(s)=>document.querySelector(s);
let stick=true,lastStatus=null,lastVersion='',boot='',logKey='';
let map=null,mapName='',frame=null,prevFrame=null,view=null,dataFound=false;
let lines=[],chatOpen=false,chatSeen=-1,boardHeld=false;
let ac=null,muted=true;
let relations={war:[],friend:[],ignore:[]},playersKey='',playersShown=[];
const snd={},hist=[],seenAt=new Map();let hix=-1;
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
 b.addEventListener('click',()=>{$('#i').value=b.dataset.cmd;$('#f').requestSubmit()});
}

{
 const bar=$('#langbar');
 if(bar&&(embedded||/[?&]lang=/.test(location.search)))bar.hidden=true;
 for(const b of document.querySelectorAll('[data-lang]')){
  b.className='ghost'+(b.dataset.lang===LANG?' on':'');
  b.addEventListener('click',async()=>{if(b.dataset.lang===LANG)return;await botCmd('!lang '+b.dataset.lang);location.reload()});
 }
}

async function botCmd(v){try{await fetch('/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:v})})}catch{}}
$('#emo').addEventListener('change',()=>{const v=$('#emo').value;if(v)botCmd('!emote '+v);$('#emo').value=''});
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
function human(n){return n>1048576?t('{n} МБ',{n:(n/1048576).toFixed(1)}):t('{n} КБ',{n:(n/1024).toFixed(0)})}

let clipList=[],clipName='',clip=null,clipFrames=[],clipAt=0,clipPlaying=false,clipTimer=0,view2=null;
const CLIP_KINDS={'self-freeze':t('сам замёрз'),'chased-into-freeze':t('загнали во фриз'),'slow-rehook':t('долго не мог зацепить'),'manual':t('вручную')};
function clipTitle(name){const m=name.match(/^([a-z]+(?:-[a-z]+)*)-\d/);return m&&CLIP_KINDS[m[1]]?CLIP_KINDS[m[1]]:name.replace(/\.json$/,'')}
async function pullClips(){
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
  (p?' · '+t('план: свой фриз {self}, фриз соперника {enemy}, вариантов {n}',{self:p.selfOut??'—',enemy:p.enemyOut??'—',n:p.candidates??'—'}):'');
}
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
async function pullConfig(){
 try{const c=await(await fetch('/api/config')).json();
  const st=lastStatus||{};
  $('#info').innerHTML=[
   cell(t('Сервер'),esc(st.server||'—')),cell(t('Состояние'),st.phase==='online'?t('в игре'):esc(st.offlineReason||st.phase||'—')),
   cell(t('Имя'),esc(st.name||'—')),cell(t('Карта'),esc(c.map||'—')),
   cell(t('Мозг'),esc(st.brain||'—')),cell(t('Режим'),st.acting?esc(st.mode||'—'):t('стоит')),
   cell(t('Версия'),esc((lastVersion||'').slice(0,7)||'—')),cell(t('Ловушек'),t('{n} тайлов',{n:c.traps||0})),
   cell(t('Память'),c.memory?t('{n} заморозок',{n:c.memory.events}):t('выключена'))
  ].join('');
 }catch{}
}
async function pullLaunch(){
 try{const l=await(await fetch('/api/launch')).json();
  for(const k of ['server','name','clan','skin','ddnetData'])if($('#s_'+k))$('#s_'+k).value=l[k]||'';
  if($('#s_ddnetData')&&!l.ddnetData)$('#s_ddnetData').placeholder=l.ddnetDataFound?t('найдено: {dir}',{dir:l.ddnetDataFound}):t('не нашёл: впиши путь к папке data');
  if($('#s_skinDownload'))$('#s_skinDownload').checked=l.skinDownload!=='off';
  if($('#s_gfx'))$('#s_gfx').textContent=(l.ddnetDataNote?tr(l.ddnetDataNote)+(l.ddnetDataFound?t('; нашёл сам: {dir}',{dir:l.ddnetDataFound}):'')+'. ':'')+(l.ddnetGraphics?t('графика DDNet найдена'):t('графики DDNet нет, рисую своей'));
  loadAssets(l);
 }catch{}
}

pullLaunch();
async function saveLaunch(){
 const body={};for(const k of ['server','name','clan','skin','ddnetData'])if($('#s_'+k))body[k]=$('#s_'+k).value.trim();
 if($('#s_skinDownload'))body.skinDownload=$('#s_skinDownload').checked?'on':'off';
 try{const r=await(await fetch('/api/launch',{method:'POST',body:JSON.stringify(body)})).json();
  const said=r.reply?tr(r.reply):t('сохранено');
  $('#s_note').textContent=said;if($('#s_gfx'))$('#s_gfx').textContent=said;}catch{$('#s_note').textContent=t('не сохранилось')}
 pullLaunch();
}
$('#s_save').addEventListener('click',saveLaunch);
if($('#s_save2'))$('#s_save2').addEventListener('click',saveLaunch);
async function pullKnobs(){
 try{const list=await(await fetch('/api/knobs')).json();
  $('#knobs').innerHTML='<tr><th>'+t('настройка')+'</th><th>'+t('сейчас')+'</th><th>'+t('по умолчанию')+'</th></tr>'+
   list.map((k)=>'<tr class="'+(k.changed?'changed':'')+'"><td>'+esc(k.key)+'</td><td><input data-knob="'+esc(k.key)+'" value="'+esc(String(k.value))+'"></td><td class="num" style="color:var(--dim)">'+esc(String(k.def))+'</td></tr>').join('');
  for(const inp of document.querySelectorAll('[data-knob]')){
   inp.addEventListener('change',async()=>{
    const key=inp.dataset.knob;const v=inp.value.trim();
    try{await fetch('/api/knobs',{method:'POST',body:JSON.stringify({key,value:v===''?undefined:v})});}catch{}
    pullKnobs();
   });
  }
 }catch{}
}
$('#tsound').addEventListener('click',()=>{muted=!muted;$('#tsound').className='ghost'+(muted?'':' on');if(!muted)beep(600,70,0.12)});
muted=true;
$('#log').addEventListener('scroll',()=>{const e=$('#log');stick=e.scrollTop+e.clientHeight>=e.scrollHeight-24});
function cell(k,v){return '<div><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'}
function esc(s){return String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function tick(){
 let d;try{d=await(await fetch('/api')).json()}catch{return}
 if(!d||!d.status)return;

 if(d.boot&&d.boot!==boot){if(boot!==''){seenAt.clear();voteSeen=0;chatSeen=-1;logKey=''}boot=d.boot}
 const s=d.status,on=s.phase==='online';lastStatus=s;lastVersion=d.version||'';
 $('#dot').className='dot '+(on?'on':s.phase==='connecting'?'':'off');
 $('#head').textContent=s.name+' — '+(on?s.server:(s.offlineReason||s.phase));
 const ver=d.version?t('версия {v}',{v:d.version.slice(0,7)}):t('версия неизвестна');
 $('#ver').textContent=ver;
 if($('#footver'))$('#footver').textContent=ver+' · '+(s.server||'');
 const st=d.stats||'',get=(k)=>{const m=st.match(new RegExp(k+'=(\\S+)'));return m?esc(m[1]):'—'};
 $('#grid').innerHTML=[
  cell(t('Мозг'),get('brain')),cell(t('Оружие'),get('weapon')),cell(t('Настройка'),get('ab')),
  cell(t('Цель'),s.targetName?esc(s.targetName)+(s.targetDist!=null?' · '+s.targetDist+'px':''):'—'),
  cell(t('Режим'),s.acting?esc(s.mode):t('стоит')),cell(t('Во фризе'),s.frozen?t('да'):t('нет')),
  cell(t('Убил'),get('kills')),cell(t('Умер'),get('deaths')),cell(t('Сам /kill'),get('selfKills')),
  cell(t('Клипов'),get('clips')),cell(t('Хаммеров'),get('hammerFires')),cell(t('Хуков'),get('hooksFired'))
 ].join('');
 lines=d.lines||[];renderLog(false);renderChat();watchVotes();
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
 $('#log').innerHTML=rows.length?rows.map((l)=>'<div class="'+(isSys(l)?'sys':(cls[l.kind]||''))+'">'+(l.from?esc(fromOf(l))+': ':'')+esc(tx(l))+'</div>').join('')
  :'<div style="color:var(--dim)">'+t('под фильтр ничего не попало')+'</div>';
 if(stick)$('#log').scrollTop=$('#log').scrollHeight;
}

let tab={list:null,i:-1,head:'',word:''};
let cmdNames=[];fetch('/api/commands').then((r)=>r.json()).then((v)=>{cmdNames=v||[]}).catch(()=>{});
const chatField=$('#chatfield');
const promptFor=(v)=>v.startsWith('!')?t('Команда:'):t('Все:');
function openChat(pref){
 chatOpen=true;$('#chatin').hidden=false;$('#chatov').classList.add('open');
 if(pref!==undefined)chatField.value=pref;
 $('#chatprompt').textContent=promptFor(chatField.value);
 chatField.focus();renderChat(true);
}
function closeChat(){chatOpen=false;$('#chatin').hidden=true;$('#chatov').classList.remove('open');chatField.value='';$('#chattip').textContent='';chatField.blur();renderChat(true)}
document.addEventListener('keydown',(e)=>{
 const onField=document.activeElement&&document.activeElement.tagName==='INPUT'&&document.activeElement!==chatField;
 if(onField)return;
 if(!chatOpen&&(e.key==='F3'||e.key==='F4')){e.preventDefault();botCmd(e.key==='F3'?'!yes':'!no');return}

 const game=!document.querySelector('[data-pane=game]').hidden;
 if(game&&!chatOpen&&(e.key==='Enter'||e.key==='t')){e.preventDefault();openChat('')}
 else if(game&&!chatOpen&&e.key==='/'){e.preventDefault();openChat('!')}
 else if(chatOpen&&e.key==='Escape'){e.preventDefault();closeChat()}
});
chatField.addEventListener('input',()=>{
 $('#chatprompt').textContent=promptFor(chatField.value);
 $('#chattip').textContent='';
 tab={list:null,i:-1,head:'',word:''};
});
chatField.addEventListener('keydown',async(e)=>{
 if(e.key==='Tab'){

  e.preventDefault();
  const v=chatField.value;
  if(tab.list===null){
   const m=v.match(/(\S*)$/);const word=m?m[1]:'';
   const isCmd=word.startsWith('!');
   if(!isCmd&&word.length===0){$('#chattip').textContent=t('наберите начало ника');return}
   const fr=view?view.latest():null;
   const pool=isCmd?cmdNames.map((c)=>'!'+c)
    :(fr?((fr.players&&fr.players.length?fr.players:fr.tees).map((p)=>p.name).filter(Boolean)):[]);
   const low=word.toLowerCase();
   let hits=pool.filter((c)=>c.toLowerCase().startsWith(low));
   if(!hits.length&&!isCmd&&word.length>=2)hits=pool.filter((c)=>c.toLowerCase().includes(low));
   if(!hits.length){$('#chattip').textContent=isCmd?t('нет такой команды'):t('никого с таким ником');return}
   tab={list:hits,i:-1,head:v.slice(0,v.length-word.length),word};
  }
  tab.i=(tab.i+(e.shiftKey?-1:1)+tab.list.length)%tab.list.length;
  chatField.value=tab.head+tab.list[tab.i]+(tab.list.length===1?' ':'');
  $('#chattip').textContent=tab.list.length>1?t('{i} из {n} · Tab дальше',{i:tab.i+1,n:tab.list.length}):'';
  if(tab.list.length===1)tab={list:null,i:-1,head:'',word:''};
  return;
 }
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

let chatDrawnSeq=-1,chatDrawnOpen=false,lastCmdAt=0,chatIconsMissing=false;

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

 const shown=lines.filter((l)=>l.kind==='chat'||l.kind==='whisper'||(l.kind==='log'&&Date.now()-lastCmdAt<10000&&(seenAt.get(l.seq)||0)>=lastCmdAt-500));
 const rows=shown.slice(chatOpen?-14:-9);
 const anyFading=rows.some((l)=>{const a=now-(seenAt.get(l.seq)||0);return a>15000&&a<18000});
 if(!force&&last===chatDrawnSeq&&chatOpen===chatDrawnOpen&&!anyFading&&!chatIconsMissing)return;
 chatDrawnSeq=last;chatDrawnOpen=chatOpen;chatIconsMissing=false;
 const box=$('#chatlines');
 box.innerHTML=rows.map((l)=>{
  const age=now-(seenAt.get(l.seq)||now);
  const op=chatOpen?1:age<16000?1:age<17000?1-(age-16000)/1000:0;
  if(op<=0)return '';
  let cls=l.kind==='whisper'?'wsp':l.kind==='log'?'me':'';
  let text=l.kind==='log'?tr(l.text||''):(l.text||'');
  if(isSys(l))return '<div class="sys" style="opacity:'+op.toFixed(2)+'">*** '+esc(text)+'</div>';
  if(l.kind==='chat'&&text.startsWith('(team) ')){cls='team';text=text.slice(7)}
  if(l.kind==='chat'&&text.startsWith('*')){cls='hl';text=text.slice(1)}
  let icon='';
  const who=l.from?looksByName(l.from):null;
  if(who&&view&&view.teeIcon){icon=view.teeIcon(who,32);if(icon===null)chatIconsMissing=true}
  return '<div class="'+cls+'" style="opacity:'+op.toFixed(2)+'">'+(icon?'<img class="tee" alt="" src="'+icon+'">':'')+(l.from?'<b>'+esc(l.from)+'</b>: ':'')+esc(text)+'</div>';
 }).join('');

 try{const top=box.getBoundingClientRect().top;while(box.firstElementChild&&box.firstElementChild.getBoundingClientRect().top<top-0.5)box.removeChild(box.firstElementChild)}catch{}
}

$('#i').addEventListener('keydown',(e)=>{
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
$('#zoom').addEventListener('input',()=>{view.setZoom(100/Number($('#zoom').value))});
function setFollow(on){view.follow(on);$('#follow').className='ghost'+(on?' on':'')}
$('#follow').addEventListener('click',()=>{view.spectate(-1);$('#spec').value='-1';setFollow(true)});
$('#spec').addEventListener('change',()=>{view.spectate(Number($('#spec').value));setFollow(true)});
$('#whole').addEventListener('click',()=>{if(!view.fit())return;setFollow(false);$('#zoom').value=zoomToSlider(view.zoom())});
$('#tmode').addEventListener('click',()=>{const next={map:'ent',ent:'both',both:'map'}[view.mode()];view.setMode(next);$('#tmode').textContent=modeNames[next];$('#tmode').className='ghost'+(next!=='map'?' on':'')});
for(const [id,key] of [['#troute','route'],['#ttraps','traps'],['#tnames','names'],['#tcursor','cursor'],['#tboard','board']]){
 $(id).addEventListener('click',()=>{const on=view.toggle(key);$(id).className='ghost'+(on?' on':'')});
}
let drag=null,moved=0;
cv.addEventListener('pointerdown',(e)=>{drag={x:e.clientX,y:e.clientY};moved=0;cv.className='drag';try{cv.setPointerCapture(e.pointerId)}catch{}});
cv.addEventListener('pointermove',(e)=>{if(!drag)return;moved+=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y);
 if(moved>4){view.pan(e.clientX-drag.x,e.clientY-drag.y);$('#follow').className='ghost'}drag={x:e.clientX,y:e.clientY}});
cv.addEventListener('pointerup',(e)=>{

 if(drag&&moved<=4){const r=cv.getBoundingClientRect();const id=view.pick(e.clientX-r.left,e.clientY-r.top);
  if(id>=0){const fr=view.latest();const self=fr?fr.selfId:-1;view.spectate(id===self?-1:id);$('#spec').value=String(id===self?-1:id);setFollow(true)}}
 drag=null;cv.className=''});
cv.addEventListener('wheel',(e)=>{e.preventDefault();view.zoomBy(e.deltaY<0?1/1.1:1.1);$('#zoom').value=zoomToSlider(view.zoom())},{passive:false});
document.addEventListener('keydown',(e)=>{if(e.key==='Tab'&&!chatOpen){e.preventDefault();if(!boardHeld){boardHeld=true;view.toggle('board',true)}}});
document.addEventListener('keyup',(e)=>{if(e.key==='Tab'&&boardHeld){boardHeld=false;view.toggle('board',$('#tboard').className.includes('on'))}});
let lastInfo=0;
function info(i){
 const now=performance.now();if(now-lastInfo<250)return;lastInfo=now;
 const age=frame?Math.round(now-(frame._at||now)):0;
 const live=frame?t('тик {tick} · ти {n} · {state}',{tick:frame.tick,n:frame.tees.length,state:age>1500?t('нет данных'):t('живое')}):t('нет данных');
 if($('#vinfo2'))$('#vinfo2').textContent=live+' · '+i.fps+' FPS · '+t('масштаб {z}%',{z:Math.round(100/i.zoom)});
 if($('#legend'))$('#legend').style.display=i.own?'':'none';
}
async function pullMap(name){
 try{const m=await(await fetch('/api/map')).json();if(!m)return;
  const raw=atob(m.kinds),k=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)k[i]=raw.charCodeAt(i);
  m.k=k;
  if(m.traps){const traps=atob(m.traps),tk=new Uint8Array(traps.length);for(let i=0;i<traps.length;i++)tk[i]=traps.charCodeAt(i);m.t=tk;}
  map=m;mapName=name;view.setLiveMap(m);view.loadScene(name);}catch{}
}

function loadAudio(key,names){
 for(const n of names){
  const a=new Audio('/assets/audio/'+n);
  a.volume=0.9;
  a.addEventListener('canplaythrough',()=>{if(!snd[key])snd[key]=a},{once:true});
 }
}
let dataAsked=false;
function loadAssets(launch){
 if(!launch)return;
 const found=!!launch.ddnetGraphics;
 if(found!==dataFound||!dataAsked){dataAsked=true;dataFound=found;view.loadData(found);if(found&&mapName)view.loadScene(mapName)}
 if(!launch.ddnetData&&!launch.ddnetDataFound)return;
 if(snd.loaded)return;snd.loaded=true;
 loadAudio('hook',['hook_attach-01.wav','hook_attach-02.wav','hook_loop-01.wav']);
 loadAudio('freeze',['player_pain_short-01.wav','hit-01.wav']);
 loadAudio('thaw',['player_spawn-01.wav','pickup_armor-01.wav']);
}
function play(key,freq,ms,vol){
 if(muted)return;
 const a=snd[key];
 if(a&&a.play){try{a.currentTime=0;void a.play();return}catch{}}
 beep(freq,ms,vol);
}
function beep(freq,ms,vol){
 if(muted)return;
 try{ac=ac||new (window.AudioContext||window.webkitAudioContext)();
  const o=ac.createOscillator(),g=ac.createGain();
  o.type='sine';o.frequency.value=freq;g.gain.value=vol;
  o.connect(g);g.connect(ac.destination);o.start();
  g.gain.exponentialRampToValueAtTime(0.0001,ac.currentTime+ms/1000);
  o.stop(ac.currentTime+ms/1000);}catch{}
}
function sounds(old,next){
 if(!old||!next||!old.tees||!next.tees)return;
 const a=old.tees.find((p)=>p.id===old.selfId),b=next.tees.find((p)=>p.id===next.selfId);
 if(!a||!b)return;
 if(!a.frozen&&b.frozen)play('freeze',160,240,0.16);
 if(a.frozen&&!b.frozen)play('thaw',520,110,0.13);
 if(a.hook<5&&b.hook>=5)play('hook',760,70,0.11);
}

const onList=(list,name)=>{const n=String(name||'').toLowerCase();return n!==''&&(relations[list]||[]).some((x)=>{const k=String(x).toLowerCase();return k!==''&&(n===k||n.includes(k)||k.includes(n))})};
async function pullRelations(){try{const r=await(await fetch('/api/relations')).json();if(r&&typeof r==='object')relations=r}catch{}playersKey=''}
const REL=[['friend',t('тима'),t('Свои: бот их не трогает')],['war',t('вар'),t('Бот бьёт их всегда')],['ignore',t('игнор'),t('Бот не трогает их и не отвечает им')]];
function renderPlayers(f){
 if(!f)return;
 const list=(f.players&&f.players.length?f.players:f.tees).filter((p)=>p.id!==f.selfId&&p.name);
 const key=list.map((p)=>p.id+':'+p.name+':'+(p.clan||'')).join('|')+'#'+JSON.stringify(relations);
 if(key===playersKey)return;playersKey=key;playersShown=list;
 if($('#pcount'))$('#pcount').textContent=list.length?'· '+list.length:'';
 $('#plist').innerHTML=list.length?list.map((p,i)=>{
  const mark=REL.map(([k])=>k).find((k)=>onList(k,p.name))||'';
  const icon=view&&view.teeIcon?view.teeIcon(p,32):null;
  return '<div class="prow '+mark+'"><span class="pname" title="'+esc(p.name+(p.clan?' ['+p.clan+']':''))+'">'+(icon?'<img alt="" src="'+icon+'">':'')+esc(p.name)+(p.clan?'<small>'+esc(p.clan)+'</small>':'')+'</span>'+
   REL.map(([k,label,title])=>'<button type="button" class="'+(onList(k,p.name)?'on':'')+'" data-rel="'+k+'" data-i="'+i+'" title="'+esc(title)+'">'+esc(label)+'</button>').join('')+
   '<button type="button" data-follow data-i="'+i+'" title="'+esc(t('Следить за ним'))+'">&#128065;</button></div>';
 }).join(''):'<div class="none">'+t('никого, кроме бота')+'</div>';
 if(list.length&&view&&view.teeIcon&&list.some((p)=>view.teeIcon(p,32)===null))playersKey='';
}
$('#plist').addEventListener('click',async(e)=>{
 const b=e.target.closest('button');if(!b)return;
 const p=playersShown[Number(b.dataset.i)];if(!p)return;
 if(b.dataset.rel){
  const on=!onList(b.dataset.rel,p.name);
  try{const r=await(await fetch('/api/relation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({list:b.dataset.rel,name:p.name,on})})).json();if(r&&r.lists)relations=r.lists}catch{}
  playersKey='';renderPlayers(frame);return;
 }
 if(b.dataset.follow!==undefined){view.spectate(p.id);$('#spec').value=String(p.id);setFollow(true)}
});
pullRelations();setInterval(pullRelations,5000);

let specKey='';
function fillSpec(f){
 const list=(f.players&&f.players.length?f.players:f.tees).filter((p)=>p.id!==f.selfId);
 const key=list.map((p)=>p.id+':'+p.name).join('|');if(key===specKey)return;specKey=key;
 const cur=$('#spec').value;
 $('#spec').innerHTML='<option value="-1">'+t('за ботом')+'</option>'+list.map((p)=>'<option value="'+p.id+'">'+esc(p.name||('#'+p.id))+'</option>').join('');
 $('#spec').value=list.some((p)=>String(p.id)===cur)?cur:'-1';
 if($('#spec').value==='-1'&&view.spec()>=0&&!list.some((p)=>p.id===view.spec()))view.spectate(-1);
}
let pulling=false;
async function pullFrame(){
 if(document.hidden||pulling)return;
 pulling=true;
 try{const f=await(await fetch('/api/live')).json();
  if(f&&f.tees){
   f._at=performance.now();
   prevFrame=frame;sounds(frame,f);frame=f;view.pushFrame(f);fillSpec(f);renderPlayers(f);
   if(f.map&&f.map!==mapName)await pullMap(f.map);
   if(f.doing)$('#doing').textContent=t('сейчас: {what}',{what:tr(f.doing)});
  }
 }catch{}
 pulling=false;
}
function loop(){
 try{view.draw()}catch(err){console.error(err)}
 if(view2&&clipsShown()){try{view2.draw()}catch(err){console.error(err)}}
 requestAnimationFrame(loop);
}
setInterval(pullFrame,40);pullFrame();requestAnimationFrame(loop);
