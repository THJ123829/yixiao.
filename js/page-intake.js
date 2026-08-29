/* 时段汇总（教练看家长填报的结果）：回答"下周哪个时段人最多"。
 * 横轴周一到周日，纵轴四个时段，格子里是勾了该时段的学员人数，
 * 点格子展开看是谁；底下列出还没填的人，方便催。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  var weekOffset = 0;
  var filterType = '';
  var openKey = null;      // 当前展开的格子

  function render(root) {
    var cfg = BC.config.load();
    var weekMonday = util.addDays(BC.rules.targetWeekMonday(), weekOffset * 7);
    var intakes = BC.store.intake ? BC.store.intakesOfWeek(weekMonday) : [];
    var students = BC.store.students.all();
    var active = students.filter(function (s) { return s.status === '在读'; });
    var types = cfg.lesson.courseTypes.slice();

    // 按课程类型筛选
    if (filterType) active = active.filter(function (s) { return s.courseType === filterType; });

    var slots = cfg.schedule.timeSlots.filter(function (s) { return s.enabled; });
    var days = [];
    for (var i = 0; i < 7; i++) days.push(util.addDays(weekMonday, i));

    // 统计每个格子有哪些人
    var byKey = {};
    intakes.forEach(function (rec) {
      var stu = students.filter(function (s) { return s.id === rec.studentId; })[0];
      if (!stu) return;
      if (filterType && stu.courseType !== filterType) return;
      if (active.map(function (s) { return s.id; }).indexOf(rec.studentId) < 0) return;
      (rec.slots || []).forEach(function (k) {
        (byKey[k] = byKey[k] || []).push(stu);
      });
    });

    var maxCount = 1;
    Object.keys(byKey).forEach(function (k) { maxCount = Math.max(maxCount, byKey[k].length); });

    var head = '<tr><th class="th-time">时段</th>' +
      days.map(function (d) {
        return '<th class="th-day">' + util.weekdayCN(d) +
          '<span class="th-day__date">' + (util.parseISO(d).getMonth() + 1) + '/' + util.parseISO(d).getDate() + '</span></th>';
      }).join('') + '</tr>';

    var body = slots.map(function (s) {
      var tds = days.map(function (d) {
        if (s.weekdays.indexOf(util.weekday(d)) < 0) return '<td class="cell-out">—</td>';
        if (BC.rules.isBlackout(d)) return '<td class="cell-out">停课</td>';

        var key = BC.rules.slotKey(d, s.id);
        var list = byKey[key] || [];
        var heat = list.length ? Math.min(4, Math.ceil(list.length / maxCount * 4)) : 0;
        var isOpen = openKey === key;

        return '<td class="cell-heat cell-heat--h' + heat + (isOpen ? ' cell-heat--open' : '') +
          '" data-key="' + key + '">' +
          '<div class="heat__num">' + (list.length || '') + '</div>' +
          (isOpen && list.length
            ? '<div class="heat__list">' + list.map(function (st) {
                return '<span class="heat__name">' + esc(st.name) +
                  '<i class="heat__type">' + esc(st.courseType) + '</i></span>';
              }).join('') + '</div>'
            : '') +
        '</td>';
      }).join('');

      return '<tr><th class="th-time">' +
        '<span class="th-time__label">' + esc(s.label) + '</span>' +
        '<span class="th-time__range">' + s.start + '–' + s.end + '</span>' +
      '</th>' + tds + '</tr>';
    }).join('');

    // 谁还没填
    var filled = {};
    intakes.forEach(function (r) { filled[r.studentId] = true; });
    var missing = active.filter(function (s) { return !filled[s.id]; });

    var filterHtml = '<select class="input input--md" id="filter-type">' +
      '<option value="">全部课程类型</option>' +
      types.map(function (t) {
        return '<option value="' + esc(t) + '"' + (filterType === t ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('') + '</select>';

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>时段汇总</h2>' +
          '<p class="muted">家长勾选的结果。点格子看是哪些人。</p>' +
        '</div>' +
        '<div class="toolbar">' +
          '<div class="weeknav">' +
            '<button class="btn btn--ghost btn--sm" data-act="wprev">‹</button>' +
            '<span class="weeknav__title">' + util.formatDateCN(weekMonday) + ' 那一周</span>' +
            '<button class="btn btn--ghost btn--sm" data-act="wnext">›</button>' +
            (weekOffset !== 0 ? '<button class="btn btn--ghost btn--sm" data-act="wnow">回到本周</button>' : '') +
          '</div>' +
          '<div class="toolbar__right">' + filterHtml + '</div>' +
        '</div>' +
        '<div class="table-wrap"><table class="table table--heat"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        '<section class="card" style="margin-top:14px">' +
          '<h3 class="card__title">还没填报的学员（' + missing.length + ' 人）</h3>' +
          (missing.length
            ? '<div class="namelist">' + missing.map(function (s) {
                return '<span class="namechip">' + esc(s.name) +
                  '<a class="namechip__link" data-copy="' + s.id + '">复制链接</a></span>';
              }).join('') + '</div>'
            : '<p class="muted hint">都填了，很好。</p>') +
        '</section>' +
      '</div>';

    bindEvents(root, weekMonday);
  }

  function bindEvents(root, weekMonday) {
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'wprev') weekOffset--;
        if (act === 'wnext') weekOffset++;
        if (act === 'wnow') weekOffset = 0;
        openKey = null;
        render(root);
      });
    });

    var ft = root.querySelector('#filter-type');
    if (ft) ft.addEventListener('change', function () {
      filterType = ft.value;
      openKey = null;
      render(root);
    });

    root.querySelectorAll('.cell-heat').forEach(function (td) {
      td.addEventListener('click', function () {
        var key = td.getAttribute('data-key');
        openKey = (openKey === key) ? null : key;
        render(root);
      });
    });

    root.querySelectorAll('[data-copy]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = a.getAttribute('data-copy');
        var s = BC.store.students.find(id);
        if (!s) return;
        var link = BC.store.parentLink(s);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(
            function () { ui.toast('「' + s.name + '」的家长链接已复制'); },
            function () { showLink(link, s.name); }
          );
        } else showLink(link, s.name);
      });
    });
  }

  function showLink(link, name) {
    ui.modal({
      title: '家长链接 · ' + esc(name),
      body: '<p class="modal-text">复制这串网址发给家长：</p><textarea class="input" rows="3">' + esc(link) + '</textarea>',
      buttons: [{ label: '知道了', kind: 'primary', onClick: function () { ui.closeModal(); } }]
    });
  }

  // 不单独占底部导航：作为「排课」页里的一个标签页打开
  BC.registerPage('intake', { title: '时段汇总', nav: false, order: 25, render: render });

})(window);
