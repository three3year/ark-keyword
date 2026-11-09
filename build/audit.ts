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
  operators: string[]
  /** 第一個出現的位置,例如「char_002_amiya 技能1 m3」。 */
  where: string
}

interface AuditTarget {
  keyword: string
  seeds: string[]
  satisfiedBy: Set<string>
}

interface AuditText {
  server: Server
  operator: string
  where: string
  text: string
  keywords: string[]
  keywordAt: (string | undefined)[]
}

const CONTEXT = 8
const OWN_SIDE = /·我方$/

/** 敘述出現的位置,例如「char_002_amiya 技能1 m3」;待複核清單與疑似漏標共用這個格式。 */
export function whereOf(owner: string, entry: Pick<IndexEntry, 'kind' | 'no'>, stage: Pick<IndexStage, 'kind' | 'module'>): string {
  const source = entry.kind === 'skill' ? `技能${entry.no} ${stage.kind}` : entry.kind === 'talent' ? `天賦${entry.no}` : '特性'
  const module = stage.kind === 'module' ? ` 模組3 ${stage.module}` : ''
  return `${owner} ${source}${module}`
}

/** 稽核的術語與補充關鍵字;種子字清單與補充關鍵字清單對不上時發警告。 */
export function auditTargets(input: BuildInput, keywordTerms: Set<string>, warn: (message: string) => void): AuditTarget[] {
  return [...termTargets(input, keywordTerms), ...supplementTargets(input, warn)]
}

function termTargets(input: BuildInput, ids: Set<string>): AuditTarget[] {
  const dicts = [input.cn.gamedataConst.termDescriptionDict, input.tw?.gamedataConst.termDescriptionDict ?? {}]
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const base = pairedTermBase(id, ids)
    groups.set(base, [...(groups.get(base) ?? []), id])
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyword, members]) => {
      const names = members.flatMap((id) => dicts.map((d) => d[id] && withoutOwnSide(d[id].termName)))
      return { keyword, seeds: [...new Set(names.filter((n): n is string => !!n))], satisfiedBy: new Set(members) }
    })
}

/** 術語名稱去掉「·我方」後綴:「·我方」版與敵方版在敘述裡寫成同一個名稱。 */
export function withoutOwnSide(termName: string): string {
  return termName.replace(OWN_SIDE, '')
}

/** 同名的「·我方」術語(id 多一個結尾 2)併到不帶 2 的 id 名下。 */
function pairedTermBase(id: string, ids: Set<string>): string {
  const base = id.slice(0, -1)
  return id.endsWith('2') && ids.has(base) ? base : id
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
    targets.push({ keyword: `sup.${id}`, seeds: strings, satisfiedBy: new Set([`sup.${id}`]) })
  }
  return targets
}

/** 掃描全部幹員檔的敘述,列出疑似漏標。每個關鍵字內,涉及幹員多的排前面。 */
export function auditSuspects(files: OperatorFile[], targets: AuditTarget[]): Suspect[] {
  const texts = files.flatMap(auditTexts)
  return targets.flatMap((target) => {
    const found = new Map<string, Suspect>()
    for (const t of texts) {
      if (t.keywords.some((k) => target.satisfiedBy.has(k))) continue
      for (const seed of target.seeds)
        for (let from = t.text.indexOf(seed); from !== -1; from = t.text.indexOf(seed, from + 1)) {
          if (t.keywordAt.slice(from, from + seed.length).some(Boolean)) continue
          const context = contextOf(t.text, from, seed)
          const key = `${t.server} ${target.keyword} ${context}`
          const suspect = found.get(key)
          if (!suspect) found.set(key, { key, server: t.server, keyword: target.keyword, context, seed, operators: [t.operator], where: t.where })
          else if (!suspect.operators.includes(t.operator)) suspect.operators.push(t.operator)
        }
    }
    return [...found.values()].sort((a, b) => b.operators.length - a.operators.length)
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
        const text = stage[server]
        if (!text) continue
        const { runs, hits } = text
        const keywordAt: (string | undefined)[] = []
        for (const r of runs) for (let i = 0; i < r.t.length; i++) keywordAt.push(r.k)
        out.push({ server, operator: file.id, where: whereOf(entry.summon ?? file.id, entry, stage), text: runs.map((r) => r.t).join(''), keywords: Object.keys(hits), keywordAt })
      }
  return out
}
