/**
 * app.js — Japanese Reading Assistant PWA controller
 *
 * State: text, apiKey, jlptLevel (1-5), layers, annotatedHTML, analysis, savedWords
 * Tabs: reading / analysis / saved
 */

// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const QA = sel => document.querySelectorAll(sel);

const dom = {
  // Tabs
  tabBtns: QA('.tab-btn'),
  tabPanels: QA('.tab-panel'),
  // Input
  textInput: $('textInput'),
  urlInput: $('urlInput'),
  btnFetch: $('btnFetch'),
  btnPaste: $('btnPaste'),
  btnAnnotate: $('btnAnnotate'),
  jlptSlider: $('jlptSlider'),
  jlptLabel: $('jlptLabel'),
  // Reading view
  readingView: $('readingView'),
  analysisView: $('analysisView'),
  savedView: $('savedView'),
  // Word sheet
  sheetOverlay: $('sheetOverlay'),
  wordSheet: $('wordSheet'),
  sheetWord: $('sheetWord'),
  sheetReading: $('sheetReading'),
  sheetTags: $('sheetTags'),
  sheetDef: $('sheetDef'),
  sheetEx: $('sheetEx'),
  sheetGNote: $('sheetGNote'),
  btnSaveWord: $('btnSaveWord'),
  // Settings
  btnSettings: $('btnSettings'),
  settingsOverlay: $('settingsOverlay'),
  settingsPanel: $('settingsPanel'),
  settingsApiKey: $('settingsApiKey'),
  settingsJlpt: $('settingsJlpt'),
  settingsJlptVal: $('settingsJlptVal'),
  // Layer toggles
  lyrFurigana: $('lyrFurigana'),
  lyrRomaji: $('lyrRomaji'),
  lyrPos: $('lyrPos'),
  lyrVerb: $('lyrVerb'),
  lyrEtym: $('lyrEtym'),
  lyrGrammar: $('lyrGrammar'),
  lyrSegments: $('lyrSegments'),
  // Other
  btnDark: $('btnDark'),
  toast: $('toast'),
  settingsClose: $('settingsClose'),
};

// ── State ───────────────────────────────────────────────────────────────────
const DEFAULTS = {
  apiKey: 'sk-d61051857c334e498a9d0dff3b78ed76',
  jlptLevel: 3,
  layers: {
    furigana: true, romaji: false, pos: true, verb: false,
    etym: false, grammar: true, segments: true,
  },
  darkTheme: false,
};

let state = {
  ...DEFAULTS,
  text: '',
  annotatedHTML: '',
  analysis: null,
  savedWords: [],
  _currentWord: null, // word data for sheet
};

// ── Persistence ─────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem('jra-state');
    if (raw) {
      const s = JSON.parse(raw);
      state.apiKey = s.apiKey || DEFAULTS.apiKey;
      state.jlptLevel = s.jlptLevel || 3;
      state.layers = { ...DEFAULTS.layers, ...(s.layers||{}) };
      state.darkTheme = !!s.darkTheme;
    }
    const sw = localStorage.getItem('jra-saved');
    if (sw) state.savedWords = JSON.parse(sw);
  } catch { /* ignore */ }
}

function saveState() {
  try {
    localStorage.setItem('jra-state', JSON.stringify({
      apiKey: state.apiKey, jlptLevel: state.jlptLevel,
      layers: state.layers, darkTheme: state.darkTheme,
    }));
  } catch { /* ignore */ }
}

function saveSavedWords() {
  try { localStorage.setItem('jra-saved', JSON.stringify(state.savedWords)); } catch {}
}

// ── UI Sync ─────────────────────────────────────────────────────────────────
function syncUI() {
  // Settings
  dom.settingsApiKey.value = state.apiKey;
  dom.settingsJlpt.value = state.jlptLevel;
  dom.settingsJlptVal.textContent = `N${state.jlptLevel}`;
  dom.jlptSlider.value = state.jlptLevel;
  dom.jlptLabel.textContent = `N${state.jlptLevel}`;

  // Layers
  dom.lyrFurigana.checked = state.layers.furigana;
  dom.lyrRomaji.checked = state.layers.romaji;
  dom.lyrPos.checked = state.layers.pos;
  dom.lyrVerb.checked = state.layers.verb;
  dom.lyrEtym.checked = state.layers.etym;
  dom.lyrGrammar.checked = state.layers.grammar;
  dom.lyrSegments.checked = state.layers.segments;

  // Dark theme
  if (state.darkTheme) document.body.classList.add('dark');
  else document.body.classList.remove('dark');

  // Saved words
  renderSavedWords();
}

// ── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2000);
}

// ── Tab switching ───────────────────────────────────────────────────────────
function switchTab(idx) {
  dom.tabBtns.forEach((b,i) => b.classList.toggle('active', i===idx));
  dom.tabPanels.forEach((p,i) => p.classList.toggle('active', i===idx));
}

dom.tabBtns.forEach((btn,i) => btn.addEventListener('click', () => switchTab(i)));

// ── Annotate ────────────────────────────────────────────────────────────────
async function doAnnotate() {
  const text = dom.textInput.value.trim();
  if (!text) { toast('请输入日文文本'); return; }
  if (!state.apiKey || !state.apiKey.startsWith('sk-')) { toast('请先设置有效的 DeepSeek API Key'); return; }

  state.text = text;
  dom.btnAnnotate.disabled = true;
  dom.btnAnnotate.textContent = '解析中…';
  dom.readingView.innerHTML = '<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
  dom.analysisView.innerHTML = '<div class="ana-empty">解析中…</div>';

  try {
    const lv = `N${state.jlptLevel}`;
    const withGrammar = state.layers.grammar || state.layers.segments;
    const result = await JRApi.annotate(text, lv, state.apiKey, withGrammar);
    const html = Renderer.render(text, result.words, result.structure, state.layers);
    state.annotatedHTML = html;
    dom.readingView.innerHTML = html;

    // Bind word tap events
    bindWordTaps();

    const wordCount = result.words.filter(w=>w.annotate).length;
    toast(`已标注 ${wordCount} 个词`);

    // Auto-run deep analysis
    if (text.length <= 800) {
      doAnalyze(text).catch(()=>{});
    }
  } catch (e) {
    dom.readingView.innerHTML = `<div style="color:var(--accent);font-size:14px">解析失败：${ESC(e.message)}</div>`;
    toast('解析失败: ' + e.message);
  } finally {
    dom.btnAnnotate.disabled = false;
    dom.btnAnnotate.textContent = '解析';
  }
}

// ── Article fetching (CORS proxy + text extraction) ────────────────────────

const CORS_PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchArticleHTML(url) {
  let lastErr = null;
  for (const builder of CORS_PROXIES) {
    try {
      const proxyUrl = builder(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (text.length < 200) throw new Error('空响应');
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('所有代理均不可用');
}

function extractTextFromHTML(html) {
  // Parse HTML safely
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Remove noise: scripts, styles, nav, footer, ads
  const removeTags = 'script,style,noscript,iframe,svg,nav,footer,aside,header,.ad,.advertisement,[class*="ad-"],.social,.share,.comment,.sidebar'.split(',');
  removeTags.forEach(sel => {
    try { doc.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
  });

  // Priority semantic selectors (same as browser extension)
  const selectors = [
    'article', '[role="main"]', 'main',
    '.article-body', '.article__body', '.post-content', '.entry-content',
    '.article-content', '.news-content', '.story-body',
    '#article-body', '#main-content', '#content-body',
    '[itemprop="articleBody"]',
  ];

  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel);
      if (el && el.textContent.trim().length > 100) {
        return cleanText(el.textContent);
      }
    } catch {}
  }

  // Fallback: all paragraphs
  const ps = doc.querySelectorAll('p');
  const text = [...ps].map(p => p.textContent.trim()).filter(t => t.length > 10).join('\n');
  if (text.length > 50) return cleanText(text);

  // Last resort: body text
  const body = doc.body;
  return body ? cleanText(body.textContent).slice(0, 3000) : '';
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Word tap → bottom sheet ─────────────────────────────────────────────────
function bindWordTaps() {
  dom.readingView.querySelectorAll('.rw-word').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const surface = el.dataset.surface || '';
      const reading = el.dataset.reading || '';
      const pos = el.dataset.pos || '';
      const grammar = el.dataset.grammar || '';
      const baseForm = el.dataset.base || '';

      // Show placeholder sheet immediately
      openSheet(surface, reading, pos, grammar, '查询中…', '', '', baseForm);

      try {
        const ctx = state.text.slice(0, 500);
        const result = await JRApi.lookup(surface, reading, ctx, state.apiKey);
        if (result) {
          updateSheet(result.pos || pos, result.definition || '', result.example || '', result.grammar_note || grammar, baseForm);
        } else {
          updateSheet(pos, '暂无释义', '', grammar, baseForm);
        }
      } catch {
        updateSheet(pos, '查询失败', '', grammar, baseForm);
      }
    });
  });
}

function openSheet(word, reading, pos, grammar, def, example, gnote, baseForm) {
  state._currentWord = { word, reading, pos, grammar, def, example, gnote, baseForm };
  dom.sheetWord.textContent = word;
  dom.sheetReading.textContent = reading || '';
  dom.sheetTags.innerHTML = '';
  if (pos) dom.sheetTags.innerHTML += `<span class="sheet-tag pos">${pos}</span>`;
  if (grammar) {
    const color = getGrammarColor(grammar);
    dom.sheetTags.innerHTML += `<span class="sheet-tag grammar" style="--tgc:${color}">${grammar}</span>`;
  }
  dom.sheetDef.textContent = def;
  dom.sheetEx.textContent = example;
  dom.sheetGNote.style.display = gnote ? '' : 'none';
  dom.sheetGNote.textContent = gnote || '';
  dom.btnSaveWord.textContent = '☆ 收藏';
  dom.btnSaveWord.classList.remove('saved');

  dom.sheetOverlay.classList.add('open');
  dom.wordSheet.classList.add('open');
}

function updateSheet(pos, def, example, gnote, baseForm) {
  if (!state._currentWord) return;
  if (pos && !state._currentWord.pos) {
    dom.sheetTags.innerHTML = `<span class="sheet-tag pos">${pos}</span>` + dom.sheetTags.innerHTML;
  }
  dom.sheetDef.textContent = def;
  dom.sheetEx.textContent = example;
  if (gnote) {
    dom.sheetGNote.style.display = '';
    dom.sheetGNote.textContent = gnote;
  }
  state._currentWord.pos = pos || state._currentWord.pos;
  state._currentWord.def = def;
  state._currentWord.example = example;
  state._currentWord.gnote = gnote;
}

function closeSheet() {
  dom.sheetOverlay.classList.remove('open');
  dom.wordSheet.classList.remove('open');
}

function getGrammarColor(role) {
  const map = { '主語':'#2563eb','述語':'#d43d3d','目的語':'#059669','連体修飾語':'#7c3aed','連用修飾語':'#d97706','補語':'#0891b2','助詞':'#6b7280','接続詞':'#db2777' };
  return map[role] || '#888';
}

// ── Sheet: tap overlay or swipe down to close ──────────────────────────
dom.sheetOverlay.addEventListener('click', closeSheet);

let sheetStartY = 0;
dom.wordSheet.addEventListener('touchstart', e => {
  sheetStartY = e.touches[0].clientY;
}, {passive: true});
dom.wordSheet.addEventListener('touchmove', e => {
  const dy = e.touches[0].clientY - sheetStartY;
  if (dy > 80) { closeSheet(); }
}, {passive: true});
dom.btnSaveWord.addEventListener('click', () => {
  const w = state._currentWord;
  if (!w || dom.btnSaveWord.classList.contains('saved')) return;
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    surface: w.word, reading: w.reading, pos: w.pos,
    definition: w.def, example: w.example, grammar_note: w.gnote,
    ts: Date.now(),
  };
  // Dedup
  const exists = state.savedWords.find(s => s.surface === entry.surface && s.reading === entry.reading);
  if (exists) {
    toast('已收藏过此词');
    return;
  }
  state.savedWords.unshift(entry);
  if (state.savedWords.length > 200) state.savedWords.length = 200;
  saveSavedWords();
  dom.btnSaveWord.textContent = '★ 已收藏';
  dom.btnSaveWord.classList.add('saved');
  renderSavedWords();
  toast('已收藏');
});

// ── Deep Analysis ───────────────────────────────────────────────────────────
async function doAnalyze(text) {
  if (!text || !state.apiKey) return;
  try {
    const result = await JRApi.analyze(text, state.apiKey);
    state.analysis = result;
    dom.analysisView.innerHTML = Renderer.buildAnalysis(text, result);
  } catch (e) {
    dom.analysisView.innerHTML = `<div class="ana-empty">分析失败：${ESC(e.message)}</div>`;
  }
}

// ── Saved Words ─────────────────────────────────────────────────────────────
function renderSavedWords() {
  if (!state.savedWords.length) {
    dom.savedView.innerHTML = '<div class="saved-empty">还没有收藏的单词<br>在阅读中点击单词并收藏</div>';
    return;
  }
  dom.savedView.innerHTML = '<div class="saved-list">' +
    state.savedWords.map(w => `
      <div class="saved-card" data-id="${w.id}">
        <button class="saved-del" data-id="${w.id}" title="删除">✕</button>
        <div class="sw">${ESC(w.surface)}</div>
        <div class="sr">${ESC(w.reading||'')} · ${ESC(w.pos||'')}</div>
        <div class="sd">${ESC(w.definition||'')}</div>
      </div>
    `).join('') + '</div>';

  // Tap to show detail
  dom.savedView.querySelectorAll('.saved-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('saved-del')) return;
      const id = card.dataset.id;
      const w = state.savedWords.find(s => s.id === id);
      if (w) openSheet(w.surface, w.reading, w.pos, w.grammar_note, w.definition, w.example||'', w.grammar_note||'', '');
    });
  });

  // Delete button
  dom.savedView.querySelectorAll('.saved-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      state.savedWords = state.savedWords.filter(s => s.id !== id);
      saveSavedWords();
      renderSavedWords();
      toast('已删除');
    });
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
function openSettings() { dom.settingsOverlay.classList.add('open'); dom.settingsPanel.classList.add('open'); }
function closeSettings() { dom.settingsOverlay.classList.remove('open'); dom.settingsPanel.classList.remove('open'); saveSettings(); }

dom.btnSettings.addEventListener('click', openSettings);
dom.settingsOverlay.addEventListener('click', closeSettings);
dom.settingsClose.addEventListener('click', closeSettings);

function saveSettings() {
  state.apiKey = dom.settingsApiKey.value.trim();
  state.jlptLevel = parseInt(dom.settingsJlpt.value);
  state.layers.furigana = dom.lyrFurigana.checked;
  state.layers.romaji = dom.lyrRomaji.checked;
  state.layers.pos = dom.lyrPos.checked;
  state.layers.verb = dom.lyrVerb.checked;
  state.layers.etym = dom.lyrEtym.checked;
  state.layers.grammar = dom.lyrGrammar.checked;
  state.layers.segments = dom.lyrSegments.checked;
  syncUI();
  saveState();
}

// Layer toggle changes → save immediately
QA('.layer-toggles input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', saveSettings);
});
dom.settingsApiKey.addEventListener('change', saveSettings);
dom.settingsJlpt.addEventListener('input', () => {
  dom.settingsJlptVal.textContent = `N${dom.settingsJlpt.value}`;
  dom.jlptSlider.value = dom.settingsJlpt.value;
  dom.jlptLabel.textContent = `N${dom.settingsJlpt.value}`;
  saveSettings();
});
dom.jlptSlider.addEventListener('input', () => {
  state.jlptLevel = parseInt(dom.jlptSlider.value);
  dom.jlptLabel.textContent = `N${state.jlptLevel}`;
  // Sync settings panel slider
  dom.settingsJlpt.value = state.jlptLevel;
  dom.settingsJlptVal.textContent = dom.jlptLabel.textContent;
  saveState();
});

// ── Dark theme ──────────────────────────────────────────────────────────────
dom.btnDark.addEventListener('click', () => {
  state.darkTheme = !state.darkTheme;
  document.body.classList.toggle('dark', state.darkTheme);
  dom.btnDark.textContent = state.darkTheme ? '☀️' : '🌙';
  saveState();
});

// ── Paste ───────────────────────────────────────────────────────────────────
dom.btnPaste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      dom.textInput.value = text;
      toast('已粘贴剪贴板内容');
    }
  } catch {
    toast('无法读取剪贴板，请手动粘贴');
  }
});

// ── Fetch article from URL ────────────────────────────────────────────────────
dom.btnFetch.addEventListener('click', async () => {
  const url = dom.urlInput.value.trim();
  if (!url) { toast('请输入网址'); return; }
  if (!url.startsWith('http')) { toast('请输入完整网址（https://...）'); return; }

  dom.btnFetch.disabled = true;
  dom.btnFetch.textContent = '获取中…';
  dom.readingView.innerHTML = '<div class="skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';

  try {
    const html = await fetchArticleHTML(url);
    const text = extractTextFromHTML(html);
    if (!text || text.length < 20) {
      throw new Error('未能提取到正文内容');
    }
    dom.textInput.value = text.slice(0, 3000);
    dom.urlInput.value = url; // keep URL visible
    toast(`已提取 ${text.length} 字，正在解析…`);
    // Auto-annotate
    await doAnnotate();
  } catch (e) {
    dom.readingView.innerHTML = `<div style="color:var(--accent);font-size:14px;padding:10px">获取失败：${ESC(e.message)}<br><br>提示：部分网站可能阻止跨域请求。</div>`;
    toast('获取失败: ' + e.message);
  } finally {
    dom.btnFetch.disabled = false;
    dom.btnFetch.textContent = '🔗 获取';
  }
});

// ── Annotate trigger ────────────────────────────────────────────────────────
dom.btnAnnotate.addEventListener('click', doAnnotate);

// ── Enter key on URL input → trigger fetch ─────────────────────────────────
dom.urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); dom.btnFetch.click(); }
});

// ── Init ────────────────────────────────────────────────────────────────────
function init() {
  loadState();
  syncUI();
  dom.btnDark.textContent = state.darkTheme ? '☀️' : '🌙';

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
