# 03・部署

三種方式，由簡到繁。不管哪一種，做完都要回頭確認兩件事：

1. `.env` 的 `PUBLIC_URL` 是最終的 https 網址，結尾沒有斜線。
2. LINE Developers 裡 LIFF 的 **Endpoint URL** 是 `https://同一個網址/share.html`。

這兩個網址只要有一個對不上，分享就會壞。

## 方式一：自己的電腦＋臨時通道（試玩用）

先啟動程式：

```bash
npm start
```

再**另開一個終端機視窗**開通道：

```bash
npx cloudflared tunnel --url http://localhost:3000
```

優點是五分鐘內看得到結果。缺點是電腦要開著，而且每次重開通道網址都會變，已經傳出去的卡片上的按鈕會全部失效。只適合拿來學習和測試。

## 方式二：雲端平台（Render、Railway、Fly.io、Zeabur 這類）

大致流程都一樣：

1. 把專案推到自己的 GitHub。
2. 在平台上新增一個 Web Service，連到這個 repo。
3. 設定：
   - Build command：`npm install`
   - Start command：`npm start`
   - 環境變數：把 `.env` 裡的每一項貼進平台的設定頁（**不要**把 `.env` 檔推上 GitHub）。
4. 部署完拿到平台給的 https 網址，填回環境變數的 `PUBLIC_URL`，再重新部署一次。

### 一定要注意：資料會不會不見

這個專案把資料存在 `data/meetings.json`。很多雲端平台的檔案系統是**暫時的**，每次重新部署或重啟，這個檔案就會消失，已經傳出去的卡片連結會全部變成「找不到這場會議」。

解法二選一：

- 在平台上掛一個**持久化磁碟（Persistent Disk／Volume）**，掛到例如 `/var/data`，再設環境變數 `DATA_FILE=/var/data/meetings.json`。
- 把資料層換成真的資料庫。`lib/store.js` 只有六個函式，可以直接請 Claude Code 換成 SQLite 或 Postgres，見 [05-claude-code.md](05-claude-code.md)。

免費方案通常還會在沒人用的時候休眠。休眠期間「會議開始前自動派機器人」的排程不會跑，要用這個功能請選不會休眠的方案。

## 方式三：自己的主機（VPS）

以 Ubuntu 為例，用 pm2 管理程式、Caddy 處理 https（Caddy 會自動申請憑證，比 nginx 加 certbot 省事）。

```bash
# 1. 裝 Node.js 20、pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2. 放程式
git clone https://github.com/arcusdigitaltw/line-meeting-card.git /opt/line-meeting-card
cd /opt/line-meeting-card
npm install --omit=dev
cp .env.example .env && nano .env        # PUBLIC_URL 填 https://meet.你的網域

# 3. 啟動並設成開機自動跑
pm2 start server.js --name line-meeting-card
pm2 save && pm2 startup
```

裝 Caddy 後，`/etc/caddy/Caddyfile` 只要這樣寫：

```
meet.你的網域 {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

記得先把 `meet.你的網域` 的 DNS A 紀錄指到這台主機。

### 更新版本

```bash
cd /opt/line-meeting-card && git pull && npm install --omit=dev && pm2 restart line-meeting-card
```

### 備份

要備份的只有兩個檔案：`.env` 和 `data/meetings.json`。

## 部署後的檢查清單

- [ ] `https://你的網址/` 打得開，顯示「服務運作中」
- [ ] `https://你的網址/admin.html` 輸入密碼進得去，右上角 LIFF 標籤是綠色
- [ ] 建一場測試會議，「複製邀請頁網址」貼到 LINE，預覽有顯示會議名稱
- [ ] 「複製 LINE 分享連結」在手機點開，選得到人、對方收得到卡片
- [ ] 卡片上「加入 Google 行事曆」「加入 Apple 行事曆」都打得開
- [ ] 請一位**不是你**的朋友點分享連結，確認他也能用（驗證 channel 已 Published）
- [ ] 重新部署或重啟一次，確認剛剛那場會議還在（驗證資料有保存）
