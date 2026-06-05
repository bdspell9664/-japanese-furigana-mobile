/**
 * app.js — Japanese Reading Assistant PWA v3
 * Bottom dock, sheet tabs, 3D flashcards, parallel parsing, chunked text
 */
const $=id=>document.getElementById(id),QA=s=>document.querySelectorAll(s);

// ── DOM refs ──
const dom={};
(function(){
  ['discoverPanel','readingPanel','analysisPanel','savedPanel','reviewPanel',
   'discoverSearch','nhkFeed','btnRefreshFeed','feedList','listOverview','btnNewList',
   'quickImport','btnQuickImport',
   'textInput','urlInput','btnFetch','btnPaste','btnAnnotate','btnSpeakAll','jlptSlider','jlptLabel','readingView',
   'analysisView',
   'savedSearch','btnSavedSort','listSelector','savedView','btnRenameList','btnDeleteList',
   'reviewSetup','reviewListSelect','btnStartReview','flashcard','cardInner',
   'cardFront','cardBack','cardWord','cardReading','cardBackWord','cardBackReading',
   'cardPos','cardDef','cardEx','cardConj','cardActions','reviewProgress','btnEndReview','reviewStats','ringFg',
   'sheetOverlay','wordSheet','sheetWord','sheetReading','sheetTags','sheetDef','sheetEx',
   'sheetGNote','btnSaveWord','btnSheetSpeak','sheetListPills',
   'sheetRole','sheetConjug',
   'settingsOverlay','settingsSheet','settingsApiKey','settingsJlpt',
   'settingsJlptVal','settingsClose',
   'lyrFurigana','lyrRomaji','lyrPos','lyrVerb','lyrEtym','lyrGrammar','lyrSegments',
   'btnDark','toast'].forEach(i=>{dom[i]=$(i)});
  dom.dockBtns=QA('.dock-btn');
  dom.sheetTabs=QA('.sheet-tab');
  dom.sheetTabContents=QA('.sheet-tab-content');
})();

// ── State ──
const D={apiKey:'sk-d61051857c334e498a9d0dff3b78ed76',jlptLevel:3,
  layers:{furigana:true,romaji:false,pos:true,verb:false,etym:false,grammar:true,segments:true},
  darkTheme:false,wordLists:[{name:'默认',words:[]}],activeListIdx:0,reviewQueue:[],reviewIdx:0,sortBy:'time'};
let state={...D,text:'',annotatedHTML:'',analysis:null,_currentWord:null};
state.wordLists=structuredClone(D.wordLists);
function loadState(){
  try{
    const r=localStorage.getItem('jra-state');
    if(r){const s=JSON.parse(r);state.apiKey=s.apiKey||D.apiKey;state.jlptLevel=s.jlptLevel||3;state.layers={...D.layers,...(s.layers||{})};state.darkTheme=!!s.darkTheme;state.activeListIdx=s.activeListIdx||0;state.sortBy=s.sortBy||'time'}
    const wl=localStorage.getItem('jra-wordlists');
    if(wl)state.wordLists=JSON.parse(wl);
    state.wordLists=state.wordLists||structuredClone(D.wordLists);
  }catch{state.wordLists=structuredClone(D.wordLists)}
}
function saveState(){try{localStorage.setItem('jra-state',JSON.stringify({apiKey:state.apiKey,jlptLevel:state.jlptLevel,layers:state.layers,darkTheme:state.darkTheme,activeListIdx:state.activeListIdx,sortBy:state.sortBy}))}catch{}}
function saveWordLists(){try{localStorage.setItem('jra-wordlists',JSON.stringify(state.wordLists))}catch{}}
function activeList(){return state.wordLists[state.activeListIdx]||state.wordLists[0]}

// ── Toast ──
let __t;function toast(m){dom.toast.textContent=m;dom.toast.classList.add('show');clearTimeout(__t);__t=setTimeout(()=>dom.toast.classList.remove('show'),2000)}

// ── TTS ──
let speaking=false;
function speak(text,rate=.9,el){
  if(!text)return;if(speaking&&el){speechSynthesis.cancel();speaking=false;el.classList.remove('speaking');return}
  const u=new SpeechSynthesisUtterance(text);u.lang='ja-JP';u.rate=rate;
  const v=speechSynthesis.getVoices(),jp=v.find(v=>v.lang.startsWith('ja'));if(jp)u.voice=jp;
  u.onend=()=>{speaking=false;if(el){el.classList.remove('speaking')}};
  u.onerror=()=>{speaking=false;if(el){el.classList.remove('speaking')}};
  speaking=true;if(el)el.classList.add('speaking');speechSynthesis.speak(u);
}

// ── Bottom Dock ──
function switchTab(i){
  dom.dockBtns.forEach((b,j)=>b.classList.toggle('active',j===i));
  const ps=[dom.discoverPanel,dom.readingPanel,dom.analysisPanel,dom.savedPanel,dom.reviewPanel];
  ps.forEach((p,j)=>p.classList.toggle('active',j===i));
  if(i===3)renderListSel();
  renderReviewSetup();
}
dom.dockBtns.forEach((b,i)=>b.addEventListener('click',()=>switchTab(i)));

// ═══ TAB 0: DISCOVER ═══
const NHK_FEED=[
  {title:'「拉致」問題',desc:'北朝鮮による日本人拉致問題。政府は被害者の早期帰国を目指している。',date:'2025-05-30',tags:['社会']},
  {title:'食品ロスを減らそう',desc:'日本では年間約500万トンの食品が廃棄。家庭での対策が重要だ。',date:'2025-05-28',tags:['社会']},
  {title:'熱中症に注意',desc:'毎年多くの人が熱中症で病院に。水分補給が大切。',date:'2025-05-25',tags:['生活']},
  {title:'国会で法案審議',desc:'新しい法律について国会で議論。野党は修正を求める。',date:'2025-05-22',tags:['政治']},
  {title:'円安が進む',desc:'円安で輸入品の価格が上昇。家計への影響が懸念される。',date:'2025-05-20',tags:['経済']},
  {title:'人工知能の活用',desc:'様々な分野でAIの活用が進む。今後の発展に注目。',date:'2025-05-18',tags:['科学']},
  {title:'大きな地震に備える',desc:'日本は地震が多い国。防災グッズの準備や避難場所の確認を。',date:'2025-05-15',tags:['社会']},
  {title:'新しいワクチン開発',desc:'感染症から人々を守るため、新しいワクチンの研究が進む。',date:'2025-05-12',tags:['医療']},
];
function renderStaticFeed(){
  dom.feedList.innerHTML=NHK_FEED.map(a=>`
    <div class="article-card" data-desc="${ESC(a.desc)}">
      <div class="art-title">${ESC(a.title)}</div>
      <div class="art-desc">${ESC(a.desc)}</div>
      <div class="art-meta"><span>${a.date}</span>${a.tags.map(t=>`<span class="art-tag">${t}</span>`).join('')}</div>
    </div>`).join('');
  dom.feedList.querySelectorAll('.article-card').forEach(c=>c.addEventListener('click',()=>{
    const d=c.dataset.desc;if(d){dom.textInput.value=d;dom.btnAnnotate.click();switchTab(1)}
  }));
}
async function fetchNHKFeed(){
  renderStaticFeed();
  if(!state.apiKey||!state.apiKey.startsWith('sk-'))return;
  try{
    const r=await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent('https://www3.nhk.or.jp/news/easy/'),{signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('fail');
    const doc=new DOMParser().parseFromString(await r.text(),'text/html');
    const items=[];doc.querySelectorAll('.news-list__item a,.article-list__item a,article a[href]').forEach(a=>{
      const t=a.textContent.trim(),h=a.getAttribute('href');
      if(t.length>3&&t.length<100&&h)items.push({title:t,date:'',tags:[],url:h.startsWith('http')?h:'https://www3.nhk.or.jp'+h});
    });
    if(items.length>=3){
      dom.feedList.innerHTML=items.slice(0,12).map(a=>`
        <div class="article-card" data-url="${ESC(a.url)}">
          <div class="art-title">${ESC(a.title)}</div>
          <div class="art-meta"><span>NHK</span></div>
        </div>`).join('');
      dom.feedList.querySelectorAll('.article-card').forEach(c=>c.addEventListener('click',()=>{
        const u=c.dataset.url;if(u){dom.urlInput.value=u;dom.btnFetch.click();switchTab(1)}
      }));
    }
  }catch(e){renderStaticFeed()}
}
function renderListOverview(){
  dom.listOverview.innerHTML=state.wordLists.map((l,i)=>`
    <div class="list-chip" data-idx="${i}">
      <span>${ESC(l.name)}</span>
      <span class="chip-count">${l.words.length}</span>
    </div>`).join('')||'<div style="font-size:12px;color:var(--text3);padding:8px">暂无词单</div>';
  dom.listOverview.querySelectorAll('.list-chip').forEach(c=>c.addEventListener('click',()=>{state.activeListIdx=+c.dataset.idx;saveState();switchTab(3)}));
}
dom.btnRefreshFeed.addEventListener('click',fetchNHKFeed);
dom.btnQuickImport.addEventListener('click',()=>{const t=dom.quickImport.value.trim();if(t){dom.textInput.value=t;dom.btnAnnotate.click();switchTab(1)}});
dom.btnNewList.addEventListener('click',()=>{const n=prompt('词单名称：');if(!n||!n.trim())return;state.wordLists.push({name:n.trim(),words:[]});state.activeListIdx=state.wordLists.length-1;saveWordLists();saveState();renderListOverview();renderListSel()});

// Search
dom.discoverSearch.addEventListener('input',()=>{
  const q=dom.discoverSearch.value.trim().toLowerCase();if(!q){fetchNHKFeed();renderListOverview();return}
  const m=[];for(const l of state.wordLists)for(const w of l.words)if(w.surface.toLowerCase().includes(q)||(w.reading||'').includes(q))m.push(w);
  if(m.length){
    dom.feedList.innerHTML=m.slice(0,10).map(w=>`<div class="article-card" style="grid-column:1/-1"><div class="art-title">${ESC(w.surface)} <span style="font-size:12px;color:var(--text3)">${ESC(w.reading||'')}</span></div><div class="art-desc">${ESC(w.definition||'')}</div></div>`).join('');
    dom.feedList.querySelectorAll('.article-card').forEach(c=>c.addEventListener('click',()=>{dom.textInput.value='「'+q+'」';dom.btnAnnotate.click();switchTab(1)}));
  } else if(q.length>=1){
    dom.feedList.innerHTML=`<div class="article-card" style="grid-column:1/-1;background:var(--accent-light);border-color:var(--accent)" data-search="${ESC(q)}"><div class="art-title">🔎 AI分析「${ESC(q)}」</div><div class="art-desc">点击使用DeepSeek分析用法、释义、语法角色</div></div>`;
    dom.feedList.querySelector('.article-card').addEventListener('click',()=>{dom.textInput.value=q;dom.btnAnnotate.click();switchTab(1)});
  }
});

// ═══ TAB 1: READING ═══
async function doAnnotate(){
  const text=dom.textInput.value.trim();if(!text)return toast('请输入日文文本');
  if(!state.apiKey||!state.apiKey.startsWith('sk-'))return toast('请先设置API Key');
  state.text=text;dom.btnAnnotate.disabled=true;dom.btnAnnotate.textContent='解析中…';
  dom.readingView.innerHTML='<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
  dom.analysisView.innerHTML='<div class="ana-empty">解析中…</div>';
  // Force switch to reading tab
  dom.readingPanel.classList.add('active');
  [dom.discoverPanel,dom.analysisPanel,dom.savedPanel,dom.reviewPanel].forEach(p=>p.classList.remove('active'));
  dom.dockBtns.forEach((b,i)=>b.classList.toggle('active',i===1));
  try{
    const lv=`N${state.jlptLevel}`,wg=state.layers.grammar||state.layers.segments;
    let result;
    if(text.length>400){
      let chunkCount=0;
      result=await JRApi.annotateChunked(text,lv,state.apiKey,wg,(done,total)=>{
        dom.readingView.innerHTML=`<div style="font-size:12px;color:var(--text3);text-align:center;padding:10px">已处理 ${done}/${total} 段…</div>`;
      });
    }else{
      result=await JRApi.annotate(text,lv,state.apiKey,wg);
    }
    // Parallel analyze
    const aRes=text.length<=1200?JRApi.analyze(text,state.apiKey):Promise.resolve(null);
    if(result&&result.words&&result.words.length){
      dom.readingView.innerHTML=Renderer.render(text,result.words,result.structure,state.layers);
      bindWordTaps();addSpeakBtns();
      const n=result.words.filter(w=>w.annotate).length;toast(`标注 ${n} 词`);
    }else{
      dom.readingView.innerHTML=`<div style="font-size:13px;color:var(--accent);text-align:center;padding:20px;line-height:1.8">⚠️ 未识别到可标注词汇<br><span style="font-size:11px;color:var(--text3)">请确认输入了日文文本<br>或检查API Key是否有效</span></div>`;
    }
    aRes.then(r=>{if(r){state.analysis=r;buildAnalysis(r)}}).catch(e=>{console.warn('analyze:',e)});
  }catch(e){
    console.error('[doAnnotate]',e);
    dom.readingView.innerHTML=`<div style="font-size:13px;color:var(--accent);text-align:center;padding:20px;line-height:1.8">解析失败：${e.message||'未知错误'}<br><span style="font-size:11px;color:var(--text3)">API: ${state.apiKey?.\slice(0,12)}…<br>若持续失败请检查设置中的API Key或网络</span></div>`;
    toast('解析失败: '+(e.message||''));
  }finally{dom.btnAnnotate.disabled=false;dom.btnAnnotate.textContent='解析'}
}
function addSpeakBtns(){
  dom.readingView.querySelectorAll('.rw-word').forEach(el=>{
    if(el.querySelector('.rw-speak'))return;
    const b=document.createElement('span');b.className='rw-speak';b.textContent='🔊';
    b.addEventListener('click',e=>{e.stopPropagation();speak(el.dataset.surface||el.textContent.trim(),.9,el)});
    el.appendChild(b);
  });
}
dom.btnSpeakAll.addEventListener('click',()=>{const t=dom.textInput.value.trim()||state.text;if(speaking){speechSynthesis.cancel();speaking=false;dom.btnSpeakAll.textContent='🔊 朗读';return}dom.btnSpeakAll.textContent='⏹';speak(t,.85)});
dom.btnAnnotate.addEventListener('click',doAnnotate);
dom.btnPaste.addEventListener('click',async()=>{try{const t=await navigator.clipboard.readText();if(t){dom.textInput.value=t;toast('已粘贴')}}catch{toast('无法读取')}});
dom.urlInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();dom.btnFetch.click()}});

// Article fetch
const PX=[u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),u=>'https://corsproxy.io/?'+encodeURIComponent(u),u=>'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u)];
async function fetchHTML(url){
  for(const b of PX){try{const r=await fetch(b(url),{signal:AbortSignal.timeout(12000)});if(r.ok){const t=await r.text();if(t.length>200)return t}}catch{}}
  throw Error('all proxies failed');
}
function extractText(html){
  const d=new DOMParser().parseFromString(html,'text/html');
  'script,style,noscript,iframe,svg,nav,footer,aside,header,.ad,.advertisement,.social,.share,.comment'.split(',').forEach(s=>{try{d.querySelectorAll(s).forEach(e=>e.remove())}catch{}});
  for(const s of['article','[role="main"]','main','.article-body','.post-content','.entry-content','.news-content','.story-body','#article-body','#main-content','#content-body','[itemprop="articleBody"]']){
    try{const el=d.querySelector(s);if(el&&el.textContent.trim().length>100)return el.textContent.replace(/\s+/g,' ').trim().slice(0,3000)}catch{}}
  return [...d.querySelectorAll('p')].map(p=>p.textContent.trim()).filter(t=>t.length>10).join('\n').replace(/\s+/g,' ').trim().slice(0,3000);
}
dom.btnFetch.addEventListener('click',async()=>{
  const url=dom.urlInput.value.trim();if(!url||!url.startsWith('http'))return toast('输入网址');
  dom.btnFetch.disabled=true;dom.btnFetch.textContent='获取中…';
  dom.readingView.innerHTML='<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
  try{const t=extractText(await fetchHTML(url));if(!t||t.length<20)throw Error;dom.textInput.value=t;dom.urlInput.value=url;toast(`已提取${t.length}字`);await doAnnotate()}
  catch(e){dom.readingView.innerHTML=`<div style="color:var(--accent);padding:10px;font-size:13px">获取失败，部分网站可能限制跨域</div>`}
  finally{dom.btnFetch.disabled=false;dom.btnFetch.textContent='🔗 获取'}
});

function bindWordTaps(){
  dom.readingView.querySelectorAll('.rw-word').forEach(el=>{
    el.addEventListener('click',e=>{e.stopPropagation();
      const s=el.dataset.surface||'',r=el.dataset.reading||'',p=el.dataset.pos||'',g=el.dataset.grammar||'',b=el.dataset.base||'';
      openSheet(s,r,p,g,'查询中…','','',b,'',null);
      JRApi.lookup(s,r,state.text.slice(0,500),state.apiKey).then(res=>{
        if(res)updateSheet(res.pos||p,res.definition||'',res.example||'',res.grammar_role||g,res.base_form||b,res.grammar_role||g,res.conjugation||null,res.usage_note||null);
        else updateSheet(p,'暂无释义','',g,b,g,null,null);
      }).catch(()=>updateSheet(p,'查询失败','',g,b,g,null,null));
    });
  });
}

// ═══ TAB 2: ANALYSIS (accordion) ═══
function buildAnalysis(r){
  if(!r){dom.analysisView.innerHTML='<div class="ana-empty">暂无分析结果</div>';return}
  const pts=Array.isArray(r.grammar_points)?r.grammar_points:[];
  const wa=Array.isArray(r.word_analysis)?r.word_analysis:[];
  let h='';
  if(r.sentence_type||r.politeness_level){
    h+=`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--space-md)">`;
    if(r.sentence_type)h+=`<span class="badge type" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:var(--accent-light);color:var(--accent)">📝 ${ESC(r.sentence_type)}</span>`;
    if(r.politeness_level)h+=`<span class="badge polite" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#eef2ff;color:#4338ca">🎌 ${ESC(r.politeness_level)}</span>`;
    h+=`</div>`;
  }
  // Structure
  h+=`<div class="ana-acc open" id="accStruct"><div class="ana-acc-hd">句子结构<span class="acc-icon">▼</span></div><div class="ana-acc-bd"><pre>${ESC(r.structure||'暂无')}</pre></div></div>`;
  // Grammar points
  if(pts.length)h+=`<div class="ana-acc" id="accGrammar"><div class="ana-acc-hd">语法点 (${pts.length})<span class="acc-icon">▼</span></div><div class="ana-acc-bd">${pts.map(g=>{
    const pt=typeof g==='string'?g:g.point||'',ds=typeof g==='string'?'':g.description||'';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border-light)"><div style="font-size:13px;font-weight:700;color:var(--accent)">${ESC(pt)}</div><div style="font-size:12px;color:var(--text2)">${ESC(ds)}</div></div>`
  }).join('')}</div></div>`;
  // Word analysis table
  if(wa.length)h+=`<div class="ana-acc" id="accWords"><div class="ana-acc-hd">逐词分析 (${wa.length})<span class="acc-icon">▼</span></div><div class="ana-acc-bd"><table class="wa-table"><thead><tr><th>词</th><th>读音</th><th>角色</th><th>原形</th></tr></thead><tbody>${wa.map(w=>`<tr><td class="wa-w">${ESC(w.word)}</td><td>${ESC(w.reading||'')}</td><td class="wa-r">${ESC(w.role||'')}</td><td>${ESC(w.base_form||'')}</td></tr>`).join('')}</tbody></table></div></div>`;
  // Translation
  if(r.translation)h+=`<div class="ana-acc" id="accTrans"><div class="ana-acc-hd">中文翻译<span class="acc-icon">▼</span></div><div class="ana-acc-bd"><div class="ana-trans">${ESC(r.translation)}</div></div></div>`;
  dom.analysisView.innerHTML=h||'<div class="ana-empty">暂无分析</div>';
  // Accordion toggle
  dom.analysisView.querySelectorAll('.ana-acc-hd').forEach(el=>{
    el.addEventListener('click',()=>{
      el.parentElement.classList.toggle('open');
    });
  });
}

// ═══ SHEET (word detail with tabs) ═══
function openSheet(w,rd,pos,gr,def,ex,gn,bf,conj,unote){
  state._currentWord={word:w,reading:rd,pos,grammar:gr,def,example:ex,gnote:gn,baseForm:bf,conjugation:conj,usageNote:unote};
  dom.sheetWord.textContent=w;dom.sheetReading.textContent=rd||'';
  dom.sheetTags.innerHTML='';if(pos)dom.sheetTags.innerHTML+=`<span class="sheet-tag pos">${pos}</span>`;
  if(gr){const c=getGC(gr);dom.sheetTags.innerHTML+=`<span class="sheet-tag grammar" style="--tgc:${c}">${gr}</span>`}
  // Tab: def
  dom.sheetDef.textContent=def||'查询中…';
  // Tab: grammar
  dom.sheetRole.textContent=gr||'';dom.sheetRole.style.display=gr?'':'none';
  if(conj||bf){dom.sheetConjug.innerHTML=(bf&&bf!==w?`<span class="base-tag">原形：${bf}</span>`:'')+(conj?`<span class="conj-tag">${conj}</span>`:'');dom.sheetConjug.style.display=''}else dom.sheetConjug.style.display='none';
  dom.sheetGNote.style.display=unote?'':'none';dom.sheetGNote.textContent=unote||'';
  // Tab: ex
  dom.sheetEx.textContent=ex||'暂无例句';
  // List pills
  renderListPills();
  dom.btnSaveWord.textContent='☆ 收藏';dom.btnSaveWord.classList.remove('saved');
  // Reset tabs
  dom.sheetTabs.forEach((t,i)=>{t.classList.toggle('active',i===0);dom.sheetTabContents[i].classList.toggle('active',i===0)});
  dom.sheetOverlay.classList.add('open');dom.wordSheet.classList.add('open');
}
function updateSheet(pos,def,ex,gn,bf,gr,conj,unote){
  if(!state._currentWord)return;
  if(pos&&!state._currentWord.pos){dom.sheetTags.innerHTML=`<span class="sheet-tag pos">${pos}</span>`+dom.sheetTags.innerHTML;state._currentWord.pos=pos}
  if(gr&&!state._currentWord.grammar){const c=getGC(gr);dom.sheetTags.innerHTML+=`<span class="sheet-tag grammar" style="--tgc:${c}">${gr}</span>`;dom.sheetRole.textContent=gr;dom.sheetRole.style.display='';state._currentWord.grammar=gr}
  dom.sheetDef.textContent=def||'暂无释义';state._currentWord.def=def;
  dom.sheetEx.textContent=ex||'暂无例句';state._currentWord.example=ex;
  if(conj||bf){dom.sheetConjug.innerHTML=(bf&&bf!==state._currentWord.word?`<span class="base-tag">原形：${bf}</span>`:'')+(conj?`<span class="conj-tag">${conj}</span>`:'');dom.sheetConjug.style.display='';state._currentWord.baseForm=bf;state._currentWord.conjugation=conj}
  if(unote){dom.sheetGNote.textContent=unote;dom.sheetGNote.style.display='';state._currentWord.gnote=unote;state._currentWord.usageNote=unote}
}
function renderListPills(){
  dom.sheetListPills.innerHTML=state.wordLists.map((l,i)=>`<span class="sheet-list-pill ${i===state.activeListIdx?'active':''}" data-idx="${i}">${ESC(l.name)} (${l.words.length})</span>`).join('');
  dom.sheetListPills.querySelectorAll('.sheet-list-pill').forEach(el=>el.addEventListener('click',()=>{state.activeListIdx=+el.dataset.idx;renderListPills();saveState()}));
}
function getGC(r){return{'主語':'#2563eb','述語':'#d43d3d','目的語':'#059669','連体修飾語':'#7c3aed','連用修飾語':'#d97706','補語':'#0891b2','助詞':'#6b7280','接続詞':'#db2777'}[r]||'#888'}
// Sheet tabs
dom.sheetTabs.forEach((t,i)=>{
  t.addEventListener('click',()=>{
    dom.sheetTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
    dom.sheetTabContents.forEach(x=>x.classList.remove('active'));dom.sheetTabContents[i].classList.add('active');
  });
});
function closeSheet(){dom.sheetOverlay.classList.remove('open');dom.wordSheet.classList.remove('open')}
dom.sheetOverlay.addEventListener('click',closeSheet);
dom.btnSheetSpeak.addEventListener('click',()=>{const w=state._currentWord;if(w)speak(w.word)});
let ssY=0;dom.wordSheet.addEventListener('touchstart',e=>{ssY=e.touches[0].clientY},{passive:true});
dom.wordSheet.addEventListener('touchmove',e=>{if(e.touches[0].clientY-ssY>80)closeSheet()},{passive:true});

// Save word
dom.btnSaveWord.addEventListener('click',()=>{
  const w=state._currentWord;if(!w||dom.btnSaveWord.classList.contains('saved'))return;
  const li=state.activeListIdx;const list=state.wordLists[li];if(!list)return;
  const entry={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),surface:w.word,reading:w.reading,pos:w.pos,definition:w.def,example:w.example,grammar_note:w.gnote,conjugation:w.conjugation||null,usage_note:w.usageNote||null,ts:Date.now(),review:{next:Date.now(),interval:0,ef:2.5}};
  if(list.words.find(s=>s.surface===entry.surface))return toast('已收藏');
  list.words.push(entry);saveWordLists();dom.btnSaveWord.textContent='★ 已收藏';dom.btnSaveWord.classList.add('saved');
  renderListSel();toast(`已收藏到「${list.name}」`);
});

// ═══ TAB 3: SAVED ═══
let _savedSearch='';
dom.savedSearch.addEventListener('input',()=>{_savedSearch=dom.savedSearch.value.trim().toLowerCase();renderSavedWords()});
dom.btnSavedSort.addEventListener('click',()=>{state.sortBy=state.sortBy==='time'?'kana':'time';saveState();renderSavedWords();dom.btnSavedSort.textContent=state.sortBy==='time'?'⇅ 时间':'⇅ 假名'});
function renderListSel(){
  dom.listSelector.innerHTML=state.wordLists.map((l,i)=>`<option value="${i}" ${i===state.activeListIdx?'selected':''}>${ESC(l.name)} (${l.words.length})</option>`).join('');
  renderSavedWords();
}
dom.listSelector.addEventListener('change',()=>{state.activeListIdx=+dom.listSelector.value;saveState();renderSavedWords()});
dom.btnRenameList.addEventListener('click',()=>{const l=activeList();if(!l)return;const n=prompt('新名称',l.name);if(n&&n.trim()){l.name=n.trim();saveWordLists();renderListSel();renderListOverview()}});
dom.btnDeleteList.addEventListener('click',()=>{
  if(state.wordLists.length<=1)return toast('至少保留一个');
  const l=activeList();if(!confirm(`删除「${l.name}」？`))return;
  state.wordLists.splice(state.activeListIdx,1);state.activeListIdx=Math.min(state.activeListIdx,state.wordLists.length-1);
  saveWordLists();saveState();renderListSel();renderListOverview();
});
function renderSavedWords(){
  const list=activeList();if(!list||!list.words.length)return void(dom.savedView.innerHTML='<div class="saved-empty">词单为空</div>');
  let ws=[...list.words];
  if(_savedSearch)ws=ws.filter(w=>(w.surface||'').toLowerCase().includes(_savedSearch)||(w.reading||'').toLowerCase().includes(_savedSearch));
  if(state.sortBy==='kana')ws.sort((a,b)=>(a.reading||'').localeCompare(b.reading||''));
  else ws.sort((a,b)=>b.ts-a.ts);
  dom.savedView.innerHTML='<div class="saved-list">'+ws.map(w=>`
    <div class="saved-card" data-id="${w.id}">
      <button class="saved-del" data-id="${w.id}">✕</button>
      <div><div class="sw">${ESC(w.surface)}</div><div class="sr">${ESC(w.reading||'')} · ${ESC(w.pos||'')}</div></div>
      <div class="sd">${ESC(w.definition||'')}</div>
    </div>`).join('')+'</div>';
  dom.savedView.querySelectorAll('.saved-card').forEach(c=>c.addEventListener('click',e=>{
    if(e.target.classList.contains('saved-del'))return;
    const w=list.words.find(s=>s.id===c.dataset.id);if(w)openSheet(w.surface,w.reading,w.pos,w.grammar_note,w.definition,w.example||'',w.grammar_note||'','');
  }));
  dom.savedView.querySelectorAll('.saved-del').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation();const id=b.dataset.id;list.words=list.words.filter(s=>s.id!==id);
    saveWordLists();renderSavedWords();renderListSel();renderListOverview();toast('已删除');
  }));
}

// ═══ TAB 4: REVIEW ═══
function buildReviewQueue(list){
  const now=Date.now(),due=list.words.filter(w=>!w.review||w.review.next<=now);
  return [...due,...list.words.filter(w=>w.review&&w.review.next>now).sort(()=>Math.random()-.5)];
}
function renderReviewSetup(){
  dom.reviewListSelect.innerHTML=state.wordLists.map((l,i)=>`<option value="${i}" ${i===state.activeListIdx?'selected':''}>${ESC(l.name)} (${l.words.length})</option>`).join('');
  const li=+dom.reviewListSelect.value||0,q=buildReviewQueue(state.wordLists[li]||state.wordLists[0]),due=q.filter(w=>!w.review||w.review.next<=Date.now()).length;
  dom.reviewStats.textContent=due;const circ=163.36*(1-due/(q.length||1));dom.ringFg.style.strokeDashoffset=circ;
}
dom.reviewListSelect.addEventListener('change',renderReviewSetup);
dom.btnStartReview.addEventListener('click',()=>{
  const li=+dom.reviewListSelect.value||0,list=state.wordLists[li];if(!list||!list.words.length)return toast('词单为空');
  state.reviewQueue=buildReviewQueue(list);if(!state.reviewQueue.length)return toast('没有待复习词');
  state.reviewIdx=0;dom.reviewSetup.style.display='none';dom.flashcard.style.display='';showCard();
});
function showCard(){
  const w=state.reviewQueue[state.reviewIdx];if(!w)return endReview();
  dom.cardWord.textContent=w.surface;dom.cardReading.textContent=w.reading||'';
  dom.cardBackWord.textContent=w.surface;dom.cardBackReading.textContent=w.reading||'';
  dom.cardPos.textContent=w.pos||'';dom.cardConj.textContent=w.conjugation||w.grammar_note||'';
  dom.cardDef.textContent=w.definition||'';dom.cardEx.textContent=w.example||'';
  dom.cardInner.classList.remove('flipped');dom.cardActions.style.display='none';
  dom.reviewProgress.textContent=`${state.reviewIdx+1}/${state.reviewQueue.length}`;
}
dom.flashcard.addEventListener('click',e=>{
  if(e.target.closest('.card-actions')||e.target.closest('.btn-ghost'))return;
  if(!dom.cardInner.classList.contains('flipped')){dom.cardInner.classList.add('flipped');dom.cardActions.style.display='flex'}
  else{dom.cardInner.classList.remove('flipped');dom.cardActions.style.display='none'}
});
dom.flashcard.querySelectorAll('.card-speak').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();const w=state.reviewQueue[state.reviewIdx];if(w)speak(w.surface)}));
dom.cardActions.querySelectorAll('.btn-rate').forEach(b=>b.addEventListener('click',e=>{
  const r=+e.target.dataset.rating,w=state.reviewQueue[state.reviewIdx];if(!w)return;
  if(!w.review)w.review={next:Date.now(),interval:0,ef:2.5};
  const q=r===1?2:r===2?3:4;
  w.review.ef=Math.max(1.3,w.review.ef+(.1-(5-q)*(.08+(5-q)*.02)));
  if(w.review.interval===0)w.review.interval=1;
  else if(w.review.interval===1)w.review.interval=r===1?1:6;
  else w.review.interval=Math.round(w.review.interval*w.review.ef);
  if(r===1)w.review.interval=1;
  w.review.next=Date.now()+w.review.interval*24*60*60*1000;saveWordLists();
  state.reviewIdx++;if(state.reviewIdx>=state.reviewQueue.length)endReview();else showCard();
}));
dom.btnEndReview.addEventListener('click',endReview);
function endReview(){dom.reviewSetup.style.display='';dom.flashcard.style.display='none';state.reviewQueue=[];state.reviewIdx=0;renderReviewSetup();toast('复习结束')}

// ═══ SETTINGS (bottom sheet) ═══
function openSettings(){dom.settingsOverlay.classList.add('open');dom.settingsSheet.classList.add('open')}
function closeSettings(){dom.settingsOverlay.classList.remove('open');dom.settingsSheet.classList.remove('open');saveSettings()}
dom.btnSettings.addEventListener('click',openSettings);
dom.settingsOverlay.addEventListener('click',closeSettings);
dom.settingsClose.addEventListener('click',closeSettings);
function syncUI(){
  dom.settingsApiKey.value=state.apiKey;dom.settingsJlpt.value=state.jlptLevel;
  dom.settingsJlptVal.textContent='N'+state.jlptLevel;dom.jlptSlider.value=state.jlptLevel;dom.jlptLabel.textContent='N'+state.jlptLevel;
  dom.lyrFurigana.checked=state.layers.furigana;dom.lyrRomaji.checked=state.layers.romaji;
  dom.lyrPos.checked=state.layers.pos;dom.lyrVerb.checked=state.layers.verb;
  dom.lyrEtym.checked=state.layers.etym;dom.lyrGrammar.checked=state.layers.grammar;dom.lyrSegments.checked=state.layers.segments;
  document.body.classList.toggle('dark',state.darkTheme);renderListOverview();
}
function saveSettings(){
  state.apiKey=dom.settingsApiKey.value.trim();state.jlptLevel=+dom.settingsJlpt.value;
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
dom.jlptSlider.addEventListener('input',()=>{
  state.jlptLevel=+dom.jlptSlider.value;dom.jlptLabel.textContent='N'+state.jlptLevel;
  dom.settingsJlpt.value=state.jlptLevel;dom.settingsJlptVal.textContent=dom.jlptLabel.textContent;saveState()
});
dom.btnDark.addEventListener('click',()=>{state.darkTheme=!state.darkTheme;document.body.classList.toggle('dark',state.darkTheme);dom.btnDark.textContent=state.darkTheme?'☀️':'🌙';saveState()});

// ── Init ──
function init(){loadState();syncUI();dom.btnDark.textContent=state.darkTheme?'☀️':'🌙';if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});renderStaticFeed();renderListOverview();}
init();
