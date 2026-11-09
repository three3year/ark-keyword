import { describe, expect, test } from 'vitest'
import { buildIndex } from '../build/buildIndex'
import { diffKnown } from '../build/known'
import { query } from '../src/core/query'
import { applying, COMMON_TERMS, basicSkill, highlights, operator, plain, server } from './fixtures'

const CN_TERMS: Record<string, [string, string]> = {
  ...COMMON_TERMS,
  'ba.dt.apoptosis': ['凋亡损伤', '敌人的凋亡损伤'],
  'ba.dt.apoptosis2': ['凋亡损伤·我方', '我方的凋亡损伤'],
}

const TW_TERMS: Record<string, [string, string]> = {
  'ba.cold': ['寒冷', '攻擊速度下降'],
  'ba.stun': ['暈眩', '無法移動、阻擋、攻擊及使用技能'],
  'ba.dt.apoptosis': ['凋亡損傷', '敵人的凋亡損傷'],
  'ba.dt.apoptosis2': ['凋亡損傷·我方', '我方的凋亡損傷'],
}

function fixture(terms: Record<string, [string, string]>, descriptions: Record<string, string>) {
  const operators = Object.fromEntries(Object.keys(descriptions).map((name, i) => [`char_810_${i}`, operator({ name, skills: [`sk_${i}`] })]))
  const skills = Object.values(descriptions).map((d, i) => basicSkill(`sk_${i}`, `技${i}`, { description: d }))
  return server({ terms, operators, skills })
}

function build(cn: Record<string, string>, tw: Record<string, string>) {
  return buildIndex({ cn: fixture(CN_TERMS, cn), tw: fixture(TW_TERMS, tw), overrides: {} })
}

describe('照陸服補標台服術語', () => {
  test('陸服有標、台服純文字有該術語的台服名稱:台服模式查得到,該字高亮成陸服的 id', () => {
    const { index } = build({ 甲: '攻击使敌人<$ba.stun>晕眩</>2秒' }, { 甲: '攻擊使敵人暈眩2秒' })
    const [r] = query(index, { conditions: applying('ba.stun'), server: 'tw' })
    expect(r.name).toBe('甲')
    const runs = r.entries[0].stages[0].runs
    expect(plain(runs)).toBe('攻擊使敵人暈眩2秒')
    expect(highlights(runs)).toEqual([['暈眩', 'ba.stun']])
  })

  test('同名術語:陸服標我方版的,台服標成我方版;陸服標敵方版的,台服標成敵方版', () => {
    const { index } = build(
      { 我方: '攻击使目标受到<$ba.dt.apoptosis2>凋亡损伤</>', 敵方: '攻击使目标受到<$ba.dt.apoptosis>凋亡损伤</>' },
      { 我方: '攻擊使目標受到凋亡損傷', 敵方: '攻擊使目標受到凋亡損傷' },
    )
    const found = (keyword: string) =>
      query(index, { conditions: applying(keyword), server: 'tw' }).map((r) => [r.name, highlights(r.entries[0].stages[0].runs)])
    expect(found('ba.dt.apoptosis2')).toEqual([['我方', [['凋亡損傷', 'ba.dt.apoptosis2']]]])
    expect(found('ba.dt.apoptosis')).toEqual([['敵方', [['凋亡損傷', 'ba.dt.apoptosis']]]])
  })

  test('同一段台服文字裡同一個名稱出現多次,全部標上', () => {
    const { index } = build({ 甲: '使敌人<$ba.stun>晕眩</>，晕眩结束后再次晕眩' }, { 甲: '使敵人暈眩，暈眩結束後再次暈眩' })
    const [r] = query(index, { conditions: applying('ba.stun'), server: 'tw' })
    expect(highlights(r.entries[0].stages[0].runs)).toEqual([
      ['暈眩', 'ba.stun'],
      ['暈眩', 'ba.stun'],
      ['暈眩', 'ba.stun'],
    ])
  })

  test('同一個台服名稱對到陸服兩個不同 id:不標,發建置警告', () => {
    const { index, warnings } = build(
      { 甲: '我方<$ba.dt.apoptosis2>凋亡损伤</>时使敌人受到<$ba.dt.apoptosis>凋亡损伤</>' },
      { 甲: '我方凋亡損傷時使敵人受到凋亡損傷' },
    )
    expect(query(index, { conditions: applying('ba.dt.apoptosis', 'ba.dt.apoptosis2'), server: 'tw' })).toEqual([])
    expect(warnings).toEqual(['幹員 char_810_0 技能1 max:台服名稱「凋亡損傷」對到陸服的 ba.dt.apoptosis 與 ba.dt.apoptosis2,不照陸服補標'])
  })

  test.each([
    ['用詞不同', '攻击使敌人<$ba.stun>晕眩</>2秒', '攻擊使敵人昏迷2秒', 'ba.stun', '幹員 char_810_0 技能1 max:陸服標了 ba.stun,台服文字找不到它的台服名稱「暈眩」'],
    ['台服資料沒有這個術語', '攻击使敌人<$ba.levitate>浮空</>2秒', '攻擊使敵人浮空2秒', 'ba.levitate', '幹員 char_810_0 技能1 max:陸服標了 ba.levitate,台服資料沒有這個術語'],
  ])('台服文字找不到該名稱(%s):不標,發建置警告', (_, cn, tw, keyword, warning) => {
    const { index, warnings } = build({ 甲: cn }, { 甲: tw })
    expect(query(index, { conditions: applying(keyword), server: 'tw' })).toEqual([])
    expect(warnings).toEqual([warning])
  })

  test('兩種警告都能收進已知警告清單', () => {
    const descriptions = {
      cn: { 甲: '我方<$ba.dt.apoptosis2>凋亡损伤</>时使敌人受到<$ba.dt.apoptosis>凋亡损伤</>', 乙: '攻击使敌人<$ba.stun>晕眩</>2秒' },
      tw: { 甲: '我方凋亡損傷時使敵人受到凋亡損傷', 乙: '攻擊使敵人昏迷2秒' },
    }
    const known = build(descriptions.cn, descriptions.tw).warnings
    expect(known).toHaveLength(2)
    expect(diffKnown(build(descriptions.cn, descriptions.tw).warnings, known)).toEqual({ added: [], resolved: [] })
  })

  test('照陸服補標找不到、但術語比對清單補上了:不發警告', () => {
    const { index, warnings } = buildIndex({
      cn: fixture(CN_TERMS, { 甲: '攻击使敌人<$ba.stun>晕眩</>2秒' }),
      tw: fixture(TW_TERMS, { 甲: '攻擊使敵人昏迷2秒' }),
      termMatches: [{ id: 'ba.stun', cn: ['晕眩'], tw: ['昏迷'] }],
    })
    expect(warnings).toEqual([])
    const [r] = query(index, { conditions: applying('ba.stun'), server: 'tw' })
    expect(highlights(r.entries[0].stages[0].runs)).toEqual([['昏迷', 'ba.stun']])
  })

  test('只由術語比對清單補上、陸服沒有官方標記的術語:不照陸服補,台服高亮範圍照比對清單', () => {
    const { index, warnings } = buildIndex({
      cn: fixture(CN_TERMS, { 甲: '攻击使敌人晕眩2秒' }),
      tw: fixture(TW_TERMS, { 甲: '攻擊使敵人暈眩2秒' }),
      termMatches: [{ id: 'ba.stun', cn: ['晕眩'], tw: [] }],
    })
    expect(warnings).toEqual([])
    expect(query(index, { conditions: applying('ba.stun'), server: 'cn' }).map((r) => r.name)).toEqual(['甲'])
    expect(query(index, { conditions: applying('ba.stun'), server: 'tw' })).toEqual([])
  })

  describe('補完後兩服一致', () => {
    const descriptions = { cn: { 甲: '攻击<$ba.stun>晕眩</>的敌人时伤害提升' }, tw: { 甲: '攻擊暈眩的敵人時傷害提升' } }

    test('台服沿用陸服的效果類型', () => {
      const { index, warnings } = build(descriptions.cn, descriptions.tw)
      expect(warnings).toEqual([])
      const exploit = query(index, { conditions: [{ keyword: 'ba.stun', type: 'exploit' }], server: 'tw' })
      expect(exploit.map((r) => plain(r.entries[0].stages[0].runs))).toEqual(['攻擊暈眩的敵人時傷害提升'])
    })

    test('台服的配對不另列待複核', () => {
      expect(build(descriptions.cn, descriptions.tw).pending.map((p) => p.text)).toEqual(['攻击晕眩的敌人时伤害提升'])
    })

    test('陸服模式顯示台服文字', () => {
      const [r] = query(build(descriptions.cn, descriptions.tw).index, { conditions: [{ keyword: 'ba.stun', type: 'exploit' }], server: 'cn' })
      const runs = r.entries[0].stages[0].runs
      expect(plain(runs)).toBe('攻擊暈眩的敵人時傷害提升')
      expect(highlights(runs)).toEqual([['暈眩', 'ba.stun']])
    })
  })
})
