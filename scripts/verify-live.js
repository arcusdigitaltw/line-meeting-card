/**
 * 連到真的服務做一次實測（npm test／npm run smoke 都不連外，這一支才會）。
 * 用法：node scripts/verify-live.js
 *
 * 會用到你已經設定好的金鑰（.env 或設定精靈存的 data/config.json）。沒設定的項目會顯示「略過」。
 *   1. Recall 金鑰與區域對不對
 *   2. Recall 收不收我們送的機器人格式：建一個「兩天後才出發」的機器人，確認成功後立刻刪掉，不會進任何會議、不會產生費用
 *   3. LINE 收不收我們的卡片：用 LINE 官方的驗證 API 檢查邀請卡與摘要卡（只驗證、不會傳訊息給任何人）
 *      需要一組 Messaging API 的 channel access token，放在環境變數 LINE_CHANNEL_ACCESS_TOKEN（只在這支腳本用，程式本身不需要）
 *   4. AI 摘要：拿一段假的逐字稿實際請語言模型整理一次
 */
require('dotenv').config();
const config = require('../lib/config');
const recall = require('../lib/recall');
const ai = require('../lib/summary');
const card = require('../lib/card');

let fail = 0;
const line = (tag, name, note) => console.log(`${tag.padEnd(4)} ${name}${note ? `　${note}` : ''}`);
const pass = (n, note) => line('PASS', n, note);
const bad = (n, note) => { fail++; line('FAIL', n, note); };
const skip = (n, note) => line('略過', n, note);

const MEETING = {
  id: 'verify', title: '九月產品會議', description: '討論第四季上線時程與分工', start: new Date(Date.now() + 3 * 864e5).toISOString(), end: new Date(Date.now() + 3 * 864e5 + 7200e3).toISOString(),
  location: '範例會議室', address: '台南市東區範例路 1 號', join_url: 'https://zoom.us/j/1234567890?pwd=example', passcode: '8888', organizer: '範例公司',
  summary_points: ['十月十五日上線，先開放舊客戶', '付款頁改成單頁結帳', '客服知識庫十月一日前完成'], action_items: [{ text: '整理客服知識庫' }],
};
const base = (config.get('PUBLIC_URL') || 'https://example.com').replace(/\/+$/, '');
const URLS = { page: `${base}/i/demo`, ics: `${base}/api/card/invite/demo/ics`, google: `${base}/api/card/invite/demo/google`, summary: `${base}/s/demo` };
const OPT = { timezone: config.get('TIMEZONE'), accent: config.get('ACCENT_COLOR'), organizer: config.get('ORGANIZER_NAME') };

(async () => {
  // 1、2 Recall
  if (!recall.enabled()) skip('Recall 金鑰', '還沒設定 RECALL_API_KEY');
  else {
    const t = await recall.testKey(config.get('RECALL_API_KEY'), config.get('RECALL_REGION')).catch(e => ({ ok: false, reason: e.message }));
    if (t.ok) pass('Recall 金鑰與區域', config.get('RECALL_REGION')); else bad('Recall 金鑰與區域', t.reason);
    if (t.ok) {
      let id = null;
      try {
        const bot = await recall.scheduleBot({ meetingUrl: MEETING.join_url, botName: '實測・會議記錄', language: 'zh', joinMessage: '這是格式實測，不會真的加入會議。' }, new Date(Date.now() + 2 * 864e5).toISOString());
        id = bot && bot.id;
        if (id) pass('Recall 接受我們的機器人格式（中文逐字稿、進場自我介紹、自動離開）', `預約機器人 ${String(id).slice(0, 8)}…`); else bad('Recall 建立機器人', JSON.stringify(bot).slice(0, 200));
      } catch (e) { bad('Recall 建立機器人', e.message); }
      if (id) { try { await recall.deleteScheduledBot(id); pass('已刪除實測用的預約機器人', '沒有進任何會議、不產生費用'); } catch (e) { bad('刪除實測用的機器人', `${e.message}（請到 Recall 後台手動刪除 ${id}）`); } }
    }
  }

  // 3 LINE 官方驗證
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const cards = [['邀請卡', card.buildInviteFlex(MEETING, URLS, OPT)], ['邀請卡（幾乎什麼都沒填）', card.buildInviteFlex({ id: 'x', title: '只有標題' }, URLS, OPT)], ['摘要卡', card.buildSummaryFlex(MEETING, URLS, OPT)]];
  for (const [name, flex] of cards) {
    const empty = card.findEmptyText(flex);
    if (empty.length) { bad(`${name}：有空字串`, empty.join(', ')); continue; }
    if (!lineToken) { skip(`LINE 官方驗證・${name}`, '沒有 LINE_CHANNEL_ACCESS_TOKEN'); continue; }
    const res = await fetch('https://api.line.me/v2/bot/message/validate/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` }, body: JSON.stringify({ messages: [{ type: 'flex', altText: name, contents: flex }] }) });
    if (res.ok) pass(`LINE 官方驗證・${name}`); else bad(`LINE 官方驗證・${name}`, `${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  // 4 AI 摘要
  if (!ai.enabled()) skip('AI 摘要', '還沒設定 LLM_API_KEY');
  else {
    const say = ['我們先確認上線時間，我的想法是十月十五日，先開放給舊客戶，觀察一週沒有問題再全面開放。', '可以，但付款頁要先改，現在的流程要跳三頁，很多人在第二頁就離開了，我建議改成單頁結帳。', '同意。那付款頁改版由阿哲負責，十月十日前要完成，才來得及測試。', '客服知識庫的部分，小美這邊整理到哪裡了？上線前一定要好，不然客服會被問爆。', '目前整理了六成，主要卡在退換貨規則還沒定案，法務那邊說這週五會給我們最後版本，我十月一日前可以全部完成。', '好，那就這樣。結論是十月十五日上線、先開放舊客戶；付款頁阿哲十月十日前完成；知識庫小美十月一日前完成；之後每週一早上同步一次進度。'];
    const transcript = say.map((text, i) => ({ speaker: ['王經理', '阿哲', '王經理', '王經理', '小美', '王經理'][i], start: i * 40, text }));
    try {
      const out = await ai.summarize({ title: MEETING.title, transcript });
      const okShape = out.summary && out.summary_points.length >= 2 && Array.isArray(out.action_items);
      if (okShape) pass('AI 摘要', `重點 ${out.summary_points.length} 條、待辦 ${out.action_items.length} 項・${config.get('LLM_MODEL')}`); else bad('AI 摘要格式不對', JSON.stringify(out).slice(0, 300));
      if (okShape) { console.log('       重點：' + out.summary_points.join('｜')); const f = card.buildSummaryFlex({ ...MEETING, ...out }, URLS, OPT); if (card.findEmptyText(f).length) bad('用真的摘要做出來的摘要卡有空字串'); }
    } catch (e) { bad('AI 摘要', e.message); }
  }
  console.log(fail ? `\n${fail} 項失敗` : '\n實測完成，沒有失敗的項目');
  process.exitCode = fail ? 1 : 0;
})();
