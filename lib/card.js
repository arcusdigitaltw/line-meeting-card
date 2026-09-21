/**
 * 會議資訊卡的核心：把一場會議變成 LINE Flex Message、行事曆檔（.ics）、Google 行事曆網址。
 * 這個檔案全部是純函式（不讀資料庫、不連網路），方便測試，也方便你請 Claude Code 改版型。
 *
 * 踩過的雷都寫在註解裡，改之前先看一眼：
 *   1. Flex 裡任何一個 text 是空字串 → shareTargetPicker 會「安靜地失敗」，沒有錯誤訊息。
 *   2. Flex 的圖片只吃 https 的 JPEG／PNG，WebP 會讓整則訊息送不出去。
 *   3. Flex 按鈕的網址上限 1000 字；Google 行事曆網址帶中文很容易超過 → 用自己的短網址再 302 轉過去。
 *   4. LINE 內建瀏覽器開 .ics 會失敗 → 網址加 openExternalBrowser=1，讓手機用預設瀏覽器開。
 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');
const clip = (s, n) => { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const isHttp = u => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
const mapUrl = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const ext = u => `${u}${u.includes('?') ? '&' : '?'}openExternalBrowser=1`;

/** 在指定時區的日期時間零件 */
function partsIn(date, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hm: `${p.hour}:${p.minute}`, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** 顯示用時間：「2026/9/25（五）19:00–21:00」 */
function whenLabel(m, tz) {
  if (!m.start) return null;
  const s = partsIn(new Date(m.start), tz);
  const head = `${s.y}/${s.m}/${s.d}（${WEEK[s.wd]}）`;
  if (!m.end) return `${head}${s.hm}`;
  const e = partsIn(new Date(m.end), tz);
  const sameDay = e.y === s.y && e.m === s.m && e.d === s.d;
  return `${head}${s.hm}–${sameDay ? '' : `${e.m}/${e.d} `}${e.hm}`;
}

const icsUtc = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsEscape = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** RFC 5545：每行最多 75 個位元組，續行以一個空白開頭；不能把一個中文字切成兩半 */
function icsFold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function calendarDetails(m, urls) {
  return [
    m.description ? clip(m.description, 400) : null,
    m.join_url ? `會議連結：${m.join_url}` : null,
    m.passcode ? `會議密碼：${m.passcode}` : null,
    `詳細資訊：${urls.page}`,
  ].filter(Boolean).join('\n\n');
}
const calendarLocation = m => [m.location, m.address].filter(Boolean).join(' ') || m.join_url || '';

function googleCalendarUrl(m, urls, tz) {
  if (!m.start) return null;
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: m.title,
    dates: `${icsUtc(new Date(m.start))}/${icsUtc(new Date(m.end || m.start))}`,
    details: calendarDetails(m, urls), location: calendarLocation(m), ctz: tz,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function buildIcs(m, urls, { host = 'line-meeting-card', now = new Date() } = {}) {
  if (!m.start) return null;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//line-meeting-card//ZH-TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${m.id}@${host}`, `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(new Date(m.start))}`, `DTEND:${icsUtc(new Date(m.end || m.start))}`,
    `SUMMARY:${icsEscape(m.title)}`, `DESCRIPTION:${icsEscape(calendarDetails(m, urls))}`,
  ];
  const loc = calendarLocation(m);
  if (loc) lines.push(`LOCATION:${icsEscape(loc)}`);
  lines.push(`URL:${m.join_url || urls.page}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(m.title)}`, 'TRIGGER:-PT1H', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** LINE Flex 只吃 https 的 JPEG／PNG */
function flexImage(u) {
  if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return null;
  return /\.(jpe?g|png)$/i.test(u.split('?')[0]) ? u : null;
}

const INK = '#0B0B0D', SUB = '#54524D', MUTE = '#9A978F';
const row = (label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    { type: 'text', text: label, size: 'sm', color: MUTE, flex: 2 },
    { type: 'text', text: value, size: 'sm', color: INK, flex: 7, wrap: true },
  ],
});
const btn = (label, uri, style, accent) => ({
  type: 'button', style, height: 'sm', ...(style === 'primary' ? { color: accent } : {}),
  action: { type: 'uri', label, uri },
});

/**
 * 會議邀請卡。m＝會議資料，urls＝{ page, ics, google }（都要是 https 的絕對網址），opt＝{ timezone, accent, organizer }
 * 排版用 horizontal＋正值 flex（flex:0 在預覽器會塌掉）。
 */
function buildInviteFlex(m, urls, opt) {
  const accent = opt.accent || '#0EA5E9';
  const rows = [row('時間', whenLabel(m, opt.timezone) || '時間待定')];
  const place = [m.location, m.address].filter(Boolean).join('\n');
  if (place) rows.push(row('地點', clip(place, 120)));
  else if (m.join_url) rows.push(row('地點', '線上會議'));
  if (m.passcode) rows.push(row('密碼', clip(m.passcode, 40)));
  const host = m.organizer || opt.organizer;
  if (host) rows.push(row('主辦', clip(host, 60)));

  const buttons = [];
  if (isHttp(m.join_url)) buttons.push(btn('前往會議', m.join_url.trim(), 'primary', accent));
  const mq = m.address || m.location;
  if (mq) buttons.push(btn('Google Map 導航', mapUrl(mq), buttons.length ? 'secondary' : 'primary', accent));
  if (m.start) {
    buttons.push(btn('加入 Google 行事曆', ext(urls.google), 'secondary', accent));
    buttons.push(btn('加入 Apple 行事曆', ext(urls.ics), 'secondary', accent));
  }
  buttons.push(btn('查看完整資訊', urls.page, 'link', accent));

  const cover = flexImage(m.cover);
  return {
    type: 'bubble', size: 'mega',
    ...(cover ? { hero: { type: 'image', url: cover, size: 'full', aspectRatio: '20:11', aspectMode: 'cover', action: { type: 'uri', uri: urls.page } } } : {}),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', backgroundColor: '#FFFFFF', contents: [
        { type: 'text', text: m.label || '會議邀請', size: 'xs', weight: 'bold', color: accent },
        { type: 'text', text: clip(m.title || '未命名會議', 80), size: 'xl', weight: 'bold', color: INK, wrap: true },
        ...(m.description ? [{ type: 'text', text: clip(m.description.replace(/\s+/g, ' '), 90), size: 'sm', color: SUB, wrap: true }] : []),
        { type: 'separator', margin: 'lg', color: '#ECEAE4' },
        { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows },
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#FFFFFF', contents: buttons },
  };
}

/** 會後摘要卡：重點三到五條＋待辦數，完整內容點進摘要頁看（卡片放不下長文） */
function buildSummaryFlex(m, urls, opt) {
  const accent = opt.accent || '#0EA5E9';
  const points = (m.summary_points || []).map(p => String(p || '').trim()).filter(Boolean).slice(0, 5);
  const todo = (m.action_items || []).length;
  return {
    type: 'bubble', size: 'mega',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', backgroundColor: '#FFFFFF', contents: [
        { type: 'text', text: '會議摘要', size: 'xs', weight: 'bold', color: accent },
        { type: 'text', text: clip(m.title || '未命名會議', 80), size: 'xl', weight: 'bold', color: INK, wrap: true },
        { type: 'text', text: whenLabel(m, opt.timezone) || '時間未填', size: 'sm', color: SUB, wrap: true },
        { type: 'separator', margin: 'lg', color: '#ECEAE4' },
        {
          type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg',
          contents: (points.length ? points : ['摘要整理中']).map(p => ({
            type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'text', text: '・', size: 'sm', color: accent, flex: 1 },
              { type: 'text', text: clip(p, 110), size: 'sm', color: INK, flex: 12, wrap: true },
            ],
          })),
        },
        ...(todo ? [{ type: 'text', text: `待辦事項 ${todo} 項`, size: 'xs', color: MUTE, margin: 'lg' }] : []),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', backgroundColor: '#FFFFFF', contents: [btn('查看完整摘要', urls.summary, 'primary', accent)] },
  };
}

/** 遞迴檢查 Flex 裡有沒有空字串的 text（有的話 shareTargetPicker 會安靜失敗） */
function findEmptyText(node, path = 'flex') {
  const bad = [];
  if (Array.isArray(node)) node.forEach((n, i) => bad.push(...findEmptyText(n, `${path}[${i}]`)));
  else if (node && typeof node === 'object') {
    if (node.type === 'text' && !String(node.text == null ? '' : node.text).trim()) bad.push(path);
    for (const k of Object.keys(node)) bad.push(...findEmptyText(node[k], `${path}.${k}`));
  }
  return bad;
}

module.exports = { whenLabel, buildIcs, googleCalendarUrl, buildInviteFlex, buildSummaryFlex, findEmptyText, flexImage, icsFold, clip, isHttp };
