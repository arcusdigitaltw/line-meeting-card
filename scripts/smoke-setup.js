// 設定精靈的自我檢查：不設任何環境變數，走一遍「設定碼 → 設密碼 → 存設定 → 保密提醒的閘門」
const path = require('path'), os = require('os'), fs = require('fs');
for (const k of ['ADMIN_TOKEN', 'LIFF_ID', 'PUBLIC_URL', 'RECALL_API_KEY', 'LLM_API_KEY']) process.env[k] = '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-setup-'));
process.env.DATA_FILE = path.join(tmp, 'meetings.json'); process.env.CONFIG_FILE = path.join(tmp, 'config.json');
const { app, SETUP_CODE } = require('../server');
const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`; let fail = 0;
  const ok = (n, c, got) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(got).slice(0, 200)); if (!c) fail++; };
  const post = (u, b, tok) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-admin-token': tok } : {}) }, body: JSON.stringify(b || {}) });
  const PW = 'correct-horse-battery';
  try {
    ok('一開始需要設定', (await (await fetch(base + '/api/config')).json()).needs_setup === true);
    ok('還沒設密碼時後台進不去', (await fetch(base + '/api/meetings')).status === 503);
    ok('設定碼錯誤被擋', (await post('/api/setup/password', { setup_code: '000000', password: PW })).status === 401);
    ok('太短的密碼被擋', (await post('/api/setup/password', { setup_code: SETUP_CODE, password: 'short' })).status === 400);
    ok('設定碼正確 → 設好密碼', (await post('/api/setup/password', { setup_code: SETUP_CODE, password: PW })).status === 200);
    ok('設過之後這個入口就關閉', (await post('/api/setup/password', { setup_code: SETUP_CODE, password: PW + 'x' })).status === 409);
    ok('密碼不是明文存檔', !fs.readFileSync(process.env.CONFIG_FILE, 'utf8').includes(PW));
    ok('錯的密碼進不去', (await fetch(base + '/api/settings', { headers: { 'x-admin-token': 'nope' } })).status === 401);
    ok('LIFF ID 格式不對會被擋', (await post('/api/settings', { LIFF_ID: 'abc' }, PW)).status === 400);
    const sv = await (await post('/api/settings', { PUBLIC_URL: 'https://meet.example.tw/', LIFF_ID: '1234567890-AbCdEfGh', RECALL_API_KEY: 'rk_demo_1234', RECALL_REGION: 'us-west-2' }, PW)).json();
    ok('存設定、網址去掉結尾斜線、Endpoint URL 正確', sv.endpoint_url === 'https://meet.example.tw/share.html' && sv.https === true, sv);
    ok('金鑰不會回傳原文，只回最後四碼', sv.settings.RECALL_API_KEY.set === true && sv.settings.RECALL_API_KEY.hint === '••••1234' && !JSON.stringify(sv).includes('rk_demo_1234'), sv.settings.RECALL_API_KEY);
    const mk = await (await post('/api/meetings', { title: '測試', join_url: 'https://zoom.us/j/1' }, PW)).json();
    ok('存完不用重啟，分享連結就用新的 LIFF ID', mk.meeting.share_invite_url.startsWith('https://liff.line.me/1234567890-AbCdEfGh?invite='), mk);
    const bot = await post(`/api/meetings/${mk.meeting.id}/bot`, {}, PW); const bj = await bot.json();
    ok('沒勾保密提醒之前不能派機器人', bot.status === 400 && /使用提醒/.test(bj.error), bj);
    ok('勾選保密提醒', (await (await post('/api/settings', { ack_confidential: true }, PW)).json()).settings.ack_confidential === true);
  } catch (e) { console.error(e); fail++; }
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `${fail} 項失敗` : '全部通過'); process.exitCode = fail ? 1 : 0;
});
