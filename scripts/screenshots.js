/**
 * 產生教學用的截圖（docs/img/）：用暫時的資料檔起一個伺服器，塞幾場示範會議，再用瀏覽器截圖。
 * 需要 playwright-core 與本機的 Edge／Chrome：npm i -D playwright-core 之後執行 node scripts/screenshots.js
 * 不會動到你真正的 data/meetings.json，也不會連 LINE／Recall。
 */
const path = require('path'), os = require('os'), fs = require('fs');
for (const k of ['ADMIN_TOKEN', 'LIFF_ID', 'PUBLIC_URL', 'RECALL_API_KEY', 'LLM_API_KEY']) process.env[k] = '';   // 全部走設定精靈，才截得到精靈的畫面
process.env.BRAND_NAME = '範例公司'; process.env.ORGANIZER_NAME = '範例公司';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-shots-'));
process.env.DATA_FILE = path.join(TMP, 'meetings.json'); process.env.CONFIG_FILE = path.join(TMP, 'config.json');
const { app, SETUP_CODE } = require('../server');
const PW = 'demo-password-2026';
const store = require('../lib/store');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright-core')); } catch (e) { console.error('請先安裝：npm i -D playwright-core'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'docs', 'img'); fs.mkdirSync(OUT, { recursive: true });
const day = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };

const srv = app.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const a = store.create({ title: '九月產品會議', description: '討論第四季上線時程與分工', start: day(2, 19), end: day(2, 21), join_url: 'https://zoom.us/j/1234567890?pwd=example', passcode: '8888', organizer: '範例公司', auto_bot: true });
  store.create({ title: '設計小聚', description: '這個月聊品牌識別與 AI 生圖', start: day(5, 14), end: day(5, 16), location: '範例共同工作空間', address: '台南市東區範例路 1 號 3 樓', organizer: '設計社群' });
  const c = store.create({ title: '客戶週會｜光合生活館', start: day(0, 10), end: day(0, 11), join_url: 'https://meet.google.com/abc-defg-hij', organizer: '範例公司' });
  store.update(c.id, { bot: { id: 'demo-bot-1', status: 'in_call', attempts: 1, error: null } });
  const d = store.create({ title: '八月營運檢討', start: day(-6, 15), end: day(-6, 16, 30), join_url: 'https://zoom.us/j/555?pwd=demo', organizer: '範例公司' });
  store.update(d.id, { bot: { id: 'demo-bot-2', status: 'done', attempts: 1, error: null }, transcript: [{ speaker: '王經理', start: 0, text: '…' }],
    summary: '## 上線時程\n- 十月十五日上線，先開放**舊客戶**\n- 付款頁改成單頁結帳\n\n## 客服知識庫\n- 由小美負責整理，十月一日前完成\n\n## 結論與共識\n- 每週一同步進度',
    summary_points: ['十月十五日上線，先開放舊客戶', '付款頁改成單頁結帳', '客服知識庫十月一日前完成'], action_items: [{ text: '整理客服知識庫', assignee: '小美', due_date: '2026-10-01' }, { text: '付款頁改版', assignee: '阿哲', due_date: null }] });
  const e = store.create({ title: '合作洽談｜某某設計', start: day(-1, 16), end: day(-1, 17), join_url: 'https://zoom.us/j/777', organizer: '範例公司' });
  store.update(e.id, { bot: { id: 'demo-bot-3', status: 'failed', attempts: 2, error: '會議密碼不對。請貼「含密碼」的完整邀請連結。' } });

  const b = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const desk = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  let p = await desk.newPage(); 
  // 設定精靈：一步一步截
  const shot = async (name, full) => { await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full }); };
  await p.goto(`${base}/setup.html`); await p.waitForTimeout(600);
  await p.check('#ack'); await shot('setup-0-notice', true);
  await p.evaluate(() => document.getElementById('n0').click()); await p.fill('#code', SETUP_CODE); await p.fill('#pw1', PW); await p.fill('#pw2', PW); await shot('setup-1-password', true);
  await p.evaluate(() => document.getElementById('n1').click()); await p.waitForTimeout(600); await p.fill('#pub', 'https://meet.example.tw');
  // 兩種取得 https 網址的圖解各截一張（教學文件會用到），再截整頁
  await p.evaluate(() => document.querySelectorAll('details.way').forEach(d => { d.open = true; }));
  await p.waitForTimeout(300);
  await p.locator('details.way').nth(0).screenshot({ path: path.join(OUT, 'url-a-quick-tunnel.png') });
  await p.locator('details.way').nth(1).screenshot({ path: path.join(OUT, 'url-b-cloudflare-domain.png') });
  await shot('setup-2-url', true);
  await p.evaluate(() => document.getElementById('n2').click()); await p.waitForTimeout(600); await p.fill('#liff', '1234567890-AbCdEfGh'); await shot('setup-3-line', true);
  await p.evaluate(() => document.getElementById('n3').click()); await p.waitForTimeout(600); await p.fill('#rkey', 'demo-recall-key-a1b2'); await shot('setup-4-recall', true);
  await p.evaluate(() => document.getElementById('n4').click()); await p.waitForTimeout(900); await p.fill('#lkey', 'demo-llm-key-c3d4'); await shot('setup-5-ai', true);
  await p.evaluate(() => document.getElementById('n5').click()); await p.waitForTimeout(600); await shot('setup-6-done', true);
  await p.evaluate(() => localStorage.clear());
  await p.goto(`${base}/admin.html`); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'admin-login.png') });
  await p.fill('#tok', PW); await p.click('#login'); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, 'admin.png'), fullPage: true });
  await p.locator('.m button', { hasText: '編輯' }).first().click(); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'admin-edit.png') });
  const mob = await b.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  for (const [name, url] of [['invite-page', `/i/${a.invite_token}`], ['summary-page', `/s/${d.summary_token}`]]) {
    p = await mob.newPage(); await p.goto(base + url); await p.waitForTimeout(1200); await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  }
  await b.close(); srv.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log('已輸出到', OUT); process.exitCode = 0;
});
