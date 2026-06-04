/**
 * app.js — Japanese Reading Assistant PWA v2
 *
 * Tabs: 0=Discover 1=Reading 2=Analysis 3=Saved(Lists) 4=Review(Flashcards)
 * New: homepage content feed, organized word lists, SRS flashcards, TTS
 */
const $ = id => document.getElementById(id);
const QA = sel => document.querySelectorAll(sel);

// ── DOM refs ─────────────────────────────────────────────────────────────
const dom={};
(function(){
  const ids=[
    // Tabs,panels
    'discoverPanel','readingPanel','analysisPanel','savedPanel','reviewPanel',
    // Discover
    'discoverSearch','nhkFeed','btnRefreshFeed','feedList','listOverview','btnNewList',
    'quickImport','btnQuickImport',
    // Reading
    'textInput','urlInput','btnFetch','btnPaste','btnAnnotate','btnSpeakAll','jlptSlider','jlptLabel','readingView',
    // Analysis
    'analysisView',
    // Saved
    'listSelector','savedView','btnRenameList','btnDeleteList',
    // Review
    'reviewSetup','reviewListSelect','reviewStats','btnStartReview',
    'flashcard','cardFront','cardBack','cardWord','cardReading',
    'cardBackWord','cardBackReading','cardPos','cardDef','cardEx',
    'cardConj',
    'cardActions','reviewProgress','btnEndReview',
    // Sheet
    'sheetOverlay','wordSheet','sheetWord','sheetReading','sheetTags','sheetDef','sheetEx',
    'sheetGNote','btnSaveWord','sheetListSelect','btnSheetSpeak',
    'sheetRoleSec','sheetRole','sheetConjugSec','sheetConjug','sheetUsageSec',
    // Settings
    'btnSettings','settingsOverlay','settingsPanel','settingsApiKey','settingsJlpt',
    'settingsJlptVal','settingsClose',
    'lyrFurigana','lyrRomaji','lyrPos','lyrVerb','lyrEtym','lyrGrammar','lyrSegments',
    'btnDark','toast',
  ];
  ids.forEach(id=>{dom[id]=$(id)});
  dom.tabBtns=QA('.tab-btn');
  dom.tabPanels=QA('.tab-panel');
})();

// ── State ─────────────────────────────────────────────────────────────────
const DEFAULTS={
  apiKey:'sk-d61051857c334e498a9d0dff3b78ed76',jlptLevel:3,
  layers:{furigana:true,romaji:false,pos:true,verb:false,etym:false,grammar:true,segments:true},
  darkTheme:false,wordLists:[{name:'默认',words:[]}],activeListIdx:0,
  reviewQueue:[],reviewIdx:0,
};

let state={...DEFAULTS,text:'',annotatedHTML:'',analysis:null,_currentWord:null};
state.wordLists=structuredClone(DEFAULTS.wordLists);

// ── Persistence ─────────────────────────────────────────────────────────
function loadState(){
  try{
    const r=localStorage.getItem('jra-state');
    if(r){const s=JSON.parse(r);state.apiKey=s.apiKey||DEFAULTS.apiKey;state.jlptLevel=s.jlptLevel||3;state.layers={...DEFAULTS.layers,...(s.layers||{})};state.darkTheme=!!s.darkTheme;state.activeListIdx=s.activeListIdx||0}
    const wl=localStorage.getItem('jra-wordlists');
    if(wl)state.wordLists=JSON.parse(wl);
    state.wordLists=state.wordLists||structuredClone(DEFAULTS.wordLists);
  }catch{state.wordLists=structuredClone(DEFAULTS.wordLists)}
}
function saveState(){
  try{localStorage.setItem('jra-state',JSON.stringify({apiKey:state.apiKey,jlptLevel:state.jlptLevel,layers:state.layers,darkTheme:state.darkTheme,activeListIdx:state.activeListIdx}))}catch{}
}
function saveWordLists(){
  try{localStorage.setItem('jra-wordlists',JSON.stringify(state.wordLists))}catch{}
}
function activeList(){return state.wordLists[state.activeListIdx]||state.wordLists[0]}
function allWords(){let r=[];for(const l of state.wordLists)r=r.concat(l.words.map(w=>({...w,listName:l.name})));return r}

// ── Toast ───────────────────────────────────────────────────────────────
let toastTimer;
function toast(m){dom.toast.textContent=m;dom.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>dom.toast.classList.remove('show'),2000)}

// ── TTS ─────────────────────────────────────────────────────────────────
let speaking=false;
function speak(text,rate=0.9,el=null){
  if(!text)return;
  // Toggle: stop if already speaking same text
  if(speaking){speechSynthesis.cancel();speaking=false;if(el)el.classList.remove('speaking');return}
  const u=new SpeechSynthesisUtterance(text);
  u.lang='ja-JP';u.rate=rate;
  const voices=speechSynthesis.getVoices();
  const jp=voices.find(v=>v.lang.startsWith('ja'));if(jp)u.voice=jp;
  u.onend=()=>{speaking=false;if(el)el.classList.remove('speaking');};
  u.onerror=()=>{speaking=false;if(el)el.classList.remove('speaking');};
  speaking=true;if(el)el.classList.add('speaking');
  speechSynthesis.speak(u);
}
function speakWord(){const w=state._currentWord;if(w)speak(w.word,0.9)}

// ── Tab switching ───────────────────────────────────────────────────────
function switchTab(idx){
  dom.tabBtns.forEach((b,i)=>b.classList.toggle('active',i===idx));
  dom.tabPanels.forEach((p,i)=>p.classList.toggle('active',i===idx));
  if(idx===0)refreshDiscoverPage();
  if(idx===3)renderListSelector();
  if(idx===4)renderReviewSetup();
}
dom.tabBtns.forEach((b,i)=>b.addEventListener('click',()=>switchTab(i)));

// ═══════════════════════════════════════════════════════════════════════
// TAB 0: DISCOVER
// ═══════════════════════════════════════════════════════════════════════

const NHK_FEED=[
  {title:'「拉致」問題',desc:'北朝鮮による日本人拉致問題。政府は被害者の早期帰国を目指している。',date:'2025-05-30',tags:['社会']},
  {title:'食品ロスを減らそう',desc:'日本では年間約500万トンの食品が廃棄されている。家庭での対策が重要だ。',date:'2025-05-28',tags:['社会']},
  {title:'熱中症に注意',desc:'夏の暑さによる熱中症で、毎年多くの人が病院に運ばれている。水分補給が大切。',date:'2025-05-25',tags:['生活']},
  {title:'国会で法案審議',desc:'新しい法律について国会で議論が行われている。野党は修正を求めている。',date:'2025-05-22',tags:['政治']},
  {title:'円安が進む',desc:'外国為替市場で円安が進み、輸入品の価格が上昇している。家計への影響が懸念される。',date:'2025-05-20',tags:['経済']},
  {title:'人工知能の活用',desc:'AI技術の発展により、様々な分野で人工知能の活用が進んでいる。',date:'2025-05-18',tags:['科学']},
  {title:'大きな地震に備える',desc:'日本は地震が多い国だ。防災グッズの準備や避難場所の確認が大切。',date:'2025-05-15',tags:['社会']},
  {title:'新しいワクチン開発',desc:'感染症から人々を守るため、新しいワクチンの研究が進められている。',date:'2025-05-12',tags:['医療']},
];

async function fetchNHKFeed(){
  // Show static feed immediately, replace with live if fetch succeeds
  renderStaticFeed();
  if(!state.apiKey||!state.apiKey.startsWith('sk-'))return;
  try{
    const proxy='https://api.allorigins.win/raw?url='+encodeURIComponent('https://www3.nhk.or.jp/news/easy/');
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),8000);
    const resp=await fetch(proxy,{signal:ctrl.signal});clearTimeout(t);
    if(!resp.ok)throw new Error('fail');
    const html=await resp.text();
    const doc=new DOMParser().parseFromString(html,'text/html');
    const items=[];
    doc.querySelectorAll('.news-list__item a,.article-list__item a,article a[href]').forEach(a=>{
      const title=a.textContent.trim();const href=a.getAttribute('href');
      if(title.length>3&&title.length<100&&href)items.push({title,date:'',tags:[],url:href.startsWith('http')?href:'https://www3.nhk.or.jp'+href});
    });
    if(items.length>=3){renderFeedCards(items.slice(0,15));return}
    throw new Error('parse fail');
  }catch(e){
    renderStaticFeed();
  }
}

function renderStaticFeed(){
  dom.feedList.innerHTML=NHK_FEED.map((a,i)=>`
    <div class="article-card" data-desc="${ESC(a.desc||'')}" data-title="${ESC(a.title)}">
      <div class="art-title">${ESC(a.title)}</div>
      <div class="art-desc">${ESC(a.desc||'')}</div>
      <div class="art-meta"><span>${a.date}</span>${a.tags.map(t=>`<span class="art-tag">${t}</span>`).join('')}</div>
    </div>
  `).join('');
  bindFeedClicks();
}

function renderFeedCards(items){
  dom.feedList.innerHTML=items.map(a=>`
    <div class="article-card" data-title="${ESC(a.title)}" data-url="${ESC(a.url||'')}">
      <div class="art-title">${ESC(a.title)}</div>
      <div class="art-meta"><span>NHK Easy</span></div>
    </div>
  `).join('');
  bindFeedClicks();
}

function bindFeedClicks(){
  dom.feedList.querySelectorAll('.article-card').forEach(card=>{
    card.addEventListener('click',async()=>{
      const title=card.dataset.title,url=card.dataset.url;
      if(url){
        dom.urlInput.value=url;
        dom.btnFetch.click();
      }else{
        // Static articles: use description as reading material
        const desc=card.dataset.desc||title;
        dom.textInput.value=desc;
        dom.btnAnnotate.click();
      }
      switchTab(1);
    });
  });
}

let _nhkFetchTimer=null;
function refreshDiscoverPage(){
  renderListOverview();
  renderStaticFeed();
  // Debounced live fetch
  clearTimeout(_nhkFetchTimer);
  _nhkFetchTimer=setTimeout(()=>fetchNHKFeed(),500);
}

function renderListOverview(){
  const html=state.wordLists.map((l,i)=>`
    <div class="list-ov-card" data-idx="${i}">
      <span class="list-ov-name">${ESC(l.name)}</span>
      <span class="list-ov-count">${l.words.length} 词</span>
    </div>
  `).join('');
  dom.listOverview.innerHTML=html||'<div style="padding:10px;color:var(--text3);font-size:12px">暂无词单</div>';
  dom.listOverview.querySelectorAll('.list-ov-card').forEach(c=>{
    c.addEventListener('click',()=>{state.activeListIdx=parseInt(c.dataset.idx);saveState();switchTab(3)});
  });
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 1: READING (+ TAB 2: ANALYSIS)
// ═══════════════════════════════════════════════════════════════════════

async function doAnnotate(){
  const text=dom.textInput.value.trim();
  if(!text){toast('请输入日文文本');return}
  if(!state.apiKey||!state.apiKey.startsWith('sk-')){toast('请先设置 DeepSeek API Key');return}
  state.text=text;
  dom.btnAnnotate.disabled=true;dom.btnAnnotate.textContent='解析中…';
  dom.readingView.innerHTML='<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
  dom.analysisView.innerHTML='<div class="ana-empty">解析中…</div>';
  try{
    const lv=`N${state.jlptLevel}`;
    const wg=state.layers.grammar||state.layers.segments;
    const result=await JRApi.annotate(text,lv,state.apiKey,wg);
    const html=Renderer.render(text,result.words,result.structure,state.layers);
    state.annotatedHTML=html;
    dom.readingView.innerHTML=html;
    bindWordTaps();
    addSpeakButtons();
    toast(`标注 ${result.words.filter(w=>w.annotate).length} 词`);
    if(text.length<=800){doAnalyze(text).catch(()=>{})}
  }catch(e){
    dom.readingView.innerHTML=`<div style="color:var(--accent);font-size:14px">解析失败：${ESC(e.message)}</div>`;
    toast('解析失败: '+e.message);
  }finally{dom.btnAnnotate.disabled=false;dom.btnAnnotate.textContent='解析'}
}

function addSpeakButtons(){
  dom.readingView.querySelectorAll('.rw-word').forEach(el=>{
    if(el.querySelector('.rw-speak'))return;
    const btn=document.createElement('span');btn.className='rw-speak';
    btn.textContent='🔊';
    btn.addEventListener('click',e=>{e.stopPropagation();const s=el.dataset.surface||el.textContent.trim();speak(s,0.9,el)});
    el.appendChild(btn);
  });
}

dom.btnSpeakAll.addEventListener('click',()=>{
  const text=dom.textInput.value.trim()||state.text;
  if(speaking){speechSynthesis.cancel();speaking=false;dom.btnSpeakAll.textContent='🔊 朗读';dom.btnSpeakAll.style.color='';return}
  dom.btnSpeakAll.textContent='⏹ 停止';dom.btnSpeakAll.style.color='var(--accent)';
  speak(text,0.85);
  dom.btnSpeakAll._check=setInterval(()=>{if(!speaking){dom.btnSpeakAll.textContent='🔊 朗读';dom.btnSpeakAll.style.color='';clearInterval(dom.btnSpeakAll._check)}},300);
});

function bindWordTaps(){
  dom.readingView.querySelectorAll('.rw-word').forEach(el=>{
    el.addEventListener('click',e=>{e.stopPropagation();
      const s=el.dataset.surface||'',r=el.dataset.reading||'',p=el.dataset.pos||'';
      const g=el.dataset.grammar||'',bf=el.dataset.base||'';
      openSheet(s,r,p,g,'查询中…','','',bf,'',null);
      JRApi.lookup(s,r,state.text.slice(0,500),state.apiKey).then(res=>{
        if(res){
          updateSheet(res.pos||p,res.definition||'暂无释义',res.example||'',res.grammar_role||g,res.base_form||bf,res.grammar_role||g,res.conjugation||null,res.usage_note||null);
        } else {
          updateSheet(p,'暂无释义','',g,bf,g,null,null);
        }
      }).catch(()=>updateSheet(p,'查询失败','',g,bf,g,null,null));
    });
  });
}

async function doAnalyze(text){
  if(!text||!state.apiKey)return;
  dom.analysisView.innerHTML='<div class="ana-empty">AI 分析中…</div>';
  try{const r=await JRApi.analyze(text,state.apiKey);state.analysis=r;dom.analysisView.innerHTML=Renderer.buildAnalysis(text,r)}
  catch(e){dom.analysisView.innerHTML=`<div class="ana-empty">分析失败：${ESC(e.message)}</div>`}
}

// ── Article fetch (same as before) ────────────────────────────────────
const CORS_PROXIES=[
  u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),
  u=>'https://corsproxy.io/?'+encodeURIComponent(u),
  u=>'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u),
];
async function fetchHTML(url){
  let lastErr=null;
  for(const b of CORS_PROXIES){
    try{const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);const r=await fetch(b(url),{signal:c.signal});clearTimeout(t);if(!r.ok)throw new Error('HTTP '+r.status);const tx=await r.text();if(tx.length<200)throw new Error('empty');return tx}catch(e){lastErr=e}
  }
  throw lastErr||new Error('all proxies failed');
}
function extractText(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  'script,style,noscript,iframe,svg,nav,footer,aside,header,.ad,.advertisement,[class*="ad-"],.social,.share,.comment,.sidebar'.split(',').forEach(s=>{try{doc.querySelectorAll(s).forEach(e=>e.remove())}catch{}});
  const sels=['article','[role="main"]','main','.article-body','.article__body','.post-content','.entry-content','.article-content','.news-content','.story-body','#article-body','#main-content','#content-body','[itemprop="articleBody"]'];
  for(const sel of sels){try{const el=doc.querySelector(sel);if(el&&el.textContent.trim().length>100)return el.textContent.replace(/\s+/g,' ').trim().slice(0,3000)}catch{}}
  const ps=doc.querySelectorAll('p');const t=[...ps].map(p=>p.textContent.trim()).filter(t=>t.length>10).join('\n');
  return t.length>50?t.replace(/\s+/g,' ').trim().slice(0,3000):'';
}

dom.btnFetch.addEventListener('click',async()=>{
  const url=dom.urlInput.value.trim();if(!url){toast('请输入网址');return}if(!url.startsWith('http')){toast('请输入完整网址');return}
  dom.btnFetch.disabled=true;dom.btnFetch.textContent='获取中…';
  dom.readingView.innerHTML='<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
  try{const h=await fetchHTML(url);const t=extractText(h);if(!t||t.length<20)throw new Error('未提取到正文');dom.textInput.value=t.slice(0,3000);dom.urlInput.value=url;toast('已提取 '+t.length+' 字，解析...');await doAnnotate()}
  catch(e){dom.readingView.innerHTML=`<div style="color:var(--accent);font-size:14px;padding:10px">获取失败：${ESC(e.message)}</div>`;toast('获取失败: '+e.message)}
  finally{dom.btnFetch.disabled=false;dom.btnFetch.textContent='🔗 获取'}
});
dom.urlInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();dom.btnFetch.click()}});

// ═══════════════════════════════════════════════════════════════════════
// SHEET (word detail)
// ═══════════════════════════════════════════════════════════════════════

function openSheet(w,rd,pos,gr,def,ex,gn,bf,conj,unote){
  state._currentWord={word:w,reading:rd,pos,grammar:gr,def,example:ex,gnote:gn,baseForm:bf,conjugation:conj,usageNote:unote};
  dom.sheetWord.textContent=w;dom.sheetReading.textContent=rd||'';
  dom.sheetTags.innerHTML='';if(pos)dom.sheetTags.innerHTML+=`<span class="sheet-tag">${pos}</span>`;
  if(gr){const c=getGC(gr);dom.sheetTags.innerHTML+=`<span class="sheet-tag grammar" style="--tgc:${c}">${gr}</span>`}
  // Grammar role section
  if(gr){dom.sheetRole.textContent=gr;dom.sheetRoleSec.style.display=''}else{dom.sheetRoleSec.style.display='none'}
  // Definition
  dom.sheetDef.textContent=def||'查询中…';
  // Conjugation section
  if(conj||bf){dom.sheetConjug.innerHTML=(bf&&bf!==w?`<span class="base-tag">原形：${bf}</span>`:'')+(conj?`<span class="conj-tag">${conj}</span>`:'');dom.sheetConjugSec.style.display=''}else{dom.sheetConjugSec.style.display='none'}
  // Example
  dom.sheetEx.textContent=ex||'';
  // Usage note
  if(unote){dom.sheetGNote.textContent=unote;dom.sheetUsageSec.style.display=''}else{dom.sheetUsageSec.style.display='none'}
  dom.btnSaveWord.textContent='☆ 收藏';dom.btnSaveWord.classList.remove('saved');
  dom.sheetListSelect.innerHTML=state.wordLists.map((l,i)=>`<option value="${i}" ${i===state.activeListIdx?'selected':''}>${ESC(l.name)} (${l.words.length})</option>`).join('');
  dom.sheetOverlay.classList.add('open');dom.wordSheet.classList.add('open');
}
function updateSheet(pos,def,ex,gn,bf,gr,conj,unote){
  if(!state._currentWord)return;
  if(pos){dom.sheetTags.innerHTML='<span class="sheet-tag">'+pos+'</span>'+dom.sheetTags.innerHTML;state._currentWord.pos=pos}
  if(gr&&!state._currentWord.grammar){const c=getGC(gr);dom.sheetTags.innerHTML+=`<span class="sheet-tag grammar" style="--tgc:${c}">${gr}</span>`;dom.sheetRole.textContent=gr;dom.sheetRoleSec.style.display='';state._currentWord.grammar=gr}
  dom.sheetDef.textContent=def||'暂无释义';state._currentWord.def=def;
  dom.sheetEx.textContent=ex||'暂无例句';state._currentWord.example=ex;
  if(conj||bf){dom.sheetConjug.innerHTML=(bf&&bf!==state._currentWord.word?`<span class="base-tag">原形：${bf}</span>`:'')+(conj?`<span class="conj-tag">${conj}</span>`:'');dom.sheetConjugSec.style.display='';state._currentWord.baseForm=bf;state._currentWord.conjugation=conj}
  if(unote){dom.sheetGNote.textContent=unote;dom.sheetUsageSec.style.display='';state._currentWord.gnote=unote;state._currentWord.usageNote=unote}
}
function closeSheet(){dom.sheetOverlay.classList.remove('open');dom.wordSheet.classList.remove('open')}
function getGC(r){const m={'主語':'#2563eb','述語':'#d43d3d','目的語':'#059669','連体修飾語':'#7c3aed','連用修飾語':'#d97706','補語':'#0891b2','助詞':'#6b7280','接続詞':'#db2777'};return m[r]||'#888'}
dom.sheetOverlay.addEventListener('click',closeSheet);
dom.btnSheetSpeak.addEventListener('click',speakWord);

let ssY=0;
dom.wordSheet.addEventListener('touchstart',e=>{ssY=e.touches[0].clientY},{passive:true});
dom.wordSheet.addEventListener('touchmove',e=>{if(e.touches[0].clientY-ssY>80)closeSheet()},{passive:true});

// ═══════════════════════════════════════════════════════════════════════
// SAVE TO WORD LIST
// ═══════════════════════════════════════════════════════════════════════
dom.btnSaveWord.addEventListener('click',()=>{
  const w=state._currentWord;if(!w||dom.btnSaveWord.classList.contains('saved'))return;
  const li=parseInt(dom.sheetListSelect.value)||state.activeListIdx;
  const entry={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),surface:w.word,reading:w.reading,pos:w.pos,definition:w.def,example:w.example,grammar_note:w.gnote,conjugation:w.conjugation||null,usage_note:w.usageNote||null,ts:Date.now(),review:{next:Date.now(),interval:0,ef:2.5}}
  const list=state.wordLists[li];if(!list)return;
  if(list.words.find(s=>s.surface===entry.surface&&s.reading===entry.reading)){toast('已收藏过');return}
  list.words.push(entry);saveWordLists();
  dom.btnSaveWord.textContent='★ 已收藏';dom.btnSaveWord.classList.add('saved');
  renderListSelector();renderSavedWords();toast('已收藏到 "'+list.name+'"');
});

// ═══════════════════════════════════════════════════════════════════════
// TAB 3: SAVED / WORD LISTS
// ═══════════════════════════════════════════════════════════════════════

function renderListSelector(){
  dom.listSelector.innerHTML=state.wordLists.map((l,i)=>`<option value="${i}" ${i===state.activeListIdx?'selected':''}>${ESC(l.name)} (${l.words.length})</option>`).join('');
  renderSavedWords();
}
dom.listSelector.addEventListener('change',()=>{state.activeListIdx=parseInt(dom.listSelector.value);saveState();renderSavedWords()});

dom.btnNewList.addEventListener('click',()=>{
  const name=prompt('词单名称：');if(!name||!name.trim())return;
  state.wordLists.push({name:name.trim(),words:[]});state.activeListIdx=state.wordLists.length-1;
  saveWordLists();saveState();renderListSelector();renderListOverview();
});
dom.btnRenameList.addEventListener('click',()=>{
  const l=activeList();if(!l)return;const n=prompt('新名称：',l.name);if(!n||!n.trim())return;
  l.name=n.trim();saveWordLists();renderListSelector();renderListOverview();
});
dom.btnDeleteList.addEventListener('click',()=>{
  if(state.wordLists.length<=1){toast('至少保留一个词单');return}
  const l=activeList();if(!confirm('删除词单 "'+l.name+'"？'))return;
  state.wordLists.splice(state.activeListIdx,1);state.activeListIdx=Math.min(state.activeListIdx,state.wordLists.length-1);
  saveWordLists();saveState();renderListSelector();renderListOverview();
});

function renderSavedWords(){
  const list=activeList();if(!list||!list.words.length){dom.savedView.innerHTML='<div class="saved-empty">词单为空<br>在阅读中点击单词即可收藏</div>';return}
  dom.savedView.innerHTML='<div class="saved-list">'+list.words.map(w=>`
    <div class="saved-card" data-id="${w.id}">
      <button class="saved-del" data-id="${w.id}">✕</button>
      <div class="sw">${ESC(w.surface)}</div>
      <div class="sr">${ESC(w.reading||'')} · ${ESC(w.pos||'')}${w.conjugation?` · ${ESC(w.conjugation)}`:''}</div>
      <div class="sd">${ESC(w.definition||'')}</div>
    </div>
  `).join('')+'</div>';
  dom.savedView.querySelectorAll('.saved-card').forEach(c=>c.addEventListener('click',e=>{
    if(e.target.classList.contains('saved-del'))return;const id=c.dataset.id;
    const w=list.words.find(s=>s.id===id);
    if(w)openSheet(w.surface,w.reading,w.pos,w.grammar_note,w.definition,w.example||'',w.grammar_note||'','');
  }));
  dom.savedView.querySelectorAll('.saved-del').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();const id=b.dataset.id;
    list.words=list.words.filter(s=>s.id!==id);
    saveWordLists();renderSavedWords();renderListSelector();renderListOverview();
    toast('已删除');
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// TAB 4: FLASHCARDS (simple SRS)
// ═══════════════════════════════════════════════════════════════════════

function buildReviewQueue(list){
  const now=Date.now();
  const due=list.words.filter(w=>!w.review||w.review.next<=now);
  // Mix: due items first, then random sample of others
  const rest=list.words.filter(w=>w.review&&w.review.next>now).sort(()=>Math.random()-.5);
  return [...due,...rest];
}

function renderReviewSetup(){
  dom.reviewListSelect.innerHTML=state.wordLists.map((l,i)=>`<option value="${i}" ${i===state.activeListIdx?'selected':''}>${ESC(l.name)} (${l.words.length})</option>`).join('');
  const li=parseInt(dom.reviewListSelect.value)||0;
  const q=buildReviewQueue(state.wordLists[li]||state.wordLists[0]);
  dom.reviewStats.textContent=`共 ${q.length} 词，其中 ${q.filter(w=>!w.review||w.review.next<=Date.now()).length} 词待复习`;
}
dom.reviewListSelect.addEventListener('change',renderReviewSetup);

dom.btnStartReview.addEventListener('click',()=>{
  const li=parseInt(dom.reviewListSelect.value)||0;
  const list=state.wordLists[li];if(!list||!list.words.length){toast('该词单无单词');return}
  state.reviewQueue=buildReviewQueue(list);
  if(!state.reviewQueue.length){toast('没有需要复习的词');return}
  state.reviewIdx=0;
  dom.reviewSetup.style.display='none';dom.flashcard.style.display='';
  showCard();
});

function showCard(){
  const w=state.reviewQueue[state.reviewIdx];if(!w){endReview();return}
  dom.cardWord.textContent=w.surface;dom.cardReading.textContent=w.reading||'';
  dom.cardBackWord.textContent=w.surface;dom.cardBackReading.textContent=w.reading||'';
  dom.cardPos.textContent=w.pos||'';dom.cardConj.textContent=w.conjugation||w.grammar_note||'';
  dom.cardDef.textContent=w.definition||'';
  dom.cardEx.textContent=w.example||'';
  dom.cardFront.style.display='';dom.cardBack.style.display='none';dom.cardActions.style.display='none';
  dom.reviewProgress.textContent=`${state.reviewIdx+1} / ${state.reviewQueue.length}`;
}

dom.flashcard.addEventListener('click',e=>{
  if(e.target.closest('.card-actions')||e.target.closest('.card-speak'))return;
  if(dom.cardBack.style.display==='none'){dom.cardFront.style.display='none';dom.cardBack.style.display='';dom.cardActions.style.display='flex'}
  else{dom.cardFront.style.display='';dom.cardBack.style.display='none';dom.cardActions.style.display='none'}
});

dom.flashcard.querySelector('.card-speak').addEventListener('click',e=>{
  e.stopPropagation();const w=state.reviewQueue[state.reviewIdx];if(w)speak(w.surface);
});

dom.cardActions.querySelectorAll('.btn-rate').forEach(b=>b.addEventListener('click',e=>{
  const rating=parseInt(e.target.dataset.rating);
  const w=state.reviewQueue[state.reviewIdx];if(!w)return;
  if(!w.review)w.review={next:Date.now(),interval:0,ef:2.5};
  // Simple SRS: rating 1(hard) 2(good) 3(easy)
  const q=rating===1?2:rating===2?3:4;
  w.review.ef=Math.max(1.3,w.review.ef+(0.1-(5-q)*(0.08+(5-q)*0.02)));
  if(w.review.interval===0)w.review.interval=1;
  else if(w.review.interval===1)w.review.interval=rating===1?1:6;
  else w.review.interval=Math.round(w.review.interval*w.review.ef);
  if(rating===1)w.review.interval=1;
  w.review.next=Date.now()+w.review.interval*24*60*60*1000;
  saveWordLists();
  state.reviewIdx++;
  if(state.reviewIdx>=state.reviewQueue.length){endReview();return}
  showCard();
}));

dom.btnEndReview.addEventListener('click',endReview);
function endReview(){
  dom.reviewSetup.style.display='';dom.flashcard.style.display='none';
  state.reviewQueue=[];state.reviewIdx=0;
  renderReviewSetup();toast('复习结束');
}

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS + INIT
// ═══════════════════════════════════════════════════════════════════════

function syncUI(){
  dom.settingsApiKey.value=state.apiKey;dom.settingsJlpt.value=state.jlptLevel;
  dom.settingsJlptVal.textContent='N'+state.jlptLevel;dom.jlptSlider.value=state.jlptLevel;dom.jlptLabel.textContent='N'+state.jlptLevel;
  dom.lyrFurigana.checked=state.layers.furigana;dom.lyrRomaji.checked=state.layers.romaji;
  dom.lyrPos.checked=state.layers.pos;dom.lyrVerb.checked=state.layers.verb;
  dom.lyrEtym.checked=state.layers.etym;dom.lyrGrammar.checked=state.layers.grammar;dom.lyrSegments.checked=state.layers.segments;
  document.body.classList.toggle('dark',state.darkTheme);
  renderListOverview();
}

function openSettings(){dom.settingsOverlay.classList.add('open');dom.settingsPanel.classList.add('open')}
function closeSettings(){dom.settingsOverlay.classList.remove('open');dom.settingsPanel.classList.remove('open');saveSettings()}
dom.btnSettings.addEventListener('click',openSettings);
dom.settingsOverlay.addEventListener('click',closeSettings);
dom.settingsClose.addEventListener('click',closeSettings);

function saveSettings(){
  state.apiKey=dom.settingsApiKey.value.trim();state.jlptLevel=parseInt(dom.settingsJlpt.value);
  state.layers.furigana=dom.lyrFurigana.checked;state.layers.romaji=dom.lyrRomaji.checked;
  state.layers.pos=dom.lyrPos.checked;state.layers.verb=dom.lyrVerb.checked;
  state.layers.etym=dom.lyrEtym.checked;state.layers.grammar=dom.lyrGrammar.checked;state.layers.segments=dom.lyrSegments.checked;
  syncUI();saveState();
}
QA('.layer-toggles input[type="checkbox"]').forEach(el=>el.addEventListener('change',saveSettings));
dom.settingsApiKey.addEventListener('change',saveSettings);
dom.settingsJlpt.addEventListener('input',()=>{
  dom.settingsJlptVal.textContent='N'+dom.settingsJlpt.value;dom.jlptSlider.value=dom.settingsJlpt.value;dom.jlptLabel.textContent='N'+dom.settingsJlpt.value;saveSettings()
});
dom.jlptSlider.addEventListener('input',()=>{state.jlptLevel=parseInt(dom.jlptSlider.value);dom.jlptLabel.textContent='N'+state.jlptLevel;dom.settingsJlpt.value=state.jlptLevel;dom.settingsJlptVal.textContent=dom.jlptLabel.textContent;saveState()});

dom.btnDark.addEventListener('click',()=>{state.darkTheme=!state.darkTheme;document.body.classList.toggle('dark',state.darkTheme);dom.btnDark.textContent=state.darkTheme?'☀️':'🌙';saveState()});
dom.btnPaste.addEventListener('click',async()=>{try{const t=await navigator.clipboard.readText();if(t){dom.textInput.value=t;toast('已粘贴')}}catch{toast('无法读取剪贴板')}});
dom.btnAnnotate.addEventListener('click',doAnnotate);
dom.btnRefreshFeed.addEventListener('click',fetchNHKFeed);
dom.btnQuickImport.addEventListener('click',()=>{
  const t=dom.quickImport.value.trim();
  if(!t){toast('请粘贴日文文本');return}
  dom.textInput.value=t;dom.btnAnnotate.click();switchTab(1);
});

// Search in discover page
dom.discoverSearch.addEventListener('input',()=>{
  const q=dom.discoverSearch.value.trim().toLowerCase();
  if(!q){fetchNHKFeed();renderListOverview();return}
  // Search all saved words
  const matches=allWords().filter(w=>w.surface.toLowerCase().includes(q)||(w.reading||'').toLowerCase().includes(q));
  if(matches.length){
    dom.feedList.innerHTML='<div class="feed-header" style="margin-top:8px"><span class="feed-title">🔎 收藏中匹配</span></div>'+matches.slice(0,10).map(w=>`
      <div class="article-card">
        <div class="art-title">${ESC(w.surface)} <span style="font-size:13px;color:var(--text3)">${ESC(w.reading||'')}</span></div>
        <div class="art-meta">${ESC(w.definition||'')} <span class="art-tag">${ESC(w.listName||'')}</span></div>
      </div>
    `).join('');
    dom.feedList.querySelectorAll('.article-card').forEach(c=>c.addEventListener('click',()=>{
      dom.textInput.value='「'+q+'」';dom.btnAnnotate.click();switchTab(1);
    }));
  }else if(q.length>=1){
    dom.feedList.innerHTML=`<div class="feed-header" style="margin-top:8px"><span class="feed-title">🔎 发起AI解析</span></div>
      <div class="article-card" data-search="${ESC(q)}">
        <div class="art-title">以「${ESC(q)}」为中心搜索日文词汇分析</div>
        <div class="art-desc">点击将使用 DeepSeek AI 分析「${ESC(q)}」的用法、释义、语法角色</div>
        <div class="art-meta"><span class="art-tag">AI</span></div>
      </div>`;
    dom.feedList.querySelectorAll('.article-card').forEach(c=>c.addEventListener('click',()=>{
      dom.textInput.value=c.dataset.search||q;dom.btnAnnotate.click();switchTab(1);
    }));
  }else{
    dom.feedList.innerHTML='<div class="feed-loading">输入单词搜索收藏或发起AI查询</div>';
  }
});

// ═══════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════
function init(){
  loadState();syncUI();dom.btnDark.textContent=state.darkTheme?'☀️':'🌙';
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  refreshDiscoverPage();
}
init();
