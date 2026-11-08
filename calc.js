/*
 * Гидравлический расчёт трубопровода — расчётное ядро.
 *
 * Формулы 1:1 воспроизводят онлайн-калькулятор prostobuild.by
 * (https://prostobuild.by/onlainraschet/244-gidravlicheskiy-raschet-truboprovoda-onlayn.html)
 * и совпадают с ядром Android-версии (HydroCalculator.kt).
 *
 *  1) Таблицы Шевелева:        1000i = tk·(q^tb / d^tm);  ΔP = 1000i·9.81·L, Па
 *  2) Теоретическая гидравлика: Re, λ (Пуазейль / Блазиус / Альтшуль),
 *     R = λ·v²·ρ/(2·9.81·d·10), кгс/(см²·м); местные: ΔPмс = Σζ·v²·ρ·1000/(2·9.81·10000)
 *  3) СНиП 2.04.02-84:          1000i = (A1000/19.61)·((A0 + C/v)^m / d^(m+1))·v²
 *
 * Общее: ρ(t) = (−0.003·t² − 0.1511·t + 1003.1)/1000, т/м³
 *        ν = 0.0178/(1 + 0.0337·t + 0.000221·t²)/10⁴, м²/с
 *        v = 4q/(ρ·π·d²), м/с;   S = ΔP/(q·3600)², Па/(т/ч)²
 */
(function (global) {
  'use strict';

  var PI = Math.PI;

  var V_OPT_MIN = 0.25;   // нижняя граница оптимальной скорости, м/с
  var V_OPT_MAX = 1.5;    // верхняя граница оптимальной скорости, м/с
  var V_CHART_MIN = 0.1;  // левый край графика по скорости, м/с
  var V_CHART_MAX = 10.0; // правый край графика по скорости, м/с

  var METHODS = [
    { id: 'shev', title: 'Таблицы Шевелева' },
    { id: 'teor', title: 'Теоретическая гидравлика' },
    { id: 'snip', title: 'СНиП 2.04.02-84' }
  ];

  /**
   * Материалы трубопроводов.
   * tk, tm, tb — коэффициенты формулы Шевелева: 1000i = tk·(q^tb / d^tm)
   * m, a0, a1000, c — коэффициенты формулы СНиП 2.04.02-84
   */
  var MATERIALS = [
    { id: 1, title: 'Новые стальные без внутреннего защитного покрытия или с битумным защитным покрытием',
      tk: 1.790, tm: 5.100, tb: 1.900, snipM: 0.226, snipA0: 1.0, snipA1000: 15.9, snipC: 0.684 },
    { id: 2, title: 'Новые чугунные без внутреннего защитного покрытия или с битумным защитным покрытием',
      tk: 1.790, tm: 5.100, tb: 1.900, snipM: 0.284, snipA0: 1.0, snipA1000: 14.4, snipC: 2.360 },
    { id: 3, title: 'Неновые стальные и чугунные без внутреннего защитного покрытия или с битумным защитным покрытием',
      tk: 1.735, tm: 5.300, tb: 2.000, snipM: 0.30, snipA0: 1.0, snipA1000: 17.9, snipC: 0.867 },
    { id: 4, title: 'Асбестоцементные',
      tk: 1.180, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 11.0, snipC: 3.51 },
    { id: 5, title: 'Железобетонные виброгидропрессованные',
      tk: 1.688, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 15.74, snipC: 3.51 },
    { id: 6, title: 'Железобетонные центрифугированные',
      tk: 1.486, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 13.85, snipC: 3.51 },
    { id: 7, title: 'Стальные и чугунные с внутренним пластмассовым или полимерцементным покрытием, нанесённым методом центрифугирования',
      tk: 1.180, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 11.00, snipC: 3.51 },
    { id: 8, title: 'Стальные и чугунные с внутренним цементно-песчаным покрытием, нанесённым методом набрызга',
      tk: 1.688, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 15.74, snipC: 3.51 },
    { id: 9, title: 'Стальные и чугунные с внутренним цементно-песчаным покрытием, нанесённым методом центрифугирования',
      tk: 1.486, tm: 4.890, tb: 1.850, snipM: 0.19, snipA0: 1.0, snipA1000: 13.85, snipC: 3.51 },
    { id: 10, title: 'Из полимерных материалов (пластмассовые)',
      tk: 1.052, tm: 4.774, tb: 1.774, snipM: 0.226, snipA0: 0.0, snipA1000: 13.44, snipC: 1.0 },
    { id: 11, title: 'Стеклянные',
      tk: 1.144, tm: 4.774, tb: 1.774, snipM: 0.226, snipA0: 0.0, snipA1000: 14.61, snipC: 1.0 }
  ];

  /** Эквивалентная шероховатость внутренних поверхностей труб, мм (метод «Теоретическая гидравлика») */
  var ROUGHNESS = [
    { id: 1, title: 'Сильно заржавленные или с большими отложениями', mm: 3.0 },
    { id: 2, title: 'Стальная или чугунная старая заржавевшая', mm: 1.0 },
    { id: 3, title: 'Стальная оцинкованная после нескольких лет', mm: 0.5 },
    { id: 4, title: 'Стальная после нескольких лет', mm: 0.2 },
    { id: 5, title: 'Чугунная новая', mm: 0.2 },
    { id: 6, title: 'Стальная оцинкованная новая', mm: 0.15 },
    { id: 7, title: 'Стальная сварная новая', mm: 0.1 },
    { id: 8, title: 'Стальная бесшовная новая', mm: 0.06 },
    { id: 9, title: 'Тянутые из латуни, свинца, меди', mm: 0.002 },
    { id: 10, title: 'Стеклянные', mm: 0.0 }
  ];

  /** Единицы расчётного расхода */
  var FLOW_UNITS = [
    { id: 'lps', title: 'л/с', divisor: 1000.0 },
    { id: 'm3h', title: 'м³/час', divisor: 3600.0 }
  ];

  /** Распространённые условные проходы труб, мм */
  var STANDARD_DIAMETERS = [
    15, 20, 25, 32, 40, 50, 65, 80, 90, 100, 110, 125, 140, 150, 160, 180,
    200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200,
    1400, 1600, 1800, 2000
  ];

  /** Строгий разбор числа: запятая или точка, иначе null (как toDoubleOrNull в Kotlin) */
  function parseNum(s) {
    if (s === null || s === undefined) return null;
    var str = String(s).trim().replace(',', '.');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(str)) return null;
    var v = parseFloat(str);
    return isFinite(v) ? v : null;
  }

  function materialById(id) {
    for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].id === id) return MATERIALS[i];
    return MATERIALS[0];
  }

  function roughnessById(id) {
    for (var i = 0; i < ROUGHNESS.length; i++) if (ROUGHNESS[i].id === id) return ROUGHNESS[i];
    return ROUGHNESS[1];
  }

  function unitById(id) {
    for (var i = 0; i < FLOW_UNITS.length; i++) if (FLOW_UNITS[i].id === id) return FLOW_UNITS[i];
    return FLOW_UNITS[0];
  }

  /** Плотность воды при температуре t, °C — т/м³ (аппроксимация исходного калькулятора) */
  function waterDensity(t) {
    return (-0.003 * t * t - 0.1511 * t + 1003.1) / 1000.0;
  }

  /** Кинематический коэффициент вязкости воды, м²/с (формула Пуазейля) */
  function waterViscosity(t) {
    return 0.0178 / (1.0 + 0.0337 * t + 0.000221 * t * t) / 1e4;
  }

  /** Внутренний диаметр, соответствующий скорости v, м (при расходе q, м³/с) */
  function diameterForVelocity(qM3s, ro, v) {
    return Math.sqrt(4.0 * qM3s / ro / PI / v);
  }

  /**
   * Коэффициенты СНиП для фактической скорости.
   * Для неновых стальных и чугунных труб таблица СНиП разделяется по скорости:
   * v ≤ 1,2 м/с и v > 1,2 м/с (как в исходном калькуляторе).
   */
  function snipCoef(matId, v) {
    var mat = materialById(matId);
    if (matId === 3) {
      if (v <= 1.2) return { m: mat.snipM, a0: mat.snipA0, a1000: 17.9, c: 0.867 };
      return { m: mat.snipM, a0: mat.snipA0, a1000: 21.0, c: 0.0 };
    }
    return { m: mat.snipM, a0: mat.snipA0, a1000: mat.snipA1000, c: mat.snipC };
  }

  /** Валидация исходных данных: возвращает текст ошибки или null */
  function validate(inp) {
    var q = parseNum(inp.qText);
    if (q === null) return 'Укажите расчётный расход';
    if (q <= 0.0) return 'Расчётный расход должен быть больше нуля';
    var d = parseNum(inp.dOuterText);
    if (d === null) return 'Укажите наружный диаметр';
    if (d <= 0.0) return 'Наружный диаметр должен быть больше нуля';
    var s = parseNum(inp.wallText);
    if (s === null) return 'Укажите толщину стенки';
    if (s < 0.0) return 'Толщина стенки не может быть отрицательной';
    if (d - 2.0 * s <= 0.0) return 'Внутренний диаметр (D − 2·s) должен быть больше нуля';
    var l = parseNum(inp.lengthText);
    if (l === null) return 'Укажите длину трубопровода';
    if (l <= 0.0) return 'Длина трубопровода должна быть больше нуля';
    var t = parseNum(inp.temperatureText);
    if (t === null) return 'Укажите среднюю температуру воды';
    if (t < 0.0 || t > 100.0) return 'Средняя температура воды: от 0 до 100 °C';
    if (inp.method === 'teor') {
      var ksi = parseNum(inp.ksiText);
      if (ksi === null) return 'Укажите сумму коэффициентов местных сопротивлений';
      if (ksi < 0.0) return 'Сумма коэффициентов местных сопротивлений не может быть отрицательной';
    }
    return null;
  }

  /**
   * Полный расчёт по выбранному методу — зеркальная копия
   * HydroCalculator.computeParsed() из Android-версии.
   */
  function computeParsed(method, matId, qM3s, innerDiameterM, lengthM, tMid, roughnessMm, sumKsi) {
    var ro = waterDensity(tMid);
    var v = 4.0 * qM3s / ro / PI / Math.pow(innerDiameterM, 2);

    var nu = null, qLps = null, re = null, lam = null, rSpec = null, dpFr = null, dpMs = null;
    var snipM = null, snipA0 = null, snipA1000 = null, snipC = null, i1000 = null;
    var dpPa, dpKgf;

    if (method === 'shev') {
      var mat = materialById(matId);
      var i = mat.tk * (Math.pow(qM3s, mat.tb) / Math.pow(innerDiameterM, mat.tm));
      i1000 = i;
      dpPa = i * 9.81 * lengthM;
      dpKgf = dpPa * 1.0197162e-5;
    } else if (method === 'teor') {
      var n = waterViscosity(tMid);
      var g = qM3s / ro * 1000.0; // расход при рабочей температуре, л/с
      var r = v * innerDiameterM / n;
      var sher = roughnessMm / 1000.0;
      var lamV;
      if (r <= 2320.0) {
        lamV = 75.0 / r;                                        // ламинарный (Пуазейль)
      } else if (r <= 4000.0) {
        lamV = 0.3164 / Math.pow(r, 0.25);                      // Блазиус
      } else if (r <= 500.0 * innerDiameterM / sher) {
        lamV = 0.11 * Math.pow(68.0 / r + sher / innerDiameterM, 0.25); // Альтшуль, переходная зона
      } else {
        lamV = 0.11 * Math.pow(sher / innerDiameterM, 0.25);    // квадратичная зона
      }
      var rUd = lamV * Math.pow(v, 2) * ro / 2.0 / 9.81 / innerDiameterM / 10.0;
      var dpFriction = rUd * lengthM;
      var dpLocal = sumKsi * Math.pow(v, 2) * ro * 1000.0 / 2.0 / 9.81 / 10000.0;
      nu = n; qLps = g; re = r; lam = lamV;
      rSpec = rUd; dpFr = dpFriction; dpMs = dpLocal;
      dpKgf = dpFriction + dpLocal;
      dpPa = dpKgf * 9.81 * 10000.0;
    } else { // snip
      var sn = snipCoef(matId, v);
      var iS = sn.a1000 / 19.61 *
        Math.pow(sn.a0 + sn.c / v, sn.m) /
        Math.pow(innerDiameterM, sn.m + 1.0) * Math.pow(v, 2);
      snipM = sn.m; snipA0 = sn.a0; snipA1000 = sn.a1000; snipC = sn.c;
      i1000 = iS;
      dpPa = iS * 9.81 * lengthM;
      dpKgf = dpPa * 1.0197162e-5;
    }

    var s = dpPa / Math.pow(qM3s * 3600.0, 2);
    var dpMeters = Math.round(dpPa / 9807.0 * 1000.0) / 1000.0;

    var warnings = [];
    if (v < V_OPT_MIN) warnings.push('Скорость ниже 0,25 м/с — возможно отложение осадка и завышенный диаметр');
    if (v > V_OPT_MAX) warnings.push('Скорость выше 1,5 м/с — возможны шум, гидроудары и повышенные потери');
    if (v > V_CHART_MAX) warnings.push('Скорость превышает 10 м/с — увеличьте диаметр');
    if (method === 'teor' && re !== null && re > 2320.0 && re < 4000.0) {
      warnings.push('Число Рейнольдса в переходной зоне (2300–4000) — расчёт менее точен');
    }

    return {
      method: method,
      qM3s: qM3s,
      innerDiameterM: innerDiameterM,
      lengthM: lengthM,
      ro: ro,
      velocity: v,
      nu: nu,
      qLpsAtTemp: qLps,
      reynolds: re,
      lambda: lam,
      rSpecific: rSpec,
      dpFriction: dpFr,
      dpLocal: dpMs,
      snipM: snipM,
      snipA0: snipA0,
      snipA1000: snipA1000,
      snipC: snipC,
      i1000: i1000,
      sChar: s,
      dpKgfCm2: dpKgf,
      dpPa: dpPa,
      dpMeters: dpMeters,
      warnings: warnings
    };
  }

  /** Расчёт по заполненной форме (текстовые поля) */
  function compute(inp) {
    var unit = unitById(inp.unit);
    var q = (parseNum(inp.qText) || 0.0) / unit.divisor;
    var dInner = ((parseNum(inp.dOuterText) || 0.0) - 2.0 * (parseNum(inp.wallText) || 0.0)) / 1000.0;
    var l = parseNum(inp.lengthText) || 0.0;
    var tMid = parseNum(inp.temperatureText) || 0.0;
    var sumKsi = inp.method === 'teor' ? (parseNum(inp.ksiText) || 0.0) : 0.0;
    return computeParsed(inp.method, inp.material, q, dInner, l, tMid, roughnessById(inp.roughness).mm, sumKsi);
  }

  /**
   * Кривая потерь давления ΔP(внутренний диаметр) по диапазону диаметров,
   * соответствующему скоростям 0,1…10 м/с (слева — больший диаметр, как на сайте).
   */
  function chartSeries(inp, steps) {
    if (steps === undefined) steps = 120;
    var unit = unitById(inp.unit);
    var q = (parseNum(inp.qText) || 0.0) / unit.divisor;
    var l = parseNum(inp.lengthText) || 0.0;
    var tMid = parseNum(inp.temperatureText) || 0.0;
    var sumKsi = inp.method === 'teor' ? (parseNum(inp.ksiText) || 0.0) : 0.0;
    var ro = waterDensity(tMid);
    var sher = roughnessById(inp.roughness).mm;
    var dLeft = diameterForVelocity(q, ro, V_CHART_MIN);  // больший диаметр (v = 0,1)
    var dRight = diameterForVelocity(q, ro, V_CHART_MAX); // меньший диаметр (v = 10)
    var list = [];
    for (var i = 0; i <= steps; i++) {
      var d = dLeft - (dLeft - dRight) * i / steps;
      var r = computeParsed(inp.method, inp.material, q, d, l, tMid, sher, sumKsi);
      list.push({
        diameterMm: d * 1000.0,
        dpKgf: r.dpKgfCm2,
        dpPa: r.dpPa,
        velocity: r.velocity,
        reynolds: r.reynolds
      });
    }
    return list;
  }

  /**
   * Диапазон оптимальных внутренних диаметров (скорость 0,25…1,5 м/с)
   * и подходящие стандартные условные проходы.
   */
  function optimalDiameter(inp) {
    var unit = unitById(inp.unit);
    var q = (parseNum(inp.qText) || 0.0) / unit.divisor;
    var ro = waterDensity(parseNum(inp.temperatureText) || 0.0);
    var dMin = diameterForVelocity(q, ro, V_OPT_MAX) * 1000.0; // при v = 1,5
    var dMax = diameterForVelocity(q, ro, V_OPT_MIN) * 1000.0; // при v = 0,25
    var fit = [];
    for (var i = 0; i < STANDARD_DIAMETERS.length; i++) {
      var d = STANDARD_DIAMETERS[i];
      if (d >= dMin && d <= dMax) fit.push(d);
    }
    return { minMm: dMin, maxMm: dMax, fit: fit };
  }

  var HydroCalc = {
    V_OPT_MIN: V_OPT_MIN,
    V_OPT_MAX: V_OPT_MAX,
    V_CHART_MIN: V_CHART_MIN,
    V_CHART_MAX: V_CHART_MAX,
    METHODS: METHODS,
    MATERIALS: MATERIALS,
    ROUGHNESS: ROUGHNESS,
    FLOW_UNITS: FLOW_UNITS,
    STANDARD_DIAMETERS: STANDARD_DIAMETERS,
    parseNum: parseNum,
    materialById: materialById,
    roughnessById: roughnessById,
    unitById: unitById,
    waterDensity: waterDensity,
    waterViscosity: waterViscosity,
    diameterForVelocity: diameterForVelocity,
    snipCoef: snipCoef,
    validate: validate,
    compute: compute,
    computeParsed: computeParsed,
    chartSeries: chartSeries,
    optimalDiameter: optimalDiameter
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HydroCalc;
  global.HydroCalc = HydroCalc;
})(typeof window !== 'undefined' ? window : globalThis);
