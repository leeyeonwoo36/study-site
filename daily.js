/* =========================================================
   주간지 제출 (주소: /daily)
   - dailies/{날짜}        문제 틀(문항 수·유형). 승인된 학생이 읽음
   - dailyKeys/{날짜}      정답·해설. 관리자 전용, 학생은 제출한 뒤에만 읽음
   - dailySubs/{날짜|uid}  학생 제출 (당일이면 late=false, 지난 주간지면 late=true)
   ========================================================= */
const DAILY = { sheets: [], subs: {}, keys: {}, keyState: {}, view: 'sheet', date: null, draft: {}, direct: false };
const DOWK = ['일', '월', '화', '수', '목', '금', '토'];
const dToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dDow = ds => new Date(ds + 'T00:00:00Z').getUTCDay();
const dIsWeekday = ds => dDow(ds) >= 1 && dDow(ds) <= 5;
const dLabel = ds => {
  const p = String(ds).split('-');
  return +p[1] + '월 ' + +p[2] + '일 (' + DOWK[dDow(ds)] + ')';
};
const dSheet = ds => DAILY.sheets.find(s => s.date === ds);
const dMySub = ds => DAILY.subs[ds + '|' + currentStudent];
const dEsc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

/* ---------- 주소 (/daily) ---------- */
(function () {
  try {
    if (/[?&]daily=1/.test(location.search) || /^\/daily\/?$/.test(location.pathname)) {
      DAILY.direct = true;
      if (!/^\/daily\/?$/.test(location.pathname)) history.replaceState(null, '', '/daily');
    }
  } catch (e) {}
})();
function dSetUrl(path, replace) {
  try {
    if (location.pathname === path) return;
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  } catch (e) {}
}
window.addEventListener('popstate', () => {
  if (!currentStudent || currentUserIsAdmin) return;
  if (/^\/daily\/?$/.test(location.pathname)) openDaily(false);
  else switchSite('student');
});

/* ---------- 구독 (startSubscriptions / stopSubscriptions 에서 불러 줌) ---------- */
window.dailyOnSubs = function (sub, isAdmin, ownerUid) {
  const { db, collection, query, where } = window.fb;
  sub('dailies', snap => {
    DAILY.sheets = snap.docs.map(d => ({ ...d.data(), date: d.id })).sort((a, b) => (a.date < b.date ? 1 : -1));
    dailyRender();
  });
  const subRef = isAdmin ? collection(db, 'dailySubs') : query(collection(db, 'dailySubs'), where('studentUid', '==', ownerUid));
  sub(
    'dailySubs',
    snap => {
      DAILY.subs = {};
      snap.docs.forEach(d => (DAILY.subs[d.id] = d.data()));
      dailyRender();
    },
    subRef
  );
  if (isAdmin)
    sub('dailyKeys', snap => {
      DAILY.keys = {};
      snap.docs.forEach(d => (DAILY.keys[d.id] = (d.data() || {}).answers || {}));
      dailyRender();
    });
};
window.dailyReset = function () {
  DAILY.sheets = [];
  DAILY.subs = {};
  DAILY.keys = {};
  DAILY.keyState = {};
  DAILY.draft = {};
};
function dailyRender() {
  try {
    renderDailyCard();
    renderDailyView();
    renderDailyAdmin();
  } catch (e) {
    console.error('주간지 화면 오류:', e);
  }
}

/* ---------- 채점 ---------- */
const CIRC = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9' };
function dNorm(v, type) {
  let s = String(v == null ? '' : v).replace(/[①-⑨]/g, c => CIRC[c]);
  if (type === 'short') return s.replace(/\s+/g, '').toLowerCase();
  return s
    .split(/[,/·\s]+/)
    .filter(Boolean)
    .sort()
    .join(',');
}
function dCorrect(item, mine, key) {
  if (mine == null || mine === '' || key == null || key === '') return false;
  if (item.type === 'short') {
    const m = dNorm(mine, 'short');
    return String(key)
      .split('|')
      .some(k => dNorm(k, 'short') === m);
  }
  return dNorm(mine) === dNorm(key);
}
function dScore(date, uid) {
  const sh = dSheet(date),
    sub = DAILY.subs[date + '|' + uid],
    key = DAILY.keys[date];
  if (!sh || !sub || !key) return null;
  let n = 0;
  (sh.items || []).forEach(it => {
    const k = key[it.n];
    if (k && dCorrect(it, (sub.answers || {})[it.n], k.a)) n++;
  });
  return n;
}

/* =========================================================
   학생 화면
   ========================================================= */
function openDaily(push) {
  if (!currentStudent) return;
  DAILY.view = 'sheet';
  DAILY.date = dToday();
  switchSite('daily');
  if (push !== false) dSetUrl('/daily');
  window.scrollTo(0, 0);
}
function closeDaily() {
  switchSite('student');
  dSetUrl('/');
  renderDailyCard();
}
function dailyOpenSheet(date) {
  DAILY.view = 'sheet';
  DAILY.date = date;
  renderDailyView();
  window.scrollTo(0, 0);
}
function dailyShowList() {
  DAILY.view = 'list';
  renderDailyView();
  window.scrollTo(0, 0);
}

/* 메인 화면 위쪽 카드 */
function renderDailyCard() {
  const box = $('stu-daily-card');
  if (!box) return;
  if (!currentStudent) {
    box.innerHTML = '';
    return;
  }
  const t = dToday(),
    sh = dSheet(t),
    sub = dMySub(t);
  const missed = DAILY.sheets.filter(s => s.date < t && !dMySub(s.date)).length;
  let msg, tag;
  if (sh) {
    msg = sub ? '오늘 주간지를 제출했어요' : '오늘 주간지가 올라왔어요';
    tag = sub ? '<span class="dly-tag ok">제출 완료</span>' : '<span class="dly-tag todo">미제출</span>';
  } else {
    msg = dIsWeekday(t) ? '오늘 주간지는 아직 등록되지 않았어요' : '주말에는 주간지가 없어요';
    tag = '';
  }
  box.innerHTML = `<div class="dly-card" onclick="openDaily()" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openDaily()">
    <div class="dly-ico">📝</div>
    <div class="dly-txt"><b>주간지 제출 ${tag}</b><span>${msg}${missed ? ` · 지난 주간지 ${missed}개 미제출` : ''}</span></div>
    <div class="dly-go">열기 ›</div></div>`;
}

/* 로그인 직후 선택 화면 (월~금만) */
function dailyAfterLogin() {
  if (DAILY.direct) {
    DAILY.direct = false;
    openDaily(false);
    return;
  }
  let done = false;
  try {
    done = sessionStorage.getItem('dgDone') === dToday();
  } catch (e) {}
  if (done || !dIsWeekday(dToday())) return;
  const g = $('daily-gate');
  if (!g) return;
  $('dg-date').textContent = '오늘은 ' + dLabel(dToday()) + '입니다';
  g.hidden = false;
  document.body.classList.add('dg-open');
  const b = g.querySelector('button');
  if (b) b.focus();
}
function dailyGate(which) {
  try {
    sessionStorage.setItem('dgDone', dToday());
  } catch (e) {}
  $('daily-gate').hidden = true;
  document.body.classList.remove('dg-open');
  if (which === 'daily') openDaily();
}
window.dailyHideGate = function () {
  const g = $('daily-gate');
  if (g) g.hidden = true;
  document.body.classList.remove('dg-open');
  try {
    sessionStorage.removeItem('dgDone');
  } catch (e) {}
};

/* 본문 */
function renderDailyView() {
  const box = $('daily-body');
  if (!box || !$('shell-daily') || $('shell-daily').style.display === 'none') return;
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT' && box.contains(ae)) return; // 주관식 입력 중에는 다시 그리지 않는다
  const t = dToday();
  $('dly-top-sub').textContent = dLabel(t);
  $('dly-top-btn').innerHTML =
    DAILY.view === 'list'
      ? `<button class="btn small" onclick="dailyOpenSheet('${t}')">오늘 주간지</button>`
      : `<button class="btn small secondary" onclick="dailyShowList()">지난 주간지 보기</button>`;
  box.innerHTML = DAILY.view === 'list' ? dailyListHtml() : dailySheetHtml(DAILY.date || t);
  if (DAILY.view !== 'list') dailyProg(DAILY.date || t);
}
function dailyListHtml() {
  const t = dToday();
  const past = DAILY.sheets.filter(s => s.date < t);
  const rows = past
    .map(s => {
      const sub = dMySub(s.date);
      const tag = sub ? (sub.late ? '<span class="dly-tag late">지연 제출</span>' : '<span class="dly-tag ok">당일 제출</span>') : '<span class="dly-tag todo">미제출</span>';
      return `<button class="dly-row" onclick="dailyOpenSheet('${s.date}')">
        <div><b>${dLabel(s.date)}</b><span>${dEsc(s.title || '주간지')} · ${(s.items || []).length}문항</span></div>${tag}</button>`;
    })
    .join('');
  const miss = past.filter(s => !dMySub(s.date)).length;
  return `<h2 class="dly-h">지난 주간지</h2>
    <p class="dly-sub">${past.length ? (miss ? `아직 제출하지 않은 주간지가 ${miss}개 있어요. 눌러서 제출하면 '지연 제출'로 기록돼요.` : '모두 제출했어요. 잘하고 있어요!') : '지난 주간지가 아직 없어요.'}</p>
    <div class="dly-list">${rows}</div>`;
}
function dailySheetHtml(date) {
  const sh = dSheet(date);
  const t = dToday();
  if (!sh || date > t) {
    return `<div class="dly-empty"><div class="dly-ico big">📝</div><h2>${dLabel(date)}</h2>
      <p>${date === t ? (dIsWeekday(t) ? '오늘 주간지가 아직 등록되지 않았어요.' : '주말에는 주간지가 없어요.') : '이 날짜의 주간지가 없어요.'}</p>
      <button class="btn secondary" onclick="dailyShowList()">지난 주간지 보기</button></div>`;
  }
  const sub = dMySub(date);
  const head = `<div class="dly-head"><div class="dly-date">${dLabel(date)}${date === t ? ' · 오늘' : ''}</div><h2>${dEsc(sh.title || '주간지')}</h2></div>`;
  return sub ? head + dailyResultHtml(sh, sub) : head + dailyFormHtml(sh, date === t);
}

/* 답 체크 */
function dailyFormHtml(sh, isToday) {
  const d = (DAILY.draft[sh.date] = DAILY.draft[sh.date] || {});
  const items = sh.items || [];
  const rows = items
    .map(it => {
      const cur = d[it.n] || '';
      let inp;
      if (it.type === 'short') {
        inp = `<input class="dly-short" type="text" placeholder="답 입력" value="${dEsc(cur)}" oninput="dailyType('${sh.date}',${it.n},this.value)" autocomplete="off">`;
      } else {
        const sel = cur.split(',');
        inp =
          `<div class="dly-opts">` +
          Array.from({ length: it.choices || 5 }, (_, i) => {
            const v = String(i + 1);
            return `<button type="button" class="dly-b${sel.includes(v) ? ' on' : ''}" onclick="dailyPick('${sh.date}',${it.n},'${v}',${it.type === 'multi'})" aria-pressed="${sel.includes(v)}">${v}</button>`;
          }).join('') +
          `</div>`;
      }
      return `<div class="dly-q" data-n="${it.n}"><div class="dly-n">${it.n}번${it.type === 'multi' ? '<small>복수</small>' : ''}</div>${inp}</div>`;
    })
    .join('');
  const note = isToday
    ? '답을 고르고 <b>제출</b>을 누르세요. 제출하면 정답과 해설이 바로 열려요. 제출 후에는 고칠 수 없어요.'
    : `<b>지난 주간지</b>예요. 지금 제출하면 <b>'지연 제출'</b>로 기록돼요.`;
  return `<div class="dly-note${isToday ? '' : ' late'}">${note}</div>
    <div class="dly-qs">${rows}</div>
    <div class="dly-bar"><span id="dly-prog"></span><button class="btn" onclick="dailySubmit('${sh.date}')">제출하기</button></div>`;
}
function dailyProg(date) {
  const el = $('dly-prog'),
    sh = dSheet(date);
  if (!el || !sh) return;
  const d = DAILY.draft[date] || {};
  const n = (sh.items || []).filter(it => String(d[it.n] || '').trim() !== '').length;
  el.textContent = `답한 문항 ${n} / ${(sh.items || []).length}`;
}
function dailyPick(date, n, v, multi) {
  const d = (DAILY.draft[date] = DAILY.draft[date] || {});
  let cur = d[n] ? String(d[n]).split(',') : [];
  if (multi) cur = cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v);
  else cur = cur.includes(v) ? [] : [v];
  d[n] = cur.sort().join(',');
  const row = document.querySelector(`#daily-body .dly-q[data-n="${n}"]`);
  if (row)
    row.querySelectorAll('.dly-b').forEach(b => {
      const on = d[n].split(',').includes(b.textContent.trim());
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  dailyProg(date);
}
function dailyType(date, n, v) {
  (DAILY.draft[date] = DAILY.draft[date] || {})[n] = v;
  dailyProg(date);
}
async function dailySubmit(date) {
  const sh = dSheet(date);
  if (!sh || !currentStudent) return;
  if (previewingStudent || adminViewAll || currentUserIsAdmin) {
    alert('학생 화면 보기에서는 제출할 수 없습니다.');
    return;
  }
  if (dMySub(date)) return;
  const d = DAILY.draft[date] || {};
  const items = sh.items || [];
  const blank = items.filter(it => String(d[it.n] || '').trim() === '').length;
  const late = date !== dToday();
  const msg = (blank ? `답하지 않은 문항이 ${blank}개 있어요. ` : '') + (late ? "지난 주간지는 '지연 제출'로 기록돼요. " : '') + '제출하면 고칠 수 없어요. 제출할까요?';
  if (!confirm(msg)) return;
  const answers = {};
  items.forEach(it => {
    if (String(d[it.n] || '').trim() !== '') answers[it.n] = String(d[it.n]).trim();
  });
  try {
    const { db, doc, setDoc } = window.fb;
    await setDoc(doc(db, 'dailySubs', date + '|' + currentStudent), {
      studentUid: currentStudent,
      date,
      answers,
      total: items.length,
      late,
      submittedAt: Date.now()
    });
    delete DAILY.draft[date];
    dailyLoadKey(date, true);
  } catch (e) {
    console.error('주간지 제출 실패:', e);
    alert('제출하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.\n(' + (e.code || e.message) + ')');
  }
}

/* 결과 + 정답·해설 */
async function dailyLoadKey(date, force) {
  if (currentUserIsAdmin || !currentStudent) return;
  const st = DAILY.keyState[date];
  if (!force && (st === 'ok' || st === 'loading' || st === 'none')) return;
  DAILY.keyState[date] = 'loading';
  try {
    const { db, doc, getDoc } = window.fb;
    const snap = await getDoc(doc(db, 'dailyKeys', date));
    if (snap.exists()) {
      DAILY.keys[date] = (snap.data() || {}).answers || {};
      DAILY.keyState[date] = 'ok';
    } else DAILY.keyState[date] = 'none';
  } catch (e) {
    console.warn('주간지 정답 읽기 실패:', e.code || e.message);
    DAILY.keyState[date] = 'err';
  }
  renderDailyView();
}
function dailyResultHtml(sh, sub) {
  const date = sh.date;
  if (!DAILY.keys[date] && !['none', 'err'].includes(DAILY.keyState[date])) dailyLoadKey(date);
  const key = DAILY.keys[date];
  const tagLate = sub.late ? '<span class="dly-tag late">지연 제출</span>' : '<span class="dly-tag ok">당일 제출</span>';
  if (!key) {
    const m = DAILY.keyState[date] === 'none' ? '정답·해설이 아직 등록되지 않았어요. 등록되면 여기에 나타나요.' : DAILY.keyState[date] === 'err' ? '정답을 불러오지 못했어요. 잠시 뒤 다시 열어 보세요.' : '정답과 해설을 불러오는 중이에요…';
    return `<div class="dly-done"><div class="dly-ico big">✅</div><h3>제출 완료 ${tagLate}</h3><p>${m}</p></div>`;
  }
  const items = sh.items || [];
  let ok = 0;
  const rows = items
    .map(it => {
      const k = key[it.n] || {},
        mine = (sub.answers || {})[it.n];
      const good = dCorrect(it, mine, k.a);
      if (good) ok++;
      const show = v => (v == null || v === '' ? '<i>무응답</i>' : dEsc(String(v).replace(/,/g, ', ')));
      return `<div class="dly-r ${good ? 'good' : 'bad'}">
        <div class="dly-rh"><b>${it.n}번</b><span class="dly-mark">${good ? '정답' : '오답'}</span></div>
        <div class="dly-ans"><span>내 답 <b>${show(mine)}</b></span>${good ? '' : `<span>정답 <b>${show(String(k.a == null ? '' : k.a).replace(/\|/g, ' 또는 '))}</b></span>`}</div>
        ${k.e ? `<details class="dly-exp"${good ? '' : ' open'}><summary>해설</summary><div>${dEsc(k.e).replace(/\n/g, '<br>')}</div></details>` : ''}</div>`;
    })
    .join('');
  const pct = items.length ? Math.round((ok / items.length) * 100) : 0;
  return `<div class="dly-score"><div><span class="dly-sc-n">${ok}</span><span class="dly-sc-t"> / ${items.length}</span></div><div class="dly-sc-r">${tagLate}<small>정답률 ${pct}%</small></div></div>
    <div class="dly-rs">${rows}</div>
    <div class="dly-after"><button class="btn secondary" onclick="dailyShowList()">지난 주간지 보기</button><button class="btn ghost" onclick="closeDaily()">메인으로</button></div>`;
}

/* =========================================================
   관리자: 주간지 등록(JSON) · 제출 현황
   ========================================================= */
const DAILY_SPEC = `주간지 정답·해설을 아래 JSON 규격으로 만들어 주세요. 설명 없이 JSON만 코드블록 하나로 출력해 주세요.

규칙
- 주간지 한 장(하루치)이 JSON 하나입니다. 여러 날짜를 한꺼번에 만들 때는 맨 바깥을 {"sheets":[ ... ]} 로 묶어 주세요.
- "date": 주간지 날짜(YYYY-MM-DD, 월~금). 학생은 이 날짜에 당일 제출해야 하고, 그 뒤에는 '지연 제출'이 됩니다.
- "title": 주간지 제목(예: 10월 3주차 월요일).
- "questions": 문항 목록. 각 문항에
  · "n": 문항 번호(1부터)
  · "type": "mc"(객관식 단일 정답) / "multi"(객관식 복수 정답) / "short"(주관식)
  · "choices": 보기 개수(객관식만, 기본 5)
  · "answer": 정답. mc는 "3", multi는 "1,3", short는 "비국가 행위자" (인정할 답이 여럿이면 "NGO|비정부기구"처럼 | 로 구분)
  · "explain": 해설(문장으로, 줄바꿈은 \\n)
- 문제 본문은 넣지 않습니다(학생은 종이·PDF로 풉니다).

예시
{
  "date": "2026-10-19",
  "title": "10월 3주차 월요일",
  "questions": [
    {"n":1,"type":"mc","choices":5,"answer":"3","explain":"③은 ... 때문에 옳습니다."},
    {"n":2,"type":"multi","choices":5,"answer":"1,4","explain":"..."},
    {"n":3,"type":"short","answer":"비국가 행위자|비국가행위자","explain":"..."}
  ]
}`;
function dailyCopySpec() {
  Promise.resolve(copyText(DAILY_SPEC)).then(() => alert('복사했습니다. Claude 대화에 붙여넣고 정답·해설 자료와 함께 "이 규격으로 만들어줘"라고 요청하세요.'));
}
function dailyPickFile(inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    $('daily-json').value = String(r.result || '');
    dailyMsg('파일을 불러왔습니다. 아래 [검사하고 등록]을 누르세요.', false);
  };
  r.readAsText(f, 'utf-8');
  inp.value = '';
}
function dailyMsg(t, bad) {
  const m = $('daily-msg');
  if (!m) return;
  m.textContent = t;
  m.style.color = bad ? 'var(--accent)' : 'var(--brand)';
}
/* JSON → 등록할 주간지 목록 (문제가 있으면 문장으로 알려 준다) */
function dailyParse(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!raw) throw new Error('JSON을 붙여넣거나 파일을 선택하세요.');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error('JSON 형식이 올바르지 않습니다: ' + e.message);
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.sheets) ? data.sheets : [data];
  const out = [];
  list.forEach((s, si) => {
    const tag = list.length > 1 ? `${si + 1}번째 주간지: ` : '';
    if (!s || typeof s !== 'object') throw new Error(tag + '주간지 형식이 아닙니다.');
    const date = String(s.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z'))) throw new Error(tag + '"date"는 2026-10-19 같은 날짜여야 합니다.');
    const qs = Array.isArray(s.questions) ? s.questions : null;
    if (!qs || !qs.length) throw new Error(tag + '"questions"가 비어 있습니다.');
    const items = [],
      answers = {};
    qs.forEach((q, i) => {
      const n = Number.isInteger(+q.n) && +q.n > 0 ? +q.n : i + 1;
      const type = ['mc', 'multi', 'short'].includes(q.type) ? q.type : q.type == null ? 'mc' : null;
      if (!type) throw new Error(`${tag}${n}번: "type"은 mc / multi / short 중 하나여야 합니다.`);
      if (items.some(x => x.n === n)) throw new Error(`${tag}${n}번이 두 번 있습니다.`);
      const a = q.answer == null ? '' : String(q.answer).trim();
      if (!a) throw new Error(`${tag}${n}번: "answer"가 비어 있습니다.`);
      const it = { n, type };
      if (type !== 'short') {
        const c = q.choices == null ? 5 : +q.choices;
        if (!Number.isInteger(c) || c < 2 || c > 9) throw new Error(`${tag}${n}번: "choices"는 2~9 사이 정수여야 합니다.`);
        it.choices = c;
        const toks = dNorm(a).split(',');
        if (type === 'mc' && toks.length !== 1) throw new Error(`${tag}${n}번: mc는 정답이 하나여야 합니다(복수 정답이면 multi).`);
        if (toks.some(t => !/^\d$/.test(t) || +t < 1 || +t > c)) throw new Error(`${tag}${n}번: 정답이 보기 범위(1~${c})를 벗어났습니다.`);
      }
      items.push(it);
      answers[n] = { a: type === 'short' ? a : dNorm(a), e: String(q.explain || q.explanation || '').trim() };
    });
    items.sort((x, y) => x.n - y.n);
    out.push({ date, title: String(s.title || '').trim() || '주간지', items, answers });
  });
  const dup = out.map(o => o.date).filter((d, i, a) => a.indexOf(d) !== i);
  if (dup.length) throw new Error('같은 날짜가 두 번 있습니다: ' + [...new Set(dup)].join(', '));
  return out;
}
async function dailyRegister() {
  let sheets;
  try {
    sheets = dailyParse($('daily-json').value);
  } catch (e) {
    dailyMsg(e.message, true);
    return;
  }
  const weekend = sheets.filter(s => !dIsWeekday(s.date)).map(s => dLabel(s.date));
  const exists = sheets.filter(s => dSheet(s.date)).map(s => dLabel(s.date));
  let ask = `주간지 ${sheets.length}개를 등록합니다.\n` + sheets.map(s => `· ${dLabel(s.date)} ${s.title} (${s.items.length}문항)`).join('\n');
  if (weekend.length) ask += `\n\n⚠️ 주말 날짜가 있습니다: ${weekend.join(', ')}`;
  if (exists.length) ask += `\n\n⚠️ 이미 등록된 날짜는 덮어씁니다(학생 제출 기록은 그대로): ${exists.join(', ')}`;
  if (!confirm(ask + '\n\n진행할까요?')) return;
  try {
    const { db, doc, setDoc } = window.fb;
    for (const s of sheets) {
      await setDoc(doc(db, 'dailies', s.date), { date: s.date, title: s.title, items: s.items, count: s.items.length, updatedAt: Date.now() });
      await setDoc(doc(db, 'dailyKeys', s.date), { date: s.date, answers: s.answers, updatedAt: Date.now() });
    }
    dailyMsg(`${sheets.length}개 등록했습니다.`, false);
    $('daily-json').value = '';
  } catch (e) {
    console.error(e);
    dailyMsg('등록하지 못했습니다: ' + (e.code || e.message), true);
  }
}
async function dailyDelete(date) {
  if (!confirm(`${dLabel(date)} 주간지를 삭제할까요?\n학생 제출 기록과 정답·해설도 함께 지워지며 되돌릴 수 없습니다.`)) return;
  try {
    const { db, doc, deleteDoc } = window.fb;
    await Promise.all(Object.keys(DAILY.subs).filter(k => k.startsWith(date + '|')).map(k => deleteDoc(doc(db, 'dailySubs', k))));
    await deleteDoc(doc(db, 'dailyKeys', date));
    await deleteDoc(doc(db, 'dailies', date));
  } catch (e) {
    alert('삭제하지 못했습니다: ' + (e.code || e.message));
  }
}
function dailyTargets() {
  return (typeof students !== 'undefined' ? students : []).filter(s => s.approved && !(typeof isTestAcct === 'function' && isTestAcct(s)));
}
function renderDailyAdmin() {
  const box = $('daily-admin-list');
  if (!box) return;
  const open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.d));
  const targets = dailyTargets();
  const hm = ms => {
    const d = new Date(ms + 9 * 3600e3);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  box.innerHTML =
    DAILY.sheets
      .map(s => {
        const subs = targets.map(st => ({ st, sub: DAILY.subs[s.date + '|' + st.uid] }));
        const done = subs.filter(x => x.sub);
        const miss = subs.filter(x => !x.sub);
        const late = done.filter(x => x.sub.late).length;
        const rows = done
          .map(x => {
            const sc = dScore(s.date, x.st.uid);
            return `<tr><td>${dEsc(x.st.name)}</td><td>${sc == null ? '-' : sc + ' / ' + (s.items || []).length}</td><td>${x.sub.late ? '<span class="badge warn">지연</span>' : '<span class="badge good">당일</span>'}</td><td>${hm(x.sub.submittedAt || 0)}</td></tr>`;
          })
          .join('');
        return `<details class="dly-ad" data-d="${s.date}"${open.has(s.date) ? ' open' : ''}>
        <summary><b>${dLabel(s.date)}</b> <span>${dEsc(s.title || '')}</span><span class="badge">${(s.items || []).length}문항</span>
          <span class="badge ${miss.length ? 'warn' : 'good'}">제출 ${done.length}/${targets.length}${late ? ' · 지연 ' + late : ''}</span></summary>
        <div class="dly-ad-in">
          ${done.length ? `<table><tr><th>이름</th><th>점수</th><th>구분</th><th>제출</th></tr>${rows}</table>` : '<p class="empty-hint">아직 제출한 학생이 없습니다.</p>'}
          ${miss.length ? `<p class="dly-miss"><b>미제출 ${miss.length}명</b> ${miss.map(x => dEsc(x.st.name)).join(', ')}</p>` : ''}
          <div style="margin-top:8px"><button class="btn small danger" onclick="dailyDelete('${s.date}')">이 주간지 삭제</button></div>
        </div></details>`;
      })
      .join('') || '<p class="empty-hint">등록된 주간지가 없습니다. 위에서 JSON을 등록하세요.</p>';
}
