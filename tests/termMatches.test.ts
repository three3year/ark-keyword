import { describe, expect, test } from 'vitest'
import { type TermMatch, buildIndex } from '../build/buildIndex'
import { query } from '../src/core/query'
import { applying, COMMON_TERMS, basicSkill, highlights, operator, overrideKeyOf, plain, server } from './fixtures'

const termMatches: TermMatch[] = [
  { id: 'ba.stun', cn: ['晕眩'], tw: ['暈眩'] },
  { id: 'ba.frozen', cn: ['冻结'], tw: ['凍結'] },
]

function fixture(descriptions: Record<string, string>) {
  const operators = Object.fromEntries(Object.keys(descriptions).map((name, i) => [`char_800_${i}`, operator({ name, skills: [`sk_${i}`] })]))
  const skills = Object.values(descriptions).map((d, i) => basicSkill(`sk_${i}`, `技${i}`, { description: d }))
  return server({ terms: COMMON_TERMS, operators, skills })
}

describe('術語補標', () => {
  test('純文字的術語名稱被補標成該術語,查得到並高亮', () => {
    const { index } = buildIndex({ cn: fixture({ 漏標者: '攻击使敌人晕眩2秒', 無關者: '攻击力提升' }), termMatches })
    const results = query(index, { conditions: applying('ba.stun'), server: 'cn' })
    expect(results.map((r) => r.name)).toEqual(['漏標者'])
    const runs = results[0].entries[0].stages[0].runs
    expect(plain(runs)).toBe('攻击使敌人晕眩2秒')
    expect(highlights(runs)).toEqual([['晕眩', 'ba.stun']])
  })

  describe('台服沒標、陸服有標', () => {
    const input = {
      cn: fixture({ 甲: '攻击使敌人<$ba.stun>晕眩</>2秒' }),
      tw: fixture({ 甲: '攻擊使敵人暈眩2秒' }),
      termMatches,
      overrides: {},
    }

    test('台服模式也找得到,並沿用陸服的效果類型', () => {
      const [r] = query(buildIndex(input).index, { conditions: applying('ba.stun'), server: 'tw' })
      expect(r.name).toBe('甲')
      expect(highlights(r.entries[0].stages[0].runs)).toEqual([['暈眩', 'ba.stun']])
    })

    test('補標後兩服一致,台服沿用陸服判定,不另列待複核', () => {
      expect(buildIndex(input).pending.map((p) => p.text)).toEqual(['攻击使敌人晕眩2秒'])
    })
  })

  test('已有官方標記的敘述裡,重複出現的同名術語也被標', () => {
    const { index } = buildIndex({ cn: fixture({ 甲: '使敌人<$ba.stun>晕眩</>，晕眩结束后再次晕眩' }), termMatches })
    const [r] = query(index, { conditions: applying('ba.stun'), server: 'cn' })
    expect(highlights(r.entries[0].stages[0].runs)).toEqual([
      ['晕眩', 'ba.stun'],
      ['晕眩', 'ba.stun'],
      ['晕眩', 'ba.stun'],
    ])
  })

  test('新命中的配對列入待複核清單,補標後兩服仍不一致的,台服另列', () => {
    const { pending } = buildIndex({
      cn: fixture({ 甲: '使敌人晕眩2秒' }),
      tw: fixture({ 甲: '使敵人暈眩3秒' }),
      termMatches,
    })
    expect(pending.map((p) => [p.keyword, p.text, p.ruleTypes])).toEqual([
      ['ba.stun', '使敌人晕眩2秒', ['apply']],
      ['ba.stun', '使敵人暈眩3秒', ['apply']],
    ])
  })

  describe('台服只因少標而與陸服不一致的敘述', () => {
    const cn = fixture({ 甲: '攻击<$ba.stun>晕眩</>的敌人时伤害提升' })
    const tw = fixture({ 甲: '攻擊暈眩的敵人時傷害提升' })
    const twKey = overrideKeyOf(fixture({ 甲: '攻擊<$ba.stun>暈眩</>的敵人時傷害提升' }))

    test('補標後台服沿用陸服的效果類型', () => {
      const { index, warnings } = buildIndex({ cn, tw, termMatches })
      expect(warnings).toEqual([])
      const exploit = query(index, { conditions: [{ keyword: 'ba.stun', type: 'exploit' }], server: 'tw' })
      expect(exploit.map((r) => plain(r.entries[0].stages[0].runs))).toEqual(['攻擊暈眩的敵人時傷害提升'])
    })

    test('台服原有覆寫判定與陸服不同時發建置警告,相同時不發', () => {
      const differs = buildIndex({ cn, tw, termMatches, overrides: { [twKey]: { types: ['apply'], reviewed: true } } })
      expect(differs.warnings).toEqual(['幹員 char_800_0 技能1 max:台服與陸服文字一致,沿用陸服判定;ba.stun 的台服覆寫判定(施加)與陸服(利用)不同'])
      const same = buildIndex({ cn, tw, termMatches, overrides: { [twKey]: { types: ['exploit'], reviewed: true } } })
      expect(same.warnings).toEqual([])
    })
  })

  describe('同字的較長術語', () => {
    const fragile: TermMatch[] = [
      { id: 'ba.fragile', cn: ['脆弱'], tw: ['脆弱'] },
      { id: 'ba.magicfragile', cn: ['法术脆弱'], tw: ['法術脆弱'] },
    ]
    const terms = { ...COMMON_TERMS, 'ba.fragile': ['脆弱', '受到的伤害提升'] as [string, string] }
    function build(description: string) {
      const raw = fixture({ 甲: description })
      raw.gamedataConst.termDescriptionDict = server({ terms, operators: {} }).gamedataConst.termDescriptionDict
      return buildIndex({ cn: raw, termMatches: fragile })
    }

    test('較長的術語(法術脆弱)優先,不被標成脆弱', () => {
      const { index } = build('使敌人法术脆弱')
      expect(query(index, { conditions: applying('ba.fragile'), server: 'cn' })).toEqual([])
      const [r] = query(index, { conditions: applying('ba.magicfragile'), server: 'cn' })
      expect(highlights(r.entries[0].stages[0].runs)).toEqual([['法术脆弱', 'ba.magicfragile']])
    })

    test('已有官方標記的字不重複標', () => {
      const { index } = build('使敌人<$ba.magicfragile>法术脆弱</>')
      expect(query(index, { conditions: applying('ba.fragile'), server: 'cn' })).toEqual([])
      const [r] = query(index, { conditions: applying('ba.magicfragile'), server: 'cn' })
      expect(highlights(r.entries[0].stages[0].runs)).toEqual([['法术脆弱', 'ba.magicfragile']])
    })
  })

  test.each([
    ['不存在的術語', 'ba.nosuchterm'],
    ['非戰鬥術語', 'cc.bd_a1'],
    ['不當關鍵字的術語', 'ba.binding'],
  ])('清單裡寫錯的 id(%s)產生建置警告,而且沒有被補標', (_, id) => {
    const raw = fixture({ 甲: '使敌人倒计时' })
    raw.gamedataConst.termDescriptionDict['cc.bd_a1'] = { termId: 'cc.bd_a1', termName: '倒计时', description: '基建' }
    raw.gamedataConst.termDescriptionDict['ba.binding'] = { termId: 'ba.binding', termName: '倒计时', description: '绑定' }
    const { index, warnings } = buildIndex({ cn: raw, termMatches: [{ id, cn: ['倒计时'], tw: ['倒計時'] }], excludedTerms: ['ba.binding'] })
    expect(warnings).toEqual([`術語比對清單的 ${id} 不是會成為關鍵字的戰鬥術語,不比對`])
    expect(index.operators.flatMap((o) => o.entries)).toEqual([])
  })
})
