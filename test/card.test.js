// 跑法：npm test（用 Node 內建的測試工具，不用另外裝套件）
const test = require('node:test');
const assert = require('node:assert');
const card = require('../lib/card');
const recall = require('../lib/recall');

const M = { id: 'm1', title: '九月產品會議', description: '討論第四季上線時程', start: '2026-09-25T11:00:00.000Z', end: '2026-09-25T13:00:00.000Z',
  location: '範例會議室', address: '台南市東區範例路 1 號', join_url: 'https://zoom.us/j/123?pwd=abc', passcode: '8888', organizer: '林品妤', cover: '' };
const URLS = { page: 'https://ex.tw/i/t', ics: 'https://ex.tw/api/card/invite/t/ics', google: 'https://ex.tw/api/card/invite/t/google', summary: 'https://ex.tw/s/s' };
const OPT = { timezone: 'Asia/Taipei', accent: '#0EA5E9' };

test('時間顯示換成指定時區', () => {
  assert.strictEqual(card.whenLabel(M, 'Asia/Taipei'), '2026/9/25（五）19:00–21:00');
  assert.strictEqual(card.whenLabel({ start: M.start }, 'Asia/Taipei'), '2026/9/25（五）19:00');
  assert.strictEqual(card.whenLabel({}, 'Asia/Taipei'), null);
});

test('邀請卡沒有空字串的 text（有的話 shareTargetPicker 會安靜失敗）', () => {
  assert.deepStrictEqual(card.findEmptyText(card.buildInviteFlex(M, URLS, OPT)), []);
  // 幾乎什麼都沒填也不能出現空字串
  assert.deepStrictEqual(card.findEmptyText(card.buildInviteFlex({ id: 'x', title: '' }, URLS, OPT)), []);
  assert.deepStrictEqual(card.findEmptyText(card.buildSummaryFlex({ title: '', summary_points: ['', '  '] }, URLS, OPT)), []);
});

test('邀請卡的按鈕：會議連結、地圖、兩種行事曆、完整資訊', () => {
  const labels = card.buildInviteFlex(M, URLS, OPT).footer.contents.map(b => b.action.label);
  assert.deepStrictEqual(labels, ['前往會議', 'Google Map 導航', '加入 Google 行事曆', '加入 Apple 行事曆', '查看完整資訊']);
});

test('行事曆按鈕帶 openExternalBrowser，且每個按鈕網址都在 1000 字內', () => {
  const btns = card.buildInviteFlex(M, URLS, OPT).footer.contents;
  assert.ok(btns.find(b => b.action.label === '加入 Apple 行事曆').action.uri.includes('openExternalBrowser=1'));
  for (const b of btns) assert.ok(b.action.uri.length <= 1000, b.action.label);
});

test('封面只接受 https 的 JPG／PNG', () => {
  assert.strictEqual(card.flexImage('https://a.tw/x.webp'), null);
  assert.strictEqual(card.flexImage('http://a.tw/x.jpg'), null);
  assert.strictEqual(card.flexImage('https://a.tw/x.JPG?v=2'), 'https://a.tw/x.JPG?v=2');
  assert.ok(!card.buildInviteFlex({ ...M, cover: 'https://a.tw/x.webp' }, URLS, OPT).hero);
  assert.ok(card.buildInviteFlex({ ...M, cover: 'https://a.tw/x.png' }, URLS, OPT).hero);
});

test('.ics：每行不超過 75 位元組、中文不被切半、時間是 UTC', () => {
  const ics = card.buildIcs(M, URLS, { now: new Date('2026-09-01T00:00:00Z') });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.ok(ics.includes('DTSTART:20260925T110000Z'));
  assert.ok(!ics.includes('�'));
  assert.strictEqual(card.buildIcs({ id: 'x', title: 't' }, URLS), null);
});

test('Google 行事曆網址帶時區與起訖時間', () => {
  const u = new URL(card.googleCalendarUrl(M, URLS, 'Asia/Taipei'));
  assert.strictEqual(u.searchParams.get('dates'), '20260925T110000Z/20260925T130000Z');
  assert.strictEqual(u.searchParams.get('ctz'), 'Asia/Taipei');
});

test('逐字稿：中文直接接、英文用空白隔開', () => {
  assert.strictEqual(recall.joinWords([{ text: '大家' }, { text: '好' }]), '大家好');
  assert.strictEqual(recall.joinWords([{ text: 'hello' }, { text: 'world' }]), 'hello world');
});

test('機器人狀態對應', () => {
  assert.strictEqual(recall.mapStatus({ status_changes: [{ code: 'joining_call' }] }).status, 'joining');
  assert.strictEqual(recall.mapStatus({ status_changes: [{ code: 'in_call_recording' }] }).status, 'in_call');
  assert.strictEqual(recall.mapStatus({ status_changes: [{ code: 'done' }] }).status, 'processing');
  const f = recall.mapStatus({ status_changes: [{ code: 'fatal', sub_code: 'meeting_password_incorrect' }] });
  assert.strictEqual(f.status, 'failed'); assert.ok(f.error.includes('密碼'));
});

test('語音轉文字：中文用 recallai_streaming，英文用內建字幕', () => {
  assert.ok(recall.transcriptProvider('zh').recallai_streaming);
  assert.ok(recall.transcriptProvider('en').meeting_captions);
});
