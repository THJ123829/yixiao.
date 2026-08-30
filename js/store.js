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
        cloud.push(key, row);
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
        if (hit) cloud.push(key, hit);
        return hit;
      },

      remove: function (id) {
        var arr = readTable(key).filter(function (r) { return r.id !== id; });
        writeTable(key, arr);
        cloud.removeRow(key, id);
        return true;
      },

      replaceAll: function (arr) {
        writeTable(key, arr);
        (arr || []).forEach(function (row) { cloud.push(key, row); });
      }
    };
  }

  /* ============================================================
   * 家长链接的"快照"打包：把孩子的资料和课表压进网址
   *
   * 为什么用 base64 而不是 encodeURIComponent：后者会把一个汉字变成 9 个字符
   * （"小" → %E5%B0%8F），base64 只占 4 个，中文内容能省一半以上。
   * 再加上只保留家长端真正用得上的字段，链接长度能压到原来的 1/3 左右。
   *
   * 两个字段不能省：
   *   status     —— 提醒判断要用（不是"在读"就一条提醒都不显示）
   *   notifiedAt —— "超时默认确认"要用（丢了会一直显示成待确认）
   * ============================================================ */
  function studentLessons(student) {
    return store.lessons.all().filter(function (l) {
      return (l.studentIds || []).indexOf(student.id) >= 0;
    });
  }

  // UTF-8 → base64 → URL 安全字符（避免 + / = 在网址里出问题）
  function utf8ToUrlB64(str) {
    var bytes, i, c;
    if (global.TextEncoder) {
      bytes = new global.TextEncoder().encode(str);
    } else {
      bytes = [];
      for (i = 0; i < str.length; i++) {
        c = str.charCodeAt(i);
        if (c < 128) bytes.push(c);
        else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
        else bytes.push(224 | c >> 12, 128 | (c >> 6) & 63, 128 | c & 63);
      }
    }
    var bin = '';
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function encodeSnapshot(student, lessons) {
    var pack = {
      // s = 学员；字段名压到 1~2 个字母，链接短很多
      s: {
        i: student.id, n: student.name, a: student.age, c: student.courseType,
        r: student.remainingLessons, v: student.validUntil, st: student.status
      },
      // l = 这个孩子要上的课
      l: lessons.map(function (l) {
        var o = {
          i: l.id, d: l.date, s: l.slotId, c: l.courtId,
          y: l.courseType, st: l.status, m: l.isMakeup ? 1 : 0
        };
        var f = (l.confirmations || {})[student.id];
        if (f) o.f = f;            // 只带这个孩子自己的确认状态
        // 时间戳存成毫秒数字，比 ISO 字符串（24 字符）短很多
        if (l.notifiedAt) o.n = new Date(l.notifiedAt).getTime();
        return o;
      }),
      // sl = 时段档位、ct = 场地：家长手机上没有教练改过的配置，
      // 必须把这两项一起打包，家长端才不会显示成默认时间（钟点不符的坑）。
      // 链接只多一点点，但能保证家长看到的时间和教练完全一致。
      sl: BC.config.get('schedule.timeSlots'),
      ct: BC.config.get('schedule.courts')
    };
    return utf8ToUrlB64(JSON.stringify(pack));
  }

  BC.encodeSnapshot = encodeSnapshot;   // 供测试与复用
  BC.studentLessons = studentLessons;

  /* ============================================================
   * 云端同步（Supabase，可选）
   *
   * 工作方式：本机照常读写（界面立刻有反应），同时把改动推到云端；
   *          打开页面时再从云端把最新数据拉回来覆盖本机。
   * 没配置或断网时：静默降级成本地模式，功能不受影响。
   *
   * 云端只存一张表 bc_rows(id, tbl, data)，一行 = 一条记录，
   * 这样家长改自己那节课的确认状态，不会把你别的课覆盖掉。
   * ============================================================ */
  var cloud = BC.cloud = {

    // 推到云端的学生记录只保留「家长端展示需要」的字段，
    // 家长电话 / 家长姓名等隐私不下云端，避免被整表拉走泄露全班。
    sanitize: function (row) {
      if (!row) return row;
      var keep = ['id', 'name', 'age', 'courseType', 'remainingLessons',
        'validUntil', 'status', 'token', 'createdAt', 'avatar', 'gender'];
      var out = {};
      keep.forEach(function (f) { if (row[f] != null) out[f] = row[f]; });
      return out;
    },

    on: function () {
      var d = (BC.config && BC.config.get('deploy')) || {};
      return !!(d.supabaseUrl && d.supabaseKey);
    },

    cfg: function () {
      var d = (BC.config && BC.config.get('deploy')) || {};
      return {
        url: String(d.supabaseUrl || '').replace(/\/+$/, ''),
        key: String(d.supabaseKey || '').trim()
      };
    },

    headers: function (extra) {
      var h = {
        'apikey': cloud.cfg().key,
        'Authorization': 'Bearer ' + cloud.cfg().key,
        'Content-Type': 'application/json'
      };
      if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
      return h;
    },

    // 取某个表的全部记录
    pull: function (tbl, cb) {
      if (!cloud.on()) { cb(new Error('未启用'), null); return; }
      fetch(cloud.cfg().url + '/rest/v1/bc_rows?select=data&tbl=eq.' + encodeURIComponent(tbl), {
        headers: cloud.headers()
      }).then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
      }).then(function (rows) {
        cb(null, (rows || []).map(function (r) { return r.data; }));
      }).catch(function (e) { cb(e, null); });
    },

    // 家长端专用：先凭口令找到这个孩子，再把课表/填报/申请整张拉回来。
    // 注意：拉回来的是「全表」，里面只含 courseType、日期、时段、场地、学员 id 这些，
    // 不含学员姓名和家长电话，所以下到家长手机上也不会泄密；
    // 真正按孩子过滤显示，是在 page-parent.js 里用 student.id 做的。
    // 家长端专用：只取「这一个孩子」相关的数据。
    // 关键安全点：用口令在云端服务端过滤（data->>token=eq.xxx），
    // 只把这一条孩子记录回传，家长手机不会下载到全班名单和家长电话。
    pullParent: function (token, cb) {
      if (!cloud.on()) { cb(new Error('未启用'), null); return; }
      var base = cloud.cfg().url + '/rest/v1/bc_rows?';

      function get(qs) {
        return fetch(base + qs, { headers: cloud.headers() })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); });
      }

      // 1) 云端按口令过滤，只取回这一个孩子
      get('select=data&tbl=eq.students&data->>token=eq.' + encodeURIComponent(token))
        .then(function (rows) {
          var stu = (rows || [])[0];
          if (!stu) { cb(null, null); return; }
          // 2) 课表 / 填报 / 申请 / 时段配置：这些不含姓名和电话，整张拉回，
          //    家长端显示时再按自己孩子的 id 过滤，不会看到别人。
          return Promise.all([
            get('select=data&tbl=eq.lessons'),
            get('select=data&tbl=eq.intake'),
            get('select=data&tbl=eq.requests'),
            get('select=data&tbl=eq.meta')
          ]).then(function (all) {
            var meta = (all[3] || []).filter(function (r) { return r.data && r.data.id === 'schedule'; })[0];
            cb(null, {
              student: stu.data,
              lessons: (all[0] || []).map(function (r) { return r.data; }),
              intake: (all[1] || []).map(function (r) { return r.data; }),
              requests: (all[2] || []).map(function (r) { return r.data; }),
              meta: meta ? meta.data : null
            });
          });
        })
        .catch(function (e) { cb(e, null); });
    },

    // 推一条记录上云端（有就更新，没有就新增）
    push: function (tbl, row) {
      if (!cloud.on() || !row || !row.id) return;
      var data = (tbl === 'students') ? cloud.sanitize(row) : row;
      fetch(cloud.cfg().url + '/rest/v1/bc_rows', {
        method: 'POST',
        headers: cloud.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{ id: row.id, tbl: tbl, data: data, updated_at: new Date().toISOString() }])
      }).catch(function () { /* 断网就先存本地，下次打开会再拉齐 */ });
    },

    removeRow: function (tbl, id) {
      if (!cloud.on() || !id) return;
      fetch(cloud.cfg().url + '/rest/v1/bc_rows?id=eq.' + encodeURIComponent(id) +
        '&tbl=eq.' + encodeURIComponent(tbl), {
        method: 'DELETE', headers: cloud.headers()
      }).catch(function () {});
    },

    // 教练端：把云端数据整体拉回本机（四个表）
    pullAll: function (cb) {
      if (!cloud.on()) { cb && cb(new Error('未启用')); return; }
      var tables = ['students', 'lessons', 'intake', 'requests'];
      var done = 0, failed = 0;
      tables.forEach(function (t) {
        cloud.pull(t, function (err, rows) {
          done++;
          if (err) failed++;
          else writeTable(KEYS[t], rows || []);
          if (done === tables.length) cb && cb(failed ? new Error('部分拉取失败') : null);
        });
      });
    },

    // 把本机全部数据推上云端（首次启用云端时用）
    pushAll: function (cb) {
      if (!cloud.on()) { cb && cb(new Error('未启用')); return; }
      var payload = [];
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        readTable(KEYS[t]).forEach(function (row) {
          var data = (t === 'students') ? cloud.sanitize(row) : row;
          payload.push({ id: row.id, tbl: t, data: data, updated_at: new Date().toISOString() });
        });
      });
      if (!payload.length) { cb && cb(null); return; }
      fetch(cloud.cfg().url + '/rest/v1/bc_rows', {
        method: 'POST',
        headers: cloud.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload)
      }).then(function (r) {
        cb && cb(r.ok ? null : new Error('HTTP ' + r.status));
      }).catch(function (e) { cb && cb(e); });
    },

    // 把「时段档位 + 场地」这张小表推上云端。配置里含教练密码，不能整张同步，
    // 只同步家长端显示要用的时段和场地，免得家长端看到的是默认时间。
    pushMeta: function () {
      if (!cloud.on()) return;
      cloud.push('meta', {
        id: 'schedule',
        timeSlots: BC.config.get('schedule.timeSlots'),
        courts: BC.config.get('schedule.courts')
      });
    }
  };

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
      // 接了云端：链接只带口令就行（家长打开时从云端取自己的数据），
      // 链接很短，也不像一串乱码。
      if (BC.cloud && BC.cloud.on()) return href;

      // 没接云端：把孩子的资料 + 属于他的课表「打包」进链接，
      // 这样家长用任何手机打开都能看到自己孩子——不用服务器、不花钱。
      try {
        href += '?d=c1' + encodeSnapshot(student, studentLessons(student));
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

    /* 把云端拉回来的记录并入本机（不回推云端，免得无谓地写来写去）。
     * 课表那一栏特殊照顾：本机有确认状态而云端没有时，保留本机的——
     * 可能是家长断网时点的确认，还没推上去。 */
    mergeIn: function (key, rows) {
      var arr = readTable(key);
      (rows || []).forEach(function (r) {
        var idx = -1;
        for (var k = 0; k < arr.length; k++) {
          if (arr[k].id === r.id) { idx = k; break; }
        }
        var merged = r;
        if (idx >= 0 && key === KEYS.lessons) {
          var local = arr[idx];
          var localHas = local.confirmations && Object.keys(local.confirmations).length > 0;
          var cloudHas = r.confirmations && Object.keys(r.confirmations).length > 0;
          if (localHas && !cloudHas) {
            merged = Object.assign({}, r, { confirmations: local.confirmations });
          }
        } else if (idx >= 0 && key === KEYS.students) {
          // 云端学生记录是脱敏的（无家长电话等），merge 时保留本机已有的隐私字段，
          // 免得教练端 pullAll 之后把本机的家长电话清掉。
          var keepLocal = {};
          ['parentPhone', 'parentName', 'note'].forEach(function (f) {
            if (arr[idx] && arr[idx][f] != null && arr[idx][f] !== '' && !(f in r)) keepLocal[f] = arr[idx][f];
          });
          merged = Object.assign({}, r, keepLocal);
        }
        if (idx >= 0) arr[idx] = merged;
        else arr.push(merged);
      });
      writeTable(key, arr);
    },

    /* 清空全部业务数据（配置保留） */
    clearAll: function () {
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        writeTable(KEYS[t], []);
      });
    }
  };

})(window);
