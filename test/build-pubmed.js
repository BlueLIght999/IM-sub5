/* =====================================================================
 * build-pubmed.js —— 把 csv-Formularie-set.csv（PubMed 文献集）转换为
 * js/pubmed.js（内嵌的 JS 字符串常量），使网页无需服务器即可一键加载。
 * 用法：node test/build-pubmed.js
 * 注意：生成的 js/pubmed.js 较大（约 2MB），如需更新请重新运行本脚本。
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'csv-Formularie-set.csv');
const outDir = path.join(root, 'js');

if (!fs.existsSync(src)) {
  console.error('未找到 ' + src);
  process.exit(1);
}
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const csv = fs.readFileSync(src, 'utf8');
const body = '(function (G) {\n' +
  '  "use strict";\n' +
  '  const IR = (G.IR = G.IR || {});\n' +
  '  // 本文件由 test/build-pubmed.js 自动生成，内容与 csv-Formularie-set.csv 完全一致\n' +
  '  IR.PUBMED_CSV = ' + JSON.stringify(csv) + ';\n' +
  '  IR.PUBMED_NAME = "PubMed 文献集（csv-Formularie-set.csv）";\n' +
  '})(typeof window !== "undefined" ? window : globalThis);\n';

fs.writeFileSync(path.join(outDir, 'pubmed.js'), body, 'utf8');
console.log('已生成 js/pubmed.js：' + (body.length / 1024 / 1024).toFixed(2) + ' MB');
console.log('CSV 行数约 ' + csv.split('\n').length + '（含表头）');
