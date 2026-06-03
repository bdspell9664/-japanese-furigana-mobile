/**
 * renderer.js — MOJi-style inline annotation renderer
 *
 * Takes original text + API response (words[], structure[]) → produces
 * annotated HTML with furigana, grammar tags, segment underlines.
 */

const ESC = s => { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML; };

// ── Color maps ──────────────────────────────────────────────────────────────

const GRAMMAR_COLORS = {
  '主語':'#2563eb','述語':'#d43d3d','目的語':'#059669',
  '連体修飾語':'#7c3aed','連用修飾語':'#d97706','補語':'#0891b2',
  '助詞':'#6b7280','接続詞':'#db2777','独立語':'#4f46e5','並列語':'#ca8a04',
  modify:'#7c3aed',
};
const GRAMMAR_SHORT = {
  '主語':'主','述語':'述','目的語':'宾','連体修飾語':'定','連用修飾語':'状',
  '補語':'补','助詞':'助','接続詞':'接','独立語':'独','並列語':'并',
  modify:'修',
};
const SEGMENT_COLORS = {
  '主語部':'#2563eb','述語部':'#d43d3d','修飾部':'#7c3aed',
  '接続部':'#db2777','独立部':'#4f46e5',
};

// ── Public API ──────────────────────────────────────────────────────────────

const Renderer = {

  /**
   * Render annotated text HTML.
   * @param {string} text - Original text
   * @param {Array} words - [{surface, reading, romaji, pos, verb_type, origin, grammar_role, base_form}]
   * @param {Array|null} structure - [{type, surfaces:[]}]
   * @param {object} layers - {furigana, romaji, pos, verb, etym, grammar, segments}
   * @returns {string} HTML string
   */
  render(text, words, structure, layers) {
    if (!words || !words.length) return ESC(text);

    // Build surface→info map
    const map = new Map();
    for (const w of words) {
      if (!w.annotate || !w.surface) continue;
      // Keep longest match first
      if (!map.has(w.surface) || w.surface.length > (map.get(w.surface).surface||'').length) {
        map.set(w.surface, w);
      }
    }

    // Build segment index: for each char position, which segment type
    let segMap = null;
    if (layers.segments && structure && structure.length) {
      segMap = new Map(); // charIndex → segment type
      let fullText = text;
      for (const seg of structure) {
        if (!seg.surfaces) continue;
        const segText = seg.surfaces.join('');
        let pos = 0;
        while ((pos = fullText.indexOf(segText, pos)) !== -1) {
          for (let i = pos; i < pos + segText.length; i++) {
            segMap.set(i, seg.type);
          }
          pos++;
        }
      }
    }

    // Sort keys by length desc for greedy matching
    const keys = [...map.keys()].sort((a,b) => b.length - a.length);

    // Walk through text character by character, building HTML
    let html = '';
    let i = 0;
    while (i < text.length) {
      // Try to match a known word at position i
      let matched = false;
      for (const k of keys) {
        if (text.startsWith(k, i)) {
          const info = map.get(k);
          html += this._buildWord(k, info, layers, segMap, i);
          i += k.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Unmatched char — check if it's part of a segment
        if (segMap && segMap.has(i)) {
          const segType = segMap.get(i);
          const color = SEGMENT_COLORS[segType] || '#ccc';
          html += `<span class="rw-seg" style="--seg:${color}">${ESC(text[i])}</span>`;
        } else {
          html += ESC(text[i]);
        }
        i++;
      }
    }

    return html;
  },

  /**
   * Build HTML for one annotated word.
   */
  _buildWord(surface, info, layers, segMap, startIdx) {
    const cls = [];
    const parts = [];
    const dataAttrs = [];

    // Determine segment type for this word
    let segType = null;
    if (segMap && segMap.has(startIdx)) {
      segType = segMap.get(startIdx);
    }
    if (segType) {
      cls.push('rw-seg');
      dataAttrs.push(`data-seg="${ESC(segType)}"`);
    }

    // Grammar role
    const gr = info.grammar_role || null;
    if (gr) {
      dataAttrs.push(`data-grammar="${ESC(gr)}"`);
      if (info.base_form) dataAttrs.push(`data-base="${ESC(info.base_form)}"`);
    }
    if (info.reading) dataAttrs.push(`data-reading="${ESC(info.reading)}"`);
    if (info.pos) dataAttrs.push(`data-pos="${ESC(info.pos)}"`);

    // Word container
    parts.push(`<span class="rw-word ${cls.join(' ')}" data-surface="${ESC(surface)}" ${dataAttrs.join(' ')}>`);

    // Ruby: surface + reading + romaji
    parts.push('<ruby>');
    parts.push(ESC(surface));
    if (layers.furigana && info.reading) {
      parts.push(`<rt class="rw-furi">${ESC(info.reading)}</rt>`);
    }
    if (layers.romaji && info.romaji) {
      parts.push(`<rt class="rw-roma">${ESC(info.romaji)}</rt>`);
    }
    parts.push('</ruby>');

    // POS tag
    if (layers.pos && info.pos) {
      parts.push(`<sup class="rw-pos">[${ESC(info.pos)}]</sup>`);
    }

    // Grammar role tag
    if (layers.grammar && gr) {
      const color = GRAMMAR_COLORS[gr] || '#888';
      const short = GRAMMAR_SHORT[gr] || gr;
      parts.push(`<sup class="rw-grammar" style="--gc:${color}" title="${ESC(gr)}${info.base_form?' → '+ESC(info.base_form):''}">${short}</sup>`);
    }

    // Verb type tag
    if (layers.verb && info.verb_type) {
      parts.push(`<sup class="rw-verb">[${ESC(info.verb_type)}]</sup>`);
    }

    // Etymology tag
    if (layers.etym && info.origin) {
      parts.push(`<sup class="rw-etym">[${ESC(info.origin)}]</sup>`);
    }

    parts.push('</span>');
    return parts.join('');
  },

  /**
   * Build analysis HTML for the "Analysis" tab.
   */
  buildAnalysis(text, analysis) {
    if (!analysis) return '<div class="ana-empty">暂无深度分析结果</div>';
    let html = '';

    if (analysis.sentence_type || analysis.politeness_level) {
      html += '<div class="ana-badges">';
      if (analysis.sentence_type) html += `<span class="ana-badge">${ESC(analysis.sentence_type)}</span>`;
      if (analysis.politeness_level) html += `<span class="ana-badge">${ESC(analysis.politeness_level)}</span>`;
      html += '</div>';
    }

    if (analysis.structure) {
      html += `<div class="ana-sec"><div class="ana-label">句子结构</div><pre class="ana-struc">${ESC(analysis.structure)}</pre></div>`;
    }

    if (analysis.grammar_points && analysis.grammar_points.length) {
      html += '<div class="ana-sec"><div class="ana-label">语法点</div>';
      for (const gp of analysis.grammar_points) {
        const pt = typeof gp === 'string' ? gp : gp.point||'';
        const ds = typeof gp === 'string' ? '' : gp.description||'';
        html += `<div class="ana-gp"><div class="ana-gp-name">${ESC(pt)}</div><div class="ana-gp-desc">${ESC(ds)}</div></div>`;
      }
      html += '</div>';
    }

    if (analysis.word_analysis && analysis.word_analysis.length) {
      html += '<div class="ana-sec"><div class="ana-label">逐词分析</div><div class="ana-table-wrap"><table class="ana-table"><thead><tr><th>词</th><th>读音</th><th>角色</th><th>原形</th></tr></thead><tbody>';
      for (const wa of analysis.word_analysis) {
        if (!wa.word) continue;
        html += `<tr><td class="wa-w">${ESC(wa.word)}</td><td>${ESC(wa.reading||'')}</td><td class="wa-r">${ESC(wa.role||'')}</td><td>${ESC(wa.base_form||'')}</td></tr>`;
      }
      html += '</tbody></table></div></div>';
    }

    if (analysis.translation) {
      html += `<div class="ana-sec"><div class="ana-label">中文翻译</div><div class="ana-trans">${ESC(analysis.translation)}</div></div>`;
    }

    return html || '<div class="ana-empty">暂无分析内容</div>';
  },

  /**
   * Extract plain text without annotations for display purposes.
   */
  stripAnnotations(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || '';
  },
};

// Export
if (typeof module !== 'undefined' && module.exports) module.exports = Renderer;
