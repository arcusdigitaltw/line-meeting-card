# CLAUDE.md — line-meeting-card

會議資訊卡 × LINE LIFF 分享 × 會議機器人。一支 Node.js（Express）服務，資料存 JSON 檔，沒有建置步驟、沒有前端框架。

使用者多半不是工程師。回覆請用繁體中文（台灣用語），講結果和下一步，不要丟一堆術語。

## 架構

| 檔案 | 職責 |
|---|---|
| `server.js` | 路由、後台權限（`x-admin-token`）、每分鐘的機器人排程 `tick()` |
| `lib/card.js` | 純函式：Flex Message、`.ics`、Google 行事曆網址、時間顯示。**不讀環境變數、不連網路、不碰資料層** |
| `lib/store.js` | 資料層，六個函式：`list`、`get`、`getByToken`、`create`、`update`、`remove` |
| `lib/recall.js` | Recall.ai：派機器人、查狀態、下載逐字稿 |
| `lib/summary.js` | OpenAI 相容 API 產生摘要 |
| `public/share.html` | LIFF 分享頁（LIFF 的 Endpoint URL） |
| `public/invite.html`、`summary.html` | 公開頁，由 `server.js` 換掉 `__OG_TITLE__` 等佔位字後送出 |
| `public/admin.html` | 後台，純 HTML＋原生 JS |

資料流：後台建會議 → `store` 產生 `invite_token`、`summary_token` → 分享連結 `https://liff.line.me/<LIFF_ID>?invite=<token>` → `share.html` 向 `/api/card/invite/:token` 要 Flex → `liff.shareTargetPicker()`。

## 改完一定要做

```bash
npm test          # 單元測試
npm run smoke     # 整體自我檢查（不用連 LINE）
```

改了卡片版型再加跑 `npm run flex`，把 JSON 給使用者貼到 LINE 的 Flex Message Simulator 預覽。
沒有跑過這兩個指令，不要說「完成了」。測試失敗就照實說，附上輸出。

## 規則

1. **Flex 裡不能有空字串的 `text`。** 欄位沒填就整列不放，或給預設字。`shareTargetPicker` 遇到空字串會安靜失敗，沒有任何錯誤訊息。新增欄位時，同步在 `test/card.test.js` 加一個「沒填這個欄位」的案例。
2. **Flex 的圖片只能是 https 的 JPG／PNG。** 一律經過 `flexImage()`。
3. **Flex 按鈕網址不能超過 1000 字。** 長網址（特別是帶中文的）改成自己的短路由再 302 轉址，參考 `/api/card/invite/:token/google`。
4. **金鑰只放 `.env`。** 不寫進程式碼、不印在 log、不放進回覆。新增環境變數要同步更新 `.env.example` 和 README。
5. **邀請卡那條路徑（`invite_token`）不能回傳逐字稿或摘要。** 摘要只走 `summary_token`。這是刻意分開的：邀請卡會被一路轉傳。
6. **公開頁面插入使用者輸入一律用 `textContent`**，伺服器端用 `esc()`。不要用 `innerHTML` 拼字串。
7. **管理用的 API 一律掛 `admin` 這個 middleware。** 新增路由先想清楚它是公開的還是管理用的。
8. **不要加套件，除非使用者同意。** 目前只有 `express`、`dotenv`。這個專案的賣點之一是好部署。
9. **`lib/store.js` 的六個函式介面不要改。** 要換資料庫就換裡面的實作。
10. **機器人進會議的自我介紹訊息可以改寫，不能拿掉。**
11. UI 文字用台灣用語；圖示用線條 SVG，不要拿表情符號當圖示。

## 踩過的雷

- **`liff.state`**：從 `liff.line.me` 連結進來，參數在 `liff.init()` 完成前被包在 `liff.state` 裡。讀參數用 `share.html` 的 `param()`，兩個地方都找。
- **Endpoint URL 要完全一致**：網域、`www`、`https`、路徑有一個不同，`liff.init()` 就失敗。
- **channel 在 Developing 狀態只有管理員能用**：使用者說「朋友打不開」先問這個。
- **LINE 內建瀏覽器開不了 `.ics`**：網址加 `openExternalBrowser=1`（`card.js` 的 `ext()`）。
- **Flex 的 `flex: 0` 會讓整列在預覽器塌掉**：用正整數。
- **`.ics` 每行上限 75 位元組**：中文一個字 3 位元組，摺行時不能切在字中間（`icsFold()`）。
- **Recall 的 API 分區**：`RECALL_REGION` 填錯會回 401，看起來像金鑰錯。
- **Zoom 連結的 `?pwd=` 常被通訊軟體截斷**：機器人回「密碼不對」時先請使用者重新複製邀請連結。
- **逐字稿斷詞**：Recall 回的是一個一個的 word，中日韓文要直接接起來，英文才加空白（`joinWords()`）。
- **雲端平台的檔案系統多半是暫時的**：`data/meetings.json` 會在重新部署後消失，要掛持久化磁碟並設 `DATA_FILE`。
- **Windows 上 `node --test test/` 會失敗**：用不帶路徑的 `node --test`。
- **教學裡的指令一行一個、不要在同一行後面加 `#` 註解**：很多使用者用 Windows 命令提示字元，`cp` 和 `#` 都會出錯。要給 Windows（`copy`、`notepad`）和 Mac／Linux 兩種寫法。

（發現新的雷請加在這裡：現象、原因、正確做法，各一句話。）
