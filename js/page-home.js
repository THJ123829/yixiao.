/* 今日总览（教练每天打开就看这个）：一屏看完今天有哪几节课、
 * 谁还没确认、谁的课时快没了、谁快到期了，以及待审批的请假申请。
 * 每条后面都有按钮，点一下生成通知话术，复制粘贴发微信。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  function render(root) {
    var cfg = BC.config.load();
    var today = util.todayISO();

    var allLessons = BC.store.lessons.all().filter(function (l) { return l.status !== '已取消'; });
    var todayLessons = allLessons.filter(function (l) { return l.date === today; })
      .sort(function (a, b) { return String(a.slotId).localeCompare(String(b.slotId)); });

    // 未来还没通知过的课
    var toNotify = allLessons.filter(function (l) {
      return l.date >= today && !l.notifiedAt;
    }).sort(function (a, b) {
      return a.date === b.date ? String(a.slotId).localeCompare(String(b.slotId)) : a.date.localeCompare(b.date);
    });

    // 课前提醒：开课前 N 小时内的课（N = 提醒提前，默认 20 小时≈一天）
    var remHours = cfg.reminder.classReminderHoursBefore || 20;
    var now = new Date();
    var windowEnd = new Date(now.getTime() + remHours * 3600 * 1000);
    var classReminders = allLessons.filter(function (l) {
      var st = BC.rules.lessonStartDateTime(l);
      return st && st > now && st <= windowEnd;
    }).sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.slotId).localeCompare(String(b.slotId));
    });

    // 还没确认的学员总数
    var unconfirmed = [];
    allLessons.filter(function (l) { return l.date >= today; }).forEach(function (l) {
      BC.rules.unconfirmedOf(l).forEach(function (p) {
        unconfirmed.push({ lesson: l, studentId: p.studentId, name: p.name });
      });
    });

    // 待我审批的请假 / 调课申请
    var pending = BC.rules.pendingRequests();

    var students = BC.store.students.all().filter(function (s) { return s.status === '在读'; });
    var lowBalance = students.filter(function (s) {
      return Number(s.remainingLessons) <= cfg.reminder.lowBalanceThreshold;
    });
    var expiring = students.filter(function (s) {
      var d = util.daysUntil(s.validUntil);
      if (d < 0) return true;
      return (cfg.reminder.expiryLeadDays || []).some(function (lead) { return d <= lead; });
    });

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>今日总览</h2>' +
          '<p class="muted">' + esc(util.formatDateCN(today)) + ' · 共 ' + students.length + ' 名在读学员</p>' +
        '</div>' +

        '<div class="stats">' +
          stat('green', '今日课程', todayLessons.length, '节') +
          stat('amber', '待确认', unconfirmed.length, '人') +
          stat('blue', '待我审批', pending.length, '条') +
          stat('red', '课时不足', lowBalance.length, '人') +
          stat('red', '即将到期', expiring.length, '人') +
        '</div>' +

        renderRequests(pending) +
        renderToday(todayLessons) +
        renderToNotify(toNotify) +
        renderClassReminders(classReminders) +
        renderTwoLists(lowBalance, expiring) +
      '</div>';

    bindEvents(root);
  }

  /* ---------- 数字卡 ---------- */
  function stat(color, label, num, unit, hint) {
    return '<div class="stat stat--' + color + '">' +
      '<div class="stat__num">' + num + '<i>' + esc(unit || '') + '</i></div>' +
      '<div class="stat__label">' + esc(label) + '</div>' +
      (hint ? '<div class="stat__hint">' + esc(hint) + '</div>' : '') +
    '</div>';
  }

  /* ---------- 待我审批：请假 / 调课申请 ---------- */
  function renderRequests(list) {
    if (!list.length) {
      return '<section class="card"><h3 class="card__title">待我审批</h3>' +
        '<p class="muted hint">家长在手机端提交请假或调课后，会出现在这里。</p></section>';
    }

    var rows = list.map(function (r) {
      var s = BC.store.students.find(r.studentId);
      var l = BC.store.lessons.find(r.lessonId);
      var slot = l ? BC.rules.getSlot(l.slotId) : null;

      var head = '<b>' + esc(s ? s.name : '?') + '</b>' +
        (r.type === 'reschedule' ? ' 申请调课' : ' 请假') +
        '　<span class="muted">' + esc(l ? util.formatDateCN(l.date) + ' ' + (slot ? slot.label : '') : '') + '</span>';
      var meta = '原因：' + esc(r.reason || '未填') +
        '　·　距开课 ' + esc(r.hoursBefore) + ' 小时' +
        (r.late ? '　<span class="tag tag--zero">临期</span>' : '　<span class="tag tag--filled">提前</span>');

      var wants = (r.wantSlotKeys || []).length
        ? '<div class="tl__names">希望改到：' + r.wantSlotKeys.map(function (k) {
            var p = BC.rules.parseSlotKey(k);
            return esc(util.formatDateCN(p.date) + ' ' + ((BC.rules.getSlot(p.slotId) || {}).label || ''));
          }).join('、') + '</div>'
        : '';

      return '<div class="tl">' +
        '<div class="tl__time">' + (r.late ? '扣' : '免') + '<i>' + (r.late ? '课时' : '扣') + '</i></div>' +
        '<div class="tl__main">' +
          '<div class="tl__title">' + head + '</div>' +
          '<div class="tl__names">' + meta + '</div>' + wants +
        '</div>' +
        '<div class="tl__ops">' +
          '<button class="btn btn--primary btn--sm" data-agree="' + r.id + '">同意</button>' +
          '<button class="btn btn--ghost btn--sm" data-reject="' + r.id + '">驳回</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">待我审批（' + list.length + ' 条）</h3>' + rows +
      '<p class="muted hint">同意后，请假的学员会在点名时按规则自动判断扣不扣课时；调课的学员会从那节课挪走，不扣课时。</p>' +
    '</section>';
  }

  /* ---------- 今日课程 ---------- */
  function renderToday(list) {
    var cfg = BC.config.load();
    var rows = list.length ? list.map(function (l) {
      var slot = BC.rules.getSlot(l.slotId);
      var court = (cfg.schedule.courts.filter(function (c) { return c.id === l.courtId; })[0] || {}).name || '—';
      var names = (l.studentIds || []).map(function (id) {
        var s = BC.store.students.find(id);
        return s ? s.name : '?';
      }).join('、');
      var pend = BC.rules.unconfirmedOf(l).length;

      return '<div class="tl">' +
        '<div class="tl__time">' + esc(slot ? slot.label : l.slotId) +
          '<i>' + esc(slot ? slot.start + '–' + slot.end : '') + '</i></div>' +
        '<div class="tl__main">' +
          '<div class="tl__title">' + esc(court) + ' · ' + esc(l.courseType) +
            (l.isMakeup ? ' <span class="tag">补课</span>' : '') + '</div>' +
          '<div class="tl__names">' + esc(names || '（未选学员）') + '</div>' +
        '</div>' +
        '<div class="tl__ops">' +
          (pend ? '<span class="tag tag--zero">' + pend + ' 人待确认</span>' : '') +
          '<button class="btn btn--ghost btn--sm" data-notify="' + l.id + '">通知家长</button>' +
          '<button class="btn btn--primary btn--sm" data-attend="' + l.id + '">点名</button>' +
        '</div>' +
      '</div>';
    }).join('') : '<p class="muted hint">今天没有课。</p>';

    return '<section class="card">' +
      '<h3 class="card__title">今日课程</h3>' + rows +
      '<p class="muted hint">上完课点「点名」，标记谁来了谁没来 —— 课时就是在这时候扣的。</p>' +
    '</section>';
  }

  /* ============================================================
   * 点名弹窗（Q4 落地：确认出勤后才扣课时）
   * ============================================================ */
  function openAttendance(root, lessonId) {
    var lesson = BC.store.lessons.find(lessonId);
    if (!lesson) return;

    var ctx = BC.rules.buildAttendanceContext(lesson);
    var students = (lesson.studentIds || []).map(function (sid) {
      var s = BC.store.students.find(sid);
      return { id: sid, name: s ? s.name : '?', left: s ? s.remainingLessons : 0, c: ctx[sid] || {} };
    });

    function bodyHtml() {
      return '<p class="modal-text">' + esc(util.formatDateCN(lesson.date)) + '　标记谁来了、谁没来。</p>' +
        '<div class="attlist">' + students.map(function (st) {
          var cur = st.c.status === 'leave' ? 'leave' : (st.c.status === 'unmarked' ? 'attended' : st.c.status);
          var hintTxt = st.c.leaveApproved
            ? (st.c.leaveHoursBefore >= BC.config.get('leave.freeCancelHours')
                ? '已准假（提前请假，不扣）'
                : '已准假（临期，' + (st.c.monthQuotaUsed < BC.config.get('leave.monthlyFreeLateQuota') ? '可免扣' : '要扣 1 节') + '）')
            : '';
          return '<div class="attrow">' +
            '<div class="attrow__name">' + esc(st.name) +
              '<i>剩 ' + esc(st.left) + ' 节' + (hintTxt ? ' · ' + esc(hintTxt) : '') + '</i></div>' +
            '<div class="attrow__opts">' +
              opt(st.id, 'attended', '来了', cur) +
              opt(st.id, 'absent', '没来', cur) +
              opt(st.id, 'leave', '请假', cur) +
            '</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<div id="att-preview" class="notice notice--info"></div>';
    }

    function opt(sid, val, label, cur) {
      return '<label class="opt' + (cur === val ? ' opt--on' : '') + '">' +
        '<input type="radio" name="att_' + sid + '" value="' + val + '"' + (cur === val ? ' checked' : '') + '>' +
        '<span>' + label + '</span></label>';
    }

    ui.modal({
      title: '点名 · ' + esc(util.formatDateCN(lesson.date)),
      body: bodyHtml(),
      buttons: [
        { label: '取消', kind: 'ghost', onClick: function () { ui.closeModal(); } },
        {
          label: '保存并扣课时', kind: 'primary', onClick: function () {
            var marks = {};
            students.forEach(function (st) {
              var el = document.querySelector('input[name="att_' + st.id + '"]:checked');
              marks[st.id] = el ? el.value : 'attended';
            });
            var result = BC.rules.saveAttendance(lessonId, marks);
            ui.closeModal();
            if (result) {
              var deducted = result.items.filter(function (i) { return i.deducted; });
              ui.toast('已点名，' + deducted.length + ' 人各扣 1 课时');
            }
            render(root);
          }
        }
      ]
    });

    // 选中某项时高亮
    var mask = document.getElementById('modal-mask');
    if (mask) {
      mask.querySelectorAll('input[type="radio"]').forEach(function (r) {
        r.addEventListener('change', function () {
          mask.querySelectorAll('.opt').forEach(function (o) { o.classList.remove('opt--on'); });
          mask.querySelectorAll('input[type="radio"]:checked').forEach(function (c) {
            var lab = c.closest('.opt');
            if (lab) lab.classList.add('opt--on');
          });
        });
      });
    }
  }

  /* ---------- 待通知 ---------- */
  function renderToNotify(list) {
    if (!list.length) {
      return '<section class="card"><h3 class="card__title">待通知</h3>' +
        '<p class="muted hint">没有需要通知的课。排好课后会自动出现在这里。</p></section>';
    }
    var cfg = BC.config.load();
    var rows = list.map(function (l) {
      var slot = BC.rules.getSlot(l.slotId);
      var court = (cfg.schedule.courts.filter(function (c) { return c.id === l.courtId; })[0] || {}).name || '—';
      return '<div class="tl">' +
        '<div class="tl__time">' + esc(util.formatDateCN(l.date)) +
          '<i>' + esc(slot ? slot.label + ' ' + slot.start : '') + '</i></div>' +
        '<div class="tl__main">' +
          '<div class="tl__title">' + esc(court) + ' · ' + esc(l.courseType) + '</div>' +
          '<div class="tl__names">' + (l.studentIds || []).length + ' 名学员</div>' +
        '</div>' +
        '<div class="tl__ops">' +
          '<button class="btn btn--primary btn--sm" data-notify="' + l.id + '">生成通知话术</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">待通知（' + list.length + ' 节课）</h3>' + rows +
      '<p class="muted hint">点一下生成话术，复制后粘到微信发给家长。家长点链接确认后，这里的「待确认」会减少。</p>' +
    '</section>';
  }

  /* ---------- 课前提醒（开课前一天给家长发个提醒） ---------- */
  function renderClassReminders(list) {
    if (!list.length) {
      return '<section class="card"><h3 class="card__title">课前提醒</h3>' +
        '<p class="muted hint">开课前 ' + BC.config.get('reminder.classReminderHoursBefore') +
        ' 小时内没有要上的课，不用发提醒。</p></section>';
    }
    var cfg = BC.config.load();
    var rows = list.map(function (l) {
      var slot = BC.rules.getSlot(l.slotId);
      var court = (cfg.schedule.courts.filter(function (c) { return c.id === l.courtId; })[0] || {}).name || '—';
      var reminded = !!l.classRemindedAt;
      return '<div class="tl">' +
        '<div class="tl__time">' + esc(util.formatDateCN(l.date)) +
          '<i>' + esc(slot ? slot.label + ' ' + slot.start : '') + '</i></div>' +
        '<div class="tl__main">' +
          '<div class="tl__title">' + esc(court) + ' · ' + esc(l.courseType) +
            (reminded ? ' <span class="tag tag--filled">已提醒</span>' : '') + '</div>' +
          '<div class="tl__names">' + (l.studentIds || []).length + ' 名学员</div>' +
        '</div>' +
        '<div class="tl__ops">' +
          '<button class="btn btn--primary btn--sm" data-class-remind="' + l.id + '">' +
            (reminded ? '重新发送' : '生成上课提醒话术') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<section class="card">' +
      '<h3 class="card__title">课前提醒（' + list.length + ' 节待提醒）</h3>' + rows +
      '<p class="muted hint">点一下给这几节课的家长各生成一段提醒话术，复制后粘到微信发过去。' +
        '家长看完就知道明天几点、在哪个场地上课。</p>' +
    '</section>';
  }

  /* ---------- 课时不足 / 即将到期 ---------- */
  function renderTwoLists(lowBalance, expiring) {
    function people(list, kind) {
      if (!list.length) return '<p class="muted hint">没有。</p>';
      return list.map(function (s) {
        var d = util.daysUntil(s.validUntil);
        return '<div class="tl">' +
          '<div class="tl__time">' + esc(s.remainingLessons) + '<i>课时</i></div>' +
          '<div class="tl__main">' +
            '<div class="tl__title">' + esc(s.name) + ' · ' + esc(s.courseType) + '</div>' +
            '<div class="tl__names">有效期至 ' + esc(s.validUntil) +
              (d < 0 ? '（已过期 ' + Math.abs(d) + ' 天）' : '（还剩 ' + d + ' 天）') + '</div>' +
          '</div>' +
          '<div class="tl__ops">' +
            '<button class="btn btn--ghost btn--sm" data-msg="' + kind + '" data-stu="' + s.id + '">生成话术</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    return '<div class="grid2b">' +
      '<section class="card"><h3 class="card__title">课时不足（' + lowBalance.length + ' 人）</h3>' +
        people(lowBalance, 'low') + '</section>' +
      '<section class="card"><h3 class="card__title">即将到期（' + expiring.length + ' 人）</h3>' +
        people(expiring, 'exp') + '</section>' +
    '</div>';
  }

  /* ---------- 事件 ---------- */
  function bindEvents(root) {

    /* ---- 审批请假 / 调课 ---- */
    root.querySelectorAll('[data-agree]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = BC.rules.decideRequest(b.getAttribute('data-agree'), true);
        var s = r ? BC.store.students.find(r.studentId) : null;
        ui.toast('已同意' + (s ? '（' + s.name + '）' : ''));
        render(root);
      });
    });
    root.querySelectorAll('[data-reject]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = BC.rules.decideRequest(b.getAttribute('data-reject'), false);
        var s = r ? BC.store.students.find(r.studentId) : null;
        ui.toast('已驳回' + (s ? '（' + s.name + '）' : ''), 'warn');
        render(root);
      });
    });

    /* ---- 点名 ---- */
    root.querySelectorAll('[data-attend]').forEach(function (b) {
      b.addEventListener('click', function () {
        openAttendance(root, b.getAttribute('data-attend'));
      });
    });

    // 通知一节课的所有家长（链接能短就短：云端读得到就发短链）
    root.querySelectorAll('[data-notify]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-notify');
        var l = BC.store.lessons.find(id);
        if (!l) return;
        BC.cloud.selfCheck(function (err, checked) {
          var lines = BC.notify.lessonTexts(l).map(function (x) {
            // 家长链接放在话术末尾，家长点开就能确认
            var s = BC.store.students.find(x.studentId);
            var link = s ? BC.store.parentLinkFor(checked, s) : '';
            return { name: x.name, text: x.text + (link ? '\n' + link : '') };
          });
          BC.notify.show('排课通知', lines, function () {
            BC.store.lessons.update(id, { notifiedAt: new Date().toISOString() });
          });
          render(root);
        });
      });
    });

    // 课前提醒：给一节课的家长各生成一段提醒话术（链接能短就短）
    root.querySelectorAll('[data-class-remind]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-class-remind');
        var l = BC.store.lessons.find(id);
        if (!l) return;
        BC.cloud.selfCheck(function (err, checked) {
          var lines = (l.studentIds || []).map(function (sid) {
            var s = BC.store.students.find(sid);
            if (!s) return null;
            return { name: s.name, text: BC.notify.classReminderText(l, s) + '\n' + BC.store.parentLinkFor(checked, s) };
          }).filter(function (x) { return !!x; });
          BC.notify.show('上课提醒', lines, function () {
            BC.store.lessons.update(id, { classRemindedAt: new Date().toISOString() });
          });
          render(root);
        });
      });
    });

    // 单个学员的催办话术（链接能短就短）
    root.querySelectorAll('[data-msg]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-stu');
        var kind = b.getAttribute('data-msg');
        var s = BC.store.students.find(id);
        if (!s) return;
        BC.cloud.selfCheck(function (err, checked) {
          var text = (kind === 'low') ? BC.notify.lowBalanceText(s) : BC.notify.expiringText(s);
          var link = BC.store.parentLinkFor(checked, s);
          BC.notify.show(kind === 'low' ? '课时不足提醒' : '即将到期提醒',
            [{ name: s.name, text: text + (link ? '\n' + link : '') }]);
        });
      });
    });
  }

  BC.registerPage('home', { title: '今日总览', nav: true, order: 10, render: render });

})(window);
