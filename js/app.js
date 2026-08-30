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

    // 接了云端就把最新数据拉回来再重画一次。
    // 家长端不拉全部——只拉自己孩子的（见 page-parent.js），免得全班信息下到别人手机上。
    var isParent = /^#\/parent\//.test(global.location.hash || '');
    if (!isParent && BC.cloud && BC.cloud.on()) {
      // 时段/场地这张小表也推上去，家长端才能显示和教练一致的时间
      BC.cloud.pushMeta();
      BC.cloud.pullAll(function () { route(); });
      startAutoRefresh();
    }
    global.BC = BC;
  }

  /* ---------- 教练端自动刷新 ----------
   * 解决的问题：家长在手机上点了「确认参加」，你这边不手动刷新就看不到。
   * 做法：每隔一段时间悄悄去云端拉一次，数据真的变了才重画页面。
   * 几条防打扰的规矩：
   *   · 页面切到后台（你去看微信了）就暂停，省流量省电；切回来立刻拉一次
   *   · 只有数据真的变了才重画，不然你正在看的页面会莫名跳一下
   *   · 正在填写表单（弹窗打开、输入框有焦点）时跳过这一轮，绝不把你打的字冲掉
   * 间隔可在「设置」的 deploy.autoRefreshSec 改，填 0 就是关掉。 */
  var refreshTimer = null;
  var lastFingerprint = '';

  function dataFingerprint() {
    try {
      var K = BC.store.KEYS;
      // 只看会被家长改到的三张表：课表（确认状态）、填报、请假调课申请
      return [K.lessons, K.intake, K.requests].map(function (k) {
        return (global.localStorage.getItem(k) || '').length;
      }).join('|') + '#' + JSON.stringify(BC.store.lessons.all().map(function (l) {
        return l.id + ':' + (l.status || '') + ':' + Object.keys(l.confirmations || {}).length;
      }));
    } catch (e) { return ''; }
  }

  function busyEditing() {
    // 有弹窗开着，或光标正在输入框里 → 这一轮别动
    if (document.querySelector('.modal, .sheet, dialog[open]')) return true;
    var a = document.activeElement;
    if (!a) return false;
    var t = (a.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select';
  }

  function tick() {
    if (document.hidden) return;
    if (busyEditing()) return;
    if (/^#\/parent\//.test(global.location.hash || '')) return;
    BC.cloud.pullAll(function (err) {
      if (err) return;                       // 拉失败就安静等下一轮，不弹错误烦人
      var fp = dataFingerprint();
      if (fp && fp !== lastFingerprint) {
        lastFingerprint = fp;
        route();                             // 数据真变了才重画
      }
    });
  }

  function startAutoRefresh() {
    var sec = BC.config.get('deploy.autoRefreshSec');
    sec = (sec == null) ? 30 : Number(sec);
    lastFingerprint = dataFingerprint();
    if (refreshTimer) { global.clearInterval(refreshTimer); refreshTimer = null; }
    if (!sec || sec < 5) return;             // 填 0（或小于 5 秒）就是关掉
    refreshTimer = global.setInterval(tick, sec * 1000);
    // 从后台切回前台时立刻拉一次，不用干等一个周期
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
