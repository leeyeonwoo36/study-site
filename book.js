/* =========================================================
   문제집 제출 (/book) — 원본(마더텅 기출) 문항을 고르고, 그 변형 2문항을 풀어 제출한다
   books/{bookId}            문제집: items[{n, motherNo, source, rate, point, variants[2]}]
   bookKeys/{bookId|n}       그 문항의 정답·해설 (제출한 뒤에만 학생에게 열림)
   bookSubs/{bookId|n|uid}   학생 제출 (원본 문항 하나당 한 번)
   ========================================================= */
const BOOK = { books: [], subs: {}, keys: {}, keyState: {}, draft: {}, bid: null, n: null, view: 'list', open: new Set() };
const bkEsc = s => (typeof dEsc === 'function' ? dEsc(s) : String(s == null ? '' : s));
const bkMotherTxt = it => {
  const m = String(it.motherNo == null ? '' : it.motherNo).trim();
  return '마더텅 ' + (/번$/.test(m) ? m : m + '번');
};
const bkBook = id => BOOK.books.find(b => b.id === id);
const bkSub = (bid, n) => BOOK.subs[bid + '|' + n + '|' + currentStudent];
const bkItem = (b, n) => (b && b.items || []).find(x => String(x.n) === String(n));
function bkHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ---------- 구독 ---------- */
window.bookOnSubs = function (sub, isAdmin, ownerUid) {
  const { db, collection, query, where } = window.fb;
  sub('books', snap => {
    BOOK.books = snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    bookRender();
  });
  const subRef = isAdmin ? collection(db, 'bookSubs') : query(collection(db, 'bookSubs'), where('studentUid', '==', ownerUid));
  sub(
    'bookSubs',
    snap => {
      BOOK.subs = {};
      snap.docs.forEach(d => (BOOK.subs[d.id] = d.data()));
      bookRender();
    },
    subRef
  );
  if (isAdmin)
    sub('bookKeys', snap => {
      BOOK.keys = {};
      snap.docs.forEach(d => (BOOK.keys[d.id] = (d.data() || {}).answers || {}));
      bookRender();
    });
};
window.bookReset = function () {
  BOOK.books = [];
  BOOK.subs = {};
  BOOK.keys = {};
  BOOK.keyState = {};
  BOOK.draft = {};
  BOOK.bid = null;
  BOOK.n = null;
};
function bookRender() {
  try {
    renderBookCard();
    renderBookView();
    renderBookAdmin();
  } catch (e) {
    console.error('문제집 화면 오류:', e);
  }
}

/* ---------- 학생: 메인 카드 · 화면 열기 ---------- */
function renderBookCard() {
  const box = $('stu-book-card');
  if (!box) return;
  if (!currentStudent || !BOOK.books.length) {
    box.innerHTML = '';
    return;
  }
  const total = BOOK.books.reduce((a, b) => a + (b.items || []).length, 0);
  const done = BOOK.books.reduce((a, b) => a + (b.items || []).filter(it => bkSub(b.id, it.n)).length, 0);
  box.innerHTML = `<div class="dly-card bk-card" onclick="openBook()" role="button" tabindex="0" onkeydown="if(event.key==='Enter')openBook()">
    <div class="dly-ico">📘</div>
    <div class="dly-txt"><b>문제집 제출 <span class="dly-tag ${done === total ? 'ok' : 'todo'}">${done} / ${total}</span></b><span>${bkEsc(BOOK.books.length === 1 ? BOOK.books[0].title : BOOK.books.length + '개의 문제집')} · 원본 문항을 고르고 변형 2문항을 제출해요</span></div>
    <div class="dly-go">열기 ›</div></div>`;
}
function openBook() {
  if (!currentStudent) return;
  BOOK.view = 'list';
  BOOK.n = null;
  switchSite('book');
  if (!currentUserIsAdmin && typeof routeSet === 'function') routeSet('/book');
  window.scrollTo(0, 0);
}
function closeBook() {
  switchSite('student');
  if (!currentUserIsAdmin && typeof routeSet === 'function') routeSet('/');
  renderBookCard();
}
function bookOpenItem(bid, n) {
  BOOK.bid = bid;
  BOOK.n = n;
  BOOK.view = 'item';
  renderBookView();
  window.scrollTo(0, 0);
}
function bookShowList() {
  BOOK.view = 'list';
  BOOK.n = null;
  renderBookView();
  window.scrollTo(0, 0);
}
function bookBackStep() {
  if (BOOK.view === 'item') bookShowList();
  else closeBook();
}

function renderBookView() {
  const box = $('book-body');
  if (!box || !$('shell-book') || $('shell-book').style.display === 'none') return;
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT' && box.contains(ae)) return;
  const b = bkBook(BOOK.bid) || BOOK.books[0];
  if (b && !BOOK.bid) BOOK.bid = b.id;
  $('book-top-sub').textContent = b ? b.title : '';
  $('book-top-btn').innerHTML = BOOK.view === 'item' ? `<button class="btn small secondary" onclick="bookShowList()">문항 목록</button>` : '';
  if (!BOOK.books.length) {
    box.innerHTML = `<div class="dly-empty"><div class="dly-ico big">📘</div><h2>문제집</h2><p>아직 등록된 문제집이 없어요.</p><button class="btn secondary" onclick="closeBook()">메인으로</button></div>`;
    return;
  }
  box.innerHTML = BOOK.view === 'item' && bkItem(bkBook(BOOK.bid), BOOK.n) ? bookItemHtml(bkBook(BOOK.bid), bkItem(bkBook(BOOK.bid), BOOK.n)) : bookListHtml();
  if (BOOK.view === 'item') bookProg();
  bookInkMount();
}
/* 필기(펜): 풀이·주간지 화면과 같은 도구. 제출 전 변형 문항 위에 쓰고, 이 기기에만 임시 저장되며 제출하면 지워진다 */
function bookInkMount() {
  const b = bkBook(BOOK.bid),
    it = BOOK.view === 'item' ? bkItem(b, BOOK.n) : null;
  if (!it || bkSub(b.id, it.n) || !$('qwrap_bpage') || typeof inkInit !== 'function') {
    if (typeof INK !== 'undefined' && INK.bodyId === 'book-body') INK.on = false;
    return;
  }
  inkInit('book_' + b.id + '_' + it.n, { body: 'book-body', host: 'bk-ink-host', wrap: '.dly-inkwrap', keep: true });
}

function bookListHtml() {
  const tabs =
    BOOK.books.length > 1
      ? `<div class="dly-seg">${BOOK.books.map(x => `<button class="${x.id === BOOK.bid ? 'on' : ''}" onclick="bookPickBook('${x.id}')">${bkEsc(x.title)}</button>`).join('')}</div>`
      : '';
  const b = bkBook(BOOK.bid) || BOOK.books[0];
  const items = (b.items || []).slice().sort((x, y) => x.n - y.n);
  const done = items.filter(it => bkSub(b.id, it.n)).length;
  const rows = items
    .map(it => {
      const s = bkSub(b.id, it.n);
      return `<button class="dly-row bk-row" onclick="bookOpenItem('${b.id}',${it.n})">
        <div><b><span class="bk-no">${it.n}</span> ${bkEsc(bkMotherTxt(it))}</b><span>${bkEsc(it.source || '')}${it.rate != null ? ` · 원본 정답률 ${bkEsc(it.rate)}%` : ''}</span></div>
        ${s ? '<span class="dly-tag ok">제출 완료</span>' : '<span class="dly-tag todo">미제출</span>'}</button>`;
    })
    .join('');
  return `${tabs}<h2 class="dly-h">${bkEsc(b.title)}</h2>
    <p class="dly-sub">${b.sub ? bkEsc(b.sub) + '<br>' : ''}풀고 싶은 <b>원본 문항</b>을 고르면 그 문항의 <b>변형 2문항</b>이 나와요. 제출하면 정답과 해설이 열려요. (${done} / ${items.length} 제출)</p>
    <div class="dly-list">${rows}</div>
    <div class="dly-after"><button class="btn ghost" onclick="closeBook()">메인으로</button></div>`;
}
function bookPickBook(id) {
  BOOK.bid = id;
  renderBookView();
}

/* ---------- 학생: 변형 2문항 ---------- */
function bookDraft(bid, n) {
  const k = bid + '|' + n;
  return (BOOK.draft[k] = BOOK.draft[k] || {});
}
function bookItemHtml(b, it) {
  const sub = bkSub(b.id, it.n);
  const head = `<div class="dly-head"><div class="dly-date">${bkEsc(bkMotherTxt(it))} · ${bkEsc(it.source || '')}</div><h2>원본 ${it.n}번의 변형 문항</h2>${it.rate != null ? `<div class="bk-rate">원본 정답률 ${bkEsc(it.rate)}%</div>` : ''}</div>`;
  if (sub) return head + bookResultHtml(b, it, sub);
  const d = bookDraft(b.id, it.n);
  const qs = (it.variants || [])
    .map(v => {
      const cur = d[v.n] || '';
      const sel = cur.split(',');
      const fn = `bookPick('${b.id}',${it.n},${v.n},`;
      let inp;
      if (v.type === 'short') inp = `<input class="dly-short" type="text" placeholder="답 입력" value="${bkEsc(cur)}" oninput="bookType('${b.id}',${it.n},${v.n},this.value)" autocomplete="off">`;
      else
        inp =
          `<div class="dly-ol">` +
          Array.from({ length: v.choices || 5 }, (_, i) => {
            const k = String(i + 1);
            const lab = (v.labels || [])[i];
            return `<button type="button" class="dly-o${sel.includes(k) ? ' on' : ''}" data-v="${k}" onclick="${fn}'${k}',${v.type === 'multi'})" aria-pressed="${sel.includes(k)}"><i>${CIRCS[i]}</i><span>${bkEsc(lab == null ? '' : lab)}</span></button>`;
          }).join('') +
          `</div>`;
      return `<div class="dly-q full" data-n="${v.n}"><div class="dly-n">변형 ${v.n}${v.type === 'multi' ? '<small>복수 정답</small>' : ''}</div>${dQBody(v)}${inp}</div>`;
    })
    .join('');
  return `<div id="bk-ink-host"></div><div class="dly-inkwrap" id="qwrap_bpage">${head}<div class="dly-note">변형 2문항의 답을 고르고 <b>제출</b>을 누르세요. 제출하면 정답과 해설이 바로 열려요. 제출 후에는 고칠 수 없어요.</div>
    <div class="dly-qs">${qs}</div></div>
    <div class="dly-bar"><span id="bk-prog"></span><button class="btn" onclick="bookSubmit('${b.id}',${it.n})">제출하기</button></div>`;
}
function bookProg() {
  const el = $('bk-prog'),
    b = bkBook(BOOK.bid),
    it = bkItem(b, BOOK.n);
  if (!el || !it) return;
  const d = bookDraft(b.id, it.n);
  el.textContent = `답한 문항 ${(it.variants || []).filter(v => String(d[v.n] || '').trim() !== '').length} / ${(it.variants || []).length}`;
}
function bookPick(bid, n, v, val, multi) {
  const d = bookDraft(bid, n);
  let cur = d[v] ? String(d[v]).split(',') : [];
  if (multi) cur = cur.includes(val) ? cur.filter(x => x !== val) : cur.concat(val);
  else cur = cur.includes(val) ? [] : [val];
  d[v] = cur.sort().join(',');
  const row = document.querySelector(`#book-body .dly-q[data-n="${v}"]`);
  if (row)
    row.querySelectorAll('.dly-o').forEach(x => {
      const on = d[v].split(',').includes(x.dataset.v);
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on);
    });
  bookProg();
}
function bookType(bid, n, v, val) {
  bookDraft(bid, n)[v] = val;
  bookProg();
}
async function bookSubmit(bid, n) {
  const b = bkBook(bid),
    it = bkItem(b, n);
  if (!it || !currentStudent) return;
  if (previewingStudent || adminViewAll || currentUserIsAdmin) {
    alert('학생 화면 보기에서는 제출할 수 없습니다.');
    return;
  }
  if (bkSub(bid, n)) return;
  const d = bookDraft(bid, n);
  const blank = (it.variants || []).filter(v => String(d[v.n] || '').trim() === '').length;
  if (!confirm((blank ? `답하지 않은 문항이 ${blank}개 있어요. ` : '') + '제출하면 고칠 수 없어요. 제출할까요?')) return;
  const answers = {};
  (it.variants || []).forEach(v => {
    if (String(d[v.n] || '').trim() !== '') answers[v.n] = String(d[v.n]).trim();
  });
  try {
    const { db, doc, setDoc } = window.fb;
    await setDoc(doc(db, 'bookSubs', bid + '|' + n + '|' + currentStudent), { studentUid: currentStudent, book: bid, n: String(n), answers, submittedAt: Date.now() });
    delete BOOK.draft[bid + '|' + n];
    try { inkClearStored('book_' + bid + '_' + n); if (INK.bodyId === 'book-body') { INK.on = false; INK.key = null; } } catch (e) {}
    bookLoadKey(bid, n, true);
  } catch (e) {
    console.error('문제집 제출 실패:', e);
    alert('제출하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.\n(' + (e.code || e.message) + ')');
  }
}
async function bookLoadKey(bid, n, force) {
  if (currentUserIsAdmin || !currentStudent) return;
  const k = bid + '|' + n;
  const st = BOOK.keyState[k];
  if (!force && (st === 'ok' || st === 'loading' || st === 'none')) return;
  BOOK.keyState[k] = 'loading';
  try {
    const { db, doc, getDoc } = window.fb;
    const snap = await getDoc(doc(db, 'bookKeys', k));
    if (snap.exists()) {
      BOOK.keys[k] = (snap.data() || {}).answers || {};
      BOOK.keyState[k] = 'ok';
    } else BOOK.keyState[k] = 'none';
  } catch (e) {
    console.error('문제집 정답 읽기 실패:', e.code || e.message);
    BOOK.keyState[k] = 'err';
  }
  renderBookView();
}
function bookResultHtml(b, it, sub) {
  const k = b.id + '|' + it.n;
  if (!BOOK.keys[k] && !['none', 'err'].includes(BOOK.keyState[k])) bookLoadKey(b.id, it.n);
  const key = BOOK.keys[k];
  if (!key) {
    const m = BOOK.keyState[k] === 'none' ? '정답·해설이 아직 등록되지 않았어요.' : BOOK.keyState[k] === 'err' ? '정답을 불러오지 못했어요. 잠시 뒤 다시 열어 보세요.' : '정답과 해설을 불러오는 중이에요…';
    return `<div class="dly-done"><div class="dly-ico big">✅</div><h3>제출 완료</h3><p>${m}</p></div>`;
  }
  let ok = 0;
  const rows = (it.variants || [])
    .map(v => {
      const kk = key[v.n] || {},
        mine = (sub.answers || {})[v.n];
      const good = dCorrect(v, mine, kk.a);
      if (good) ok++;
      const show = x => (x == null || x === '' ? '<i>무응답</i>' : bkEsc(String(x).replace(/,/g, ', ')));
      return `<div class="dly-r ${good ? 'good' : 'bad'}">
        <div class="dly-rh"><b>변형 ${v.n}</b><span class="dly-mark">${good ? '정답' : '오답'}</span></div>
        ${dHasBody(v) ? `<div class="dly-rq">${dQBody(v)}${dResChoices(v, mine, kk.a)}</div>` : ''}
        <div class="dly-ans"><span>내 답 <b>${show(mine)}</b></span>${good ? '' : `<span>정답 <b>${show(String(kk.a == null ? '' : kk.a).replace(/\|/g, ' 또는 '))}</b></span>`}</div>
        ${kk.e ? `<details class="dly-exp"${good ? '' : ' open'}><summary>해설</summary><div>${bkEsc(kk.e).replace(/\n/g, '<br>')}</div></details>` : ''}</div>`;
    })
    .join('');
  const n = (it.variants || []).length;
  return `<div class="dly-score"><div><span class="dly-sc-n">${ok}</span><span class="dly-sc-t"> / ${n}</span></div><div class="dly-sc-r"><span class="dly-tag ok">제출 완료</span><small>정답률 ${n ? Math.round((ok / n) * 100) : 0}%</small></div></div>
    ${it.point ? `<div class="dly-note bk-point"><b>핵심 포인트</b> ${bkEsc(it.point)}</div>` : ''}
    <div class="dly-rs">${rows}</div>
    <div class="dly-after"><button class="btn secondary" onclick="bookShowList()">다른 문항 고르기</button><button class="btn ghost" onclick="closeBook()">메인으로</button></div>`;
}

/* =========================================================
   관리자: 문제집 등록(JSON) · 제출 현황 · 문항별 오답률
   ========================================================= */
const BOOK_SPEC = `문제집(마더텅 원본 문항 + 변형 2문항)을 아래 JSON 규격으로 만들어 주세요. 설명 없이 JSON만 코드블록 하나로 출력해 주세요.

규칙
- 문제집 하나가 JSON 하나입니다. "title"은 문제집 이름, "originals"는 원본 문항 목록입니다.
- 원본 문항마다 "motherNo"(마더텅 번호, 숫자)와 "source"(기출 출처, 예: "2024학년도 10월 학력평가 12번")를 반드시 적어 주세요. 학생이 문항을 고를 때 '마더텅 52번 - 출처'로 보입니다.
- 원본 문항마다 변형 문항은 정확히 2개("variants" 배열 길이 2)입니다. 학생은 원본 문항을 고르고 이 변형 2문항의 답을 제출합니다.
- 변형 문항에는 학생 화면에 그대로 보일 문제 본문을 넣습니다: "text"(물음), 필요하면 "passage"(<보기>·자료 글, 줄바꿈은 \\n), "table"(표), "choices"(선지 글 배열).
- "type": "mc"(객관식, 정답 하나), "multi"(복수 정답), "short"(단답형). 생략하면 mc입니다.
- "choices"에는 ①②③ 같은 번호 기호를 붙이지 말고 선지 글만 적습니다(보통 5개). 단답형은 생략합니다.
- "answer": mc는 "3", multi는 "1,4", short는 정답 글(여러 표현이 정답이면 "A|B"). "explain": 해설.
- 표는 "table": [["구분","A국","B국"],["GDP","10","20"]] 처럼 줄 배열(첫 줄이 머리글). 여러 표나 제목·주석이 필요하면 "tables":[{"title":"...","note":"...","rows":[[...],[...]]}] .
- 선택 항목: 원본 "n"(순서, 생략하면 1부터), "rate"(원본 정답률 %, 숫자), "point"(핵심 포인트 한 줄, 제출 뒤에 보임). 문제집 "sub"(부제).
- 이미지는 넣을 수 없습니다(문제는 글과 표로 옮겨 주세요).

예시
{
  "title": "국제 기구 3점 정복 변형 문제집",
  "sub": "마더텅 3점 기출 20선 + 변형 40제",
  "originals": [
    {
      "n": 1,
      "motherNo": 52,
      "source": "2024학년도 10월 학력평가 12번",
      "rate": 61,
      "point": "총회는 1국 1표, 안보리는 상임이사국 거부권",
      "variants": [
        { "type": "mc", "text": "다음 설명에 해당하는 기관은?", "passage": "모든 회원국이 1표씩 가진다.", "choices": ["총회","안전 보장 이사회","국제 사법 재판소","경제 사회 이사회","사무국"], "answer": "1", "explain": "해설" },
        { "type": "short", "text": "안전 보장 이사회 상임 이사국 5개국이 가진 권한은?", "answer": "거부권|비토권", "explain": "해설" }
      ]
    }
  ]
}`;
function bookCopySpec() {
  Promise.resolve(copyText(BOOK_SPEC)).then(() => alert('복사했습니다. 문제집을 만든 Claude 대화에 붙여넣고 "이 규격으로 JSON 만들어줘"라고 요청하세요.'));
}
function bookPickFile(inp) {
  const f = inp.files && inp.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    $('book-json').value = String(r.result || '');
    bookMsg('파일을 불러왔습니다. 아래 [검사하고 등록]을 누르세요.', false);
  };
  r.readAsText(f, 'utf-8');
  inp.value = '';
}
function bookMsg(t, bad) {
  const m = $('book-msg');
  if (!m) return;
  m.textContent = t;
  m.style.color = bad ? 'var(--accent)' : 'var(--brand)';
}
function bookParse(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!raw) throw new Error('JSON을 붙여넣거나 파일을 선택하세요.');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error('JSON 형식이 올바르지 않습니다: ' + e.message);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('문제집은 {"title":..., "originals":[...]} 형태여야 합니다.');
  const title = String(data.title || '').trim();
  if (!title) throw new Error('"title"(문제집 이름)이 없습니다.');
  const list = Array.isArray(data.originals) ? data.originals : Array.isArray(data.items) ? data.items : null;
  if (!list || !list.length) throw new Error('"originals"(원본 문항 목록)가 비어 있습니다.');
  const items = [],
    answers = {};
  list.forEach((o, i) => {
    const n = Number.isInteger(+o.n) && +o.n > 0 ? +o.n : i + 1;
    const tag = `원본 ${n}번: `;
    if (items.some(x => x.n === n)) throw new Error(`${tag}번호가 두 번 있습니다.`);
    const motherNo = String(o.motherNo != null ? o.motherNo : o.mother != null ? o.mother : '').trim();
    if (!motherNo) throw new Error(`${tag}"motherNo"(마더텅 번호)가 없습니다.`);
    const source = String(o.source || '').trim();
    if (!source) throw new Error(`${tag}"source"(기출 출처)가 없습니다.`);
    const vs = Array.isArray(o.variants) ? o.variants : null;
    if (!vs || vs.length !== 2) throw new Error(`${tag}"variants"(변형 문항)는 정확히 2개여야 합니다.`);
    const it = { n, motherNo, source, variants: [] };
    if (o.rate != null && o.rate !== '') {
      const r = Number(String(o.rate).replace('%', ''));
      if (!isFinite(r) || r < 0 || r > 100) throw new Error(`${tag}"rate"는 0~100 사이 숫자여야 합니다.`);
      it.rate = r;
    }
    if (o.point) it.point = String(o.point).trim();
    const ans = {};
    vs.forEach((q, vi) => {
      const v = vi + 1,
        t2 = `${tag}변형 ${v}: `;
      if (!q || typeof q !== 'object') throw new Error(t2 + '형식이 아닙니다.');
      const type = ['mc', 'multi', 'short'].includes(q.type) ? q.type : q.type == null ? 'mc' : null;
      if (!type) throw new Error(t2 + '"type"은 mc / multi / short 중 하나여야 합니다.');
      const a = q.answer == null ? '' : String(q.answer).trim();
      if (!a) throw new Error(t2 + '"answer"가 비어 있습니다.');
      const x = { n: v, type };
      if (q.text || q.question) x.text = String(q.text || q.question).trim();
      if (q.passage) x.passage = String(q.passage).trim();
      const tbs = (Array.isArray(q.tables) ? q.tables : []).concat(q.table ? [q.table] : []);
      if (tbs.length)
        x.tables = tbs.map(tb => {
          const rowsRaw = Array.isArray(tb) ? tb : tb && Array.isArray(tb.rows) ? tb.rows : null;
          if (!rowsRaw || !rowsRaw.length || rowsRaw.some(r => !Array.isArray(r) || !r.length)) throw new Error(t2 + '표(table)는 [[칸,칸],[칸,칸]] 형태여야 합니다.');
          const ob = { rows: rowsRaw.map(r => ({ c: r.map(c => String(c == null ? '' : c)) })) };
          if (!Array.isArray(tb)) {
            if (tb.title) ob.title = String(tb.title);
            if (tb.note) ob.note = String(tb.note);
            if (tb.header === false) ob.header = false;
          }
          return ob;
        });
      if (!x.text && !x.passage && !x.tables) throw new Error(t2 + '문제 본문("text" 등)이 없습니다. 학생 화면에 보일 문제를 넣어 주세요.');
      if (type !== 'short') {
        const labs = Array.isArray(q.choices) ? q.choices.map(z => String(z == null ? '' : z).trim()) : null;
        if (!labs || labs.length < 2 || labs.length > 9) throw new Error(t2 + '"choices"(선지 글 배열, 2~9개)가 필요합니다.');
        x.labels = labs;
        x.choices = labs.length;
        const toks = dNorm(a).split(',');
        if (type === 'mc' && toks.length !== 1) throw new Error(t2 + 'mc는 정답이 하나여야 합니다(복수 정답이면 multi).');
        if (toks.some(z => !/^\d$/.test(z) || +z < 1 || +z > labs.length)) throw new Error(t2 + `정답이 선지 범위(1~${labs.length})를 벗어났습니다.`);
      }
      it.variants.push(x);
      ans[v] = { a: type === 'short' ? a : dNorm(a), e: String(q.explain || q.explanation || '').trim() };
    });
    items.push(it);
    answers[n] = ans;
  });
  items.sort((x, y) => x.n - y.n);
  return { id: 'b' + bkHash(title), title, sub: String(data.sub || '').trim(), items, answers };
}
async function bookRegister() {
  let bk;
  try {
    bk = bookParse($('book-json').value);
  } catch (e) {
    bookMsg(e.message, true);
    return;
  }
  const old = bkBook(bk.id);
  if (!confirm(`문제집 '${bk.title}'을 등록합니다.\n· 원본 ${bk.items.length}문항 × 변형 2문항 (${bk.items.length * 2}문항)` + (old ? `\n\n⚠️ 같은 이름의 문제집이 이미 있어 덮어씁니다(학생 제출 기록은 그대로).` : '') + '\n\n진행할까요?')) return;
  try {
    const { db, doc, setDoc } = window.fb;
    await setDoc(doc(db, 'books', bk.id), { title: bk.title, sub: bk.sub, items: bk.items, count: bk.items.length, createdAt: old ? old.createdAt || Date.now() : Date.now(), updatedAt: Date.now() });
    for (const it of bk.items) await setDoc(doc(db, 'bookKeys', bk.id + '|' + it.n), { book: bk.id, n: String(it.n), answers: bk.answers[it.n], updatedAt: Date.now() });
    bookMsg(`'${bk.title}' ${bk.items.length}문항을 등록했습니다.`, false);
    $('book-json').value = '';
  } catch (e) {
    console.error(e);
    bookMsg('등록하지 못했습니다: ' + (e.code || e.message), true);
  }
}
async function bookDelete(bid) {
  const b = bkBook(bid);
  if (!b || !confirm(`문제집 '${b.title}'을 삭제할까요?\n학생 제출 기록과 정답·해설도 함께 지워지며 되돌릴 수 없습니다.`)) return;
  try {
    const { db, doc, deleteDoc } = window.fb;
    await Promise.all(Object.keys(BOOK.subs).filter(k => k.startsWith(bid + '|')).map(k => deleteDoc(doc(db, 'bookSubs', k))));
    for (const it of b.items || []) await deleteDoc(doc(db, 'bookKeys', bid + '|' + it.n));
    await deleteDoc(doc(db, 'books', bid));
  } catch (e) {
    alert('삭제하지 못했습니다: ' + (e.code || e.message));
  }
}
/* 변형 문항별 오답률: 제출한 학생 중 틀린 비율 */
function bookStats(b, it) {
  const targets = dailyTargets();
  const key = BOOK.keys[b.id + '|' + it.n];
  const subs = targets.map(st => BOOK.subs[b.id + '|' + it.n + '|' + st.uid]).filter(Boolean);
  const per = (it.variants || []).map(v => {
    const k = key && key[v.n];
    if (!k || !subs.length) return { v: v.n, n: subs.length, wrong: null, rate: null, top: '' };
    const wrong = subs.filter(s => !dCorrect(v, (s.answers || {})[v.n], k.a));
    const cnt = {};
    wrong.forEach(s => {
      const m = String((s.answers || {})[v.n] || '').trim();
      const kk = v.type === 'short' ? m : dNorm(m);
      if (kk) cnt[kk] = (cnt[kk] || 0) + 1;
    });
    const top = Object.entries(cnt).sort((a, b2) => b2[1] - a[1])[0];
    return { v: v.n, n: subs.length, wrong: wrong.length, rate: Math.round((wrong.length / subs.length) * 100), top: top ? `${v.type === 'short' ? top[0] : top[0].split(',').map(x => CIRCS[x - 1] || x).join('')} (${top[1]}명)` : '' };
  });
  return { subs: subs.length, targets: targets.length, per };
}
function bookToggle(bid, on) {
  if (on) BOOK.open.add(bid);
  else BOOK.open.delete(bid);
}
function renderBookAdmin() {
  const box = $('book-admin-list');
  if (!box) return;
  box.innerHTML =
    BOOK.books
      .map(b => {
        const rows = (b.items || [])
          .map(it => ({ it, st: bookStats(b, it) }))
          .sort((x, y) => Math.max(...y.st.per.map(p => p.rate == null ? -1 : p.rate)) - Math.max(...x.st.per.map(p => p.rate == null ? -1 : p.rate)));
        const total = rows.reduce((a, r) => a + r.st.subs, 0);
        const tr = rows
          .map(({ it, st }) => {
            const cell = p => (p.rate == null ? '<td>-</td>' : `<td><b class="${p.rate >= 50 ? 'bk-hi' : ''}">${p.rate}%</b> <small>(${p.wrong}/${p.n})${p.top ? ' · 많이 고른 오답 ' + bkEsc(p.top) : ''}</small></td>`);
            return `<tr><td>${bkEsc(bkMotherTxt(it))}<br><small>${bkEsc(it.source || '')}</small></td><td>${st.subs}/${st.targets}</td>${cell(st.per[0] || {})}${cell(st.per[1] || {})}</tr>`;
          })
          .join('');
        return `<details class="dly-ad" data-b="${b.id}"${BOOK.open.has(b.id) ? ' open' : ''} ontoggle="bookToggle('${b.id}',this.open)">
          <summary><b>${bkEsc(b.title)}</b> <span class="badge">원본 ${(b.items || []).length}문항</span> <span class="badge ${total ? 'good' : ''}">제출 ${total}건</span></summary>
          <div class="dly-ad-in">
            <p class="note" style="margin:0 0 8px;">변형 문항별 <b>오답률</b>입니다(제출한 학생 중 틀린 비율, 높은 순). 이름이 '테스트01'·'테스트02'인 계정은 뺍니다.</p>
            <div style="overflow-x:auto;"><table><tr><th>원본 문항</th><th>제출</th><th>변형 1 오답률</th><th>변형 2 오답률</th></tr>${tr}</table></div>
            <div style="margin-top:8px"><button class="btn small danger" onclick="bookDelete('${b.id}')">이 문제집 삭제</button></div>
          </div></details>`;
      })
      .join('') || '<p class="empty-hint">등록된 문제집이 없습니다. 위에서 JSON을 등록하세요.</p>';
}
