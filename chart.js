/*
 * Построение графика ΔP(внутренний диаметр) на canvas.
 * Логарифмические оси; слева большие диаметры (v = 0,1 м/с), справа малые (v = 10 м/с),
 * как в исходном калькуляторе prostobuild.by.
 */
(function (global) {
  'use strict';

  var SUP = { '-': '\u207B', '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3',
              '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };

  function sup(n) {
    var s = String(n), out = '';
    for (var i = 0; i < s.length; i++) out += SUP[s[i]] || s[i];
    return out;
  }

  var COLOR = {
    curve: '#1A6BB5',
    gridMajor: '#D9E2EC',
    gridMinor: '#EDF1F6',
    axis: '#51606F',
    text: '#51606F',
    green: 'rgba(76, 175, 80, 0.18)',
    greenEdge: 'rgba(56, 142, 60, 0.45)',
    red: 'rgba(239, 83, 80, 0.16)',
    redEdge: 'rgba(211, 47, 47, 0.45)',
    marker: '#BA1A1A'
  };

  function fmtTick(v) {
    if (v >= 10) return String(Math.round(v));
    if (v >= 1) return String(Math.round(v * 10) / 10);
    if (v >= 0.1) return String(Math.round(v * 100) / 10).replace('.', ',');
    return String(v);
  }

  /**
   * data: [{diameterMm, dpKgf, dpPa, velocity, reynolds}] — data[0] = наибольший диаметр
   * opts: { optBandD:[dLo,dHi] мм | null, reBandD:[dLo,dHi] мм | null,
   *         currentDiameterMm: number | null }
   */
  function drawChart(canvas, data, opts) {
    opts = opts || {};
    var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH || !data || data.length < 2) return;

    var dpr = global.devicePixelRatio || 1;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var m = { l: 56, r: 14, t: 14, b: 42 };
    var pw = cssW - m.l - m.r, ph = cssH - m.t - m.b;
    if (pw <= 10 || ph <= 10) return;

    var dLeft = data[0].diameterMm;             // наибольший диаметр (слева)
    var dRight = data[data.length - 1].diameterMm; // наименьший (справа)
    var xL = Math.log10(dLeft), xR = Math.log10(dRight);
    if (!(xL > xR)) return;

    function xPix(d) {
      var x = Math.log10(Math.max(d, 1e-6));
      return m.l + (xL - x) / (xL - xR) * pw;
    }

    var ymin = Infinity, ymax = -Infinity, i, p;
    for (i = 0; i < data.length; i++) {
      p = data[i].dpKgf;
      if (isFinite(p) && p > 0) {
        if (p < ymin) ymin = p;
        if (p > ymax) ymax = p;
      }
    }
    if (!isFinite(ymin) || !isFinite(ymax)) return;
    var yLo = Math.floor(Math.log10(ymin) * 1e6) / 1e6 - 0.15;
    var yHi = Math.ceil(Math.log10(ymax) * 1e6) / 1e6 + 0.15;
    if (yHi - yLo < 0.5) yHi = yLo + 0.5;

    function yPix(dp) {
      var y = Math.log10(Math.max(dp, 1e-300));
      return m.t + (yHi - y) / (yHi - yLo) * ph;
    }

    function zone(band, fill, edge) {
      if (!band) return;
      var a = Math.max(band[0], dRight), b = Math.min(band[1], dLeft);
      if (a >= b) return;
      var x1 = xPix(b), x2 = xPix(a);
      ctx.fillStyle = fill;
      ctx.fillRect(x1, m.t, x2 - x1, ph);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, m.t); ctx.lineTo(x1, m.t + ph);
      ctx.moveTo(x2, m.t); ctx.lineTo(x2, m.t + ph);
      ctx.stroke();
    }

    // Зоны: оптимальная скорость (зелёная) и переходная зона Re (красная)
    zone(opts.optBandD, COLOR.green, COLOR.greenEdge);
    zone(opts.reBandD, COLOR.red, COLOR.redEdge);

    // Сетка: горизонтальные линии по декадам и промежуточным значениям 2–9
    var k, mm, val, y;
    ctx.lineWidth = 1;
    for (k = Math.floor(yLo); k <= Math.ceil(yHi); k++) {
      for (mm = 1; mm <= 9; mm++) {
        val = mm * Math.pow(10, k);
        if (Math.log10(val) < yLo || Math.log10(val) > yHi) continue;
        y = yPix(val);
        ctx.strokeStyle = mm === 1 ? COLOR.gridMajor : COLOR.gridMinor;
        ctx.beginPath();
        ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y);
        ctx.stroke();
        if (mm === 1) {
          ctx.fillStyle = COLOR.text;
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(mm === 1 ? ('10' + sup(k)) : '', m.l - 6, y);
        }
      }
    }

    // Сетка: вертикальные линии по «красивым» значениям диаметра
    var ticks = [], exp, mant;
    for (exp = Math.floor(Math.log10(dRight)); exp <= Math.ceil(Math.log10(dLeft)); exp++) {
      for (mant = 1; mant <= 9; mant++) {
        val = mant * Math.pow(10, exp);
        if (val < dRight || val > dLeft) continue;
        ticks.push(val);
      }
    }
    if (ticks.length > 7) {
      var dec = [];
      for (i = 0; i < ticks.length; i++) {
        var lg = Math.log10(ticks[i]);
        if (Math.abs(lg - Math.round(lg)) < 1e-9) dec.push(ticks[i]);
      }
      if (dec.length >= 2) ticks = dec;
    }
    // Прореживание: оставляем подписи не ближе 30 px друг к другу (слева направо)
    ticks.sort(function (a, b) { return b - a; });
    var spaced = [], lastX = -Infinity;
    for (i = 0; i < ticks.length; i++) {
      var tx = xPix(ticks[i]);
      if (spaced.length === 0 || tx - lastX >= 30) { spaced.push(ticks[i]); lastX = tx; }
    }
    ticks = spaced;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px system-ui, sans-serif';
    for (i = 0; i < ticks.length; i++) {
      var x = xPix(ticks[i]);
      ctx.strokeStyle = COLOR.gridMajor;
      ctx.beginPath();
      ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph);
      ctx.stroke();
      ctx.fillStyle = COLOR.text;
      ctx.fillText(fmtTick(ticks[i]), x, m.t + ph + 6);
    }

    // Кривая ΔP(D)
    ctx.strokeStyle = COLOR.curve;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var started = false;
    for (i = 0; i < data.length; i++) {
      p = data[i].dpKgf;
      if (!isFinite(p) || p <= 0) { started = false; continue; }
      var px = xPix(data[i].diameterMm), py = yPix(p);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Рамка области построения
    ctx.strokeStyle = COLOR.gridMajor;
    ctx.lineWidth = 1;
    ctx.strokeRect(m.l, m.t, pw, ph);

    // Текущая точка расчёта
    if (opts.currentDiameterMm && opts.currentDiameterMm >= dRight && opts.currentDiameterMm <= dLeft) {
      var cx = xPix(opts.currentDiameterMm);
      var best = data[0], dist = Math.abs(best.diameterMm - opts.currentDiameterMm);
      for (i = 1; i < data.length; i++) {
        var dd = Math.abs(data[i].diameterMm - opts.currentDiameterMm);
        if (dd < dist) { dist = dd; best = data[i]; }
      }
      if (isFinite(best.dpKgf) && best.dpKgf > 0) {
        var cy = yPix(best.dpKgf);
        ctx.strokeStyle = 'rgba(25, 28, 31, 0.4)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = COLOR.marker;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Подписи осей
    ctx.fillStyle = COLOR.axis;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Внутренний диаметр, мм', m.l + pw / 2, cssH - 6);
    ctx.save();
    ctx.translate(13, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText('\u0394P, кгс/см\u00B2', 0, 0);
    ctx.restore();
  }

  global.HydroChart = { drawChart: drawChart };
})(typeof window !== 'undefined' ? window : globalThis);
