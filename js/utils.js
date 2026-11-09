/* =====================================================================
 * utils.js —— 通用工具：CSV 解析 / HTML 转义 / 查询词高亮 / 摘要
 * 全部为纯函数，挂载在全局命名空间 IR 下，不依赖任何第三方库
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  /**
   * CSV 解析：支持双引号包裹的字段（字段内可含逗号、换行、转义引号 ""），
   * 自动去除 UTF-8 BOM，返回二维字符串数组。
   */
  IR.parseCSV = function (text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 去 BOM
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } // 转义的引号 ""
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && text[i + 1] === '\n') i++; // CRLF
          row.push(field); field = '';
          if (row.length > 1 || row[0] !== '') rows.push(row); // 跳过空行
          row = [];
        } else field += c;
      }
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  };

  /** 正则特殊字符转义 */
  IR.escapeRegExp = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  /** HTML 转义（防止文档内容破坏页面结构） */
  IR.escapeHTML = function (s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /**
   * 查询词高亮：在（已转义的）文本中将检索词包上 <mark>。
   * 只高亮长度 ≥2 的词，避免英文单字母（如 a）整篇染色。
   */
  IR.highlight = function (text, terms) {
    const esc = IR.escapeHTML(text);
    const ts = (terms || [])
      .map(t => IR.escapeHTML(t))
      .filter(t => t.length > 1 || /[一-鿿]/.test(t))
      .map(IR.escapeRegExp)
      .sort((a, b) => b.length - a.length);
    if (!ts.length) return esc;
    return esc.replace(new RegExp('(' + ts.join('|') + ')', 'gi'), '<mark>$1</mark>');
  };

  /** 摘要：截取第一个命中词附近 ±radius 字符并高亮 */
  IR.snippet = function (text, terms, radius) {
    const r = radius === undefined ? 70 : radius;
    if (!terms || !terms.length) {
      const esc = IR.escapeHTML(text);
      return esc.length > r * 2 ? esc.slice(0, r * 2) + '…' : esc;
    }
    const lower = String(text).toLowerCase();
    let first = -1;
    for (const t of terms) {
      const i = lower.indexOf(String(t).toLowerCase());
      if (i >= 0 && (first < 0 || i < first)) first = i;
    }
    if (first < 0) return IR.escapeHTML(text).slice(0, r * 2);
    const start = Math.max(0, first - r);
    const end = Math.min(text.length, first + r);
    return (start > 0 ? '…' : '')
      + IR.highlight(text.slice(start, end), terms)
      + (end < text.length ? '…' : '');
  };

  /** 数字格式化 */
  IR.fmt = function (x, d) {
    return Number(x).toFixed(d === undefined ? 3 : d);
  };
})(typeof window !== 'undefined' ? window : globalThis);
