const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { search } = require('./search-core.cjs');

const server = new McpServer({ name: 'lab5-search', version: '1.0.0' });
server.registerTool('search_documents', {
  description: '检索实验5的60篇中文示例文档。布尔查询支持 AND、OR、NOT 和括号。返回文档ID、标题、分数和正文片段。',
  inputSchema: {
    query: z.string().trim().min(1).max(300),
    model: z.enum(['boolean', 'vector', 'bm25']).optional(),
    topK: z.number().int().min(1).max(20).optional()
  },
  annotations: { readOnlyHint: true, openWorldHint: false }
}, input => {
  try {
    const result = search(input);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result
    };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
