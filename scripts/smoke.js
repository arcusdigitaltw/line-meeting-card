// 本機冒煙測試：起一個暫時的伺服器，走一遍「建會議 → 拿卡片 → ics → google → 邀請頁 → 權限」
process.env.RECALL_API_KEY = ''; process.env.LLM_API_KEY = '';   // 不管 .env 填了什麼，自我檢查都不真的連出去
process.env.ADMIN_TOKEN = 'smoke-token'; process.env.LIFF_ID = '1234567890-AbCdEfGh'; process.env.PUBLIC_URL = 'https://example.test';
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), `lmc-smoke-${Date.now()}.json`);
const { app } = require('../server');
const card = require('../lib/card');
const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`; let fail = 0;
  const ok = (n, c, got) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(got).slice(0, 200)); if (!c) fail++; };
  const H = { 'Content-Type': 'application/json', 'x-admin-token': 'smoke-token' };
  try {
    ok('沒帶密碼被擋', (await fetch(`${base}/api/meetings`)).status === 401);
    const mk = await (await fetch(`${base}/api/meetings`, { method: 'POST', headers: H, body: JSON.stringify({ title: '冒煙測試會議', start: '2026-09-25T19:00', end: '2026-09-25T21:00', join_url: 'https://zoom.us/j/1?pwd=x', organizer: '測試' }) })).json();
    const m = mk.meeting; ok('建立會議、當地時間轉成 UTC', m && m.start === '2026-09-25T11:00:00.000Z', mk);
    ok('分享連結是 LIFF 網址', m.share_invite_url === `https://liff.line.me/1234567890-AbCdEfGh?invite=${m.invite_token}`, m.share_invite_url);
    const c = await (await fetch(`${base}/api/card/invite/${m.invite_token}`)).json();
    ok('卡片資料含 Flex 與 LIFF ID、沒有空字串', c.flex && c.liff_id && card.findEmptyText(c.flex).length === 0, c);
    ok('邀請卡不外洩摘要與逐字稿', !('summary' in c) && !('transcript' in c), Object.keys(c));
    const ics = await fetch(`${base}/api/card/invite/${m.invite_token}/ics`); ok('ics 可下載', ics.status === 200 && (await ics.text()).includes('BEGIN:VEVENT'));
    const g = await fetch(`${base}/api/card/invite/${m.invite_token}/google`, { redirect: 'manual' }); ok('google 行事曆 302', g.status === 302 && g.headers.get('location').includes('calendar.google.com'));
    const pg = await (await fetch(`${base}/i/${m.invite_token}`)).text(); ok('邀請頁有這一場的 OG 標題', pg.includes('會議邀請｜冒煙測試會議') && !pg.includes('__OG_'));
    ok('沒摘要時摘要卡 404', (await fetch(`${base}/api/card/summary/${m.summary_token}`)).status === 404);
    ok('亂猜代碼 404', (await fetch(`${base}/api/card/invite/nope`)).status === 404);
    const bad = await fetch(`${base}/api/meetings`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'x', cover: 'https://a.tw/a.webp' }) }); ok('WebP 封面被擋', bad.status === 400);
    const bot = await fetch(`${base}/api/meetings/${m.id}/bot`, { method: 'POST', headers: H }); ok('沒設 Recall 金鑰時派機器人回清楚的錯誤', bot.status === 400 && (await bot.json()).error.includes('RECALL_API_KEY'));
    ok('刪除', (await (await fetch(`${base}/api/meetings/${m.id}`, { method: 'DELETE', headers: H })).json()).success === true);
  } catch (e) { console.error(e); fail++; }
  srv.close(); try { require('fs').unlinkSync(process.env.DATA_FILE); } catch (e) {}
  console.log(fail ? `${fail} 項失敗` : '全部通過'); process.exitCode = fail ? 1 : 0;
});
