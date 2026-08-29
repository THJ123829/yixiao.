/* 最底层：命名空间 + 通用工具（日期计算、编号生成等），不依赖任何其他文件。 */
(function (global) {
  'use strict';

  var BC = global.BC || (global.BC = {});

  BC.version = '1.0.0';

  /* 页面注册表：新增页面只需 registerPage 一次，导航会自动出现 */
  BC.pages = {};
  BC.registerPage = function (id, def) {
    def.id = id;
    BC.pages[id] = def;
  };

  /* ---------- 工具函数 ---------- */
  var util = BC.util = {};

  util.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  util.uid = function (prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  // 日期统一用 'YYYY-MM-DD' 字符串存，避免时区把日期算错一天
  util.toISO = function (d) {
    return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
  };

  util.parseISO = function (iso) {
    var p = String(iso || '').split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };

  util.todayISO = function () { return util.toISO(new Date()); };

  util.addDays = function (iso, n) {
    var d = util.parseISO(iso);
    d.setDate(d.getDate() + n);
    return util.toISO(d);
  };

  util.addMonths = function (iso, n) {
    var d = util.parseISO(iso);
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return util.toISO(d);
  };

  // 距离今天还有几天（负数代表已经过去）
  util.daysUntil = function (iso) {
    var a = util.parseISO(util.todayISO()).getTime();
    var b = util.parseISO(iso).getTime();
    return Math.round((b - a) / 86400000);
  };

  // 0=周日 1=周一 ... 6=周六
  util.weekday = function (iso) { return util.parseISO(iso).getDay(); };

  var WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  util.weekdayCN = function (iso) { return WEEKDAY_CN[util.weekday(iso)]; };

  util.formatDateCN = function (iso) {
    var d = util.parseISO(iso);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAY_CN[d.getDay()];
  };

  util.isoToCN = function (iso) {
    var d = util.parseISO(iso);
    return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate());
  };

  // '08:30' <-> 510（分钟）
  util.hhmmToMinutes = function (s) {
    var p = String(s || '0:0').split(':');
    return Number(p[0]) * 60 + Number(p[1] || 0);
  };
  util.minutesToHHMM = function (m) {
    return util.pad2(Math.floor(m / 60)) + ':' + util.pad2(m % 60);
  };

  // 求某个日期所在那周的周一（一周从周一开始）
  util.mondayOf = function (iso) {
    var wd = util.weekday(iso);           // 0=周日
    var back = (wd === 0) ? 6 : wd - 1;   // 周一回退0天，周日回退6天
    return util.addDays(iso, -back);
  };

  util.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  util.deepClone = function (obj) {
    return JSON.parse(JSON.stringify(obj));
  };

})(window);
