// 漏標稽核:找出「文字裡寫了某個效果、但整段敘述沒標到這個關鍵字」的地方,列為疑似漏標。
// 掃的是建置剛標好的幹員檔敘述;術語用兩服的官方名稱,補充關鍵字用稽核種子字清單。
import type { IndexEntry, IndexStage, OperatorFile, Server } from '../src/core/types'
import type { BuildInput } from './buildIndex'

/** 維護者清單:補充關鍵字 id(不含 sup.)→ 稽核種子字(兩服的字寫在一起)。 */
export type AuditSeeds = Record<string, string[]>

/** 一則疑似漏標:伺服器、關鍵字、前後文相同的命中合成一則。 */
export interface Suspect {
  /** 識別鍵:「伺服器 關鍵字 前後文」,已知清單以它比對。 */
  key: string
  server: Server
  keyword: string
  /** 命中處前 8 個字、種子字、後 8 個字;數字換成「#」,換行換成「⏎」。 */
  context: string
  seed: string
  /** 涉及的幹員 id。 */
  operators: string[]
  /** 第一個出處,例如「char_002_amiya 技能1 m3」。 */
  where: string
}

/** 稽核的一個關鍵字:用哪些種子字掃,整段標到哪些關鍵字就不算漏標。 */
interface AuditTarget {
  keyword: string
  seeds: string[]
  marks: Set<string>
}

/** 一段敘述在某個伺服器的文字,與每個字元的關鍵字標記。 */
interface AuditText {
  server: Server
  operator: string
  where: string
  text: string
  owner: (string | undefined)[]
}

const CONTEXT = 8
const OWN_SIDE = /·我方$/

/** 會成為關鍵字的戰鬥術語:ba. 開頭、不在不當關鍵字的術語清單裡。 */
function isKeywordTerm(id: string, excluded: Set<string>): boolean {
  return id.startsWith('ba.') && !excluded.has(id)
}

/** 稽核的術語與補充關鍵字;種子字清單與補充關鍵字清單對不上時發警告。 */
export function auditTargets(input: BuildInput, warn: (message: string) => void): AuditTarget[] {
  return [...termTargets(input), ...supplementTargets(input, warn)]
}

/** 戰鬥術語用兩服官方名稱(去掉「·我方」);同名術語(id 只差結尾的 2)合成一組,記在不帶 2 的 id 名下。 */
function termTargets(input: BuildInput): AuditTarget[] {
  const excluded = new Set(input.excludedTerms)
  const dicts = [input.cn.gamedataConst.termDescriptionDict, input.tw?.gamedataConst.termDescriptionDict ?? {}]
  const ids = new Set(dicts.flatMap((d) => Object.keys(d)).filter((id) => isKeywordTerm(id, excluded)))
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const base = id.endsWith('2') && ids.has(id.slice(0, -1)) ? id.slice(0, -1) : id
    groups.set(base, [...(groups.get(base) ?? []), id])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyword, members]) => {
      const names = members.flatMap((id) => dicts.map((d) => d[id]?.termName.replace(OWN_SIDE, '')))
      return { keyword, seeds: [...new Set(names.filter((n): n is string => !!n))], marks: new Set(members) }
    })
}

function supplementTargets(input: BuildInput, warn: (message: string) => void): AuditTarget[] {
  const seeds = input.auditSeeds ?? {}
  const supplements = input.supplements ?? []
  const ids = new Set(supplements.map((s) => s.id))
  for (const id of Object.keys(seeds)) if (!ids.has(id)) warn(`稽核種子字清單的 ${id} 不是補充關鍵字`)
  const targets: AuditTarget[] = []
  for (const { id } of supplements) {
    const strings = (seeds[id] ?? []).filter(Boolean)
    if (strings.length === 0) {
      warn(`補充關鍵字 ${id} 沒有稽核種子字`)
      continue
    }
    targets.push({ keyword: `sup.${id}`, seeds: strings, marks: new Set([`sup.${id}`]) })
  }
  return targets
}

/** 掃描全部幹員檔的敘述,列出疑似漏標。每個關鍵字內,涉及幹員多的排前面。 */
export function auditSuspects(files: OperatorFile[], targets: AuditTarget[]): Suspect[] {
  const texts = files.flatMap(auditTexts)
  return targets.flatMap((target) => {
    const found = new Map<string, Suspect & { ops: Set<string> }>()
    for (const t of texts) {
      if (t.owner.some((k) => k && target.marks.has(k))) continue
      for (const seed of target.seeds)
        for (let from = t.text.indexOf(seed); from !== -1; from = t.text.indexOf(seed, from + 1)) {
          if (t.owner.slice(from, from + seed.length).some(Boolean)) continue
          const context = contextOf(t.text, from, seed)
          const key = `${t.server} ${target.keyword} ${context}`
          const suspect = found.get(key)
          if (suspect) suspect.ops.add(t.operator)
          else found.set(key, { key, server: t.server, keyword: target.keyword, context, seed, operators: [], where: t.where, ops: new Set([t.operator]) })
        }
    }
    return [...found.values()]
      .map(({ ops, ...s }) => ({ ...s, operators: [...ops] }))
      .sort((a, b) => b.operators.length - a.operators.length)
  })
}

function contextOf(text: string, from: number, seed: string): string {
  const end = from + seed.length
  return (text.slice(Math.max(0, from - CONTEXT), from) + seed + text.slice(end, end + CONTEXT))
    .replace(/\n/g, '⏎')
    .replace(/[\d.]+%?/g, '#')
}

function auditTexts(file: OperatorFile): AuditText[] {
  const out: AuditText[] = []
  for (const entry of file.entries)
    for (const stage of entry.stages)
      for (const server of ['cn', 'tw'] as const) {
        const runs = stage[server]?.runs
        if (!runs) continue
        const owner: (string | undefined)[] = []
        for (const r of runs) for (let i = 0; i < r.t.length; i++) owner.push(r.k)
        out.push({ server, operator: file.id, where: whereOf(file.id, entry, stage), text: runs.map((r) => r.t).join(''), owner })
      }
  return out
}

/** 出處的寫法同待複核清單,例如「char_002_amiya 技能1 m3」「char_x 特性 模組3 uniequip_002_x」。 */
function whereOf(operator: string, entry: IndexEntry, stage: IndexStage): string {
  const source = entry.kind === 'skill' ? `技能${entry.no} ${stage.kind}` : entry.kind === 'talent' ? `天賦${entry.no}` : '特性'
  const module = stage.kind === 'module' ? ` 模組3 ${stage.module}` : ''
  return `${entry.summon ?? operator} ${source}${module}`
}
