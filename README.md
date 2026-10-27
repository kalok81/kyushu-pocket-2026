# 口袋旅伴

適合手機使用的旅行手冊：每日行程、地點、住宿、航班、購物清單、可搜尋的資料簿，以及旅伴共用的筆記、開支和清單。所有旅程內容都存放在 Firebase，只限旅伴登入查看；這個公開儲存庫和網站只有程式，沒有旅程資料。

## 檔案

網站在 `dist/`，由 GitHub Actions 發佈到 GitHub Pages。

- `src/ui/*.js` → `dist/kit.js`（`window.Kit`）：共用介面元件，兩組頁面都用它，格式因此一致（見下「介面元件」）。
- `src/app/*.js` → `dist/app.js`：旅程頁面（總覽、行程、探索、附近、住宿、機票、活動、資料簿、AI 助手）。
- `src/together/*.js` → `dist/together.js`：登入、選擇旅程、Firestore 同步，以及共用、購物、我的旅程頁面。
- 每組檔案按功能分開（檔名前的數字是合併次序），由 `node scripts/build.mjs` 合併成 `dist/` 的同名檔案；同一組檔案共用變數，毋須模組或打包工具。**修改 `src/` 後要執行 build**，`scripts/validate.mjs` 會檢查 `dist/` 是否最新。
- `src/css/*.css` → `dist/style.css`：`00-tokens`（所有顏色、8 級字體大小、4 級圓角、陰影；斷點 360／480／760／900px）、`10-base`、`20-controls`（按鈕、篩選標籤、輸入欄、表格）、`30-surfaces`（卡片、列表、展開區、標籤、空白提示、頁頭）、`40-overlays`（底部視窗、⋯ 選單、浮動鍵、提示）、`50-shell`（頂部列及導航），然後每頁一個檔案（`60-home` 至 `68-ask`、`90-print`）。顏色、字體大小及圓角只用 `00-tokens` 的變數，不要在其他檔案寫數值。
- `dist/ui.js`：確認、輸入及提示視窗（SweetAlert2，網頁載入後才在閒置時下載，載入失敗時改用瀏覽器內置視窗）。
- `dist/split.js`：分帳計算（各貨幣分開，或按匯率合併成自己的貨幣）。
- `dist/weather.js`：每日天氣（Open-Meteo，免費、毋須 API key，只傳送約 1 公里精度的座標；手機快取 3 小時）。
- `dist/map-picker.js`：附近頁的地圖選點及行程頁「🗺 當天路線」；探索地圖（`src/app/36-explore-map.js`）用它載入 Leaflet。`dist/manifest.webmanifest` 及 `icon-*.png`：加到主畫面的 App 資料，Android 可由 Google 地圖「分享」到口袋旅伴（`share_target`）。`dist/nearby.js`：距離計算。
- `dist/vendor/`：Firebase、heic2any、Leaflet、SweetAlert2 的瀏覽器版本。
- `functions/`：Cloud Functions（見下）；`index.js` 只匯出各函數，程式按功能放在 `functions/lib/`（`base` 配額及 DeepSeek、`jobs` 背景工作、`assistant` AI 助手、`products` 購物、`places` 地圖、`trips`、`routes`、`discover`、`planday`、`translate`）。`firestore.rules`、`storage.rules`：權限規則。
- `scripts/accounts.mjs`：管理旅伴帳號；`scripts/validate.mjs`：發佈前檢查；`tests/`：自動測試。

### 介面元件（`Kit`）

所有頁面用同一套元件，新功能請沿用，不要自行寫按鈕或視窗的 HTML：

| 元件 | 用途 |
|---|---|
| `Kit.icon(名稱)` | 線條圖示（Lucide），例如 `plus`、`edit`、`trash`、`pin`、`calendar` |
| `Kit.btn(文字, { variant, size, icon, href, external, attrs })` | 按鈕或連結：`primary`（每頁或每個表格只有一個主要按鈕）、`secondary`、`outline`（預設）、`ghost`、`danger`；卡片內用 `size: "sm"` |
| `Kit.chips(項目)` | 篩選標籤；加 `cls: "tabs"` 變成分頁切換 |
| `Kit.pageHead(標題)`、`Kit.sectionHead(標題)` | 簡短的頁頭及段落標題，不放標語 |
| `Kit.fab(文字, attrs)` | 右下角「＋」主要新增按鈕 |
| `Kit.menu(項目)` | 「⋯」選單，放修改、刪除等次要操作 |
| `Kit.open(html)`、`Kit.sheetHead(標題)` | 底部彈出視窗（手機）／對話框（電腦），新增及修改表格都在這裡 |
| `Kit.snack(文字, { action: "復原" })` | 底部提示列；刪除後即時消失，按「復原」可取回，提示列關閉後才真正刪除 |
| `Kit.empty(標題, 說明)` | 沒有資料時的提示 |
| `Kit.card({ top, title, body, links })` | 卡片：頂行（日期或標籤，右邊「⋯」）、標題、內容、底部按鈕列；所有卡片標題同一大小 |
| `Kit.row({ lead, title, sub, trail, href, attrs })` | 列表行，放在 `<div class="list">` 內（`list plain` 沒有外框）：☰ 選單、每晚住宿、揀日子、今天行程 |
| `Kit.fold(標題, 內容)` | 原地展開的段落（修改旅程資料、更多資料、匯率），同一個箭咀 |
| `Kit.date(日期)`、`Kit.dateRange(開始, 結束)` | 所有日期同一格式：`10/29（四）`；`{ year: true }` 加年份，`{ weekday: false }` 不要星期 |
| `Kit.fnError`、`Kit.isMapsLink`、`Kit.esc` | Cloud Function 錯誤訊息、Google 地圖連結判斷、HTML 轉義 |

規則：浮動鍵寫「＋名詞」（＋地點、＋筆記、＋住宿…，`aria-label` 寫完整動作）；頁頂及工具列按鈕、卡片內按鈕用 `outline`（預設），表格內的輔助按鈕（自動填寫、AI 填寫、選用這個）用 `secondary`，每個表格只有一個 `primary`。

版面：頂部列（旅程名稱、搜尋資料簿、☰ 選單）、底部 5 個分頁（總覽、行程、探索、購物、共用；電腦版在頂部）。住宿、機票、活動、AI 助手、附近、資料簿、我的旅程、分享及登出在 ☰ 選單。

在電腦預覽：`python3 -m http.server 8000 --directory dist`，再開啟 http://localhost:8000 。

## 旅程資料

每個旅程放在 Firestore `trips/{tripId}`：名稱、目的地、日期、當地及自己的貨幣、國家、地圖中心、小區（`areas`），以及旅伴電郵（`members`，小寫）。旅程文件只由 Cloud Function `manageTrip` 修改。旅程內的資料：

| 集合 | 內容 |
|---|---|
| `places` | 探索地點（12 個欄位、分類、座標、分店 `points`） |
| `planDays/{日}` | 該日的站點清單及標題 |
| `hotels`、`flights` | 住宿及航班（可附 `docs` 文件） |
| `events` | 活動（祭典、點燈、市集：日期、時間、地點、時段、費用、官網） |
| `shopping` | 購物清單（相片、購買地點、已買） |
| `notes`、`expenses`、`checklist` | 筆記、開支、行前及行李清單 |
| `members/{uid}` | 旅伴名稱及收藏（`saved`） |
| `settings/fx` | 旅伴設定的匯率 |
| `receiptJobs` | 背景分析中的收據及物品相片 |

右上角「旅程」打開「我的旅程」：切換、建立、修改或複製旅程，邀請或移除旅伴。

## 主要功能

- **總覽**：頂部一行顯示旅程名稱、目的地、日期、天數及倒數；下面是今天的行程（旅程期間）、行程／機票／住宿／活動／附近／AI 助手捷徑，以及資料簿的搜尋及篩選。
- **行程**：頂部日期列固定在畫面上方。右下角「＋地點」及「＋筆記」（開新增筆記表格並預選這天）；「加入地點」可搜尋探索地點、住宿及購物清單的購買地點，或新增地點（與探索的新增地點同一表格，加上時間，地點同時存入探索）；站點時間旁的「＋」加入同一時間的選擇，站點的「⋯」可修改、調動或刪除，同一時間的多個選擇上下排列。站點之間的交通點可查詢 Google 路線建議（`suggestRoutes`）或 AI 建議（`aiRoutes`，日本的公共交通 Google 不經 API 提供）。旅程期間，總覽及當天行程頂部有「而家」卡：正在哪一站、下一站、最遲幾點出發（交通寫明的火車／巴士開出時間減去之前的步行及 5 分鐘找月台；否則按交通的「約 N 分」或距離估算）及倒數，每 30 秒更新，另有導航；「AI 調整餘下行程」按現在的情況（遲咗、落雨、好攰等）及位置，由 AI 重新安排未去的站點（`planDay` 的 `arrange` 加 `situation`：可以刪走趕不及的站點並說明原因，第一站的交通由現在位置計），預覽後另存為新方案「AI 調整 HH:MM」，原本的行程不變。每天的起點是前一晚的酒店：按「住宿」的入住及退房日子自動顯示在第一站上面（不存入行程，改住宿會跟着變；第一站本身是酒店，或 D1 沒有前一晚的酒店，就不顯示），由酒店到第一站的交通可以照樣查詢。每天頂部有工具列：「查全日交通」一次過填好每段交通（1.5 公里內用 Google 地圖的步行路線及時間；日本的火車用 NAVITIME 路線及車費（API 市場版本沒有時刻表，時間為估算，每段火車有「查班次」連結到 Yahoo!乗換案内；不包括巴士，主要靠步行的路線改由 AI 估算）；其餘由 AI 估算，`planDay`）；「AI 安排」按距離、營業時間、星期幾及用餐時間排好次序、時間及交通，並提示休息日或趕不及，預覽後才套用；「推算時間」由 AI 按現有次序及已填的交通排時間（`planDay` 的 `times`：交通寫明的火車／巴士開出及到達時間照用，再考慮營業時間、星期幾、用餐時間及停留時間；自己輸入的時間不變；有問題的站點加上提示，AI 的建議顯示在工具列下面；可復原）。站點可按左邊的把手拖動調次序，站點之間的「＋」可直接插入地點；交通地點（車站、機場等）可在同一天加入多次；「加入地點」可按區域篩選；加入地點時收藏排先、其餘按與當天站點的距離排列，另有「✨ AI 推薦」。每天可有最多 9 個「方案」（「⋯」→「新增方案（複製這個）」，頂部切換；工具只改正在看的方案；「設為主要方案」後總覽、住宿推算等用它；`planDays` 的 `variants`、`mainName`；建立旅程複本時一併複製，列印時每天標明印的是哪個方案）。每天的「⋯」可「與另一日對調」（站點、時間、交通、備註及標題整份互換），站點的「⋯」可「移去其他日子」（保留時間）。所有調動都可以「復原」。所有視窗及確認彈窗按外面都不會關閉，亦不會彈出提示（視窗按 ✕ 關閉，彈窗按按鈕）；其他彈出視窗在 AI 處理中不會因按到外面而關閉；有未儲存的內容時，按返回會先確認。另有每日天氣、當天路線地圖（工具列「地圖」：前一晚的酒店為「起」，站點之間按街道畫路線，1.5 公里內為步行、其餘為道路路線（`lookupPlace` 的 `paths`，Google Routes；日本的火車路線 Google 不提供，仍為直線），查過的路線存在手機不再重查；點號碼或站點列表顯示由上一站怎樣去）及列印／另存 PDF。
- **探索**：分類有餐廳、景點、商店、交通（車站、巴士總站、機場、碼頭；行程工具只計 5 分鐘停留）及手信店。「AI 推薦」按區域、類型（景點、餐廳、咖啡甜品、手信、溫泉）及喜好（雨天、親子、長者友善、地道、人少、夜景、影相打卡）推薦清單未有的地方（每次最多 12 個，「再推薦更多」會搵未出現過的），撳「加入探索」會開新增地點表格並自動填寫；行程「加入地點」的「發掘新地點」按當天站點附近及星期幾推薦（區域預設當天區域，可改成其他區域），降雨機會 50% 以上時預設雨天。貼 Google 地圖連結自動填寫（`lookupPlace`，日本用日文、韓國用韓文店名及地址），地點可有多個分店；相片錯了可「換 Google 相片」（從該地點最多 8 張 Google 地圖相片中揀）或「上載相片」；新增或修改地點時可按標題旁的 ★ 加入收藏；與探索已有地點同名、相似名稱、同一 Google 地點或相距 20 米內時，會先提示。「🛍 購物」篩選顯示要買東西的地點及未加入探索的購買地點。在探索頁任何位置（包括搜尋框）貼上 Google 地圖連結會直接開「新增地點」並自動填寫，貼上圖片則開「新增地點」並用作相片。「地圖」以圓點顯示探索頁篩選後的地點（按分類顏色，點一下看詳情，右上角定位鍵移到現在位置）；點地圖其他位置會列出 80 米內的 Google 地點（`lookupPlace` 的 `near`，由近至遠），按「加入」開新增地點並自動填寫，已在探索的顯示「已在探索」，亦可「在這裏自己輸入地點」（記下該位置）。Android 把網站加到主畫面後，在 Google 地圖按「分享」→ 口袋旅伴，會打開探索的新增地點並自動填寫（未登入的話登入後才開；iPhone 不支援，請複製連結貼上）。
- **附近**：以定位或地圖選點，找出 100／200／500 米內的地點及可買清單物品的地方。
- **購物**：加入物品只有一個欄位（名稱或產品網址）及兩個按鈕：「相片」（未輸入名稱時每張相片由 AI 認出並各自加入；否則作為這件物品的相片）及「AI 填寫」（網址→讀取產品網頁或文章；名稱→上網找規格、簡介、分類、價錢、購買地點及產品相片；只有相片→用相片重新分析）；AI 填寫的物品名稱用目的地當地的名稱（日本旅程用日文，韓國用韓文），但只限包裝、網頁或搜尋結果真的找到的當地名稱；找不到就保留原本寫的英文或中文，不會自行翻譯（日文名稱要在 AI 讀過的網頁或搜尋結果中出現才採用；相片或網頁只有英文名時，會再上網搜尋當地名稱，`withLocalName`）；「AI 填寫」及相片分析會上網找中、英、日文的用家評價，以繁體中文寫入「使用評價」（`reviews`，附來源網站），清單上可展開查看；除名稱外，備註、數量／規格及使用評價一律用繁體中文（規格可有數字及 g、ml 等單位；AI 留下日文、韓文或英文會再翻譯；找不到評價就留空），繁體中文翻譯自動顯示在名稱下面（`translateNames`）；其餘欄位收在「更多資料」，其中「給誰」（`forWhom`）及「備註」分開兩格，清單上分行顯示。每件物品左邊的圓形剔選格標記已買（再按改回未買，可復原）；加入與清單已有物品名稱相同或相似時會先提示；購物的「探索地點」及筆記的「地點」可打字搜尋（建議清單）；購買地點可以有多個（每行一個，各自定位，探索、附近及行程都會配對）；AI 找到的購買地點會逐間在 Google 地圖核實（搵唔到或名稱對唔上就略去），並直接用 Google 的位置。共用購物清單，可影相由 AI 認物品並自動加入；亦可貼上產品網頁或圖片連結（`processReceipt` 讀取網頁的名稱、說明、價錢及主圖；只讀取公開網址，會封鎖內部網絡位址），或直接貼上截圖（在購物頁任何位置或搜尋框貼上網址，亦會當作產品連結讀取）；物品分類（藥妝、食品、衣服鞋袋、生活用品、文具、玩具精品、電器、其他，`shopping/{id}.cat`）由 AI 判斷，亦可自行更改，清單按分類分組及篩選。
- **共用**：筆記（可加最多 3 張相片及連結，文字中的網址會變成連結）及優惠券（優惠碼一按複製、有效期倒數、優惠券相片、標記已使用；相片存放在筆記本身，離線亦可在收銀處出示）；筆記及優惠券的「⋯」可修改（任何旅伴都可以，類型不變）或刪除。加入相片或貼上連結時，AI（`processReceipt`，`kind: 'noteFill'`）會讀出優惠名稱、內容、優惠碼及有效期，或筆記重點，填入表格的空白欄位；開支（收據 AI 在背景讀取、換算成自己的貨幣、統計及分帳；可搜尋項目、物品、付款人、分類及日子，顯示找到的筆數及合計）；行前及行李清單（每人各自剔選）。
- **住宿、機票**：可上載訂單確認或電子機票（Storage `trips/{t}/docs/`，只限該旅程旅伴讀取）。
- **活動**：旅程期間的活動，可按日子（與活動日期重疊的旅程日）及時段（日間／夜間）篩選；「加入行程」選一天，按活動時間插入當天行程（正在看的方案以外的頁面加到主要方案）。任何旅伴可新增、修改及刪除。
- **AI 助手**（`#ask`）：「影相翻譯」影低或揀一張菜單、告示、標籤或售票機相片（電腦可直接貼上圖片），AI 以繁體中文（香港用語）寫出這是甚麼、內容大意，菜單逐項列出原文、譯名、價錢及簡介，並附注意事項。「問 AI」可問附近食乜、落雨點改行程、日本習慣等；網頁把旅程摘要（現在時間、每天的站點、酒店及天氣、探索地點、住宿、活動，可選附上現在位置及與各地點的距離）連同最近 6 輪對話一起送出，答案提到的清單地點會變成按鈕，一按打開地點。兩者都經 `receiptJobs`（`kind: 'translate'`／`'ask'`）由 `processReceipt` 處理，計入每日 AI 次數；結果只保存在這部手機（最近 5 個翻譯及 20 段對話，不保存相片），工作讀完即刪除。
- **資料簿**：搜尋旅程的所有資料（地點、站點、住宿、航班、購物、筆記）。
- 曾經登入的手機離線時也可以查看，離線時的修改會在有網絡時同步；登出會刪除手機上已下載的資料。

## Cloud Functions

| 名稱 | 用途 | 服務 |
|---|---|---|
| `processReceipt` | 背景讀取收據及物品相片，以及 AI 助手的相片翻譯及問答（Firestore `receiptJobs` 觸發） | DeepSeek `deepseek-flash` |
| `lookupPlace` | Google 地圖自動填寫；探索地圖點一個位置時列出附近的 Google 地點（`near`）；探索的新增地點表格同時讀取 Google 簡介、營業時間及評論，由 AI 填寫類型、「必吃・必買・特色」及「參考價格與營業時間」（計 1 次 AI 分析），並加入 Google 地圖上的地點相片（注明拍攝者） | Places API、DeepSeek |
| `suggestRoutes` | 站點之間的路線建議（日本火車用 NAVITIME：路線、車費及按平均行車時間估算的時間；API 市場版本沒有時刻表及列車號數，所以每段火車附「查班次」連結到 Yahoo!乗換案内） | Routes API、NAVITIME Route（RapidAPI，免費每月 500 次；每人每日最多 40 次） |
| `aiRoutes` | AI 路線建議 | DeepSeek |
| `discoverPlaces` | ✨ AI 推薦新地點（探索頁及行程「發掘新地點」）：上網搜尋清單未有的地方，逐個用 Google 地圖核實，附評分、營業時間及相片 | DeepSeek Search、DeepSeek、Places API |
| `planDay` | 行程工具：全日交通、AI 安排、推算時間、AI 推薦地點 | DeepSeek、Routes API（步行） |
| `findBuyPlaces` | 購物「AI 填寫」：上網搜尋物品資料及售賣地點，售賣地點用 Google 地圖核實 | DeepSeek Search、DeepSeek、Places API |
| `manageTrip` | 建立及修改旅程、管理旅伴 | — |
| `translateNames` | 探索地點、購物物品及開支（連收據物品）名稱不是繁中時，加上繁中譯名（`zh`、`zhFor`、開支物品 `itemsZh`），原名不變（Firestore 觸發） | DeepSeek |

API key 存放在 Secret Manager（`deepseek-api-key`、`places-api-key`、`rapidapi-key`）。新加的密鑰要給 Cloud Functions 的服務帳戶 `secretmanager.secretAccessor` 權限。

費用保護：網頁呼叫的 function 要求 Firebase App Check（reCAPTCHA Enterprise，網站金鑰在 `src/together/00-core.js` 的 `APP_CHECK_KEY`）；每位旅伴每日最多 200 次 AI 分析、300 次地圖查詢及 300 次名稱翻譯（`usage/{uid}_{日期}`，網頁不可讀寫）；Google Cloud 預算「口袋旅伴 每月預算」HK$80，用量達 50%、90%、100% 時電郵通知帳單帳戶管理員。

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
- `tests/smoke.mjs`：用虛構旅程及假 Firebase（`tests/fake/`）在 Chromium 測試登入、各頁、行程、交通、開支、清單、住宿、活動、購物、資料簿及 AI 助手。
- `tests/layout.mjs`：用資料很多、名稱很長的虛構旅程，在 320／390／768／1280px 寬度檢查所有頁面及主要視窗有沒有溢出、截斷或按鈕高度不一（`SHOTS=資料夾` 可儲存截圖）。

GitHub Actions 每次 push 先執行以上檢查，通過才發佈網站。`dist/` 只可包含網站程式；旅程資料不要加入乘客姓名、座位、訂單編號、付款明細或任何登入憑證。

## 離線使用

`dist/sw.js`（service worker）把網站本身的檔案存在手機：沒有網絡時（山區、地下）App 仍然打得開。網頁先試網絡（新版本即時生效），4 秒內沒有回應或離線時用存下的版本；有 `?v=` 版本號的檔案直接用存下的（新版本有新網址，舊版本會刪除）；其他檔案用存下的，同時在背景更新。旅程資料不經 service worker，由 Firestore 自己的離線快取提供上次載入的內容。Service worker 在 `kit.js` 載入時註冊（App 本身要連接 Firebase 後才開始）。

## 鳴謝

部分介面組件改自 [Uiverse.io](https://uiverse.io/)（[galaxy](https://github.com/uiverse-io/galaxy)，MIT），已改用網站本身的顏色：剔選格及單選掣（IndexOC「moody-mouse-53」）、開關（AbanoubMagdy1「pink-panda-32」，`Kit.toggle`）、等候圓點（Cornerstone-04「little-mouse-69」，`Kit.dots`／`Kit.loading`）。
