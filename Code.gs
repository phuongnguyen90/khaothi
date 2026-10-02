/**
 * KHẢO THÍ CLO – Máy chủ Google Apps Script · phiên bản 2 (đồng bộ thời gian thực, tài khoản)
 * Khoa Công nghệ Thông tin · Trường ĐH Phạm Văn Đồng
 *
 * Tệp này gắn vào MỘT Google Sheet và là máy chủ dữ liệu của website:
 *   • Tài khoản: giảng viên đăng nhập bằng email + mật khẩu; sinh viên đăng nhập bằng MSSV,
 *     mật khẩu mặc định chính là MSSV, sinh viên tự đổi được; giảng viên đặt lại được về MSSV.
 *   • Danh mục (học phần, CLO, lớp, sinh viên, đề) lưu ở tệp catalog.json trên Drive.
 *   • Mỗi bài làm là một dòng của trang tính DuLieu_BaiLam; ảnh dán/hình vẽ lưu thành tệp trên Drive.
 *     Phần của sinh viên (bài làm, số lần rời trình duyệt) và phần của giảng viên (điểm, mở khóa,
 *     cộng giờ) được ghi riêng, nên hai bên cùng lúc không ghi đè nhau.
 *   • Website hỏi máy chủ vài giây một lần: giảng viên thấy ngay SV rời trình duyệt, SV thấy ngay
 *     khi được mở khóa, cộng giờ, hoặc khi đề được mở/đóng.
 *   • Trắc nghiệm và lập trình được chấm trên máy chủ khi SV nộp (đáp án không gửi xuống máy SV).
 *   • Các trang tính dễ đọc (HocPhan, CLO, LopHocPhan, SinhVien, DanhSachLop, DeThi, CauHoi, BaiLam, Diem)
 *     được dựng lại tự động 10 phút một lần, hoặc khi bấm “Đồng bộ ra bảng tính” trên website.
 *
 * ── CÀI ĐẶT (một lần) ─────────────────────────────────────────────────────────
 *   1. Tạo Google Sheet mới (ví dụ “Khảo thí CLO – Dữ liệu”) bằng tài khoản của giảng viên quản trị.
 *   2. Tiện ích mở rộng → Apps Script → xóa nội dung mặc định → dán toàn bộ tệp này → Lưu.
 *   3. Chọn hàm  setup  → Chạy → cấp quyền. Nhật ký in ra MẬT KHẨU TẠM của tài khoản giảng viên
 *      (chính là email Google đang dùng); mật khẩu tạm cũng nằm ở trang tính CauHinh.
 *   4. Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web
 *        – Thực thi với tư cách: Tôi        – Người có quyền truy cập: Bất kỳ ai
 *      → chép URL kết thúc bằng /exec, dán vào tệp config.js của website.
 *   5. Mở website → đăng nhập bằng email + mật khẩu tạm → đổi mật khẩu.
 *   Khi sửa tệp này: Triển khai → Quản lý triển khai → Chỉnh sửa → Phiên bản mới (URL giữ nguyên).
 *   Quên mật khẩu giảng viên: chạy hàm  capLaiMatKhauGV  trong trình soạn Apps Script.
 */

const CFG = {
  VERSION: '2.0.0',
  FOLDER: 'Khao thi CLO',
  CATALOG: 'catalog.json',
  DATA: 'DuLieu_BaiLam',
  SESSION_TTL: 21600,          // 6 giờ, gia hạn khi còn dùng
  CHUNK: 45000,                // ký tự / ô (giới hạn ô của Google Sheet là 50 000)
  NCHUNK: 6,
  GRACE: 120000,               // 2 phút dung sai mạng khi hết giờ
  ITER: 200,                   // số vòng băm mật khẩu
  BACKUP_KEEP: 30,
  MAIL_LIMIT: 24 * 1024 * 1024,
  JUDGE: 'https://emkc.org/api/v2/piston/execute'
};
const ENT = ['courses', 'sections', 'teachers', 'students', 'exams'];
const COL = {KEY: 1, ID: 2, EXAM: 3, SV: 4, SVUPD: 5, SUBAT: 6, NLEAVE: 7, SVJ: 8, ANS: 9, GVJ: 15, TOTAL: 16, LOCKED: 17, GVUPD: 18, N: 18};
const DATA_HEADER = ['Khóa', 'ID bài', 'ID đề', 'MSSV', 'SV cập nhật (ms)', 'Nộp lúc', 'Số lần rời', 'Phần SV (JSON)',
  'Bài làm 1', 'Bài làm 2', 'Bài làm 3', 'Bài làm 4', 'Bài làm 5', 'Bài làm 6', 'Phần GV (JSON)', 'Tổng điểm', 'Đang bị khóa', 'GV cập nhật (ms)'];
const ACC_HEADER = ['Tài khoản', 'Vai trò', 'Salt', 'Băm mật khẩu', 'Đổi lúc', 'Phải đổi'];

/* =============================== CÀI ĐẶT =============================== */

function setup() {
  folder_('');
  dataSheet_();
  sheet_('TaiKhoan', ACC_HEADER);
  Object.keys(TABLES).forEach(function (n) { sheet_(n, TABLES[n]); });
  const cat = readCat_();
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  let pw = '';
  if (email) {
    let t = cat.teachers.filter(function (x) { return String(x.email || '').toLowerCase() === email; })[0];
    if (!t) { t = {id: 'gv_' + uid_(), name: 'Giảng viên ' + email.split('@')[0], email: email}; cat.teachers.push(t); writeCat_(cat); }
    if (!getAcc_('gv:' + email)) { pw = tempPw_(); setAcc_('gv:' + email, 'gv', pw, true); }
  }
  const cfg = sheet_('CauHinh', ['Mục', 'Giá trị']);
  cfg.clearContents();
  cfg.getRange(1, 1, 1, 2).setValues([['Mục', 'Giá trị']]).setFontWeight('bold');
  cfg.getRange(2, 1, 6, 2).setValues([
    ['Tài khoản giảng viên', email || '(không đọc được email – chạy capLaiMatKhauGV)'],
    ['Mật khẩu tạm', pw ? pw + '  (đổi ngay sau lần đăng nhập đầu, rồi xóa dòng này)' : '(đã có tài khoản – giữ mật khẩu cũ)'],
    ['Thư mục Drive', CFG.FOLDER],
    ['Phiên bản', CFG.VERSION],
    ['Cài đặt lúc', new Date()],
    ['Sinh viên', 'Đăng nhập bằng MSSV, mật khẩu mặc định là MSSV']
  ]);
  cfg.autoResizeColumns(1, 2);
  installTriggers();
  Logger.log('Đã cài đặt Khảo thí CLO ' + CFG.VERSION + '.');
  if (pw) Logger.log('Tài khoản giảng viên: ' + email + ' · mật khẩu tạm: ' + pw);
  Logger.log('Tiếp theo: Triển khai → Ứng dụng web (Thực thi: Tôi; Truy cập: Bất kỳ ai), dán URL /exec vào config.js.');
  return pw;
}

/** Cấp lại mật khẩu tạm cho giảng viên (mặc định: tài khoản Google đang chạy). */
function capLaiMatKhauGV(email) {
  email = String(email || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Không đọc được email. Gọi capLaiMatKhauGV("ten@truong.edu.vn").');
  const cat = readCat_();
  if (!cat.teachers.some(function (x) { return String(x.email || '').toLowerCase() === email; })) {
    cat.teachers.push({id: 'gv_' + uid_(), name: 'Giảng viên ' + email.split('@')[0], email: email}); writeCat_(cat);
  }
  const pw = tempPw_(); setAcc_('gv:' + email, 'gv', pw, true);
  Logger.log('Mật khẩu tạm của ' + email + ': ' + pw);
  return pw;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dinhKy', 'saoLuuHangNgay'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dinhKy').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('saoLuuHangNgay').timeBased().everyDays(1).atHour(1).create();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Khảo thí CLO')
    .addItem('Cài đặt lần đầu', 'setup')
    .addItem('Dựng lại các bảng dễ đọc', 'dongBoBang')
    .addItem('Sao lưu ngay', 'saoLuuHangNgay')
    .addToUi();
}

/* =============================== API =============================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ok: true, version: CFG.VERSION, sheet: SpreadsheetApp.getActive().getName(), now: Date.now()});
  return json_({ok: true, info: 'Khảo thí CLO ' + CFG.VERSION + ' – máy chủ đang chạy.'});
}

const HANDLERS = {
  logout:       {fn: logout_},
  changePw:     {fn: changePw_},
  boot:         {fn: boot_},
  svPoll:       {fn: svPoll_, role: 'sv'},
  saveSub:      {fn: saveSub_, role: 'sv'},
  poll:         {fn: poll_, role: 'gv'},
  catalog:      {fn: function () { return {catalog: readCat_(), catVer: catVer_()}; }, role: 'gv'},
  saveCatalog:  {fn: saveCatalog_, role: 'gv'},
  saveTemplate: {fn: saveTemplate_, role: 'gv'},
  getTemplate:  {fn: getTemplate_, role: 'gv'},
  patchSubs:    {fn: patchSubs_, role: 'gv'},
  getSub:       {fn: getSub_, role: 'gv'},
  getSubs:      {fn: getSubs_, role: 'gv'},
  imgs:         {fn: imgs_, role: 'gv'},
  resetPw:      {fn: resetPw_, role: 'gv'},
  addTeacher:   {fn: addTeacher_, role: 'gv'},
  importAll:    {fn: importAll_, role: 'gv'},
  mirror:       {fn: function () { return mirror_(); }, role: 'gv'},
  table:        {fn: function (me, d) { return writeTable_(d.sheet, d.header, d.rows); }, role: 'gv'},
  mailArchive:  {fn: mailArchive_, role: 'gv'},
  log:          {fn: function (me, d) { return log_(d.event, (me.id || '') + ' · ' + (d.detail || '')); }}
};

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ok: false, error: 'Dữ liệu gửi lên không phải JSON.'}); }
  try {
    if (d.action === 'ping') return json_({ok: true, version: CFG.VERSION, now: Date.now()});
    if (d.action === 'login') { const r = login_(d); r.ok = true; r.now = Date.now(); return json_(r); }
    const me = sess_(d.sid);
    if (!me) return json_({ok: false, code: 'AUTH', error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'});
    const h = HANDLERS[d.action];
    if (!h) return json_({ok: false, error: 'Không rõ thao tác: ' + d.action});
    if (h.role && h.role !== me.role) return json_({ok: false, error: 'Tài khoản không có quyền thực hiện thao tác này.'});
    const out = h.fn(me, d) || {};
    out.ok = true; out.now = Date.now();
    return json_(out);
  } catch (err) {
    return json_({ok: false, error: String((err && err.message) || err)});
  }
}

/* =============================== TÀI KHOẢN & PHIÊN =============================== */

function hash_(salt, pw) {
  let h = salt + '|' + pw;
  for (let i = 0; i < CFG.ITER; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  return h;
}
function accSheet_() { return sheet_('TaiKhoan', ACC_HEADER); }
function getAcc_(id) {
  const sh = accSheet_(), n = sh.getLastRow(); if (n < 2) return null;
  const rows = sh.getRange(2, 1, n - 1, 6).getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) return {row: i + 2, id: id, role: rows[i][1], salt: String(rows[i][2]), hash: String(rows[i][3]), mustChange: rows[i][5] === true || rows[i][5] === 'TRUE'};
  return null;
}
function setAcc_(id, role, pw, mustChange) {
  const salt = Utilities.getUuid(), rec = [id, role, salt, hash_(salt, pw), new Date(), !!mustChange];
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const a = getAcc_(id), sh = accSheet_();
    if (a) sh.getRange(a.row, 1, 1, 6).setValues([rec]); else sh.appendRow(rec);
  } finally { lock.releaseLock(); }
}
function delAcc_(id) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { const a = getAcc_(id); if (a) accSheet_().deleteRow(a.row); return !!a; } finally { lock.releaseLock(); }
}
function tempPw_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
const normId_ = function (s) { return String(s || '').trim().toUpperCase(); };

/** Kiểm tra mật khẩu. Trả về {who, acc, isDefault} hoặc ném lỗi. */
function verify_(role, id, pw) {
  const cat = readCat_();
  if (role === 'gv') {
    const email = String(id || '').trim().toLowerCase();
    const t = cat.teachers.filter(function (x) { return String(x.email || '').toLowerCase() === email; })[0];
    const a = t && getAcc_('gv:' + email);
    if (!a || a.hash !== hash_(a.salt, String(pw || ''))) return null;
    return {who: {role: 'gv', id: t.id, name: t.name, email: email}, acc: a, isDefault: false};
  }
  const mid = normId_(id);
  const st = cat.students.filter(function (s) { return normId_(s.id) === mid; })[0];
  if (!st || !cat.sections.some(function (s) { return s.students.indexOf(st.id) >= 0; })) return null;
  const a = getAcc_('sv:' + mid);
  if (a) { if (a.hash !== hash_(a.salt, String(pw || ''))) return null; }
  else if (normId_(pw) !== mid) return null;
  return {who: {role: 'sv', id: st.id, name: st.name}, acc: a, isDefault: !a};
}

function login_(d) {
  const cache = CacheService.getScriptCache(), fk = 'F:' + d.role + ':' + String(d.id || '').trim().toUpperCase();
  const fails = +(cache.get(fk) || 0);
  if (fails >= 8) throw new Error('Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.');
  const v = verify_(d.role === 'gv' ? 'gv' : 'sv', d.id, d.pw);
  if (!v) {
    cache.put(fk, String(fails + 1), 600);
    throw new Error(d.role === 'gv' ? 'Email hoặc mật khẩu không đúng.' : 'MSSV hoặc mật khẩu không đúng (mật khẩu mặc định là MSSV), hoặc bạn chưa có trong lớp học phần nào.');
  }
  cache.remove(fk);
  const sid = Utilities.getUuid().replace(/-/g, '') + uid_();
  const s = {role: v.who.role, id: v.who.id, name: v.who.name, email: v.who.email || '', t: Date.now()};
  cache.put('S' + sid, JSON.stringify(s), CFG.SESSION_TTL);
  return {sid: sid, me: {role: s.role, id: s.id, name: s.name, email: s.email}, isDefault: v.isDefault, mustChange: !!(v.acc && v.acc.mustChange)};
}
function sess_(sid) {
  if (!sid) return null;
  const c = CacheService.getScriptCache(), v = c.get('S' + sid); if (!v) return null;
  const s = JSON.parse(v); s.sid = sid;
  if (Date.now() - (s.t || 0) > 600000) { s.t = Date.now(); c.put('S' + sid, JSON.stringify(s), CFG.SESSION_TTL); }
  return s;
}
function logout_(me) { CacheService.getScriptCache().remove('S' + me.sid); return {}; }

function changePw_(me, d) {
  const pw = String(d.pw || '');
  if (pw.length < 6) throw new Error('Mật khẩu mới cần ít nhất 6 ký tự.');
  const v = verify_(me.role, me.role === 'gv' ? me.email : me.id, d.old);
  if (!v) throw new Error('Mật khẩu hiện tại không đúng.');
  if (me.role === 'sv' && normId_(pw) === normId_(me.id)) throw new Error('Mật khẩu mới phải khác MSSV.');
  setAcc_(me.role === 'gv' ? 'gv:' + me.email : 'sv:' + normId_(me.id), me.role, pw, false);
  return {};
}
function resetPw_(me, d) {
  if (d.role === 'gv') {
    const email = String(d.email || '').toLowerCase();
    const cat = readCat_();
    if (!cat.teachers.some(function (x) { return String(x.email || '').toLowerCase() === email; })) throw new Error('Không có giảng viên với email này.');
    const pw = tempPw_(); setAcc_('gv:' + email, 'gv', pw, true);
    log_('đặt lại mật khẩu GV', me.email + ' → ' + email);
    return {tempPw: pw};
  }
  const ids = [].concat(d.ids || d.id || []).map(normId_);
  let n = 0; ids.forEach(function (id) { if (delAcc_('sv:' + id)) n++; });
  log_('đặt lại mật khẩu SV', me.email + ' → ' + ids.join(', '));
  return {reset: n};
}
function addTeacher_(me, d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let t;
  try {
    const cat = readCat_();
    t = cat.teachers.filter(function (x) { return String(x.email || '').toLowerCase() === email; })[0];
    if (!t) { t = {id: 'gv_' + uid_(), name: String(d.name || email), email: email}; cat.teachers.push(t); writeCat_(cat); }
  } finally { lock.releaseLock(); }
  const pw = tempPw_(); setAcc_('gv:' + email, 'gv', pw, true);
  log_('thêm giảng viên', me.email + ' → ' + email);
  return {teacher: t, tempPw: pw, catVer: catVer_()};
}

/* =============================== DANH MỤC =============================== */

function emptyCat_() { return {courses: [], sections: [], teachers: [], students: [], exams: [], settings: {judgeUrl: CFG.JUDGE, archiveEmail: ''}}; }
function catFile_() {
  const dir = folder_(''), it = dir.getFilesByName(CFG.CATALOG);
  return it.hasNext() ? it.next() : dir.createFile(CFG.CATALOG, JSON.stringify(emptyCat_()), 'application/json');
}
function catVer_() { return +(PropertiesService.getScriptProperties().getProperty('CAT_VER') || 0); }
function readCat_() {
  const ver = catVer_(), c = CacheService.getScriptCache(), meta = c.get('CATM');
  if (meta) {
    const m = JSON.parse(meta);
    if (m.ver === ver) {
      const keys = []; for (let i = 0; i < m.n; i++) keys.push('CAT' + i);
      const got = c.getAll(keys);
      if (keys.every(function (k) { return got[k] != null; })) return fixCat_(JSON.parse(keys.map(function (k) { return got[k]; }).join('')));
    }
  }
  const txt = catFile_().getBlob().getDataAsString() || '{}';
  cacheCat_(txt, ver);
  return fixCat_(JSON.parse(txt));
}
function fixCat_(cat) { const e = emptyCat_(); ENT.forEach(function (k) { if (!Array.isArray(cat[k])) cat[k] = []; }); cat.settings = Object.assign(e.settings, cat.settings || {}); return cat; }
function writeCat_(cat) {
  const txt = JSON.stringify(cat);
  catFile_().setContent(txt);
  const ver = Math.max(Date.now(), catVer_() + 1);
  PropertiesService.getScriptProperties().setProperty('CAT_VER', String(ver));
  cacheCat_(txt, ver);
  return ver;
}
function cacheCat_(txt, ver) {
  const size = 30000, n = Math.ceil(txt.length / size), c = CacheService.getScriptCache();
  if (n > 30) { c.remove('CATM'); return; }
  const o = {}; for (let i = 0; i < n; i++) o['CAT' + i] = txt.slice(i * size, (i + 1) * size);
  o.CATM = JSON.stringify({ver: ver, n: n});
  c.putAll(o, 21600);
}
function saveCatalog_(me, d) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const cat = readCat_(), up = d.up || {}, rm = d.rm || {};
    const wasOpen = {}; cat.exams.forEach(function (e) { if (e.status !== 'closed') wasOpen[e.id] = 1; });
    ENT.forEach(function (k) {
      const list = cat[k];
      if (k !== 'teachers') (rm[k] || []).forEach(function (id) { const i = indexById_(list, id); if (i >= 0) list.splice(i, 1); });
      (up[k] || []).forEach(function (x) {
        if (!x || !x.id) return;
        if (k === 'sections' && x.template) delete x.template.b64;
        if (k === 'teachers') { const old = list[indexById_(list, x.id)]; if (old) x.email = old.email; }   // email đăng nhập không đổi từ website
        const i = indexById_(list, x.id); if (i >= 0) list[i] = x; else list.push(x);
      });
    });
    if (d.settings) cat.settings = Object.assign(cat.settings || {}, d.settings);
    const ver = writeCat_(cat);
    // GV đóng đề → bài đang làm dở được nộp ngay với nội dung đã lưu (kể cả bài máy GV chưa kịp thấy)
    (up.exams || []).forEach(function (e) { if (e.status === 'closed' && wasOpen[e.id]) forceExam_(e, cat, 'Nộp khi giảng viên đóng đề'); });
    return {catVer: ver};
  } finally { lock.releaseLock(); }
}
function forceExam_(e, cat, flag) {
  const sh = dataSheet_(), n = sh.getLastRow() - 1; if (n < 1) return;
  const keys = sh.getRange(2, 1, n, 1).getValues(), now = Date.now();
  for (let i = 0; i < n; i++) {
    if (String(keys[i][0]).indexOf(e.id + '|') !== 0) continue;
    const v = readRow_(sh, i + 2), sv = parse_(v[COL.SVJ - 1], {}), gv = parse_(v[COL.GVJ - 1], {});
    if (sv.submittedAt || gv.forcedAt || !sv.startedAt) continue;
    gv.forcedAt = Math.min(now, deadline_(e, sv.startedAt, gv.extraMin || 0)); gv.flag = flag;
    gradeRow_(e, readAns_(v), gv, cat, false); writeGv_(sh, i + 2, gv, e, sv);
  }
}
function indexById_(list, id) { for (let i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
function examById_(cat, id) { return cat.exams.filter(function (e) { return e.id === id; })[0]; }

/* Danh mục rút gọn cho sinh viên: chỉ lớp của SV, không có đáp án, đề chưa đến giờ mở bị ẩn nội dung. */
function svCatalog_(cat, svId) {
  const now = Date.now(), secs = cat.sections.filter(function (s) { return s.students.indexOf(svId) >= 0; });
  const secIds = secs.map(function (s) { return s.id; });
  const hid = [];
  const exams = cat.exams.filter(function (e) {
    return e.status !== 'draft' && (e.assigned || []).indexOf(svId) >= 0 && (e.sectionIds || []).some(function (x) { return secIds.indexOf(x) >= 0; });
  }).map(function (e) {
    const hidden = !!(e.opensAt && e.opensAt > now);
    if (hidden) hid.push(e.id);
    const x = {};
    Object.keys(e).forEach(function (k) { if (['source', 'assigned', 'questions'].indexOf(k) < 0) x[k] = e[k]; });
    x.assigned = [svId]; x.source = '';
    x.questions = (e.questions || []).map(function (q) {
      return hidden ? {id: q.id, label: q.label, clo: q.clo, max: q.max, type: q.type, text: '', options: [], answer: '', tests: []}
                    : {id: q.id, label: q.label, clo: q.clo, max: q.max, type: q.type, text: q.text, options: q.options || [], answer: '', tests: (q.tests || []).slice(0, 1)};
    });
    if (hidden) x._hidden = true;
    return x;
  });
  const courseIds = secs.map(function (s) { return s.courseId; });
  return {
    catalog: {
      courses: cat.courses.filter(function (c) { return courseIds.indexOf(c.id) >= 0; }),
      sections: secs.map(function (s) { const o = {}; Object.keys(s).forEach(function (k) { if (k !== 'template' && k !== 'students') o[k] = s[k]; }); o.students = [svId]; return o; }),
      teachers: cat.teachers.filter(function (t) { return secs.some(function (s) { return s.teacherId === t.id; }); }).map(function (t) { return {id: t.id, name: t.name}; }),
      students: cat.students.filter(function (s) { return s.id === svId; }),
      exams: exams,
      settings: {judgeUrl: cat.settings.judgeUrl}
    },
    hid: hid
  };
}

function boot_(me) {
  const cat = readCat_();
  if (me.role === 'gv') {
    if (!cat.teachers.some(function (t) { return t.id === me.id; })) cat.teachers.push({id: me.id, name: me.name, email: me.email});
    return {catalog: cat, rows: allRows_(0), catVer: catVer_(), me: {role: 'gv', id: me.id, name: me.name, email: me.email}};
  }
  const sc = svCatalog_(cat, me.id);
  const subs = ownRows_(me.id, true).map(function (v) { inlineImgs_(v.answers); return v; });
  return {catalog: sc.catalog, hid: sc.hid, subs: subs, catVer: catVer_(), me: {role: 'sv', id: me.id, name: me.name}, isDefault: !getAcc_('sv:' + normId_(me.id))};
}

/* =============================== BÀI LÀM =============================== */

function dataSheet_() {
  const sh0 = SpreadsheetApp.getActive().getSheetByName(CFG.DATA); if (sh0) return sh0;
  const sh = sheet_(CFG.DATA, DATA_HEADER);
  sh.getRange('C:D').setNumberFormat('@'); sh.getRange('I:N').setNumberFormat('@');   // giữ nguyên dạng chữ (MSSV có số 0 đầu, bài làm)
  return sh;
}
function rowGen_() { return PropertiesService.getScriptProperties().getProperty('ROWGEN') || '0'; }
function findRow_(sh, key) {
  const c = CacheService.getScriptCache(), ck = 'R' + rowGen_() + ':' + key, last = sh.getLastRow();
  const hit = c.get(ck);
  if (hit && +hit <= last && sh.getRange(+hit, 1).getValue() === key) return +hit;
  if (last < 2) return 0;
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!f) return 0;
  c.put(ck, String(f.getRow()), 21600);
  return f.getRow();
}
function parse_(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function rowView_(v, withAns) {
  const sv = parse_(v[COL.SVJ - 1], {}), gv = parse_(v[COL.GVJ - 1], {}), key = String(v[0]), cut = key.indexOf('|');
  const o = {key: key, id: String(v[1]), examId: key.slice(0, cut), svId: key.slice(cut + 1), upd: Math.max(+v[COL.SVUPD - 1] || 0, +v[COL.GVUPD - 1] || 0),
             sv: sv, gv: gv, submittedAt: sv.submittedAt || gv.forcedAt || null};
  if (withAns) o.answers = readAns_(v);
  return o;
}
function readAns_(v) {
  const parts = []; for (let i = 0; i < CFG.NCHUNK; i++) parts.push(String(v[COL.ANS - 1 + i] || ''));
  const s = parts.join('');
  if (s.indexOf('drive:') === 0) { try { return JSON.parse(DriveApp.getFileById(s.slice(6)).getBlob().getDataAsString()); } catch (e) { return {}; } }
  return parse_(s, {});
}
function ansCells_(answers, oldVals, key) {
  const s = JSON.stringify(answers || {}), out = [];
  if (s.length > CFG.CHUNK * CFG.NCHUNK) {
    const prev = String((oldVals && oldVals[COL.ANS - 1]) || ''), name = key.replace(/[^\w]+/g, '_') + '.json';
    let f = null;
    if (prev.indexOf('drive:') === 0) { try { f = DriveApp.getFileById(prev.slice(6)); f.setContent(s); } catch (e) { f = null; } }
    if (!f) f = folder_('Bai lam lon').createFile(name, s, 'application/json');
    out.push('drive:' + f.getId());
  } else for (let i = 0; i < CFG.NCHUNK; i++) out.push(s.slice(i * CFG.CHUNK, (i + 1) * CFG.CHUNK));
  while (out.length < CFG.NCHUNK) out.push('');
  return out;
}
function readRow_(sh, r) { return sh.getRange(r, 1, 1, COL.N).getValues()[0]; }
function writeSv_(sh, r, sv, answers, old) {
  CacheService.getScriptCache().put('LASTW', String(Date.now()), 21600);
  sh.getRange(r, COL.SVUPD, 1, 10).setValues([[Date.now(), sv.submittedAt ? new Date(sv.submittedAt) : '', (sv.leaves || []).length, JSON.stringify(sv)]
    .concat(ansCells_(answers, old, old[0]))]);
}
function writeGv_(sh, r, gv, e, sv) {
  const eff = sv.submittedAt || gv.forcedAt;
  const total = e && eff ? (e.questions || []).reduce(function (a, q) { return a + (+((gv.scores || {})[q.id]) || 0); }, 0) : '';
  sh.getRange(r, COL.GVJ, 1, 4).setValues([[JSON.stringify(gv), total, lockedOf_(sv, gv) ? 'CÓ' : '', Date.now()]]);
  const k = String(sh.getRange(r, COL.KEY).getValue()); touch_(k.slice(k.indexOf('|') + 1));
}
function touch_(svId) { const c = CacheService.getScriptCache(), n = String(Date.now()); c.put('LASTW', n, 21600); if (svId) c.put('W:' + svId, n, 21600); }
function lockedOf_(sv, gv) {
  if (sv.submittedAt || gv.forcedAt) return false;
  let n = 0; (sv.leaves || []).forEach(function (L) { if (L.back && !L.auto) n++; });
  return n > (gv.unlocks || []).length;
}
function deadline_(e, startedAt, extra) {
  const t = startedAt + ((+e.duration || 0) + (extra || 0)) * 60000;
  return e.closesAt ? Math.min(t, e.closesAt + (extra || 0) * 60000) : t;
}
function newRow_(sh, key, id, examId, svId, sv, gv) {
  const row = [key, id || ('s' + uid_()), examId, svId, Date.now(), sv.submittedAt ? new Date(sv.submittedAt) : '', 0, JSON.stringify(sv), '', '', '', '', '', '', JSON.stringify(gv), '', '', Date.now()];
  sh.appendRow(row);
  const r = sh.getLastRow();
  CacheService.getScriptCache().put('R' + rowGen_() + ':' + key, String(r), 21600);
  return r;
}
const hasAns_ = function (v) { return v && typeof v === 'object' ? !!(String(v.text || '').trim() || (v.imgs || []).length || (v.links || []).length) : String(v == null ? '' : v).trim() !== ''; };

/* Ảnh trong bài làm: ảnh mới (có src dạng data URL, chưa có fileId) → tệp Drive; bài làm chỉ giữ fileId. */
function extractImgs_(answers, examId, svId) {
  const fids = {};
  Object.keys(answers || {}).forEach(function (qid) {
    const a = answers[qid]; if (!a || typeof a !== 'object' || !a.imgs) return;
    a.imgs.forEach(function (im) {
      if (im.src && !im.fileId && /^data:image\//.test(im.src)) {
        const m = im.src.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
        if (!m) return;
        const ext = m[1].indexOf('png') >= 0 ? 'png' : 'jpg';
        const f = imgFolder_(examId, svId).createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], qid + '_' + (im.kind === 'draw' ? 'hinhve' : 'anh') + '_' + (im.k || Date.now()) + '.' + ext));
        im.fileId = f.getId();
        if (im.k) fids[im.k] = im.fileId;
      }
      delete im.src;
    });
  });
  return fids;
}
function imgFolder_(examId, svId) {
  const path = 'Anh bai lam/' + examId + '/' + svId, c = CacheService.getScriptCache(), hit = c.get('D:' + path);
  if (hit) { try { return DriveApp.getFolderById(hit); } catch (e) {} }
  const f = folder_(path); c.put('D:' + path, f.getId(), 21600); return f;
}
function inlineImgs_(answers) {
  Object.keys(answers || {}).forEach(function (qid) {
    const a = answers[qid]; if (!a || typeof a !== 'object' || !a.imgs) return;
    a.imgs.forEach(function (im) { if (im.fileId && !im.src) im.src = dataUrl_(im.fileId); });
  });
}
function dataUrl_(fileId) {
  try { const b = DriveApp.getFileById(fileId).getBlob(); return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()); }
  catch (e) { return ''; }
}
function svMeta_(answers) {
  const answered = [], o = {nAtt: 0};
  Object.keys(answers || {}).forEach(function (q) {
    const a = answers[q]; if (hasAns_(a)) answered.push(q);
    if (a && typeof a === 'object') o.nAtt += (a.imgs || []).length + (a.links || []).length;
  });
  o.answered = answered; return o;
}
function cleanLeaves_(list) {
  return (Array.isArray(list) ? list : []).slice(0, 50).map(function (L) {
    const o = {at: +L.at || 0, how: String(L.how || '').slice(0, 60)};
    if (L.back) o.back = +L.back;
    if (L.auto) { o.auto = true; if (L.unlockedAt) o.unlockedAt = +L.unlockedAt; }
    return o;
  });
}

/* SV lưu bài (tự động vài giây một lần, và khi nộp) */
function saveSub_(me, d) {
  const inc = d.sub || {}, cat = readCat_(), e = examById_(cat, inc.examId), now = Date.now();
  if (!e || e.status === 'draft' || (e.assigned || []).indexOf(me.id) < 0) throw new Error('Không tìm thấy đề được giao.');
  if (e.opensAt && e.opensAt > now + 60000) throw new Error('Đề chưa đến giờ mở.');
  const sh = dataSheet_(), key = e.id + '|' + me.id;
  let r = findRow_(sh, key);
  if (!r) {
    if (e.status === 'closed' || (e.closesAt && e.closesAt + CFG.GRACE < now)) throw new Error('Đề đã đóng, không nhận bài mới.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { r = findRow_(sh, key) || newRow_(sh, key, d.id, e.id, me.id, {startedAt: Math.min(now, Math.max(now - 600000, +inc.startedAt || now)), leaves: []}, {}); }
    finally { lock.releaseLock(); }
  }
  let v = readRow_(sh, r), sv = parse_(v[COL.SVJ - 1], {}), gv = parse_(v[COL.GVJ - 1], {});
  const out = {id: String(v[1]), fids: {}};
  const accept = !sv.submittedAt && (!gv.forcedAt || now <= gv.forcedAt + CFG.GRACE);
  if (accept) {
    const incLeaves = cleanLeaves_(inc.leaves);
    const nsv = {
      startedAt: sv.startedAt || Math.min(now, Math.max(now - 600000, +inc.startedAt || now)),
      leaves: incLeaves.length >= (sv.leaves || []).length ? incLeaves : sv.leaves,
      away: !!inc.away, pasteBlocked: Math.max(+inc.pasteBlocked || 0, +sv.pasteBlocked || 0),
      flag: String(inc.flag || sv.flag || '').slice(0, 300), submittedAt: null
    };
    const answers = inc.answers && typeof inc.answers === 'object' ? inc.answers : {};
    out.fids = extractImgs_(answers, e.id, me.id);
    const m = svMeta_(answers); nsv.answered = m.answered; nsv.nAtt = m.nAtt;
    const dl = deadline_(e, nsv.startedAt, gv.extraMin || 0);
    if (inc.submittedAt) nsv.submittedAt = Math.max(nsv.startedAt, Math.min(now, +inc.submittedAt, dl + CFG.GRACE));
    else if (now > dl + CFG.GRACE) { nsv.submittedAt = dl; nsv.flag = nsv.flag || 'Hệ thống tự nộp khi hết giờ'; }
    else if (e.status === 'closed' && !gv.forcedAt) { nsv.submittedAt = now; nsv.flag = nsv.flag || 'Nộp khi giảng viên đóng đề'; }
    if (gv.forcedAt && !nsv.submittedAt) nsv.lateSync = now;
    writeSv_(sh, r, nsv, answers, v);
    sv = nsv;
    if (nsv.submittedAt || gv.forcedAt) {           // chấm trắc nghiệm / lập trình trên máy chủ
      const lock = LockService.getScriptLock(); lock.waitLock(25000);
      try { v = readRow_(sh, r); gv = parse_(v[COL.GVJ - 1], {}); gradeRow_(e, answers, gv, cat, !!nsv.lateSync); writeGv_(sh, r, gv, e, sv); }
      finally { lock.releaseLock(); }
    }
  }
  out.row = rowView_(readRow_(sh, r), false);
  return out;
}

/* Chấm trên máy chủ: trắc nghiệm theo đáp án; lập trình chạy test qua bộ chấm. Không ghi đè điểm GV đã nhập. */
function gradeRow_(e, answers, gv, cat, regrade) {
  gv.scores = gv.scores || {}; gv.runs = gv.runs || {};
  const judge = (cat.settings && cat.settings.judgeUrl) || CFG.JUDGE;
  (e.questions || []).forEach(function (q) {
    if (gv.scores[q.id] != null && !(regrade && gv.auto && gv.auto[q.id])) return;
    const a = answers[q.id];
    if (q.type === 'TN') { gv.scores[q.id] = String(a || '') === q.answer ? q.max : 0; (gv.auto = gv.auto || {})[q.id] = 1; }
    else if (['PY', 'C', 'CPP'].indexOf(q.type) >= 0 && (q.tests || []).length) {
      try {
        const r = runTests_(q, String(a || ''), judge);
        gv.runs[q.id] = r; gv.scores[q.id] = Math.round(q.max * r.reduce(function (s, x) { return s + x; }, 0) / r.length * 4) / 4; (gv.auto = gv.auto || {})[q.id] = 1;
      } catch (err) { /* không gọi được bộ chấm → để GV chấm */ }
    }
  });
  gv.graded = (e.questions || []).every(function (q) { return gv.scores[q.id] != null; });
}
function runTests_(q, code, judge) {
  if (!code.trim()) return q.tests.map(function () { return 0; });
  const T = {PY: ['python', '3.10.0', 'main.py'], C: ['c', '10.2.0', 'main.c'], CPP: ['c++', '10.2.0', 'main.cpp']}[q.type];
  const reqs = q.tests.map(function (t) {
    return {url: judge, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            payload: JSON.stringify({language: T[0], version: T[1], files: [{name: T[2], content: code}], stdin: t.input})};
  });
  return UrlFetchApp.fetchAll(reqs).map(function (res, i) {
    if (res.getResponseCode() !== 200) throw new Error('Bộ chấm trả lỗi ' + res.getResponseCode());
    const j = JSON.parse(res.getContentText());
    if (j.compile && j.compile.code) return 0;
    const out = ((j.run || {}).stdout || '') + ((j.run || {}).stderr ? '\n' + j.run.stderr : '');
    return sameOut_(out, q.tests[i].expect) ? 1 : 0;
  });
}
function sameOut_(a, b) { return String(a).trim().replace(/\s+\n/g, '\n').replace(/\r/g, '') === String(b).trim().replace(/\r/g, ''); }

/* GV ghi phần của mình (điểm, nhận xét, mở khóa, cộng giờ, buộc nộp) – theo từng thay đổi, không ghi đè cả bài */
function patchSubs_(me, d) {
  const items = d.items || [], cat = readCat_(), sh = dataSheet_(), rows = [];
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    items.forEach(function (it) {
      const e = examById_(cat, it.examId); if (!e || !it.svId) return;
      const key = e.id + '|' + it.svId;
      let r = findRow_(sh, key);
      if (!r) {
        if (!it.create) return;
        r = newRow_(sh, key, it.id, e.id, it.svId, {startedAt: +it.create.startedAt || Date.now(), submittedAt: +it.create.submittedAt || null, leaves: [], answered: [], nAtt: 0}, {});
      }
      const v = readRow_(sh, r), sv = parse_(v[COL.SVJ - 1], {}), gv = parse_(v[COL.GVJ - 1], {}), p = it.patch || {};
      ['scores', 'feedback', 'runs'].forEach(function (k) {
        if (!p[k]) return; gv[k] = gv[k] || {};
        Object.keys(p[k]).forEach(function (q) {
          const x = p[k][q];
          if (x == null) delete gv[k][q];
          else if (k === 'scores') { const qq = (e.questions || []).filter(function (z) { return z.id === q; })[0]; if (qq) { gv.scores[q] = Math.max(0, Math.min(+qq.max, +x || 0)); if (gv.auto) delete gv.auto[q]; } }
          else gv[k][q] = x;
        });
      });
      if (p.extraMin != null) gv.extraMin = Math.max(0, +p.extraMin || 0);
      if (p.unlocks && p.unlocks.length > (gv.unlocks || []).length) gv.unlocks = p.unlocks.map(function (u) { return {at: +u.at || Date.now(), by: String(u.by || me.name)}; });
      if (p.forcedAt && !gv.forcedAt && !sv.submittedAt) {
        gv.forcedAt = +p.forcedAt; gv.flag = String(p.flag || 'Nộp khi giảng viên đóng đề');
        gradeRow_(e, readAns_(v), gv, cat, false);
      }
      gv.graded = (e.questions || []).every(function (q) { return (gv.scores || {})[q.id] != null; });
      writeGv_(sh, r, gv, e, sv);
      rows.push(rowView_(readRow_(sh, r), false));
    });
  } finally { lock.releaseLock(); }
  return {rows: rows};
}

function allRows_(since, examIds, withAns) {
  const sh = dataSheet_(), n = sh.getLastRow() - 1; if (n < 1) return [];
  const vals = withAns ? sh.getRange(2, 1, n, COL.N).getValues() : null;
  const a = withAns ? null : sh.getRange(2, 1, n, COL.SVJ).getValues(), b = withAns ? null : sh.getRange(2, COL.GVJ, n, 4).getValues();
  const out = [];
  for (let i = 0; i < n; i++) {
    let v;
    if (withAns) v = vals[i];
    else { v = a[i].concat(['', '', '', '', '', '']).concat(b[i]); }
    if (!v[0]) continue;
    if (examIds && examIds.indexOf(String(v[2])) < 0) continue;
    if (since && Math.max(+v[COL.SVUPD - 1] || 0, +v[COL.GVUPD - 1] || 0) <= since) continue;
    out.push(rowView_(v, !!withAns));
  }
  return out;
}
function ownRows_(svId, withAns) {
  const sh = dataSheet_(), n = sh.getLastRow(); if (n < 2) return [];
  const pat = '\\|' + String(svId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  return sh.getRange(2, COL.KEY, n - 1, 1).createTextFinder(pat).useRegularExpression(true).findAll()
    .map(function (cell) { return rowView_(readRow_(sh, cell.getRow()), withAns); });
}
function poll_(me, d) {
  const since = +d.since || 0, last = +(CacheService.getScriptCache().get('LASTW') || 0), cv = catVer_();
  if (since && last && last < since - 1000) return {rows: [], catVer: cv};
  return {rows: allRows_(since), catVer: cv};
}
function svPoll_(me, d) {
  const since = +d.since || 0, w = +(CacheService.getScriptCache().get('W:' + me.id) || 0), cat = readCat_();
  const rows = since && w && w < since - 1000 ? [] : ownRows_(me.id, false).filter(function (x) { return !since || x.upd > since - 1000; });
  return {rows: rows, catVer: catVer_(), hid: svCatalog_(cat, me.id).hid};
}
function getSub_(me, d) {
  const sh = dataSheet_(), r = findRow_(sh, d.examId + '|' + d.svId);
  if (!r) throw new Error('Không tìm thấy bài làm.');
  return {row: rowView_(readRow_(sh, r), true)};
}
function getSubs_(me, d) { return {rows: allRows_(0, d.examIds || [], true)}; }
function imgs_(me, d) {
  const map = {}; (d.ids || []).slice(0, 12).forEach(function (id) { map[id] = dataUrl_(id); });
  return {map: map};
}

/* =============================== MẪU .XLS CỦA TRƯỜNG =============================== */

function saveTemplate_(me, d) {
  if (!d.b64) throw new Error('Thiếu tệp mẫu.');
  if (d.old) { try { DriveApp.getFileById(d.old).setTrashed(true); } catch (e) {} }
  const f = folder_('Mau xls').createFile(Utilities.newBlob(Utilities.base64Decode(d.b64), 'application/vnd.ms-excel', (d.secId || 'lop') + '__' + (d.name || 'mau.xls')));
  return {fileId: f.getId()};
}
function getTemplate_(me, d) { return {b64: Utilities.base64Encode(DriveApp.getFileById(d.fileId).getBlob().getBytes())}; }

/* =============================== NHẬP DỮ LIỆU CŨ =============================== */
/* Đưa dữ liệu của bản xem trước (tệp sao lưu JSON) lên máy chủ: gộp theo ID, bài làm đã có thì bỏ qua. */
function importAll_(me, d) {
  const data = d.data || {}, lock = LockService.getScriptLock(); lock.waitLock(28000);
  try {
    const cat = readCat_(), tIds = cat.teachers.map(function (t) { return t.id; });
    if (tIds.indexOf(me.id) < 0) { cat.teachers.push({id: me.id, name: me.name, email: me.email}); tIds.push(me.id); }
    const cnt = {};
    ['courses', 'sections', 'students', 'exams'].forEach(function (k) {
      (data[k] || []).forEach(function (x) {
        if (!x || !x.id) return;
        if (k === 'sections') { if (tIds.indexOf(x.teacherId) < 0) x.teacherId = me.id; if (x.template) delete x.template.b64; }
        const i = indexById_(cat[k], x.id); if (i >= 0) cat[k][i] = x; else cat[k].push(x);
        cnt[k] = (cnt[k] || 0) + 1;
      });
    });
    if (data.settings) ['judgeUrl', 'archiveEmail'].forEach(function (k) { if (data.settings[k]) cat.settings[k] = data.settings[k]; });
    const ver = writeCat_(cat);
    const sh = dataSheet_(), n = sh.getLastRow() - 1, have = {};
    if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r) { have[r[0]] = 1; });
    const out = [];
    (data.subs || []).forEach(function (s) {
      const e = examById_(cat, s.examId); if (!e || !s.svId) return;
      const key = e.id + '|' + s.svId; if (have[key]) return; have[key] = 1;
      const answers = s.answers || {}, unlocks = [];
      (s.leaves || []).forEach(function (L) { if (L.back && !L.auto && L.unlockedAt) unlocks.push({at: L.unlockedAt, by: L.unlockedBy || ''}); });
      extractImgs_(answers, e.id, s.svId);
      const m = svMeta_(answers);
      const sv = {startedAt: s.startedAt || null, submittedAt: s.submittedAt || null, leaves: cleanLeaves_(s.leaves), away: false, pasteBlocked: s.pasteBlocked || 0, flag: s.flag || '', answered: m.answered, nAtt: m.nAtt};
      const gv = {scores: s.scores || {}, feedback: s.feedback || {}, runs: s.runs || {}, extraMin: s.extraMin || 0, unlocks: unlocks, graded: !!s.graded};
      const total = sv.submittedAt ? (e.questions || []).reduce(function (a, q) { return a + (+gv.scores[q.id] || 0); }, 0) : '';
      out.push([key, s.id || ('s' + uid_()), e.id, s.svId, Date.now(), sv.submittedAt ? new Date(sv.submittedAt) : '', sv.leaves.length, JSON.stringify(sv)]
        .concat(ansCells_(answers, null, key)).concat([JSON.stringify(gv), total, '', Date.now()]));
    });
    if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, COL.N).setValues(out);
    touch_('');
    log_('nhập dữ liệu', me.email + ': ' + JSON.stringify(cnt) + ', ' + out.length + ' bài làm');
    return {catVer: ver, counts: cnt, subs: out.length};
  } finally { lock.releaseLock(); }
}

/* =============================== BẢNG DỄ ĐỌC =============================== */

const TABLES = {
  HocPhan:     ['ID', 'Mã HP', 'Tên học phần', 'Tín chỉ', 'CTĐT', 'Bậc', 'Ngưỡng đạt CLO (%)', 'Vượt kỳ vọng (%)', 'Đạt kỳ vọng (%)', 'Số CLO'],
  CLO:         ['ID học phần', 'Mã HP', 'CLO', 'Nội dung', 'Mục tiêu % SV đạt'],
  LopHocPhan:  ['ID', 'Mã HP', 'Tên học phần', 'Lớp', 'Học kỳ', 'Năm học', 'Khóa', 'Số SV', 'Tệp mẫu .xls', 'Lưu trữ lúc'],
  SinhVien:    ['MSSV', 'Họ và tên', 'Lớp sinh hoạt', 'Đã đổi mật khẩu'],
  DanhSachLop: ['ID lớp HP', 'Lớp', 'Mã HP', 'MSSV', 'Họ và tên'],
  DeThi:       ['ID', 'Mã HP', 'Tên đề', 'Loại', 'Thành phần', 'Số câu', 'Điểm tối đa', 'Thời lượng (phút)', 'Mở lúc', 'Đóng lúc', 'Trạng thái', 'Chế độ', 'Tính CLO', 'Giao cho lớp', 'Số SV được giao'],
  CauHoi:      ['ID đề', 'Tên đề', 'Câu', 'CLO', 'Điểm tối đa', 'Loại câu'],
  BaiLam:      ['ID bài', 'ID đề', 'Tên đề', 'MSSV', 'Họ và tên', 'Bắt đầu', 'Nộp lúc', 'Tổng điểm', 'Điểm tối đa', 'Câu chờ chấm', 'Số lần rời trình duyệt', 'Chặn dán chữ', 'Ảnh + link', 'Ghi chú'],
  Diem:        ['ID đề', 'Tên đề', 'MSSV', 'Họ và tên', 'Câu', 'CLO', 'Điểm', 'Tối đa', 'Nhận xét']
};
function dongBoBang() { return mirror_(); }
function mirror_() {
  const st = readCat_(), subs = allRows_(0);
  const C = function (id) { return st.courses.filter(function (c) { return c.id === id; })[0] || {}; };
  const Sv = function (id) { return st.students.filter(function (s) { return s.id === id; })[0] || {}; };
  const E = function (id) { return examById_(st, id) || {}; };
  const ts = function (x) { return x ? new Date(x) : ''; };
  const max = function (e) { return (e.questions || []).reduce(function (a, q) { return a + (+q.max || 0); }, 0); };
  const acc = {}, ash = accSheet_(); if (ash.getLastRow() > 1) ash.getRange(2, 1, ash.getLastRow() - 1, 1).getValues().forEach(function (r) { acc[r[0]] = 1; });
  const flat = function (a) { return [].concat.apply([], a); };
  const rows = {
    HocPhan: st.courses.map(function (c) { return [c.id, c.code, c.name, c.credits, c.program, c.level, c.threshold, (c.levels || {}).exceed, (c.levels || {}).expect, (c.clos || []).length]; }),
    CLO: flat(st.courses.map(function (c) { return (c.clos || []).map(function (k) { return [c.id, c.code, k.id, k.desc, k.target]; }); })),
    LopHocPhan: st.sections.map(function (s) { return [s.id, C(s.courseId).code, C(s.courseId).name, s.cls, s.semester, s.year, s.cohort, s.students.length, s.template ? s.template.name : '', s.archived ? ts(s.archived.at) : '']; }),
    SinhVien: st.students.map(function (s) { return [s.id, s.name, s.cls, acc['sv:' + normId_(s.id)] ? 'Có' : '']; }),
    DanhSachLop: flat(st.sections.map(function (s) { return s.students.map(function (id) { return [s.id, s.cls, C(s.courseId).code, id, Sv(id).name]; }); })),
    DeThi: st.exams.map(function (e) {
      return [e.id, C(e.courseId).code, e.title, e.cat === 'bt' ? 'Bài tập' : 'Thi ' + ({TL: 'viết', TN: 'trắc nghiệm', VD: 'vấn đáp', TH: 'thực hành'}[e.kind] || ''),
        e.component, (e.questions || []).length, max(e), e.duration, ts(e.opensAt), ts(e.closesAt), e.status, (e.proctor || {}).mode === 'free' ? 'Tự do' : 'Giám sát',
        e.cat === 'bt' && e.countClo === false ? 'Không' : 'Có', (e.sectionIds || []).map(function (id) { return (st.sections.filter(function (s) { return s.id === id; })[0] || {}).cls; }).join(', '), (e.assigned || []).length]; }),
    CauHoi: flat(st.exams.map(function (e) { return (e.questions || []).map(function (q) { return [e.id, e.title, q.label, q.clo, q.max, q.type]; }); })),
    BaiLam: subs.map(function (b) {
      const e = E(b.examId), qs = e.questions || [], sc = b.gv.scores || {};
      const tot = qs.reduce(function (a, q) { return a + (+sc[q.id] || 0); }, 0), pend = qs.filter(function (q) { return sc[q.id] == null; }).length;
      return [b.id, b.examId, e.title, b.svId, Sv(b.svId).name, ts(b.sv.startedAt), ts(b.submittedAt), b.submittedAt ? tot : '', max(e), b.submittedAt ? pend : '',
        (b.sv.leaves || []).length, b.sv.pasteBlocked || 0, b.sv.nAtt || 0, b.sv.flag || b.gv.flag || '']; }),
    Diem: flat(subs.filter(function (b) { return b.submittedAt; }).map(function (b) {
      const e = E(b.examId), sc = b.gv.scores || {}, fb = b.gv.feedback || {};
      return (e.questions || []).map(function (q) { return [b.examId, e.title, b.svId, Sv(b.svId).name, q.label, q.clo, sc[q.id] == null ? '' : sc[q.id], q.max, fb[q.id] || '']; }); }))
  };
  const counts = {};
  Object.keys(TABLES).forEach(function (n) { writeTable_(n, TABLES[n], rows[n]); counts[n] = rows[n].length; });
  PropertiesService.getScriptProperties().setProperty('MIRROR_AT', String(Date.now()));
  return {counts: {'học phần': counts.HocPhan, 'lớp HP': counts.LopHocPhan, 'SV': counts.SinhVien, 'đề': counts.DeThi, 'bài làm': counts.BaiLam}};
}
function writeTable_(name, header, rows) {
  if (!name || !header) throw new Error('Thiếu tên trang tính hoặc tiêu đề.');
  if ([CFG.DATA, 'TaiKhoan', 'CauHinh'].indexOf(String(name)) >= 0) throw new Error('Không ghi đè được trang tính hệ thống.');
  const sh = sheet_(String(name).slice(0, 95), header);
  sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#FFF0B8');
  const data = (rows || []).map(function (r) { return header.map(function (_, i) { const x = r[i]; return x == null ? '' : (typeof x === 'object' && !(x instanceof Date) ? JSON.stringify(x) : (typeof x === 'string' && /^0\d+$/.test(x) ? "'" + x : x)); }); });
  if (data.length) sh.getRange(2, 1, data.length, header.length).setValues(data);
  sh.setFrozenRows(1);
  return {sheet: sh.getName(), rows: data.length};
}

/* =============================== ĐỊNH KỲ, SAO LƯU, EMAIL =============================== */

/* Chạy 10 phút một lần: tự nộp bài đã quá giờ (kể cả khi SV tắt máy), rồi dựng lại bảng dễ đọc nếu có thay đổi. */
function dinhKy() {
  const cat = readCat_(), sh = dataSheet_(), n = sh.getLastRow() - 1, now = Date.now();
  if (n > 0) {
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      const a = sh.getRange(2, 1, n, COL.SVJ).getValues(), b = sh.getRange(2, COL.GVJ, n, 1).getValues();
      for (let i = 0; i < n; i++) {
        const sv = parse_(a[i][COL.SVJ - 1], {}), gv = parse_(b[i][0], {});
        if (sv.submittedAt || gv.forcedAt || !sv.startedAt) continue;
        const e = examById_(cat, String(a[i][0]).split('|')[0]); if (!e) continue;
        const dl = deadline_(e, sv.startedAt, gv.extraMin || 0);
        if (now > dl + CFG.GRACE || e.status === 'closed') {
          gv.forcedAt = Math.min(dl, now); gv.flag = e.status === 'closed' ? 'Nộp khi giảng viên đóng đề' : 'Hệ thống tự nộp khi hết giờ';
          const v = readRow_(sh, i + 2); gradeRow_(e, readAns_(v), gv, cat, false); writeGv_(sh, i + 2, gv, e, sv);
        }
      }
    } finally { lock.releaseLock(); }
  }
  const p = PropertiesService.getScriptProperties(), at = +(p.getProperty('MIRROR_AT') || 0);
  const last = Math.max(+(CacheService.getScriptCache().get('LASTW') || 0), catVer_());
  if (!at || last > at) mirror_();
}
function saoLuuHangNgay() {
  const dir = folder_('Sao luu'), day = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  catFile_().makeCopy('catalog_' + day + '.json', dir);
  const sh = dataSheet_(), n = sh.getLastRow();
  if (n > 1) dir.createFile('bailam_' + day + '.json', JSON.stringify(sh.getRange(1, 1, n, COL.N).getValues()), 'application/json');
  const files = []; const it = dir.getFiles(); while (it.hasNext()) files.push(it.next());
  files.sort(function (x, y) { return y.getDateCreated() - x.getDateCreated(); }).slice(CFG.BACKUP_KEEP * 2).forEach(function (x) { x.setTrashed(true); });
}
function mailArchive_(me, d) {
  if (!d.zip) throw new Error('Thiếu tệp lưu trữ.');
  const blob = Utilities.newBlob(Utilities.base64Decode(d.zip), 'application/zip', d.filename || 'luu-tru.zip');
  const file = folder_('Luu tru').createFile(blob);
  let mailed = false;
  if (d.email && blob.getBytes().length <= CFG.MAIL_LIMIT) {
    MailApp.sendEmail({to: d.email, subject: d.subject || ('[Khảo thí CLO] ' + blob.getName()),
      body: 'Gói lưu trữ kết quả học phần đính kèm.\nBản lưu trên Google Drive: ' + file.getUrl() + '\n\n— Khảo thí CLO', attachments: [blob]});
    mailed = true;
  }
  log_('lưu trữ', blob.getName() + (mailed ? ' → ' + d.email : ' (chỉ lưu Drive)'));
  return {url: file.getUrl(), mailed: mailed};
}

/* =============================== TIỆN ÍCH =============================== */

function uid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (header) sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#FFF0B8'); sh.setFrozenRows(1); }
  return sh;
}
function folder_(path) {
  const it = DriveApp.getFoldersByName(CFG.FOLDER);
  let f = it.hasNext() ? it.next() : DriveApp.createFolder(CFG.FOLDER);
  String(path || '').split('/').map(function (s) { return s.trim(); }).filter(String).forEach(function (p) { const sub = f.getFoldersByName(p); f = sub.hasNext() ? sub.next() : f.createFolder(p); });
  return f;
}
function log_(event, detail) {
  const sh = sheet_('NhatKy', ['Thời điểm', 'Sự kiện', 'Chi tiết']);
  sh.appendRow([new Date(), event || '', String(detail || '').slice(0, 5000)]);
  return {};
}
