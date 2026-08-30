/* 设置（配置区）：几点上课、一节课多久、请假提前多久不扣课时、
 * 提醒提前几天、发给家长的话怎么说……全在这页改，改完立刻生效。
 * 要加可配置项，只需在 config.js 的 SETTINGS_SCHEMA 里加一行，
 * 这页就会自动多出一个输入框。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  // 周一 ~ 周日
  var WD = [
    { n: 1, t: '一' }, { n: 2, t: '二' }, { n: 3, t: '三' },
    { n: 4, t: '四' }, { n: 5, t: '五' }, { n: 6, t: '六' }, { n: 0, t: '日' }
  ];

  function render(root) {
    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>设置</h2>' +
          '<p class="muted">改完立刻生效，不用保存按钮，也不用找我改代码。</p>' +
        '</div>' +
        renderTimeSlots() +
        renderCourts() +
        renderSchemaGroups() +
        renderTexts() +
        renderCloudSync() +
        renderDangerZone() +
      '</div>';
    bindEvents(root);
  }

  /* ---------- 1. 上课时段档位（Q2 的核心） ---------- */
  function renderTimeSlots() {
    var slots = BC.config.get('schedule.timeSlots');

    var rows = slots.map(function (s, idx) {
      var wdChips = WD.map(function (w) {
        var on = s.weekdays.indexOf(w.n) >= 0;
        return '<button class="chip' + (on ? ' chip--on' : '') + '" ' +
          'data-slot-wd="' + s.id + '" data-wd="' + w.n + '">' + w.t + '</button>';
      }).join('');

      return '<div class="slotrow" data-slot="' + s.id + '">' +
        '<div class="slotrow__main">' +
          '<label class="switch"><input type="checkbox" data-slot-enabled="' + s.id + '"' + (s.enabled ? ' checked' : '') + '><span class="switch__box"></span></label>' +
          '<input class="input input--xs" type="text" data-slot-label="' + s.id + '" value="' + esc(s.label) + '" style="width:70px">' +
          '<input class="input input--xs" type="time" data-slot-start="' + s.id + '" value="' + esc(s.start) + '">' +
          '<span class="dash">到</span>' +
          '<input class="input input--xs" type="time" data-slot-end="' + s.id + '" value="' + esc(s.end) + '">' +
          '<div class="slotrow__spacer"></div>' +
          '<button class="linkbtn linkbtn--danger" data-slot-del="' + s.id + '">删除</button>' +
        '</div>' +
        '<div class="slotrow__days"><span class="slotrow__daylabel">哪几天开：</span>' + wdChips + '</div>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">B · 上课时段</h3>' +
      '<p class="muted hint">你的课是固定档位。周内（一~五）只开晚间，周末四个都开 —— 点「哪几天开」那排小方块就能改。</p>' +
      rows +
      '<button class="btn btn--ghost" id="btn-add-slot">+ 加一个时段</button>' +
    '</section>';
  }

  /* ---------- 2. 场地 ---------- */
  function renderCourts() {
    var courts = BC.config.get('schedule.courts');
    var rows = courts.map(function (c) {
      return '<div class="courtrow">' +
        '<input class="input input--sm" type="text" data-court-name="' + c.id + '" value="' + esc(c.name) + '">' +
        '<button class="linkbtn linkbtn--danger" data-court-del="' + c.id + '">删除</button>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">B · 场地</h3>' +
      '<p class="muted hint">改名字直接改。这里的场地就是排片表上横着的那几列。</p>' +
      rows +
      '<button class="btn btn--ghost" id="btn-add-court">+ 加一片场地</button>' +
    '</section>';
  }

  /* ---------- 3. 按 SETTINGS_SCHEMA 自动生成的配置项 ---------- */
  function renderSchemaGroups() {
    return BC.config.SETTINGS_SCHEMA.map(function (group) {
      var items = group.items.map(function (it) {
        var val = BC.config.get(it.path);
        var input, cls = 'setrow';

        if (it.type === 'checkbox') {
          input = '<label class="switch"><input type="checkbox" data-path="' + it.path + '"' +
            (val ? ' checked' : '') + '><span class="switch__box"></span></label>';
        } else if (it.type === 'select') {
          input = '<select class="input input--md" data-path="' + it.path + '">' +
            (it.options || []).map(function (o) {
              var label = (it.optionLabels && it.optionLabels[o]) || o;
              return '<option value="' + esc(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(label) + '</option>';
            }).join('') + '</select>';
        } else if (it.type === 'number') {
          input = '<input class="input input--sm" type="number" data-path="' + it.path + '" value="' + esc(val) + '">';
        } else {
          input = '<input class="input input--sm" type="text" data-path="' + it.path +
            '" value="' + esc(Array.isArray(val) ? val.join(', ') : val) + '">';
        }

        return '<div class="' + cls + '">' +
          '<div class="setrow__label">' + esc(it.label) +
            (it.unit ? '<span class="setrow__unit">' + esc(it.unit) + '</span>' : '') +
            (it.help ? '<div class="setrow__help">' + esc(it.help) + '</div>' : '') +
          '</div>' +
          '<div class="setrow__input">' + input + '</div>' +
        '</div>';
      }).join('');

      return '<section class="card"><h3 class="card__title">' + esc(group.group) + '</h3>' + items + '</section>';
    }).join('');
  }

  /* ---------- 4. 通知话术模板 ---------- */
  function renderTexts() {
    var texts = BC.config.get('texts');
    var labels = {
      notifySchedule: '排课通知',
      notifyClassReminder: '上课提醒',
      notifyLowBalance: '课时不足',
      notifyExpiring: '即将到期',
      notifyLeaveResult: '请假结果'
    };
    var rows = Object.keys(labels).map(function (k) {
      return '<div class="setrow setrow--stack">' +
        '<div class="setrow__label">' + esc(labels[k]) + '</div>' +
        '<textarea class="input" rows="2" data-path="texts.' + k + '">' + esc(texts[k]) + '</textarea>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">F · 通知话术模板</h3>' +
      '<p class="muted hint">{孩子} {家长} {日期} {时间} {场地} {剩余} {到期日} {结果} 这些花括号会自动换成真实内容。</p>' +
      rows +
    '</section>';
  }

  /* ---------- 4.5 云端同步（Supabase） ---------- */
  function renderCloudSync() {
    var on = BC.cloud && BC.cloud.on();
    return '<section class="card">' +
      '<h3 class="card__title">云端同步（Supabase）</h3>' +
      '<p class="muted hint">' +
        (on
          ? '已连接 ✅ 现在家长确认/填报你这边能实时收到，家长链接也很短。下面两个按钮用于首次启用或换设备时手动对齐数据。'
          : '还没连接。在「G · 上线与分享」里填好云端地址和密钥后，这里就能用。连接后家长确认/填报你这边实时收到，链接也变短。') +
      '</p>' +
      '<div class="btnrow">' +
        '<button class="btn btn--primary" id="btn-cloud-push"' + (on ? '' : ' disabled') + '>把本机数据上传到云端</button>' +
        '<button class="btn btn--ghost" id="btn-cloud-pull"' + (on ? '' : ' disabled') + '>从云端拉回本机</button>' +
      '</div>' +
      '<p class="muted hint" id="cloud-status"></p>' +
    '</section>';
  }

  /* ---------- 5. 备份与重置 ---------- */
  function renderDangerZone() {
    return '<section class="card">' +
      '<h3 class="card__title">备份与重置</h3>' +
      '<div class="btnrow">' +
        '<button class="btn btn--ghost" id="btn-import">导入备份文件</button>' +
        '<button class="btn btn--ghost" id="btn-reset-cfg">配置恢复默认值</button>' +
        '<button class="btn btn--danger" id="btn-clear-data">清空全部学员和课程</button>' +
      '</div>' +
      '<input type="file" id="file-import" accept="application/json" style="display:none">' +
    '</section>';
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents(root) {
    // 通用配置项
    root.querySelectorAll('[data-path]').forEach(function (el) {
      el.addEventListener('change', function () {
        var path = el.getAttribute('data-path');
        var value = (el.type === 'checkbox') ? el.checked : el.value;
        // expiryLeadDays 是数组，设置页里填的是「14, 3」这种逗号串，
        // 必须转回数字数组再存，否则存成字符串会让提醒判断报错
        if (path === 'reminder.expiryLeadDays') {
          value = String(value).split(/[，,\s]+/).map(function (x) { return Number(x.trim()); })
            .filter(function (n) { return !isNaN(n); });
          if (!value.length) value = [14, 3];
        }
        BC.config.set(path, value);
        ui.toast('已保存');
        if (path === 'lesson.maxLessonsPerDay' || path === 'lesson.deductMode') render(root);
      });
    });

    /* ---- 时段档位 ---- */
    function patchSlot(id, patch) {
      var slots = BC.config.get('schedule.timeSlots');
      slots.forEach(function (s) { if (s.id === id) Object.assign(s, patch); });
      BC.config.set('schedule.timeSlots', slots);
      if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();   // 改了时段立刻同步给家长端
    }

    root.querySelectorAll('[data-slot-enabled]').forEach(function (el) {
      el.addEventListener('change', function () {
        patchSlot(el.getAttribute('data-slot-enabled'), { enabled: el.checked });
        ui.toast(el.checked ? '这个时段已开启' : '这个时段已关闭');
      });
    });
    root.querySelectorAll('[data-slot-label]').forEach(function (el) {
      el.addEventListener('change', function () { patchSlot(el.getAttribute('data-slot-label'), { label: el.value.trim() || '时段' }); ui.toast('已保存'); });
    });
    root.querySelectorAll('[data-slot-start]').forEach(function (el) {
      el.addEventListener('change', function () { patchSlot(el.getAttribute('data-slot-start'), { start: el.value }); ui.toast('已保存'); });
    });
    root.querySelectorAll('[data-slot-end]').forEach(function (el) {
      el.addEventListener('change', function () { patchSlot(el.getAttribute('data-slot-end'), { end: el.value }); ui.toast('已保存'); });
    });
    root.querySelectorAll('[data-slot-wd]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-slot-wd');
        var wd = Number(el.getAttribute('data-wd'));
        var slot = BC.config.get('schedule.timeSlots').filter(function (s) { return s.id === id; })[0];
        var i = slot.weekdays.indexOf(wd);
        if (i >= 0) slot.weekdays.splice(i, 1); else slot.weekdays.push(wd);
        slot.weekdays.sort(function (a, b) { return (a === 0 ? 7 : a) - (b === 0 ? 7 : b); });
        patchSlot(id, { weekdays: slot.weekdays });
        render(root);
      });
    });
    root.querySelectorAll('[data-slot-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-slot-del');
        var slots = BC.config.get('schedule.timeSlots');
        if (slots.length <= 1) { ui.toast('至少留一个时段', 'danger'); return; }
        ui.confirm('删掉这个时段？', function () {
          BC.config.set('schedule.timeSlots', slots.filter(function (s) { return s.id !== id; }));
          if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();
          ui.toast('已删除');
          render(root);
        });
      });
    });
    var addSlot = root.querySelector('#btn-add-slot');
    if (addSlot) addSlot.addEventListener('click', function () {
      var slots = BC.config.get('schedule.timeSlots');
      slots.push({ id: util.uid('slot'), label: '新时段', start: '08:00', end: '10:00', weekdays: [0, 6], enabled: true });
      BC.config.set('schedule.timeSlots', slots);
      if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();
      render(root);
    });

    /* ---- 场地 ---- */
    root.querySelectorAll('[data-court-name]').forEach(function (el) {
      el.addEventListener('change', function () {
        var id = el.getAttribute('data-court-name');
        var courts = BC.config.get('schedule.courts');
        courts.forEach(function (c) { if (c.id === id) c.name = el.value.trim() || c.name; });
        BC.config.set('schedule.courts', courts);
        if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();
        ui.toast('场地名已改');
        render(root);
      });
    });
    root.querySelectorAll('[data-court-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-court-del');
        var courts = BC.config.get('schedule.courts');
        if (courts.length <= 1) { ui.toast('至少留一片场地', 'danger'); return; }
        ui.confirm('删掉这片场地？', function () {
          BC.config.set('schedule.courts', courts.filter(function (c) { return c.id !== id; }));
          if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();
          ui.toast('已删除');
          render(root);
        });
      });
    });
    var addCourt = root.querySelector('#btn-add-court');
    if (addCourt) addCourt.addEventListener('click', function () {
      var courts = BC.config.get('schedule.courts');
      courts.push({ id: util.uid('court'), name: (courts.length + 1) + ' 号场' });
      BC.config.set('schedule.courts', courts);
      if (BC.cloud && BC.cloud.on()) BC.cloud.pushMeta();
      render(root);
    });

    /* ---- 云端同步 ---- */
    var cloudStatus = root.querySelector('#cloud-status');
    function setCloudStatus(msg, bad) { if (cloudStatus) { cloudStatus.textContent = msg; cloudStatus.style.color = bad ? '' : ''; } }
    var pushBtn = root.querySelector('#btn-cloud-push');
    if (pushBtn) pushBtn.addEventListener('click', function () {
      if (!(BC.cloud && BC.cloud.on())) { ui.toast('先在 G · 上线与分享 填好云端地址和密钥', 'danger'); return; }
      pushBtn.disabled = true;
      setCloudStatus('正在上传…');
      BC.cloud.pushAll(function (err, count) {
        if (err) {
          pushBtn.disabled = false;
          setCloudStatus('上传失败：' + err.message);
          ui.toast('上传失败', 'danger');
          return;
        }
        if (!count) {
          // 以前这里也报"上传成功"，其实一条都没传，最容易让人白等
          pushBtn.disabled = false;
          setCloudStatus('本机还没有任何学员和课程，这次没有东西要上传。先去「学员档案」加学员。');
          ui.toast('本机没有数据可上传', 'warn');
          return;
        }
        // 光"写得进去"不代表家长"读得出来"（Supabase 可能只给了写权限没给读权限）。
        // 所以上传完立刻回头读一次验证，把结论直接说清楚，省得你以为好了、家长那边却打不开。
        setCloudStatus('已上传 ' + count + ' 条，正在验证家长端能不能读到…');
        BC.cloud.pushMeta(function () {
          BC.cloud.selfCheck(function (e2, res) {
            pushBtn.disabled = false;
            if (res && res.readable && res.allFound) {
              setCloudStatus('已上传 ' + count + ' 条，并且验证通过 ✅ 家长端能正常读到，去「家长链接」页可以拿到短链接了。');
              ui.toast('上传并验证通过');
            } else if (res && !res.readable) {
              setCloudStatus('已上传 ' + count + ' 条，但读不回来 ⚠️ 通常是 Supabase 少给了读权限。' +
                '去 Supabase 的 SQL Editor 跑一次：grant select, insert, update, delete on public.bc_rows to anon;' +
                '（技术信息：' + (res.error || (e2 && e2.message) || '') + '）');
              ui.toast('上传成功但读不回来', 'warn');
            } else if (res && res.missing && res.missing.length) {
              setCloudStatus('已上传 ' + count + ' 条，但云端还找不到这些孩子：' +
                res.missing.slice(0, 5).join('、') + (res.missing.length > 5 ? ' 等' : '') + '。再点一次上传试试。');
              ui.toast('部分数据没对上', 'warn');
            } else {
              setCloudStatus('已上传 ' + count + ' 条 ✅');
              ui.toast('已上传到云端');
            }
          });
        });
      });
    });
    var pullBtn = root.querySelector('#btn-cloud-pull');
    if (pullBtn) pullBtn.addEventListener('click', function () {
      if (!(BC.cloud && BC.cloud.on())) { ui.toast('先在 G · 上线与分享 填好云端地址和密钥', 'danger'); return; }
      pullBtn.disabled = true;
      setCloudStatus('正在拉取…');
      BC.cloud.pullAll(function (err) {
        pullBtn.disabled = false;
        if (err) { setCloudStatus('拉取失败：' + err.message); ui.toast('拉取失败', 'danger'); }
        else { setCloudStatus('已从云端拉回最新数据 ✅'); ui.toast('已拉回最新数据'); render(root); }
      });
    });

    /* ---- 备份与重置 ---- */
    var importBtn = root.querySelector('#btn-import');
    var fileInput = root.querySelector('#file-import');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            BC.store.importAll(reader.result);
            ui.toast('导入成功');
            setTimeout(function () { location.reload(); }, 800);
          } catch (e) { ui.toast('导入失败：文件不是本工具导出的备份', 'danger'); }
        };
        reader.readAsText(f);
      });
    }

    var resetCfg = root.querySelector('#btn-reset-cfg');
    if (resetCfg) resetCfg.addEventListener('click', function () {
      ui.confirm('把所有配置恢复成默认值？（学员数据不会丢）', function () {
        BC.config.reset();
        ui.toast('配置已恢复默认');
        render(root);
      });
    });

    var clearBtn = root.querySelector('#btn-clear-data');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      ui.confirm('清空全部学员、课程和填报记录？不可恢复，建议先导出备份。', function () {
        BC.store.clearAll();
        ui.toast('已清空');
        render(root);
      });
    });
  }

  // 不占底部标签：由右上角齿轮进入
  BC.registerPage('settings', { title: '设置', nav: false, order: 90, render: render });

})(window);
