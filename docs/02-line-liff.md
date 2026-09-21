# 02・LINE Developers 與 LIFF 完整教學

這一份是整個專案的重點。看完你會知道 LIFF 是什麼、怎麼建、程式怎麼寫，以及為什麼別人的分享按鈕會動、你的不會。

> LINE Developers 後台的介面偶爾會改版，按鈕位置可能跟這裡寫的有點不同，但名稱大致不變。

## LIFF 是什麼，為什麼非用它不可

LIFF（LINE Front-end Framework）是「在 LINE 裡面打開的網頁」。它跟一般網頁最大的差別，是可以呼叫 LINE 的功能。

這個專案只用到其中一個：**`liff.shareTargetPicker()`**。它會跳出 LINE 原生的「選擇傳送對象」畫面，讓使用者把一則訊息傳給自己的好友或群組。

為什麼不用別的方法：

| 方法 | 能不能傳卡片（Flex） | 問題 |
|---|---|---|
| `https://line.me/R/share?text=…` | 不行，只能傳純文字 | 沒有按鈕、沒有排版 |
| 官方帳號的 Messaging API 推播 | 可以 | 只能推給「加了你官方帳號」的人，而且要算訊息費 |
| **LIFF 的 shareTargetPicker** | **可以** | **由使用者本人傳出去，不用官方帳號、不算訊息費、對方不用加好友** |

重點在最後一格：卡片是「使用者自己傳的」，所以它可以一手傳一手，這就是它會擴散的原因。

## 建立 LIFF

### 1. 建立 Provider

1. 到 <https://developers.line.biz/console/>，用你的 LINE 帳號登入。
2. 按 **Create a new provider**，名稱填公司或個人名字。Provider 只是一個資料夾，之後還能在裡面放別的專案。

### 2. 建立 LINE Login channel

LIFF 必須掛在 **LINE Login** 這種 channel 底下。不是 Messaging API，這裡最多人選錯。

1. 在 Provider 裡按 **Create a new channel** → 選 **LINE Login**。
2. 填寫：
   - **Channel name**：使用者在授權畫面會看到這個名字，填品牌名。
   - **Channel description**：隨意。
   - **App types**：勾 **Web app**。
   - 其他必填欄位照實填，勾同意條款後建立。

### 3. 新增 LIFF app

1. 進到剛建好的 channel → 上方 **LIFF** 分頁 → **Add**。
2. 填寫：

   | 欄位 | 填什麼 | 說明 |
   |---|---|---|
   | LIFF app name | 會議資訊卡 | 使用者看得到 |
   | Size | **Tall** | 佔螢幕約八成，分享流程剛好。Full 也可以 |
   | Endpoint URL | `https://你的網址/share.html` | **一定要 https，一定要指到 share.html** |
   | Scopes | 勾 `profile`、`openid` | `chat_message.write` 這個專案用不到，不用勾 |
   | Add friend option | Off | 有官方帳號想順便請人加好友再開 |
   | Scan QR | 不用開 | |
   | Module mode | 不用開 | |

3. 按 **Add**。建好之後列表上會出現 **LIFF ID**，長得像 `1234567890-AbCdEfGh`，貼回設定精靈「綁定 LINE」那一步。

### 4. 打開 Share target picker

這一步最容易漏。

在 LIFF app 的設定頁找到 **Share target picker**，把開關打開。沒開的話，程式裡 `liff.isApiAvailable('shareTargetPicker')` 會回 `false`，分享頁會顯示「這個 LIFF 還不能分享」。

### 5. 把 channel 改成 Published

channel 剛建好是 **Developing** 狀態，這時候**只有你自己（和你加進去的測試人員）打得開**。朋友點你的分享連結會看到錯誤。

在 channel 頁面最上方的狀態標籤按一下，改成 **Published**。

> 建議順序：先在 Developing 狀態自己測到會動，再改 Published。

## 分享連結長什麼樣

```
https://liff.line.me/<LIFF_ID>?invite=<會議的邀請代碼>
https://liff.line.me/<LIFF_ID>?summary=<會議的摘要代碼>
```

在 LINE 裡點這種連結，LINE 會用你的 LIFF 設定打開 Endpoint URL（`share.html`），並把 `?invite=…` 帶過去。後台的「複製 LINE 分享連結」產生的就是這個。

## 程式怎麼寫：share.html 逐段看

完整程式在 [`public/share.html`](../public/share.html)，這裡只講骨架。

```html
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
```

LIFF SDK 一定用官方這個網址。

```js
// 1. 從網址讀出要分享哪一張卡
var token = param('invite');

// 2. 跟自己的後端要卡片內容和 LIFF ID
var card = await fetch('/api/card/invite/' + token).then(r => r.json());

// 3. 初始化
await liff.init({ liffId: card.liff_id });

// 4. 不在 LINE 裡 → 引導改用 LINE 開
if (!liff.isInClient()) { /* 顯示「在 LINE 開啟」按鈕 */ return; }
if (!liff.isLoggedIn()) { liff.login(); return; }

// 5. 跳出選人畫面，傳完關掉
var result = await liff.shareTargetPicker([
  { type: 'flex', altText: card.alt_text, contents: card.flex }
]);
if (result) liff.closeWindow();
```

幾個設計上的決定：

- **LIFF ID 由後端給，不寫死在 HTML。** 換 LIFF 只要在設定精靈改一個欄位，不用動前端。
- **`altText` 一定要有。** 它會出現在聊天列表的預覽和推播通知裡，寫成「會議邀請：九月產品會議｜2026/9/25（五）19:00」這種一眼看得懂的句子。
- **`result` 是空的代表使用者按了取消**，不是錯誤，給他一顆「再試一次」就好。
- **把錯誤印在畫面上。** 手機上沒有開發者工具，`share.html` 下方那塊灰色小字就是你的除錯畫面。LINE 回的錯誤代碼（例如 `INVALID_ARGUMENT`）幾乎都能直接指出問題。

## 五個最常卡住的地方

### 一、參數被包進 `liff.state`，讀不到

從 `https://liff.line.me/<LIFF_ID>?invite=abc` 進來時，LINE 會先把你的參數包成 `?liff.state=%3Finvite%3Dabc` 再轉到 Endpoint URL。`liff.init()` 完成後才會還原成 `?invite=abc`。

如果你在 `liff.init()` **之前**就讀 `location.search`，會讀不到 `invite`。解法是兩個地方都找：

```js
function param(name) {
  var q = new URLSearchParams(location.search);
  if (q.get(name)) return q.get(name);
  var st = q.get('liff.state');
  if (!st) return null;
  return new URLSearchParams(st.replace(/^[^?]*\?/, '')).get(name);
}
```

### 二、Endpoint URL 和實際打開的網址對不上

LIFF 會檢查「現在這一頁」是不是在 Endpoint URL 底下。Endpoint URL 填 `https://a.com/share.html`，實際卻從 `https://www.a.com/share.html` 或 `http://` 開，`liff.init()` 就會失敗。

網域、`www`、`https`、路徑，四個都要一致。用臨時通道的人，通道網址一變就要回 LINE 後台改。

### 三、選了人、按了傳送，什麼都沒發生

九成是 Flex 內容有問題，而 `shareTargetPicker` 對這種錯誤**不會跳任何訊息**。看下一節。

### 四、只有自己能用

channel 還是 Developing。改成 Published。

### 五、在電腦瀏覽器測不出來

選人傳送要在手機的 LINE 裡做。電腦上只會看到「請用 LINE 開啟」，這是預期行為。要測就把分享連結傳到自己的 Keep 筆記，用手機點。

## Flex 卡片的雷

卡片內容由 [`lib/card.js`](../lib/card.js) 的 `buildInviteFlex()` 產生。改版型之前先知道這幾件事：

| 雷 | 後果 | 這個專案怎麼防 |
|---|---|---|
| 任何一個 `text` 是空字串 `""` | 整則訊息被拒收，而且沒有錯誤訊息 | `findEmptyText()` 加單元測試；沒填的欄位直接不放那一列，或給預設字（「時間待定」） |
| 圖片是 WebP，或不是 https | 整則訊息送不出去 | `flexImage()` 只放行 https 的 JPG／PNG，後台存檔時也會擋 |
| 按鈕網址超過 1000 字 | 訊息被拒收 | Google 行事曆網址帶中文很容易爆，所以卡片放的是自己的短網址 `/api/card/invite/:token/google`，再 302 轉過去 |
| 在 LINE 內建瀏覽器開 `.ics` | 沒反應或下載失敗 | 網址後面加 `openExternalBrowser=1`，LINE 會改用手機預設瀏覽器開 |
| `flex: 0` | 在某些預覽器裡整列塌掉 | 一律用正整數的 `flex`（這裡用 2 比 7） |

### 改版型的安全流程

1. 改 `lib/card.js`。
2. `npm test`，確認沒有空字串、按鈕網址沒超長。
3. `npm run flex`，把印出來的 JSON 貼到 [Flex Message Simulator](https://developers.line.biz/flex-simulator/) 看長相。
4. 手機實測分享。

模擬器看起來正常不代表 `shareTargetPicker` 一定會過（空字串在模擬器裡不一定報錯），所以第 2 步不能省。

## 想再往下做

- **分享完請對方加好友**：LIFF 的 Add friend option 開 On，並把官方帳號連到這個 LINE Login channel。
- **知道是誰分享的**：`liff.getProfile()` 拿得到使用者名稱與頭像（需要 `profile` scope）。要送回後端請用 `liff.getIDToken()` 讓後端驗證，不要直接信任前端送來的 userId。
- **一次傳多則**：`shareTargetPicker` 的陣列最多可以放 5 則訊息，例如一張卡片加一句文字。
