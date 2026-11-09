/* =====================================================================
 * main.js —— 页面交互逻辑
 * 数据加载（示例/PubMed/上传 CSV）· 三种模型检索 · 性能评测 · 图表 · 明暗主题
 * ===================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ------------------------- 全局状态 ------------------------- */
  const state = {
    docs: [],           // 原始文档数组
    idx: null,          // 倒排索引（三种模型共用）
    datasetKey: '',     // sample | pubmed | upload
    datasetName: '',
    colsNote: '',       // 列映射说明
    model: 'bm25',      // 当前检索模型
    k: 10,              // 返回条数
    stem: true,         // 英文词干化
    k1: 1.2, b: 0.75,   // BM25 参数
    eval: null,         // 最近一次评测结果
    barHover: null, prHover: null,
    barCats: [], barSeries: [], barRects: [],
    prSeries: [], prPts: [],
    texture: false      // 图表斜线纹理（色弱/强制对比度场景）
  };

  /* ------------------------- 模型定义 ------------------------- */
  const MODEL_DEFS = {
    boolean: {
      name: '布尔模型',
      scoreLabel: '匹配词频',
      fn: q => IR.searchBoolean(state.idx, q)              // 返回全量排序列表
    },
    vector: {
      name: '向量空间模型',
      scoreLabel: '余弦相似度',
      fn: q => IR.searchVector(state.idx, q, 1000)
    },
    bm25: {
      name: '概率模型 BM25',
      scoreLabel: 'BM25 得分',
      fn: q => IR.searchBM25(state.idx, q, 1000, state.k1, state.b)
    }
  };

  /* ------------------------- 数据加载 ------------------------- */

  /** 识别 CSV 表头列（兼容 PubMed 导出格式与通用 id/title/content 格式） */
  function detectColumns(header) {
    const h = header.map(x => String(x).toLowerCase().trim());
    const find = keys => {
      for (const k of keys) { const i = h.indexOf(k); if (i >= 0) return i; }
      return -1;
    };
    const cols = {
      id: find(['pmid', 'id', 'docid', '文档编号', '编号']),
      title: find(['title', '标题', '题名']),
      content: find(['content', 'abstract', 'abstract text', 'text', '正文', '内容', '摘要']),
      category: find(['category', '分类', '类别', '标签']),
      authors: find(['authors', 'first author', '作者']),
      journal: find(['journal/book', 'journal', 'book', '期刊', '来源']),
      year: find(['publication year', 'year', '年份', '出版年']),
      doi: find(['doi'])
    };
    if (cols.title < 0 && cols.content < 0) {
      // 兜底：按列位置解析（id, title, content, category）
      cols.id = 0; cols.title = 1; cols.content = 2; cols.category = 3;
      cols.note = '未识别到标准表头，按列位置解析（id,title,content,category）';
    } else {
      const used = [];
      for (const k of ['id', 'title', 'content', 'authors', 'journal', 'year', 'category']) {
        if (cols[k] >= 0) used.push(header[cols[k]]);
      }
      cols.note = '列映射：' + used.join('、')
        + (cols.content < 0 ? '（正文由 标题+作者+期刊 组合）' : '');
    }
    return cols;
  }

  /** 按检测结果把一行 CSV 转换为文档对象 */
  function buildDoc(r, cols, fallbackIdx) {
    const get = i => (i >= 0 && r[i] !== undefined) ? String(r[i]).trim() : '';
    const title = get(cols.title);
    const authors = cols.authors >= 0 ? get(cols.authors) : '';
    const journal = cols.journal >= 0 ? get(cols.journal) : '';
    let content = cols.content >= 0 ? get(cols.content) : '';
    if (!content) content = [title, authors, journal].filter(Boolean).join(' ');
    if (!title && !content) return null;
    return {
      id: get(cols.id) || String(fallbackIdx + 1),
      title: title || '(无标题)',
      content: content,
      category: cols.category >= 0 ? get(cols.category) : '',
      authors: authors,
      journal: journal,
      year: cols.year >= 0 ? get(cols.year) : '',
      doi: cols.doi >= 0 ? get(cols.doi) : ''
    };
  }

  /** 从 CSV 文本构建数据集并重建索引 */
  function loadDataset(text, key, name) {
    try {
      const rows = IR.parseCSV(String(text));
      if (rows.length < 2) { alert(name + '：未解析出数据行，请确认文件为 UTF-8 编码的 CSV'); return; }
      const cols = detectColumns(rows[0]);
      const docs = [];
      for (let i = 1; i < rows.length; i++) {
        const d = buildDoc(rows[i], cols, docs.length);
        if (d) docs.push(d);
      }
      if (!docs.length) { alert(name + '：没有有效数据'); return; }
      state.docs = docs;
      state.datasetKey = key;
      state.datasetName = name;
      state.colsNote = cols.note;
      rebuildIndex();
      updateDatasetBar();
      renderIndexTable($('idxFilter').value);
      $('searchMsg').textContent = '';
      if (key === 'sample') {
        runEval(IR.SAMPLE_QUERIES, '内置标准评测集（10 条查询）');
      } else {
        state.eval = null;
        clearEvalUI();
      }
    } catch (e) {
      alert('加载失败：' + e.message);
    }
  }

  function rebuildIndex() {
    state.idx = IR.buildIndex(state.docs, { stem: state.stem });
  }

  /* ------------------------- 检索 ------------------------- */

  function showMsg(text, isErr) {
    const el = $('searchMsg');
    el.textContent = text;
    el.className = 'msg' + (isErr ? ' err' : '');
  }

  function doSearch() {
    if (!state.idx) { showMsg('请先加载数据集', true); return; }
    const q = $('qInput').value.trim();
    if (!q) { showMsg('请输入查询内容', true); return; }
    if (!IR.tokenize(q, state.idx.opts).length) { showMsg('查询词均为停用词，请更换查询', true); return; }
    const t0 = performance.now();
    let res;
    try { res = MODEL_DEFS[state.model].fn(q); }
    catch (e) { showMsg('查询语法错误：' + e.message, true); return; }
    const ms = performance.now() - t0;
    renderResults(res.slice(0, state.k), ms, q);
  }

  /** 渲染检索结果列表（含高亮、摘要、展开全文） */
  function renderResults(list, ms, q) {
    const meta = MODEL_DEFS[state.model];
    const terms = IR.extractQueryTerms(q)
      .filter(t => IR.tokenize(t, state.idx.opts).length && (t.length > 1 || /[一-鿿]/.test(t)));
    $('resultsHead').textContent = '共 ' + list.length + ' 条结果 · ' + meta.name + ' · 用时 ' + IR.fmt(ms, 1) + ' ms';
    const box = $('resultsList');
    if (!list.length) {
      const tip = state.model === 'boolean'
        ? '<div class="empty">未检索到匹配文档。布尔查询中多个词项按 AND 处理，要求全部出现，可尝试 OR 或减少词项。</div>'
        : '<div class="empty">未检索到匹配文档。</div>';
      box.innerHTML = tip;
      showMsg('');
      return;
    }
    showMsg('');
    box.innerHTML = list.map((r, i) => {
      const d = state.idx.docById.get(r.id);
      const metaLine = [d.id, d.category, d.journal, d.year, d.doi ? 'DOI: ' + d.doi : '']
        .filter(Boolean).map(IR.escapeHTML).join(' · ');
      const extra = d.authors ? IR.escapeHTML(d.authors) : '';
      return '<div class="result">' +
        '<div class="r-top"><span class="rank">' + (i + 1) + '</span>' +
        '<span class="r-title">' + IR.highlight(d.title, terms) + '</span>' +
        '<span class="r-score">' + meta.scoreLabel + '：' + IR.fmt(r.score, 3) + '</span></div>' +
        '<div class="r-meta">' + metaLine + (extra ? ' · ' + extra : '') + '</div>' +
        '<div class="r-snippet">' + IR.snippet(d.content, terms, 70) + '</div>' +
        '<button class="r-toggle" data-i="' + i + '">查看全文 ▾</button>' +
        '<div class="r-full" id="rfull-' + i + '">' + IR.highlight(d.content, terms) + '</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.r-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = $('rfull-' + btn.dataset.i);
        const show = el.style.display === 'block';
        el.style.display = show ? 'none' : 'block';
        btn.textContent = show ? '查看全文 ▾' : '收起 ▴';
      });
    });
  }

  /* ------------------------- 性能评测 ------------------------- */

  /** 对一组查询在三种模型上运行评测 */
  function runEval(queries, label) {
    const defs = [
      { key: 'boolean', name: '布尔模型', fn: q => IR.searchBoolean(state.idx, q).map(r => r.id), time: 0, res: null },
      { key: 'vector', name: '向量空间模型', fn: q => IR.searchVector(state.idx, q, 50).map(r => r.id), time: 0, res: null },
      { key: 'bm25', name: '概率模型BM25', fn: q => IR.searchBM25(state.idx, q, 50, state.k1, state.b).map(r => r.id), time: 0, res: null }
    ];
    for (const d of defs) {
      const t0 = performance.now();
      d.res = IR.runEvaluation(queries, d.fn, 10, 50);
      d.time = performance.now() - t0;
    }
    state.eval = { queries: queries, label: label, models: defs };
    state.barHover = null; state.prHover = null;
    $('evalMeta').textContent = label + ' · 结果已更新';
    renderEvalTables();
    renderCharts();
  }

  /** 解析自定义评测文本框：每行 查询词 | 相关文档id1,id2 */
  function parseQrels(text) {
    const queries = [];
    for (const line of String(text).split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      const m = s.match(/^(.+?)\s*[|｜]\s*(.+)$/);
      if (!m) throw new Error('无法解析行：“' + s + '”，格式应为：查询词 | 相关文档id1,id2');
      const rel = m[2].split(/[,，、;；\s]+/).filter(Boolean);
      queries.push({ query: m[1].trim(), relevant: rel });
    }
    return queries;
  }

  /** 渲染评测汇总表与逐查询明细 */
  function renderEvalTables() {
    const ev = state.eval;
    if (!ev) return;
    const ms = ev.models;
    const rows = [
      { name: '查准率 P@10', vals: ms.map(m => m.res.avg.Pk), fmt: 3 },
      { name: '查全率 R@10', vals: ms.map(m => m.res.avg.Rk), fmt: 3 },
      { name: 'F1@10', vals: ms.map(m => m.res.avg.F1), fmt: 3 },
      { name: 'MAP（平均准确率均值）', vals: ms.map(m => m.res.avg.AP), fmt: 3 },
      { name: '平均检索耗时（ms/查询）', vals: ms.map(m => m.time / Math.max(ev.queries.length, 1)), fmt: 1 }
    ];
    $('evalSummaryRows').innerHTML = rows.map(r =>
      '<tr><td>' + r.name + '</td>' +
      r.vals.map(v => '<td class="num">' + IR.fmt(v, r.fmt) + '</td>').join('') + '</tr>'
    ).join('');

    $('evalDetail').innerHTML = ev.queries.map((q, qi) => {
      const lists = ms.map(m => {
        const row = m.res.rows[qi];
        const rel = new Set(q.relevant.map(String));
        const items = row.ranked.slice(0, 10).map(id => {
          const d = state.idx.docById.get(id);
          const isRel = rel.has(id);
          return '<li class="' + (isRel ? 'rel-yes' : 'rel-no') + '">' + (isRel ? '✓ ' : '✗ ') +
            IR.escapeHTML(id) + ' ' + IR.escapeHTML((d && d.title ? d.title : '').slice(0, 24)) + '</li>';
        }).join('');
        return '<div class="rlist-col"><div class="rlist-head">' + m.name + '</div><ul>' + items + '</ul></div>';
      }).join('');
      const stat = ms.map(m => {
        const row = m.res.rows[qi];
        return m.name + ' P@10=' + IR.fmt(row.m.Pk, 3) + ' MAP=' + IR.fmt(row.m.AP, 3);
      }).join('；');
      return '<details class="q-detail"><summary><b>' + IR.escapeHTML(q.query) + '</b>（相关 ' +
        q.relevant.length + ' 篇）— ' + stat + '</summary><div class="rlist">' + lists + '</div></details>';
    }).join('');
  }

  function clearEvalUI() {
    $('evalSummaryRows').innerHTML = '<tr><td colspan="4" class="num">尚未运行评测</td></tr>';
    $('evalDetail').innerHTML = '';
    $('evalMeta').textContent = '';
    clearCanvas($('barChart'));
    clearCanvas($('prChart'));
  }

  function clearCanvas(c) {
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  /* ------------------------- 图表 ------------------------- */

  function renderCharts() {
    if (!state.eval) { clearCanvas($('barChart')); clearCanvas($('prChart')); return; }
    const ev = state.eval;
    const th = IR.vizTheme();
    const pal = [th.s1, th.s2, th.s3];
    const cats = ['P@10', 'R@10', 'F1@10', 'MAP'];
    state.barCats = cats;
    state.barSeries = ev.models.map((m, i) => ({
      name: m.name, color: pal[i],
      values: [m.res.avg.Pk, m.res.avg.Rk, m.res.avg.F1, m.res.avg.AP]
    }));
    state.barRects = IR.drawBarChart($('barChart'), cats, state.barSeries, state.barHover, { texture: state.texture });
    state.prSeries = ev.models.map((m, i) => ({
      name: m.name, color: pal[i], points: IR.avgPRCurve(m.res)
    }));
    state.prPts = IR.drawPRCurve($('prChart'), state.prSeries, state.prHover);
  }

  /** 悬停提示 + 命中高亮（柱状图 / P-R 曲线） */
  function bindChartHover() {
    const bar = $('barChart'), pr = $('prChart');
    bar.onmousemove = e => {
      const rect = bar.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let hit = null;
      for (const r of state.barRects) {
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { hit = r; break; }
      }
      if (hit) {
        state.barHover = { c: hit.c, s: hit.s };
        showTip($('tipBar'), bar, mx, my,
          state.barCats[hit.c] + ' · ' + state.barSeries[hit.s].name + '：' + IR.fmt(state.barSeries[hit.s].values[hit.c], 3));
        state.barRects = IR.drawBarChart(bar, state.barCats, state.barSeries, state.barHover, { texture: state.texture });
      } else if (state.barHover) {
        state.barHover = null;
        hideTip($('tipBar'));
        state.barRects = IR.drawBarChart(bar, state.barCats, state.barSeries, null, { texture: state.texture });
      }
    };
    bar.onmouseleave = () => {
      if (state.barHover) {
        state.barHover = null; hideTip($('tipBar'));
        state.barRects = IR.drawBarChart(bar, state.barCats, state.barSeries, null, { texture: state.texture });
      }
    };
    pr.onmousemove = e => {
      if (!state.prPts.length) return;
      const rect = pr.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let best = 0, bd = Infinity;
      for (const p of state.prPts) {
        const d = Math.abs(p.x - mx);
        if (d < bd) { bd = d; best = p.i; }
      }
      if (bd > 70) { state.prHover = null; hideTip($('tipPr')); return; }
      state.prHover = best;
      const parts = state.prSeries.map(s => s.name + ' ' + IR.fmt(s.points[best], 3)).join(' · ');
      showTip($('tipPr'), pr, mx, my, '查全率 ' + IR.fmt(best / 10, 1) + ' → ' + parts);
      state.prPts = IR.drawPRCurve(pr, state.prSeries, state.prHover);
    };
    pr.onmouseleave = () => {
      if (state.prHover != null) {
        state.prHover = null; hideTip($('tipPr'));
        state.prPts = IR.drawPRCurve(pr, state.prSeries, null);
      }
    };
  }

  function showTip(tip, canvas, mx, my, html) {
    tip.innerHTML = html;
    tip.style.display = 'block';
    const box = canvas.parentElement.getBoundingClientRect();
    const trect = tip.getBoundingClientRect();
    let x = mx + 14, y = my + 12;
    if (x + trect.width > box.width - 6) x = mx - trect.width - 14;
    if (y + trect.height > box.height - 6) y = my - trect.height - 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip(tip) { tip.style.display = 'none'; }

  /* ------------------------- 词典与倒排索引 ------------------------- */

  function renderIndexTable(filter) {
    const idx = state.idx;
    if (!idx) { $('idxRows').innerHTML = ''; $('idxCount').textContent = ''; return; }
    const f = (filter || '').toLowerCase();
    const terms = [];
    for (const [term, p] of idx.postings) {
      if (!f || term.includes(f)) terms.push({ term: term, df: p.df, docs: p.docs });
    }
    terms.sort((a, b) => b.df - a.df || (a.term < b.term ? -1 : 1));
    const show = terms.slice(0, 500);
    $('idxCount').textContent = '共 ' + idx.postings.size + ' 个词项'
      + (f ? '，筛选后 ' + terms.length + ' 个' : '，按 df 降序显示前 500 个');
    $('idxRows').innerHTML = show.map(t =>
      '<tr data-term="' + IR.escapeHTML(t.term) + '"><td><code>' + IR.escapeHTML(t.term) + '</code></td>' +
      '<td class="num">' + t.df + '</td><td class="num">' + IR.fmt(t.df / idx.N, 3) + '</td>' +
      '<td class="ids">' + t.docs.slice(0, 10).map(o => IR.escapeHTML(o.id)).join(' ') +
      (t.docs.length > 10 ? ' …' : '') + '</td></tr>'
    ).join('');
    $('idxRows').querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const p = idx.postings.get(tr.dataset.term);
        $('postingsBox').innerHTML = '<b>' + IR.escapeHTML(tr.dataset.term) + '</b>（df=' + p.df + '）完整倒排记录：' +
          '<div class="ids">' + p.docs.slice(0, 200).map(o => IR.escapeHTML(o.id) + '(' + o.tf + ')').join('、') +
          (p.docs.length > 200 ? ' ……' : '') + '</div>';
      });
    });
  }

  /* ------------------------- 主题 ------------------------- */

  function currentIsDark() {
    if (document.documentElement.dataset.theme) return document.documentElement.dataset.theme === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function applyTheme(mode) {
    if (mode) document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    $('btnTheme').textContent = currentIsDark() ? '☀ 亮色' : '🌙 暗色';
    renderCharts();
  }

  /* ------------------------- 其他 UI ------------------------- */

  function updateDatasetBar() {
    $('dsName').textContent = state.datasetName || '—';
    $('statDocs').textContent = state.idx ? state.idx.N : 0;
    $('statTerms').textContent = state.idx ? state.idx.postings.size : 0;
    $('statAvgdl').textContent = state.idx ? IR.fmt(state.idx.avgdl, 1) : 0;
    $('statCols').textContent = state.colsNote || '';
    $('btnRunStd').disabled = state.datasetKey !== 'sample';
    $('evalHint').textContent = state.datasetKey === 'sample'
      ? '当前为内置示例数据集：已内置 10 条查询及人工相关性标注（qrels），可直接运行标准评测。'
      : '当前为“' + state.datasetName + '”：无内置相关性标注，请在下方自定义评测中填写每行「查询词 | 相关文档id1,id2」。'
        + (state.datasetKey === 'pubmed' ? '（文档 id 为 PMID）' : '');
    renderChips();
  }

  function renderChips() {
    const box = $('chipsRow');
    const qs = state.datasetKey === 'sample' ? IR.SAMPLE_QUERIES : IR.PUBMED_EXAMPLES;
    box.innerHTML = qs.slice(0, 8).map(q =>
      '<button class="chip" data-q="' + IR.escapeHTML(q.query) + '">' + IR.escapeHTML(q.query) + '</button>'
    ).join('');
    box.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', () => { $('qInput').value = c.dataset.q; doSearch(); });
    });
  }

  function debounce(fn, ms) {
    let t = null;
    return () => { if (t) clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ------------------------- 初始化 ------------------------- */

  function init() {
    // 检索
    $('btnSearch').addEventListener('click', doSearch);
    $('qInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    const syncModel = () => {
      document.querySelectorAll('.model-card').forEach(c => {
        c.classList.toggle('sel', c.querySelector('input').checked);
      });
      $('bm25Box').style.display = state.model === 'bm25' ? 'flex' : 'none';
    };
    document.querySelectorAll('input[name=model]').forEach(r => {
      r.addEventListener('change', () => { state.model = r.value; syncModel(); });
    });
    syncModel();
    $('selK').addEventListener('change', () => { state.k = +$('selK').value; });
    $('chkStem').addEventListener('change', () => {
      state.stem = $('chkStem').checked;
      if (state.docs.length) {
        rebuildIndex();
        renderIndexTable($('idxFilter').value);
      }
      if (state.eval) runEval(state.eval.queries, state.eval.label); // 索引重建后自动重跑评测
    });
    $('k1Range').addEventListener('input', () => {
      state.k1 = +$('k1Range').value;
      $('k1Val').textContent = state.k1.toFixed(1);
      if (state.eval) runEval(state.eval.queries, state.eval.label);
    });
    $('bRange').addEventListener('input', () => {
      state.b = +$('bRange').value;
      $('bVal').textContent = state.b.toFixed(2);
      if (state.eval) runEval(state.eval.queries, state.eval.label);
    });
    // 数据加载
    $('btnLoadSample').addEventListener('click', () => loadDataset(IR.SAMPLE_CSV, 'sample', '内置示例中文文档集（60 篇）'));
    $('btnLoadPubmed').addEventListener('click', () => {
      if (typeof IR.PUBMED_CSV === 'string') {
        loadDataset(IR.PUBMED_CSV, 'pubmed', 'PubMed 文献集（csv-Formularie-set.csv）');
      } else {
        alert('未找到内置 PubMed 数据（js/pubmed.js）。请运行 node test/build-pubmed.js 生成，或用“上传 CSV 文件”加载。');
      }
    });
    $('btnUpload').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => loadDataset(String(reader.result), 'upload', file.name);
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
    // 评测
    $('btnRunStd').addEventListener('click', () => {
      if (!state.idx) return;
      if (state.datasetKey !== 'sample') { alert('标准评测集是为内置示例数据集标注的，当前数据集请使用自定义评测。'); return; }
      runEval(IR.SAMPLE_QUERIES, '内置标准评测集（10 条查询）');
    });
    $('btnRunCustom').addEventListener('click', () => {
      try {
        const qs = parseQrels($('customArea').value);
        if (!qs.length) throw new Error('请输入至少一行：查询词 | 相关文档id1,id2');
        const ids = new Set(state.idx.docById.keys());
        const missing = [];
        for (const q of qs) for (const id of q.relevant) if (!ids.has(String(id))) missing.push(id);
        const uniq = [...new Set(missing)];
        $('customMsg').textContent = uniq.length
          ? '提示：有 ' + uniq.length + ' 个相关文档 id 不在当前数据集中：' + uniq.slice(0, 15).join('、') + (uniq.length > 15 ? ' …' : '')
          : '已运行 ' + qs.length + ' 条查询的评测';
        runEval(qs, '自定义评测集（' + qs.length + ' 条查询）');
      } catch (e) {
        $('customMsg').textContent = e.message;
      }
    });
    // 词典
    $('idxFilter').addEventListener('input', () => renderIndexTable($('idxFilter').value));
    // 标签页
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + b.dataset.tab));
        if (b.dataset.tab === 'eval') renderCharts(); // 面板可见后按实际宽度重绘
      });
    });
    // 主题与适配
    $('btnTheme').addEventListener('click', () => applyTheme(currentIsDark() ? 'light' : 'dark'));
    applyTheme(document.documentElement.dataset.theme || undefined);
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!document.documentElement.dataset.theme) renderCharts();
      });
      const fc = window.matchMedia('(forced-colors: active)');
      const onFC = () => { state.texture = fc.matches; renderCharts(); };
      if (fc.addEventListener) fc.addEventListener('change', onFC);
      onFC();
    }
    window.addEventListener('resize', debounce(renderCharts, 150));
    // 启动：默认加载示例数据集并自动运行标准评测
    loadDataset(IR.SAMPLE_CSV, 'sample', '内置示例中文文档集（60 篇）');
    $('k1Val').textContent = '1.2';
    $('bVal').textContent = '0.75';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
