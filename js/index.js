/* =====================================================================
 * index.js —— 倒排索引构建 + 布尔模型检索
 *
 * 倒排索引结构：
 *   postings: Map<词项, { df, docs: [{id, tf}] }>
 *   每个文档存 docTokens（词项序列）、docTF（词项->词频）、docLen（长度）
 *
 * 布尔模型：查询为词项组成的布尔表达式（AND / OR / NOT / 括号，支持中文），
 *   利用倒排记录做集合运算；AND=交集、OR=并集、NOT=补集。
 *   布尔模型本质返回无序集合，本实现按“匹配词项累计词频”降序排列，
 *   仅为结果展示与性能评测（P@k、MAP）需要。
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  /**
   * 构建倒排索引（三种模型共用）
   * docs: [{id, title, content, ...}]
   * opts: {stem} —— 英文是否词干化
   */
  IR.buildIndex = function (docs, opts) {
    opts = opts || {};
    const postings = new Map();
    const docById = new Map();
    const docTokens = new Map();
    const docTF = new Map();
    const docLen = new Map();
    let totalLen = 0;

    // 第一遍：分词、统计词频、生成倒排记录
    for (const d of docs) {
      const id = String(d.id);
      docById.set(id, d);
      const toks = IR.tokenize((d.title || '') + ' ' + (d.content || ''), opts);
      docTokens.set(id, toks);
      docLen.set(id, toks.length);
      totalLen += toks.length;
      const tf = new Map();
      for (const tk of toks) tf.set(tk, (tf.get(tk) || 0) + 1);
      docTF.set(id, tf);
      for (const [tk, f] of tf) {
        if (!postings.has(tk)) postings.set(tk, { df: 0, docs: [] });
        const p = postings.get(tk);
        p.df += 1;
        p.docs.push({ id: id, tf: f });
      }
    }

    const idx = {
      docs, docById, docTokens, docTF, docLen, postings,
      N: docs.length,
      avgdl: docs.length ? totalLen / docs.length : 0,
      opts: opts
    };

    // 第二遍：预计算每个文档的 TF-IDF 权重向量（向量模型用，见 models.js）
    idx.docVec = new Map();
    for (const [id, toks] of docTokens) idx.docVec.set(id, IR.weightVector(idx, toks));

    return idx;
  };

  /**
   * 单个原始检索词（如“深度学习”“artificial”）的倒排记录。
   * 该词按分词规则拆成若干内部 token，求其倒排记录的交集：
   * 对中文重叠二元组而言，「全部二元组同时出现」≈ 短语匹配。
   * 返回 Map<docId, 累计词频>（用于布尔结果的排序打分）。
   */
  IR.termPostings = function (idx, rawTerm) {
    const toks = IR.tokenize(rawTerm, idx.opts);
    if (!toks.length) return null;
    let result = null;
    for (const tk of toks) {
      const p = idx.postings.get(tk);
      if (!p) return new Map();
      const cur = new Map();
      for (const o of p.docs) cur.set(o.id, o.tf);
      if (result === null) result = cur;
      else {
        const next = new Map();
        for (const [id, tf] of result) {
          if (cur.has(id)) next.set(id, tf + cur.get(id));
        }
        result = next;
      }
    }
    return result;
  };

  /** 词法分析：把查询串拆成 词项 / AND / OR / NOT / ( ) */
  IR.lexQuery = function (q) {
    const out = [];
    const re = /[a-zA-Z0-9一-鿿][a-zA-Z0-9一-鿿\-]*|\(|\)|\S/g;
    let m;
    const s = String(q || '');
    while ((m = re.exec(s)) !== null) {
      const w = m[0];
      const up = w.toUpperCase();
      if (up === 'AND' || up === 'OR' || up === 'NOT') out.push({ type: 'op', t: up });
      else if (w === '(' || w === ')') out.push({ type: 'op', t: w });
      else out.push({ type: 'term', t: w });
    }
    return out;
  };

  /** 提取查询中的原始检索词（排除运算符），用于结果高亮 */
  IR.extractQueryTerms = function (q) {
    return IR.lexQuery(q).filter(x => x.type === 'term').map(x => x.t);
  };

  /**
   * 布尔表达式解析（递归下降），文法：
   *   expr  := or
   *   or    := and (OR and)*
   *   and   := unary ((AND)? unary)*      —— 两个词项相邻视为隐式 AND
   *   unary := NOT unary | '(' expr ')' | term
   * 返回相关文档 id 的 Set（无序集合）。
   */
  IR.parseBoolean = function (idx, q) {
    const lex = IR.lexQuery(q);
    let pos = 0;
    const peek = () => lex[pos];
    const next = () => lex[pos++];
    const union = (a, b) => { const s = new Set(a); for (const x of b) s.add(x); return s; };
    const inter = (a, b) => { const s = new Set(); for (const x of a) if (b.has(x)) s.add(x); return s; };
    const complement = (a) => {
      const s = new Set(idx.docById.keys());
      for (const x of a) s.delete(x);
      return s;
    };

    function parseOr() {
      let left = parseAnd();
      while (peek() && peek().t === 'OR') { next(); left = union(left, parseAnd()); }
      return left;
    }
    function parseAnd() {
      let left = parseUnary();
      while (peek() && peek().t !== 'OR' && peek().t !== ')') {
        if (peek().t === 'AND') next();
        left = inter(left, parseUnary());
      }
      return left;
    }
    function parseUnary() {
      const tk = next();
      if (!tk) return new Set();
      if (tk.t === 'NOT') return complement(parseUnary());
      if (tk.t === '(') {
        const inner = parseOr();
        if (peek() && peek().t === ')') next();
        else throw new Error('括号不匹配');
        return inner;
      }
      if (tk.type !== 'term') throw new Error('查询语法错误');
      const m = IR.termPostings(idx, tk.t);
      return m ? new Set(m.keys()) : new Set();
    }

    const res = parseOr();
    if (pos < lex.length) throw new Error('查询语法错误：存在多余内容');
    return res;
  };

  /**
   * 布尔检索：返回 [{id, score}]，score = 查询中各词项在文档中的累计词频，
   * 按 score 降序排列（布尔模型本身无序，排序仅为展示与评测）。
   */
  IR.searchBoolean = function (idx, q) {
    const set = IR.parseBoolean(idx, q);
    const terms = IR.extractQueryTerms(q);
    const scored = [];
    for (const id of set) {
      let score = 0;
      for (const tm of terms) {
        const m = IR.termPostings(idx, tm);
        if (m && m.has(id)) score += m.get(id);
      }
      scored.push({ id: id, score: score });
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, undefined, { numeric: true }));
    return scored;
  };
})(typeof window !== 'undefined' ? window : globalThis);
