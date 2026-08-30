/* 配置层：所有能改的数字、开关、文案、字段都在这一个文件。
 * 改规则只改这里，不用动其他代码。
 *   加学员字段 → studentFields 加一行，列表和表单自动长出来
 *   加课程类型 → lesson.courseTypes 加一项（要写完整路径，lesson. 开头）
 *   加上课时段 → schedule.timeSlots 加一项 */
(function (global) {
  'use strict';

  var BC = global.BC;

  /* ==================== 默认配置 ==================== */
  var DEFAULTS = {

    /* ---------- A 组 · 课时与班级 ---------- */
    lesson: {
      durationMinutes: 120,          // 单次课时长度（分钟）
      capacityHardLimit: false,      // 人数不做硬限制：超员只提醒、不拦着不让排
      capacitySoftWarn: 8,           // 超过这个人数时给黄色提醒
      maxLessonsPerDay: 2,           // 同一学员一天最多上几节课（0 = 不限）
      // 扣课时方式：onAttendance = 教练点名确认出勤后才扣；onStart = 到开课时间自动扣
      deductMode: 'onAttendance',
      defaultValidityMonths: 12,     // 新学员默认有效期（月）
      courseTypes: ['基础班', '中级班', '提高班']  // 加一项即可多一种班型
    },

    /* ---------- B 组 · 上课时段与场地 ----------
     * 四个固定档位，不是"几点到几点随便排"：
     *   上午 10:00–12:00 · 下午 14:00–16:00 · 傍晚 16:00–18:00 · 晚间 19:00–21:00
     *   weekdays 里 0=周日 1=周一 … 6=周六
     *   周内（1~5）只开晚间；周末（0、6）四个都开。
     *   想临时关掉某天某个时段 → 往 slotBlackouts 里加一条。
     * ------------------------------------------------ */
    schedule: {
      timeSlots: [
        { id: 'am', label: '上午', start: '10:00', end: '12:00', weekdays: [0, 6], enabled: true },
        { id: 'pm1', label: '下午', start: '14:00', end: '16:00', weekdays: [0, 6], enabled: true },
        { id: 'pm2', label: '傍晚', start: '16:00', end: '18:00', weekdays: [0, 6], enabled: true },
        { id: 'night', label: '晚间', start: '19:00', end: '21:00', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }
      ],
      slotBlackouts: [],             // 例外：[{date:'2026-09-02', slotId:'night', reason:'人少不开'}]
      courts: [                      // B5 场地列表，可增删改
        { id: 'court_1', name: '1 号场' },
        { id: 'court_2', name: '2 号场' },
        { id: 'court_3', name: '3 号场' },
        { id: 'court_4', name: '4 号场' }
      ],
      coachNoParallel: true,         // B7 同一教练不能同时上两节课
      blackoutDates: []              // B8 整天停课：[{from, to, reason}]
    },

    /* ---------- C 组 · 家长填报 ---------- */
    intake: {
      openWeekday: 4,                // 周四开放填报（4=周四）
      openTime: '12:00',
      closeWeekday: 0,               // 周日截止（0=周日）
      closeTime: '18:00',
      minSlots: 2,                   // 最少勾几个时段
      lockOutsideWindow: true,       // 填报窗口之外是否禁止修改（想临时开放时可在设置页关掉）
      weeksAhead: 1                  // 填报的是"下几周"：1 = 下一周
    },

    /* ---------- D 组 · 请假 / 调课 / 补课 ---------- */
    leave: {
      freeCancelHours: 12,           // 开课前 12 小时以上请假 → 不扣课时
      deductIfLate: true,            // 临期请假默认扣（但会先抵用每月免扣额度）
      monthlyFreeLateQuota: 1        // 每月 1 次临期免扣机会
    },

    /* ---------- E 组 · 提醒 ---------- */
    reminder: {
      lowBalanceThreshold: 4,        // E1 剩余 ≤ 4 课时提醒
      expiryLeadDays: [14, 3],       // 到期前 14 天和 3 天各提醒一次
      classReminderHoursBefore: 20,  // 开课前多少小时提醒
      confirmTimeoutHours: 24        // 通知后超过这么久没回，视作已确认
    },

    /* ---------- F 组 · 其他 ---------- */
    misc: {
      studentStates: ['在读', '停课', '结课'],
      adminPassword: '1234'          // 教练端管理密码，登录后可在设置里改
    },

    /* ---------- G 组 · 上线与分享 ----------
     * baseUrl：你把工具部署到一个网址后，把那个网址填进来。
     *          这样生成的家长链接才是指向你部署地址的短链接，
     *          家长点开才进得到。留空则自动用当前打开的网址。
     *
     * supabaseUrl / supabaseKey：接上云端数据库后（可选，但强烈建议），
     *   - 家长确认/填报/请假，你这边能立刻收到；你排的课家长那边也立刻出现
     *   - 家长链接会变短（只带口令，不用再打包整份资料）
     *   两个都留空 = 用原来的"快照链接"模式（单向，家长回传不了）。
     * ------------------------------------------------ */
    deploy: {
      baseUrl: '',                   // 例如 https://yixiao.example.com/  （结尾斜杠可加可不加）
      supabaseUrl: '',               // 例如 https://xxxxxxxx.supabase.co
      supabaseKey: '',               // Supabase 的 anon public key（很长的一串）
      // 隐私字段：这几项「不上传云端」，只留在你自己手机里。
      // 以后给学员加了新字段（studentFields），默认都会同步给家长端；
      // 如果新字段是隐私（比如"家庭住址"），把它的 key 加到这个清单里就行。
      noCloudFields: ['parentName', 'parentPhone', 'note'],
      // 教练端每隔多少秒悄悄去云端看一次有没有家长新确认（0 = 关掉自动刷新）。
      // 有变化才会重画页面；你正在填表或页面切到后台时不会打扰你。
      autoRefreshSec: 30
    },

    /* ---------- 文案模板（F6，可随时改语气） ---------- */
    texts: {
      appTitle: '一笑羽毛球',
      appSlogan: '青少年羽毛球培训 · 排课助手',
      notifySchedule: '{家长}您好，{孩子}本周的课程已安排：{日期} {时间}，{场地}。请点击链接确认参加。',
      notifyClassReminder: '{家长}您好，提醒一下：{孩子}明天 {时间} 在{场地}上课，记得提前 10 分钟到。',
      notifyLowBalance: '{家长}您好，{孩子}的课时只剩 {剩余} 节了，方便的话记得续一下。',
      notifyExpiring: '{家长}您好，{孩子}的课时包将在 {到期日} 到期，还剩 {剩余} 节没上，别忘了安排。',
      notifyLeaveResult: '{家长}您好，{孩子}的请假已处理：{结果}。'
    },

    /* ==================== 学员表字段定义（扩展点） ====================
     * 想给学员加字段？在这儿加一行，列表和表单会自动长出来。
     *   type 支持：text / number / date / tel / select / textarea
     *   optionsFrom：从配置里取选项，写"完整点号路径"（如 'lesson.courseTypes'）。注意必须在 lesson. 下，只写 'courseTypes' 会查不到、下拉变空。
     *   list: true 表示在学员列表里显示这一列
     * ================================================================ */
    studentFields: [
      { key: 'name', label: '姓名', type: 'text', required: true, list: true, width: '92px' },
      { key: 'age', label: '年龄', type: 'number', required: false, list: true, width: '58px' },
      { key: 'courseType', label: '课程类型', type: 'select', optionsFrom: 'lesson.courseTypes', required: true, list: true, width: '86px' },
      { key: 'remainingLessons', label: '剩余课时', type: 'number', required: true, list: true, width: '82px' },
      { key: 'validUntil', label: '有效期至', type: 'date', required: true, list: true, width: '110px' },
      { key: 'parentName', label: '家长姓名', type: 'text', required: false, list: false },
      { key: 'parentPhone', label: '家长手机', type: 'tel', required: false, list: false },
      { key: 'status', label: '状态', type: 'select', optionsFrom: 'misc.studentStates', required: true, default: '在读', list: true, width: '72px' },
      { key: 'note', label: '备注', type: 'textarea', required: false, list: false }
    ]
  };

  /* ==================== 设置页表单结构（驱动 T6 界面） ====================
   * 扩展点：加一个可配置项 = 在这儿加一行，设置页自动生成输入框。
   *   path 用点号定位到上面的配置，如 'lesson.durationMinutes'
   * ==================================================================== */
  var SETTINGS_SCHEMA = [
    {
      group: 'A · 课时与班级', items: [
        { path: 'lesson.durationMinutes', label: '单次课时长度', type: 'number', unit: '分钟', help: '一节课上多久' },
        { path: 'lesson.capacityHardLimit', label: '人数硬限制', type: 'checkbox', help: '关掉 = 超员只提醒、不拦着不让排' },
        { path: 'lesson.capacitySoftWarn', label: '超员提醒阈值', type: 'number', unit: '人', help: '超过这个人数时给黄色提醒' },
        { path: 'lesson.maxLessonsPerDay', label: '每人每天最多几节课', type: 'number', unit: '节', help: '填 0 表示不限制' },
        { path: 'lesson.defaultValidityMonths', label: '默认有效期', type: 'number', unit: '个月' }
      ]
    },
    {
      group: 'B · 排课规则', items: [
        { path: 'schedule.coachNoParallel', label: '同一时间只能上一节课', type: 'checkbox' }
      ]
    },
    {
      group: 'D · 扣课时方式', items: [
        {
          path: 'lesson.deductMode', label: '什么时候扣课时', type: 'select',
          options: ['onAttendance', 'onStart'],
          optionLabels: { onAttendance: '教练确认出勤后才扣（推荐）', onStart: '到开课时间自动扣' }
        }
      ]
    },
    {
      group: 'C · 家长填报', items: [
        { path: 'intake.minSlots', label: '最少勾选时段数', type: 'number', unit: '个' },
        { path: 'intake.weeksAhead', label: '填报的是第几周后', type: 'number', unit: '周', help: '1 = 填下一周' },
        { path: 'intake.openWeekday', label: '填报周几开放', type: 'number', unit: '（0=周日）', help: '4 = 周四' },
        { path: 'intake.openTime', label: '开放时间', type: 'text', help: '如 12:00' },
        { path: 'intake.closeWeekday', label: '周几截止', type: 'number', unit: '（0=周日）', help: '0 = 周日' },
        { path: 'intake.closeTime', label: '截止时间', type: 'text', help: '如 18:00' },
        { path: 'intake.lockOutsideWindow', label: '窗口之外禁止修改', type: 'checkbox', help: '想临时让大家都能填报时，把这项关掉' }
      ]
    },
    {
      group: 'D · 请假与补课', items: [
        { path: 'leave.freeCancelHours', label: '开课前多少小时免扣课时', type: 'number', unit: '小时' },
        { path: 'leave.deductIfLate', label: '临期请假扣课时', type: 'checkbox' },
        { path: 'leave.monthlyFreeLateQuota', label: '每月临期免扣次数', type: 'number', unit: '次' }
      ]
    },
    {
      group: 'E · 提醒阈值', items: [
        { path: 'reminder.lowBalanceThreshold', label: '课时不足提醒阈值', type: 'number', unit: '节' },
        { path: 'reminder.expiryLeadDays', label: '到期提前提醒', type: 'text', unit: '天（多个用逗号隔开）' },
        { path: 'reminder.classReminderHoursBefore', label: '上课提醒提前', type: 'number', unit: '小时' },
        { path: 'reminder.confirmTimeoutHours', label: '通知确认时限', type: 'number', unit: '小时' }
      ]
    },
    {
      group: 'F · 其他', items: [
        { path: 'misc.adminPassword', label: '教练端管理密码', type: 'text' },
        { path: 'texts.appTitle', label: '页面标题', type: 'text' },
        { path: 'texts.appSlogan', label: '副标题', type: 'text' }
      ]
    },
    {
      group: 'G · 上线与分享', items: [
        { path: 'deploy.baseUrl', label: '部署基地址', type: 'text', help: '把工具托管到网址后，把网址填这里（如 https://yixiao.example.com/）。家长链接才会指向这个网址。留空则用当前打开的网址。' },
        { path: 'deploy.supabaseUrl', label: '云端地址（Supabase URL）', type: 'text', help: '填了才能双向同步：家长确认/填报你这边收得到，链接也会变短。留空则是单向快照模式。' },
        { path: 'deploy.supabaseKey', label: '云端密钥（anon key）', type: 'text', help: 'Supabase 项目里 Settings → API 的 anon public 那串。只填上面不填这个也不生效。' },
        { path: 'deploy.autoRefreshSec', label: '家长确认自动刷新', type: 'number', unit: '秒', help: '教练端每隔多少秒悄悄去云端看一次家长有没有新确认（0 = 关掉自动刷新）。有变化才会重画页面，你正在填表或切到后台时不会打扰。' }
      ]
    }
  ];

  /* ==================== 配置读写 ==================== */
  var STORAGE_KEY = 'bc.config.v1';
  var current = null;

  function load() {
    if (current) return current;
    var saved = null;
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { saved = null; }

    current = BC.util.deepClone(DEFAULTS);
    if (saved) merge(current, saved);
    return current;
  }

  // 用 saved 覆盖 base；base 里没有的键不写入（防止越存越乱）
  // 数组（如 timeSlots、courts）整体替换，不做逐项合并，这样删除项才生效
  function merge(base, saved) {
    Object.keys(saved).forEach(function (key) {
      if (!(key in base)) return;
      var bv = base[key], sv = saved[key];
      var bothArrays = Array.isArray(bv) && Array.isArray(sv);
      var bothObjects = bv && typeof bv === 'object' && !Array.isArray(bv) &&
                        sv && typeof sv === 'object' && !Array.isArray(sv);
      if (bothArrays) base[key] = sv;
      else if (bothObjects) merge(bv, sv);
      else base[key] = sv;
    });
  }

  function save() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      return true;
    } catch (e) { return false; }
  }

  function get(path) {
    var node = load();
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (node == null) return undefined;
      node = node[parts[i]];
    }
    return node;
  }

  function set(path, value) {
    var node = load();
    var parts = String(path).split('.');
    var last = parts.pop();
    for (var i = 0; i < parts.length; i++) {
      if (node[parts[i]] == null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    // 目标原本是数字数组（如到期提醒天数）时，按逗号分隔解析
    if (Array.isArray(node[last]) && typeof value === 'string' &&
        node[last].every(function (x) { return typeof x === 'number'; })) {
      node[last] = value.split(/[,，]/)
        .map(function (s) { return Number(s.trim()); })
        .filter(function (n) { return !isNaN(n); });
    } else {
      node[last] = value;
    }
    return save();
  }

  function reset() {
    current = BC.util.deepClone(DEFAULTS);
    save();
    return current;
  }

  BC.config = {
    DEFAULTS: DEFAULTS,
    SETTINGS_SCHEMA: SETTINGS_SCHEMA,
    load: load,
    save: save,
    get: get,
    set: set,
    reset: reset
  };

})(window);
