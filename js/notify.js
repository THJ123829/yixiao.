/* 话术生成：把 config.texts 里的模板（含 {孩子}{家长}{日期} 等占位符）
 * 和真实数据合成一段能直接复制发微信的话。
 * 注意：占位符匹配用 /\{([^}]+)\}/g，不能用 \w+（\w 不匹配中文）。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var esc = util.escapeHtml;

  // 把模板里的 {xxx} 换成 ctx.xxx
  // 注意：这里必须用 [^}]+ 而不是 \w+ —— \w 只认英文字母数字，
  // 匹配不到中文占位符（比如 {孩子} {家长}），会静默地不替换。
  function fill(tpl, ctx) {
    return String(tpl || '').replace(/\{([^}]+)\}/g, function (m, k) {
      k = k.trim();
      return (ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== '') ? ctx[k] : m;
    });
  }

  function courtName(id) {
    var list = BC.config.get('schedule.courts') || [];
    var hit = list.filter(function (c) { return c.id === id; })[0];
    return hit ? hit.name : '';
  }

  function slotText(slotId) {
    var s = BC.rules.getSlot(slotId);
    return s ? (s.label + ' ' + s.start + '–' + s.end) : '';
  }

  var notify = BC.notify = {

    fill: fill,

    /* ---------- 一节课 → 每个学员一段话 ---------- */
    lessonTexts: function (lesson) {
      var cfg = BC.config.load();
      var tpl = cfg.texts.notifySchedule;
      // 「时间」只放时段，不放日期 —— 模板里已经有 {日期} 了，
      // 否则会变成「8月29日 周六 8月29日 周六 上午 10:00–12:00」这种重复
      var when = slotText(lesson.slotId);
      var where = courtName(lesson.courtId);

      return (lesson.studentIds || []).map(function (sid) {
        var s = BC.store.students.find(sid);
        if (!s) return null;
        return {
          studentId: sid,
          name: s.name,
          text: fill(tpl, {
            孩子: s.name,
            家长: s.parentName || (s.name + '家长'),
            日期: util.formatDateCN(lesson.date),
            时间: when,
            场地: where
          })
        };
      }).filter(function (x) { return !!x; });
    },

    /* ---------- 课时不足 ---------- */
    lowBalanceText: function (student) {
      var tpl = BC.config.get('texts.notifyLowBalance');
      return fill(tpl, {
        孩子: student.name,
        家长: student.parentName || (student.name + '家长'),
        剩余: student.remainingLessons
      });
    },

    /* ---------- 即将到期 ---------- */
    expiringText: function (student) {
      var tpl = BC.config.get('texts.notifyExpiring');
      return fill(tpl, {
        孩子: student.name,
        家长: student.parentName || (student.name + '家长'),
        到期日: student.validUntil,
        剩余: student.remainingLessons
      });
    },

    /* ---------- 上课提醒（课前一天） ---------- */
    classReminderText: function (lesson, student) {
      var tpl = BC.config.get('texts.notifyClassReminder');
      return fill(tpl, {
        孩子: student.name,
        家长: student.parentName || (student.name + '家长'),
        时间: slotText(lesson.slotId),
        场地: courtName(lesson.courtId)
      });
    },

    /* ============================================================
     * 弹出话术框：列出所有要发的话，支持一键全部复制
     *   lines: [{ name, text }, ...]
     * ============================================================ */
    show: function (title, lines, onSent) {
      if (!lines.length) {
        BC.ui.toast('没有要通知的人');
        return;
      }
      var all = lines.map(function (l) { return l.text; }).join('\n\n');

      var body = '<p class="modal-text">下面这些话可以直接复制，粘到微信发给对应家长。</p>' +
        '<div class="msglist">' + lines.map(function (l, i) {
          return '<div class="msgrow">' +
            '<div class="msgrow__head"><b>' + esc(l.name) + '</b>' +
              '<button class="linkbtn" data-copyone="' + i + '">复制这条</button></div>' +
            '<div class="msgrow__text">' + esc(l.text) + '</div>' +
          '</div>';
        }).join('') + '</div>';

      BC.ui.modal({
        title: title + '（共 ' + lines.length + ' 条）',
        body: body,
        buttons: [
          { label: '关闭', kind: 'ghost', onClick: function () { BC.ui.closeModal(); } },
          {
            label: '全部复制', kind: 'primary', onClick: function () {
              copy(all, '已复制全部 ' + lines.length + ' 条');
              if (onSent) onSent();
              BC.ui.closeModal();
            }
          }
        ]
      });

      // 单条复制
      var mask = document.getElementById('modal-mask');
      if (mask) {
        mask.querySelectorAll('[data-copyone]').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            copy(lines[Number(b.getAttribute('data-copyone'))].text, '已复制');
          });
        });
      }
    }
  };

  /* ---------- 复制到剪贴板（file:// 下可能没有 clipboard，自动降级） ---------- */
  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { BC.ui.toast(okMsg); },
        function () { fallback(text); }
      );
    } else {
      fallback(text);
    }
  }
  function fallback(text) {
    BC.ui.modal({
      title: '手动复制',
      body: '<p class="modal-text">选中下面这段文字复制：</p>' +
            '<textarea class="input" rows="5">' + esc(text) + '</textarea>',
      buttons: [{ label: '知道了', kind: 'primary', onClick: function () { BC.ui.closeModal(); } }]
    });
  }

  notify.copy = copy;

})(window);
