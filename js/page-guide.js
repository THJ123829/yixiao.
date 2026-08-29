/* 家长使用说明（一页纸）：教练复制全文发到家长群，家长照着做就行。
 * 语言保持白话，别让家长看不懂。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  function guideSteps() {
    return [
      {
        n: 1, icon: 'link',
        title: '点开链接就能用',
        text: '每个孩子都有一个专属链接，点开就是自己孩子的页面。不用下载 App、不用注册、不用记密码。链接别外传，一人一个。'
      },
      {
        n: 2, icon: 'calendar',
        title: '每周填一次「可上课时间」',
        text: '教练一般周四开放填报、周日截止。打开后，把下周能来上课的时段勾出来（至少勾 2 个），点「提交」就好。错过时间也能在页面上看到，教练会按上周沿用。'
      },
      {
        n: 3, icon: 'check',
        title: '看课表、确认参加',
        text: '教练排好课后，页面上会标「待确认」。能来就点「确认参加」；临时来不了点「申请调整」，告诉教练一声。'
      },
      {
        n: 4, icon: 'leave',
        title: '临时请假这样请',
        text: '在「我的课表」里点那节课 → 请假。开课前 12 小时以上请假不扣课时；更晚请假会按规则处理（每月有免扣次数）。'
      },
      {
        n: 5, icon: 'score',
        title: '课时和有效期一目了然',
        text: '页面顶部的记分牌显示剩余课时和有效期。快用完或超过有效期前，会提前提醒你和教练。'
      },
      {
        n: 6, icon: 'chat',
        title: '有问题直接找教练',
        text: '链接里看不明白、时间对不上、想调课，都直接微信找教练说，别自己瞎猜。'
      }
    ];
  }

  function plainText() {
    var title = BC.config.get('texts.appTitle') + ' · 家长使用说明（一页纸）';
    var steps = guideSteps().map(function (s) {
      return s.n + '. ' + s.title + '\n   ' + s.text;
    }).join('\n\n');
    return title + '\n\n' + steps + '\n\n—— 有任何问题，直接微信联系教练即可。';
  }

  function render(root) {
    var steps = guideSteps();
    var cards = steps.map(function (s) {
      return '<div class="gcard">' +
        '<div class="gcard__no">' + s.n + '</div>' +
        '<div class="gcard__body">' +
          '<div class="gcard__title">' + esc(s.title) + '</div>' +
          '<div class="gcard__text">' + esc(s.text) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>家长使用说明</h2>' +
          '<p class="muted">一页纸，直接转发给家长。点「复制全文」发到家长群，或点「打印」存成图片。</p>' +
        '</div>' +
        '<div class="toolbar toolbar--plain">' +
          '<button class="btn btn--primary" id="btn-copy-guide">复制全文</button>' +
          '<button class="btn btn--ghost" id="btn-print-guide">打印 / 存图</button>' +
        '</div>' +
        '<div class="guide" id="guide-printable">' +
          '<div class="guide__head">' + esc(BC.config.get('texts.appTitle')) + ' · 家长使用说明</div>' +
          cards +
          '<div class="guide__foot">有任何问题，直接微信联系教练即可。</div>' +
        '</div>' +
      '</div>';

    bindEvents(root);
  }

  function bindEvents(root) {
    var copyBtn = root.querySelector('#btn-copy-guide');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = plainText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { ui.toast('已复制全文，去家长群粘贴吧'); },
          function () { fallbackCopy(text); }
        );
      } else fallbackCopy(text);
    });
    var printBtn = root.querySelector('#btn-print-guide');
    if (printBtn) printBtn.addEventListener('click', function () {
      ui.toast('已调起打印，选「另存为 PDF」即可存图');
      setTimeout(function () { global.print(); }, 300);
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ui.toast('已复制全文'); }
    catch (e) { ui.toast('复制失败，请手动选择', 'danger'); }
    ta.remove();
  }

  // 不单独占底部导航：内容已并入「家长链接」页，点开即可复制发给家长
  BC.registerPage('guide', {
    title: '家长说明',
    nav: false,
    order: 80,
    render: render
  });

})(window);
