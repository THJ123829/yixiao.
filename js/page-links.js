/* 家长链接总表：列出每个学员的专属网址，可一键复制或导出清单发给家长。
 * 链接指向「设置 → G · 上线与分享」里填的部署基地址；
 * 没填就用当前打开这个工具的网址（那样发出的链接别人可能打不开）。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  // 云端自检结果（本次打开工具只测一次，避免每次进页面都联网）
  var checked = null;

  /* 逐个孩子决定发短链接还是长链接：
   *   云端确认查得到这个孩子的口令 → 短链接（约 48 字符，家长看着正常）
   *   其余情况（云端没配 / 读不通 / 这孩子还没上云）→ 长链接（课表打包进链接，一定打得开）
   * 混着来，不搞"一刀切"，这样已经能用短链接的孩子先享受到，剩下的也不会打不开。 */
  function allLinks() {
    var okT = (checked && checked.readable && checked.cloudTokens) || null;
    return BC.store.students.all().map(function (s) {
      var canShort = !!(okT && s.token && okT[s.token]);
      return {
        id: s.id, name: s.name, courseType: s.courseType, short: canShort,
        link: BC.store.parentLink(s, false, canShort ? { short: true } : null)
      };
    });
  }

  // 链接为什么长 / 为什么短，用大白话讲清楚，并说明怎么才能变短
  function linkModeTip(list) {
    var shortN = list.filter(function (r) { return r.short; }).length;
    var total = list.length;

    if (!checked) {
      return '<p class="muted hint">正在检查云端是否连通，稍等一下链接可能会自动变短…</p>';
    }
    if (total && shortN === total) {
      return '<div class="alert alert--ok">云端已连通，链接已自动缩到最短（约 48 个字符），' +
        '家长看着就是个正常网址。孩子的课表从云端实时取，你改了排课家长刷新就能看到。</div>';
    }
    if (!checked.on) {
      return '<div class="alert alert--info">当前是<b>单机模式</b>：链接里打包了孩子的课表，' +
        '所以偏长（约 1100 个字符）。好处是家长换手机、你断网，链接都照样打得开。<br>' +
        '想让链接变短（约 48 字符），照 <b>docs/云端同步设置指南-Supabase.md</b> 配一下云端就行。</div>';
    }
    if (!checked.readable) {
      return '<div class="alert alert--warn">云端<b>连不上或读不出来</b>，' +
        '所以先给你「一定打得开」的长链接（课表打包在链接里，家长照样能用）。<br>' +
        '想变短：去 Supabase 的 SQL Editor 跑一次 ' +
        '<code>grant select, insert, update, delete on public.bc_rows to anon;</code>，' +
        '回来点一下「重新检测云端」。<br>' +
        '<span class="muted">技术信息：' + esc(checked.error || '') + '</span></div>';
    }
    // 云端读得通，但有孩子还没上云（或口令是新换的还没同步）
    return '<div class="alert alert--warn">云端读得通，' +
      (shortN ? '其中 <b>' + shortN + '/' + total + '</b> 个孩子已经用上短链接；' : '') +
      '还有 <b>' + (total - shortN) + '</b> 个在云端查不到' +
      (checked.missing && checked.missing.length
        ? '（' + esc(checked.missing.slice(0, 5).join('、')) + (checked.missing.length > 5 ? ' 等' : '') + '）'
        : '（多是刚建、还没生成过链接的）') +
      '，这几个先发长链接保证能用。<br>' +
      '想让它们也变短：去「设置 → 云端同步」点一次<b>「把本机数据上传到云端」</b>，' +
      '回来点「重新检测云端」。</div>';
  }

  function render(root) {
    var list = allLinks();
    var base = (BC.config.get('deploy.baseUrl') || '').trim();

    var tip = (base
      ? '<p class="muted hint">链接已指向你设置的基地址：<b>' + esc(base) + '</b></p>'
      : '<div class="alert alert--info">还没设置部署基地址，链接用的是你当前打开的网址。' +
        '部署上线后，记得去「设置 → G · 上线与分享」填上你的网址，链接会更短更稳。</div>')
      + linkModeTip(list);

    var rows = list.length
      ? list.map(function (r) {
          return '<div class="linkrow" data-id="' + r.id + '">' +
            '<div class="linkrow__who"><b>' + esc(r.name || '') + '</b>' +
              (r.courseType ? ' <span class="muted">' + esc(r.courseType) + '</span>' : '') +
              (r.short
                ? '<span class="badge badge--ok" title="从云端实时取数据">短链接</span>'
                : '<span class="badge" title="课表打包在链接里，一定打得开">完整链接</span>') + '</div>' +
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
          (BC.cloud && BC.cloud.on()
            ? '<button class="btn btn--ghost" id="btn-recheck">重新检测云端</button>' : '') +
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

    // 第一次进这页时测一下云端；测完如果能用短链接，就自动重画一遍换成短链接。
    // 这样你什么都不用选，工具自己挑「又短又打得开」的那种。
    if (!checked && BC.cloud) {
      BC.cloud.selfCheck(function (err, res) {
        checked = res || { on: false, readable: false, allFound: false, missing: [], error: (err && err.message) || '' };
        render(root);
      });
    }
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

    // 改好 Supabase 权限或补传了数据之后，点这个立刻重测，不用重开工具
    var recheck = root.querySelector('#btn-recheck');
    if (recheck) recheck.addEventListener('click', function () {
      recheck.disabled = true;
      recheck.textContent = '检测中…';
      checked = null;
      BC.cloud.selfCheck(function (err, res) {
        checked = res || { on: false, readable: false, allFound: false, missing: [], error: (err && err.message) || '' };
        if (checked.on && checked.readable && checked.allFound) ui.toast('云端已连通，链接已自动缩短');
        else if (checked.on && !checked.readable) ui.toast('云端还是读不出来，先用完整链接', 'warn');
        else if (checked.on) ui.toast('部分孩子还没上传到云端', 'warn');
        render(root);
      });
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
