const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { search } = require('../server/search-core.cjs');

test('stdio discovery, search and recovery', { timeout: 15000 }, async () => {
  const client = new Client({ name: 'lab5-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, '../server/mcp-server.cjs')],
    cwd: os.tmpdir()
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['search_documents']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    const call = args => client.callTool({ name: 'search_documents', arguments: args });
    const input = { query: '物联网 NOT 智能家居', model: 'boolean', topK: 5 };
    const first = await call(input);
    assert.deepEqual(first.structuredContent, search(input));
    assert.deepEqual(JSON.parse(first.content[0].text), first.structuredContent);
    assert.equal((await call({ query: '(物联网', model: 'boolean' })).isError, true);
    assert.equal((await call({ query: ' ', topK: 0 })).isError, true);
    assert.deepEqual((await call({ query: 'zzzznonexistentxyz' })).structuredContent.results, []);
    assert.deepEqual((await call(input)).structuredContent, first.structuredContent);
  } finally {
    await client.close();
  }
});
