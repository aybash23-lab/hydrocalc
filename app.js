/*
 * Логика интерфейса PWA «Гидравлический расчёт трубопровода».
 * Живой пересчёт при изменении любого поля, график, оптимальный диаметр,
 * экспорт (копирование, системный диалог «Поделиться», текстовый отчёт),
 * офлайн-режим (service worker) и установка приложения.
 */
(function () {
  'use strict';

  var HC = window.HydroCalc;
  var Chart = window.HydroChart;
  var $ = function (id) { return document.getElementById(id); };

  var STORAGE_KEY = 'hydrocalc-inputs-v1';

  var DEFAULTS = {
    method: 'shev',
    material: 1,
    qText: '15',
    unit: 'lps',
    dOuterText: '150',
    wallText: '5',
    lengthText: '100',
    temperatureText: '15',
    roughness: 2,
    ksiText: '1.89'
  };

  var METHOD_HINTS = {
    shev: 'Эмпирические таблицы Ф.А. Шевелева для водопроводных труб: 1000i = tк·(q^tв / d^тм), коэффициенты зависят от материала.',
    teor: 'Классические формулы: число Рейнольдса, коэффициент трения λ (Пуазейль, Блазиус, Альтшуль), потери на трение и местные сопротивления.',
    snip: 'Формула СНиП 2.04.02-84 (ныне СП 31.13330) для наружных и магистральных водопроводов.'
  };

  var state = loadState();
  var renderTimer = null;
  var toastTimer = null;
  var deferredPrompt = null;
  var lastChart = null;

  // ------------------------------------------------------------------
  // Хранение состояния
  // ------------------------------------------------------------------

  function loadState() {
    var base = Object.assign({}, DEFAULTS);
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      var saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') base = Object.assign(base, saved);
    } catch (e) { /* приватный режим и т.п. — используем значения по умолчанию */ }
    if (HC.materialById(base.material).id !== base.material) base.material = DEFAULTS.material;
    if (HC.roughnessById(base.roughness).id !== base.roughness) base.roughness = DEFAULTS.roughness;
    if (!HC.unitById(base.unit).id || HC.unitById(base.unit).id !== base.unit) base.unit = DEFAULTS.unit;
    if (['shev', 'teor', 'snip'].indexOf(base.method) < 0) base.method = DEFAULTS.method;
    return base;
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Форматирование чисел (порт Format.kt: русский формат, запятая)
  // ------------------------------------------------------------------

  var SUP = { '-': '\u207B', '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3',
              '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };

  function sup(n) {
    var s = String(n), out = '';
    for (var i = 0; i < s.length; i++) out += SUP[s[i]] || s[i];
    return out;
  }

  function group3(intPart) {
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  }

  function fmtFixed(x, digits) {
    if (!isFinite(x)) return '∞';
    var neg = x < 0;
    var s = Math.abs(x).toFixed(digits);
    var parts = s.split('.');
    var out = group3(parts[0]) + (digits > 0 ? ',' + parts[1] : '');
    return (neg ? '\u2212' : '') + out;
  }

  function fmt3(x) { return fmtFixed(x, 3); }

  function fmtVal(x) {
    if (x !== 0 && Math.abs(x) < 0.001) return fmtFixed(x, 6);
    return fmtFixed(x, 3);
  }

  function fmtInt(x) { return fmtFixed(x, 0); }

  function fmtPa(x) {
    return Math.abs(x) >= 1000.0 ? fmtFixed(x / 1000.0, 1) + ' кПа' : fmtFixed(x, 0) + ' Па';
  }

  function fmtSci(x) {
    if (x === 0) return '0';
    if (!isFinite(x)) return '∞';
    var exp = Math.floor(Math.log10(Math.abs(x)));
    var mant = x / Math.pow(10, exp);
    return fmtFixed(mant, 3) + '\u00B710' + sup(exp);
  }

  /** Коэффициенты: без хвостовых нулей (15,900 → 15,9) */
  function fmtCoef(x) {
    var s = fmtFixed(x, 4);
    if (s.indexOf(',') >= 0) s = s.replace(/0+$/, '').replace(/,$/, '');
    return s;
  }

  // ------------------------------------------------------------------
  // Инициализация полей
  // ------------------------------------------------------------------

  function fillSelect(sel, items, selectedId, labelFn) {
    sel.textContent = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var opt = document.createElement('option');
      opt.value = String(it.id);
      opt.textContent = labelFn(it);
      if (it.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function fillMethodRadios() {
    var radios = document.querySelectorAll('input[name="method"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === state.method;
    }
  }

  function syncInputs() {
    fillMethodRadios();
    $('q').value = state.qText;
    $('unit').value = state.unit;
    $('dOuter').value = state.dOuterText;
    $('wall').value = state.wallText;
    $('length').value = state.lengthText;
    $('temp').value = state.temperatureText;
    $('ksi').value = state.ksiText;
    $('material').value = String(state.material);
    $('roughness').value = String(state.roughness);
    $('methodHint').textContent = METHOD_HINTS[state.method];
  }

  // ------------------------------------------------------------------
  // Отрисовка результатов
  // ------------------------------------------------------------------

  function addRow(dl, label, value, unit) {
    var row = document.createElement('div');
    row.className = 'result-row';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    if (unit) {
      var u = document.createElement('span');
      u.className = 'unit';
      u.textContent = ' ' + unit;
      dd.appendChild(u);
    }
    row.appendChild(dt);
    row.appendChild(dd);
    dl.appendChild(row);
  }

  function setWarnings(list) {
    var box = $('warnings');
    box.textContent = '';
    box.hidden = list.length === 0;
    for (var i = 0; i < list.length; i++) {
      var item = document.createElement('div');
      item.className = 'warning-item';
      item.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm0 5 7.5 13h-15L12 7zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z"/></svg>';
      var span = document.createElement('span');
      span.textContent = list[i];
      item.appendChild(span);
      box.appendChild(item);
    }
  }

  function renderResults(res) {
    var tileV = $('tileV'), badge = $('vBadge');
    $('vValue').textContent = fmt3(res.velocity);
    if (res.velocity < HC.V_OPT_MIN) {
      badge.textContent = 'ниже оптимального диапазона';
      badge.className = 'tile-badge warn';
      tileV.className = 'tile opt-warn';
    } else if (res.velocity > HC.V_OPT_MAX) {
      badge.textContent = 'выше оптимального диапазона';
      badge.className = 'tile-badge warn';
      tileV.className = 'tile opt-warn';
    } else {
      badge.textContent = 'оптимальная скорость';
      badge.className = 'tile-badge ok';
      tileV.className = 'tile opt-ok';
    }

    $('dpValue').textContent = fmtVal(res.dpKgfCm2);
    $('dpSub').textContent = '= ' + fmt3(res.dpMeters) + ' м вод. ст. · ' + fmtPa(res.dpPa);

    setWarnings(res.warnings);

    var main = $('mainList');
    main.textContent = '';
    addRow(main, 'Потери давления ΔP', fmtVal(res.dpKgfCm2), 'кгс/см²');
    addRow(main, 'Потери давления ΔP', fmtPa(res.dpPa), '');
    addRow(main, 'Потери давления ΔP', fmt3(res.dpMeters), 'м вод. ст.');
    addRow(main, 'Характеристика сопротивления S', fmtVal(res.sChar), 'Па/(т/ч)²');
    addRow(main, 'Плотность воды ρ при ' + state.temperatureText.replace('.', ',') + ' °C', fmt3(res.ro), 'т/м³');
    if (res.method !== 'teor') {
      addRow(main, '1000i (удельные потери напора)', fmtVal(res.i1000), 'м вод. ст./км');
    }

    var teorBlock = $('teorBlock'), snipBlock = $('snipBlock');
    teorBlock.hidden = res.method !== 'teor';
    snipBlock.hidden = res.method !== 'snip';

    if (res.method === 'teor') {
      var tl = $('teorList');
      tl.textContent = '';
      addRow(tl, 'Кинематическая вязкость ν', fmtSci(res.nu), 'м²/с');
      addRow(tl, 'Расход при рабочей температуре G', fmt3(res.qLpsAtTemp), 'л/с');
      addRow(tl, 'Число Рейнольдса Re', fmtInt(res.reynolds), '');
      addRow(tl, 'Коэффициент гидравлического трения λ', fmtVal(res.lambda), '');
      addRow(tl, 'Удельные потери на трение R', fmtVal(res.rSpecific), 'кгс/(см²·м)');
      addRow(tl, 'Потери на трение по длине', fmtVal(res.dpFriction), 'кгс/см²');
      addRow(tl, 'Потери в местных сопротивлениях (Σζ = ' + fmtCoef(HC.parseNum(state.ksiText) || 0) + ')', fmtVal(res.dpLocal), 'кгс/см²');
    }

    if (res.method === 'snip') {
      var sl = $('snipList');
      sl.textContent = '';
      addRow(sl, 'Показатель степени m', fmtCoef(res.snipM), '');
      addRow(sl, 'A0', fmtCoef(res.snipA0), '');
      addRow(sl, 'A1000', fmtCoef(res.snipA1000), '');
      addRow(sl, 'C', fmtCoef(res.snipC), '');
      if (state.material === 3) {
        addRow(sl, 'Неновые стальные/чугунные: таблица выбрана по скорости', res.velocity <= 1.2 ? 'v ≤ 1,2 м/с' : 'v > 1,2 м/с', '');
      }
    }
  }

  function renderChart(res) {
    var series = HC.chartSeries(state, 120);
    var q = res.qM3s, ro = res.ro;
    var optLo = HC.diameterForVelocity(q, ro, HC.V_OPT_MAX) * 1000.0;
    var optHi = HC.diameterForVelocity(q, ro, HC.V_OPT_MIN) * 1000.0;
    var reBand = null;
    if (res.method === 'teor' && res.nu) {
      var dRe = function (re) { return 4.0 * q / (ro * Math.PI * res.nu * re) * 1000.0; };
      reBand = [dRe(4000), dRe(2320)];
    }
    var opts = {
      optBandD: [optLo, optHi],
      reBandD: reBand,
      currentDiameterMm: res.innerDiameterM * 1000.0
    };
    lastChart = { series: series, opts: opts };
    Chart.drawChart($('chart'), series, opts);
    $('legendRe').hidden = res.method !== 'teor';
  }

  function renderOptimal(res) {
    var opt = HC.optimalDiameter(state);
    $('optRange').textContent = 'от ' + fmtInt(Math.round(opt.minMm)) + ' до ' +
      fmtInt(Math.round(opt.maxMm)) + ' мм';
    var box = $('optChips');
    box.textContent = '';
    if (opt.fit.length === 0) {
      var p = document.createElement('p');
      p.className = 'chips-empty';
      p.textContent = 'Стандартных условных проходов в этом диапазоне нет — используйте ближайший больший.';
      box.appendChild(p);
      return;
    }
    for (var i = 0; i < opt.fit.length; i++) {
      (function (d) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = 'Ø ' + d;
        chip.setAttribute('aria-label', 'Подставить условный проход ' + d + ' мм');
        chip.addEventListener('click', function () {
          state.dOuterText = String(d);
          saveState();
          syncInputs();
          scheduleRender();
          toast('Условный проход Ø ' + d + ' мм подставлен в наружный диаметр — проверьте толщину стенки');
          $('dOuter').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        box.appendChild(chip);
      })(opt.fit[i]);
    }
  }

  function render() {
    var dOut = HC.parseNum(state.dOuterText) || 0;
    var s = HC.parseNum(state.wallText) || 0;
    var dIn = dOut - 2 * s;
    $('dInner').textContent = isFinite(dIn) && dIn > 0 ? fmtCoef(dIn) + ' мм' : '—';

    var error = HC.validate(state);
    var errBox = $('inputError');
    if (error) {
      errBox.textContent = error;
      errBox.hidden = false;
      $('resultsCard').hidden = true;
      $('chartCard').hidden = true;
      $('optCard').hidden = true;
      return;
    }
    errBox.hidden = true;
    $('resultsCard').hidden = false;
    $('chartCard').hidden = false;
    $('optCard').hidden = false;

    var res = HC.compute(state);
    renderResults(res);
    renderChart(res);
    renderOptimal(res);
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 60);
  }

  // ------------------------------------------------------------------
  // Отчёт и экспорт
  // ------------------------------------------------------------------

  function methodName(id) {
    return id === 'shev' ? 'Таблицы Шевелева' : id === 'teor' ? 'Теоретическая гидравлика' : 'СНиП 2.04.02-84';
  }

  function buildReport() {
    var res = HC.compute(state);
    var mat = HC.materialById(state.material);
    var rough = HC.roughnessById(state.roughness);
    var unit = HC.unitById(state.unit);
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear() +
      ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var L = [];
    L.push('ГИДРАВЛИЧЕСКИЙ РАСЧЁТ ТРУБОПРОВОДА');
    L.push('Дата: ' + stamp);
    L.push('----------------------------------------');
    L.push('Метод расчёта: ' + methodName(state.method));
    L.push('Материал труб: ' + mat.title);
    L.push('Расчётный расход q: ' + state.qText.replace('.', ',') + ' ' + unit.title);
    L.push('Наружный диаметр D: ' + state.dOuterText.replace('.', ',') + ' мм');
    L.push('Толщина стенки s: ' + state.wallText.replace('.', ',') + ' мм');
    L.push('Внутренний диаметр: ' + fmtCoef(res.innerDiameterM * 1000) + ' мм');
    L.push('Длина L: ' + state.lengthText.replace('.', ',') + ' м');
    L.push('Средняя температура воды t: ' + state.temperatureText.replace('.', ',') + ' °C');
    if (state.method === 'teor') {
      L.push('Шероховатость Кэ: ' + fmtCoef(rough.mm) + ' мм (' + rough.title + ')');
      L.push('Сумма местных сопротивлений Σζ: ' + fmtCoef(HC.parseNum(state.ksiText) || 0));
    }
    L.push('----------------------------------------');
    L.push('РЕЗУЛЬТАТЫ');
    L.push('Скорость v: ' + fmt3(res.velocity) + ' м/с');
    L.push('Потери давления ΔP: ' + fmtVal(res.dpKgfCm2) + ' кгс/см² = ' +
      fmt3(res.dpMeters) + ' м вод. ст. = ' + fmtPa(res.dpPa));
    L.push('Характеристика сопротивления S: ' + fmtVal(res.sChar) + ' Па/(т/ч)²');
    L.push('Плотность воды ρ: ' + fmt3(res.ro) + ' т/м³');
    if (res.method !== 'teor') {
      L.push('1000i: ' + fmtVal(res.i1000) + ' м вод. ст./км');
    }
    if (res.method === 'teor') {
      L.push('Кинематическая вязкость ν: ' + fmtSci(res.nu) + ' м²/с');
      L.push('Расход при рабочей температуре G: ' + fmt3(res.qLpsAtTemp) + ' л/с');
      L.push('Число Рейнольдса Re: ' + fmtInt(res.reynolds));
      L.push('Коэффициент трения λ: ' + fmtVal(res.lambda));
      L.push('Удельные потери на трение R: ' + fmtVal(res.rSpecific) + ' кгс/(см²·м)');
      L.push('Потери на трение: ' + fmtVal(res.dpFriction) + ' кгс/см²');
      L.push('Потери в местных сопротивлениях: ' + fmtVal(res.dpLocal) + ' кгс/см²');
    }
    if (res.method === 'snip') {
      L.push('Коэффициенты СНиП: m = ' + fmtCoef(res.snipM) + ', A0 = ' + fmtCoef(res.snipA0) +
        ', A1000 = ' + fmtCoef(res.snipA1000) + ', C = ' + fmtCoef(res.snipC));
    }
    var opt = HC.optimalDiameter(state);
    L.push('----------------------------------------');
    L.push('ОПТИМАЛЬНЫЙ ДИАМЕТР (v = 0,25–1,5 м/с)');
    L.push('Внутренний диаметр: от ' + fmtInt(Math.round(opt.minMm)) + ' до ' + fmtInt(Math.round(opt.maxMm)) + ' мм');
    if (opt.fit.length > 0) L.push('Стандартные условные проходы: ' + opt.fit.join(', ') + ' мм');
    if (res.warnings.length > 0) {
      L.push('----------------------------------------');
      L.push('ПРЕДУПРЕЖДЕНИЯ:');
      for (var i = 0; i < res.warnings.length; i++) L.push('- ' + res.warnings[i]);
    }
    L.push('----------------------------------------');
    L.push('Методика и справочные данные соответствуют онлайн-калькулятору');
    L.push('prostobuild.by (таблицы Шевелева, теоретическая гидравлика, СНиП 2.04.02-84).');
    L.push('Результаты носят справочный характер.');
    return L.join('\n');
  }

  function showToast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3000);
  }

  function copyReport() {
    var text = buildReport();
    var done = function () { showToast('Результаты скопированы в буфер обмена'); };
    var fail = function () { fallbackCopy(text, done); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    showToast(ok ? 'Результаты скопированы в буфер обмена' : 'Не удалось скопировать — используйте «Отчёт»');
    if (ok && done) done();
  }

  function shareReport() {
    var text = buildReport();
    if (navigator.share) {
      navigator.share({
        title: 'Гидравлический расчёт трубопровода',
        text: text
      }).then(function () {
        showToast('Результаты отправлены');
      }, function (err) {
        if (err && err.name === 'AbortError') return;
        copyReport();
      });
    } else {
      copyReport();
      showToast('Системный диалог недоступен — результаты скопированы');
    }
  }

  function saveReport() {
    try {
      var blob = new Blob(['\uFEFF' + buildReport()], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'raschet-truboprovoda.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      showToast('Отчёт сохранён в файл');
    } catch (e) {
      copyReport();
    }
  }

  // ------------------------------------------------------------------
  // PWA: service worker, установка, офлайн
  // ------------------------------------------------------------------

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      // service worker работает только по https или localhost — молча пропускаем
      return;
    }
    navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн недоступен — расчёт всё равно работает */ });
  }

  function setupInstall() {
    var btn = $('installBtn');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        btn.hidden = true;
      });
    });
    window.addEventListener('appinstalled', function () {
      btn.hidden = true;
      showToast('Приложение установлено');
    });
  }

  function setupOfflineBar() {
    var bar = $('offlineBar');
    var update = function () { bar.hidden = navigator.onLine; };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function setupAbout() {
    var dialog = $('aboutDialog');
    var open = function (e) {
      if (e) e.preventDefault();
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      $('installHintIOS').hidden = !ios;
      $('installHintChrome').hidden = ios;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };
    $('aboutBtn').addEventListener('click', open);
    $('aboutBtn2').addEventListener('click', open);
    $('aboutClose').addEventListener('click', function () {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    });
  }

  // ------------------------------------------------------------------
  // Привязка событий и запуск
  // ------------------------------------------------------------------

  function bindEvents() {
    var radios = document.querySelectorAll('input[name="method"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener('change', function (e) {
        if (!e.target.checked) return;
        state.method = e.target.value;
        $('methodHint').textContent = METHOD_HINTS[state.method];
        saveState();
        scheduleRender();
      });
    }

    $('material').addEventListener('change', function (e) {
      state.material = parseInt(e.target.value, 10);
      saveState();
      scheduleRender();
    });

    $('roughness').addEventListener('change', function (e) {
      state.roughness = parseInt(e.target.value, 10);
      saveState();
      scheduleRender();
    });

    $('unit').addEventListener('change', function (e) {
      state.unit = e.target.value;
      saveState();
      scheduleRender();
    });

    var textFields = [
      ['q', 'qText'], ['dOuter', 'dOuterText'], ['wall', 'wallText'],
      ['length', 'lengthText'], ['temp', 'temperatureText'], ['ksi', 'ksiText']
    ];
    for (var i = 0; i < textFields.length; i++) {
      (function (inputId, stateKey) {
        $(inputId).addEventListener('input', function (e) {
          state[stateKey] = e.target.value;
          saveState();
          scheduleRender();
        });
      })(textFields[i][0], textFields[i][1]);
    }

    $('copyBtn').addEventListener('click', copyReport);
    $('shareBtn').addEventListener('click', shareReport);
    $('saveBtn').addEventListener('click', saveReport);

    window.addEventListener('resize', function () {
      if (lastChart) Chart.drawChart($('chart'), lastChart.series, lastChart.opts);
    });
  }

  function init() {
    fillSelect($('material'), HC.MATERIALS, state.material, function (m) { return m.title; });
    fillSelect($('roughness'), HC.ROUGHNESS, state.roughness, function (r) {
      return r.title + ' — Кэ = ' + fmtCoef(r.mm) + ' мм';
    });
    fillSelect($('unit'), HC.FLOW_UNITS, state.unit, function (u) { return u.title; });
    syncInputs();
    bindEvents();
    setupInstall();
    setupOfflineBar();
    setupAbout();
    registerSW();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
