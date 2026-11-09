const test = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../server/search-core.cjs');

test('Boolean baseline and exclusions', () => {
  const result = search({ query: '深度学习 AND 神经网络', model: 'boolean' });
  assert.equal(result.dataset, 'sample-zh');
  assert.equal(result.returned, 5);
  assert.deepEqual(result.results.map(row => row.id).sort(), ['11','13','14','15','18']);
  const ids = search({ query: '物联网 NOT 智能家居', model: 'boolean', topK: 5 }).results.map(row => row.id);
  assert.ok(ids.includes('37') && !ids.includes('38'));
});

test('ranked search is repeatable and bounded', () => {
  for (const model of ['vector', 'bm25']) {
    const request = { query: '网络安全 黑客 攻击', model, topK: 3 };
    const result = search(request);
    assert.equal(result.returned, 3);
    assert.equal(new Set(result.results.map(row => row.id)).size, 3);
    assert.ok(result.results.every(row => Number.isFinite(row.score) && row.title && row.excerpt));
    assert.deepEqual(result, search(request));
  }
  assert.deepEqual(search({query: 'zzzznonexistentxyz'}).results, []);
});

test('Boolean scoring preserves semantics without rebuilding postings per hit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const context = vm.createContext({});
  for (const name of ['utils', 'porter', 'tokenizer', 'index', 'models']) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'),
      context
    );
  }
  const { IR } = context;
  const docs = [
    { id: '10', title: '', content: 'alpha beta' },
    { id: '2', title: '', content: 'alpha beta' },
    { id: '3', title: '', content: 'alpha alpha gamma' },
    { id: '4', title: '', content: 'gamma' }
  ];
  const idx = IR.buildIndex(docs, { stem: false });
  const pairs = result => Array.from(result, row => [row.id, row.score]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'alpha OR alpha')),
    [['3', 4], ['2', 2], ['10', 2]]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'alpha NOT beta')), [['3', 2]]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'NOT beta')), [['3', 0], ['4', 0]]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, '(alpha OR gamma) NOT beta')),
    [['3', 3], ['4', 1]]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'alpha OR gamma NOT beta')),
    [['3', 3], ['2', 2], ['10', 2], ['4', 1]]);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'the')), []);
  assert.deepEqual(pairs(IR.searchBoolean(idx, 'zzzznonexistentxyz')), []);
  assert.throws(() => IR.searchBoolean(idx, '(alpha'));

  const originalPostings = IR.termPostings;
  let calls = 0;
  IR.termPostings = (index, term) => {
    calls++;
    return originalPostings(index, term);
  };
  try {
    IR.searchBoolean(idx, 'alpha OR beta');
    assert.ok(calls <= 4, 'two terms require at most four postings builds');
  } finally {
    IR.termPostings = originalPostings;
  }
});

test('invalid input and Boolean expressions fail', () => {
  for (const input of [null, {}, {query:' '}, {query:'x', model:'other'},
    ...[0, 21, 1.5, '5'].map(topK => ({query:'x', topK})),
    {query:'(物联网', model:'boolean'}]) {
    assert.throws(() => search(input));
  }
});
