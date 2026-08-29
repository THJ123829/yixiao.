/* 数据层：只负责存和取，不做业务判断（判断在 rules.js）。
 * 数据存在当前浏览器本地；换设备用「导出备份 / 导入备份」搬。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;

  var KEYS = {
    students: 'bc.students.v1',
    lessons: 'bc.lessons.v1',
    intake: 'bc.intake.v1',
    requests: 'bc.requests.v1'
  };

  /* ---------- 底层读写 ---------- */
  function readTable(key) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeTable(key, arr) {
    try {
      global.localStorage.setItem(key, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 通用增删改查 ---------- */
  function makeTable(key) {
    return {
      all: function () { return readTable(key); },

      find: function (id) {
        return readTable(key).filter(function (r) { return r.id === id; })[0] || null;
      },

      add: function (record) {
        var arr = readTable(key);
        var row = util.deepClone(record);
        if (!row.id) row.id = util.uid(key.split('.')[1].replace(/s$/, ''));
        row.createdAt = new Date().toISOString();
        arr.push(row);
        writeTable(key, arr);
        return row;
      },

      update: function (id, patch) {
        var arr = readTable(key);
        var hit = null;
        arr = arr.map(function (r) {
          if (r.id !== id) return r;
          hit = Object.assign({}, r, patch, { updatedAt: new Date().toISOString() });
          return hit;
        });
        writeTable(key, arr);
        return hit;
      },

      remove: function (id) {
        var arr = readTable(key).filter(function (r) { return r.id !== id; });
        writeTable(key, arr);
        return true;
      },

      replaceAll: function (arr) { writeTable(key, arr); }
    };
  }

  var store = BC.store = {
    KEYS: KEYS,
    students: makeTable(KEYS.students),
    lessons: makeTable(KEYS.lessons),
    intake: makeTable(KEYS.intake),
    requests: makeTable(KEYS.requests),

    /* 家长填报记录
     *   一条记录 = 某个学员 + 某一周 = 一串勾中的时段
     *   slots 存 '2026-09-07#am' 这种「日期#时段id」的键 */
    getIntake: function (studentId, weekMonday) {
      return store.intake.all().filter(function (r) {
        return r.studentId === studentId && r.weekMonday === weekMonday;
      })[0] || null;
    },

    saveIntake: function (studentId, weekMonday, slotKeys) {
      var payload = {
        studentId: studentId,
        weekMonday: weekMonday,
        slots: (slotKeys || []).slice(),
        submittedAt: new Date().toISOString()
      };
      var exist = store.getIntake(studentId, weekMonday);
      if (exist) return store.intake.update(exist.id, payload);
      return store.intake.add(payload);
    },

    // 某一周的全部填报（给 T3 时段汇总用）
    intakesOfWeek: function (weekMonday) {
      return store.intake.all().filter(function (r) { return r.weekMonday === weekMonday; });
    },

    /* 生成家长专属链接：一个学员一个网址，点开直接进自己孩子的页面，
     * 不用注册也不用密码。重生成口令后旧链接立刻失效。 */
    parentLink: function (student, regen) {
      if (!student.token || regen) {
        student.token = util.uid('tk');
        store.students.update(student.id, { token: student.token });
      }
      // 若已在「设置 → G · 上线与分享」里填了部署基地址，就生成指向那个地址的链接；
      // 否则用当前打开的网址（本地双击时就是 file://，部署后会自动变成你的网址）
      var base = (BC.config && BC.config.get('deploy.baseUrl') || '').trim();
      var href = (/^https?:\/\//.test(base))
        ? base.replace(/\/+$/, '') + '/#/parent/' + student.token
        : location.href.split('#')[0] + '#/parent/' + student.token;
      // v1 没有云数据库：把孩子的资料 + 属于他的课表「打包」进链接，
      // 这样家长用任何手机打开都能看到自己孩子——不用服务器、不花钱。
      try {
        var myLessons = store.lessons.all().filter(function (l) {
          return (l.studentIds || []).indexOf(student.id) >= 0;
        });
        var payload = { s: student, l: myLessons };
        href += '?d=' + encodeURIComponent(JSON.stringify(payload));
      } catch (e) { /* 打包失败就退回纯 token 链接（同浏览器内仍可用） */ }
      return href;
    },

    /* ---------- 备份：导出成一段文本，可存到别处 ---------- */
    exportAll: function () {
      return JSON.stringify({
        exportedAt: new Date().toISOString(),
        version: BC.version,
        config: BC.config.load(),
        students: readTable(KEYS.students),
        lessons: readTable(KEYS.lessons),
        intake: readTable(KEYS.intake),
        requests: readTable(KEYS.requests)
      }, null, 2);
    },

    /* ---------- 恢复：把导出的文本导回来 ---------- */
    importAll: function (jsonText) {
      var data = JSON.parse(jsonText);
      if (!data || typeof data !== 'object') throw new Error('文件格式不对');
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        if (Array.isArray(data[t])) writeTable(KEYS[t], data[t]);
      });
      return true;
    },

    /* 清空全部业务数据（配置保留） */
    clearAll: function () {
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        writeTable(KEYS[t], []);
      });
    }
  };

})(window);
