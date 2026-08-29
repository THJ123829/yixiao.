/* 课程日历：横轴场地、纵轴时段的排片表，外加月视图概览。
 * 数据来源：config.schedule.courts + rules.getDaySlots，配置驱动。
 * 这里只查看；新增或调整排课请到「排课工作台」。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  var view = 'grid';
  var anchorDate = util.todayISO();
  var monthAnchor = util.todayISO();

  function render(root) {
    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>课程日历</h2>' +
          '<div class="segmented">' +
            '<button class="seg' + (view === 'grid' ? ' seg--on' : '') + '" data-view="grid">排片表</button>' +
            '<button class="seg' + (view === 'month' ? ' seg--on' : '') + '" data-view="month">月视图</button>' +
          '</div>' +
        '</div>' +
        (view === 'grid' ? renderGrid() : renderMonth()) +
      '</div>';
    bindEvents(root);
  }

  /* ---------- 排片表：横轴场地、纵轴时段 ---------- */
  function renderGrid() {
    var cfg = BC.config.load();
    var courts = cfg.schedule.courts;
    var slots = BC.rules.getDaySlots(anchorDate);
    var blackout = BC.rules.isBlackout(anchorDate);

    var navHtml =
      '<div class="daynav">' +
        '<button class="btn btn--ghost" data-act="prev">‹ 前一天</button>' +
        '<input type="date" class="input input--date" id="cal-date" value="' + anchorDate + '">' +
        '<button class="btn btn--ghost" data-act="next">后一天 ›</button>' +
        '<button class="btn btn--ghost" data-act="today">回到今天</button>' +
        '<span class="daynav__label">' + esc(util.formatDateCN(anchorDate)) + '</span>' +
      '</div>';

    if (blackout) {
      return navHtml + ui.empty(util.formatDateCN(anchorDate) + ' 停课', '原因：' + blackout);
    }
    if (!slots.length) {
      return navHtml + ui.empty(
        util.formatDateCN(anchorDate) + ' 不排课',
        '周内一般只开晚间；周末四个时段都开。可以在「设置 → 上课时段」里调整。'
      );
    }

    var lessons = BC.store.lessons.all().filter(function (l) {
      return l.date === anchorDate && l.status !== '已取消';
    });

    var head = '<tr><th class="th-time">时段</th>' +
      courts.map(function (c) { return '<th>' + esc(c.name) + '</th>'; }).join('') + '</tr>';

    var body = slots.map(function (slot) {
      var tds = courts.map(function (c) {
        var hit = lessons.filter(function (l) {
          return l.courtId === c.id && l.slotId === slot.id;
        });
        if (!hit.length) return '<td class="cell-free"></td>';
        return '<td class="cell-busy">' + hit.map(function (l) {
          var names = (l.studentIds || []).map(function (sid) {
            var s = BC.store.students.find(sid);
            return s ? s.name : '?';
          }).join('、');
          var over = (l.studentIds || []).length > cfg.lesson.capacitySoftWarn;
          return '<div class="lesson">' +
            '<div class="lesson__type">' + esc(l.courseType || '') +
              (l.isMakeup ? ' <span class="tag">补课</span>' : '') + '</div>' +
            '<div class="lesson__names">' + esc(names || '（未选学员）') + '</div>' +
            '<div class="lesson__meta' + (over ? ' lesson__meta--warn' : '') + '">' +
              (l.studentIds || []).length + ' 人 · ' + esc(l.status || '待确认') + '</div>' +
          '</div>';
        }).join('') + '</td>';
      }).join('');

      return '<tr><th class="th-time">' +
        '<span class="th-time__label">' + esc(slot.label) + '</span>' +
        '<span class="th-time__range">' + slot.start + '–' + slot.end + '</span>' +
      '</th>' + tds + '</tr>';
    }).join('');

    return navHtml +
      '<div class="table-wrap"><table class="table table--grid"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="muted hint">这里只用来查看。要新增或调整排课，请到「排课工作台」。</p>';
  }

  /* ---------- 月视图 ---------- */
  function renderMonth() {
    var first = util.parseISO(monthAnchor);
    first.setDate(1);
    var year = first.getFullYear(), mon = first.getMonth();
    var daysInMonth = new Date(year, mon + 1, 0).getDate();
    var firstWeekday = first.getDay();
    var lead = (firstWeekday === 0) ? 6 : firstWeekday - 1;

    var lessons = BC.store.lessons.all();
    var cells = [];
    for (var i = 0; i < lead; i++) cells.push('<td class="cell-out"></td>');
    for (var d = 1; d <= daysInMonth; d++) {
      var iso = util.toISO(new Date(year, mon, d));
      var n = lessons.filter(function (l) { return l.date === iso && l.status !== '已取消'; }).length;
      var isToday = (iso === util.todayISO());
      cells.push('<td class="daycell' + (isToday ? ' daycell--today' : '') + '" data-jump="' + iso + '">' +
        '<div class="daycell__num">' + d + '</div>' +
        (n ? '<div class="daycell__dot">' + n + ' 节课</div>' : '') +
      '</td>');
    }
    while (cells.length % 7 !== 0) cells.push('<td class="cell-out"></td>');

    var rows = [];
    for (var r = 0; r < cells.length; r += 7) rows.push('<tr>' + cells.slice(r, r + 7).join('') + '</tr>');

    var navHtml =
      '<div class="daynav">' +
        '<button class="btn btn--ghost" data-act="mprev">‹ 上个月</button>' +
        '<span class="daynav__label">' + year + ' 年 ' + (mon + 1) + ' 月</span>' +
        '<button class="btn btn--ghost" data-act="mnext">下个月 ›</button>' +
        '<button class="btn btn--ghost" data-act="mtoday">回到本月</button>' +
      '</div>';

    return navHtml +
      '<div class="table-wrap"><table class="table table--month">' +
        '<thead><tr><th>一</th><th>二</th><th>三</th><th>四</th><th>五</th><th>六</th><th>日</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody></table></div>' +
      '<p class="muted hint">点某一天可以跳到那天的排片表。</p>';
  }

  function bindEvents(root) {
    root.querySelectorAll('.seg').forEach(function (b) {
      b.addEventListener('click', function () { view = b.getAttribute('data-view'); render(root); });
    });

    var dateInput = root.querySelector('#cal-date');
    if (dateInput) dateInput.addEventListener('change', function () {
      if (dateInput.value) { anchorDate = dateInput.value; render(root); }
    });

    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'prev') anchorDate = util.addDays(anchorDate, -1);
        if (act === 'next') anchorDate = util.addDays(anchorDate, 1);
        if (act === 'today') anchorDate = util.todayISO();
        if (act === 'mprev') monthAnchor = util.addMonths(monthAnchor, -1);
        if (act === 'mnext') monthAnchor = util.addMonths(monthAnchor, 1);
        if (act === 'mtoday') monthAnchor = util.todayISO();
        render(root);
      });
    });

    root.querySelectorAll('[data-jump]').forEach(function (td) {
      td.addEventListener('click', function () {
        anchorDate = td.getAttribute('data-jump');
        monthAnchor = anchorDate;
        view = 'grid';
        render(root);
      });
    });
  }

  BC.registerPage('calendar', { title: '课程日历', nav: true, order: 40, render: render });

})(window);
