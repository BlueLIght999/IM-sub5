/* =====================================================================
 * porter.js —— Porter 词干提取算法（M. F. Porter, 1980）
 * 用于英文词项归一化，提升查全率：cells -> cell，relational -> relat
 * 实现参考 Porter Stemming Algorithm 官方发布的经典 JavaScript 移植版
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  IR.stem = (function () {
    const step2list = {
      ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize',
      bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
      ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive',
      fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble',
      logi: 'log'
    };
    const step3list = {
      icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic',
      ful: '', ness: ''
    };
    // 辅音/元音模式串
    const c = '[^aeiou]';
    const v = '[aeiouy]';
    const C = c + '[^aeiouy]*';                 // 辅音序列
    const V = v + '[aeiou]*';                   // 元音序列
    const mgr0 = '^(' + C + ')?' + V + C;       // 词干测度 > 0
    const meq1 = '^(' + C + ')?' + V + C + '(' + V + ')?$'; // 测度 = 1
    const mgr1 = '^(' + C + ')?' + V + C + V + C;          // 测度 > 1
    const s_v = '^(' + C + ')?' + v;            // 词干含元音

    return function (w) {
      if (w.length < 3) return w;
      const firstch = w.substr(0, 1);
      if (firstch === 'y') w = firstch.toUpperCase() + w.substr(1);

      // Step 1a：复数与第三人称
      let re = /^(.+?)(ss|i)es$/;
      let re2 = /^(.+?)([^s])s$/;
      if (re.test(w)) w = w.replace(re, '$1$2');
      else if (re2.test(w)) w = w.replace(re2, '$1$2');

      // Step 1b：过去式/进行时
      re = /^(.+?)eed$/;
      re2 = /^(.+?)(ed|ing)$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        re = new RegExp(mgr0);
        if (re.test(fp[1])) { re = /.$/; w = w.replace(re, ''); }
      } else if (re2.test(w)) {
        const fp = re2.exec(w);
        const stem = fp[1];
        re2 = new RegExp(s_v);
        if (re2.test(stem)) {
          w = stem;
          re2 = /(at|bl|iz)$/;
          const re3 = new RegExp('([^aeiouylsz])\\1$');
          const re4 = new RegExp('^' + C + v + '[^aeiouwxy]$');
          if (re2.test(w)) w = w + 'e';
          else if (re3.test(w)) { re = /.$/; w = w.replace(re, ''); }
          else if (re4.test(w)) w = w + 'e';
        }
      }

      // Step 1c：词尾 y -> i
      re = /^(.+?)y$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        const stem = fp[1];
        re = new RegExp(s_v);
        if (re.test(stem)) w = stem + 'i';
      }

      // Step 2
      re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        const stem = fp[1], suffix = fp[2];
        re = new RegExp(mgr0);
        if (re.test(stem)) w = stem + step2list[suffix];
      }

      // Step 3
      re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        const stem = fp[1], suffix = fp[2];
        re = new RegExp(mgr0);
        if (re.test(stem)) w = stem + step3list[suffix];
      }

      // Step 4
      re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
      re2 = /^(.+?)(s|t)(ion)$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        const stem = fp[1];
        re = new RegExp(mgr1);
        if (re.test(stem)) w = stem;
      } else if (re2.test(w)) {
        const fp = re2.exec(w);
        const stem = fp[1] + fp[2];
        re2 = new RegExp(mgr1);
        if (re2.test(stem)) w = stem;
      }

      // Step 5
      re = /^(.+?)e$/;
      if (re.test(w)) {
        const fp = re.exec(w);
        const stem = fp[1];
        re = new RegExp(mgr1);
        re2 = new RegExp(meq1);
        const re3 = new RegExp('^' + C + v + '[^aeiouwxy]$');
        if (re.test(stem) || (re2.test(stem) && !re3.test(stem))) w = stem;
      }
      re = /ll$/;
      re2 = new RegExp(mgr1);
      if (re.test(w) && re2.test(w)) { re = /.$/; w = w.replace(re, ''); }

      // 还原首字母大写（词首 y 的约定）
      if (firstch === 'y') w = firstch.toLowerCase() + w.substr(1);
      return w;
    };
  })();
})(typeof window !== 'undefined' ? window : globalThis);
