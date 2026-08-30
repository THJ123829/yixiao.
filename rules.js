/* 规则层：负责判断——数据对不对、该不该提醒、能不能排、扣不扣课时。
 * 这一层不碰界面、不碰存储，只吃数据、吐结论，所以改界面不影响它。
 * 新增规则：在下面加一个函数并挂到 BC.rules 上，老规则不用动。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var rules = BC.rules = {};

  /* 1. 学员校验（按 config.studentFields 自动校验，加字段后自动覆盖） */
  rules.validateStudent = function (data) {
    var cfg = BC.config.load();
    var errors = [];

    cfg.studentFields.forEach(function (f) {
      var v = data[f.key];
      var empty = (v === '' || v === null || v === undefined);

      // 日期自动扶正：20270830、2027/8/30 这类写法直接改成 2027-08-30，
      // 不用教练手动改，也避免存进去后"还剩几天"算成 NaN。
      if (!empty && f.type === 'date') {
        v = util.normalizeISO(v);
        data[f.key] = v;
      }

      if (f.required && empty) { errors.push(f.label + '不能为空'); return; }
      if (empty) return;

      if (f.type === 'number') {
        var n = Number(v);
        if (isNaN(n)) errors.push(f.label + '必须填数字');
        else if (f.key === 'remainingLessons' && n < 0) errors.push('剩余课时不能是负数');
        else if (f.key === 'age' && (n < 3 || n > 90)) errors.push('年龄看起来不太对（应填 3～90）');
      }
      if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
        errors.push(f.label + '格式应为 年-月-日');
      }
      if (f.type === 'tel' && !/^\d{6,20}$/.test(String(v).replace(/\s/g, ''))) {
        errors.push(f.label + '只能填数字');
      }
    });

    var dup = BC.store.students.all().filter(function (s) {
      return s.name === data.name && s.id !== data.id;
    });
    if (dup.length) errors.push('已经有叫「' + data.name + '」的学员了');

    // 课程类型必须是指定的几种之一（防止导入名单里写错，存进脏数据）
    if (data.courseType) {
      var types = (cfg.lesson.courseTypes || []);
      if (types.length && types.indexOf(data.courseType) < 0) {
        errors.push('课程类型必须是 ' + types.join(' / ') + ' 之一');
      }
    }

    return { ok: errors.length === 0, errors: errors };
  };

  /* ============================================================
   * 2. 上课时段（Q2：四个固定档位，不是按粒度自由切）
   * ============================================================ */

  // 把某天的时段档位取出来（已排除"这天不开"和"临时关掉"的）
  rules.getDaySlots = function (dateISO) {
    var cfg = BC.config.load();
    var wd = util.weekday(dateISO);

    return cfg.schedule.timeSlots.filter(function (s) {
      if (!s.enabled) return false;
      if (s.weekdays.indexOf(wd) < 0) return false;
      var off = (cfg.schedule.slotBlackouts || []).filter(function (b) {
        return b.date === dateISO && b.slotId === s.id;
      });
      return off.length === 0;
    }).map(function (s) {
      return { id: s.id, label: s.label, start: s.start, end: s.end };
    });
  };

  // 按 id 取一个档位定义
  rules.getSlot = function (slotId) {
    var list = BC.config.load().schedule.timeSlots;
    return list.filter(function (s) { return s.id === slotId; })[0] || null;
  };

  // 时段格子在填报/汇总里的唯一键：'2026-09-05#am'
  rules.slotKey = function (dateISO, slotId) { return dateISO + '#' + slotId; };
  rules.parseSlotKey = function (key) {
    var p = String(key).split('#');
    return { date: p[0], slotId: p[1] };
  };

  // 某天是否整天停课
  rules.isBlackout = function (dateISO) {
    var list = BC.config.load().schedule.blackoutDates || [];
    for (var i = 0; i < list.length; i++) {
      if (dateISO >= list[i].from && dateISO <= list[i].to) return list[i].reason || '停课';
    }
    return null;
  };

  /* ============================================================
   * 3. 填报窗口（C1/C2）
   *    目标是"下周"，那窗口就是：上周四 12:00 开放 → 上周日 18:00 截止
   * ============================================================ */
  rules.targetWeekMonday = function () {
    var cfg = BC.config.load();
    var thisMon = util.mondayOf(util.todayISO());
    return util.addDays(thisMon, 7 * (cfg.intake.weeksAhead || 1));
  };

  /* 目标周周一往前推，落到"星期几 = weekday"那一天，返回要减的天数。
   * 周一本身是 1；例：周四(4) 在周一前 4 天，周日(0) 在周一前 1 天。 */
  function daysBeforeMonday(weekday) {
    var w = Number(weekday);
    if (isNaN(w)) w = 4;
    var off = ((1 - w) % 7 + 7) % 7;
    return off === 0 ? 7 : off;
  }

  rules.getIntakeWindow = function (weekMonday) {
    var cfg = BC.config.load();
    var openDate = util.addDays(weekMonday, -daysBeforeMonday(cfg.intake.openWeekday));
    var closeDate = util.addDays(weekMonday, -daysBeforeMonday(cfg.intake.closeWeekday));
    // 万一配置的截止日不晚于开放日，就把截止日顺延一周，保证窗口是正的顺序
    if (closeDate <= openDate) closeDate = util.addDays(closeDate, 7);

    function stamp(d, t) {
      var p = t.split(':');
      var dt = util.parseISO(d);
      dt.setHours(Number(p[0]), Number(p[1]), 0, 0);
      return dt.getTime();
    }
    var now = Date.now();
    var openAt = stamp(openDate, cfg.intake.openTime);
    var closeAt = stamp(closeDate, cfg.intake.closeTime);

    var status = now < openAt ? '未开放' : (now > closeAt ? '已截止' : '开放中');
    return { openDate: openDate, openTime: cfg.intake.openTime, closeDate: closeDate, closeTime: cfg.intake.closeTime, status: status };
  };

  /* ============================================================
   * 4. 提醒判断
   * ============================================================ */
  rules.getStudentReminders = function (student) {
    var cfg = BC.config.load();
    var out = [];
    if (student.status !== '在读') return out;

    if (Number(student.remainingLessons) <= cfg.reminder.lowBalanceThreshold) {
      out.push({
        type: 'lowBalance',
        level: Number(student.remainingLessons) === 0 ? 'danger' : 'warn',
        text: '课时不足：只剩 ' + student.remainingLessons + ' 节'
      });
    }

    var days = util.daysUntil(student.validUntil);
    if (days < 0) {
      out.push({ type: 'expired', level: 'danger', text: '已过期 ' + Math.abs(days) + ' 天' });
    } else {
      (cfg.reminder.expiryLeadDays || []).forEach(function (lead) {
        if (days <= lead) out.push({ type: 'expiring', level: days <= 3 ? 'danger' : 'warn', text: '还有 ' + days + ' 天到期' });
      });
    }

    var seen = {};
    return out.filter(function (r) { if (seen[r.type]) return false; seen[r.type] = true; return true; });
  };

  /* ---------- 一节课的开始时间（Date 对象，手动构造避免时区把日期算错一天） ---------- */
  rules.lessonStartDateTime = function (lesson) {
    var slot = BC.rules.getSlot(lesson.slotId);
    if (!slot || !lesson.date) return null;
    var d = util.parseISO(lesson.date);
    var hm = String(slot.start || '00:00').split(':');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hm[0]) || 0, Number(hm[1]) || 0, 0);
  };

  /* ============================================================
   * 5. 排课冲突检测
   *    draft: { date, slotId(或 start), courtId, studentIds, excludeLessonId }
   * ============================================================ */
  rules.isOverlap = function (aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  };

  // 把 draft 规范成 {startMin, endMin}
  function normalizeDraft(draft) {
    var cfg = BC.config.load();
    var start, duration = draft.durationMinutes || cfg.lesson.durationMinutes;
    if (draft.slotId) {
      var slot = rules.getSlot(draft.slotId);
      if (slot) {
        start = slot.start;
        duration = util.hhmmToMinutes(slot.end) - util.hhmmToMinutes(slot.start);
      }
    }
    if (!start) start = draft.start;
    var s = util.hhmmToMinutes(start);
    return { startMin: s, endMin: s + duration, start: util.minutesToHHMM(s) };
  }

  rules.checkScheduleConflict = function (draft) {
    var cfg = BC.config.load();
    var conflicts = [];
    var all = BC.store.lessons.all();
    var nd = normalizeDraft(draft);

    var bo = rules.isBlackout(draft.date);
    if (bo) conflicts.push({ type: 'blackout', message: '这天停课：' + bo });

    // 该档位这天是否开放
    var daySlots = rules.getDaySlots(draft.date);
    var slotOk = draft.slotId
      ? daySlots.some(function (s) { return s.id === draft.slotId; })
      : daySlots.some(function (s) {
          return util.hhmmToMinutes(s.start) === nd.startMin;
        });
    if (!slotOk) {
      conflicts.push({
        type: 'slotClosed',
        message: util.weekdayCN(draft.date) + '这个时段不开课' +
          (daySlots.length ? '（这天只开：' + daySlots.map(function (s) { return s.label; }).join('、') + '）' : '（这天不排课）')
      });
    }

    all.forEach(function (les) {
      if (les.id === draft.excludeLessonId) return;
      if (les.date !== draft.date) return;
      if (les.status === '已取消') return;

      var ln = normalizeDraft(les);
      if (!rules.isOverlap(nd.startMin, nd.endMin, ln.startMin, ln.endMin)) return;

      if (draft.courtId && les.courtId === draft.courtId) {
        var court = (cfg.schedule.courts.filter(function (c) { return c.id === draft.courtId; })[0] || {}).name || draft.courtId;
        conflicts.push({ type: 'court', message: court + '此时段已被占用' });
      }
      if (cfg.schedule.coachNoParallel) {
        conflicts.push({ type: 'coach', message: '你此时段已经有课了' });
      }
    });

    // 人数：A2/Q1 = 不硬拦，只软提醒
    var count = (draft.studentIds || []).length;
    if (cfg.lesson.capacityHardLimit && count > cfg.lesson.capacitySoftWarn) {
      conflicts.push({ type: 'capacity', message: '超过人数上限 ' + cfg.lesson.capacitySoftWarn + ' 人' });
    }
    rules.lastSoftWarning = (!cfg.lesson.capacityHardLimit && count > cfg.lesson.capacitySoftWarn)
      ? '已选 ' + count + ' 人，超过建议的 ' + cfg.lesson.capacitySoftWarn + ' 人'
      : null;

    // Q3：同一学员的冲突（同时段重复 / 一天超过上限）
    rules.checkStudentConflicts(draft.date, draft.slotId, draft.studentIds, draft.excludeLessonId)
      .forEach(function (c) { conflicts.push(c); });

    // 同一条冲突可能被多节课重复触发，按"类型+内容"去重，免得提示刷屏
    var seen = {}, out = [];
    conflicts.forEach(function (c) {
      var k = c.type + '|' + c.message;
      if (seen[k]) return;
      seen[k] = true;
      out.push(c);
    });
    return out;
  };

  /* ---------- Q3：一个学员一天可以上多节课，但不能同一时段上两节 ---------- */
  rules.checkStudentConflicts = function (dateISO, slotId, studentIds, excludeLessonId) {
    var cfg = BC.config.load();
    var max = cfg.lesson.maxLessonsPerDay;
    var out = [];

    var thatDay = BC.store.lessons.all().filter(function (l) {
      return l.date === dateISO && l.id !== excludeLessonId && l.status !== '已取消';
    });

    (studentIds || []).forEach(function (sid) {
      var stu = BC.store.students.find(sid);
      var name = stu ? stu.name : sid;

      var sameSlot = thatDay.filter(function (l) {
        return l.slotId === slotId && (l.studentIds || []).indexOf(sid) >= 0;
      });
      if (sameSlot.length) {
        out.push({ type: 'studentSlot', studentId: sid, message: name + '此时段已经排在另一节课了' });
      }

      if (max > 0) {
        var todayCount = thatDay.filter(function (l) {
          return (l.studentIds || []).indexOf(sid) >= 0;
        }).length + 1;
        if (todayCount > max) {
          out.push({
            type: 'studentDaily', studentId: sid,
            message: name + '今天已排 ' + (todayCount - 1) + ' 节，超过每日上限 ' + max + ' 节'
          });
        }
      }
    });

    return out;
  };

  // 某学员某天已经排了几节课（给排课台显示用）
  rules.countLessonsOfDay = function (studentId, dateISO, excludeLessonId) {
    return BC.store.lessons.all().filter(function (l) {
      return l.date === dateISO && l.id !== excludeLessonId && l.status !== '已取消' &&
        (l.studentIds || []).indexOf(studentId) >= 0;
    }).length;
  };

  /* ============================================================
   * 6. Q4：扣课时 —— 教练确认出勤后才扣
   *
   *    lesson:     {id, date, slotId, isMakeup, status, studentIds}
   *    attendance: { [学员id]: {
   *        status: 'attended' | 'absent' | 'leave',
   *        leaveApproved:  请假是否已审批通过,
   *        leaveHoursBefore: 距开课几小时请的假,
   *        leaveDeducted:  这次请假是否已经扣过课时（避免补课重复扣）,
   *        monthQuotaUsed: 该学员本月已用掉几次临期免扣
   *    }}
   *
   *    返回 { items, totalDeducted, warnings }
   * ============================================================ */
  rules.settleAttendance = function (lesson, attendance) {
    var cfg = BC.config.load();
    var items = [];
    var warnings = [];

    (lesson.studentIds || []).forEach(function (sid) {
      var stu = BC.store.students.find(sid);
      var name = stu ? stu.name : sid;
      var a = (attendance && attendance[sid]) || { status: 'unmarked' };

      var deducted = 0, reason = '';

      if (lesson.status === '已取消') {
        deducted = 0; reason = '教练取消，不扣';
      } else if (a.status === 'leave') {
        if (!a.leaveApproved) {
          deducted = 0; reason = '请假待审批，暂不扣';
          warnings.push(name + '的请假还没审批');
        } else if (a.leaveHoursBefore >= cfg.leave.freeCancelHours) {
          deducted = 0; reason = '提前请假，不扣';
        } else if (lesson.isMakeup && a.leaveDeducted) {
          deducted = 0; reason = '补课不重复扣（请假时已扣）';
        } else if (cfg.leave.deductIfLate) {
          var quota = cfg.leave.monthlyFreeLateQuota || 0;
          var used = a.monthQuotaUsed || 0;
          if (used < quota) { deducted = 0; reason = '临期请假，用掉本月第 ' + (used + 1) + ' 次免扣'; }
          else { deducted = 1; reason = '临期请假，扣 1 课时'; }
        } else {
          deducted = 0; reason = '临期请假，按设置不扣';
        }
      } else if (a.status === 'attended') {
        if (lesson.isMakeup && a.leaveDeducted) { deducted = 0; reason = '补课不重复扣'; }
        else { deducted = 1; reason = '出勤，扣 1 课时'; }
      } else if (a.status === 'absent') {
        deducted = 1; reason = '未出勤，扣 1 课时';
      } else {
        deducted = 0; reason = '还没点考勤，暂不扣';
        warnings.push(name + '还没点考勤');
      }

      items.push({ studentId: sid, name: name, status: a.status, deducted: deducted, reason: reason });
    });

    var total = items.reduce(function (s, x) { return s + x.deducted; }, 0);
    return { items: items, totalDeducted: total, warnings: warnings };
  };

  /* ---------- 真正把课时扣到学员账上 ---------- */
  rules.applyDeductions = function (items) {
    items.forEach(function (it) {
      if (!it.deducted) return;
      var s = BC.store.students.find(it.studentId);
      if (!s) return;
      BC.store.students.update(it.studentId, {
        remainingLessons: Math.max(0, Number(s.remainingLessons) - it.deducted)
      });
    });
  };

  /* ============================================================
   * 7. 通知确认状态（E5）
   *    家长点了「确认参加」才算 confirmed；
   *    超过确认时限（默认 24 小时）没回，按「默认确认」处理，
   *    免得你干等着。
   * ============================================================ */
  rules.confirmStateOf = function (lesson, studentId) {
    var cfg = BC.config.load();
    var c = (lesson.confirmations || {})[studentId];
    if (c === 'confirmed') return 'confirmed';
    if (c === 'adjusted') return 'adjusted';

    if (lesson.notifiedAt) {
      var hours = (Date.now() - new Date(lesson.notifiedAt).getTime()) / 3600000;
      if (hours >= (cfg.reminder.confirmTimeoutHours || 24)) return 'autoConfirmed';
    }
    return 'pending';
  };

  var CONFIRM_LABEL = {
    confirmed: '已确认',
    adjusted: '申请调整',
    autoConfirmed: '超时默认确认',
    pending: '待确认'
  };
  rules.confirmLabel = function (state) { return CONFIRM_LABEL[state] || state; };

  // 一节课里还没确认的学员
  rules.unconfirmedOf = function (lesson) {
    return (lesson.studentIds || []).filter(function (sid) {
      return rules.confirmStateOf(lesson, sid) === 'pending';
    }).map(function (sid) {
      var s = BC.store.students.find(sid);
      return { studentId: sid, name: s ? s.name : sid };
    });
  };

  /* ============================================================
   * 8. 请假 / 调课申请（D 组）+ 考勤点名（Q4）
   * ============================================================ */

  // 距这节课开课还有几小时（负数表示已经开课了）
  rules.hoursUntilLesson = function (lesson) {
    var slot = rules.getSlot(lesson.slotId);
    var p = (slot ? slot.start : '00:00').split(':');
    var dt = util.parseISO(lesson.date);
    dt.setHours(Number(p[0]), Number(p[1]), 0, 0);
    return (dt.getTime() - Date.now()) / 3600000;
  };

  // 这个学员对这节课有没有申请（含已处理的）
  rules.requestOf = function (lessonId, studentId) {
    return BC.store.requests.all().filter(function (r) {
      return r.lessonId === lessonId && r.studentId === studentId && r.status !== '已取消';
    })[0] || null;
  };

  // 家长提交申请。type: 'leave' 请假 / 'reschedule' 调课
  rules.submitRequest = function (payload) {
    var lesson = BC.store.lessons.find(payload.lessonId);
    if (!lesson) return null;
    var hours = rules.hoursUntilLesson(lesson);
    var cfg = BC.config.load();

    var late = hours < cfg.leave.freeCancelHours;
    var rec = BC.store.requests.add({
      type: payload.type,
      studentId: payload.studentId,
      lessonId: payload.lessonId,
      lessonDate: lesson.date,
      reason: payload.reason || '',
      wantSlotKeys: payload.wantSlotKeys || [],
      hoursBefore: Math.round(hours * 10) / 10,
      late: late,
      status: '待审批',
      deducted: false
    });
    return rec;
  };

  // 教练审批。agree=true 同意
  rules.decideRequest = function (requestId, agree) {
    var r = BC.store.requests.find(requestId);
    if (!r) return null;
    var lesson = BC.store.lessons.find(r.lessonId);

    if (!agree) {
      return BC.store.requests.update(requestId, { status: '已驳回', decidedAt: new Date().toISOString() });
    }

    var patch = { status: '已同意', decidedAt: new Date().toISOString() };

    if (lesson && r.type === 'leave') {
      // 请假 → 在这节课的考勤里记成"请假"，点名时按规则决定扣不扣
      var att = Object.assign({}, lesson.attendance || {});
      att[r.studentId] = 'leave';
      BC.store.lessons.update(lesson.id, { attendance: att });

      var conf = Object.assign({}, lesson.confirmations || {});
      conf[r.studentId] = 'leave';
      BC.store.lessons.update(lesson.id, { confirmations: conf });
    }

    if (lesson && r.type === 'reschedule') {
      // 调课 → 从这节课挪走，不扣课时，等你排到别的课上
      var ids = (lesson.studentIds || []).filter(function (x) { return x !== r.studentId; });
      BC.store.lessons.update(lesson.id, { studentIds: ids });
      patch.deducted = false;
    }

    return BC.store.requests.update(requestId, patch);
  };

  // 待我审批的申请
  rules.pendingRequests = function () {
    return BC.store.requests.all().filter(function (r) { return r.status === '待审批'; })
      .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
  };

  /* ============================================================
   * 点名用的上下文：把「有没有请假、提前多久、本月免扣用掉几次」
   * 这些散落的信息汇总成 settleAttendance 需要的格式。
   * ============================================================ */
  rules.buildAttendanceContext = function (lesson) {
    var cfg = BC.config.load();
    var studentIds = lesson.studentIds || [];
    var approved = BC.store.requests.all().filter(function (r) {
      return r.status === '已同意' && studentIds.indexOf(r.studentId) >= 0;
    });

    var monthPrefix = String(lesson.date).slice(0, 7);
    var ctx = {};

    studentIds.forEach(function (sid) {
      // 这次相关的请假申请：优先这节课本身的；
      // 如果是补课，就顺着 makeupForMap 找到它补的那节课，看那次请假扣没扣过
      var mine = approved.filter(function (r) {
        return r.studentId === sid && r.lessonId === lesson.id;
      })[0];
      var origin = (lesson.makeupForMap || {})[sid];
      if (!mine && origin) {
        mine = approved.filter(function (r) {
          return r.studentId === sid && r.lessonId === origin;
        })[0];
      }

      // 本月已经用掉几次"临期免扣"额度。
      // 注意要排掉当前这一次 —— 否则第一次临期请假就被算成"额度用完了"，
      // 白白扣掉本该免的课时（这是个已经踩过的坑）。
      var used = approved.filter(function (r) {
        return r.studentId === sid && r.late &&
          r.lessonId !== lesson.id &&
          (!origin || r.lessonId !== origin) &&
          String(r.lessonDate || '').slice(0, 7) === monthPrefix;
      }).length;

      var marked = (lesson.attendance || {})[sid];

      ctx[sid] = {
        status: marked || 'unmarked',
        leaveApproved: !!mine,
        leaveHoursBefore: mine ? (mine.hoursBefore || 0) : 0,
        leaveDeducted: mine ? !!mine.deducted : false,
        monthQuotaUsed: used
      };
    });

    return ctx;
  };

  /* ---------- 补课自动关联：这节补课分别补的是每个学员的哪次请假 ----------
   * 大白话：把补课和原来的那次请假对上号，才知道那次到底扣没扣过课时。
   *         扣过 → 这次补课不再扣；没扣过 → 这次照扣。
   *         挑"最近一次还没补过的准假"，不用教练手工选。
   * ------------------------------------------------------------------ */
  rules.buildMakeupMap = function (studentIds) {
    // 已经被别的补课用掉的原课次，不再重复补
    var used = {};
    BC.store.lessons.all().forEach(function (l) {
      var m = l.makeupForMap || {};
      Object.keys(m).forEach(function (k) { used[m[k] + '|' + k] = true; });
    });

    var map = {};
    (studentIds || []).forEach(function (sid) {
      var rs = BC.store.requests.all().filter(function (r) {
        return r.studentId === sid && r.type === 'leave' && r.status === '已同意' &&
          !used[r.lessonId + '|' + sid];
      }).sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      if (rs.length) map[sid] = rs[0].lessonId;
    });
    return map;
  };

  // 点完名保存：算出每人扣多少，真的扣到账上
  rules.saveAttendance = function (lessonId, marks) {
    var lesson = BC.store.lessons.find(lessonId);
    if (!lesson) return null;

    BC.store.lessons.update(lessonId, { attendance: Object.assign({}, marks) });

    var fresh = BC.store.lessons.find(lessonId);
    var ctx = rules.buildAttendanceContext(fresh);
    // 教练手动点的出勤/未出勤，优先级高于自动推断
    Object.keys(marks).forEach(function (sid) {
      if (ctx[sid]) ctx[sid].status = marks[sid];
    });

    var result = rules.settleAttendance(fresh, ctx);
    rules.applyDeductions(result.items);

    // 把"临期请假已扣课时"记回申请单，避免将来补课重复扣
    result.items.forEach(function (it) {
      if (!it.deducted || ctx[it.studentId].status !== 'leave') return;
      var r = BC.store.requests.all().filter(function (x) {
        return x.studentId === it.studentId && x.lessonId === lessonId && x.status === '已同意';
      })[0];
      if (r && !r.deducted) BC.store.requests.update(r.id, { deducted: true });
    });

    BC.store.lessons.update(lessonId, { status: '已完成' });
    return result;
  };

})(window);
