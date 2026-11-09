/* =====================================================================
 * models.js —— 向量空间模型（TF-IDF + 余弦相似度）与概率模型（BM25）
 *
 * 向量空间模型（Salton）：
 *   tf  = 1 + ln(tf)            （对数压缩词频）
 *   idf = ln(1 + N/df)          （逆文档频率，稀有词权重高）
 *   w   = tf * idf；文档与查询向量均做 L2 归一化
 *   sim(d,q) = Σ w(t,d)·w(t,q) / (‖d‖·‖q‖)     （夹角余弦）
 *
 * 概率模型 BM25（Okapi，源自 Robertson & Sparck Jones 的 BIM）：
 *   RSV(d,q) = Σ_t∈q  IDF(t) · f(t,d)·(k1+1) / (f(t,d) + k1·(1 − b + b·dl/avgdl))
 *   IDF(t) = ln((N − df + 0.5)/(df + 0.5) + 1)
 *   k1：词频饱和（默认 1.2）；b：文档长度归一化（默认 0.75）
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  /** 计算词项序列的 TF-IDF 权重向量（L2 归一化） */
  IR.weightVector = function (idx, tokens) {
    const tf = new Map();
    for (const tk of tokens) tf.set(tk, (tf.get(tk) || 0) + 1);
    const vec = new Map();
    let norm2 = 0;
    for (const [tk, f] of tf) {
      const p = idx.postings.get(tk);
      if (!p) continue;
      const w = (1 + Math.log(f)) * Math.log(1 + idx.N / p.df);
      vec.set(tk, w);
      norm2 += w * w;
    }
    return { vec: vec, norm: Math.sqrt(norm2) };
  };

  /** 向量空间模型检索：返回 [{id, score=余弦相似度}]，按分数降序 */
  IR.searchVector = function (idx, q, k) {
    const qt = IR.tokenize(q, idx.opts);
    if (!qt.length) return [];
    const qv = IR.weightVector(idx, qt); // 查询向量与文档向量同规则加权
    if (qv.norm === 0) return [];
    // 候选集：所有查询 token 的倒排记录并集
    const cand = new Set();
    for (const tk of new Set(qt)) {
      const p = idx.postings.get(tk);
      if (p) for (const o of p.docs) cand.add(o.id);
    }
    const scores = [];
    for (const id of cand) {
      const dv = idx.docVec.get(id); // 建索引时已预计算
      if (!dv || dv.norm === 0) continue;
      let dot = 0;
      for (const [tk, w] of qv.vec) {
        if (dv.vec.has(tk)) dot += w * dv.vec.get(tk);
      }
      const sim = dot / (qv.norm * dv.norm);
      if (sim > 0) scores.push({ id: id, score: sim });
    }
    scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, undefined, { numeric: true }));
    return k ? scores.slice(0, k) : scores;
  };

  /** BM25 概率模型检索：返回 [{id, score}]，按分数降序 */
  IR.searchBM25 = function (idx, q, k, k1, b) {
    k1 = k1 === undefined ? 1.2 : k1;
    b = b === undefined ? 0.75 : b;
    const qt = IR.tokenize(q, idx.opts);
    if (!qt.length) return [];
    const qtf = new Map();
    for (const tk of qt) qtf.set(tk, (qtf.get(tk) || 0) + 1);
    const cand = new Set();
    for (const tk of qtf.keys()) {
      const p = idx.postings.get(tk);
      if (p) for (const o of p.docs) cand.add(o.id);
    }
    const scores = [];
    for (const id of cand) {
      const dl = idx.docLen.get(id) || 0;
      const tfs = idx.docTF.get(id);
      let s = 0;
      for (const [tk, fq] of qtf) {
        const p = idx.postings.get(tk);
        if (!p) continue;
        const f = tfs.get(tk) || 0;
        if (f === 0) continue;
        const idf = Math.log((idx.N - p.df + 0.5) / (p.df + 0.5) + 1);
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / idx.avgdl));
      }
      if (s > 0) scores.push({ id: id, score: s });
    }
    scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, undefined, { numeric: true }));
    return k ? scores.slice(0, k) : scores;
  };
})(typeof window !== 'undefined' ? window : globalThis);
