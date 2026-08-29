/* 启动器 + 路由 + 外壳：判断来的是教练还是家长（看网址 # 后面的那段），
 * 画导航，以及教练端密码门。
 *   #/parent/<口令>  → 家长端，不用密码，只看得到自己孩子
 *   其他 / 空        → 教练端，要过密码门
 * 新增页面：新建 js 文件并调一次 BC.registerPage，
 * 再在 index.html 里加一行 <script>，导航会自动多一个入口。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var esc = BC.util.escapeHtml;

  var ADMIN_FLAG = 'bc.admin.ok';

  // 底部标签栏：页面 id → 图标
  var TAB_ICONS = {
    home: 'home', students: 'people', schedule: 'racket',
    calendar: 'calendar', links: 'link'
  };

  function navEl(html) {
    var el = document.getElementById('app-nav');
    if (html !== '') el.innerHTML = html;
    return el;
  }

  function hideGear(hide) {
    var g = document.getElementById('btn-settings');
    if (g) g.style.display = hide ? 'none' : '';
  }

  /* ---------- 解析路由 ---------- */
  function parseRoute() {
    var hash = location.hash || '';
    var pm = hash.match(/^#\/parent\/([\w-]+)(?:\?([^#]*))?$/);
    if (pm) return { kind: 'parent', token: pm[1], q: pm[2] || '' };

    var cm = hash.match(/^#\/(\w+)$/);
    if (cm && BC.pages[cm[1]]) return { kind: 'coach', page: cm[1] };

    return { kind: 'coach', page: defaultPageId() };
  }

  function defaultPageId() {
    var ids = Object.keys(BC.pages).filter(function (id) { return BC.pages[id].nav; });
    if (!ids.length) return Object.keys(BC.pages)[0];
    return ids.sort(function (a, b) {
      return (BC.pages[a].order || 99) - (BC.pages[b].order || 99);
    })[0];
  }

  /* ---------- 画外壳 ---------- */
  function renderShell(route) {
    var pageId = route.page;
    var main = document.getElementById('app-main');

    if (route.kind === 'parent') {
      // 家长端：不显示教练的标签栏
      document.getElementById('app-title').innerHTML =
        BC.icons.shuttle(22) + '<span>' + esc(BC.config.get('texts.appTitle')) + '</span>';
      navEl('').classList.add('tabbar--hidden');
      hideGear(true);
      main.className = 'main--parent';
      BC.renderParent(main, route.token, route.q);
      return;
    }

    main.className = '';
    var navItems = Object.keys(BC.pages)
      .filter(function (id) { return BC.pages[id].nav; })
      .sort(function (a, b) { return (BC.pages[a].order || 99) - (BC.pages[b].order || 99); })
      .map(function (id) {
        var p = BC.pages[id];
        var icon = BC.icons[TAB_ICONS[id]] || BC.icons.shuttle;
        return '<a class="tabbar__item' + (id === pageId ? ' tabbar__item--on' : '') + '" href="#/' + id + '">' +
          '<span class="tabbar__icon">' + icon(23) + '</span>' +
          '<span class="tabbar__label">' + esc(p.title) + '</span>' +
        '</a>';
      }).join('');

    document.getElementById('app-title').innerHTML =
      BC.icons.shuttle(22) +
      '<span>' + esc(BC.config.get('texts.appTitle')) + '</span>' +
      '<span class="topbar__sub">' + esc(BC.config.get('texts.appSlogan')) + '</span>';
    navEl(navItems).classList.remove('tabbar--hidden');
    hideGear(false);

    var page = BC.pages[pageId];
    if (page && page.render) page.render(main);
    else main.innerHTML = '<div class="page"><h2>页面还没做</h2></div>';
  }

  /* ---------- 教练端密码门 ---------- */
  function ensureAdmin(next) {
    if (global.sessionStorage.getItem(ADMIN_FLAG) === '1') { next(); return; }

    var pwd = BC.config.get('misc.adminPassword');
    var main = document.getElementById('app-main');
    main.className = '';
    // 还没进门禁，先把标签栏和齿轮收起来，别露出一条空栏
    navEl('').classList.add('tabbar--hidden');
    hideGear(true);
    main.innerHTML =
      '<div class="gate">' +
        '<div class="gate__box">' +
          '<div class="gate__logo">' + BC.icons.shuttle(56) + '</div>' +
          '<h2 class="gate__title">' + esc(BC.config.get('texts.appTitle')) + '</h2>' +
          '<p class="muted">' + esc(BC.config.get('texts.appSlogan')) + '</p>' +
          '<input id="gate-pwd" class="input" type="password" placeholder="教练管理密码" autocomplete="off">' +
          '<button class="btn btn--primary btn--block" id="gate-ok">进入</button>' +
          '<p class="muted hint">初始密码 ' + esc(pwd) + '，进去后可在「设置」里改。</p>' +
        '</div>' +
      '</div>';

    function tryEnter() {
      if (document.getElementById('gate-pwd').value !== pwd) {
        BC.ui.toast('密码不对', 'danger');
        return;
      }
      global.sessionStorage.setItem(ADMIN_FLAG, '1');
      next();
    }

    document.getElementById('gate-ok').addEventListener('click', tryEnter);
    document.getElementById('gate-pwd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryEnter();
    });
    document.getElementById('gate-pwd').focus();
  }

  /* ---------- 启动 ---------- */
  function route() {
    var r = parseRoute();
    if (r.kind === 'parent') renderShell(r);
    else ensureAdmin(function () { renderShell(r); });
  }

  function boot() {
    BC.config.load();
    global.addEventListener('hashchange', route);
    // 右上角齿轮 → 设置页
    var gear = document.getElementById('btn-settings');
    if (gear) {
      gear.innerHTML = BC.icons.gear(20);
      gear.addEventListener('click', function () { location.hash = '#/settings'; });
    }
    route();
    global.BC = BC;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
