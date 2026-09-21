/**
 * 最簡單的資料層：一個 JSON 檔（data/meetings.json）。
 * 為什麼不用資料庫：這個專案的重點是 LIFF 分享，少一個要裝的東西就少一個卡關的地方。
 * 會議量大了再換成 SQLite／Postgres，只要維持這五個函式的介面就好（可以直接請 Claude Code 換）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'meetings.json');
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { cache = { meetings: [] }; }
  if (!Array.isArray(cache.meetings)) cache.meetings = [];
  return cache;
}

/** 先寫暫存檔再改名，避免寫到一半當機把資料弄壞 */
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}

/** 公開網址用的亂數代碼：猜不到，所以拿得到連結的人才看得到 */
const token = () => crypto.randomBytes(12).toString('base64url');

const list = () => load().meetings.slice().sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
const get = id => load().meetings.find(m => m.id === id) || null;
const getByToken = (field, value) => (value ? load().meetings.find(m => m[field] === value) || null : null);

function create(data) {
  const now = new Date().toISOString();
  const m = {
    id: crypto.randomUUID(), invite_token: token(), summary_token: token(),
    title: '', description: '', start: null, end: null, location: '', address: '', join_url: '', passcode: '', organizer: '', cover: '',
    auto_bot: false, language: 'zh',
    bot: { id: null, status: 'none', attempts: 0, error: null },   // none → joining → in_call → processing → done／failed
    transcript: [], summary: '', summary_points: [], action_items: [],
    created_at: now, updated_at: now, ...data,
  };
  load().meetings.push(m); save();
  return m;
}

function update(id, patch) {
  const m = get(id);
  if (!m) return null;
  Object.assign(m, patch, { updated_at: new Date().toISOString() });
  save();
  return m;
}

function remove(id) {
  const d = load(); const n = d.meetings.length;
  d.meetings = d.meetings.filter(m => m.id !== id);
  if (d.meetings.length !== n) save();
  return d.meetings.length !== n;
}

module.exports = { list, get, getByToken, create, update, remove };
