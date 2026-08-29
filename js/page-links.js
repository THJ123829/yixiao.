/* 家长链接总表：列出每个学员的专属网址，可一键复制或导出清单发给家长。
 * 链接指向「设置 → G · 上线与分享」里填的部署基地址；
 * 没填就用当前打开这个工具的网址（那样发出的链接别人可能打不开）。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  function allLinks() {
    return BC.store.students.all().map(function (s) {
      return { id: s.id, name: s.name, courseType: s.courseType, link: BC.store.parentLink(s) };
    });
  }

  function render(root) {
    var list = allLinks();
    var base = (BC.config.get('deploy.baseUrl') || '').trim();

    var tip = base
      ? '<p class="muted hint">链接已指向你设置的基地址：<b>' + esc(base) + '</b></p>'
      : '<div class="alert alert--info">还没设置部署基地址，链接用的是你当前打开的网址。' +
        '部署上线后，记得去「设置 → G · 上线与分享」填上你的网址，链接会更短更稳。</div>';

    var rows = list.length
      ? list.map(function (r) {
          return '<div class="linkrow" data-id="' + r.id + '">' +
            '<div class="linkrow__who"><b>' + esc(r.name || '') + '</b>' +
              (r.courseType ? ' <span class="muted">' + esc(r.courseType) + '</span>' : '') + '</div>' +
            '<input class="input linkrow__url" id="url-' + r.id + '" value="' + esc(r.link) + '" readonly>' +
            '<button class="btn btn--ghost btn--sm" data-copy="' + r.id + '">复制</button>' +
          '</div>';
        }).join('')
      : ui.empty('还没有学员', '先去「学员档案」导入或新增学员，这里才会出链接');

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>家长链接</h2>' +
          '<p class="muted">共 ' + list.length + ' 名学员。把链接发给对应家长，点开就是自己孩子的页面，不用注册。</p>' +
        '</div>' +
        tip +
        '<div class="toolbar toolbar--plain">' +
          '<button class="btn btn--primary" id="btn-copy-all">一键复制全部</button>' +
          '<button class="btn btn--ghost" id="btn-export-list">导出清单（txt）</button>' +
        '</div>' +
        '<div class="linklist">' + rows + '</div>' +
        '<details class="guidebox" id="guide-box">' +
          '<summary class="guidebox__sum">家长使用说明（点开，可复制全文发到家长群）</summary>' +
          '<div id="guide-host"></div>' +
        '</details>' +
      '</div>';

    bindEvents(root, list);

    // 家长说明并入本页，省掉一个导航入口
    var gHost = root.querySelector('#guide-host');
    if (gHost && BC.pages.guide && BC.pages.guide.render) BC.pages.guide.render(gHost);
  }

  function bindEvents(root, list) {
    root.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-copy');
        var el = document.getElementById('url-' + id);
        copyText(el ? el.value : '');
      });
    });

    var copyAll = root.querySelector('#btn-copy-all');
    if (copyAll) copyAll.addEventListener('click', function () {
      var text = list.map(function (r) { return (r.name || '') + '：' + r.link; }).join('\n');
      copyText(text);
    });

    var exportList = root.querySelector('#btn-export-list');
    if (exportList) exportList.addEventListener('click', function () {
      var text = list.map(function (r) { return (r.name || '') + '\t' + r.link; }).join('\n');
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '家长链接清单-' + util.todayISO() + '.txt';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      ui.toast('清单已下载，可粘到微信逐条发');
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { ui.toast('已复制' + (text.indexOf('\n') >= 0 ? '全部链接' : '')); },
        function () { fallbackCopy(text); }
      );
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ui.toast('已复制'); }
    catch (e) { ui.toast('复制失败，请手动选择', 'danger'); }
    ta.remove();
  }

  BC.registerPage('links', {
    title: '家长链接',
    nav: true,
    order: 50,
    render: render
  });

})(window);
