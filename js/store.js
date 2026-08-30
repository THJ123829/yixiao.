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

  // 本地存储键（bc.students.v1）→ 云端逻辑表名（students）。
  // 一定要分清两者：云端表名是 Supabase 里 tbl 字段的值，不能直接拿 storage 的 key 去用，
  // 否则学员会被存到 tbl='bc.students.v1'，家长端按 tbl='students' 查就永远查不到 → 链接显示无效。
  function tblOf(key) { return key.replace(/^bc\./, '').replace(/\.v1$/, ''); }

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

  /* 写进本机之前，把日期字段统一成 'YYYY-MM-DD'。
   * 为什么一定要做：周汇总、排课冲突检测、到期提醒都是把日期当「字符串」直接比大小的。
   * 库里一旦混进 '2026/9/1'、'20260901' 这种写法（手动填或 Excel 导入很容易出现），
   * 比较结果就全乱了 —— 明明有课却算成没课，明明快到期却不提醒。
   * 扩展：字段名是 date，或以 Date / At / Monday / Until / From / To 结尾的，都会自动规整，
   *      以后新增日期字段不用回来改这里。含 'T' 的完整时间戳（createdAt）不动，免得被截断。 */
  function normalizeDates(row) {
    if (!row || typeof row !== 'object') return row;
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (typeof v !== 'string' || !v) return;
      if (v.indexOf('T') >= 0) return;
      if (!/^(date|.*(Date|At|Monday|Until|From|To))$/.test(k)) return;
      var n = util.normalizeISO(v);
      if (n && n !== v) row[k] = n;
    });
    return row;
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
        var row = normalizeDates(util.deepClone(record));
        if (!row.id) row.id = util.uid(key.split('.')[1].replace(/s$/, ''));
        row.createdAt = new Date().toISOString();
        arr.push(row);
        writeTable(key, arr);
        cloud.push(tblOf(key), row);
        return row;
      },

      update: function (id, patch) {
        var arr = readTable(key);
        var hit = null;
        arr = arr.map(function (r) {
          if (r.id !== id) return r;
          hit = normalizeDates(Object.assign({}, r, patch, { updatedAt: new Date().toISOString() }));
          return hit;
        });
        writeTable(key, arr);
        if (hit) cloud.push(tblOf(key), hit);
        return hit;
      },

      remove: function (id) {
        var arr = readTable(key).filter(function (r) { return r.id !== id; });
        writeTable(key, arr);
        cloud.removeRow(tblOf(key), id);
        return true;
      },

      replaceAll: function (arr) {
        var rows = (arr || []).map(function (r) { return normalizeDates(util.deepClone(r)); });
        writeTable(key, rows);
        rows.forEach(function (row) { cloud.push(tblOf(key), row); });
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

    // 隐私字段清单（配置里可改）。不写在代码里，是为了以后加了新字段
    // 只需在「设置」的 noCloudFields 里登记，不用改代码。
    noCloudFields: function () {
      var d = (BC.config && BC.config.get('deploy')) || {};
      var arr = d.noCloudFields;
      if (!arr || !arr.length) arr = ['parentName', 'parentPhone', 'note'];
      return arr;
    },

    // 推到云端的学生记录要「脱敏」：家长电话 / 家长姓名 / 备注等隐私不上云端，
    // 避免被整表拉走泄露全班。
    // 这里用「排除清单」而不是「保留清单」——因为项目约定是「往 studentFields
    // 加一行就自动长出新字段」，用保留清单会让新字段悄悄同步不上去，家长端看不到。
    sanitize: function (row) {
      if (!row) return row;
      var drop = cloud.noCloudFields();
      var out = {};
      Object.keys(row).forEach(function (f) {
        if (drop.indexOf(f) < 0) out[f] = row[f];
      });
      return out;
    },

    on: function () {
      var d = (BC.config && BC.config.get('deploy')) || {};
      return !!(d.supabaseUrl && d.supabaseKey);
    },

    cfg: function () {
      var d = (BC.config && BC.config.get('deploy')) || {};
      // 容错：用户可能贴 "https://xxx.supabase.co"，也可能误贴成 ".../rest/v1"。
      // 两种都规整成纯净项目地址，避免拼出 ".../rest/v1/rest/v1/..." 这种 Supabase 会报 PGRST125 的路径。
      var url = String(d.supabaseUrl || '').trim()
        .replace(/\/rest\/v1\/?$/i, '')
        .replace(/\/+$/, '');
      return {
        url: url,
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
        if (r.ok) return r.json();
        return r.text().then(function (t) { return Promise.reject(new Error('HTTP ' + r.status + '：' + t)); });
      }).then(function (rows) {
        cb(null, (rows || []).map(function (r) { return r.data; }));
      }).catch(function (e) { cb(e, null); });
    },

    // 家长端专用：凭口令找到这个孩子，再把课表/填报/申请/时段配置拉回来。
    // 取数策略（双保险）：
    //   1) 先试服务端按口令过滤（data->>token=eq.xxx）——隐私最好，只回传自己那条；
    //   2) 若服务端过滤没命中（某些环境对 jsonb 操作符解析不稳），兜底拉全部学员，
    //      在客户端按 token 挑出自己那条。云端学员数据已脱敏（无家长电话），这样也安全。
    pullParent: function (token, cb) {
      if (!cloud.on()) { cb(new Error('未启用'), null); return; }
      var base = cloud.cfg().url + '/rest/v1/bc_rows?';

      function get(qs) {
        return fetch(base + qs, { headers: cloud.headers() })
          .then(function (r) { if (r.ok) return r.json(); return r.text().then(function (t) { return Promise.reject(new Error('HTTP ' + r.status + '：' + t)); }); });
      }

      function loadRest(cbRest) {
        Promise.all([
          get('select=data&tbl=eq.lessons'),
          get('select=data&tbl=eq.intake'),
          get('select=data&tbl=eq.requests'),
          get('select=data&tbl=eq.meta')
        ]).then(function (all) {
          var meta = (all[3] || []).filter(function (r) { return r.data && r.data.id === 'schedule'; })[0];
          cbRest({
            lessons: (all[0] || []).map(function (r) { return r.data; }),
            intake: (all[1] || []).map(function (r) { return r.data; }),
            requests: (all[2] || []).map(function (r) { return r.data; }),
            meta: meta ? meta.data : null
          });
        }).catch(function (e) { cb(e, null); });
      }

      function done(stu) {
        if (!stu) { cb(null, null); return; }
        loadRest(function (rest) { cb(null, Object.assign({ student: stu }, rest)); });
      }

      // 2) 兜底：拉全部学员，客户端按 token 挑自己那条
      function fallback() {
        get('select=data&tbl=eq.students').then(function (all) {
          var st = (all || []).map(function (r) { return r.data; })
            .filter(function (s) { return s && s.token === token; })[0];
          done(st || null);
        }).catch(function (e) { cb(e, null); });
      }

      // 1) 先试服务端按口令过滤（隐私更好，只回传自己那条）。
      //    注意：这个 jsonb 过滤在某些 Supabase / PostgREST 版本会直接报 400，
      //    所以「没命中」和「报错」都必须转去走兜底，不能报错就放弃 —— 否则
      //    家长端会莫名显示打不开。
      get('select=data&tbl=eq.students&data->>token=eq.' + encodeURIComponent(token))
        .then(function (rows) {
          var stu = (rows || [])[0];
          if (stu && stu.data) { done(stu.data); return; }
          fallback();
        })
        .catch(function () { fallback(); });
    },

    // 上一次同步失败的原因。原来是「失败了什么都不说」，教练以为存好了其实没上去，
    // 这是最坑的一种情况，所以记下来，首页/设置页可以拿去提示。
    lastError: '',

    // 推一条记录上云端（有就更新，没有就新增）。cb 可选。
    push: function (tbl, row, cb) {
      if (!cloud.on() || !row || !row.id) { cb && cb(null); return; }
      var data = (tbl === 'students') ? cloud.sanitize(row) : row;
      fetch(cloud.cfg().url + '/rest/v1/bc_rows', {
        method: 'POST',
        headers: cloud.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{ id: row.id, tbl: tbl, data: data, updated_at: new Date().toISOString() }])
      }).then(function (r) {
        if (r.ok) { cloud.lastError = ''; cb && cb(null); return; }
        return r.text().then(function (t) {
          var e = new Error('HTTP ' + r.status + '：' + t);
          cloud.lastError = e.message; cb && cb(e);
        });
      }).catch(function (e) {
        // 断网就先存本地，下次打开会再拉齐；但要留痕，别装作成功
        cloud.lastError = (e && e.message) || '网络不通';
        cb && cb(e);
      });
    },

    removeRow: function (tbl, id, cb) {
      if (!cloud.on() || !id) { cb && cb(null); return; }
      fetch(cloud.cfg().url + '/rest/v1/bc_rows?id=eq.' + encodeURIComponent(id) +
        '&tbl=eq.' + encodeURIComponent(tbl), {
        method: 'DELETE', headers: cloud.headers()
      }).then(function (r) {
        if (r.ok) { cb && cb(null); return; }
        return r.text().then(function (t) {
          var e = new Error('HTTP ' + r.status + '：' + t);
          cloud.lastError = e.message; cb && cb(e);
        });
      }).catch(function (e) {
        cloud.lastError = (e && e.message) || '网络不通';
        cb && cb(e);
      });
    },

    // 教练端：把云端数据整体拉回本机（四个表）。
    // 关键：学员表不能直接整表覆盖！云端那份是脱敏的（没有家长手机号 / 备注），
    // 直接盖上去会把你本机的家长电话和备注全部清空 —— 数据就真丢了。
    // 所以学员表走「以云端为准 + 保住本机隐私字段」的合并方式。
    pullAll: function (cb) {
      if (!cloud.on()) { cb && cb(new Error('未启用')); return; }
      var tables = ['students', 'lessons', 'intake', 'requests'];
      var done = 0, failed = 0, firstErr = null;
      tables.forEach(function (t) {
        cloud.pull(t, function (err, rows) {
          done++;
          if (err) { failed++; firstErr = firstErr || err; }
          else if (t === 'students') store.syncStudentsIn(rows || []);
          else if (t === 'lessons') store.syncLessonsIn(rows || []);
          else writeTable(KEYS[t], rows || []);
          if (done === tables.length) {
            if (failed) cloud.lastError = (firstErr && firstErr.message) || '部分拉取失败';
            else cloud.lastError = '';
            cb && cb(failed ? (firstErr || new Error('部分拉取失败')) : null);
          }
        });
      });
    },

    // 把本机全部数据推上云端（首次启用云端时用）。
    // cb(err, count)：count = 这次实际上传了多少条。
    // 为什么要回传条数：本机一条数据都没有时，以前也报"上传成功"，
    // 让人误以为已经传上去了 —— 其实是一条都没传，白等半天。
    pushAll: function (cb) {
      if (!cloud.on()) { cb && cb(new Error('未启用'), 0); return; }
      var payload = [];
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        readTable(KEYS[t]).forEach(function (row) {
          var data = (t === 'students') ? cloud.sanitize(row) : row;
          payload.push({ id: row.id, tbl: t, data: data, updated_at: new Date().toISOString() });
        });
      });
      if (!payload.length) { cb && cb(null, 0); return; }
      fetch(cloud.cfg().url + '/rest/v1/bc_rows', {
        method: 'POST',
        headers: cloud.headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (r.ok) { cloud.lastError = ''; cb && cb(null, payload.length); return; }
        return r.text().then(function (t) {
          var e = new Error('HTTP ' + r.status + '：' + t);
          cloud.lastError = e.message;
          cb && cb(e, 0);
        });
      }).catch(function (e) {
        cloud.lastError = (e && e.message) || '网络不通';
        cb && cb(e, 0);
      });
    },

    // 把「时段档位 + 场地」这张小表推上云端。配置里含教练密码，不能整张同步，
    // 只同步家长端显示要用的时段和场地，免得家长端看到的是默认时间。
    /* 云端自检：家长链接到底能不能只发「短链接」？
     * 判断标准不是"云端配了没有"，而是「站在家长的角度，真的能凭口令读到孩子」。
     * 所以这里真去拉一次学员表，一个个孩子核对。
     * 回调 cb(null, {
     *   on          云端有没有配
     *   readable    云端读得通吗（权限 / 网络）
     *   cloudTokens 云端已经能查到的口令集合 —— 只有在这里面的孩子才敢发短链接
     *   allFound    本机所有孩子都能查到吗
     *   missing     查不到的孩子姓名（用来提示你去补传）
     *   error       读失败时的技术原因
     * })
     * 注意：刚建好还没生成过链接的孩子是没有口令的，这种不算"漏传"——
     * 你点生成链接时才会给它配口令并自动上云，那一条这次就先用长链接。 */
    selfCheck: function (cb) {
      var mine = readTable(KEYS.students);
      if (!cloud.on()) {
        cb(null, { on: false, readable: false, cloudTokens: {}, allFound: false, missing: [], error: '' });
        return;
      }
      cloud.pull('students', function (err, rows) {
        if (err) {
          cb(null, { on: true, readable: false, cloudTokens: {}, allFound: false, missing: [], error: err.message || '读取失败' });
          return;
        }
        var byId = {}, tokens = {};
        (rows || []).forEach(function (r) {
          if (!r || !r.id) return;
          byId[r.id] = r;
          if (r.token) tokens[r.token] = 1;
        });
        var missing = mine.filter(function (s) {
          var c = byId[s.id];
          if (!c) return true;                                  // 云端根本没这条 → 漏传了
          if (s.token && c.token !== s.token) return true;       // 云端存的是旧口令 → 短链接会打不开
          return false;
        }).map(function (s) { return s.name || s.id; });
        cb(null, {
          on: true, readable: true, cloudTokens: tokens,
          allFound: mine.length > 0 && missing.length === 0,
          missing: missing, error: ''
        });
      });
    },

    pushMeta: function (cb) {
      if (!cloud.on()) { cb && cb(null); return; }
      cloud.push('meta', {
        id: 'schedule',
        timeSlots: BC.config.get('schedule.timeSlots'),
        courts: BC.config.get('schedule.courts')
      }, cb);
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
    /* 生成家长专属链接。
     * opts.short = true  → 只带口令的短链接（约 55 字符，家长看着正常，但必须云端读得通）
     * 默认（不传 opts）   → 短链接 + 把孩子资料和课表打包进 ?d=（约 1100 字符，
     *                      云端读不通也一定打得开）
     * 「家长链接」页会先自动测一下云端通不通，通就发短的，不通就发长的，你不用管。 */
    parentLink: function (student, regen, opts) {
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
      if (opts && opts.short) return href;
      // 把孩子的资料 + 课表「打包」进 ?d= 作为兜底——这样即使云端 SELECT 取不到
      // （权限/网络问题），家长端也能从链接里直接解出自己孩子的课表，保证一定打得开。
      // 家长端仍会优先用云端（数据更及时），云端取不到才退回链接里这份。
      try {
        href += '?d=c1' + encodeSnapshot(student, studentLessons(student));
      } catch (e) { /* 打包失败就只有 token，只能依赖云端 */ }
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
          var privFields = (BC.cloud && BC.cloud.noCloudFields()) || ['parentPhone', 'parentName', 'note'];
          privFields.forEach(function (f) {
            if (arr[idx] && arr[idx][f] != null && arr[idx][f] !== '' && !(f in r)) keepLocal[f] = arr[idx][f];
          });
          merged = Object.assign({}, r, keepLocal);
        }
        if (idx >= 0) arr[idx] = merged;
        else arr.push(merged);
      });
      writeTable(key, arr);
    },

    /* 从云端整表同步「学员」回本机：以云端为准，但本机的隐私字段（家长手机号、
     * 备注等，云端根本没存）必须保住，不能被清空。
     * 防呆：云端一条都没返回、而本机有数据时，判定为异常（权限没配好 / 数据还没上传），
     *       宁可这次不同步，也绝不把你本机的学员清空。 */
    syncStudentsIn: function (rows) {
      var key = KEYS.students;
      var local = readTable(key);
      rows = rows || [];
      if (!rows.length) { if (local.length) return; writeTable(key, []); return; }
      var drop = (BC.cloud && BC.cloud.noCloudFields()) || ['parentName', 'parentPhone', 'note'];
      var byId = {};
      local.forEach(function (s) { byId[s.id] = s; });
      var out = rows.map(function (r) {
        var mine = byId[r.id];
        if (!mine) return r;
        var keep = {};
        drop.forEach(function (f) {
          // 只在「云端没这个字段」时才用本机的，避免把云端的新值顶掉
          if (mine[f] != null && mine[f] !== '' && !(f in r)) keep[f] = mine[f];
        });
        return Object.assign({}, r, keep);
      });
      // 本机有、云端没有的（还没上传成功的新学员）先留着，免得白建一遍
      var cloudIds = {};
      out.forEach(function (s) { cloudIds[s.id] = 1; });
      local.forEach(function (s) { if (!cloudIds[s.id]) out.push(s); });
      writeTable(key, out);
    },

    /* 从云端整表同步「课表」回本机：本机有家长确认、云端还没有的，保住本机那份
     * （家长断网时点的确认，还没推上去）。同样带空数组防呆。 */
    syncLessonsIn: function (rows) {
      var key = KEYS.lessons;
      var local = readTable(key);
      rows = rows || [];
      if (!rows.length) { if (local.length) return; writeTable(key, []); return; }
      var byId = {};
      local.forEach(function (l) { byId[l.id] = l; });
      var out = rows.map(function (r) {
        var mine = byId[r.id];
        if (!mine) return r;
        var localHas = mine.confirmations && Object.keys(mine.confirmations).length > 0;
        var cloudHas = r.confirmations && Object.keys(r.confirmations).length > 0;
        if (localHas && !cloudHas) return Object.assign({}, r, { confirmations: mine.confirmations });
        return r;
      });
      var cloudIds = {};
      out.forEach(function (l) { cloudIds[l.id] = 1; });
      local.forEach(function (l) { if (!cloudIds[l.id]) out.push(l); });
      writeTable(key, out);
    },

    /* 清空全部业务数据（配置保留） */
    clearAll: function () {
      ['students', 'lessons', 'intake', 'requests'].forEach(function (t) {
        writeTable(KEYS[t], []);
      });
    }
  };

})(window);
