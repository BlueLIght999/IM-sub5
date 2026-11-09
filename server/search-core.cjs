const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let engine;

function loadEngine() {
  const context = vm.createContext({});
  for (const name of ['utils', 'porter', 'tokenizer', 'index', 'models', 'data']) {
    const filename = path.join(__dirname, '..', 'js', name + '.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  const { IR } = context;
  const docs = IR.parseCSV(IR.SAMPLE_CSV).slice(1).map(
    ([id, title, content, category]) => ({ id, title, content, category })
  );
  return { IR, index: IR.buildIndex(docs, { stem: true }) };
}

function search(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('检索参数必须是对象');
  }
  const { query: rawQuery, model = 'bm25', topK = 10 } = input;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (!query || query.length > 300) throw new Error('查询长度须为 1–300 字符');
  if (!['boolean', 'vector', 'bm25'].includes(model)) throw new Error('未知检索模型');
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new Error('topK 须为 1–20 的整数');
  }
  const { IR, index } = engine ??= loadEngine();
  let ranked;
  if (model === 'boolean') {
    ranked = IR.searchBoolean(index, query).slice(0, topK);
  } else if (model === 'vector') {
    ranked = IR.searchVector(index, query, topK);
  } else {
    ranked = IR.searchBM25(index, query, topK, 1.2, 0.75);
  }
  const results = Array.from(ranked, ({ id, score }) => {
    const { title, content } = index.docById.get(id);
    return { id, title, score, excerpt: content.slice(0, 180) };
  });
  return { dataset: 'sample-zh', query, model, topK, returned: results.length, results };
}

module.exports = { search };
