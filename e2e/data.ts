import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  type OperatorAttributes,
  type OperatorFile,
  type OperatorPowers,
  onServer,
  PROFESSION_LABELS,
  type SearchIndex,
  type Server,
} from '../src/core/types'

// 台服資料持續更新:簡中詞名會換成繁中、陸服限定的資料會變成兩服都有。
// 測試要的資料事實從索引推算,或由 cnOnly 自己造,不寫死現況。

const index: SearchIndex = JSON.parse(readFileSync('public/data/index.json', 'utf8'))

export function keywordName(id: string): string {
  const keyword = index.keywords.find((k) => k.id === id)
  if (!keyword) throw new Error(`索引沒有關鍵字 ${id}`)
  return keyword.name
}

/** 索引裡某分組第 row 行(從 0 起)的關鍵字名稱,即面板該行應有的文字。 */
export function groupRowNames(group: string, row: number): string[] {
  const found = index.groups.find((g) => g.name === group)
  if (!found) throw new Error(`索引沒有分組 ${group}`)
  return found.rows[row].map(keywordName)
}

export function powerListRows(): string[][] {
  const list: (string | { id: string })[][] = JSON.parse(readFileSync('data/power-list.json', 'utf8'))
  return list.map((row) => row.map((item) => (typeof item === 'string' ? item : item.id)))
}

export function powerDisplayName(id: string, server: Server = 'cn'): string {
  const power = index.powerRows.flat().find((p) => p.id === id)
  if (!power) throw new Error(`索引沒有勢力 ${id}`)
  return onServer(power.name, server)
}

export function twOperatorWithDifferentPrtsPage(): { name: string; prtsPage: string; rarity: number; profession: string } {
  const op = index.operators.find((o) => o.inTw && o.name !== o.prtsPage)
  if (!op) throw new Error('索引沒有名字與 PRTS 頁名不同的台服幹員')
  return { name: op.name, prtsPage: op.prtsPage, rarity: op.rarity, profession: PROFESSION_LABELS[op.profession] }
}

function operatorFile(name: string): OperatorFile {
  const op = index.operators.find((o) => o.name === name)
  if (!op?.detail) throw new Error(`索引沒有幹員 ${name} 的幹員檔`)
  return JSON.parse(readFileSync(`public/${op.detail}`, 'utf8'))
}

export function operatorAttributes(name: string, server: Server = 'cn'): OperatorAttributes {
  return onServer(operatorFile(name).attributes, server)
}

export function powerTexts(name: string, server: Server = 'cn'): string[] {
  const p = onServer(operatorFile(name).powers, server)
  const lines = [`所屬勢力 ${p.power.join(' · ')}`]
  if (p.hiddenPowers.length > 0) lines.push(`隱藏勢力 ${p.hiddenPowers.map((h) => h.join(' · ')).join('、')}`)
  return lines
}

const OPERATOR_FILES = '**/data/operators/**'

/** 把每個幹員檔的勢力換成 powers,再重新載入首頁。app 同一次載入會快取幹員檔,所以攔截要在載入頁面之前。 */
export async function gotoWithPowers(page: Page, powers: OperatorPowers): Promise<void> {
  await page.unroute(OPERATOR_FILES)
  await page.route(OPERATOR_FILES, async (route) => {
    const response = await route.fetch()
    const file: OperatorFile = await response.json()
    file.powers = { cn: powers, tw: powers }
    await route.fulfill({ response, json: file })
  })
  await page.goto('./')
}

export function attributeTexts(a: OperatorAttributes): string[] {
  const withTrust = (value: number, trust: number) => (trust ? `${value}(+${trust})` : `${value}`)
  return [
    `費用 ${a.cost}`,
    `阻擋數 ${a.block}`,
    `攻擊間隔 ${a.intervalSeconds}s`,
    `再部署時間 ${a.redeploySeconds}s`,
    `生命 ${withTrust(a.hp, a.trust.hp)}`,
    `攻擊 ${withTrust(a.atk, a.trust.atk)}`,
    `防禦 ${withTrust(a.def, a.trust.def)}`,
    `法抗 ${a.res}`,
  ]
}

/** 把帶有這個關鍵字的幹員都當成台服未實裝,讓它只有陸服有資料。要在 page.goto 之前呼叫。 */
export async function cnOnly(page: Page, keyword: string): Promise<void> {
  await page.route('**/data/index.json', async (route) => {
    const response = await route.fetch()
    const data: SearchIndex = await response.json()
    for (const op of data.operators) if (JSON.stringify(op).includes(`"${keyword}"`)) op.inTw = false
    await route.fulfill({ response, json: data })
  })
}
