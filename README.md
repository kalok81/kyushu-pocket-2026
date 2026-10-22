# 九州口袋旅伴 · 2026 福岡

適合手機查看的旅行手冊，包括行程、酒店、航班與行李、地點、可搜尋的完整資料簿，以及旅伴共用的筆記、開支和行程。所有旅程內容都存放在 Firebase，只限旅伴名單內的 Google 帳戶登入查看；這個公開儲存庫和網站只有程式，沒有旅程資料。

## 更新網站

- `dist/app.js`：畫面互動；登入並取得 Firestore 資料後才會啟動。
- `dist/style.css`：手機及電腦版面、顏色及字體。
- `dist/design.css`：統一設計規範（參考 shadcn/ui：顏色變數、按鈕種類、輸入框、卡片、視窗、焦點框），在 style.css 之後載入；改顏色或圓角只需改這個檔案頂部的變數。
- `dist/index.html`：網站標題與入口。

可在 GitHub 開啟檔案，按 Edit 修改，再 Commit 到 `main`。GitHub Actions 成功執行後，GitHub Pages 網頁會自動更新。

## 更新旅程資料

旅程資料（Sheet 快照、地點座標、建議行程、酒店資料、探索頁小區 `content.areas`）放在 Firestore 的 `trips/{tripId}/trip/data`、`…/geo`、`…/content`。資料檔放在 `private/`（已在 `.gitignore`），不要 commit。

```sh
gcloud auth login                                     # 用 Firebase 專案擁有者的 Google 帳戶
node scripts/trip-data.mjs download private/trip.json  # 取得目前資料
# 修改 private/trip.json
node scripts/trip-data.mjs upload private/trip.json    # 檢查並上載
```

探索頁的小區按座標分配到同一區域內最近的小區中心（6 公里內），沒有座標的地點用地址關鍵字（`kw`）判斷；新增地點會自動分區。

上載前會檢查航班資料只含公開欄位。旅伴重新整理網頁後就會看到新資料。Google Sheet 與 Firestore 不會自動同步。

## 旅程

網站支援多個旅程：每個旅程的資料都放在 Firestore `trips/{tripId}/…`（例如 `trips/fukuoka-2026`），`trips/{tripId}.members` 是該旅程旅伴的電郵（小寫）。登入後會開啟上次使用的旅程，有多個旅程時可在「共用」頁頂切換。

右上角「旅程」打開「我的旅程」頁：切換旅程、建立新旅程（名稱、目的地、日期、當地及自己的貨幣）、修改目前旅程，以及邀請或移除旅伴（建立帳號 ID 會顯示一次密碼，或加入 Google 帳戶）。旅程文件只由 Cloud Function `manageTrip` 修改，旅伴名單與網站允許名單（`config/members`）保持一致。

每個旅程有當地貨幣及自己的貨幣（支援 16 種）：開支、購物及收據只提供這兩種貨幣；AI 收據及物品辨識按旅程的目的地和貨幣處理；Google 地圖自動填寫在日本旅程用日文店名及地址，其他地方用中文，並按地址填入區域。地點可有多個分店／地址（`points`），附近頁用最近的分店計算。

2026 福岡 已由 Sheet 快照轉換為可修改的格式（行程、地點、住宿、航班、每天標題）；轉換前的備份保留在本機 `private/`。

在網站建立的旅程（`generic: true`）不需要 Sheet：每天按日期產生，可在行程頁按「✎ 這天標題」命名；住宿（`hotels`，可貼 Google 地圖連結自動填寫）及航班（`flights`）在各自的頁面輸入；附近頁的地圖以目的地為中心。

## 旅伴共用（Firebase）

「行程」頁可直接新增站點；每個站點按「⋯」可修改、刪除、調動或加入同一時間的選擇（修改即時儲存）；探索頁的地點可按「＋ 加入行程」插入指定日子（按時間排位），編輯模式的「⌕ 從探索加入地點」亦可在行程頁直接搜尋及連續加入；站點的「＋ 加入」可在同一時間加入其他選擇（連續同一時間的站點會左右並排顯示）。修改過的日子整天行程存放在 Firestore `planDays/{1-7}`，可按「↺ 還原原本行程」。

「☆ 我的收藏」按旅伴同步（`members/{uid}.saved`）；第一次登入時，原本 Sheet 的黃色記錄會成為收藏。

「探索」頁可以新增、修改及刪除地點；貼上 Google 地圖連結按「自動填寫」，會由 Cloud Function `lookupPlace` 經 Places API 填入名稱、地址、座標、類型及營業時間（Places API key 存放在 Secret Manager 的 `places-api-key`）。旅伴的修改存放在 Firestore 的 `places`，疊加在原本 Sheet 資料之上；修改過的地點可按「還原原本資料」。

「購物」頁可搜尋，並可切換「☰ 列表」／「▦ 相片」格子顯示；可以「📷 影相」或「🖼 上載相片」（可多張）由 AI 認物品；表格內加相片也會由 AI 填入空白欄位；「購買地點」可貼 Google 地圖連結。探索頁的手信店歸入「商店」並標示「手信店」；附近頁的「🛍 購物」按未買物品的「購買地點」定位：寫有探索店名的用該店位置，其他經 Places API 轉成座標（存於物品的 `lat`／`lng`／`geoFor`）。

「購物」頁可按「✨ 上載物品相片，AI 自動填寫」（可多張）：相片經同一個背景流程（`receiptJobs`，`kind: 'product'`）由 AI 認出物品名稱、規格、價錢牌價錢及店名，直接加入清單並標示「AI 填寫」。

「購物」頁是共用購物清單：每件物品可加相片、數量、給誰、購買地點及價錢，買了按「已買」。相片在手機縮細後存放在 Firestore，只限旅伴查看。

網站要登入才可查看：可用帳號 ID + 密碼，或旅伴名單內的 Google 帳戶。「共用」頁可以加筆記及記開支（自動計算誰要畀誰）。開支會換算成旅程的「你們的貨幣」：預設用 open.er-api.com 的每日匯率（只傳送貨幣代號，手機會快取供離線使用），旅伴亦可在「匯率」設定實際兌換的匯率（`trips/{t}/settings/fx`，全組共用）。「開支統計」按人、按類別及按日子顯示合計；開支分類（餐飲、交通、購物、住宿、景點娛樂、其他）由收據 AI 判斷，亦可按卡片上的分類更改。曾經登入的手機離線時也可以查看，離線時加入的資料會在有網絡時自動同步；登出會刪除手機上已下載的資料。

- `dist/together.js`：登入、同步及共用頁面。
- `dist/weather.js`：行程每日天氣（Open-Meteo，免費、毋須 API key，只傳送約 1 公里精度的座標；按當天中間的站點，否則用酒店或旅程中心；手機快取 3 小時，離線時用上次結果；可顯示過去 7 天及未來 16 天）。
- `dist/split.js`：分帳計算（各貨幣分開，或按匯率合併成自己的貨幣）。
- `dist/vendor/firebase/`：Firebase 瀏覽器版本。
- `scripts/trip-data.mjs`：上載或下載旅程資料。
- `scripts/accounts.mjs`：管理旅伴帳號及名單。
- `dist/ui.js`：確認、輸入及提示視窗（SweetAlert2，`dist/vendor/sweetalert2/`）。
- `functions/`：`processReceipt` 在背景讀取收據（DeepSeek `deepseek-flash`）：網頁把縮細的相片存入 Firestore `receiptJobs`，就算關閉網頁或離線，下次打開時會繼續上載；旅伴在開支頁確認後才加入。收據相片另存一份 2400px 版本於 Firebase Storage（`receipts/{uid}/`，`storage.rules` 只限旅伴讀取），加入後在開支按「🧾 收據」查看；捨棄或刪除開支時一併刪除。上載時以相片檔案指紋（SHA-256）檢查是否重覆上載。同一張收據分開影的相片，AI 會標示為上／下半部，頁面按上載次序配對並提示「合併並重新分析」；也可以在待確認收據剔選「選擇」後按「合併所選」。`lookupPlace` 負責 Google 地圖自動填寫。API key 存放在 Secret Manager（`deepseek-api-key`、`places-api-key`）。

費用保護：`lookupPlace`、`manageTrip` 要求 Firebase App Check（reCAPTCHA Enterprise，網站金鑰在 `together.js` 的 `APP_CHECK_KEY`，只限 kalok81.github.io 及 localhost）；每位旅伴每日最多 80 次 AI 分析、300 次 Google 地圖查詢（`usage/{uid}_{日期}`，網頁不可讀寫）；Google Cloud 預算「口袋旅伴 每月預算」HK$80，用量達 50%、90%、100% 時電郵通知。自動測試在 headless 瀏覽器用 App Check debug token（不在 repo 內）。

部署 Cloud Functions（需要 Blaze 方案）：

```sh
gcloud secrets versions add deepseek-api-key --data-file=-   # 貼上 DeepSeek API key，按 Enter 再按 Ctrl-D
cd functions && npm install
gcloud functions deploy processReceipt --gen2 --region=asia-northeast1 --runtime=nodejs22 --source=. --entry-point=processReceipt --trigger-location=asia-northeast1 --trigger-event-filters=type=google.cloud.firestore.document.v1.written --trigger-event-filters=database='(default)' --trigger-event-filters-path-pattern=document='trips/{trip}/receiptJobs/{id}' --set-secrets=DEEPSEEK_API_KEY=deepseek-api-key:latest --max-instances=3 --timeout=180s
gcloud functions deploy manageTrip --gen2 --region=asia-northeast1 --runtime=nodejs22 --source=. --entry-point=manageTrip --trigger-http --allow-unauthenticated --set-secrets=PLACES_API_KEY=places-api-key:latest --max-instances=3
gcloud functions deploy lookupPlace --gen2 --region=asia-northeast1 --runtime=nodejs22 --source=. --entry-point=lookupPlace --trigger-http --allow-unauthenticated --set-secrets=PLACES_API_KEY=places-api-key:latest --max-instances=3
```
- `firestore.rules`：資料庫權限規則。

第一次設定（Firebase console）：

1. Firestore Database → 建立資料庫（建議選 asia-northeast1 東京），用 production mode。
2. Firestore → Rules：貼上 `firestore.rules` 全部內容，按 Publish。
3. Authentication → Get started → Sign-in method：啟用 Email/Password 及 Google；Settings → Authorized domains 加入 `kalok81.github.io`。
4. 用 `scripts/accounts.mjs` 建立旅伴帳號或加入 Google 帳戶（見下）。
5. 建議：Google Cloud console → APIs & Services → Credentials，把這個 Browser key 限制為 `https://kalok81.github.io/*` 及 `http://localhost:8000/*`。

旅伴帳號（先執行 `gcloud auth login`；加入哪個旅程由環境變數 `TRIP` 指定，預設 `fukuoka-2026`）：

```sh
node scripts/accounts.mjs add amy 阿美      # 建立帳號 ID，會顯示一次隨機密碼
node scripts/accounts.mjs reset amy         # 重設密碼
node scripts/accounts.mjs google someone@gmail.com  # 容許 Google 帳戶登入
node scripts/accounts.mjs list
node scripts/accounts.mjs remove amy
```

名單存放在 Firestore 的 `config/members`，網站和權限規則都讀不到其他人的帳號資料。

Firebase 網頁設定（apiKey 等）本身是公開資料，真正的權限由 `firestore.rules` 和旅伴名單控制。旅伴名單只放在 Firestore，不要寫進這個儲存庫。

## 第一次啟用 GitHub Pages

在儲存庫 Settings → Pages → Build and deployment，選擇 GitHub Actions。若第一次推送尚未啟用 Pages，可在啟用後到 Actions → Publish travel website → Run workflow。

完成部署後，網站的實際網址會顯示在 Actions 的部署結果及 Settings → Pages 中。

## 在電腦預覽

```sh
python3 -m http.server 8000 --directory dist
```

用瀏覽器開啟 http://localhost:8000 。

## 發布前檢查

```sh
node scripts/validate.mjs
```

`dist/` 只可包含網站程式；自動發布會檢查不會誤把旅程資料放進公開網站。旅程資料也不要加入乘客姓名、稱謂、座位、訂單編號、付款明細或任何登入憑證。

這個資料夾只包含目前公開網站及部署設定，不含舊版網站的 Git 歷史，也不含先前含私人資料的版本。
