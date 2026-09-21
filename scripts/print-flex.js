/**
 * 印出一張範例卡片的 Flex JSON。
 * 用法：npm run flex          → 邀請卡
 *       npm run flex summary  → 摘要卡
 * 把印出來的 JSON 貼到 LINE 官方的 Flex Message Simulator（https://developers.line.biz/flex-simulator/）就能預覽，
 * 改版型時先在這裡確認長相，再上手機測分享。
 */
const card = require('../lib/card');
const kind = process.argv[2] === 'summary' ? 'summary' : 'invite';
const m = {
  id: 'demo', title: '九月產品會議', description: '討論第四季上線時程與分工', start: '2026-09-25T11:00:00.000Z', end: '2026-09-25T13:00:00.000Z',
  location: '', address: '', join_url: 'https://zoom.us/j/1234567890?pwd=example', passcode: '8888', organizer: '範例公司',
  summary_points: ['十月十五日上線，先開放舊客戶', '客服知識庫由小美負責，十月一日前完成', '付款頁改成單頁結帳'], action_items: [{ text: '整理知識庫' }, { text: '付款頁改版' }],
};
const urls = { page: 'https://example.com/i/demo', ics: 'https://example.com/api/card/invite/demo/ics', google: 'https://example.com/api/card/invite/demo/google', summary: 'https://example.com/s/demo' };
const opt = { timezone: process.env.TIMEZONE || 'Asia/Taipei', accent: process.env.ACCENT_COLOR || '#0EA5E9' };
const flex = kind === 'invite' ? card.buildInviteFlex(m, urls, opt) : card.buildSummaryFlex(m, urls, opt);
const bad = card.findEmptyText(flex);
if (bad.length) { console.error('有空字串的 text，LINE 會拒收：', bad); process.exit(1); }
console.log(JSON.stringify(flex, null, 2));
