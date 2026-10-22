# 口袋旅伴

適合手機使用的旅行手冊：每日行程、地點、住宿、航班、購物清單、可搜尋的資料簿，以及旅伴共用的筆記、開支和清單。所有旅程內容都存放在 Firebase，只限旅伴登入查看；這個公開儲存庫和網站只有程式，沒有旅程資料。

## 檔案

網站在 `dist/`，由 GitHub Actions 發佈到 GitHub Pages。

- `src/app/*.js` → `dist/app.js`：旅程頁面（總覽、行程、探索、附近、住宿、機票、資料簿）。
- `src/together/*.js` → `dist/together.js`：登入、選擇旅程、Firestore 同步，以及共用、購物、我的旅程頁面。
- 兩組檔案按功能分開（檔名前的數字是合併次序），由 `node scripts/build.mjs` 合併成 `dist/` 的同名檔案；同一組檔案共用變數，毋須模組或打包工具。**修改 `src/` 後要執行 build**，`scripts/validate.mjs` 會檢查 `dist/` 是否最新。
- `dist/style.css`：版面；`dist/design.css`：統一設計規範（參考 shadcn/ui 的顏色變數、按鈕種類、輸入框、卡片及視窗），改顏色或圓角只需改檔案頂部的變數。
- `dist/ui.js`：確認、輸入及提示視窗（SweetAlert2，網頁載入後才在閒置時下載，載入失敗時改用瀏覽器內置視窗）。
- `dist/split.js`：分帳計算（各貨幣分開，或按匯率合併成自己的貨幣）。
- `dist/weather.js`：每日天氣（Open-Meteo，免費、毋須 API key，只傳送約 1 公里精度的座標；手機快取 3 小時）。
- `dist/map-picker.js`：附近頁的地圖選點及行程頁「🗺 當天路線」。`dist/nearby.js`：距離計算。
- `dist/vendor/`：Firebase、heic2any、Leaflet、SweetAlert2 的瀏覽器版本。
- `functions/`：Cloud Functions（見下）。`firestore.rules`、`storage.rules`：權限規則。
- `scripts/accounts.mjs`：管理旅伴帳號；`scripts/validate.mjs`：發佈前檢查；`tests/`：自動測試。

在電腦預覽：`python3 -m http.server 8000 --directory dist`，再開啟 http://localhost:8000 。

## 旅程資料

每個旅程放在 Firestore `trips/{tripId}`：名稱、目的地、日期、當地及自己的貨幣、國家、地圖中心、小區（`areas`），以及旅伴電郵（`members`，小寫）。旅程文件只由 Cloud Function `manageTrip` 修改。旅程內的資料：

| 集合 | 內容 |
|---|---|
| `places` | 探索地點（12 個欄位、分類、座標、分店 `points`） |
| `planDays/{日}` | 該日的站點清單及標題 |
| `hotels`、`flights` | 住宿及航班（可附 `docs` 文件） |
| `shopping` | 購物清單（相片、購買地點、已買） |
| `notes`、`expenses`、`checklist` | 筆記、開支、行前及行李清單 |
| `members/{uid}` | 旅伴名稱及收藏（`saved`） |
| `settings/fx` | 旅伴設定的匯率 |
| `receiptJobs` | 背景分析中的收據及物品相片 |

右上角「旅程」打開「我的旅程」：切換、建立、修改或複製旅程，邀請或移除旅伴。

## 主要功能

- **行程**：每天的站點可新增（與探索的新增地點同一表格，加上時間，地點同時存入探索）、修改、刪除、調動，同一時間可放多個選擇並排顯示。「⌕ 從探索加入地點」可搜尋探索地點、住宿及購物清單的購買地點。站點之間的交通點可查詢 Google 路線建議（`suggestRoutes`）或 AI 建議（`aiRoutes`，日本的公共交通 Google 不經 API 提供）。另有每日天氣、當天路線地圖及列印／另存 PDF。
- **探索**：貼 Google 地圖連結自動填寫（`lookupPlace`，日本用日文、韓國用韓文店名及地址），地點可有多個分店。「🛍 購物清單」篩選顯示要買東西的地點及未加入探索的購買地點。
- **附近**：以定位或地圖選點，找出 100／200／500 米內的地點及可買清單物品的地方。
- **購物**：共用購物清單，可影相由 AI 認物品並自動加入。
- **共用**：筆記（可加最多 3 張相片及連結，文字中的網址會變成連結）及優惠券（優惠碼一按複製、有效期倒數、優惠券相片、標記已使用；相片存放在筆記本身，離線亦可在收銀處出示）；開支（收據 AI 在背景讀取、換算成自己的貨幣、統計及分帳）；行前及行李清單（每人各自剔選）。
- **住宿、機票**：可上載訂單確認或電子機票（Storage `trips/{t}/docs/`，只限該旅程旅伴讀取）。
- **資料簿**：搜尋旅程的所有資料（地點、站點、住宿、航班、購物、筆記）。
- 曾經登入的手機離線時也可以查看，離線時的修改會在有網絡時同步；登出會刪除手機上已下載的資料。

## Cloud Functions

| 名稱 | 用途 | 服務 |
|---|---|---|
| `processReceipt` | 背景讀取收據及物品相片（Firestore `receiptJobs` 觸發） | DeepSeek `deepseek-flash` |
| `lookupPlace` | Google 地圖自動填寫 | Places API |
| `suggestRoutes` | 站點之間的路線建議 | Routes API |
| `aiRoutes` | AI 路線建議 | DeepSeek |
| `manageTrip` | 建立及修改旅程、管理旅伴 | — |

API key 存放在 Secret Manager（`deepseek-api-key`、`places-api-key`）。

費用保護：網頁呼叫的 function 要求 Firebase App Check（reCAPTCHA Enterprise，網站金鑰在 `src/together/00-core.js` 的 `APP_CHECK_KEY`）；每位旅伴每日最多 80 次 AI 分析及 300 次地圖查詢（`usage/{uid}_{日期}`，網頁不可讀寫）；Google Cloud 預算「口袋旅伴 每月預算」HK$80，用量達 50%、90%、100% 時電郵通知帳單帳戶管理員。

權限規則及 Cloud Functions 由 GitHub Actions（`.github/workflows/backend.yml`）部署：`firestore.rules`、`storage.rules`、`functions/` 等有改動並 push 到 `main` 時，先在 Firebase 模擬器執行 `tests/rules/` 的權限測試（需要 Java），通過後用 `scripts/deploy-rules.mjs` 發佈規則，`functions/` 有改動時再部署所有 function。GitHub 以 Workload Identity Federation 登入（`github-deploy` 服務帳戶，只限這個 repo 的 `main`，毋須在 GitHub 存放金鑰）；部署工作由 repo 變數 `BACKEND_DEPLOY=on` 開啟。

在自己電腦部署（需要 Blaze 方案；`--source` 用絕對路徑）：

```sh
cd functions && npm install
F=$PWD; COMMON="--gen2 --region=asia-northeast1 --runtime=nodejs22 --source=$F --memory=256Mi --max-instances=3"
gcloud functions deploy processReceipt $COMMON --entry-point=processReceipt --trigger-location=asia-northeast1 --trigger-event-filters=type=google.cloud.firestore.document.v1.written --trigger-event-filters=database='(default)' --trigger-event-filters-path-pattern=document='trips/{trip}/receiptJobs/{id}' --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest --timeout=180s
gcloud functions deploy aiRoutes $COMMON --entry-point=aiRoutes --trigger-http --allow-unauthenticated --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest --timeout=120s
for f in lookupPlace suggestRoutes manageTrip; do gcloud functions deploy $f $COMMON --entry-point=$f --trigger-http --allow-unauthenticated --set-secrets=PLACES_API_KEY=places-api-key:latest --timeout=40s; done
```

## 帳號

網站可用帳號 ID + 密碼（對應 `{id}@kyushu-trip.invalid`）或 Google 帳戶登入。可在「我的旅程」邀請旅伴，或用指令（先 `gcloud auth login`；旅程由環境變數 `TRIP` 指定）：

```sh
node scripts/accounts.mjs add amy 阿美              # 建立帳號 ID，會顯示一次隨機密碼
node scripts/accounts.mjs reset amy                 # 重設密碼
node scripts/accounts.mjs google someone@gmail.com  # 容許 Google 帳戶登入
node scripts/accounts.mjs list
node scripts/accounts.mjs remove amy
```

網站允許名單存放在 Firestore `config/members`。Firebase 網頁設定（apiKey 等）本身是公開資料，真正的權限由 `firestore.rules`、`storage.rules` 和旅伴名單控制；旅伴名單只放在 Firestore，不要寫進這個儲存庫。

## 測試及發佈

```sh
node scripts/build.mjs        # 修改 src/ 後
node scripts/validate.mjs     # 檔案清單、私隱、語法、build、分帳及距離計算
cd tests && npm ci && npx playwright install chromium && npm test
```

- `tests/rules/`：Firestore 及 Storage 權限規則測試（`cd tests/rules && npm ci && npm test`，需要 Java 21）。
- `tests/smoke.mjs`：用虛構旅程及假 Firebase（`tests/fake/`）在 Chromium 測試登入、各頁、行程、交通、開支、清單、住宿、購物及資料簿。
- `tests/layout.mjs`：用資料很多、名稱很長的虛構旅程，在 320／390／768／1280px 寬度檢查所有頁面及主要視窗有沒有溢出、截斷或按鈕高度不一（`SHOTS=資料夾` 可儲存截圖）。

GitHub Actions 每次 push 先執行以上檢查，通過才發佈網站。`dist/` 只可包含網站程式；旅程資料不要加入乘客姓名、座位、訂單編號、付款明細或任何登入憑證。
