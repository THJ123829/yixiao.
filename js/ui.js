/* 界面组件层：通用的按钮、弹窗、表单、提示条、羽毛球图标。
 * buildForm 是"照着配置自动生成表单"的零件：
 * 在 config.js 的 studentFields 里加一行，学员表单和列表就自动多一个框，
 * 这里的代码不用改。 */
(function (global) {
  'use strict';

  var BC = global.BC;
  var util = BC.util;
  var esc = util.escapeHtml;

  var ui = BC.ui = {};

  /* ---------- 轻提示（右下角一闪而过的小条） ---------- */
  ui.toast = function (message, level) {
    var box = document.getElementById('toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (level || 'ok');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('toast--out');
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  };

  /* ---------- 确认弹窗 ---------- */
  ui.confirm = function (message, onYes) {
    ui.modal({
      title: '确认',
      body: '<p class="modal-text">' + esc(message) + '</p>',
      buttons: [
        { label: '取消', kind: 'ghost', onClick: function () { ui.closeModal(); } },
        {
          label: '确定', kind: 'danger', onClick: function () {
            ui.closeModal();
            onYes && onYes();
          }
        }
      ]
    });
  };

  /* ---------- 通用弹窗 ---------- */
  ui.modal = function (opts) {
    ui.closeModal();
    var wrap = document.createElement('div');
    wrap.className = 'modal-mask';
    wrap.id = 'modal-mask';

    var buttonsHtml = (opts.buttons || []).map(function (b, i) {
      return '<button class="btn btn--' + (b.kind || 'ghost') + '" data-btn="' + i + '">' + esc(b.label) + '</button>';
    }).join('');

    wrap.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal__head"><h3>' + esc(opts.title || '') + '</h3>' +
          '<button class="modal__close" data-close="1" aria-label="关闭">&times;</button></div>' +
        '<div class="modal__body">' + (opts.body || '') + '</div>' +
        (buttonsHtml ? '<div class="modal__foot">' + buttonsHtml + '</div>' : '') +
      '</div>';

    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.getAttribute('data-close')) ui.closeModal();
      var idx = e.target.getAttribute && e.target.getAttribute('data-btn');
      if (idx !== null && idx !== undefined && idx !== '') {
        var b = opts.buttons[Number(idx)];
        if (b && b.onClick) b.onClick();
      }
    });
  };

  ui.closeModal = function () {
    var m = document.getElementById('modal-mask');
    if (m) m.remove();
  };

  /* ============================================================
   * 表单生成器：按字段定义自动生成输入框
   *   fields: config.studentFields 那样的一串字段定义
   *   values: 已有的值（编辑时回填）
   * ============================================================ */
  ui.buildForm = function (fields, values, idPrefix) {
    values = values || {};
    var cfg = BC.config.load();

    return fields.map(function (f) {
      var v = values[f.key] !== undefined && values[f.key] !== null
        ? values[f.key]
        : (f.default !== undefined ? f.default : '');
      var id = (idPrefix || 'f') + '_' + f.key;
      var input;

      // 选项可以来自配置（optionsFrom），也可以写死（options）
      if (f.type === 'select') {
        var opts = f.options || BC.config.get(f.optionsFrom) || [];
        input = '<select id="' + id + '" class="input">' +
          opts.map(function (o) {
            return '<option value="' + esc(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
          }).join('') +
          '</select>';
      } else if (f.type === 'textarea') {
        input = '<textarea id="' + id + '" class="input" rows="2">' + esc(v) + '</textarea>';
      } else {
        var type = (f.type === 'number') ? 'number' : (f.type === 'date' ? 'date' : (f.type === 'tel' ? 'tel' : 'text'));
        input = '<input id="' + id + '" class="input" type="' + type + '" value="' + esc(v) + '"' +
          (f.type === 'number' ? ' min="0"' : '') + '>';
      }

      return '<div class="field">' +
        '<label class="field__label" for="' + id + '">' + esc(f.label) +
          (f.required ? '<span class="req">*</span>' : '') +
        '</label>' +
        input +
      '</div>';
    }).join('');
  };

  /* ---------- 从生成的表单里把值读回来 ---------- */
  ui.readForm = function (fields, idPrefix) {
    var out = {};
    fields.forEach(function (f) {
      var el = document.getElementById((idPrefix || 'f') + '_' + f.key);
      if (!el) return;
      var raw = el.value;
      out[f.key] = (f.type === 'number') ? (raw === '' ? '' : Number(raw)) : raw.trim();
    });
    return out;
  };

  /* ============================================================
   * 羽毛球图标（内联 SVG，不依赖任何图片文件，双击打开也能显示）
   * ============================================================ */
  var icons = BC.icons = {};

  // 羽毛球：白色羽毛裙 + 橙色软木头
  icons.shuttle = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 32 32" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<path d="M16 3 L23.5 15.5 L16 19 L8.5 15.5 Z" fill="#ffffff" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M16 3.8 V18.2 M12.2 10.8 L16 12.6 L19.8 10.8" stroke="#16a34a" stroke-width="1" stroke-linecap="round" fill="none"/>' +
      '<path d="M11.2 18.6 Q16 27.5 20.8 18.6 Z" fill="#f59e0b" stroke="#d97706" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg>';
  };

  // 球拍
  icons.racket = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 32 32" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<ellipse cx="16" cy="12" rx="8" ry="8.5" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="1.6"/>' +
      '<path d="M16 4v16M8.6 12h14.8M11.4 6.6 20.6 17.4M20.6 6.6 11.4 17.4" stroke="#7dd3fc" stroke-width="0.9" fill="none"/>' +
      '<path d="M16 20.5v8" stroke="#0ea5e9" stroke-width="3.2" stroke-linecap="round"/>' +
      '<path d="M14.4 28.5h3.2" stroke="#0ea5e9" stroke-width="3.2" stroke-linecap="round"/>' +
      '</svg>';
  };

  /* ---------- 底部标签栏用的图标 ---------- */
  icons.home = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<path d="M3.5 11.2 12 4l8.5 7.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M5.6 12.4V19a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1v-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<rect x="10" y="14" width="4" height="6" rx="1" fill="currentColor" opacity=".35"/>' +
      '</svg>';
  };

  icons.people = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<circle cx="9" cy="8" r="3.2" fill="currentColor" opacity=".85"/>' +
      '<path d="M3.4 19.4c.5-3 2.9-4.7 5.6-4.7s5.1 1.7 5.6 4.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M16.2 5.6a3 3 0 0 1 0 5.6M17.6 14.9c2.1.4 3.6 1.9 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>' +
      '</svg>';
  };

  icons.calendar = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="3.4" y="5" width="17.2" height="15" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M3.4 9.6h17.2M8 3v3.6M16 3v3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<rect x="7" y="12.2" width="4" height="4" rx="1" fill="currentColor" opacity=".38"/>' +
      '<rect x="13" y="12.2" width="4" height="4" rx="1" fill="currentColor" opacity=".38"/>' +
      '</svg>';
  };

  icons.link = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>';
  };

  icons.gear = function (size) {
    var s = size || 24;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M12 3.2v2.2M12 18.6v2.2M4.8 12H2.6M21.4 12h-2.2M6.9 6.9 5.4 5.4M18.6 18.6l-1.5-1.5M17.1 6.9l1.5-1.5M5.4 18.6l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>';
  };

  /* ---------- 空状态 ---------- */
  ui.empty = function (title, hint) {
    return '<div class="empty">' +
      '<div class="empty__title">' + esc(title) + '</div>' +
      (hint ? '<div class="empty__hint">' + esc(hint) + '</div>' : '') +
    '</div>';
  };

  /* ---------- 状态徽章 ---------- */
  ui.badge = function (text, level) {
    return '<span class="badge badge--' + (level || 'info') + '">' + esc(text) + '</span>';
  };

})(window);
