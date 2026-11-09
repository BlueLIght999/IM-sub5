/* =====================================================================
 * evaluation.js —— 检索性能评测（P@k / R@k / F1 / AP / MAP / P-R 曲线）
 * 以及基于 Canvas 的对比柱状图与 11 点插值 P-R 曲线绘制。
 *
 * 图表配色遵循数据可视化规范：三类系列色经过色觉安全校验（ΔE ≥ 8），
 * 颜色角色从 CSS 变量读取，支持明/暗双主题；柱顶标注数值、
 * 悬停提示 + 表格视图，保证色弱/打印场景下信息不丢失。
 * ===================================================================== */
(function (G) {
  'use strict';
  const IR = (G.IR = G.IR || {});

  /* ------------------------- 评测指标 ------------------------- */

  /**
   * 单条查询评测：
   *   rankedIds —— 完整排序的文档 id 列表
   *   relevant  —— 相关文档 id 的 Set
   *   k         —— P@k / R@k 的 k（默认 10）
   *   cutoff    —— AP 计算的截断位置（默认 50）
   */
  IR.evalQuery = function (rankedIds, relevant, k, cutoff) {
    k = k === undefined ? 10 : k;
    cutoff = cutoff === undefined ? 50 : cutoff;
    const R = relevant.size;
    const topK = rankedIds.slice(0, k);
    const hitK = topK.filter(x => relevant.has(x)).length;
    const Pk = hitK / k;                       // 查准率 P@k
    const Rk = R ? hitK / R : 0;               // 查全率 R@k
    const F1 = (Pk + Rk) > 0 ? 2 * Pk * Rk / (Pk + Rk) : 0;
    let ap = 0, relSeen = 0;
    const list = rankedIds.slice(0, cutoff);
    for (let i = 0; i < list.length; i++) {
      if (relevant.has(list[i])) { relSeen++; ap += relSeen / (i + 1); }
    }
    return { Pk: Pk, Rk: Rk, F1: F1, AP: R ? ap / R : 0 };
  };

  /**
   * 批量评测：queries = [{query, relevant:[ids]}]
   * searchFn = (query) => 完整排序的 id 列表
   * 返回 { rows: [{query, relevant, ranked, m}], avg: {Pk, Rk, F1, AP} }
   */
  IR.runEvaluation = function (queries, searchFn, k, cutoff) {
    const rows = [];
    const sum = { Pk: 0, Rk: 0, F1: 0, AP: 0 };
    for (const q of queries) {
      const ranked = searchFn(q.query).map(x => String(x));
      const m = IR.evalQuery(ranked, new Set(q.relevant.map(String)), k, cutoff);
      rows.push({ query: q.query, relevant: q.relevant, ranked: ranked, m: m });
      for (const key in sum) sum[key] += m[key];
    }
    const n = queries.length || 1;
    return { rows: rows, avg: { Pk: sum.Pk / n, Rk: sum.Rk / n, F1: sum.F1 / n, AP: sum.AP / n } };
  };

  /** 单条查询的 11 点插值查准率曲线：P(r) = max P(r′)，r′ ≥ r */
  IR.prInterpolated = function (rankedIds, relevant) {
    const R = relevant.size;
    const pts = [];
    let relSeen = 0;
    for (let i = 0; i < rankedIds.length; i++) {
      if (relevant.has(rankedIds[i])) { relSeen++; pts.push({ rec: relSeen / R, prec: relSeen / (i + 1) }); }
    }
    const out = [];
    for (let L = 0; L <= 10; L++) {
      const r = L / 10;
      let best = 0;
      for (const p of pts) if (p.rec >= r && p.prec > best) best = p.prec;
      out.push(best);
    }
    return out;
  };

  /** 对多条查询的 11 点插值曲线取平均（宏平均） */
  IR.avgPRCurve = function (res) {
    const curves = res.rows.map(r => IR.prInterpolated(r.ranked, new Set(r.relevant.map(String))));
    const n = curves.length || 1;
    const out = [];
    for (let i = 0; i < 11; i++) {
      let s = 0;
      for (const c of curves) s += c[i];
      out.push(s / n);
    }
    return out;
  };

  /* ------------------------- 图表绘制 ------------------------- */

  /** 从 CSS 变量读取图表颜色角色（明/暗主题共用一套变量） */
  IR.vizTheme = function () {
    const cs = getComputedStyle(document.documentElement);
    const g = n => (cs.getPropertyValue(n) || '').trim();
    return {
      surface: g('--surface-1') || '#fcfcfb',
      ink: g('--ink') || '#0b0b0b',
      ink2: g('--ink2') || '#52514e',
      muted: g('--muted') || '#898781',
      grid: g('--grid') || '#e1e0d9',
      axis: g('--axis') || '#c3c2b7',
      s1: g('--s1') || '#2a78d6',
      s2: g('--s2') || '#eb6834',
      s3: g('--s3') || '#1baf7a'
    };
  };

  /** 准备画布：按设备像素比缩放，保证文字与线条清晰 */
  IR.prepCanvas = function (canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    let w = parent ? parent.clientWidth : 0;
    if (!w) w = 900; // 面板隐藏时兜底
    w = Math.min(w, 1000);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  };

  const FONT = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  const FONT_S = '11px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';

  /** 柱形路径：顶角 4px 圆角、底部贴基线（方角） */
  function barPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /** 全圆角小矩形（图例色块） */
  function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 颜色加深（用于纹理线） */
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g2 = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g2 + ',' + b + ')';
  }

  /** 45°/135° 斜线纹理填充（色弱/打印/强制对比度场景的辅助编码） */
  function hatch(ctx, x, y, w, h, sign, color, gap) {
    ctx.save();
    barPath(ctx, x, y, w, h, 4);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = x - h, x1 = x + w + h;
    for (let xx = x0; xx <= x1; xx += gap) {
      ctx.moveTo(xx, y + h);
      ctx.lineTo(xx + h * sign, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 图例（2 个及以上系列必须显示图例） */
  function drawLegend(ctx, series, x, y, th) {
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let cx = x;
    for (const s of series) {
      ctx.fillStyle = s.color;
      roundRectPath(ctx, cx, y, 12, 12, 3);
      ctx.fill();
      cx += 18;
      ctx.fillStyle = th.ink2;
      ctx.fillText(s.name, cx, y + 6);
      cx += ctx.measureText(s.name).width + 22;
    }
  }

  /** 坐标轴“好看”的上限（0.1/0.2/0.5/1 步进） */
  function niceCeil(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return f * p;
  }

  /**
   * 分组柱状图：categories 为指标名数组，series = [{name, color, values}]，
   * hover = {c, s} 高亮某项；opts.texture = true 时附加斜线纹理。
   * 返回所有柱形的命中区域（供悬停提示用）。
   */
  IR.drawBarChart = function (canvas, categories, series, hover, opts) {
    opts = opts || {};
    const th = IR.vizTheme();
    const P = IR.prepCanvas(canvas, 330);
    const ctx = P.ctx, w = P.w, h = P.h;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 48, r: 16, t: 30, b: 42 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const maxV = Math.max(0.0001, ...series.flatMap(s => s.values));
    const top = niceCeil(maxV);

    // 网格与 y 轴刻度
    ctx.font = FONT;
    for (let i = 0; i <= 4; i++) {
      const v = top * i / 4;
      const y = pad.t + ph * (1 - i / 4);
      ctx.strokeStyle = th.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(v.toFixed(2), pad.l - 8, y);
    }
    // 基线
    ctx.strokeStyle = th.axis;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ph); ctx.lineTo(w - pad.r, pad.t + ph); ctx.stroke();

    // 柱子（系列间 2px 间隙）
    const nC = categories.length, nS = series.length;
    const groupW = pw / nC;
    const barW = Math.min(30, (groupW - 12) / nS - 2);
    const rects = [];
    for (let ci = 0; ci < nC; ci++) {
      const total = barW * nS + 2 * (nS - 1);
      let x = pad.l + groupW * ci + (groupW - total) / 2;
      for (let si = 0; si < nS; si++) {
        const v = series[si].values[ci];
        const bh = Math.max(v / top * ph, 0);
        const y = pad.t + ph - bh;
        rects.push({ c: ci, s: si, x: x, y: y, w: barW, h: bh });
        const isHover = hover && hover.c === ci && hover.s === si;
        ctx.globalAlpha = isHover ? 0.78 : 1;
        ctx.fillStyle = series[si].color;
        barPath(ctx, x, y, barW, Math.max(bh, 0.5), 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (opts.texture) hatch(ctx, x, y, barW, Math.max(bh, 0.5), si % 2 ? -1 : 1, shade(series[si].color, 0.65), 4);
        // 数值直接标注（文字使用墨色，不用系列色）
        ctx.fillStyle = th.ink2;
        ctx.font = FONT_S;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(v.toFixed(3), x + barW / 2, Math.max(y - 2, 12));
        x += barW + 2;
      }
      ctx.fillStyle = th.ink2;
      ctx.font = FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(categories[ci], pad.l + groupW * ci + groupW / 2, pad.t + ph + 8);
    }
    drawLegend(ctx, series, pad.l, 6, th);
    return rects;
  };

  /**
   * 11 点插值 P-R 曲线：series = [{name, color, points: [11 个数]}]，
   * hoverIdx 为悬停的查全率档位（0..10），画虚线十字线。
   * 返回所有数据点坐标（供悬停提示用）。
   */
  IR.drawPRCurve = function (canvas, series, hoverIdx) {
    const th = IR.vizTheme();
    const P = IR.prepCanvas(canvas, 380);
    const ctx = P.ctx, w = P.w, h = P.h;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 48, r: 24, t: 30, b: 44 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const X = r => pad.l + r * pw;
    const Y = p => pad.t + (1 - p) * ph;

    // 网格与刻度（0..1，步长 0.2）
    ctx.font = FONT;
    for (let i = 0; i <= 5; i++) {
      const v = i / 5, x = X(v), y = Y(v);
      ctx.strokeStyle = th.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(v.toFixed(1), pad.l - 8, y);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(v.toFixed(1), x, pad.t + ph + 6);
    }
    // 轴标题
    ctx.fillStyle = th.ink2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('查全率 Recall', pad.l + pw / 2, h - 16);
    ctx.save();
    ctx.translate(14, pad.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('查准率 Precision', 0, 0);
    ctx.restore();

    // 悬停十字线
    if (hoverIdx != null) {
      const x = X(hoverIdx / 10);
      ctx.strokeStyle = th.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
      ctx.setLineDash([]);
    }

    const pts = [];
    const endLabels = [];
    for (let si = 0; si < series.length; si++) {
      const s = series[si], ps = s.points;
      // 折线（2px）
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < ps.length; i++) {
        const x = X(i / 10), y = Y(ps[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        pts.push({ x: x, y: y, s: si, i: i });
      }
      ctx.stroke();
      // 数据点标记（8px，2px 底色描边，避免与线重叠时看不清）
      for (let i = 0; i < ps.length; i++) {
        const x = X(i / 10), y = Y(ps[i]);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = th.surface; ctx.stroke();
      }
      endLabels.push({ name: s.name, y: Y(ps[10]) });
    }
    // 末端直接标注（重叠时向下错开）
    endLabels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < endLabels.length; i++) {
      if (endLabels[i].y - endLabels[i - 1].y < 15) endLabels[i].y = endLabels[i - 1].y + 15;
    }
    ctx.font = FONT;
    ctx.fillStyle = th.ink2;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const lb of endLabels) ctx.fillText(lb.name, X(1) + 8, lb.y);

    drawLegend(ctx, series, pad.l, 6, th);
    return pts;
  };
})(typeof window !== 'undefined' ? window : globalThis);
