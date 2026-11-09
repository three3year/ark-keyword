# 明日方舟關鍵字搜尋

點選寒冷、凍結、浮空這類效果關鍵字,列出敘述(技能、天賦、特性、模組)含有該效果的幹員。
純前端網頁(Vue 3 + Vite + TypeScript),資料在本機建置成索引,隨網頁部署。名詞見 [GLOSSARY.md](GLOSSARY.md)。

## 開發

```bash
npm install
npm run dev          # 本機開發
npm test             # 建置 → 查詢的 Vitest 測試
npm run build        # 型別檢查 + 打包到 dist/(相對基底路徑,可放任何靜態主機)
npm run preview      # 本機預覽打包結果
npx playwright install chromium   # 第一次跑 e2e 前
npm run test:e2e     # Playwright 煙霧測試(桌機與手機寬度;先 npm run build)
```

## 更新遊戲資料

在 Claude Code session 裡輸入 `/update-data`(或說「強制」照樣完整跑):比對上游版本、建置索引、效果類型複核、
新術語分組、新警告、單元測試與 e2e,最後整次更新放在一個 commit(不 push)。步驟見
[.claude/skills/update-data/SKILL.md](.claude/skills/update-data/SKILL.md)。

不在 session 時手動更新:

```bash
npm run check-upstream         # 比對兩服上游與索引的資料版本,最後一行是「已是最新」或「有新版」
npm run build-index            # 重新下載陸服與台服資料、頭像與技能圖示,產出 public/data/(索引與幹員檔)
npm run build-index:offline    # 沿用 .cache/ 已下載的資料
npm run accept-warnings        # 把已知警告清單改成最近一次建置的全部警告
```

接著依下一節複核效果類型、把「未分組」的術語排進 `data/keyword-groups.json`,再跑 `npm test`、`npm run build`、`npm run test:e2e`。

建置會輸出:

- `review/build-warnings.txt`:全部警告:無法辨識的標記、找不到數值的佔位符、潛能加成對不齊、找不到的頭像與技能圖示等。
- `review/new-warnings.json`:已知警告清單(`data/known-warnings.json`)裡沒有的新警告。
- `review/resolved-warnings.json`:已知警告清單裡有、這次沒出現的警告(上游已修好)。
- `review/pending-review.json`:效果類型還沒複核的「敘述 × 關鍵字」配對(覆寫檔裡沒有的)。

確認新警告都是上游資料的問題後,執行 `npm run accept-warnings`,下次建置就只列出新的警告。

資料來源:陸服 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)、
台服 [arkntools/arknights-data-tw-for-maa](https://github.com/arkntools/arknights-data-tw-for-maa)、
頭像與技能圖示 [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)。

## 效果類型複核

效果類型(施加/利用/反制,一段敘述可同時多種)先以句型規則判定,再在 Claude Code session 裡交給 LLM 複核
(不呼叫外部 API,理由見 [docs/adr/0001](docs/adr/0001-effect-type-rules-plus-session-llm-review.md))。
規則判定不出的配對沒有效果類型,複核前不會出現在搜尋結果(見 [docs/adr/0002](docs/adr/0002-three-effect-types-no-fallback.md))。

1. `npm run build-index`,看 `review/pending-review.json` 有多少待複核配對。
2. 在 session 裡讓 LLM 逐筆判定,寫成 `[{ "key": "<雜湊>:<關鍵字>", "types": ["apply", "exploit"] }]` 的判定檔
   (`types` 只接受 `apply`、`exploit`、`counter`;空清單表示沒有效果類型,例如補充關鍵字誤中)。
3. `npx tsx build/applyReview.ts <判定檔.json> …` 寫進 `data/effect-overrides.json`(納入版控)。
4. 再跑一次 `npm run build-index:offline`,待複核清單應為空。

手動修正某一筆時,同樣寫一個判定檔套用即可;覆寫檔的判定一律優先於規則。
敘述文字改變時雜湊跟著變,該配對會重新出現在待複核清單。

## 維護者清單(`data/`)

| 檔案 | 內容 |
| --- | --- |
| `keyword-groups.json` | 關鍵字面板的分組與行:每組由多行組成,每行是一串關鍵字 id(術語或 `sup.<id>` 補充關鍵字),順序就是面板順序。沒列到的術語或補充關鍵字會出現在「未分組」。 |
| `supplementary-keywords.json` | 補充關鍵字:名稱、簡中與繁中比對字串、定義(顯示為「非官方」)。新增一筆即可,不用改程式;要排進面板的哪一行,改 `keyword-groups.json`。 |
| `term-matches.json` | 術語比對清單:遊戲漏標的術語,每筆是術語 id 加上簡中與繁中比對字串。建置時和補充關鍵字一起比對純文字(較長的優先,已有標記的字不重疊),補上的標記用官方名稱與定義。id 必須是會成為關鍵字的戰鬥術語(`ba.` 開頭、不在 `excluded-terms.json`),否則報建置警告、這筆不比對。 |
| `effect-overrides.json` | 效果類型覆寫檔(由 `build/applyReview.ts` 維護)。 |
| `excluded-terms.json` | 談不上效果類型、不當關鍵字的術語 id(隊伍名、綁定、部署費用下限等)。不進關鍵字面板,敘述中顯示為一般文字。新增一個 id 即可。 |
| `prts-pages.json` | 幹員 id → PRTS 頁名。結果卡的幹員名稱預設連到陸服名的 PRTS 頁;陸服名與其他幹員重複(例如阿米婭的職業形態)時必須在這裡照 PRTS 實際頁名指定,否則建置失敗。 |
| `tw-power-names.json` | 台服勢力 ID → 繁中名稱(台服資料沒有勢力名稱表),照台服遊戲實際用字。台服用到的勢力 ID 不在這裡時報建置警告,畫面暫用陸服的簡體名稱;新增一筆即可。 |
| `power-list.json` | 勢力分組可選的勢力:由行組成(國家、組織、團隊各一行),每行是一串勢力 id,順序就是面板順序。項目可寫成 `{ "id": "sui", "cn": "岁", "tw": "歲" }` 另給各伺服器的顯示名稱,沒給時用該伺服器的勢力名稱。目前伺服器沒有成員的勢力不出現在面板上。 |
| `known-warnings.json` | 已知警告清單:確認是上游資料問題的建置警告全文(可含換行)。建置只把清單裡沒有的列為新警告。由 `npm run accept-warnings` 維護,不手動編輯。 |

## 已知的近似

- 「實裝新到舊」:遊戲資料沒有實裝時間,以潛能信物的排序編號近似(同星級內依實裝先後遞增)。
- 台服資料庫沒有模組戰鬥資料:模組3 階段一律顯示陸服簡中;台服已有的幹員身上台服尚未實裝的模組另標「台服未實裝」(幹員本身台服未實裝時只在卡頭標一次)。
