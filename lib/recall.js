/**
 * 會議機器人：用 Recall.ai 派一個機器人進 Zoom／Google Meet／Teams，會後拿逐字稿。
 * 沒填 RECALL_API_KEY 時整個功能自動關閉，資訊卡分享照常可用。
 *
 * 這裡刻意「不用 webhook」，改成每分鐘去問一次機器人的狀態：
 *   少設一個 webhook、少一個簽章驗證，自己架的人比較不會卡關；代價只是狀態最多慢一分鐘。
 */
const KEY = process.env.RECALL_API_KEY || '';
const REGION = process.env.RECALL_REGION || 'us-west-2';
const BASE = `https://${REGION}.recall.ai/api/v1`;
const enabled = () => !!KEY;

async function call(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method, headers: { Authorization: `Token ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* 不是 JSON 就留原文 */ }
  if (!res.ok) {
    const why = res.status === 402 ? 'Recall 帳戶額度不足'
      : (res.status === 401 || res.status === 403) ? 'RECALL_API_KEY 不正確，或區域（RECALL_REGION）選錯'
      : res.status === 400 ? `會議連結有問題：${text.slice(0, 200)}` : `Recall 回應 ${res.status}：${text.slice(0, 200)}`;
    const err = new Error(why); err.status = res.status; throw err;
  }
  return json;
}

/**
 * 語音轉文字的選擇（實測心得）：
 *   中文 → recallai_streaming 的 prioritize_accuracy 最穩；meeting_captions（Zoom／Meet 內建字幕）中文幾乎不能用。
 *   英文 → meeting_captions 免費而且夠用。
 */
function transcriptProvider(lang) {
  if (String(lang || 'zh').startsWith('en')) return { meeting_captions: {} };
  return { recallai_streaming: { mode: 'prioritize_accuracy', language_code: 'zh' } };
}

/** 派機器人進會議 */
function deployBot({ meetingUrl, botName, language, joinMessage }) {
  return call('POST', '/bot/', {
    meeting_url: meetingUrl,
    bot_name: botName,
    recording_config: { transcript: { provider: transcriptProvider(language) } },
    // 進會議後在聊天室說明自己是誰、在做什麼（錄音前先告知，是基本禮貌也是法遵）
    ...(joinMessage ? { chat: { on_bot_join: { send_to: 'everyone', message: joinMessage } } } : {}),
    // 等候室 5 分鐘沒被放行、沒人來、或大家都走了 → 自己離開，不會卡著一直計費
    automatic_leave: { waiting_room_timeout: 300, noone_joined_timeout: 300, everyone_left_timeout: 60 },
  });
}

const getBot = id => call('GET', `/bot/${id}/`);
const leaveCall = id => call('POST', `/bot/${id}/leave_call/`);

/** Recall 的狀態碼 → 我們自己的五種狀態 */
function mapStatus(bot) {
  const changes = bot.status_changes || [];
  const last = changes[changes.length - 1] || {};
  const code = last.code || '';
  if (code === 'fatal') return { status: 'failed', error: reasonText(last.sub_code) };
  if (code === 'done') return { status: 'processing' };
  if (code === 'call_ended' || code === 'recording_done') return { status: 'processing' };
  if (/^in_call/.test(code)) return { status: 'in_call' };
  return { status: 'joining' };                         // ready／joining_call／in_waiting_room
}

function reasonText(sub) {
  const map = {
    timeout_exceeded_waiting_room: '機器人在等候室等了 5 分鐘沒被放行。請主持人放行，或把會議設成不需要等候室。',
    meeting_not_started: '會議還沒開始，機器人進不去。',
    meeting_password_incorrect: '會議密碼不對。請貼「含密碼」的完整邀請連結。',
    meeting_link_invalid: '會議連結無效。',
    meeting_requires_sign_in: '這場會議要求登入才能加入，機器人進不去。請關掉「僅限已驗證的使用者」。',
    bot_kicked_from_call: '機器人被移出會議。',
  };
  return map[sub] || `機器人沒能加入（${sub || '原因不明'}）`;
}

/** 中日韓文字直接接起來，英文才用空白隔開 */
function joinWords(words) {
  const parts = (words || []).map(w => (w && (w.text || w.word)) || '').filter(Boolean);
  if (!parts.length) return '';
  const joined = parts.join('');
  return /[一-鿿぀-ヿ가-힯]/.test(joined) ? joined : parts.join(' ');
}

/** 會後下載逐字稿；還沒轉完回 null，轉失敗丟錯 */
async function fetchTranscript(bot) {
  const shortcut = ((bot.recordings || [])[0] || {}).media_shortcuts?.transcript;
  if (!shortcut) return null;
  const st = shortcut.status?.code;
  if (st === 'failed') throw new Error(`語音轉文字失敗（${shortcut.status?.sub_code || '原因不明'}）`);
  const url = shortcut.data?.download_url;
  if (st !== 'done' || !url) return null;
  const res = await fetch(url);                         // 這是有時效的下載網址，不用帶金鑰
  if (!res.ok) throw new Error(`逐字稿下載失敗（${res.status}）`);
  const json = await res.json();
  const segs = Array.isArray(json) ? json : (json.results || json.transcript || []);
  return segs.map(s => {
    const words = Array.isArray(s.words) ? s.words : [];
    const first = words[0] || {};
    return {
      speaker: s.participant?.name || s.speaker || s.speaker_name || '',
      start: Math.round(s.start_time ?? first.start_timestamp?.relative ?? first.start_time ?? 0),
      text: (typeof s.text === 'string' && s.text) || joinWords(words),
    };
  }).filter(x => x.text.trim());
}

module.exports = { enabled, deployBot, getBot, leaveCall, mapStatus, fetchTranscript, joinWords, transcriptProvider, reasonText };
