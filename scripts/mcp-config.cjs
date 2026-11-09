#!/usr/bin/env node
/*
 * mcp-config.cjs —— 生成 DeepSeekHarness / Codex 的 MCP 配置，消除“手改路径”带来的环境差异。
 *
 * 用法：
 *   node scripts/mcp-config.cjs                 # 生成 dsh.lab5.local.yml（默认）
 *   node scripts/mcp-config.cjs --host codex    # 生成 codex.lab5.mcp.toml
 *   node scripts/mcp-config.cjs --host both     # 两份都生成
 *   node scripts/mcp-config.cjs --print         # 只打印，不写文件
 *   node scripts/mcp-config.cjs --out <路径>    # 写到指定文件
 *
 * 设计要点：
 * 1. 固定使用当前 Node 的绝对路径（process.execPath），不依赖宿主进程的 PATH；
 *    桌面宿主从图形界面启动时 PATH 常常与终端不同，`command: node` 会因此 spawn ENOENT。
 * 2. 路径统一写成正斜杠绝对路径，中文、空格原样保留；不做 URL 编码。
 * 3. 输出同时带 `cwd`，避免宿主用别的目录启动服务器。
 * 4. 不修改任何全局配置；Codex 的片段需要用户自行合并到 ~/.codex/config.toml。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'mcp-server.cjs');
const NODE = process.execPath;
const toPosix = value => value.replace(/\\/g, '/');

function parseArgs(argv) {
  const options = { host: 'dsh', print: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--print') options.print = true;
    else if (arg === '--host') options.host = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!['dsh', 'codex', 'both'].includes(options.host)) {
    throw new Error('--host 只支持 dsh、codex 或 both');
  }
  return options;
}

/** YAML 单引号字符串：内部的单引号写成两个单引号。 */
const yamlString = value => `'${String(value).replace(/'/g, "''")}'`;

/** TOML 基本字符串：转义反斜杠与双引号；路径已转正斜杠，通常无需转义。 */
const tomlString = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function dshPatch() {
  return [
    '# 由 scripts/mcp-config.cjs 生成；不要提交到仓库（已写入 .gitignore）。',
    '# 用 --patch 传给 DSH：npx @deepseek-ai/dsh --profile web --patch ./dsh.lab5.local.yml',
    '- insert:',
    '    - id: mcp-lab5',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: lab5',
    '        transport: stdio',
    `        command: ${yamlString(toPosix(NODE))}`,
    `        args: [${yamlString(toPosix(SERVER))}]`,
    `        cwd: ${yamlString(toPosix(ROOT))}`,
    ''
  ].join('\n');
}

function codexConfig() {
  return [
    '# 由 scripts/mcp-config.cjs 生成。',
    '# 合并到用户级 ~/.codex/config.toml（Codex 的 MCP 配置是宿主全局的，不能放在项目内自动生效）。',
    '# 若已有 [mcp_servers.lab5]，先删除旧表再追加；不要把本文件整体覆盖 config.toml。',
    '[mcp_servers.lab5]',
    `command = ${tomlString(toPosix(NODE))}`,
    `args = [${tomlString(toPosix(SERVER))}]`,
    `cwd = ${tomlString(toPosix(ROOT))}`,
    'tool_timeout_sec = 60',
    ''
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/mcp-config.cjs [--host dsh|codex|both] [--print] [--out <路径>]');
    return;
  }
  if (!fs.existsSync(SERVER)) throw new Error(`找不到 MCP 服务入口：${SERVER}`);
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk'))) {
    throw new Error('缺少依赖，请先在项目根运行 npm ci');
  }

  const outputs = [];
  if (options.host === 'dsh' || options.host === 'both') {
    outputs.push({
      label: 'DSH patch',
      content: dshPatch(),
      file: options.out || path.join(ROOT, 'dsh.lab5.local.yml'),
      hint: '启动：npx.cmd --yes @deepseek-ai/dsh@0.2.1-rc.1 --profile web --patch ./dsh.lab5.local.yml'
    });
  }
  if (options.host === 'codex' || options.host === 'both') {
    const defaultOut = path.join(ROOT, 'codex.lab5.mcp.toml');
    outputs.push({
      label: 'Codex 片段',
      content: codexConfig(),
      file: options.host === 'both' ? defaultOut : options.out || defaultOut,
      hint: '把生成内容合并进 %USERPROFILE%\\.codex\\config.toml，然后重启 Codex'
    });
  }

  for (const output of outputs) {
    if (options.print) {
      console.log(`# ---- ${output.label} ----`);
      console.log(output.content);
      console.log(output.hint);
    } else {
      fs.writeFileSync(output.file, output.content, 'utf8');
      console.log(`已写入 ${output.label}：${output.file}`);
      console.log(`  node   : ${NODE}`);
      console.log(`  server : ${SERVER}`);
      console.log(`  ${output.hint}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error('生成失败：' + error.message);
  process.exitCode = 1;
}
