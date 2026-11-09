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

test('invalid input and Boolean expressions fail', () => {
  for (const input of [null, {}, {query:' '}, {query:'x', model:'other'},
    ...[0, 21, 1.5, '5'].map(topK => ({query:'x', topK})),
    {query:'(物联网', model:'boolean'}]) {
    assert.throws(() => search(input));
  }
});
