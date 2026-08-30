/* 学员档案：学员的增删改查、批量导入、导出备份。
 * 列表显示哪些列、表单有哪些框，全部由 config.studentFields 决定，
 * 加字段不用改这个文件。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var ui = BC.ui;
  var esc = util.escapeHtml;

  var keyword = '';   // 搜索关键词（模块内私有状态）

  function fields() { return BC.config.load().studentFields; }
  function listFields() { return fields().filter(function (f) { return f.list; }); }

  /* ---------- 取出要显示的学员（搜索 + 排序） ---------- */
  function visibleStudents() {
    var all = BC.store.students.all();
    var kw = keyword.trim();
    var arr = all.filter(function (s) {
      if (!kw) return true;
      return (s.name || '').indexOf(kw) >= 0 ||
             (s.parentName || '').indexOf(kw) >= 0 ||
             (String(s.parentPhone) || '').indexOf(kw) >= 0;
    });
    // 有提醒的排前面，方便你先处理
    return arr.sort(function (a, b) {
      var ra = BC.rules.getStudentReminders(a).length;
      var rb = BC.rules.getStudentReminders(b).length;
      return rb - ra;
    });
  }

  /* ---------- 渲染整个页面 ---------- */
  function render(root) {
    var rows = visibleStudents();

    var headHtml =
      '<div class="toolbar">' +
        '<input id="stu-search" class="input input--search" type="search" ' +
          'placeholder="搜姓名 / 家长 / 手机号" value="' + esc(keyword) + '">' +
        '<div class="toolbar__right">' +
          '<button class="btn btn--ghost" id="btn-tpl">下载模板</button>' +
          '<button class="btn btn--ghost" id="btn-import">批量导入</button>' +
          '<button class="btn btn--ghost" id="btn-export">导出备份</button>' +
          '<button class="btn btn--primary" id="btn-add">+ 新增学员</button>' +
        '</div>' +
      '</div>';

    var tableHtml;
    if (!rows.length) {
      tableHtml = ui.empty(
        '还没有学员',
        keyword ? '换个关键词试试' : '点右上角「新增学员」手动添加，或用「批量导入」一次性导入名单'
      );
    } else {
      var cols = listFields();
      var th = cols.map(function (f) {
        return '<th' + (f.width ? ' style="width:' + f.width + '"' : '') + '>' + esc(f.label) + '</th>';
      }).join('') + '<th style="width:210px">提醒 / 操作</th>';

      var tb = rows.map(function (s) {
        var tds = cols.map(function (f) {
          var v = s[f.key];
          if (f.key === 'validUntil') {
            var days = util.daysUntil(v);
            var cls = days < 0 ? 'cell-danger' : (days <= 14 ? 'cell-warn' : '');
            return '<td class="' + cls + '">' + esc(v) + '</td>';
          }
          if (f.key === 'remainingLessons') {
            var n = Number(v);
            var c = (n <= BC.config.get('reminder.lowBalanceThreshold')) ? 'cell-warn' : '';
            return '<td class="' + c + '"><b>' + esc(v) + '</b></td>';
          }
          return '<td>' + esc(v == null ? '' : v) + '</td>';
        }).join('');

        var rems = BC.rules.getStudentReminders(s);
        var badges = rems.length
          ? rems.map(function (r) { return ui.badge(r.text, r.level); }).join(' ')
          : '<span class="muted">—</span>';

        return '<tr data-id="' + s.id + '">' + tds +
          '<td class="cell-ops">' +
            '<div class="badges">' + badges + '</div>' +
            '<div class="ops">' +
              '<button class="linkbtn" data-act="edit">编辑</button>' +
              '<button class="linkbtn" data-act="share">家长链接</button>' +
              '<button class="linkbtn linkbtn--danger" data-act="del">删除</button>' +
            '</div>' +
          '</td></tr>';
      }).join('');

      tableHtml = '<div class="table-wrap"><table class="table"><thead><tr>' + th +
        '</tr></thead><tbody>' + tb + '</tbody></table></div>';
    }

    root.innerHTML =
      '<div class="page">' +
        '<div class="page__head">' +
          '<h2>学员档案</h2>' +
          '<p class="muted">共 ' + BC.store.students.all().length + ' 名学员' +
            (keyword ? '，筛出 ' + rows.length + ' 名' : '') + '</p>' +
        '</div>' +
        headHtml + tableHtml +
      '</div>';

    bindEvents(root);
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents(root) {
    var search = root.querySelector('#stu-search');
    if (search) {
      search.addEventListener('input', function () {
        keyword = search.value;
        var pos = search.selectionStart;
        render(root);
        var again = root.querySelector('#stu-search');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
    }

    var addBtn = root.querySelector('#btn-add');
    if (addBtn) addBtn.addEventListener('click', function () { openEditor(root, null); });

    var tplBtn = root.querySelector('#btn-tpl');
    if (tplBtn) tplBtn.addEventListener('click', downloadTemplate);

    var impBtn = root.querySelector('#btn-import');
    if (impBtn) impBtn.addEventListener('click', function () { openImportModal(root); });

    var expBtn = root.querySelector('#btn-export');
    if (expBtn) expBtn.addEventListener('click', exportBackup);

    // 表格里的编辑 / 家长链接 / 删除
    root.querySelectorAll('tbody tr').forEach(function (tr) {
      var id = tr.getAttribute('data-id');
      tr.querySelector('[data-act="edit"]').addEventListener('click', function () {
        openEditor(root, id);
      });
      tr.querySelector('[data-act="share"]').addEventListener('click', function () {
        shareLink(id);
      });
      tr.querySelector('[data-act="del"]').addEventListener('click', function () {
        var s = BC.store.students.find(id);
        ui.confirm('确定删除学员「' + (s ? s.name : '') + '」吗？删掉就找不回来了。', function () {
          BC.store.students.remove(id);
          ui.toast('已删除');
          render(root);
        });
      });
    });
  }

  /* ---------- 新增 / 编辑弹窗 ---------- */
  function openEditor(root, id) {
    var editing = id ? BC.store.students.find(id) : null;
    var cfg = BC.config.load();
    var values = editing ? util.deepClone(editing) : {
      remainingLessons: '',
      validUntil: util.addMonths(util.todayISO(), cfg.lesson.defaultValidityMonths),
      status: '在读',
      courseType: cfg.lesson.courseTypes[0]
    };

    ui.modal({
      title: editing ? '编辑学员 · ' + esc(editing.name) : '新增学员',
      body: '<div class="form-grid">' + ui.buildForm(fields(), values, 'stu') + '</div>',
      buttons: [
        { label: '取消', kind: 'ghost', onClick: function () { ui.closeModal(); } },
        {
          label: '保存', kind: 'primary', onClick: function () {
            var data = ui.readForm(fields(), 'stu');
            // 日期写法容错：20270830 / 2027/8/30 → 2027-08-30。
            // 必须改 data 本身，编辑时校验拿到的是副本，只改副本存回去还是错的。
            fields().forEach(function (f) {
              if (f.type === 'date' && data[f.key]) data[f.key] = util.normalizeISO(data[f.key]);
            });
            var check = BC.rules.validateStudent(
              editing ? Object.assign({ id: editing.id }, data) : data
            );
            if (!check.ok) {
              ui.toast(check.errors[0], 'danger');
              return;
            }
            ui.closeModal();
            if (editing) {
              BC.store.students.update(id, data);
              ui.toast('已保存');
            } else {
              data.token = util.uid('tk');   // 家长专属链接口令
              BC.store.students.add(data);
              ui.toast('已新增学员「' + data.name + '」');
            }
            render(root);
          }
        }
      ]
    });
  }

  /* ---------- 家长专属链接（家长点开就是自己孩子的页面，不用登录） ---------- */
  function shareLink(id) {
    var s = BC.store.students.find(id);
    if (!s) return;
    var link = BC.store.parentLink(s);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () {
        ui.toast('「' + s.name + '」的家长链接已复制，发给家长即可');
      }, function () { showLinkFallback(link, s.name); });
    } else {
      showLinkFallback(link, s.name);
    }
  }

  function showLinkFallback(link, name) {
    ui.modal({
      title: '家长链接 · ' + esc(name),
      body: '<p class="modal-text">复制这串网址，用微信发给家长。家长点开就是自己孩子的页面，不用注册、不用记密码。</p>' +
            '<textarea class="input" rows="3">' + esc(link) + '</textarea>',
      buttons: [{ label: '知道了', kind: 'primary', onClick: function () { ui.closeModal(); } }]
    });
  }

  /* ---------- 导出备份（F5：钥匙握在自己手里） ---------- */
  function exportBackup() {
    var text = BC.store.exportAll();
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '排课工具备份-' + util.todayISO() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    ui.toast('备份已下载到「下载」文件夹');
  }

  /* 批量导入：把 Excel 另存成的 CSV 一次性导入
   *   - 列顺序见 IMPORT_COLS（和「下载模板」一致）
   *   - 逐行校验，预览标红，只导入合法行 */
  var IMPORT_COLS = [
    { key: 'name', label: '姓名' },
    { key: 'age', label: '年龄' },
    { key: 'courseType', label: '课程类型' },
    { key: 'remainingLessons', label: '剩余课时' },
    { key: 'validUntil', label: '有效期至' },
    { key: 'parentName', label: '家长姓名' },
    { key: 'parentPhone', label: '家长手机' },
    { key: 'status', label: '状态' },
    { key: 'note', label: '备注' }
  ];

  // 解析 CSV（支持引号包裹、字段内逗号、字段内换行）
  function parseCSV(text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* 忽略，等 \n */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0].trim() === ''); });
  }

  // 把表头文字映射到字段 key；找不到的列忽略
  function mapHeader(header) {
    return header.map(function (h) {
      var label = h.trim();
      var hit = IMPORT_COLS.filter(function (c) { return c.label === label; })[0];
      return hit ? hit.key : null;
    });
  }

  // 课程类型容错：写"基础"也能识别成"基础班"
  function normalizeCourseType(v, allowed) {
    v = String(v || '').trim();
    if (allowed.indexOf(v) >= 0) return v;
    var byInclude = allowed.filter(function (a) { return a.indexOf(v) >= 0 || v.indexOf(a) >= 0; })[0];
    return byInclude || null;
  }

  function downloadTemplate() {
    var header = IMPORT_COLS.map(function (c) { return c.label; }).join(',');
    var sample = ['张小明', '10', '基础班', '20', util.addMonths(util.todayISO(), 12), '张先生', '13800000001', '在读', '示例行，删掉我'];
    var csv = '﻿' + header + '\n' + sample.join(',') + '\n';
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '学员导入模板.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    ui.toast('模板已下载，用 Excel 打开填好后另存为 CSV');
  }

  function openImportModal(root) {
    ui.modal({
      title: '批量导入学员',
      body:
        '<p class="modal-text">先把「下载模板」的 CSV 用 Excel 填好，再选文件导入。也可以直接把 CSV 内容粘到下面。</p>' +
        '<div class="form-grid">' +
          '<div class="field">' +
            '<label class="field__label">选 CSV 文件</label>' +
            '<input type="file" id="imp-file" accept=".csv,text/csv" class="input">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label">或粘贴 CSV 内容</label>' +
            '<textarea id="imp-paste" class="input" rows="4" placeholder="姓名,年龄,课程类型,剩余课时,..."></textarea>' +
          '</div>' +
        '</div>' +
        '<div id="imp-preview"></div>',
      buttons: [
        { label: '取消', kind: 'ghost', onClick: function () { ui.closeModal(); } },
        { label: '解析预览', kind: 'primary', onClick: function () { doParse(root); } }
      ]
    });
  }

  function doParse(root) {
    var fileEl = document.getElementById('imp-file');
    var pasteEl = document.getElementById('imp-paste');
    var text = (pasteEl && pasteEl.value ? pasteEl.value : '').trim();
    if (fileEl && fileEl.files && fileEl.files[0]) {
      var reader = new FileReader();
      reader.onload = function () { runPreview(root, String(reader.result || '')); };
      reader.readAsText(fileEl.files[0], 'UTF-8');
    } else if (text) {
      runPreview(root, text);
    } else {
      ui.toast('先选文件或粘贴内容', 'danger');
    }
  }

  function runPreview(root, text) {
    var rows = parseCSV(text);
    var box = document.getElementById('imp-preview');
    if (!box) return;
    if (rows.length < 2) { box.innerHTML = '<p class="muted hint">没有读到数据行，检查一下文件。</p>'; return; }

    var headerMap = mapHeader(rows[0]);
    var allowed = BC.config.get('lesson.courseTypes');
    var states = BC.config.get('misc.studentStates');
    var existing = BC.store.students.all().map(function (s) { return s.name; });

    var parsed = [], errors = 0;
    rows.slice(1).forEach(function (cells, idx) {
      var rec = {};
      headerMap.forEach(function (k, i) { if (k) rec[k] = (cells[i] || '').trim(); });

      // 类型转换与默认值
      if (rec.age !== undefined) rec.age = rec.age === '' ? '' : Number(rec.age);
      if (rec.remainingLessons !== undefined) rec.remainingLessons = rec.remainingLessons === '' ? '' : Number(rec.remainingLessons);

      var errMsg = '';
      if (existing.indexOf(rec.name) >= 0) {
        errMsg = '姓名已存在，跳过';
      } else {
        // 课程类型容错：写"基础"也能识别成"基础班"；完全对不上的直接标红
        var ct = normalizeCourseType(rec.courseType, allowed);
        if (rec.courseType && !ct) {
          errMsg = '课程类型必须是 ' + allowed.join(' / ') + ' 之一';
        } else {
          if (ct) rec.courseType = ct;
          if (!rec.status) rec.status = states[0] || '在读';
          var check = BC.rules.validateStudent(rec);
          if (!check.ok) errMsg = check.errors[0];
        }
      }
      if (errMsg) errors++;
      parsed.push({ rec: rec, err: errMsg, line: idx + 2 });
    });

    var valid = parsed.filter(function (p) { return !p.err; });
    var tb = parsed.map(function (p) {
      return '<tr>' +
        '<td>' + esc(p.line) + '</td>' +
        '<td>' + esc(p.rec.name || '') + '</td>' +
        '<td>' + esc(p.rec.courseType || '') + '</td>' +
        '<td>' + esc(p.rec.remainingLessons != null ? p.rec.remainingLessons : '') + '</td>' +
        '<td class="' + (p.err ? 'cell-danger' : 'cell-ok') + '">' + (p.err ? esc(p.err) : '✓ 可导入') + '</td>' +
      '</tr>';
    }).join('');

    box.innerHTML =
      '<p class="muted hint">共 ' + parsed.length + ' 行，可导入 <b>' + valid.length + '</b> 条，' +
        (errors ? '<b class="cell-danger">' + errors + '</b> 行有问题（不会导入）' : '无错误') + '。</p>' +
      '<div class="table-wrap"><table class="table table--sm"><thead><tr>' +
        '<th>行</th><th>姓名</th><th>课程类型</th><th>课时</th><th>校验</th></tr></thead><tbody>' + tb + '</tbody></table></div>' +
      (valid.length ? '<button class="btn btn--primary btn--block" id="imp-do">确认导入 ' + valid.length + ' 条</button>' : '');

    var doBtn = box.querySelector('#imp-do');
    if (doBtn) doBtn.addEventListener('click', function () {
      var added = 0;
      valid.forEach(function (p) {
        var data = util.deepClone(p.rec);
        data.token = util.uid('tk');
        BC.store.students.add(data);
        added++;
      });
      ui.closeModal();
      ui.toast('已导入 ' + added + ' 名学员' + (errors ? '，' + errors + ' 行有问题已跳过' : ''));
      render(root);
    });
  }

  // 暴露 CSV 解析与课程类型容错，供测试和未来复用（纯函数，不碰界面）
  BC.importCsv = {
    parse: parseCSV,
    normalizeCourseType: normalizeCourseType,
    COLS: IMPORT_COLS
  };

  BC.registerPage('students', {
    title: '学员档案',
    nav: true,
    order: 20,
    render: render
  });

})(window);
