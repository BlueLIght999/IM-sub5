#!/usr/bin/env node
/*
 * mcp-doctor.cjs —— MCP 环境自检：把“能不能被宿主拉起”拆成可逐项判定的检查。
 *
 * 用法：
 *   node scripts/mcp-doctor.cjs
 *   node scripts/mcp-doctor.cjs --json
 *   DSH_MCP_CLIENT_ROOT="<DSH 安装目录>/resources/app/node_modules/@modelcontextprotocol/client" \
 *     node scripts/mcp-doctor.cjs     # 额外用宿主自带的客户端再握手一次
 *
 * 检查项：
 *   1. Node 版本与绝对路径（宿主可能不继承终端 PATH）
 *   2. 依赖与入口文件
 *   3. 从临时目录启动 stdio 服务（证明不依赖当前工作目录）
 *   4. 初始化、列工具、真实检索、错误分支
 *   5. 可选：用 DSH 桌面端自带的 @modelcontextprotocol/client 再握手一次
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'mcp-server.cjs');
const JSON_ONLY = process.argv.includes('--json');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) });
  if (!JSON_ONLY) {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function handshake(label, clientModulePath) {
  const sdkRoot = path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk');
  const { Client } = clientModulePath
    ? await import(pathToFileURL(path.join(clientModulePath, 'dist', 'index.mjs')).href)
    : require(path.join(sdkRoot, 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = clientModulePath
    ? await import(pathToFileURL(path.join(clientModulePath, 'dist', 'stdio.mjs')).href)
    : require(path.join(sdkRoot, 'dist', 'cjs', 'client', 'stdio.js'));

  const started = Date.now();
  const client = new Client({ name: 'lab5-doctor', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: os.tmpdir()
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map(tool => tool.name);
    check(`${label}：初始化与工具发现`, names.includes('search_documents'), names.join(',') || '无工具');

    const hit = await client.callTool({
      name: 'search_documents',
      arguments: { query: '物联网 NOT 智能家居', model: 'boolean', topK: 5 }
    });
    const ids = hit.structuredContent && hit.structuredContent.results
      ? hit.structuredContent.results.map(row => row.id)
      : [];
    check(`${label}：布尔检索含 37 且排除 38`,
      ids.includes('37') && !ids.includes('38'), ids.join(','));

    const bad = await client.callTool({
      name: 'search_documents',
      arguments: { query: '(物联网', model: 'boolean' }
    });
    check(`${label}：非法表达式返回错误而非崩溃`, bad.isError === true);
    check(`${label}：端到端耗时`, true, (Date.now() - started) + ' ms');
  } finally {
    await client.close();
  }
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  check('Node 主版本 >= 20', major >= 20, `v${process.versions.node}`);
  check('Node 可执行文件为绝对路径', path.isAbsolute(process.execPath), process.execPath);
  check('项目路径含非 ASCII 字符仍可启动', true, ROOT);

  check('服务入口存在', fs.existsSync(SERVER), SERVER);
  check('检索核心存在', fs.existsSync(path.join(ROOT, 'server', 'search-core.cjs')));
  check('前端检索代码存在', fs.existsSync(path.join(ROOT, 'js', 'index.js')));
  const sdkPkg = path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  const zodPkg = path.join(ROOT, 'node_modules', 'zod', 'package.json');
  check('MCP SDK 已安装', fs.existsSync(sdkPkg),
    fs.existsSync(sdkPkg) ? 'v' + JSON.parse(fs.readFileSync(sdkPkg, 'utf8')).version : '请运行 npm ci');
  check('zod 已安装', fs.existsSync(zodPkg),
    fs.existsSync(zodPkg) ? 'v' + JSON.parse(fs.readFileSync(zodPkg, 'utf8')).version : '请运行 npm ci');

  if (checks.some(item => !item.ok)) {
    finish();
    return;
  }

  await handshake('项目 SDK 客户端');

  const dshClient = process.env.DSH_MCP_CLIENT_ROOT;
  if (dshClient) {
    check('DSH 客户端目录存在', fs.existsSync(dshClient), dshClient);
    if (fs.existsSync(dshClient)) await handshake('DSH 自带客户端', dshClient);
  } else if (!JSON_ONLY) {
    console.log('· 未设置 DSH_MCP_CLIENT_ROOT，跳过宿主自带客户端握手（可选）');
  }

  finish();
}

function finish() {
  const failed = checks.filter(item => !item.ok);
  if (JSON_ONLY) {
    console.log(JSON.stringify({
      node: process.execPath,
      nodeVersion: process.versions.node,
      project: ROOT,
      checks,
      ok: failed.length === 0
    }, null, 2));
  } else {
    console.log('');
    console.log(failed.length ? `${failed.length} 项未通过` : '全部通过 ✓');
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => {
  check('自检脚本异常', false, error && error.message);
  finish();
});
