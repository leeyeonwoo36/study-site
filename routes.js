/* =========================================================
   탭별 주소 — 화면을 옮길 때마다 주소창이 바뀌고, 새로고침·뒤로가기·링크 공유가 된다
   학생: /  /hw  /exam  /wrong  /video  /me  /daily  /book
   관리자: /admin/schedule  /admin/attendance  /admin/students ...  (탭 이름 = 탭 id에서 'a-' 뺀 것)
   (없는 주소로 들어오면 404.html이 /?p=주소 로 보내 주고, 여기서 주소창을 원래대로 되돌린다)
   ========================================================= */
const STU_PATH = { 't-main': '/', 't-hw': '/hw', 't-exam': '/exam', 't-wrong': '/wrong', 't-video': '/video', 't-me': '/me' };
const STU_TAB = Object.fromEntries(Object.entries(STU_PATH).map(([k, v]) => [v, k]));
let ROUTING = false;
let adminTabNow = 'a-schedule',
  stuTabNow = 't-main';

function routeNorm(p) {
  p = String(p || '/').split('?')[0].split('#')[0].replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return p === '' ? '/' : p;
}
/* 주소창만 바꾼다(기록은 쌓지 않음). 뒤로가기는 앱의 '뒤로가기 가드'가 화면 안에서 한 단계씩 처리한다 */
function routeSet(path) {
  try {
    if (ROUTING || routeNorm(location.pathname) === path) return;
    history.replaceState(history.state, '', path);
  } catch (e) {}
}
/* 들어온 주소 (404.html 경유 ?p= 와 옛 ?daily=1 도 받는다) */
const ROUTE0 = (function () {
  try {
    const q = new URLSearchParams(location.search);
    let p = q.get('p') || (q.get('daily') === '1' ? '/daily' : null);
    if (p) {
      p = routeNorm(p);
      history.replaceState(null, '', p);
      return p;
    }
    return routeNorm(location.pathname);
  } catch (e) {
    return '/';
  }
})();

const adminPathOf = id => '/admin/' + id.replace(/^a-/, '');
function routeCurrentPath(site) {
  if (site === 'admin') return adminPathOf(adminTabNow);
  if (site === 'daily') return '/daily';
  if (site === 'book') return '/book';
  if (site === 'student') return STU_PATH[stuTabNow] || '/';
  return null;
}

/* 주소 → 화면 (로그인된 상태에서만). replace=true면 주소창도 맞춰 둔다 */
function routeApply(path, replace) {
  path = routeNorm(path);
  ROUTING = true;
  let fin = null;
  try {
    if (currentUserIsAdmin) {
      if (previewingStudent) return;
      let id = 'a-schedule';
      const m = path.match(/^\/admin(?:\/([a-z0-9-]+))?$/);
      if (m && m[1] && document.getElementById('tab-a-' + m[1])) id = 'a-' + m[1];
      setAdminTab(id);
      fin = adminPathOf(id);
    } else if (currentStudent) {
      if (path === '/daily') {
        DAILY.view = 'sheet';
        DAILY.date = dToday();
        switchSite('daily');
        fin = '/daily';
      } else if (path === '/book') {
        BOOK.view = 'list';
        switchSite('book');
        fin = '/book';
      } else {
        switchSite('student');
        setStudentTab(STU_TAB[path] || 't-main');
        fin = STU_PATH[stuTabNow] || '/';
      }
    }
  } finally {
    ROUTING = false;
  }
  if (replace && fin) {
    try {
      history.replaceState(history.state, '', fin);
    } catch (e) {}
  }
}

/* ---- 기존 함수를 감싸서 주소를 따라가게 한다 ---- */
(function () {
  const _admin = window.setAdminTab,
    _stu = window.setStudentTab,
    _site = window.switchSite,
    _auth = window.routeAfterAuth,
    _logout = window.logout;
  window.setAdminTab = function (id) {
    adminTabNow = id;
    const r = _admin.apply(this, arguments);
    if (currentUserIsAdmin && !previewingStudent) routeSet(adminPathOf(id));
    return r;
  };
  window.setStudentTab = function (id) {
    stuTabNow = id;
    const r = _stu.apply(this, arguments);
    if (currentStudent && !currentUserIsAdmin) routeSet(STU_PATH[id] || '/');
    return r;
  };
  window.switchSite = function (site) {
    const r = _site.apply(this, arguments);
    if (site === 'login') return r;
    if (currentUserIsAdmin && site !== 'admin') return r; // 관리자의 학생 화면 보기는 주소를 바꾸지 않는다
    const p = routeCurrentPath(site);
    if (p) routeSet(p);
    return r;
  };
  window.routeAfterAuth = async function (user) {
    const want = routeNorm(location.pathname);
    DAILY.direct = want === '/daily';
    if (want !== '/' && !/^\/admin/.test(want)) {
      try {
        sessionStorage.setItem('dgDone', dToday()); // 링크로 바로 들어온 경우엔 선택 화면을 건너뛴다
      } catch (e) {}
    }
    ROUTING = true;
    let ok;
    try {
      ok = await _auth.apply(this, arguments);
    } finally {
      ROUTING = false;
    }
    if (ok) routeApply(want, true);
    return ok;
  };
  window.logout = function () {
    const was = previewingStudent;
    const r = _logout.apply(this, arguments);
    if (!was) {
      adminTabNow = 'a-schedule';
      stuTabNow = 't-main';
      try {
        history.replaceState(null, '', '/');
      } catch (e) {}
    }
    return r;
  };
  /* 뒤로가기 가드가 끝난 뒤, 주소창이 지금 화면과 같은지 한 번 더 맞춘다 */
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      let site = null;
      if (currentUserIsAdmin) site = previewingStudent ? null : 'admin';
      else if (currentStudent) site = $('shell-daily') && $('shell-daily').style.display !== 'none' ? 'daily' : $('shell-book') && $('shell-book').style.display !== 'none' ? 'book' : 'student';
      const p = site && routeCurrentPath(site);
      if (p) routeSet(p);
    }, 0);
  });
})();
