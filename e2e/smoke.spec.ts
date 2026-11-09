import { expect, test } from '@playwright/test'
import { cnOnly, groupRowNames, keywordName, powerDisplayName, powerListRows } from './data'

test('點一個關鍵字後看到結果卡,切換伺服器後結果更新', async ({ page }) => {
  await page.goto('./')
  // 頁尾顯示陸服與台服的資料版本(版號與台灣時間的下載時間);「陸服」「台服」「頭像與圖示」在新分頁開啟各自的資料來源
  const footer = page.locator('footer')
  const dataVersion = String.raw`\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}\(UTC\+8\)`
  await expect(footer).toContainText(new RegExp(`陸服 ${dataVersion} · 台服 ${dataVersion}`))
  for (const [label, repo] of [
    ['陸服', 'Kengxxiao/ArknightsGameData'],
    ['台服', 'arkntools/arknights-data-tw-for-maa'],
    ['頭像與圖示', 'yuanyan3060/ArknightsGameResource'],
  ]) {
    const link = footer.getByRole('link', { name: label, exact: true })
    await expect(link).toHaveAttribute('href', `https://github.com/${repo}`)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('title', `資料來源:${repo}`)
  }
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const cards = page.getByTestId('result-card')
  await expect(cards.first()).toBeVisible()
  await expect(cards.first().locator('mark.hl').first()).toHaveText(/暈眩|晕眩/)

  const count = page.getByTestId('result-count')
  const cnCount = await count.textContent()
  await page.getByRole('radio', { name: '台服' }).click()
  await expect(count).not.toHaveText(cnCount ?? '')
  await expect(cards.first()).toBeVisible()
})

test('結果卡一次只顯示一段命中敘述,點分頁後換成該段', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const cards = page.getByTestId('result-card')
  await expect(cards.first()).toBeVisible()
  // 每張卡同一時間只有一段命中敘述
  for (const card of await cards.all()) await expect(card.getByTestId('entry')).toHaveCount(1)

  // 忍冬的技能2 與技能3 都會暈眩
  const card = cards.filter({ has: page.getByRole('heading', { name: '忍冬', exact: true }) })
  const tabs = card.getByRole('tab')
  await expect(tabs).toHaveText(['技能2', '技能3'])
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  const panel = card.getByRole('tabpanel')
  const first = await panel.textContent()
  await card.getByRole('tab', { name: '技能3' }).click()
  await expect(card.getByRole('tab', { name: '技能3' })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'false')
  await expect(panel).not.toHaveText(first ?? '')
  await expect(panel.locator('mark.hl').first()).toHaveText(/暈眩|晕眩/)
})

test('階段切換:預設第一個命中的階段(技能是專精3),未命中的階段停用,重新查詢後回到預設', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const cards = page.getByTestId('result-card')
  const card = (name: string) => cards.filter({ has: page.getByRole('heading', { name, exact: true }) })

  // 忍冬技能2 的等級7 與專精3 都會暈眩:預設專精3,可切到等級7
  const stages = card('忍冬').getByRole('group', { name: '階段' })
  await expect(stages.getByRole('button')).toHaveText(['等級7', '專精3'])
  await expect(stages.getByRole('button', { name: '專精3' })).toHaveAttribute('aria-pressed', 'true')
  await stages.getByRole('button', { name: '等級7' }).click()
  await expect(stages.getByRole('button', { name: '等級7' })).toHaveAttribute('aria-pressed', 'true')
  await expect(stages.getByRole('button', { name: '專精3' })).toHaveAttribute('aria-pressed', 'false')
  // 每張卡各自切換:另一張卡不受影響
  const other = card('繆爾賽思').getByRole('group', { name: '階段' })
  await expect(other.getByRole('button', { name: '專精3' })).toHaveAttribute('aria-pressed', 'true')

  // 赫德雷天賦1 只有模組3 會暈眩:無模組停用,預設顯示模組3 並在內容區寫模組全名
  const hedley = card('赫德雷')
  await hedley.getByRole('tab', { name: '天賦1' }).click()
  const talentStages = hedley.getByRole('group', { name: '階段' })
  await expect(talentStages.getByRole('button', { name: '無模組' })).toBeDisabled()
  const module = talentStages.getByRole('button', { name: /^模組3 · / })
  await expect(module).toHaveAttribute('aria-pressed', 'true')
  await expect(module).toBeEnabled()
  await expect(hedley.getByRole('tabpanel')).toContainText('筆跡')

  // 重新查詢(切伺服器再切回)後所有卡回到預設的分頁與階段
  await card('忍冬').getByRole('tab', { name: '技能3' }).click()
  await page.getByRole('radio', { name: '台服' }).click()
  await page.getByRole('radio', { name: '陸服' }).click()
  await expect(card('忍冬').getByRole('tab', { name: '技能2' })).toHaveAttribute('aria-selected', 'true')
  await expect(stages.getByRole('button', { name: '專精3' })).toHaveAttribute('aria-pressed', 'true')
})

test('搜尋條件 chip:加入時只亮施加,再亮一顆後結果變多或不變,關掉最後一顆後 chip 消失', async ({ page }) => {
  await page.goto('./')
  // 篩選列不再有效果類型與分支選單
  await expect(page.getByRole('group', { name: '效果類型', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '職業' })).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByText('全部分支')).toHaveCount(0)

  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const chip = page.getByTestId('chip')
  await expect(chip).toHaveCount(1)
  const types = chip.getByRole('group', { name: '暈眩的效果類型' })
  await expect(types.getByRole('button', { name: '施加' })).toHaveAttribute('aria-pressed', 'true')
  await expect(types.getByRole('button', { name: '利用' })).toHaveAttribute('aria-pressed', 'false')
  await expect(types.getByRole('button', { name: '反制' })).toHaveAttribute('aria-pressed', 'false')

  const count = page.getByTestId('result-count')
  const total = (text: string | null) => Number(/\d+/.exec(text ?? '')?.[0])
  const applyOnly = total(await count.textContent())
  expect(applyOnly).toBeGreaterThan(0)

  // 施加-暈眩 OR 利用-暈眩:結果變多(或不變)
  await types.getByRole('button', { name: '利用' }).click()
  await expect(types.getByRole('button', { name: '利用' })).toHaveAttribute('aria-pressed', 'true')
  const either = total(await count.textContent())
  expect(either).toBeGreaterThanOrEqual(applyOnly)
  // 命中敘述列出它符合的效果類型
  await expect(page.getByTestId('result-card').first().locator('.fx')).not.toHaveCount(0)

  // 關掉所有亮著的類型鈕:chip 消失,回到初始提示
  await types.getByRole('button', { name: '施加' }).click()
  await expect(chip).toHaveCount(1)
  await types.getByRole('button', { name: '利用' }).click()
  await expect(chip).toHaveCount(0)
  await expect(page.getByText('點選關鍵字、職業或勢力開始搜尋')).toBeVisible()
})

test('只選職業也開始搜尋:列出該職業幹員,結果卡是只有卡頭、一行多張的小卡;只勾星級不搜尋', async ({ page }) => {
  await page.goto('./')
  const hint = page.getByText('點選關鍵字、職業或勢力開始搜尋')
  await expect(hint).toBeVisible()
  await page.getByRole('checkbox', { name: '6★' }).check()
  await expect(hint).toBeVisible()

  await page.getByRole('button', { name: '狙擊', exact: true }).click()
  await expect(hint).toHaveCount(0)
  await expect(page.getByTestId('profession-chip')).toHaveText([/狙擊/])
  const cards = page.getByTestId('result-card')
  await expect(cards.first()).toBeVisible()
  await expect(cards.first()).toContainText('狙擊')
  await expect(page.getByTestId('result-card').getByRole('tab')).toHaveCount(0)
  await expect(page.getByTestId('entry')).toHaveCount(0)
  expect(Number(/\d+/.exec((await page.getByTestId('result-count').textContent()) ?? '')?.[0])).toBeGreaterThan(0)
  // 只有卡頭的小卡不佔整行:前兩張在同一行
  const sameRow = async () => {
    const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()]
    return a!.y === b!.y
  }
  expect(await sameRow()).toBe(true)

  // 加上關鍵字後結果卡回到一張佔一行
  await page.getByRole('checkbox', { name: '6★' }).uncheck()
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  await expect(cards.first().getByRole('tab').first()).toBeVisible()
  expect(await sameRow()).toBe(false)
})

test('職業 chip:在搜尋條件 chip 上方、依遊戲內順序,× 與篩選列的職業鈕連動', async ({ page }) => {
  await page.goto('./')
  const professionChips = page.getByTestId('profession-chip')
  await expect(professionChips).toHaveCount(0)

  // 先點後面的職業,chip 仍依遊戲內順序
  const filter = page.getByRole('group', { name: '職業' })
  await filter.getByRole('button', { name: '狙擊', exact: true }).click()
  await filter.getByRole('button', { name: '先鋒', exact: true }).click()
  await expect(professionChips).toHaveText([/先鋒/, /狙擊/])
  // 職業 chip 沒有類型鈕
  await expect(professionChips.getByRole('button')).toHaveCount(2)

  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const keywordChip = page.getByTestId('chip')
  const professionBox = await professionChips.first().boundingBox()
  const keywordBox = await keywordChip.boundingBox()
  expect(professionBox!.y + professionBox!.height).toBeLessThanOrEqual(keywordBox!.y)

  // × 移除職業條件,篩選列的職業鈕跟著取消;再點職業鈕 chip 再出現
  const sniper = filter.getByRole('button', { name: '狙擊', exact: true })
  await expect(sniper).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '移除 狙擊' }).click()
  await expect(professionChips).toHaveText([/先鋒/])
  await expect(sniper).toHaveAttribute('aria-pressed', 'false')
  await sniper.click()
  await expect(professionChips).toHaveText([/先鋒/, /狙擊/])
})

test('沒有結果時依職業、勢力、搜尋條件、伺服器、星級列出生效的條件', async ({ page }) => {
  await page.goto('./')
  // 勢力依面板順序列出,不依點選先後
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const [kazimierz, abyssal] = [powerDisplayName('kazimierz'), powerDisplayName('abyssal')]
  await panel.getByRole('button', { name: abyssal, exact: true }).click()
  await panel.getByRole('button', { name: kazimierz, exact: true }).click()
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  await page.getByRole('button', { name: '停頓', exact: true }).first().click()
  await page.getByRole('group', { name: '停頓的效果類型' }).getByRole('button', { name: '利用' }).click()
  // 搜尋條件是 OR:要靠星級與職業篩掉所有命中的幹員
  await page.getByRole('checkbox', { name: '1★' }).check()
  await page.getByRole('button', { name: '醫療', exact: true }).click()
  const empty = page.getByTestId('empty')
  await expect(empty.getByRole('listitem')).toHaveText([
    '職業:醫療',
    `勢力:${kazimierz}、${abyssal}`,
    '搜尋條件:施加-暈眩、施加-停頓、利用-停頓',
    '伺服器:陸服',
    '星級:1★',
  ])
  await expect(empty).not.toContainText('分支')

  // 只有職業條件:沒有「勢力」「搜尋條件」這兩項
  await page.getByRole('button', { name: `移除 ${kazimierz}` }).click()
  await page.getByRole('button', { name: `移除 ${abyssal}` }).click()
  await page.getByRole('button', { name: '移除 暈眩' }).click()
  await page.getByRole('button', { name: '移除 停頓' }).click()
  await page.getByRole('checkbox', { name: '1★' }).uncheck()
  await page.getByRole('checkbox', { name: '2★' }).check()
  await expect(empty.getByRole('listitem')).toHaveText(['職業:醫療', '伺服器:陸服', '星級:2★'])
})

test('類型鈕反灰:關鍵字在目前伺服器沒有該類型的敘述時停用', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const types = page.getByRole('group', { name: '暈眩的效果類型' })
  // 沒有幹員反制暈眩
  await expect(types.getByRole('button', { name: '反制' })).toBeDisabled()
  await expect(types.getByRole('button', { name: '施加' })).toBeEnabled()
  await expect(types.getByRole('button', { name: '利用' })).toBeEnabled()
})

test('類型鈕反灰:只有陸服有資料的關鍵字,切到台服後已亮的類型反灰但仍可關掉', async ({ page }) => {
  await cnOnly(page, 'ba.groundbind')
  await page.goto('./')
  const name = keywordName('ba.groundbind')
  await page.getByRole('button', { name, exact: true }).first().click()
  const types = page.getByRole('group', { name: `${name}的效果類型` })
  const pressed = types.locator('button[aria-pressed=true]')
  const others = types.locator('button[aria-pressed=false]')
  await expect(pressed).toHaveCount(1)
  await expect(pressed).not.toHaveClass(/no-data/)
  await page.getByRole('radio', { name: '台服' }).click()
  await expect(pressed).toHaveClass(/no-data/)
  await expect(pressed).toBeEnabled()
  for (const button of await others.all()) await expect(button).toBeDisabled()
})

test('命中敘述裡的關鍵字只供查定義:游標為問號,點擊不改搜尋', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const count = page.getByTestId('result-count')
  await expect(count).not.toHaveText('共 0 位幹員')
  const before = await count.textContent()
  const chips = page.getByTestId('chip')

  const highlighted = page.locator('[data-testid=entry] .stage-text mark.hl').first()
  const unselected = page.locator('[data-testid=entry] .stage-text .term').first()
  for (const word of [highlighted, unselected]) {
    await expect(word).toHaveCSS('cursor', 'help')
    // 懸停照常顯示定義
    await word.hover()
    await expect(page.getByTestId('tip')).toBeVisible()
    await word.click()
    await expect(chips).toHaveCount(1)
    await expect(chips.first().locator('.chip-name')).toHaveText('暈眩')
    await expect(count).toHaveText(before ?? '')
  }
})

test('點 A 的定義後再點 B:關掉 A、改顯示 B', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '暈眩', exact: true }).first().click()
  const tip = page.getByTestId('tip')

  await page.getByTestId('chip').locator('.chip-name').click()
  await expect(tip).toContainText('暈眩')

  // 敘述裡未選的詞(不是暈眩)
  await page.locator('[data-testid=entry] .stage-text .term').first().click()
  await expect(tip).toHaveCount(1)
  await expect(tip).toBeVisible()
  await expect(tip.locator('.tip-title')).not.toContainText('暈眩')
})

test('關鍵字面板:補充關鍵字叫推、拉;頂端沒有過濾欄位與清除按鈕,在面板上再點一次該關鍵字即移除', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  for (const name of ['推', '拉']) await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(1)
  for (const name of ['擊退', '拉拽']) await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(panel.getByRole('searchbox')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '清除' })).toHaveCount(0)

  // 巡林者天賦1「攻擊飛行目標」不算推
  const push = panel.getByRole('button', { name: '推', exact: true })
  await push.click()
  const cards = page.getByTestId('result-card')
  await expect(cards.first()).toBeVisible()
  await expect(page.getByTestId('chip').locator('.chip-name')).toHaveText('推')
  await expect(cards.filter({ has: page.getByRole('heading', { name: '巡林者', exact: true }) })).toHaveCount(0)

  await push.click()
  await expect(page.getByTestId('chip')).toHaveCount(0)
  await expect(page.getByText('點選關鍵字、職業或勢力開始搜尋')).toBeVisible()
})

test('效果類型判定:鉤索師特性的模組3 階段只算利用-拉;佩佩利用與反制異常狀態;酒神利用束縛', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const cards = page.getByTestId('result-card')
  const card = (name: string) => cards.filter({ has: page.getByRole('heading', { name, exact: true }) })
  const typeButton = (keyword: string, type: string) => page.getByRole('group', { name: `${keyword}的效果類型` }).getByRole('button', { name: type })

  // 施加-拉:暗索因技能列入,特性(模組「拖拽期間」)不是命中敘述
  await panel.getByRole('button', { name: '拉', exact: true }).click()
  await expect(typeButton('拉', '施加')).toHaveAttribute('aria-pressed', 'true')
  await expect(card('暗索')).toHaveCount(1)
  await expect(card('暗索').getByRole('tab', { name: '特性' })).toHaveCount(0)
  // 利用-拉:特性是命中敘述
  await typeButton('拉', '利用').click()
  await typeButton('拉', '施加').click()
  await card('暗索').getByRole('tab', { name: '特性' }).click()
  await expect(card('暗索').getByRole('tabpanel')).toContainText(/拖拽期[間间]/)
  await panel.getByRole('button', { name: '拉', exact: true }).click()

  // 異常狀態沒有施加資料,預設亮利用
  await panel.getByRole('button', { name: '異常狀態', exact: true }).click()
  await expect(typeButton('異常狀態', '利用')).toHaveAttribute('aria-pressed', 'true')
  await expect(card('佩佩')).toHaveCount(1)
  await typeButton('異常狀態', '反制').click()
  await typeButton('異常狀態', '利用').click()
  await expect(typeButton('異常狀態', '反制')).toHaveAttribute('aria-pressed', 'true')
  await expect(card('佩佩')).toHaveCount(1)
  await panel.getByRole('button', { name: '異常狀態', exact: true }).click()

  await panel.getByRole('button', { name: '束縛', exact: true }).click()
  await typeButton('束縛', '利用').click()
  await typeButton('束縛', '施加').click()
  await expect(card('酒神')).toHaveCount(1)
})

test('面板點關鍵字時預設亮第一個有資料的效果類型,切換伺服器後 chip 不變', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const pressed = (keyword: string) =>
    page.getByRole('group', { name: `${keyword}的效果類型` }).locator('button[aria-pressed=true]')

  await panel.getByRole('button', { name: '異常狀態', exact: true }).click()
  await expect(pressed('異常狀態')).toHaveText(['利用'])
  await panel.getByRole('button', { name: '暈眩', exact: true }).click()
  await expect(pressed('暈眩')).toHaveText(['施加'])

  await page.getByRole('radio', { name: '台服' }).click()
  await expect(pressed('異常狀態')).toHaveText(['利用'])
  await expect(pressed('暈眩')).toHaveText(['施加'])
})

test('面板隱藏目前伺服器沒有幹員的關鍵字,已選的 chip 保留', async ({ page }) => {
  await cnOnly(page, 'ba.groundbind')
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const name = keywordName('ba.groundbind')
  const groundbind = panel.getByRole('button', { name, exact: true })
  await expect(groundbind).toHaveCount(1)
  await page.getByRole('radio', { name: '台服' }).click()
  await expect(groundbind).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '暈眩', exact: true })).toHaveCount(1)

  // 陸服選縛地再切台服:chip 仍在,切回陸服面板恢復
  await page.getByRole('radio', { name: '陸服' }).click()
  await groundbind.click()
  await page.getByRole('radio', { name: '台服' }).click()
  await expect(groundbind).toHaveCount(0)
  await expect(page.getByTestId('chip').locator('.chip-name')).toHaveText(name)
  await page.getByRole('radio', { name: '陸服' }).click()
  await expect(groundbind).toHaveAttribute('aria-pressed', 'true')
})

test('關鍵字面板依分組分行:控場第一行以減速開頭,沉默與失重在減益', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const group = (name: string) => panel.locator('.kw-group').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const firstRow = group('控場').locator('.kw-list').first().locator('.kw')
  await expect(firstRow.first()).toHaveText('減速')
  await expect(firstRow).toHaveText(groupRowNames('控場', 0))
  await expect(group('控場').locator('.kw-list')).toHaveCount(2)
  for (const name of ['沉默', '失重']) {
    await expect(group('減益').getByRole('button', { name, exact: true })).toHaveCount(1)
    await expect(group('控場').getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  // 每行從新的一行開始:第二行的第一顆在第一行下方
  const rows = group('控場').locator('.kw-list')
  const top = async (i: number) => (await rows.nth(i).locator('.kw').first().boundingBox())!.y
  expect(await top(1)).toBeGreaterThan(await top(0))
})

test('勢力分組在面板最下面,一行對應清單的一行;陸服有 S.E.E.S.,台服沒有', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const lastGroup = panel.locator('.kw-group').last()
  await expect(lastGroup.getByRole('heading')).toHaveText('勢力')
  const rows = lastGroup.locator('.kw-list')
  const list = powerListRows()
  await expect(rows).toHaveCount(list.length)
  for (const [i, row] of list.entries()) await expect(rows.nth(i).getByRole('button')).toHaveText(row.map((id) => powerDisplayName(id)))
  await expect(lastGroup.getByRole('button', { name: 'S.E.E.S.', exact: true })).toHaveCount(1)

  await page.getByRole('radio', { name: '台服' }).click()
  await expect(lastGroup.getByRole('heading')).toHaveText('勢力')
  await expect(lastGroup.getByRole('button', { name: 'S.E.E.S.', exact: true })).toHaveCount(0)
  await expect(lastGroup.getByRole('button', { name: powerDisplayName('sui', 'tw'), exact: true })).toHaveCount(1)
})

test('勢力 chip:點勢力出現 chip 與小卡,在職業 chip 之後;× 與面板勢力鈕連動', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const name = powerDisplayName('kazimierz')
  const button = panel.getByRole('button', { name, exact: true })
  const powerChips = page.getByTestId('power-chip')

  // 只有勢力條件就開始搜尋:結果是只有卡頭的小卡
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(powerChips).toHaveText([new RegExp(name)])
  // 勢力 chip 沒有類型鈕,只有 ×
  await expect(powerChips.getByRole('button')).toHaveCount(1)
  await expect(page.getByTestId('result-card').first()).toBeVisible()
  await expect(page.getByTestId('entry')).toHaveCount(0)
  expect(Number(/\d+/.exec((await page.getByTestId('result-count').textContent()) ?? '')?.[0])).toBeGreaterThan(0)

  // 職業 chip 與勢力 chip 同一行,職業在前
  await page.getByRole('group', { name: '職業' }).getByRole('button', { name: '近衛', exact: true }).click()
  const row = page.locator('.chips').filter({ has: powerChips })
  await expect(row.locator('.chip')).toHaveText([/近衛/, new RegExp(name)])

  // × 移除勢力條件,面板勢力鈕跟著取消;再點面板勢力鈕 chip 再出現
  await page.getByRole('button', { name: `移除 ${name}` }).click()
  await expect(powerChips).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(powerChips).toHaveText([new RegExp(name)])
})

test('勢力 chip 依面板順序排列:先點後面的勢力結果一樣', async ({ page }) => {
  await page.goto('./')
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  const [first, second] = [powerDisplayName('kazimierz'), powerDisplayName('abyssal')]
  await panel.getByRole('button', { name: second, exact: true }).click()
  await panel.getByRole('button', { name: first, exact: true }).click()
  await expect(page.getByTestId('power-chip')).toHaveText([new RegExp(first), new RegExp(second)])
})
