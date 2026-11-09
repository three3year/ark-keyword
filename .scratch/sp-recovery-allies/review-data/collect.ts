// 友方技力回復重新複核的資料塊。在 repo 根執行:npx tsx .scratch/sp-recovery-allies/review-data/collect.ts
//
// 1. 拿掉覆寫檔裡所有 sup.sprecovery 的配對後建置一次索引:所有友方技力回復配對(含新比對字串產生的)都會列為待複核,
//    帶出原文與出處;配對 id 就是覆寫檔的鍵。
// 2. 用完整覆寫檔建置一次,取出已知疑似漏標清單裡友方技力回復的條目目前的前後文與出處。
// 3. 和 judgements.json(逐筆建議判定與理由)合併,寫出 pairs.json 與 suspects.json 兩個資料塊。
// 不寫 public/data 與 review/。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIndex, type BuildInput, type Overrides, type SupplementKeyword } from '../../../build/buildIndex'
import type { RawServer } from '../../../build/raw'

const ROOT = process.cwd()
const HERE = join(ROOT, '.scratch', 'sp-recovery-allies', 'review-data')
const KEYWORD = 'sup.sprecovery'
const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const data = <T>(name: string): T => json<T>(join(ROOT, 'data', `${name}.json`))

function loadServer(server: 'cn' | 'tw'): RawServer {
  const f = (name: string) => join(ROOT, '.cache', 'raw', server, `${name}.json`)
  const optional = (name: string) => {
    try {
      return json(f(name))
    } catch {
      return undefined
    }
  }
  return {
    characterTable: json(f('character_table')),
    skillTable: json(f('skill_table')),
    gamedataConst: json(f('gamedata_const')),
    uniequipTable: optional('uniequip_table'),
    battleEquipTable: optional('battle_equip_table'),
    charPatchTable: optional('char_patch_table'),
    itemTable: optional('item_table'),
    handbookTeamTable: optional('handbook_team_table'),
    downloadedAt: '',
  } as RawServer
}

const overrides = data<Overrides>('effect-overrides')
const supplements = data<SupplementKeyword[]>('supplementary-keywords')
const input: BuildInput = {
  cn: loadServer('cn'),
  tw: loadServer('tw'),
  groups: data('keyword-groups'),
  supplements,
  termMatches: data('term-matches'),
  overrides,
  excludedTerms: data('excluded-terms'),
  prtsPages: data('prts-pages'),
  twPowerNames: data('tw-power-names'),
  powerList: data('power-list'),
  auditSeeds: data('audit-seeds'),
}

// ---------- 配對 ----------

const stripped = Object.fromEntries(Object.entries(overrides).filter(([k]) => !k.endsWith(`:${KEYWORD}`)))
const strippedBuild = buildIndex({ ...input, overrides: stripped })
const pairs = strippedBuild.pending.filter((p) => p.keyword === KEYWORD)

// 幹員名、召喚物名、模組代號
const names = new Map<string, string>()
const moduleCodes = new Map<string, string>()
for (const op of strippedBuild.operatorFiles) {
  const name = strippedBuild.index.operators.find((o) => o.id === op.id)?.name ?? op.id
  names.set(op.id, name)
  for (const s of op.summons ?? []) names.set(s.id, `${name}/${s.name}`)
  for (const m of op.modules ?? []) moduleCodes.set(m.id, m.code)
}
function readWhere(where: string): { who: string; source: string; server: 'cn' | 'tw' } {
  const server = where.endsWith('(台服)') ? 'tw' : 'cn'
  const [id, ...rest] = where.replace('(台服)', '').split(' ')
  const source = rest
    .join(' ')
    .replace(/模組3 (\S+)/, (_, m: string) => `模組 ${moduleCodes.get(m) ?? m}`)
  return { who: names.get(id) ?? id, source, server }
}

const matchStrings = (server: 'cn' | 'tw') => supplements.find((s) => `sup.${s.id}` === KEYWORD)![server]
/** 原文裡實際比對到的字串(依伺服器的比對字串清單)。 */
const marksIn = (text: string, server: 'cn' | 'tw') => matchStrings(server).filter((m) => text.includes(m))

/** 建議判定;unsure 是拿不準、要維護者另外決定的。 */
interface Judgement {
  verdict: 'apply' | 'empty'
  unsure?: boolean
  reason: string
}
const judgements = json<Record<string, Judgement>>(join(HERE, 'judgements.json'))
const verdictLabel = (j: Judgement) => `${j.verdict === 'apply' ? '施加' : '空類型'}${j.unsure ? '(拿不準)' : ''}`

const missing = pairs.filter((p) => !judgements[p.key]).map((p) => p.key)
const stale = Object.keys(overrides).filter((k) => k.endsWith(`:${KEYWORD}`) && !pairs.some((p) => p.key === k))

const serverLabel = { cn: '陸服', tw: '台服' }
const rows = pairs
  .map((p) => {
    const places = p.where.map(readWhere)
    const server = places[0].server
    const current = overrides[p.key] ? `覆寫:${overrides[p.key].types.length ? '施加' : '空類型'}` : '新配對(待複核)'
    const j = judgements[p.key]
    return {
      sortKey: `${places[0].who}\u0000${places[0].source}`,
      cells: [
        p.key.split(':')[0],
        [...new Set(places.map((w) => w.who))].join('、'),
        places.map((w) => w.source).join(';'),
        serverLabel[server],
        { text: p.text, marks: marksIn(p.text, server) },
        current,
        j ? verdictLabel(j) : null,
        j?.reason ?? null,
      ],
    }
  })
  .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'zh-Hant'))
  .map(({ cells }) => ({ cells }))

writeFileSync(
  join(HERE, 'pairs.json'),
  JSON.stringify(
    {
      columns: [
        { name: '配對', type: 'text' },
        { name: '幹員', type: 'text' },
        { name: '出處', type: 'text' },
        { name: '伺服器', type: 'text' },
        { name: '原文', type: 'quote' },
        { name: '目前判定', type: 'text' },
        { name: '建議判定', type: 'text' },
        { name: '理由', type: 'text' },
      ],
      key: '配對',
      rows,
    },
    null,
    1,
  ) + '\n',
)

// ---------- 已知疑似漏標 ----------

const known = data<string[]>('known-suspects').filter((k) => k.split(' ')[1] === KEYWORD)
const fullBuild = buildIndex(input)
const suspects = new Map(fullBuild.suspects.map((s) => [s.key, s]))
const suspectJudgements = json<Record<string, { verdict: 'keep' | 'drop' | 'gap'; reason: string }>>(join(HERE, 'suspect-judgements.json'))
const SUSPECT_VERDICT = { keep: '留著', drop: '拿掉', gap: '漏標,補比對字串' }
const suspectRows = known.map((key) => {
  const s = suspects.get(key)
  const server = key.startsWith('tw ') ? 'tw' : 'cn'
  const context = key.split(' ').slice(2).join(' ')
  const seed = s?.seed ?? '技力'
  const where = s ? readWhere(`${s.where}${server === 'tw' ? '(台服)' : ''}`) : null
  const j = suspectJudgements[key]
  return {
    cells: [
      key,
      s ? s.operators.map((id) => names.get(id) ?? id).join('、') : null,
      where?.source ?? null,
      serverLabel[server],
      { text: context, marks: context.includes(seed) ? [seed] : [] },
      s ? '仍報出' : '已不再報(新比對字串標到)',
      j ? SUSPECT_VERDICT[j.verdict] : null,
      j?.reason ?? null,
    ],
  }
})
writeFileSync(
  join(HERE, 'suspects.json'),
  JSON.stringify(
    {
      columns: [
        { name: '條目', type: 'text' },
        { name: '幹員', type: 'text' },
        { name: '出處', type: 'text' },
        { name: '伺服器', type: 'text' },
        { name: '前後文', type: 'quote' },
        { name: '目前', type: 'text' },
        { name: '建議', type: 'text' },
        { name: '理由', type: 'text' },
      ],
      key: '條目',
      rows: suspectRows,
    },
    null,
    1,
  ) + '\n',
)

// ---------- 摘要 ----------

const count = (pred: (j: Judgement) => boolean) => pairs.filter((p) => judgements[p.key] && pred(judgements[p.key])).length
console.log(`配對 ${pairs.length} 筆(覆寫 ${pairs.filter((p) => overrides[p.key]).length}、新 ${pairs.filter((p) => !overrides[p.key]).length})`)
console.log(
  `建議:施加 ${count((j) => j.verdict === 'apply' && !j.unsure)}、空類型 ${count((j) => j.verdict === 'empty' && !j.unsure)}、拿不準 ${count((j) => !!j.unsure)}、未判 ${missing.length}`,
)
const before = new Set(pairs.flatMap((p) => p.where.map((w) => readWhere(w).who.split('/')[0])))
const after = new Set(pairs.filter((p) => judgements[p.key]?.verdict === 'apply').flatMap((p) => p.where.map((w) => readWhere(w).who.split('/')[0])))
const afterSure = new Set(pairs.filter((p) => judgements[p.key]?.verdict === 'apply' && !judgements[p.key].unsure).flatMap((p) => p.where.map((w) => readWhere(w).who.split('/')[0])))
console.log(`命中幹員:目前 ${before.size} 位;照建議 ${after.size} 位(拿不準的全判空類型則 ${afterSure.size} 位)`)
console.log(`覆寫檔裡已不在資料中的配對 ${stale.length} 筆${stale.length ? ':' + stale.join(' ') : ''}`)
console.log(`已知疑似漏標 ${known.length} 則(仍報出 ${known.filter((k) => suspects.has(k)).length})`)
if (process.argv.includes('--dump'))
  for (const p of pairs) {
    const w = p.where.map(readWhere)
    console.log(`${p.key.split(':')[0]}\t${[...new Set(w.map((x) => x.who))].join('、')}\t${w.map((x) => x.source).join(';')}\t${w[0].server}\t${p.text}`)
  }
if (process.argv.includes('--dump-suspects'))
  for (const key of known) {
    const s = suspects.get(key)
    console.log(`${key}\t${s ? s.operators.map((id) => names.get(id)).join('、') + '\t' + s.where : '(不再報)'}`)
  }
