/**
 * 產生教學用的截圖（docs/img/）：用暫時的資料檔起一個伺服器，塞幾場示範會議，再用瀏覽器截圖。
 * 需要 playwright-core 與本機的 Edge／Chrome：npm i -D playwright-core 之後執行 node scripts/screenshots.js
 * 不會動到你真正的 data/meetings.json，也不會連 LINE／Recall。
 */
const path = require('path'), os = require('os'), fs = require('fs');
process.env.ADMIN_TOKEN = 'demo'; process.env.LIFF_ID = '1234567890-AbCdEfGh'; process.env.PUBLIC_URL = 'https://meet.example.tw';
process.env.RECALL_API_KEY = 'demo'; process.env.LLM_API_KEY = 'demo'; process.env.BRAND_NAME = '範例公司'; process.env.ORGANIZER_NAME = '範例公司';
process.env.DATA_FILE = path.join(os.tmpdir(), `lmc-shots-${Date.now()}.json`);
const { app } = require('../server');
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
  await p.goto(`${base}/admin.html`); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'admin-login.png') });
  await p.fill('#tok', 'demo'); await p.click('#login'); await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(OUT, 'admin.png'), fullPage: true });
  await p.locator('.m button', { hasText: '編輯' }).first().click(); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, 'admin-edit.png') });
  const mob = await b.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  for (const [name, url] of [['invite-page', `/i/${a.invite_token}`], ['summary-page', `/s/${d.summary_token}`]]) {
    p = await mob.newPage(); await p.goto(base + url); await p.waitForTimeout(1200); await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  }
  await b.close(); srv.close(); try { fs.unlinkSync(process.env.DATA_FILE); } catch (x) {}
  console.log('已輸出到', OUT); process.exitCode = 0;
});
