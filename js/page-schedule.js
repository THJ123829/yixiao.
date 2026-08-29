/* 排课工作台（教练排课的地方）：
 * 左边选"什么时候、哪个场地、什么班"，右边勾"哪几个学员来"，
 * 撞车会立刻标红并说明原因。三类冲突会拦：
 *   1. 场地冲突 —— 这个场地这个时段已经被占了
 *   2. 教练冲突 —— 同一时段只能在一片场地上
 *   3. 学员冲突 —— 同一学员同一时段排进两节课 / 一天超过上限
 * 人数超过设置阈值只给黄色提醒、不拦。排课是"选档位"，不是填几点开始。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  /* ---------- 当前正在编辑的那节课（模块内状态） ---------- */
  var draft = null;
  var editingId = null;
  var keyword = '';
  var showAllTypes = false;   // 候选列表是否显示其他班级的学员

  function newDraft() {
    var cfg = BC.config.load();
    // 默认落在下一个周六（你主要的排课日）
    var d = nextWeekday(util.todayISO(), 6);
    var slots = BC.rules.getDaySlots(d);
    return {
      date: d,
      slotId: slots.length ? slots[0].id : null,
      courtId: (cfg.schedule.courts[0] || {}).id || null,
      courseType: cfg.lesson.courseTypes[0],
      isMakeup: false,
      studentIds: []
    };
  }

  function ensureDraft() {
    if (!draft) draft = newDraft();
    return draft;
  }

  /* 顶部标签：排课 / 时段汇总 */
  var mainTab = 'plan';

  function tabBar() {
    return '<div class="segmented segmented--main">' +
      '<button class="seg' + (mainTab === 'plan' ? ' seg--on' : '') + '" data-maintab="plan">排课</button>' +
      '<button class="seg' + (mainTab === 'intake' ? ' seg--on' : '') + '" data-maintab="intake">时段汇总</button>' +
    '</div>';
  }

  function renderIntakeTab(root) {
    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>排课</h2>' +
          '<p class="muted">先看家长填报的汇总，再回来排课。</p>' +
        '</div>' +
        tabBar() +
        '<div id="intake-host"></div>' +
      '</div>';
    var host = root.querySelector('#intake-host');
    if (host && BC.pages.intake && BC.pages.intake.render) BC.pages.intake.render(host);
    root.querySelectorAll('[data-maintab]').forEach(function (b) {
      b.addEventListener('click', function () {
        mainTab = b.getAttribute('data-maintab');
        render(root);
      });
    });
  }

  // 从 fromISO 开始（含当天）找到下一个星期几 wd
  function nextWeekday(fromISO, wd) {
    var d = fromISO;
    for (var i = 0; i < 8; i++) {
      if (util.weekday(d) === wd) return d;
      d = util.addDays(d, 1);
    }
    return d;
  }

  /* ============================================================
   * 渲染
   * ============================================================ */
  function render(root) {
    // 本页顶部有「排课 / 时段汇总」两个标签，汇总直接复用时段汇总页面
    if (mainTab === 'intake') { renderIntakeTab(root); return; }
    var cfg = BC.config.load();
    var D = ensureDraft();

    var slots = BC.rules.getDaySlots(D.date);
    // 日期换了以后，原来选的档位可能这天不开，自动落到第一个可用的
    if (D.slotId && !slots.some(function (s) { return s.id === D.slotId; })) {
      D.slotId = slots.length ? slots[0].id : null;
    }

    var conflicts = currentConflicts();
    var softWarn = BC.rules.lastSoftWarning;

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>排课</h2>' +
          '<p class="muted">' + (editingId ? '正在修改一节课' : '选时间 → 选场地 → 勾学员 → 保存') + '</p>' +
        '</div>' +
        tabBar() +
        renderSetup(D, slots) +
        renderAlerts(conflicts, softWarn) +
        '<div class="grid2">' +
          renderCandidates(D) +
          renderSummary(D, conflicts) +
        '</div>' +
        renderDayLessons(D.date) +
      '</div>';

    bindEvents(root);
  }

  /* ---------- 上半：日期 / 档位 / 场地 / 班级 ---------- */
  function renderSetup(D, slots) {
    var cfg = BC.config.load();
    var courts = cfg.schedule.courts;

    var slotBtns = slots.length ? slots.map(function (s) {
      return '<button class="pickbtn' + (D.slotId === s.id ? ' pickbtn--on' : '') + '" data-slot="' + s.id + '">' +
        '<b>' + esc(s.label) + '</b><i>' + s.start + '–' + s.end + '</i></button>';
    }).join('') : '<span class="muted">这天没有可排时段（周内一般只开晚间，可在设置里改）</span>';

    var courtBtns = courts.map(function (c) {
      var taken = isCourtTaken(D.date, D.slotId, c.id);
      return '<button class="pickbtn' + (D.courtId === c.id ? ' pickbtn--on' : '') +
        (taken ? ' pickbtn--taken' : '') + '" data-court="' + c.id + '">' +
        '<b>' + esc(c.name) + '</b><i>' + (taken ? '已占用' : '空闲') + '</i></button>';
    }).join('');

    var typeSel = '<select class="input input--md" id="sel-type">' +
      cfg.lesson.courseTypes.map(function (t) {
        return '<option value="' + esc(t) + '"' + (D.courseType === t ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('') + '</select>';

    return '<section class="card">' +
      '<h3 class="card__title">① 什么时候、在哪上</h3>' +
      '<div class="fieldline">' +
        '<span class="fieldline__label">日期</span>' +
        '<button class="btn btn--ghost btn--sm" data-act="dprev">‹</button>' +
        '<input type="date" class="input input--date" id="sel-date" value="' + D.date + '">' +
        '<button class="btn btn--ghost btn--sm" data-act="dnext">›</button>' +
        '<span class="daylabel">' + esc(util.formatDateCN(D.date)) + '</span>' +
        '<button class="btn btn--ghost btn--sm" data-act="dtoday">今天</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="dsat">下一个周六</button>' +
        '<button class="btn btn--ghost btn--sm" data-act="dsun">下一个周日</button>' +
      '</div>' +
      '<div class="fieldline"><span class="fieldline__label">时段</span><div class="pickrow">' + slotBtns + '</div></div>' +
      '<div class="fieldline"><span class="fieldline__label">场地</span><div class="pickrow">' + courtBtns + '</div></div>' +
      '<div class="fieldline">' +
        '<span class="fieldline__label">班级</span>' + typeSel +
        '<label class="checkline"><input type="checkbox" id="chk-makeup"' + (D.isMakeup ? ' checked' : '') + '>这节是补课</label>' +
        (editingId ? '<button class="btn btn--ghost btn--sm" data-act="canceledit">取消修改</button>' : '') +
      '</div>' +
    '</section>';
  }

  /* ---------- 冲突 / 提醒 ---------- */
  function renderAlerts(conflicts, softWarn) {
    var html = '';
    if (conflicts.length) {
      html += '<div class="alertbox alertbox--danger">' +
        '<div class="alertbox__title">排不了，有 ' + conflicts.length + ' 处冲突</div>' +
        '<ul class="alertbox__list">' + conflicts.map(function (c) {
          return '<li>' + esc(c.message) + '</li>';
        }).join('') + '</ul>' +
      '</div>';
    }
    if (softWarn) {
      html += '<div class="alertbox alertbox--warn">' +
        '<div class="alertbox__title">提醒（不拦你，可以照常保存）</div>' +
        '<div class="alertbox__body">' + esc(softWarn) + '</div>' +
      '</div>';
    }
    return html;
  }

  /* ---------- 左下：学员候选 ---------- */
  function renderCandidates(D) {
    var cfg = BC.config.load();
    var all = BC.store.students.all().filter(function (s) { return s.status === '在读'; });

    // 谁填报了这一格
    var intakeKey = D.slotId ? BC.rules.slotKey(D.date, D.slotId) : null;
    var filledIds = [];
    if (intakeKey) {
      BC.store.intake.all().forEach(function (rec) {
        if ((rec.slots || []).indexOf(intakeKey) >= 0) filledIds.push(rec.studentId);
      });
    }

    var rows = all.map(function (s) {
      var filled = filledIds.indexOf(s.id) >= 0;
      var zero = Number(s.remainingLessons) <= 0;
      var todayCount = BC.rules.countLessonsOfDay(s.id, D.date, editingId);
      var sel = D.studentIds.indexOf(s.id) >= 0;

      // 单独测这一个学员有没有冲突（把他从已选里排除，避免自己跟自己比）
      var others = D.studentIds.filter(function (x) { return x !== s.id; });
      var c = BC.rules.checkStudentConflicts(D.date, D.slotId, [s.id], editingId);
      var conflictMsg = c.length ? c[0].message : '';

      return {
        stu: s, filled: filled, zero: zero, todayCount: todayCount,
        sel: sel, conflict: conflictMsg,
        expired: util.daysUntil(s.validUntil) < 0
      };
    });

    // 排序：已填报的排前面，其次按姓名
    rows.sort(function (a, b) {
      if (a.filled !== b.filled) return a.filled ? -1 : 1;
      return a.stu.name.localeCompare(b.stu.name, 'zh');
    });

    var kw = keyword.trim();
    var visible = rows.filter(function (r) {
      if (!showAllTypes && r.stu.courseType !== D.courseType && !r.sel) return false;
      if (kw) {
        var hit = (r.stu.name || '').indexOf(kw) >= 0 || (r.stu.parentName || '').indexOf(kw) >= 0;
        if (!hit) return false;
      }
      return true;
    });

    var listHtml = visible.length ? visible.map(function (r) {
      var tags = '';
      if (r.filled) tags += '<span class="tag tag--filled">已填报</span>';
      if (r.zero) tags += '<span class="tag tag--zero">课时 0</span>';
      if (r.expired) tags += '<span class="tag tag--zero">已过期</span>';
      if (r.todayCount > 0) tags += '<span class="tag">今天已排 ' + r.todayCount + ' 节</span>';

      return '<label class="cand' + (r.sel ? ' cand--on' : '') + '">' +
        '<input type="checkbox" data-stu="' + r.stu.id + '"' + (r.sel ? ' checked' : '') + '>' +
        '<span class="cand__box"></span>' +
        '<span class="cand__main">' +
          '<span class="cand__name">' + esc(r.stu.name) + '</span>' +
          '<span class="cand__meta">' + esc(r.stu.courseType) + ' · 剩 ' + esc(r.stu.remainingLessons) + ' 课时</span>' +
        '</span>' +
        '<span class="cand__tags">' + tags + '</span>' +
      '</label>';
    }).join('') : '<p class="muted hint">没有符合条件的学员。可以勾选下面的「显示其他班级」。</p>';

    return '<section class="card">' +
      '<h3 class="card__title">② 谁来上课' +
        '<label class="checkline checkline--right">' +
          '<input type="checkbox" id="chk-alltypes"' + (showAllTypes ? ' checked' : '') + '>显示其他班级</label>' +
      '</h3>' +
      '<input class="input input--search" id="cand-search" type="search" placeholder="搜学员姓名" value="' + esc(keyword) + '">' +
      '<div class="candlist">' + listHtml + '</div>' +
    '</section>';
  }

  /* ---------- 右下：已选摘要 + 保存 ---------- */
  function renderSummary(D, conflicts) {
    var cfg = BC.config.load();
    var names = D.studentIds.map(function (id) {
      var s = BC.store.students.find(id);
      return s ? s.name : '?';
    });
    var slot = D.slotId ? BC.rules.getSlot(D.slotId) : null;
    var court = (cfg.schedule.courts.filter(function (c) { return c.id === D.courtId; })[0] || {}).name || '—';

    return '<section class="card summary">' +
      '<h3 class="card__title">③ 确认并保存</h3>' +
      '<div class="summary__row"><span>时间</span><b>' +
        (slot ? esc(util.formatDateCN(D.date) + ' ' + slot.label + ' ' + slot.start + '–' + slot.end) : '未选时段') +
      '</b></div>' +
      '<div class="summary__row"><span>场地</span><b>' + esc(court) + '</b></div>' +
      '<div class="summary__row"><span>班级</span><b>' + esc(D.courseType) + (D.isMakeup ? '（补课）' : '') + '</b></div>' +
      '<div class="summary__row"><span>人数</span><b class="' +
        (D.studentIds.length > cfg.lesson.capacitySoftWarn ? 'txt-warn' : '') + '">' +
        D.studentIds.length + ' 人' + (D.studentIds.length > cfg.lesson.capacitySoftWarn ? '（偏多）' : '') + '</b></div>' +
      '<div class="summary__names">' + (names.length ? names.map(function (n) {
        return '<span class="namechip2">' + esc(n) + '</span>';
      }).join('') : '<span class="muted">还没选学员</span>') + '</div>' +
      '<button class="btn btn--primary btn--block btn--lg" id="btn-save"' +
        (conflicts.length || !D.slotId || !D.courtId || !D.studentIds.length ? ' disabled' : '') + '>' +
        (editingId ? '保存修改' : '保存这节课') + '</button>' +
      (conflicts.length ? '<p class="muted hint">先解决上面的冲突才能保存。</p>'
        : !D.studentIds.length ? '<p class="muted hint">至少选 1 名学员。</p>' : '') +
    '</section>';
  }

  /* ---------- 底部：这天已经排了哪些课 ---------- */
  function renderDayLessons(dateISO) {
    var cfg = BC.config.load();
    var list = BC.store.lessons.all().filter(function (l) {
      return l.date === dateISO && l.status !== '已取消';
    }).sort(function (a, b) { return String(a.slotId).localeCompare(String(b.slotId)); });

    if (!list.length) {
      return '<section class="card"><h3 class="card__title">' + esc(util.formatDateCN(dateISO)) + ' 的课</h3>' +
        '<p class="muted hint">这天还没排课。</p></section>';
    }

    var rows = list.map(function (l) {
      var slot = BC.rules.getSlot(l.slotId);
      var court = (cfg.schedule.courts.filter(function (c) { return c.id === l.courtId; })[0] || {}).name || '—';
      var names = (l.studentIds || []).map(function (id) {
        var s = BC.store.students.find(id);
        return s ? s.name : '?';
      }).join('、');
      return '<div class="tl' + (l.id === editingId ? ' tl--editing' : '') + '">' +
        '<div class="tl__time">' + esc(slot ? slot.label + '<i>' + slot.start + '</i>' : l.slotId) + '</div>' +
        '<div class="tl__main">' +
          '<div class="tl__title">' + esc(court) + ' · ' + esc(l.courseType) +
            (l.isMakeup ? ' <span class="tag">补课</span>' : '') + '</div>' +
          '<div class="tl__names">' + esc(names || '（未选学员）') + '</div>' +
        '</div>' +
        '<div class="tl__ops">' +
          '<button class="linkbtn" data-edit="' + l.id + '">修改</button>' +
          '<button class="linkbtn linkbtn--danger" data-del="' + l.id + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">' + esc(util.formatDateCN(dateISO)) + ' 已排 ' + list.length + ' 节课</h3>' +
      rows +
    '</section>';
  }

  /* ============================================================
   * 计算与事件
   * ============================================================ */
  function currentConflicts() {
    var D = ensureDraft();
    if (!D.slotId || !D.courtId) return [];
    return BC.rules.checkScheduleConflict({
      date: D.date,
      slotId: D.slotId,
      courtId: D.courtId,
      studentIds: D.studentIds,
      excludeLessonId: editingId
    });
  }

  function isCourtTaken(dateISO, slotId, courtId) {
    if (!slotId) return false;
    return BC.store.lessons.all().some(function (l) {
      return l.date === dateISO && l.slotId === slotId && l.courtId === courtId &&
        l.id !== editingId && l.status !== '已取消';
    });
  }

  function bindEvents(root) {
    var D = ensureDraft();

    /* ---- 顶部标签：排课 / 时段汇总 ---- */
    root.querySelectorAll('[data-maintab]').forEach(function (b) {
      b.addEventListener('click', function () {
        mainTab = b.getAttribute('data-maintab');
        render(root);
      });
    });

    /* ---- 日期 ---- */
    var dateInput = root.querySelector('#sel-date');
    if (dateInput) dateInput.addEventListener('change', function () {
      if (dateInput.value) { D.date = dateInput.value; render(root); }
    });

    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'dprev') D.date = util.addDays(D.date, -1);
        if (act === 'dnext') D.date = util.addDays(D.date, 1);
        if (act === 'dtoday') D.date = util.todayISO();
        if (act === 'dsat') D.date = nextWeekday(util.todayISO(), 6);
        if (act === 'dsun') D.date = nextWeekday(util.todayISO(), 0);
        if (act === 'canceledit') { editingId = null; draft = newDraft(); }
        render(root);
      });
    });

    /* ---- 档位 / 场地 ---- */
    root.querySelectorAll('[data-slot]').forEach(function (b) {
      b.addEventListener('click', function () { D.slotId = b.getAttribute('data-slot'); render(root); });
    });
    root.querySelectorAll('[data-court]').forEach(function (b) {
      b.addEventListener('click', function () { D.courtId = b.getAttribute('data-court'); render(root); });
    });

    /* ---- 班级 / 补课 ---- */
    var typeSel = root.querySelector('#sel-type');
    if (typeSel) typeSel.addEventListener('change', function () {
      D.courseType = typeSel.value;
      // 换了班级，把不属于这个班的学员从已选里去掉，免得混班（F1 不混班）
      D.studentIds = D.studentIds.filter(function (id) {
        var s = BC.store.students.find(id);
        return s && s.courseType === D.courseType;
      });
      render(root);
    });
    var mk = root.querySelector('#chk-makeup');
    if (mk) mk.addEventListener('change', function () { D.isMakeup = mk.checked; render(root); });

    var at = root.querySelector('#chk-alltypes');
    if (at) at.addEventListener('change', function () { showAllTypes = at.checked; render(root); });

    /* ---- 搜索 ---- */
    var search = root.querySelector('#cand-search');
    if (search) search.addEventListener('input', function () {
      keyword = search.value;
      var pos = search.selectionStart;
      render(root);
      var again = root.querySelector('#cand-search');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    });

    /* ---- 勾选学员 ---- */
    root.querySelectorAll('[data-stu]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-stu');
        var i = D.studentIds.indexOf(id);
        if (cb.checked && i < 0) D.studentIds.push(id);
        if (!cb.checked && i >= 0) D.studentIds.splice(i, 1);
        render(root);
      });
    });

    /* ---- 保存 ---- */
    var save = root.querySelector('#btn-save');
    if (save) save.addEventListener('click', function () {
      var conflicts = currentConflicts();
      if (conflicts.length) { ui.toast('还有冲突没解决', 'danger'); return; }
      if (!D.slotId || !D.courtId) { ui.toast('先选时段和场地', 'danger'); return; }
      if (!D.studentIds.length) { ui.toast('至少选 1 名学员', 'danger'); return; }

      var payload = {
        date: D.date, slotId: D.slotId, courtId: D.courtId,
        courseType: D.courseType, isMakeup: D.isMakeup,
        studentIds: D.studentIds.slice(),
        status: '待确认',
        attendance: {},
        // 补课的话，自动关联到每个学员"最近一次还没补过的准假"，
        // 这样点名时才知道那次扣没扣过课时，避免重复扣
        makeupForMap: D.isMakeup ? BC.rules.buildMakeupMap(D.studentIds) : {}
      };

      if (editingId) {
        BC.store.lessons.update(editingId, payload);
        ui.toast('已保存修改');
      } else {
        BC.store.lessons.add(payload);
        ui.toast('已排好 ' + util.formatDateCN(D.date) + ' 的一节课');
      }
      editingId = null;
      draft = newDraft();
      draft.date = payload.date;
      render(root);
    });

    /* ---- 编辑 / 删除 ---- */
    root.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var l = BC.store.lessons.find(b.getAttribute('data-edit'));
        if (!l) return;
        editingId = l.id;
        draft = {
          date: l.date, slotId: l.slotId, courtId: l.courtId,
          courseType: l.courseType, isMakeup: !!l.isMakeup,
          studentIds: (l.studentIds || []).slice()
        };
        render(root);
      });
    });
    root.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-del');
        var l = BC.store.lessons.find(id);
        if (!l) return;
        ui.confirm('删掉 ' + util.formatDateCN(l.date) + ' 这节课？删除后学员的课时不会变动。', function () {
          BC.store.lessons.remove(id);
          if (editingId === id) { editingId = null; draft = newDraft(); }
          ui.toast('已删除');
          render(root);
        });
      });
    });
  }

  BC.registerPage('schedule', { title: '排课', nav: true, order: 30, render: render });

})(window);
