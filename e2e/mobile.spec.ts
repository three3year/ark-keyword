import { expect, test } from '@playwright/test'
import { gotoWithPowers, powerDisplayName } from './data'

test('手機寬度:抽屜選關鍵字、點擊顯示定義、點高亮詞只顯示定義不改搜尋,職業 chip 不算進抽屜計數,且沒有水平捲動', async ({ page }) => {
  await page.goto('./')
  const noHorizontalScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

  // 面板收在抽屜裡
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: /^關鍵字/ }).click()
  await expect(panel).toBeVisible()
  // 抽屜裡的面板照同樣分組分行,一行放不下時在行內折行
  await expect(panel.locator('.kw-group').first().locator('.kw-list').first().locator('.kw').first()).toHaveText('減速')
  expect(await noHorizontalScroll()).toBe(true)
  // 抽屜裡的面板一樣沒有過濾欄位與清除按鈕
  await expect(panel.getByRole('searchbox')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '清除' })).toHaveCount(0)
  await panel.getByRole('button', { name: '暈眩', exact: true }).first().tap()
  await expect(page.getByTestId('tip')).toContainText('無法移動')
  await panel.getByRole('button', { name: '完成' }).tap()
  await expect(panel).toBeHidden()

  const cards = page.getByTestId('result-card')
  await expect(cards.first()).toBeVisible()
  // chip 上的類型鈕一併受檢
  await expect(page.getByTestId('chip').getByRole('button', { name: '反制' })).toBeVisible()
  expect(await noHorizontalScroll()).toBe(true)

  // 職業 chip 多一行也沒有水平捲動;抽屜按鈕只算關鍵字
  await page.getByRole('group', { name: '職業' }).getByRole('button', { name: '先鋒', exact: true }).tap()
  await page.getByRole('group', { name: '職業' }).getByRole('button', { name: '近衛', exact: true }).tap()
  await expect(page.getByTestId('profession-chip')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^關鍵字/ })).toHaveText('關鍵字(1)')
  expect(await noHorizontalScroll()).toBe(true)
  await page.getByRole('button', { name: '移除 先鋒' }).tap()
  await page.getByRole('button', { name: '移除 近衛' }).tap()

  // 點擊高亮詞:只顯示定義,提示框沒有加入/移出按鈕,搜尋不變
  const count = page.getByTestId('result-count')
  const before = await count.textContent()
  await cards.first().locator('mark.hl').first().tap()
  const tip = page.getByTestId('tip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('暈眩')
  await expect(tip.getByRole('button')).toHaveCount(0)
  await expect(page.getByTestId('chip')).toHaveCount(1)
  await expect(count).toHaveText(before ?? '')
  expect(await noHorizontalScroll()).toBe(true)

  // 點別處關閉提示框
  await page.getByTestId('result-count').tap()
  await expect(tip).toBeHidden()
})

test('手機寬度:幹員詳情占滿螢幕、沒有水平捲動,返回鍵關閉後仍在結果列表', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('group', { name: '職業' }).getByRole('button', { name: '先鋒', exact: true }).tap()
  const count = await page.getByTestId('result-count').textContent()
  await page.getByRole('button', { name: '檢視忍冬的詳情' }).tap()
  const dialog = page.getByRole('dialog', { name: '忍冬' })
  await expect(dialog.getByTestId('detail-entry').first()).toBeVisible()
  const box = (await dialog.boundingBox())!
  const viewport = page.viewportSize()!
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, viewport.width, viewport.height])
  const attrs = dialog.getByTestId('operator-attributes')
  const avatar = (await dialog.getByRole('link', { name: /^在 PRTS 查看忍冬/ }).boundingBox())!
  expect((await attrs.boundingBox())!.y).toBeGreaterThanOrEqual(avatar.y + avatar.height)
  await attrs.locator('.attr .bonus').first().tap()
  await expect(page.getByTestId('tip')).toHaveText('信賴 100% 加成')
  await attrs.getByTestId('attributes-level').tap()
  await expect(page.getByTestId('tip')).toHaveCount(0)
  // 技能頁籤有技力文字,放不下時只在欄位之間換行
  await dialog.getByRole('tab', { name: '技能1' }).tap()
  await expect(dialog.getByTestId('skill-facts').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true)

  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('result-count')).toHaveText(count ?? '')
  await expect(page.getByTestId('profession-chip')).toHaveText([/先鋒/])
})

test('手機寬度:勢力字串過長時在屬性欄內換行,沒有水平捲動', async ({ page }) => {
  const long = ['維多利亞', '格拉斯哥幫', '烏薩斯學生自治團', '行動預備組A6']
  await gotoWithPowers(page, { power: long, hiddenPowers: [long, long] })
  await page.getByRole('group', { name: '職業' }).getByRole('button', { name: '先鋒', exact: true }).tap()
  await page.getByRole('button', { name: '檢視忍冬的詳情' }).tap()
  const dialog = page.getByRole('dialog', { name: '忍冬' })
  const lines = dialog.getByTestId('operator-attributes').locator('.attr-power')
  await expect(lines).toHaveCount(2)
  const hidden = (await lines.nth(1).boundingBox())!
  const firstLine = (await dialog.getByTestId('attributes-level').boundingBox())!
  expect(hidden.height).toBeGreaterThan(firstLine.height * 1.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true)
})

test('手機寬度:標題列兩行,伺服器切換與外觀在標題下方同一行;關鍵字鈕浮在右下角,抽屜打開時隱藏', async ({ page }) => {
  await page.goto('./')
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!
  const server = (await page.getByRole('radiogroup', { name: '伺服器' }).boundingBox())!
  const appearance = (await page.getByRole('radiogroup', { name: '外觀' }).boundingBox())!
  expect(server.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(appearance.y).toBeGreaterThanOrEqual(title.y + title.height)
  expect(Math.abs(server.y + server.height / 2 - (appearance.y + appearance.height / 2))).toBeLessThan(2)
  expect(appearance.x).toBeGreaterThan(server.x + server.width - 1)
  // 最窄的手機寬度也不折行
  const deviceViewport = page.viewportSize()!
  await page.setViewportSize({ width: 320, height: 640 })
  const narrowServer = (await page.getByRole('radiogroup', { name: '伺服器' }).boundingBox())!
  const narrowAppearance = (await page.getByRole('radiogroup', { name: '外觀' }).boundingBox())!
  expect(Math.abs(narrowServer.y - narrowAppearance.y)).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.setViewportSize(deviceViewport)

  // 關鍵字鈕不在標題列,固定在畫面右下角
  const drawerBtn = page.getByRole('button', { name: /^關鍵字/ })
  await expect(page.locator('header').getByRole('button', { name: /^關鍵字/ })).toHaveCount(0)
  const viewport = page.viewportSize()!
  const drawerBtnBox = async () => (await drawerBtn.boundingBox())!
  const before = await drawerBtnBox()
  expect(before.x + before.width).toBeGreaterThan(viewport.width - 40)
  expect(before.y + before.height).toBeGreaterThan(viewport.height - 60)
  expect(before.y + before.height).toBeLessThanOrEqual(viewport.height)

  // 選了搜尋條件後顯示數量;捲動時位置不變
  await drawerBtn.tap()
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })
  await expect(panel).toBeVisible()
  // 抽屜打開時看不到懸浮鈕
  await expect(drawerBtn).toBeHidden()
  await panel.getByRole('button', { name: '暈眩', exact: true }).first().tap()
  await panel.getByRole('button', { name: '完成' }).tap()
  await expect(panel).toBeHidden()
  await expect(drawerBtn).toBeVisible()
  await expect(drawerBtn).toHaveText('關鍵字(1)')
  const unscrolled = await drawerBtnBox()
  expect(unscrolled.x + unscrolled.width).toBeCloseTo(before.x + before.width)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect(await drawerBtnBox()).toEqual(unscrolled)

  // 捲到底時最後一張結果卡完整露出,頁尾也不被擋住
  const drawerBtnTop = before.y
  const lastCard = (await page.getByTestId('result-card').last().boundingBox())!
  expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(drawerBtnTop)
  const footer = (await page.locator('footer').boundingBox())!
  expect(footer.y + footer.height).toBeLessThanOrEqual(drawerBtnTop)

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('手機寬度:抽屜鈕計數包含勢力條件,文字與抽屜標題不變;多了勢力分組與勢力 chip 也沒有水平捲動', async ({ page }) => {
  await page.goto('./')
  const noHorizontalScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  const drawerBtn = page.getByRole('button', { name: /^關鍵字/ })
  const panel = page.getByRole('complementary', { name: '關鍵字面板' })

  await drawerBtn.tap()
  await expect(panel.locator('.drawer-head strong')).toHaveText('關鍵字')
  await expect(panel.locator('.kw-group').last().getByRole('heading')).toHaveText('勢力')
  await panel.locator('.kw-group').last().scrollIntoViewIfNeeded()
  expect(await noHorizontalScroll()).toBe(true)
  const powers = [powerDisplayName('student'), powerDisplayName('kazimierz')]
  await panel.getByRole('button', { name: '暈眩', exact: true }).first().tap()
  for (const name of powers) await panel.getByRole('button', { name, exact: true }).tap()
  await panel.getByRole('button', { name: '完成' }).tap()
  await expect(drawerBtn).toHaveText('關鍵字(3)')

  const filter = page.getByRole('group', { name: '職業' })
  for (const name of ['先鋒', '近衛', '重裝']) await filter.getByRole('button', { name, exact: true }).tap()
  await expect(page.getByTestId('power-chip')).toHaveCount(2)
  await expect(drawerBtn).toHaveText('關鍵字(3)')
  expect(await noHorizontalScroll()).toBe(true)
})
