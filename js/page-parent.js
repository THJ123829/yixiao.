/* 家长端：家长点开专属链接看到的东西，不用注册也不用密码。
 * 显示孩子的剩余课时、有效期、课表，可填报下周能来上课的时间、
 * 确认参加、申请请假或调课。
 * 路由 #/parent/<口令>（由 app.js 分发，不进教练端密码门）。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  var tab = 'fill';                 // 'fill' = 填报时段，'schedule' = 我的课表
  var weekOffset = 0;               // 相对"目标周"再偏移几周，方便你前后翻看
  var curQ = '';                    // 当前链接附带的 '?d=...' 数据（v1 嵌入方案用）
  var embeddedLessons = null;       // 家长手机无本地数据时的"课表快照"
  var snapCache = {};               // 同一链接多次渲染时，复用已解出的快照（含家长本地改动）
  // 家长手机没有教练改过的配置，时段/场地要靠链接或云端带过来，否则会显示成默认时间
  var parentSlots = null;
  var parentCourts = null;

  /* ---------- 羽毛球头像（用姓名最后一个字当头像） ---------- */
  function avatar(name) {
    var ch = String(name || '球').slice(-1);
    return '<span class="ava">' + esc(ch) + '</span>';
  }

  /* ---------- 打不开时的提示 ---------- */
  function renderInvalid(root) {
    root.innerHTML = '<div class="parent">' +
      '<div class="card parent__card">' +
        '<div class="parent__sorry">' +
          '<h3>链接无效</h3>' +
          '<p class="muted">这个链接打不开了，麻烦跟教练要一个新的。</p>' +
        '</div>' +
      '</div></div>';
  }

  // 云端报错（连不上 / 配置错 / 数据没传上去）和家长口令错要区分开，方便排查
  function renderCloudError(root, msg) {
    root.innerHTML = '<div class="parent">' +
      '<div class="card parent__card">' +
        '<div class="parent__sorry">' +
          '<h3>暂时打不开</h3>' +
          '<p class="muted">孩子的课表没能从云端取到。可能是教练端还没把数据上传到云端，' +
          '或网络暂时不通。麻烦稍后重试，或让教练重新发一下链接。</p>' +
          (msg ? '<p class="muted" style="margin-top:8px;opacity:.7">技术信息：' + BC.util.escapeHtml(msg) + '</p>' : '') +
        '</div>' +
      '</div></div>';
  }

  /* ---------- 页面入口 ---------- */
  function renderParent(root, token, q) {
    curQ = q || '';
    var student = BC.store.students.all().filter(function (s) { return s.token === token; })[0];

    // v1 没有云数据库：家长用自己手机打开时本机没有数据，
    // 尝试从链接里打包好的「快照」解出孩子和课表。
    embeddedLessons = null;
    if (!student) {
      if (snapCache[token]) {
        student = snapCache[token].s;
        embeddedLessons = snapCache[token].l;
      } else if (curQ) {
        var m = String(curQ).match(/d=([^&]+)/);
        if (m) {
          try {
            var raw = m[1], p = null;
            if (raw.indexOf('c1') === 0) {
              // 新格式：短字段名 + URL 安全 base64，链接短很多
              p = expandSnapshot(decodeUrlB64(raw.slice(2)), token);
            } else {
              // 老格式（早期已经发给家长的链接），保持兼容，别让人家打不开
              p = JSON.parse(decodeURIComponent(raw));
              if (!p || !p.s || p.s.token !== token) p = null;
            }
            if (p && p.s) {
              student = p.s;
              embeddedLessons = overlayLocal(p.l || []);
              snapCache[token] = { s: student, l: embeddedLessons };
              // 链接里打包的时段/场地也带过来，显示才和教练一致
              if (p.sl) parentSlots = p.sl;
              if (p.ct) parentCourts = p.ct;
            }
          } catch (e) { /* 解不开就当无效链接 */ }
        }
      } else if (BC.cloud && BC.cloud.on()) {
        // 接了云端：链接只带口令，数据现从云端取
        root.innerHTML = '<div class="parent">' +
          '<div class="card parent__card"><div class="parent__sorry">' +
            '<h3>正在加载…</h3><p class="muted">正在获取孩子的课表，请稍等。</p>' +
          '</div></div></div>';
        BC.cloud.pullParent(token, function (err, data) {
          if (err) { renderCloudError(root, err.message); return; }
          if (!data || !data.student) { renderInvalid(root); return; }
          var K = BC.store.KEYS;
          BC.store.mergeIn(K.students, [data.student]);
          BC.store.mergeIn(K.lessons, data.lessons || []);
          BC.store.mergeIn(K.intake, data.intake || []);
          BC.store.mergeIn(K.requests, data.requests || []);
          // 用云端带过来的时段/场地，家长端显示的时间才和教练一致
          if (data.meta) { parentSlots = data.meta.timeSlots || parentSlots; parentCourts = data.meta.courts || parentCourts; }
          renderParent(root, token, curQ);
        });
        return;
      }
    }

    if (!student) { renderInvalid(root); return; }

    var weekMonday = util.addDays(BC.rules.targetWeekMonday(), weekOffset * 7);
    var win = BC.rules.getIntakeWindow(weekMonday);
    var intake = BC.store.getIntake(student.id, weekMonday);
    var reminders = BC.rules.getStudentReminders(student);

    // P5：有几节课等着这位家长确认
    var toConfirm = pendingLessons(student);

    root.innerHTML =
      '<div class="parent">' +
        (embeddedLessons ? '<p class="muted hint">这是教练发来的课表快照，最新安排以教练发送为准。</p>' : '') +
        renderHero(student, reminders, toConfirm.length) +
        '<div class="segmented segmented--parent">' +
          '<button class="seg' + (tab === 'fill' ? ' seg--on' : '') + '" data-tab="fill">填报下周时间</button>' +
          '<button class="seg' + (tab === 'schedule' ? ' seg--on' : '') + '" data-tab="schedule">我的课表' +
            (toConfirm.length ? '<b class="segdot">' + toConfirm.length + '</b>' : '') + '</button>' +
        '</div>' +
        (tab === 'fill'
          ? renderFill(student, weekMonday, win, intake)
          : renderSchedule(student)) +
      '</div>';

    bindEvents(root, student, weekMonday, win, toConfirm);
  }

  /* ---------- 课表数据源：优先用链接里的快照（家长手机无本地数据时） ---------- */
  function lessonsAll() { return embeddedLessons || BC.store.lessons.all(); }

  /* ---------- 解开链接里的快照 ---------- */
  function decodeUrlB64(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = global.atob(s);
    if (global.TextDecoder) {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new global.TextDecoder().decode(bytes);
    }
    return decodeURIComponent(escape(bin));
  }

  // 把压缩过的快照还原成页面能直接用的学员 / 课表对象
  function expandSnapshot(text, token) {
    var p = JSON.parse(text);
    if (!p || !p.s) return null;
    var s = p.s;
    var student = {
      id: s.i, name: s.n, age: s.a, courseType: s.c,
      remainingLessons: s.r, validUntil: s.v, status: s.st,
      token: token                 // 口令本来就在网址里，不用重复打包
    };
    var lessons = (p.l || []).map(function (x) {
      var conf = {};
      if (x.f) conf[student.id] = x.f;
      return {
        id: x.i, date: x.d, slotId: x.s, courtId: x.c, courseType: x.y,
        status: x.st, isMakeup: !!x.m,
        notifiedAt: x.n ? new Date(x.n).toISOString() : null,
        confirmations: conf, studentIds: [student.id]
      };
    });
    return { s: student, l: lessons };
  }

  /* 快照以教练发来的为准，但家长本机已做的确认要盖上去，这样刷新后不会丢 */
  function overlayLocal(lessons) {
    return lessons.map(function (l) {
      var local = BC.store.lessons.find(l.id);
      if (local && local.confirmations) {
        return Object.assign({}, l, { confirmations: local.confirmations });
      }
      return l;
    });
  }

  function findLesson(id) {
    var hit = lessonsAll().filter(function (l) { return l.id === id; })[0];
    return hit || BC.store.lessons.find(id);
  }

  // 家长端查时段/场地：优先用链接或云端带过来的（教练改过的最新值），
  // 没有才退回本机配置。这样家长看到的时间永远和教练一致。
  function slotOf(id) {
    var list = parentSlots || BC.config.get('schedule.timeSlots');
    return (list || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function courtName(id) {
    var list = parentCourts || BC.config.get('schedule.courts');
    return ((list || []).filter(function (c) { return c.id === id; })[0] || {}).name || '';
  }

  /* ---------- 这个孩子有哪些课等着家长确认 ---------- */
  function pendingLessons(student) {
    var today = util.todayISO();
    return lessonsAll().filter(function (l) {
      return l.date >= today && l.status !== '已取消' &&
        (l.studentIds || []).indexOf(student.id) >= 0 &&
        BC.rules.confirmStateOf(l, student.id) === 'pending';
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /* ---------- 顶部：孩子信息 + 记分牌 ---------- */
  function renderHero(student, reminders, pendingCount) {
    var days = util.daysUntil(student.validUntil);
    var pct = days <= 0 ? 0 : Math.max(4, Math.min(100, Math.round(days / 365 * 100)));
    var low = Number(student.remainingLessons) <= BC.config.get('reminder.lowBalanceThreshold');

    var hasAlert = (pendingCount || reminders.length);
    return '<div class="hero' + (hasAlert ? ' hero--alert' : '') + '">' +
      '<div class="hero__top">' +
        avatar(student.name) +
        (hasAlert ? '<span class="hero__dot" title="有提醒待处理"></span>' : '') +
        '<div class="hero__id">' +
          '<div class="hero__name">' + esc(student.name) + '</div>' +
          '<div class="hero__meta">' + esc(student.courseType || '') +
            (student.age ? ' · ' + esc(student.age) + ' 岁' : '') + '</div>' +
        '</div>' +
        '<div class="hero__badge' + (low ? ' hero__badge--low' : '') + '">' +
          '<span class="hero__num">' + esc(student.remainingLessons) + '</span>' +
          '<span class="hero__unit">课时</span>' +
        '</div>' +
      '</div>' +
      '<div class="hero__bar"><div class="hero__barfill" style="width:' + pct + '%"></div></div>' +
      '<div class="hero__foot">' +
        '<span>有效期至 ' + esc(student.validUntil) +
          (days >= 0 ? '（还剩 ' + days + ' 天）' : '（已过期 ' + Math.abs(days) + ' 天）') + '</span>' +
      '</div>' +
      ((pendingCount || reminders.length)
        ? '<div class="hero__alerts">' +
            (pendingCount ? '<div class="alert alert--action">有 ' + pendingCount + ' 节课等你确认，点下面的「我的课表」</div>' : '') +
            reminders.map(function (r) {
              return '<div class="alert alert--' + r.level + '">' + esc(r.text) + '</div>';
            }).join('') +
          '</div>'
        : '') +
    '</div>';
  }

  /* ---------- P2：填报下周可上课时间 ---------- */
  function renderFill(student, weekMonday, win, intake) {
    var cfg = BC.config.load();
    var slots = (parentSlots || cfg.schedule.timeSlots).filter(function (s) { return s.enabled; });
    var selected = (intake && intake.slots) ? intake.slots.slice() : [];

    // 一周 7 天（周一 → 周日）
    var days = [];
    for (var i = 0; i < 7; i++) days.push(util.addDays(weekMonday, i));

    // 哪些格子可用：该星期几开了这个时段
    var head = '<tr><th class="th-time">时段</th>' +
      days.map(function (d) {
        return '<th class="th-day">' + util.weekdayCN(d) +
          '<span class="th-day__date">' + (util.parseISO(d).getMonth() + 1) + '/' + util.parseISO(d).getDate() + '</span></th>';
      }).join('') + '</tr>';

    var body = slots.map(function (s) {
      var tds = days.map(function (d) {
        var wd = util.weekday(d);
        var open = s.weekdays.indexOf(wd) >= 0;
        if (!open) return '<td class="cell-out">—</td>';
        if (BC.rules.isBlackout(d)) return '<td class="cell-out">停课</td>';

        var key = BC.rules.slotKey(d, s.id);
        var on = selected.indexOf(key) >= 0;
        return '<td class="cell-pick' + (on ? ' cell-pick--on' : '') + '" data-key="' + key + '">' +
          '<span class="pick__mark"></span>' +
          '<span class="pick__time">' + s.start + '</span>' +
        '</td>';
      }).join('');

      return '<tr><th class="th-time">' +
        '<span class="th-time__label">' + esc(s.label) + '</span>' +
        '<span class="th-time__range">' + s.start + '–' + s.end + '</span>' +
      '</th>' + tds + '</tr>';
    }).join('');

    var locked = cfg.intake.lockOutsideWindow && win.status !== '开放中';

    return '<div class="card parent__card">' +
      '<div class="weeknav">' +
        '<button class="btn btn--ghost btn--sm" data-act="wprev">‹</button>' +
        '<span class="weeknav__title">' + util.formatDateCN(weekMonday) + ' 那一周</span>' +
        '<button class="btn btn--ghost btn--sm" data-act="wnext">›</button>' +
        (weekOffset !== 0 ? '<button class="btn btn--ghost btn--sm" data-act="wnow">回到本周</button>' : '') +
      '</div>' +
      '<div class="windowbar windowbar--' + (win.status === '开放中' ? 'ok' : 'muted') + '">' +
        '填报窗口：' + util.formatDateCN(win.openDate) + ' ' + win.openTime +
        ' 开放 → ' + util.formatDateCN(win.closeDate) + ' ' + win.closeTime + ' 截止' +
        '　<b>' + win.status + '</b>' +
      '</div>' +
      '<p class="muted hint">点一下格子就选中，再点一下取消。已选 <b id="pick-count">' + selected.length + '</b> 个' +
        (cfg.intake.minSlots ? '，至少选 ' + cfg.intake.minSlots + ' 个。' : '。') + '</p>' +
      '<div class="table-wrap"><table class="table table--pick"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="parent__actions">' +
        '<button class="btn btn--primary btn--lg" id="btn-submit"' + (locked ? ' disabled' : '') + '>提交填报</button>' +
        (intake ? '<span class="muted">上次提交：' + esc(String(intake.submittedAt).slice(5, 16).replace('T', ' ')) + '</span>' : '') +
      '</div>' +
      (locked ? '<p class="muted hint">现在不在填报时间内，所以不能改。（教练可以在设置里临时放开）</p>' : '') +
    '</div>';
  }

  /* ---------- P1/P3：我的课表 ---------- */
  function renderSchedule(student) {
    var today = util.todayISO();
    var mine = lessonsAll().filter(function (l) {
      return (l.studentIds || []).indexOf(student.id) >= 0 && l.date >= today && l.status !== '已取消';
    }).sort(function (a, b) {
      return a.date === b.date
        ? a.slotId.localeCompare(b.slotId)
        : a.date.localeCompare(b.date);
    });

    if (!mine.length) {
      return '<div class="card parent__card">' + ui.empty('还没有排课', '教练排好课后，这里就会出现。') + '</div>';
    }

    var courts = parentCourts || BC.config.get('schedule.courts');
    var cards = mine.map(function (l) {
      var slot = slotOf(l.slotId);
      var court = courtName(l.courtId);
      var state = BC.rules.confirmStateOf(l, student.id);

      // 这节课有没有已经提交过的申请
      var req = BC.rules.requestOf(l.id, student.id);
      var hours = BC.rules.hoursUntilLesson(l);
      var free = BC.config.get('leave.freeCancelHours');

      var actionHtml;
      if (req) {
        var label = { '待审批': '申请处理中', '已同意': '已准假', '已驳回': '申请未通过' }[req.status] || req.status;
        var lvl = req.status === '已同意' ? 'ok' : (req.status === '已驳回' ? 'danger' : 'info');
        actionHtml = '<div class="lcard__state">' + ui.badge(label, lvl) +
          (req.type === 'reschedule' ? ' <span class="muted">（调课）</span>' : '') + '</div>';
      } else if (state === 'pending' && hours > 0) {
        actionHtml = '<div class="lcard__btns">' +
          '<button class="btn btn--primary btn--sm" data-confirm="' + l.id + '">确认参加</button>' +
          '<button class="btn btn--ghost btn--sm" data-leave="' + l.id + '">请假 / 调课</button>' +
        '</div>' +
        '<div class="lcard__note' + (hours < free ? ' lcard__note--warn' : '') + '">' +
          (hours < free
            ? '距开课只剩 ' + hours.toFixed(1) + ' 小时，不足 ' + free + ' 小时，请假会扣 1 课时'
            : '距开课还有 ' + hours.toFixed(0) + ' 小时，现在请假不扣课时') +
        '</div>';
      } else {
        actionHtml = '<div class="lcard__state">' +
          ui.badge(BC.rules.confirmLabel(state), state === 'confirmed' ? 'ok' : (state === 'adjusted' ? 'warn' : 'info')) +
        '</div>';
      }

      return '<div class="lcard' + (state === 'pending' && hours > 0 && !req ? ' lcard--pending' : '') + '">' +
        '<div class="lcard__date">' +
          '<span class="lcard__day">' + util.parseISO(l.date).getDate() + '</span>' +
          '<span class="lcard__mon">' + (util.parseISO(l.date).getMonth() + 1) + '月</span>' +
        '</div>' +
        '<div class="lcard__main">' +
          '<div class="lcard__time">' + esc(slot ? slot.label + ' ' + slot.start + '–' + slot.end : l.slotId) + '</div>' +
          '<div class="lcard__where">' + esc(util.formatDateCN(l.date)) + ' · ' + esc(court) + ' · ' + esc(l.courseType || '') +
            (l.isMakeup ? ' <span class="tag">补课</span>' : '') + '</div>' +
          actionHtml +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="card parent__card">' +
      '<p class="muted hint" style="margin:0 0 12px">还没确认的课会有「确认参加」按钮。临时来不了就点「请假 / 调课」，' +
      '提前 ' + esc(BC.config.get('leave.freeCancelHours')) + ' 小时以上不扣课时。</p>' +
      '<div class="lcards">' + cards + '</div></div>';
  }

  /* ---------- 事件 ---------- */
  function bindEvents(root, student, weekMonday, win, toConfirm) {
    root.querySelectorAll('.seg').forEach(function (b) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); renderParent(root, student.token, curQ); });
    });

    /* P5：家长确认参加 / 申请调整 */
    root.querySelectorAll('[data-confirm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var l = findLesson(b.getAttribute('data-confirm'));
        if (!l) return;
        var conf = Object.assign({}, l.confirmations || {});
        conf[student.id] = 'confirmed';
        // 快照模式下，把确认结果写回内存快照，刷新后仍然显示「已确认」
        if (embeddedLessons) {
          embeddedLessons = embeddedLessons.map(function (x) {
            return x.id === l.id ? Object.assign({}, x, { confirmations: conf }) : x;
          });
          if (snapCache[student.token]) snapCache[student.token].l = embeddedLessons;
        }
        // 家长手机上本来没有这节课的记录，先落一份再改，否则刷新后确认会丢
        if (!BC.store.lessons.find(l.id)) {
          BC.store.lessons.add(Object.assign({}, l, { confirmations: conf }));
        } else {
          BC.store.lessons.update(l.id, { confirmations: conf });
        }
        ui.toast('已确认，谢谢！');
        renderParent(root, student.token, curQ);
      });
    });

    /* P4：请假 / 调课申请 */
    root.querySelectorAll('[data-leave]').forEach(function (b) {
      b.addEventListener('click', function () {
        var l = findLesson(b.getAttribute('data-leave'));
        if (!l) return;
        openRequestForm(root, student, l);
      });
    });

    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'wprev') weekOffset--;
        if (act === 'wnext') weekOffset++;
        if (act === 'wnow') weekOffset = 0;
        renderParent(root, student.token, curQ);
      });
    });

    var locked = BC.config.get('intake.lockOutsideWindow') && win.status !== '开放中';
    var intake = BC.store.getIntake(student.id, weekMonday);
    var selected = (intake && intake.slots) ? intake.slots.slice() : [];

    root.querySelectorAll('.cell-pick').forEach(function (td) {
      td.addEventListener('click', function () {
        if (locked) { ui.toast('现在不在填报时间内', 'warn'); return; }
        var key = td.getAttribute('data-key');
        var i = selected.indexOf(key);
        if (i >= 0) { selected.splice(i, 1); td.classList.remove('cell-pick--on'); }
        else {
          var max = BC.config.get('lesson.maxLessonsPerDay');
          if (max > 0) {
            var d = BC.rules.parseSlotKey(key).date;
            var sameDay = selected.filter(function (k) { return BC.rules.parseSlotKey(k).date === d; }).length;
            if (sameDay >= max) { ui.toast('同一天最多选 ' + max + ' 节课', 'warn'); return; }
          }
          selected.push(key);
          td.classList.add('cell-pick--on');
        }
        var cnt = root.querySelector('#pick-count');
        if (cnt) cnt.textContent = selected.length;
      });
    });

    var submit = root.querySelector('#btn-submit');
    if (submit && !locked) {
      submit.addEventListener('click', function () {
        var min = BC.config.get('intake.minSlots');
        if (selected.length < min) { ui.toast('至少选 ' + min + ' 个时段', 'danger'); return; }
        BC.store.saveIntake(student.id, weekMonday, selected);
        ui.toast('提交成功，共选了 ' + selected.length + ' 个时段');
        renderParent(root, student.token, curQ);
      });
    }
  }

  /* ============================================================
   * P4：请假 / 调课申请表单
   *   家长点「请假 / 调课」弹出。会明说扣不扣课时，
   *   不让他稀里糊涂地提交。
   * ============================================================ */
  function openRequestForm(root, student, lesson) {
    var cfg = BC.config.load();
    var hours = BC.rules.hoursUntilLesson(lesson);
    var free = cfg.leave.freeCancelHours;
    var late = hours < free;

    // 调课可选的时段：下周那些格子
    var wk = BC.rules.targetWeekMonday();
    var slotOpts = [];
    for (var i = 0; i < 7; i++) {
      var d = util.addDays(wk, i);
      BC.rules.getDaySlots(d).forEach(function (s) {
        slotOpts.push({ key: BC.rules.slotKey(d, s.id), label: util.formatDateCN(d) + ' ' + s.label + ' ' + s.start });
      });
    }

    var body =
      '<p class="modal-text"><b>' + esc(util.formatDateCN(lesson.date)) + ' ' +
        esc((BC.rules.getSlot(lesson.slotId) || {}).label || '') + '</b> 这节课</p>' +
      '<div class="field"><label class="field__label">我要</label>' +
        '<div class="radioline">' +
          '<label class="rchip"><input type="radio" name="reqtype" value="leave" checked> 请假（这节不上）</label>' +
          '<label class="rchip"><input type="radio" name="reqtype" value="reschedule"> 调课（想换到别的时间）</label>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label class="field__label" for="req-reason">原因</label>' +
        '<select id="req-reason" class="input">' +
          ['事假', '病假', '学校活动', '其他'].map(function (r) {
            return '<option value="' + esc(r) + '">' + esc(r) + '</option>';
          }).join('') + '</select>' +
      '</div>' +
      '<div class="field" id="req-slots-box" style="display:none">' +
        '<label class="field__label">希望改到（可多选，教练会尽量安排）</label>' +
        '<div class="slotpick">' + slotOpts.map(function (o) {
          return '<label class="slotopt"><input type="checkbox" value="' + esc(o.key) + '"> ' + esc(o.label) + '</label>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="notice notice--' + (late ? 'danger' : 'ok') + '">' +
        (late
          ? '距开课只剩 ' + hours.toFixed(1) + ' 小时，少于 ' + free + ' 小时。<b>这次请假会扣 1 课时</b>' +
            (cfg.leave.monthlyFreeLateQuota > 0 ? '（每月有 ' + cfg.leave.monthlyFreeLateQuota + ' 次免扣机会，教练审批时会先抵用）' : '')
          : '距开课还有 ' + hours.toFixed(0) + ' 小时，超过 ' + free + ' 小时。<b>这次请假不扣课时</b>') +
      '</div>';

    ui.modal({
      title: '请假 / 调课申请',
      body: body,
      buttons: [
        { label: '取消', kind: 'ghost', onClick: function () { ui.closeModal(); } },
        {
          label: '提交申请', kind: 'primary', onClick: function () {
            var type = (document.querySelector('input[name="reqtype"]:checked') || {}).value || 'leave';
            var reason = (document.getElementById('req-reason') || {}).value || '';
            var wants = [];
            document.querySelectorAll('#req-slots-box input:checked').forEach(function (c) { wants.push(c.value); });

            if (type === 'reschedule' && !wants.length) {
              ui.toast('选一下希望改到哪个时间', 'danger');
              return;
            }
            ui.closeModal();
            BC.rules.submitRequest({
              type: type, studentId: student.id, lessonId: lesson.id,
              reason: reason, wantSlotKeys: wants
            });
            ui.toast(type === 'leave' ? '请假申请已提交，等教练处理' : '调课申请已提交，等教练处理');
            renderParent(root, student.token, curQ);
          }
        }
      ]
    });

    // 切换"请假/调课"时显示或隐藏时段选择
    var box = document.getElementById('req-slots-box');
    document.querySelectorAll('input[name="reqtype"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (box) box.style.display = (r.value === 'reschedule' && r.checked) ? '' : 'none';
      });
    });
  }

  BC.renderParent = renderParent;

})(window);
