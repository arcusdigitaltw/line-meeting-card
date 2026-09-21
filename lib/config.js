/**
 * 設定的來源有兩個，環境變數優先：
 *   1. .env／環境變數（適合會用終端機的人、或雲端平台的設定頁）
 *   2. data/config.json（由瀏覽器裡的「設定精靈」寫入，不用碰任何檔案）
 * 金鑰和 .env 一樣是明文存在你自己的主機上；data/ 已列入 .gitignore，不要把它推上 GitHub。
 * 後台密碼不存明文，存的是 scrypt 雜湊。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.CONFIG_FILE || path.join(path.dirname(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'meetings.json')), 'config.json');
const DEFAULTS = { BRAND_NAME: '會議資訊卡', ACCENT_COLOR: '#0EA5E9', TIMEZONE: 'Asia/Taipei', RECALL_REGION: 'us-west-2', LLM_BASE_URL: 'https://api.openai.com', LLM_MODEL: 'gpt-4o-mini' };
const EDITABLE = ['PUBLIC_URL', 'LIFF_ID', 'BRAND_NAME', 'ORGANIZER_NAME', 'ACCENT_COLOR', 'TIMEZONE', 'BOT_NAME', 'RECALL_API_KEY', 'RECALL_REGION', 'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
const SECRET = ['RECALL_API_KEY', 'LLM_API_KEY'];
const REGIONS = ['us-west-2', 'us-east-1', 'eu-central-1', 'ap-northeast-1'];

let cache = null;
function file() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { cache = {}; }
  return cache;
}
function write() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

/** 取一個設定值：環境變數 → 設定精靈存的值 → 預設值 */
function get(key) {
  const env = process.env[key];
  if (env != null && env !== '') return env;
  const v = file()[key];
  return (v != null && v !== '') ? v : (DEFAULTS[key] || '');
}
/** 這個值是不是被環境變數鎖住（鎖住的話精靈改了也沒用，要提示使用者） */
const fromEnv = key => process.env[key] != null && process.env[key] !== '';

function validate(key, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  if (key === 'PUBLIC_URL') { if (!/^https?:\/\/[^\s/]+/i.test(v)) throw new Error('對外網址要以 http:// 或 https:// 開頭'); return v.replace(/\/+$/, ''); }
  if (key === 'LIFF_ID' && !/^\d{6,}-[A-Za-z0-9]{6,}$/.test(v)) throw new Error('LIFF ID 的格式不對，應該長得像 1234567890-AbCdEfGh（數字、一個減號、再一串英數字）');
  if (key === 'RECALL_REGION' && !REGIONS.includes(v)) throw new Error('Recall 區域只能是：' + REGIONS.join('、'));
  if (key === 'ACCENT_COLOR' && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('主色請用 #RRGGBB 格式');
  if (key === 'LLM_BASE_URL' && !/^https?:\/\//i.test(v)) throw new Error('LLM_BASE_URL 要是網址');
  if (key === 'TIMEZONE') { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); } catch (e) { throw new Error('時區名稱不對，例如 Asia/Taipei'); } }
  return v.slice(0, 500);
}

function set(patch) {
  const next = { ...file() };
  for (const k of EDITABLE) if (k in patch) { const v = validate(k, patch[k]); if (v) next[k] = v; else delete next[k]; }
  if ('ack_confidential' in patch) next.ack_confidential = patch.ack_confidential ? new Date().toISOString() : null;
  cache = next; write();
}

/* ── 後台密碼 ── */
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const hasPassword = () => fromEnv('ADMIN_TOKEN') || !!file().admin_hash;
function checkPassword(pw) {
  if (!pw) return false;
  if (fromEnv('ADMIN_TOKEN')) return safeEqual(pw, process.env.ADMIN_TOKEN);
  const stored = file().admin_hash; if (!stored) return false;
  const [salt] = stored.split(':');
  return safeEqual(hashPassword(pw, salt), stored);
}
function setPassword(pw) {
  pw = String(pw || '');
  if (pw.length < 10) throw new Error('密碼至少 10 個字');
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|qwertyuiop)/i.test(pw)) throw new Error('這個密碼太好猜了，換一個');
  cache = { ...file(), admin_hash: hashPassword(pw) }; write();
}

/** 給後台看的設定：金鑰只回「有沒有填」與最後四碼 */
function publicView() {
  const out = {};
  for (const k of EDITABLE) {
    const v = get(k);
    out[k] = SECRET.includes(k) ? { set: !!v, hint: v ? `••••${String(v).slice(-4)}` : '', locked: fromEnv(k) } : { value: v, locked: fromEnv(k) };
  }
  out.ack_confidential = !!file().ack_confidential;
  out.password_locked = fromEnv('ADMIN_TOKEN');
  return out;
}

module.exports = { get, set, fromEnv, hasPassword, checkPassword, setPassword, publicView, REGIONS, acked: () => !!file().ack_confidential, _reset: () => { cache = null; } };
