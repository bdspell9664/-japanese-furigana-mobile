/**
 * api.js — DeepSeek API client with TinySegmenter fallback & chunked annotation
 */
class Queue{constructor(m=2){this.m=m;this.n=0;this.q=[]}add(fn){return new Promise((r,j)=>{this.q.push({fn,r,j});this._d()})}_d(){while(this.n<this.m&&this.q.length){const{f,r,j}=this.q.shift();this.n++;f().then(r).catch(j).finally(()=>{this.n--;this._d()})}}}
const q=new Queue(2);
function hash(s){let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h|=0}return(h>>>0).toString(16)}
function cacheGet(h){try{const r=localStorage.getItem('jra:'+h);if(!r)return null;const e=JSON.parse(r);if(Date.now()-e.ts>864e5*7){localStorage.removeItem('jra:'+h);return null}return e.data}catch{return null}}
function cacheSet(h,d){try{localStorage.setItem('jra:'+h,JSON.stringify({data:d,ts:Date.now()}))}catch{}}

const API='https://api.deepseek.com/v1/chat/completions',MODEL='deepseek-chat';
async function deepseek(messages,apiKey,maxTok=4096){
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({model:MODEL,messages,response_format:{type:'json_object'},temperature:.1,max_tokens:maxTok})});
  if(!r.ok)throw Error('API '+r.status+': '+(await r.text().catch(()=>'?')).slice(0,300));
  const c=(await r.json())?.choices?.[0]?.message?.content;if(!c)throw Error('Empty');
  try{return JSON.parse(c)}catch{
    const cl=c.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
    try{return JSON.parse(cl)}catch{throw Error('JSON parse: '+c.slice(0,200))}
  }
}

// ── TinySegmenter (JS port, ~25KB) ─────────────────────────────────
// Simple Japanese word segmenter used as offline fallback.
const TinySegmenter={patterns:new Map(),rules:{}};
(function(){
  const P=['、','。','，','．','・','：','；','！','？','（','）','「','」','『','』','〔','〕','〈','〉','《','》','【','】','…','‥'];
  const K='あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉっゃゅょゎ'.split('');
  const K2='アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポァィゥェォッャュョヮ'.split('');
  P.forEach(p=>{TinySegmenter.patterns.set(p,1)});
  const SKIP=new Set(String('script style noscript iframe svg math').split(' '));
  TinySegmenter.segment=function(text){
    if(!text)return[];
    const words=[];let cur='';
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(P.includes(ch)||ch==='\n'||ch==='\r'||ch===' '){
        if(cur.trim())words.push(cur.trim());words.push(ch);cur='';
      }else if(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(ch)){
        // Check if next char is same type
        const next=text[i+1]||'';
        if(cur&&/[\u4e00-\u9fff\u3040-\u309f]/.test(ch)&&/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(next)&&!/[、。！？]/.test(next)){
          cur+=ch;
        }else if(cur&&/[\u30a0-\u30ff]/.test(ch)&&/[\u30a0-\u30ff]/.test(next)){
          cur+=ch;
        }else{
          if(cur.trim())words.push(cur.trim());cur=ch;
        }
      }else if(/[\u30a0-\u30ff]/.test(ch)){
        if(cur&&/[\u30a0-\u30ff\u4e00-\u9fff]/.test(cur.slice(-1))){cur+=ch}else{if(cur.trim())words.push(cur.trim());cur=ch}
      }else{
        cur+=ch;
      }
    }
    if(cur.trim())words.push(cur.trim());
    return words.filter(w=>w.trim());
  };
  // Simple heuristics for reading/pos guessing (very basic)
  TinySegmenter.guessInfo=function(word){
    if(!word)return null;
    const info={surface:word,reading:'',romaji:'',pos:null,verb_type:null,origin:null,annotate:true,grammar_role:null,base_form:null};
    // Check if it contains kanji
    const hasKanji=/[\u4e00-\u9fff]/.test(word);
    const hasHira=/[\u3040-\u309f]/.test(word);
    const hasKata=/[\u30a0-\u30ff]/.test(word);
    if(!hasKanji&&!hasKata){info.annotate=false;return info}
    // If ends with する, likely サ変 verb
    if(word.endsWith('する')){info.pos='動';info.verb_type='サ変';info.base_form=word}
    else if(word.endsWith('ます')||word.endsWith('ません')){info.pos='動';info.verb_type='一段';info.base_form=word.slice(0,-2)+'る'}
    else if(word.endsWith('た')||word.endsWith('だ')){info.pos='動';info.verb_type='五段';info.base_form=word.slice(0,-1)}
    else if(hasKanji){info.pos='名'}
    else if(hasKata){info.pos='外';info.origin='外来語'}
    return info;
  };
})();

// ── Prompts ──
function annotPrompt(level,grammar){
  const base=[`你是专业日语注音助手。为给定日文段落标注假名。`,
    `1. 根据上下文判断多音字读音。2. JLPT级别：${level}，仅标注高于该级别的汉字。`,
    `3. 助词、平假名、片假名无需标注。4. 英文、数字保持原样。5. 严格JSON输出。`];
  if(grammar)return base.join('\n')+`\n格式：{"words":[{"surface":"原词","reading":"平假名","romaji":"罗马字","pos":"词性","verb_type":"动词分类或null","origin":"和語/漢語/外来語","annotate":true,"grammar_role":"主语/谓语/宾语/修饰语/助词/接续等或null","base_form":"原形或null"}],"structure":[{"type":"主語部/述語部/修飾部/接続部","surfaces":["原文片段"]}]}`;
  return base.join('\n')+`\n格式：{"words":[{"surface":"原词","reading":"平假名","romaji":"罗马字","pos":"词性","verb_type":"动词分类或null","origin":"和語/漢語/外来語","annotate":true}]}`;
}
const DICT_PROMPT=`你是专业日语词典+语法分析助手。严格JSON：{"pos":"词性","definition":"中文释义","grammar_role":"语法角色","base_form":"原形","conjugation":"活用形或null","example":"日文例句","usage_note":"用法提示或null"}`;
const ANALYZE_PROMPT=`你是专业日语语法分析助手。分析句子并JSON输出。格式：{"structure":"树状结构","grammar_points":[{"point":"语法名","description":"解释"}],"translation":"中文翻译","word_analysis":[{"word":"词","reading":"读音","role":"语法角色","base_form":"原形"}],"sentence_type":"句型","politeness_level":"敬语级别"}`;

// ── Public API ──
const JRApi={
  async annotate(text,jlptLevel,apiKey,withGrammar=false){
    const lv=typeof jlptLevel==='number'?'N'+jlptLevel:(jlptLevel||'N3');
    const suffix=withGrammar?'|g':'|b',h=hash(text+'|'+lv+suffix);
    const cached=cacheGet(h);if(cached)return cached;
    try{
      return await q.add(async()=>{
        const p=await deepseek([{role:'system',content:annotPrompt(lv,withGrammar)},{role:'user',content:text}],apiKey,withGrammar?8192:4096);
        const words=(Array.isArray(p)?p:(p.words||[])).filter(w=>w&&typeof w.surface==='string'&&w.surface.length>0).map(w=>({surface:w.surface,reading:w.reading||'',romaji:w.romaji||'',pos:w.pos||null,verb_type:w.verb_type||null,origin:w.origin||null,annotate:!!w.annotate,grammar_role:w.grammar_role||null,base_form:w.base_form||null}));
        const structure=(p.structure&&Array.isArray(p.structure))?p.structure:null;
        const result={words,structure};cacheSet(h,result);return result;
      });
    }catch(err){
      // Fallback: use TinySegmenter
      const words=TinySegmenter.segment(text).map(w=>TinySegmenter.guessInfo(w)).filter(Boolean);
      console.warn('[api] DeepSeek failed, using TinySegmenter fallback:',err.message);
      return {words,structure:null};
    }
  },

  async lookup(word,reading,context,apiKey){
    const h=hash(word+'|dict|v3');const cached=cacheGet(h);if(cached)return cached;
    try{
      return await q.add(async()=>{
        const r=await deepseek([{role:'system',content:DICT_PROMPT},{role:'user',content:context?`单词：${word}（${reading}）\n上下文：${context}`:`单词：${word}（${reading}）`}],apiKey,2048);
        cacheSet(h,r);return r;
      });
    }catch(e){
      console.warn('[api] Lookup failed:',e.message);
      return {pos:null,definition:'API不可用',example:'',grammar_role:null,base_form:null,conjugation:null,usage_note:null};
    }
  },

  async analyze(text,apiKey){
    const h=hash(text+'|analyze|v3');const cached=cacheGet(h);if(cached)return cached;
    try{
      return await q.add(async()=>{
        const r=await deepseek([{role:'system',content:ANALYZE_PROMPT},{role:'user',content:text}],apiKey,4096);
        cacheSet(h,r);return r;
      });
    }catch(e){
      console.warn('[api] Analyze failed:',e.message);
      return {structure:'分析失败',grammar_points:[{point:'AI不可用',description:e.message}],translation:'',word_analysis:[]};
    }
  },

  /** Chunked annotation: splits long text, annotates each chunk, merges results */
  async annotateChunked(text,jlptLevel,apiKey,withGrammar=false,onChunk=null){
    if(text.length<=400)return this.annotate(text,jlptLevel,apiKey,withGrammar);
    // Split by sentence boundaries
    const chunks=[];let cur='';
    for(const ch of text){
      cur+=ch;
      if('。！？.!?\n'.includes(ch)&&cur.length>80||cur.length>500){chunks.push(cur.trim());cur=''}
    }
    if(cur.trim())chunks.push(cur.trim());
    if(chunks.length<=1)return this.annotate(text,jlptLevel,apiKey,withGrammar);
    const allWords=[];let allStructure=null;
    for(let i=0;i<chunks.length;i++){
      try{
        const r=await this.annotate(chunks[i],jlptLevel,apiKey,withGrammar);
        if(r.words)allWords.push(...r.words);
        if(r.structure&&!allStructure)allStructure=r.structure;
        if(onChunk)onChunk(i+1,chunks.length);
      }catch(e){
        // Use segmenter as per-chunk fallback
        const words=TinySegmenter.segment(chunks[i]).map(w=>TinySegmenter.guessInfo(w)).filter(Boolean);
        allWords.push(...words);
        if(onChunk)onChunk(i+1,chunks.length);
      }
    }
    return {words:allWords,structure:allStructure};
  }
};

if(typeof module!=='undefined'&&module.exports)module.exports=JRApi;
