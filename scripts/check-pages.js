// 檢查 public/ 裡每一頁的 <script> 語法。伺服器端的測試抓不到前端打錯字，這一支補上。
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'public'); let bad = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    try { new Function(`return async function(){${m[1]}\n}`); } catch (e) { console.log('FAIL', f, e.message); bad++; }
  }
}
console.log(bad ? `${bad} 個頁面的程式有語法錯誤` : 'PASS 前端頁面語法');
process.exitCode = bad ? 1 : 0;
