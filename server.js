/**
 * line-meeting-card：會議資訊卡 × LINE LIFF 分享 × 會議機器人
 *
 *   公開（不用登入，靠猜不到的代碼）
 *     GET  /i/:token                     會議邀請頁（含 LINE／FB 預覽用的 OG 標籤）
 *     GET  /s/:token                     會後摘要頁
 *     GET  /share.html?invite=…          LIFF 分享頁（LIFF 的 Endpoint URL 就填這一頁）
 *     GET  /api/card/:kind/:token        分享頁要的資料：Flex 卡片＋LIFF ID（kind＝invite｜summary）
 *     GET  /api/card/invite/:token/ics   Apple／Outlook 行事曆檔
 *     GET  /api/card/invite/:token/google  轉到 Google 行事曆
 *   管理（要帶 x-admin-token，值＝ADMIN_TOKEN）
 *     GET/POST /api/meetings、PATCH/DELETE /api/meetings/:id
 *     POST /api/meetings/:id/bot           派機器人      POST /api/meetings/:id/bot/leave  請機器人離開
 *     POST /api/meetings/:id/sync          立刻同步狀態   POST /api/meetings/:id/summarize   重新產生摘要
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const store = require('./lib/store');
const card = require('./lib/card');
const recall = require('./lib/recall');
const ai = require('./lib/summary');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const LIFF_ID = process.env.LIFF_ID || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TZ = process.env.TIMEZONE || 'Asia/Taipei';
const BRAND = process.env.BRAND_NAME || '會議資訊卡';
const ACCENT = process.env.ACCENT_COLOR || '#0EA5E9';
const BOT_NAME = process.env.BOT_NAME || `${BRAND}・會議記錄`;
const OPT = { timezone: TZ, accent: ACCENT, organizer: process.env.ORGANIZER_NAME || '' };

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ── 小工具 ── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlsOf = m => ({
  page: `${PUBLIC_URL}/i/${m.invite_token}`,
  ics: `${PUBLIC_URL}/api/card/invite/${m.invite_token}/ics`,
  google: `${PUBLIC_URL}/api/card/invite/${m.invite_token}/google`,
  summary: `${PUBLIC_URL}/s/${m.summary_token}`,
});
/** LIFF 分享網址：在 LINE 裡點這個連結，就會開分享頁並跳出「選擇傳送對象」 */
const shareUrl = q => (LIFF_ID ? `https://liff.line.me/${LIFF_ID}?${q}` : null);

/** 「TIMEZONE 當地的 YYYY-MM-DDTHH:MM」→ UTC ISO 字串（後台表單送進來的是當地時間） */
function localToIso(v) {
  if (!v) return null;
  if (/[zZ]|[+-]\d\d:\d\d$/.test(v)) return new Date(v).toISOString();
  const [d, t = '00:00'] = String(v).split('T'); const [y, mo, da] = d.split('-').map(Number); const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, hh || 0, mm || 0);
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess))) p[x.type] = x.value;
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return new Date(guess - offset).toISOString();
}

/** 常數時間比對，避免用回應時間猜出管理密碼 */
function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function admin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: '還沒設定 ADMIN_TOKEN，管理功能已停用' });
  if (!sameToken(req.get('x-admin-token'), ADMIN_TOKEN)) return res.status(401).json({ error: '管理密碼不正確' });
  next();
}

const FIELDS = ['title', 'description', 'location', 'address', 'join_url', 'passcode', 'organizer', 'cover', 'language', 'label'];
function pick(body) {
  const out = {};
  for (const k of FIELDS) if (k in body) out[k] = String(body[k] || '').trim().slice(0, k === 'description' ? 2000 : 500);
  if ('start' in body) out.start = localToIso(body.start);
  if ('end' in body) out.end = localToIso(body.end);
  if ('auto_bot' in body) out.auto_bot = !!body.auto_bot;
  if (out.join_url && !card.isHttp(out.join_url)) throw new Error('會議連結要是 http(s) 開頭的完整網址');
  if (out.cover && !card.flexImage(out.cover)) throw new Error('封面圖要是 https 的 JPG 或 PNG（LINE 不吃 WebP）');
  return out;
}

/** 後台看到的會議：多附上各種網址 */
function view(m) {
  const u = urlsOf(m);
  return {
    ...m, transcript: undefined, transcript_count: (m.transcript || []).length,
    when_label: card.whenLabel(m, TZ), page_url: u.page, summary_url: u.summary,
    share_invite_url: shareUrl(`invite=${m.invite_token}`), share_summary_url: m.summary ? shareUrl(`summary=${m.summary_token}`) : null,
  };
}

/* ── 公開：卡片資料 ── */
app.get('/api/config', (req, res) => res.json({ brand: BRAND, accent: ACCENT, liff_ready: !!LIFF_ID, bot_ready: recall.enabled(), summary_ready: ai.enabled() }));

app.get('/api/card/:kind/:token', (req, res) => {
  const { kind, token } = req.params;
  if (kind !== 'invite' && kind !== 'summary') return res.status(404).json({ error: '沒有這種卡片' });
  const m = store.getByToken(kind === 'invite' ? 'invite_token' : 'summary_token', token);
  if (!m || (kind === 'summary' && !m.summary)) return res.status(404).json({ error: '找不到這場會議，或連結已失效' });
  const u = urlsOf(m);
  const flex = kind === 'invite' ? card.buildInviteFlex(m, u, OPT) : card.buildSummaryFlex(m, u, OPT);
  const when = card.whenLabel(m, TZ);
  const pub = { title: m.title, when_label: when, brand: BRAND, accent: ACCENT, liff_id: LIFF_ID || null, flex,
    alt_text: card.clip(`${kind === 'invite' ? '會議邀請' : '會議摘要'}：${m.title}${when ? `｜${when}` : ''}`, 380),
    share_url: shareUrl(`${kind}=${token}`) };
  // 邀請卡只公開「標題、時間、地點、會議連結」；逐字稿與摘要只在摘要卡那條連結才看得到
  if (kind === 'invite') Object.assign(pub, { description: m.description, location: m.location, address: m.address, join_url: m.join_url, passcode: m.passcode, organizer: m.organizer || OPT.organizer, cover: m.cover, ics_url: u.ics, google_url: u.google, page_url: u.page });
  else Object.assign(pub, { summary: m.summary, summary_points: m.summary_points, action_items: m.action_items, page_url: u.summary });
  res.json(pub);
});

app.get('/api/card/invite/:token/ics', (req, res) => {
  const m = store.getByToken('invite_token', req.params.token);
  const ics = m && card.buildIcs(m, urlsOf(m), { host: new URL(PUBLIC_URL).host });
  if (!ics) return res.status(404).send('not found');
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="meeting.ics"' }).send(ics);
});

// Google 行事曆網址帶中文很容易超過 Flex 按鈕的 1000 字上限，所以卡片上放這個短網址，再轉過去
app.get('/api/card/invite/:token/google', (req, res) => {
  const m = store.getByToken('invite_token', req.params.token);
  const url = m && card.googleCalendarUrl(m, urlsOf(m), TZ);
  if (!url) return res.status(404).send('not found');
  res.redirect(302, url);
});

/* ── 公開：邀請頁／摘要頁（把 OG 標籤塞進 HTML，貼到 LINE 才會顯示這一場的標題） ── */
function page(file, field) {
  const tpl = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  return (req, res) => {
    const m = store.getByToken(field, req.params.token);
    if (!m || (field === 'summary_token' && !m.summary)) return res.status(404).send('找不到這場會議，或連結已失效');
    const title = `${field === 'invite_token' ? '會議邀請' : '會議摘要'}｜${m.title}`;
    const desc = [card.whenLabel(m, TZ), m.location || (m.join_url ? '線上會議' : '')].filter(Boolean).join('・') || BRAND;
    res.set('Cache-Control', 'no-store').send(tpl.replace(/__OG_TITLE__/g, esc(title)).replace(/__OG_DESC__/g, esc(desc)).replace(/__OG_IMAGE__/g, esc(card.flexImage(m.cover) || '')).replace(/__TOKEN__/g, esc(req.params.token)));
  };
}
app.get('/i/:token', page('invite.html', 'invite_token'));
app.get('/s/:token', page('summary.html', 'summary_token'));

/* ── 管理 ── */
app.get('/api/meetings', admin, (req, res) => res.json({ meetings: store.list().map(view) }));
app.post('/api/meetings', admin, (req, res) => {
  try {
    const data = pick(req.body || {});
    if (!data.title) return res.status(400).json({ error: '請填會議名稱' });
    res.json({ meeting: view(store.create(data)) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/meetings/:id', admin, (req, res) => {
  try {
    const m = store.update(req.params.id, pick(req.body || {}));
    if (!m) return res.status(404).json({ error: '找不到這場會議' });
    res.json({ meeting: view(m) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/meetings/:id', admin, (req, res) => res.json({ success: store.remove(req.params.id) }));
app.get('/api/meetings/:id/transcript', admin, (req, res) => {
  const m = store.get(req.params.id);
  if (!m) return res.status(404).json({ error: '找不到這場會議' });
  res.json({ transcript: m.transcript || [] });
});

/* ── 會議機器人 ── */
async function deploy(m) {
  if (!recall.enabled()) throw new Error('還沒設定 RECALL_API_KEY');
  if (!card.isHttp(m.join_url)) throw new Error('這場會議沒有會議連結，機器人不知道要去哪裡');
  if (['joining', 'in_call'].includes(m.bot.status)) throw new Error('機器人已經在路上或在會議裡了');
  // 先佔位再打 API，避免排程和手動同時派出兩個機器人
  store.update(m.id, { bot: { ...m.bot, status: 'joining', error: null, attempts: (m.bot.attempts || 0) + 1 } });
  try {
    const bot = await recall.deployBot({ meetingUrl: m.join_url.trim(), botName: BOT_NAME, language: m.language,
      joinMessage: `大家好，我是「${BOT_NAME}」，由 ${m.organizer || OPT.organizer || '主辦人'} 邀請來記錄這場會議，會後會整理摘要給與會者。` });
    return store.update(m.id, { bot: { ...store.get(m.id).bot, id: bot.id, status: 'joining' } });
  } catch (e) {
    store.update(m.id, { bot: { ...store.get(m.id).bot, status: 'failed', error: e.message } });
    throw e;
  }
}

/** 問 Recall 機器人現在怎樣了；會議結束就抓逐字稿、做摘要 */
async function sync(m) {
  if (!m.bot.id || !recall.enabled()) return m;
  const bot = await recall.getBot(m.bot.id);
  const st = recall.mapStatus(bot);
  let patch = { bot: { ...m.bot, status: st.status, error: st.error || null } };
  if (st.status === 'processing') {
    const segs = await recall.fetchTranscript(bot).catch(e => { patch.bot = { ...patch.bot, status: 'failed', error: e.message }; return null; });
    if (segs) { patch.transcript = segs; patch.bot = { ...patch.bot, status: 'done' }; }
  }
  m = store.update(m.id, patch);
  if (m.bot.status === 'done' && !m.summary && ai.enabled()) m = await summarizeNow(m).catch(e => store.update(m.id, { bot: { ...m.bot, error: `摘要失敗：${e.message}` } }));
  return m;
}
async function summarizeNow(m) { return store.update(m.id, await ai.summarize(m)); }

const wrap = fn => async (req, res) => {
  const m = store.get(req.params.id);
  if (!m) return res.status(404).json({ error: '找不到這場會議' });
  try { res.json({ meeting: view(await fn(m)) }); } catch (e) { res.status(e.status === 402 ? 402 : 400).json({ error: e.message }); }
};
app.post('/api/meetings/:id/bot', admin, wrap(deploy));
app.post('/api/meetings/:id/bot/leave', admin, wrap(async m => { if (m.bot.id) await recall.leaveCall(m.bot.id); return sync(store.get(m.id)); }));
app.post('/api/meetings/:id/sync', admin, wrap(sync));
app.post('/api/meetings/:id/summarize', admin, wrap(m => { if (!ai.enabled()) throw new Error('還沒設定 LLM_API_KEY'); return summarizeNow(m); }));

/**
 * 每分鐘巡一次：
 *   1. 有勾「自動派機器人」、離開始不到 2 分鐘、還沒派過的 → 派出去
 *   2. 在路上／在會議裡／處理中的 → 問一次狀態
 */
async function tick() {
  if (!recall.enabled()) return;
  const now = Date.now();
  for (const m of store.list()) {
    try {
      const start = m.start ? new Date(m.start).getTime() : 0;
      if (m.auto_bot && m.bot.status === 'none' && start && now >= start - 2 * 60000 && now <= start + 30 * 60000) await deploy(m);
      else if (['joining', 'in_call', 'processing'].includes(m.bot.status)) await sync(m);
    } catch (e) { console.warn(`[排程] ${m.title}：${e.message}`); }
  }
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`line-meeting-card 已啟動：${PUBLIC_URL}（後台 ${PUBLIC_URL}/admin.html）`);
    if (!/^https:\/\//.test(PUBLIC_URL)) console.log('提醒：PUBLIC_URL 不是 https，LINE 的卡片按鈕與 LIFF 都需要 https。本機測試請搭配 ngrok 或 cloudflared。');
    if (!LIFF_ID) console.log('提醒：還沒填 LIFF_ID，分享功能會顯示設定引導。');
    if (!ADMIN_TOKEN) console.log('提醒：還沒填 ADMIN_TOKEN，後台無法使用。');
    setInterval(() => tick().catch(() => {}), 60000);
  });
}
module.exports = { app, localToIso, tick };
