/* =====================================================================
 * tokenizer.js —— 中英文混合分词器
 *
 * 中文：连续汉字串切分为「单字 + 相邻二元组」。
 *   - 单字：保证单字查询（如“云”）可命中；
 *   - 二元组：多个重叠二元组（深度-度学-学习）求交集时强制相邻，
 *     等价于短语匹配，无需外部词典即可检索中文短语。
 *   停用字不参与单字与二元组（可自行修改 IR.STOP_CHARS）。
 * 英文：小写化 → 可选 Porter 词干化 → 停用词过滤。
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  // 中文停用字（构词时跳过；注意“中/对/为/于/有”等易构成实义词的字未列入）
  IR.STOP_CHARS = new Set('的了和与是及或等就都而把被之其这那也很还又从以不'.split(''));
  // 英文停用词（保守列表，保留 a/an/in/on 等以免破坏“vitamin a”“in vitro”类词组）
  IR.EN_STOP = new Set(('the of to and or for is are was were be been with from by as it its '
    + 'this that these those we you he she they our your my me us them about into over under '
    + 'after before than then so such only also too very more most some any all both each few '
    + 'other same just how what which who whom when where why at but not no can will do does '
    + 'did has have had if').split(' '));

  /**
   * tokenize(text, opts)
   *   text —— 待分词文本
   *   opts.stem —— 是否对英文做 Porter 词干化（默认 false）
   * 返回词项数组（顺序无关紧要，索引时统计词频）
   */
  IR.tokenize = function (text, opts) {
    opts = opts || {};
    const t = String(text == null ? '' : text).toLowerCase();
    const tokens = [];
    const re = /[一-鿿]+|[a-z0-9][a-z0-9\-]*/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      const s = m[0];
      if (/[一-鿿]/.test(s)) {
        // 汉字串：单字 + 相邻二元组
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (!IR.STOP_CHARS.has(ch)) tokens.push(ch);
          if (i + 1 < s.length && !IR.STOP_CHARS.has(ch) && !IR.STOP_CHARS.has(s[i + 1])) {
            tokens.push(s.slice(i, i + 2));
          }
        }
      } else {
        // 拉丁字母/数字串
        let w = s;
        if (opts.stem && /[a-z]/.test(w) && w.length > 2) w = IR.stem(w);
        if (!IR.EN_STOP.has(w)) tokens.push(w);
      }
    }
    return tokens;
  };
})(typeof window !== 'undefined' ? window : globalThis);
