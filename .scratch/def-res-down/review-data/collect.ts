import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildIndex, type Overrides } from '../../../build/buildIndex'
import { loadBuildInput, readData, readJson } from '../../../build/input'
import { query } from '../../../src/core/query'

const HERE = import.meta.dirname
const KEYWORD = process.argv[2] ?? 'sup.resdown'
const OUT = process.argv[3] ?? 'resdown'

const input = await loadBuildInput()
const { overrides, supplements } = input
const build = buildIndex(input)
const pairs = build.pending.filter((p) => p.keyword === KEYWORD)

const names = new Map<string, string>()
const moduleCodes = new Map<string, string>()
for (const op of build.operatorFiles) {
  const name = build.index.operators.find((o) => o.id === op.id)?.name ?? op.id
  names.set(op.id, name)
  for (const s of op.summons ?? []) names.set(s.id, `${name}/${s.name}`)
  for (const m of op.modules ?? []) moduleCodes.set(m.id, m.code)
}
function readWhere(where: string): { who: string; source: string; server: 'cn' | 'tw' } {
  const server = where.endsWith('(台服)') ? 'tw' : 'cn'
  const [id, ...rest] = where.replace('(台服)', '').split(' ')
  const source = rest.join(' ').replace(/模組3 (\S+)/, (_, m: string) => `模組 ${moduleCodes.get(m) ?? m}`)
  return { who: names.get(id) ?? id, source, server }
}

const matchStrings = (server: 'cn' | 'tw') => supplements.find((s) => `sup.${s.id}` === KEYWORD)![server]
const marksIn = (text: string, server: 'cn' | 'tw') => matchStrings(server).filter((m) => text.includes(m))
const serverLabel = { cn: '陸服', tw: '台服' }

interface Judgement {
  verdict: 'apply' | 'empty'
  unsure?: boolean
  reason: string
}
const judgements = await readJson<Record<string, Judgement>>(join(HERE, `${OUT}-judgements.json`))
const verdictLabel = (j: Judgement) => `${j.verdict === 'apply' ? '施加' : '空類型'}${j.unsure ? '(拿不準)' : ''}`

const pairRows = pairs
  .map((p) => {
    const places = p.where.map(readWhere)
    const server = places[0].server
    const j = judgements[p.key]
    return {
      sortKey: `${places[0].who}\u0000${places[0].source}`,
      cells: [
        p.key.split(':')[0],
        [...new Set(places.map((w) => w.who))].join('、'),
        places.map((w) => w.source).join(';'),
        serverLabel[server],
        { text: p.text, marks: marksIn(p.text, server) },
        p.ruleTypes.length ? '施加' : '空類型',
        j ? verdictLabel(j) : null,
        j?.reason ?? null,
      ],
    }
  })
  .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'zh-Hant'))
  .map(({ cells }) => ({ cells }))

const table = (columns: [string, string][], key: string, rows: unknown[]) =>
  JSON.stringify({ columns: columns.map(([name, type]) => ({ name, type })), key, rows }, null, 1) + '\n'

writeFileSync(
  join(HERE, `${OUT}-pairs.json`),
  table(
    [['配對', 'text'], ['幹員', 'text'], ['出處', 'text'], ['伺服器', 'text'], ['原文', 'quote'], ['規則判定', 'text'], ['建議判定', 'text'], ['理由', 'text']],
    '配對',
    pairRows,
  ),
)

const known = new Set(await readData<string[]>('known-suspects'))
const newSuspects = build.suspects.filter((s) => s.keyword === KEYWORD && !known.has(s.key))
const suspectJudgements = await readJson<Record<string, { verdict: 'miss' | 'gap'; reason: string; add?: string }>>(join(HERE, `${OUT}-suspect-judgements.json`))
const SUSPECT_VERDICT = { miss: '誤中,接受', gap: '漏標,補比對字串' }
const suspectRows = newSuspects.map((s) => {
  const j = suspectJudgements[s.key]
  const context = s.key.split(' ').slice(2).join(' ')
  return {
    cells: [
      s.key,
      s.operators.map((id) => names.get(id) ?? id).join('、'),
      readWhere(s.where).source,
      serverLabel[s.server],
      { text: context, marks: context.includes(s.seed) ? [s.seed] : [] },
      j ? SUSPECT_VERDICT[j.verdict] + (j.add ? `「${j.add}」` : '') : null,
      j?.reason ?? null,
    ],
  }
})
writeFileSync(
  join(HERE, `${OUT}-suspects.json`),
  table(
    [['條目', 'text'], ['幹員', 'text'], ['出處', 'text'], ['伺服器', 'text'], ['前後文', 'quote'], ['建議', 'text'], ['理由', 'text']],
    '條目',
    suspectRows,
  ),
)

const reviewed: Overrides = {
  ...overrides,
  ...Object.fromEntries(Object.entries(judgements).map(([k, j]) => [k, { types: j.verdict === 'apply' ? ['apply' as const] : [], reviewed: true }])),
}
const after = buildIndex({ ...input, overrides: reviewed })
const hitsOn = (server: 'cn' | 'tw') => query(after.index, { conditions: [{ keyword: KEYWORD, type: 'apply' }], server }).map((r) => r.name)
const hits = { cn: hitsOn('cn'), tw: hitsOn('tw') }
const everyone = [...new Set([...hits.cn, ...hits.tw])]
writeFileSync(
  join(HERE, `${OUT}-operators.json`),
  table(
    [['幹員', 'text'], ['陸服', 'text'], ['台服', 'text']],
    '幹員',
    everyone.map((name) => ({ cells: [name, hits.cn.includes(name) ? '命中' : '—', hits.tw.includes(name) ? '命中' : '—'] })),
  ),
)

const count = (pred: (j: Judgement) => boolean) => pairs.filter((p) => judgements[p.key] && pred(judgements[p.key])).length
const bySrv = (srv: 'cn' | 'tw') => newSuspects.filter((s) => s.server === srv).length
console.log(`待複核配對 ${pairs.length} 筆(全部 ${build.pending.length} 筆)`)
console.log(`建議:施加 ${count((j) => j.verdict === 'apply' && !j.unsure)}、空類型 ${count((j) => j.verdict === 'empty' && !j.unsure)}、拿不準 ${count((j) => !!j.unsure)}、未判 ${pairs.filter((p) => !judgements[p.key]).length}`)
console.log(`新疑似漏標 ${newSuspects.length} 則(陸服 ${bySrv('cn')}、台服 ${bySrv('tw')});漏標 ${newSuspects.filter((s) => suspectJudgements[s.key]?.verdict === 'gap').length}、未判 ${newSuspects.filter((s) => !suspectJudgements[s.key]).length}`)
console.log(`照建議寫入後命中幹員:陸服 ${hits.cn.length} 位、台服 ${hits.tw.length} 位`)
console.log(`陸服:${hits.cn.join('、')}`)
console.log(`台服:${hits.tw.join('、')}`)
