/* Gemini 호출 대리 서버 — 키는 브라우저로 내려가지 않고 이 함수(Vercel 환경변수 GEMINI_API_KEY)에만 있다.
   로그인한 사용자의 Firebase 토큰을 확인한 뒤에만 전달한다. */
const FB_KEY = 'AIzaSyB92BspySLg5UkVq4q6gmZ6j87VFa-75hI'; // Firebase 웹 키(공개용, Gemini 키 아님)
const MODEL_OK = /^gemini-[a-z0-9.\-]+$/i;
const seen = new Map(); // uid -> [시각...] (인스턴스 단위 간이 제한)

async function uidOf(token) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.users && j.users[0] ? j.users[0].localId : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI 키가 서버에 설정되지 않았습니다. 관리자에게 문의해 주세요.' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const uid = m ? await uidOf(m[1]).catch(() => null) : null;
  if (!uid) return res.status(401).json({ error: '로그인이 필요합니다' });
  const now = Date.now();
  const hist = (seen.get(uid) || []).filter(t => now - t < 60000);
  if (hist.length >= 30) return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.' });
  hist.push(now);
  seen.set(uid, hist);
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || !MODEL_OK.test(body.model || '') || !body.payload || typeof body.payload !== 'object') return res.status(400).json({ error: '요청 형식이 올바르지 않습니다' });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body.payload)
    });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'AI 서버에 연결하지 못했습니다' });
  }
};
