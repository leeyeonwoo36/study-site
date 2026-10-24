/* =========================================================
   오답 JSON 내보내기
   - 학생: 내 오답(과제·시험·주간지)을 파일로 받아 Claude에게 주면 약점 유형 문제지를 만들 수 있다
   - 관리자: 학생 한 명의 오답, 또는 여러 학생이 많이 틀린 '공통 오답'을 받는다
   ========================================================= */
const WX_OUT_SPEC = `{
  "set": "문제 세트 이름 (예: 약점 보완 1회)",
  "questions": [
    { "type": "mc", "body": "물음", "passages": [{"text": "<보기> 본문(줄바꿈 \\n, 강조는 <b> <u>만)", "table": [["구분","A"],["값","1"]]}], "choices": ["선지1","선지2","선지3","선지4","선지5"], "answer": "1", "explain": "해설" },
    { "type": "short", "body": "단답형 물음", "answer": "정답", "explain": "해설" }
  ]
}
규칙: type은 mc(선지 정확히 5개) 또는 short만. answer는 객관식이면 번호 문자열("3", 복수 "1,3"), 단답형이면 정답 글. choices에는 ①②③ 기호를 붙이지 않는다. passages는 없으면 생략(최대 2개), 표는 문자열 2차원 배열. 이미지는 넣을 수 없다.`;
function wxGuide(common) {
  return [
    common
      ? '이 파일은 학생들이 많이 틀린 문제(공통 오답) 목록입니다. 문항마다 정답률(correctRate), 선지별 선택 인원(choiceCounts)이 들어 있습니다.'
      : '이 파일은 한 학생이 틀린 문제 목록입니다. 문항마다 학생이 고른 답(myAnswer)과 정답(answer), 해설(explain)이 들어 있습니다.',
    '아래 순서로 해 주세요.',
    '1) items를 읽고 문항마다 개념·유형(예: 국제기구의 역할, 자료 해석, 선지 판별 방식 등)을 붙인 뒤, 많이 틀린 약점 유형을 3~5개로 묶어 짧게 요약해 주세요.',
    '2) 약점 유형별로 새 문제를 만들어 주세요. 원문을 그대로 베끼지 말고 같은 개념·같은 틀리는 포인트를 묻는 변형 문제로 만들고, 유형마다 3~5문항, 정답과 해설을 붙여 주세요.',
    '3) 문제 전체를 아래 규격의 JSON 한 개(코드블록 하나)로도 출력해 주세요. 이 JSON은 사이트 문제은행에 그대로 올릴 수 있습니다.',
    '본문이 없는 문항(hasBody가 false)은 번호와 답만 있으므로 유형 분석에서 제외하고, 그런 문항이 있었다는 사실만 알려 주세요.',
    '출력 규격:\n' + WX_OUT_SPEC
  ].join('\n');
}
function wxPassages(q) {
  try {
    return getPassages(q)
      .map(p => ({ text: p.text || '', table: p.table && p.table.length ? p.table : undefined, imageUrl: p.imageUrl || undefined }))
      .filter(p => p.text || p.table || p.imageUrl);
  } catch (e) {
    return [];
  }
}
function wxClean(o) {
  Object.keys(o).forEach(k => (o[k] === undefined || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) && delete o[k]);
  return o;
}
function wxQuestion(q, t, kind, idx) {
  return wxClean({
    source: { kind: kind === 'exam' ? '시험' : '과제', title: t.title || '', week: t.week || undefined, no: idx + 1 },
    type: q.type,
    body: q.body || '',
    passages: wxPassages(q),
    choices: q.type === 'mc' ? q.choices || [] : undefined,
    answer: q.answer,
    explain: q.explain || undefined,
    hasBody: true
  });
}
function wxDailyBody(it) {
  const tables = (it.tables || []).map(t => wxClean({ title: t.title || undefined, note: t.note || undefined, header: t.header, rows: (t.rows || []).map(r => (r && r.c) || r) }));
  return wxClean({ text: it.text || '', passage: it.passage || '', imageUrl: it.image || undefined, tables });
}
function wxDailyHasBody(it) {
  return !!(it.text || it.passage || it.image || (it.tables && it.tables.length));
}
function wxDailyItem(sh, it, key) {
  const b = wxDailyBody(it);
  return wxClean({
    source: { kind: '주간지', title: sh.title || '', date: sh.day || sh.date, sheetKind: sh.kind === 'chart' ? '도표' : '일반', no: it.n },
    type: it.type,
    ...b,
    choices: it.type === 'short' ? undefined : it.labels && it.labels.length ? it.labels : it.choices ? Array.from({ length: it.choices }, (_, i) => String(i + 1)) : undefined,
    answer: key && key.a,
    explain: key && key.e,
    hasBody: wxDailyHasBody(it)
  });
}
function wxSave(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
const wxDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* ---------- 한 학생의 오답 ---------- */
async function wxStudentItems(uid, withDaily, isAdmin, taskList) {
  const items = [];
  let noKey = 0;
  const done = new Set();
  const all = taskList || [...tasks.hw.map(t => ['hw', t]), ...tasks.exam.map(t => ['exam', t])];
  for (const [kind, t] of all) {
    const sub = submissions[t.tid + '|' + uid];
    if (!sub || !sub.answers) continue;
    if (!isAdmin) await loadTaskKeys(t.tid);
    (t.qids || []).forEach((qid, i) => {
      const q = questions.find(x => x.qid === qid);
      if (!q || done.has(qid + t.tid)) return;
      const mine = sub.answers[qid] === undefined ? '' : String(sub.answers[qid]);
      if (q.answer === undefined) {
        noKey++;
        return;
      }
      if (isCorrect(q, mine)) return;
      done.add(qid + t.tid);
      const it = wxQuestion(q, t, kind, i);
      it.myAnswer = mine || '(무응답)';
      if (!isAdmin && wrongItems[qid]) it.status = wrongItems[qid].status === 'mastered' ? '마스터' : '복습 필요';
      items.push(it);
    });
  }
  if (withDaily) {
    for (const sh of DAILY.sheets.slice().sort((a, b) => (a.day < b.day ? -1 : 1))) {
      const sub = DAILY.subs[sh.date + '|' + uid];
      if (!sub) continue;
      if (!isAdmin) await dailyLoadKey(sh.date, true);
      const key = DAILY.keys[sh.date];
      if (!key) {
        noKey++;
        continue;
      }
      (sh.items || []).forEach(it => {
        const k = key[it.n];
        if (!k) return;
        const mine = (sub.answers || {})[it.n];
        if (dCorrect(it, mine, k.a)) return;
        const o = wxDailyItem(sh, it, k);
        o.myAnswer = mine == null || mine === '' ? '(무응답)' : String(mine);
        items.push(o);
      });
    }
  }
  return { items, noKey };
}
function wxPack(scope, who, items, extra) {
  return {
    format: 'wrong-answers',
    version: 1,
    scope,
    ...who,
    generatedAt: new Date().toISOString(),
    claudeGuide: wxGuide(scope === 'common'),
    count: items.length,
    ...(extra || {}),
    items
  };
}
async function wxDownloadMine() {
  if (!currentStudent || currentUserIsAdmin) {
    alert('학생 화면에서만 받을 수 있어요.');
    return;
  }
  const btn = $('wx-mine-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await wxStudentItems(currentStudent, true, false);
    if (!r.items.length) {
      alert('내보낼 오답이 없어요. 과제·시험·주간지를 제출하고 틀린 문제가 생기면 받을 수 있어요.');
      return;
    }
    const nm = (students.find(s => s.uid === currentStudent) || {}).name || (window.currentStudentName || '학생');
    wxSave(`오답_${nm}_${wxDate()}.json`, wxPack('student', { student: nm }, r.items, r.noKey ? { note: `정답을 아직 불러오지 못해 ${r.noKey}건은 빠졌어요.` } : {}));
  } catch (e) {
    console.error(e);
    alert('오답 파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- 관리자 ---------- */
function wxAdminFill() {
  const sel = $('wx-student');
  if (!sel) return;
  const prev = sel.value;
  const list = students.filter(s => s.approved && !isTestAcct(s)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
  sel.innerHTML = list.map(s => `<option value="${s.uid}">${esc(s.name)}</option>`).join('') || '<option value="">(학생 없음)</option>';
  if (prev && list.some(s => s.uid === prev)) sel.value = prev;
  wxAdminMode();
}
function wxAdminMode() {
  const m = ($('wx-mode') || {}).value;
  if ($('wx-row-stu')) $('wx-row-stu').style.display = m === 'student' ? '' : 'none';
  if ($('wx-row-th')) $('wx-row-th').style.display = m === 'common' ? '' : 'none';
}
function wxAdminTasks() {
  const sc = $('wx-scope').value;
  const all = [...tasks.hw.map(t => ['hw', t]), ...tasks.exam.map(t => ['exam', t])];
  if (sc === 'sel') {
    const [k, tid] = (($('stats-task') || {}).value || '').split('|');
    return all.filter(([kk, t]) => kk === k && t.tid === tid);
  }
  if (sc === 'daily') return [];
  return all;
}
function wxAdminExport() {
  const mode = $('wx-mode').value,
    scope = $('wx-scope').value,
    withDaily = scope === 'daily' || scope === 'allx';
  const msg = $('wx-msg');
  msg.textContent = '';
  const tl = wxAdminTasks();
  if (mode === 'student') {
    const uid = $('wx-student').value;
    if (!uid) {
      msg.textContent = '학생을 고르세요.';
      return;
    }
    const nm = (students.find(s => s.uid === uid) || {}).name || '학생';
    wxStudentItems(uid, withDaily, true, tl)
      .then(r => {
        if (!r.items.length) {
          msg.textContent = '이 학생의 오답이 없습니다.';
          return;
        }
        wxSave(`오답_${nm}_${wxDate()}.json`, wxPack('student', { student: nm }, r.items));
        msg.textContent = `${nm} 학생 오답 ${r.items.length}문항을 내려받았습니다.`;
      })
      .catch(e => {
        console.error(e);
        msg.textContent = '파일을 만들지 못했습니다.';
      });
    return;
  }
  /* 공통 오답: 정답률이 기준 이하인 문항 */
  const th = Math.min(100, Math.max(0, Number($('wx-th').value) || 50)) / 100;
  const minN = Math.max(1, Number($('wx-min').value) || 3);
  const items = [];
  tl.forEach(([kind, t]) => {
    const targets = taskTargetStudents(t).filter(s => !isTestAcct(s));
    const omr = targets.map(s => submissions[t.tid + '|' + s.uid]).filter(x => x && x.answers && (x.mode === 'omr' || x.mode === 'offline'));
    if (omr.length < minN) return;
    (t.qids || []).forEach((qid, i) => {
      const q = questions.find(x => x.qid === qid);
      if (!q || q.answer === undefined) return;
      const good = omr.filter(x => isCorrect(q, x.answers[qid] === undefined ? '' : x.answers[qid])).length;
      const rate = good / omr.length;
      if (rate > th) return;
      const it = wxQuestion(q, t, kind, i);
      it.respondents = omr.length;
      it.wrongCount = omr.length - good;
      it.correctRate = Math.round(rate * 100);
      if (q.type === 'mc') {
        const c = (q.choices || []).map(() => 0);
        omr.forEach(x => parseAnsList(x.answers[qid]).forEach(k => c[k - 1] !== undefined && c[k - 1]++));
        it.choiceCounts = c;
      }
      items.push(it);
    });
  });
  if (withDaily) {
    DAILY.sheets.forEach(sh => {
      const key = DAILY.keys[sh.date];
      if (!key) return;
      const subs = students.filter(s => s.approved && !isTestAcct(s)).map(s => DAILY.subs[sh.date + '|' + s.uid]).filter(Boolean);
      if (subs.length < minN) return;
      (sh.items || []).forEach(it => {
        const k = key[it.n];
        if (!k) return;
        const good = subs.filter(s => dCorrect(it, (s.answers || {})[it.n], k.a)).length;
        const rate = good / subs.length;
        if (rate > th) return;
        const o = wxDailyItem(sh, it, k);
        o.respondents = subs.length;
        o.wrongCount = subs.length - good;
        o.correctRate = Math.round(rate * 100);
        if (it.type !== 'short') {
          const c = Array.from({ length: it.choices || 5 }, () => 0);
          subs.forEach(s => String((s.answers || {})[it.n] || '').split(',').forEach(v => c[v - 1] !== undefined && c[v - 1]++));
          o.choiceCounts = c;
        }
        items.push(o);
      });
    });
  }
  if (!items.length) {
    msg.textContent = `정답률 ${Math.round(th * 100)}% 이하인 문항이 없습니다. (응답 ${minN}명 이상인 과제·주간지만 봅니다)`;
    return;
  }
  items.sort((a, b) => a.correctRate - b.correctRate);
  wxSave(`공통오답_${wxDate()}.json`, wxPack('common', {}, items, { correctRateAtMost: Math.round(th * 100) }));
  msg.textContent = `공통 오답 ${items.length}문항을 내려받았습니다.`;
}
window.addEventListener('load', () => setTimeout(wxAdminFill, 800));
