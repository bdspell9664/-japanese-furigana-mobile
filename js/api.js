/**
 * api.js — DeepSeek API client (browser-side, no chrome.runtime needed)
 *
 *   Request queue (max 2)  •  LocalStorage cache (7-day TTL)
 *   Annotation (words + grammar)  •  Dictionary lookup  •  Sentence analysis
 */

// ── Queue ───────────────────────────────────────────────────────────────────
class Queue {
  constructor(max=2) { this.max=max; this.n=0; this.q=[]; }
  add(fn) { return new Promise((res,rej) => { this.q.push({fn,res,rej}); this._drain(); }); }
  _drain() { while(this.n<this.max&&this.q.length){const{fn,res,rej}=this.q.shift();this.n++;fn().then(res).catch(rej).finally(()=>{this.n--;this._drain()});} }
}
const q = new Queue(2);

// ── Hash ────────────────────────────────────────────────────────────────────
function hash(s){let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h|=0}return(h>>>0).toString(16)}

// ── LocalStorage cache ──────────────────────────────────────────────────────
const CP='jra:',TTL=7*864e5;
function ck(h){return CP+h}
function cacheGet(h){
  try{const r=localStorage.getItem(ck(h));if(!r)return null;const e=JSON.parse(r);if(Date.now()-e.ts>TTL){localStorage.removeItem(ck(h));return null}return e.data}catch{return null}
}
function cacheSet(h,data){
  try{localStorage.setItem(ck(h),JSON.stringify({data,ts:Date.now()}))}catch{/* storage full, ignore */}
}

// ── DeepSeek API ────────────────────────────────────────────────────────────
const API='https://api.deepseek.com/v1/chat/completions';
const MODEL='deepseek-chat';

async function deepseek(messages, apiKey, maxTok=4096){
  const r = await fetch(API, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
    body:JSON.stringify({model:MODEL,messages,response_format:{type:'json_object'},temperature:.1,max_tokens:maxTok})
  });
  if(!r.ok){const t=await r.text().catch(()=>'?');throw new Error(`API ${r.status}: ${t.slice(0,300)}`)}
  const d = await r.json();
  const c = d?.choices?.[0]?.message?.content;
  if(!c)throw new Error('Empty response');
  try{return JSON.parse(c)}catch{
    const cl=c.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
    try{return JSON.parse(cl)}catch{throw new Error(`JSON parse: ${c.slice(0,200)}`)};
  }
}

// ── Prompts ─────────────────────────────────────────────────────────────────

function annotPrompt(level, grammar){
  const base=[
    `你是专业的日语注音与辅助阅读助手。为给定日文段落标注假名。`,
    `1. 根据上下文判断多音字、人名、地名读音。`,
    `2. JLPT级别：${level}，仅标注高于该级别的汉字。`,
    `3. 助词、平假名、片假名无需标注。`,
    `4. 英文、数字保持原样。`,
    `5. 严格JSON输出。`,
  ];

  if(grammar){
    return base.join('\n')+`

格式（MOJi风格—注音+文法一体化）：
{"words":[{"surface":"原词","reading":"平假名","romaji":"罗马字","pos":"词性","verb_type":"动词分类或null","origin":"和語/漢語/外来語","annotate":true,"grammar_role":"主语/谓语/宾语/修饰语/助词/接续等或null","base_form":"原形或null"}],"structure":[{"type":"主語部/述語部/修飾部/接続部","surfaces":["原文片段"]}]}`;
  }

  return base.join('\n')+`
格式：{"words":[{"surface":"原词","reading":"平假名","romaji":"罗马字","pos":"词性","verb_type":"动词分类或null","origin":"和語/漢語/外来語","annotate":true}]}`;
}

const DICT_PROMPT=`你是专业日语词典。返回：1.词性 2.准确简洁中文释义 3.自然日文例句 4.语法功能简述。严格JSON：{"pos":"词性","definition":"中文释义","example":"日文例句","grammar_note":"语法功能简述"}`;

const ANALYZE_PROMPT=`你是专业日语语法分析助手。分析句子并严格JSON输出。
格式：{"structure":"树状结构","grammar_points":[{"point":"语法名","description":"解释","highlight":"关键字"}],"translation":"中文翻译","word_analysis":[{"word":"词","reading":"读音","role":"语法角色","base_form":"原形"}],"sentence_type":"句型","politeness_level":"敬语级别"}`;

// ── Public API ──────────────────────────────────────────────────────────────

const JRApi = {

  /** Annotate text: returns {words:[], structure:[]|null} */
  async annotate(text, jlptLevel, apiKey, withGrammar=false) {
    const lv = typeof jlptLevel === 'number' ? `N${jlptLevel}` : (jlptLevel||'N3');
    const suffix = withGrammar ? '|g' : '|b';
    const h = hash(text+'|'+lv+suffix);
    const cached = cacheGet(h);
    if(cached) return cached;

    return q.add(async () => {
      const p = await deepseek([{role:'system',content:annotPrompt(lv,withGrammar)},{role:'user',content:text}], apiKey, withGrammar?8192:4096);
      const words = (Array.isArray(p)?p:(p.words||[]))
        .filter(w=>w&&typeof w.surface==='string'&&w.surface.length>0)
        .map(w=>({
          surface:w.surface, reading:w.reading||'', romaji:w.romaji||'',
          pos:w.pos||null, verb_type:w.verb_type||null, origin:w.origin||null,
          annotate:!!w.annotate, grammar_role:w.grammar_role||null, base_form:w.base_form||null,
        }));
      const structure = (p.structure&&Array.isArray(p.structure)) ? p.structure : null;
      const result = {words,structure};
      cacheSet(h,result);
      return result;
    });
  },

  /** Dictionary lookup for a single word */
  async lookup(word, reading, context, apiKey) {
    const h = hash(word+'|dict|v2');
    const cached = cacheGet(h);
    if(cached) return cached;

    const user = context ? `单词：${word}（${reading}）\n上下文：${context}` : `单词：${word}（${reading}）`;
    return q.add(async () => {
      const r = await deepseek([{role:'system',content:DICT_PROMPT},{role:'user',content:user}], apiKey, 2048);
      cacheSet(h,r);
      return r;
    });
  },

  /** Deep sentence analysis */
  async analyze(text, apiKey) {
    const h = hash(text+'|analyze|v3');
    const cached = cacheGet(h);
    if(cached) return cached;

    return q.add(async () => {
      const r = await deepseek([{role:'system',content:ANALYZE_PROMPT},{role:'user',content:text}], apiKey, 4096);
      cacheSet(h,r);
      return r;
    });
  },
};

// Export for module use or global
if(typeof module!=='undefined'&&module.exports) module.exports=JRApi;
