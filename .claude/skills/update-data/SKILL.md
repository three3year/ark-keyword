---
name: update-data
description: 更新陸服、台服遊戲資料:比對上游版本、建置索引、效果類型複核、新術語分組、新警告、新疑似漏標、測試,最後一個 commit。
disable-model-invocation: true
---

# 更新遊戲資料

照順序做完每一步。標著 **停下** 的地方,把內容列給維護者,等維護者回覆再往下。名詞見 `GLOSSARY.md`。

每個指令都看結束碼:非 0 就**停下**,原樣回報錯誤訊息,怎麼修由維護者決定(例如 `data/prts-pages.json` 缺頁名)。PowerShell 會把建置的警告輸出顯示成紅色錯誤區塊,結束碼 0 就是成功。

## 1. 比對上游版本

執行 `npm run check-upstream`,記下兩服的索引版號與上游版號(摘要與 commit 訊息要用)。

- 最後一行是「結果:已是最新」,而且維護者沒有說「強制」:回報「已是最新」與兩服版號,結束。
- 有新版,或維護者說「強制」:往下。

## 2. 下載並建置索引

執行 `npm run build-index`。

完成:結束碼 0,記下輸出裡的待複核配對數、新警告則數與新疑似漏標則數。

## 3. 效果類型複核

讀 `review/pending-review.json`。0 筆就跳到第 4 步。

每一筆依 `GLOSSARY.md` 的「效果類型」定義判定 `types`(`apply`/`exploit`/`counter`,可多種),寧缺勿濫:談不上任何一種就是空清單。

**停下**:每一筆都列給維護者,一筆一列:幹員名(依 `where` 開頭的 id 查 `public/data/index.json` 的 `operators`;召喚物的 id 在 `operators` 的 `summons` 裡,列成「幹員名/召喚物名」)、敘述來源(`where`)、關鍵字名、規則判定(`ruleTypes`)、敘述原文(`text`)、你的判定與一句理由。維護者確認或改掉幾筆後,才把確認後的判定寫成 `review/decisions/<今天日期>.json`:

```json
[{ "key": "<pending 的 key>", "types": ["apply"] }]
```

然後:

```bash
npx tsx build/applyReview.ts review/decisions/<今天日期>.json
npm run build-index:offline
```

完成:`review/pending-review.json` 是空陣列。不是空的就對剩下的配對重複這一步。

## 4. 新術語分組

從 `public/data/index.json` 的 `groups` 找名稱為「未分組」的分組;沒有就跳到第 5 步。對其中每個關鍵字 id,讀 `keywords` 裡它的定義,決定位置。補充關鍵字(`sup.` 開頭)一律放進分組;術語依 `GLOSSARY.md` 的「關鍵字」定義判斷:

- 是關鍵字:放進 `data/keyword-groups.json` 最貼近的分組與行,排在性質最接近的關鍵字旁邊。
- 不是關鍵字:加進 `data/excluded-terms.json`。

寫進檔案,執行 `npm run build-index:offline`。

**停下**:列給維護者每個關鍵字的名稱、定義、放的位置(分組、第幾行、排在誰旁邊,或排除)與理由。維護者改位置就照改,再離線建置一次。

完成:索引的 `groups` 沒有「未分組」。

## 5. 新警告

讀 `review/new-warnings.json` 與 `review/resolved-warnings.json`。

- 新警告(「勢力清單外的勢力」除外,見下一項):每一則說明影響,例如「幹員 X 技能2 專精3 的敘述標記沒有關閉:寒冷之後的文字沒有高亮」、「天賦的潛能加成對不齊:只顯示潛能1 敘述」,並判斷是上游資料的問題還是本專案建置的問題。**停下**:列給維護者,問是否都是上游問題。維護者認為要修的,結束流程,交給維護者。
- 「勢力清單外的勢力」:不是上游問題,是天賦或技能要求了 `data/power-list.json` 沒列的勢力。**停下**:列出勢力 id、名稱與出處,問維護者要不要加進清單、放哪一行。要加就寫進清單,執行 `npm run build-index:offline`;不加就和其他新警告一樣接受成已知警告。
- 已消失的已知警告:上游已修好,列進摘要,不用問。

有新警告(維護者確認後)或有已消失的警告時:

```bash
npm run accept-warnings
npm run build-index:offline
```

完成:建置摘要的新警告與已消失的已知警告都是 0 則。

## 6. 新疑似漏標

讀 `review/new-suspects.json` 與 `review/resolved-suspects.json`。兩份都是 0 則就跳到第 7 步。

- 新疑似漏標:每一則看前後文(`context`,數字已換成「#」),需要時依 `where` 讀幹員檔的完整敘述,判斷是**漏標**(這段確實寫了關鍵字 `keyword` 的效果,只是沒標到)還是**誤中**(種子字 `seed` 是別的意思,例如地名「拉特蘭」的「拉」),附一句理由。**停下**:一則一列給維護者:伺服器、關鍵字名、前後文、涉及幹員數(`operators`)、出處(`where`)、你的判斷與理由,問維護者是否同意。
- 已消失的已知疑似漏標:那段文字已經標到或改寫了,列進摘要,不用問。

維護者確認後,先處理漏標,再處理其餘:

1. 漏標:加一個只命中這個意思的比對字串。關鍵字是術語(`ba.` 開頭)就加進 `data/term-matches.json` 該術語的 `cn` 或 `tw`(還沒有這個術語就新增一筆);是補充關鍵字(`sup.` 開頭)就加進 `data/supplementary-keywords.json` 該筆的 `cn` 或 `tw`。執行 `npm run build-index:offline`,補上的標記會產生新的待複核配對,照第 3 步複核到 `review/pending-review.json` 是空陣列。此時 `review/new-suspects.json` 只剩誤中與維護者決定不補的;還有漏標就調整比對字串,重做這一項。
2. 其餘(誤中、不補的漏標)與已消失的:

   ```bash
   npm run accept-suspects
   npm run build-index:offline
   ```

完成:建置摘要的新疑似漏標與已消失的已知疑似漏標都是 0 則,`review/pending-review.json` 是空陣列。

## 7. 測試

```bash
npm test
npm run build
npm run test:e2e
```

例外:e2e 因為沒有瀏覽器而失敗(訊息提到 `npx playwright install`)時,執行 `npx playwright install chromium` 後重跑 e2e。

完成:三項都通過。

## 8. 摘要

給維護者一份摘要:

- 兩服的舊版號 → 新版號(第 1 步記下的)。
- 新增幹員:`public/data/index.json` 有、`git show HEAD:public/data/index.json` 沒有的幹員,列出名稱。
- 新術語:名稱、位置、理由(第 4 步)。
- 複核筆數與維護者改掉的筆數(第 3 步)。
- 新警告與已消失的警告(第 5 步)。
- 新疑似漏標:補了哪些比對字串(關鍵字、加進哪份清單)、收進已知清單的則數;已消失的則數(第 6 步)。
- 測試結果(第 7 步)。

## 9. Commit

把這次的改動放在一個 commit:

```bash
git add public/data public/avatars public/skill-icons data
```

commit 訊息第一行:

- 任一服有新版:`data: 更新至陸服 <陸服上游版號>、台服 <台服上游版號>`
- 強制跑且兩服版號都沒變:`data: 重新建置(上游版本未更新:陸服 <版號>、台服 <版號>)`

內文放第 8 步的摘要。只 commit;push 由維護者自己做。

完成:`git status` 在 `public/data`、`public/avatars`、`public/skill-icons`、`data` 底下沒有未 commit 的改動。
