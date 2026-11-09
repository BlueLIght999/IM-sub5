/* =====================================================================
 * smoke.js —— 冒烟测试（无需浏览器）
 * 用法：node test/smoke.js
 * 验证：Porter 词干化 / 中英文分词 / CSV 解析 / 倒排索引 /
 *       布尔表达式解析 / 向量与 BM25 检索 / 评测指标 / PubMed 数据链路
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = ['js/utils.js', 'js/porter.js', 'js/tokenizer.js', 'js/index.js', 'js/models.js', 'js/evaluation.js', 'js/data.js'];
const ctx = { console };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const IR = ctx.IR;

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? ' — ' + extra : ''));
  if (!cond) fail++;
};

console.log('== 1. Porter 词干化 ==');
const stemPairs = [
  ['caresses', 'caress'], ['ponies', 'poni'], ['agreed', 'agre'], ['plastered', 'plaster'],
  ['motoring', 'motor'], ['sing', 'sing'], ['happy', 'happi'], ['relational', 'relat'],
  ['conditional', 'condit'], ['triplicate', 'triplic'], ['electriciti', 'electr'],
  ['hopeful', 'hope'], ['revival', 'reviv'], ['probate', 'probat'], ['rate', 'rate'],
  ['cease', 'ceas'], ['controll', 'control'], ['roll', 'roll']
];
for (const [w, e] of stemPairs) check('stem(' + w + ')=' + e, IR.stem(w) === e, IR.stem(w));

console.log('== 2. 分词 ==');
check('中文单字+二元组',
  JSON.stringify(IR.tokenize('区块链技术')) === JSON.stringify(['区', '区块', '块', '块链', '链', '链技', '技', '技术', '术']),
  JSON.stringify(IR.tokenize('区块链技术')));
check('停用字过滤', IR.tokenize('的的的').length === 0);
check('英文小写+停用词+词干化', JSON.stringify(IR.tokenize('The Cats run', { stem: true })) === JSON.stringify(['cat', 'run']),
  JSON.stringify(IR.tokenize('The Cats run', { stem: true })));

console.log('== 3. CSV 解析 ==');
const rows = IR.parseCSV(IR.SAMPLE_CSV);
check('示例数据 61 行（含表头）', rows.length === 61, rows.length + ' 行');
check('表头正确', rows[0].join(',') === 'id,title,content,category');
const quoted = IR.parseCSV('a,"b,1","c""d"\n');
check('带引号字段', quoted.length === 1 && quoted[0][1] === 'b,1' && quoted[0][2] === 'c"d', JSON.stringify(quoted));

console.log('== 4. 建索引与检索 ==');
const docs = rows.slice(1).map(r => ({ id: String(r[0]), title: r[1], content: r[2], category: r[3] }));
const idx = IR.buildIndex(docs);
check('文档数 60', idx.N === 60);
check('词项数 > 500', idx.postings.size > 500, idx.postings.size + ' 个');
const b1 = IR.searchBoolean(idx, '深度学习 AND 神经网络').map(r => r.id);
check('布尔 AND 命中 {11,13,14,15,18}', b1.length === 5 && ['11', '13', '14', '15', '18'].every(x => b1.includes(x)), b1.join(','));
const b2 = IR.searchBoolean(idx, '(区块链 OR 比特币) NOT 智能家居').map(r => r.id);
check('布尔 OR+NOT', b2.includes('31') && b2.includes('32') && !b2.includes('38'), b2.length + ' 篇');
const b3 = IR.searchBoolean(idx, '物联网 NOT 智能家居').map(r => r.id);
check('布尔 NOT', b3.includes('37') && !b3.includes('38'), b3.join(','));
const v1 = IR.searchVector(idx, '图像识别 目标检测', 10).map(r => r.id);
check('向量 top10 含 CV 文档', ['25', '26'].every(x => v1.includes(x)), v1.join(','));
const p1 = IR.searchBM25(idx, '网络安全 黑客 攻击', 10).map(r => r.id);
const sec = ['49', '50', '51', '52', '53', '54'];
check('BM25 前 5 均为网络安全类', p1.slice(0, 5).every(x => sec.includes(x)), p1.join(','));
check('BM25 前 10 覆盖 49-54 全部', sec.every(x => p1.includes(x)), p1.join(','));

console.log('== 5. 标准评测（10 查询 × 3 模型） ==');
const defs = [
  ['布尔模型', q => IR.searchBoolean(idx, q).map(r => r.id)],
  ['向量模型', q => IR.searchVector(idx, q, 50).map(r => r.id)],
  ['BM25模型', q => IR.searchBM25(idx, q, 50, 1.2, 0.75).map(r => r.id)]
];
const results = {};
for (const [name, fn] of defs) {
  const r = IR.runEvaluation(IR.SAMPLE_QUERIES, fn, 10, 50);
  results[name] = r;
  console.log('  ' + name + ': P@10=' + r.avg.Pk.toFixed(3) + '  R@10=' + r.avg.Rk.toFixed(3) +
    '  F1=' + r.avg.F1.toFixed(3) + '  MAP=' + r.avg.AP.toFixed(3));
}
check('向量 MAP > 0.85', results['向量模型'].avg.AP > 0.85);
check('BM25 MAP > 0.85', results['BM25模型'].avg.AP > 0.85);
check('布尔 MAP 在 0.15~0.7 之间（体现 AND 语义的查全率损失）',
  results['布尔模型'].avg.AP > 0.15 && results['布尔模型'].avg.AP < 0.7, results['布尔模型'].avg.AP.toFixed(3));
check('布尔查全率低于 BM25', results['布尔模型'].avg.Rk < results['BM25模型'].avg.Rk);

console.log('== 6. PubMed 规模测试（前 2000 篇 / 全量） ==');
if (fs.existsSync(path.join(root, 'js', 'pubmed.js'))) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'pubmed.js'), 'utf8'), ctx, { filename: 'pubmed.js' });
  const prows = IR.parseCSV(IR.PUBMED_CSV);
  console.log('  CSV 总行数: ' + prows.length);
  const header = prows[0];
  const hi = {};
  header.forEach((h, i) => { hi[String(h).toLowerCase()] = i; });
  check('PubMed 表头含 PMID/Title', hi['pmid'] >= 0 && hi['title'] >= 0);
  const pdocs = prows.slice(1).map(r => ({
    id: String(r[hi['pmid']]),
    title: r[hi['title']] || '',
    content: (r[hi['title']] || '') + ' ' + (r[hi['authors']] || '') + ' ' + (r[hi['journal/book']] || ''),
    authors: r[hi['authors']] || '',
    journal: r[hi['journal/book']] || '',
    year: r[hi['publication year']] || ''
  }));
  check('PubMed 全量 5820 篇且 PMID 唯一',
    pdocs.length === 5820 && new Set(pdocs.map(d => d.id)).size === pdocs.length &&
      pdocs.every(d => /^\d+$/.test(d.id)));
  for (const [label, docs] of [['前 2000 篇', pdocs.slice(0, 2000)], ['全量', pdocs]]) {
    const started = performance.now();
    const pidx = IR.buildIndex(docs, { stem: true });
    const indexMs = performance.now() - started;
    check(label + '建索引', pidx.N === docs.length && pidx.docById.size === docs.length,
      pidx.N + ' 篇 / ' + pidx.postings.size + ' 个词项 / ' + indexMs.toFixed(2) + ' ms');
    for (const query of ['artificial intelligence drug', 'covid-19 vaccine', 'machine learning']) {
      const run = () => IR.searchBM25(pidx, query, 5, 1.2, 0.75);
      const hits = run();
      const times = Array.from({ length: 7 }, () => {
        const start = performance.now();
        run();
        return performance.now() - start;
      }).sort((a, b) => a - b);
      check(query, hits.length === 5 && new Set(hits.map(hit => hit.id)).size === 5 &&
        hits.every((hit, i) => pidx.docById.has(hit.id) && Number.isFinite(hit.score) &&
          hit.score > 0 && (i === 0 || hits[i - 1].score >= hit.score)),
        'Top-5 / 查询中位数 ' + times[3].toFixed(2) + ' ms');
      hits.forEach(hit => console.log('    ' + hit.id + ' | ' + pidx.docById.get(hit.id).title));
    }
  }
} else {
  check('缺少 js/pubmed.js，请运行 node test/build-pubmed.js', false);
}

console.log('');
console.log(fail ? '有 ' + fail + ' 项未通过' : '全部通过 ✓');
process.exit(fail ? 1 : 0);
