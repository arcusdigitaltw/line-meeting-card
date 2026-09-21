# 01・三十分鐘傳出第一張卡

照順序做。每一步後面都寫了「怎樣算成功」，沒成功先不要往下。

## 你需要準備

- 一台裝了 Node.js 18 以上的電腦（終端機打 `node -v` 看得到版本就行）
- 一個 LINE 帳號（你平常用的那個就可以）
- 手機上的 LINE

## 步驟一：把專案跑起來

指令請一行一行貼。

```bash
npm install
```

建立設定檔。Windows 用：

```bash
copy .env.example .env
```

Mac／Linux 用：

```bash
cp .env.example .env
```

然後跑自我檢查：

```bash
npm run smoke
```

**成功的樣子**：最後一行是「全部通過」。這一步不需要連 LINE，只是確認程式本身沒問題。

## 步驟二：讓外面連得到你的電腦

LINE 只接受 `https` 網址，`http://localhost` 不行。最快的方法是開一條臨時通道：

下面兩個工具選一個就好。

```bash
npx cloudflared tunnel --url http://localhost:3000
```

或是：

```bash
ngrok http 3000
```

它會給你一個 `https://xxxx.trycloudflare.com`（或 `https://xxxx.ngrok-free.app`）的網址。用記事本打開 `.env`（Windows 打 `notepad .env`，Mac／Linux 打 `nano .env`），把它填進去：

```
PUBLIC_URL=https://xxxx.trycloudflare.com
```

> 臨時通道每次重開網址都會變。變了之後 `.env` 的 `PUBLIC_URL` 和 LINE 後台的 Endpoint URL 都要跟著改。正式使用請看 [03-deploy.md](03-deploy.md)。

## 步驟三：建立 LIFF，拿到 LIFF ID

照 [02-line-liff.md](02-line-liff.md) 的「建立 LIFF」做完，把 LIFF ID 填進 `.env`：

```
LIFF_ID=1234567890-AbCdEfGh
```

## 步驟四：設後台密碼，啟動

產生一組亂碼當密碼：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

填進 `.env` 的 `ADMIN_TOKEN`，然後：

```bash
npm start
```

**成功的樣子**：終端機顯示「已啟動」，而且**沒有**出現「還沒填 LIFF_ID」「PUBLIC_URL 不是 https」這類提醒。

## 步驟五：建一場會議，傳出去

1. 瀏覽器開 `https://你的網址/admin.html`，輸入 `ADMIN_TOKEN`。右上角「LIFF」標籤是綠色的才對。
2. 左邊填會議名稱、時間、會議連結，按「建立會議」。
3. 在右邊那場會議按「複製 LINE 分享連結」。
4. 把連結貼到 LINE 的任何聊天室（傳給自己的「Keep 筆記」最方便），**在手機上點開**。
5. 畫面跳出「選擇傳送對象」→ 選一個好友或群組 → 傳送。

**成功的樣子**：對方的聊天室出現一張卡片，有會議名稱、時間，下面有「前往會議」「加入 Google 行事曆」「加入 Apple 行事曆」「查看完整資訊」。

## 沒成功？

| 你看到的 | 多半是 |
|---|---|
| 點開連結是白畫面，或顯示 400 | LINE 後台的 Endpoint URL 沒填對，要是 `https://你的網址/share.html` |
| 「站長還沒設定 LIFF ID」 | `.env` 的 `LIFF_ID` 沒填，或填完沒重啟 |
| 「這個 LIFF 還不能分享」 | LIFF 設定裡的 Share target picker 沒打開 |
| 只有你自己能用，朋友點開說沒有權限 | LINE Login channel 還在 Developing，要改成 Published |
| 選了人、按了傳送，但什麼都沒發生 | 卡片裡有空字串，跑 `npm test` 看哪裡壞了 |
| 電腦瀏覽器打開只看到「請用 LINE 開啟」 | 正常。選人傳送這一步要在手機的 LINE 裡做 |

更完整的排錯在 [02-line-liff.md](02-line-liff.md#五個最常卡住的地方)。
