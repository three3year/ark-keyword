import { describe, expect, test } from 'vitest'
import { type BuildInput, buildIndex } from '../build/buildIndex'
import { basicSkill, COMMON_TERMS, operator, server } from './fixtures'

function oneSkillPerOperator(descriptions: Record<string, string>, terms = COMMON_TERMS) {
  const ids = Object.keys(descriptions)
  const operators = Object.fromEntries(ids.map((id, i) => [id, operator({ name: `幹員${i}`, skills: [`sk_${i}`] })]))
  const skills = Object.values(descriptions).map((d, i) => basicSkill(`sk_${i}`, `技${i}`, { description: d }))
  return server({ terms, operators, skills })
}

function suspectsOf(input: BuildInput) {
  return buildIndex(input).suspects
}

describe('漏標稽核:術語', () => {
  test('純文字的術語名稱、整段沒標到該術語,列為疑似漏標', () => {
    expect(suspectsOf({ cn: oneSkillPerOperator({ char_001_a: '攻击使敌人晕眩2秒' }) })).toEqual([
      {
        key: 'cn ba.stun 攻击使敌人晕眩#秒',
        server: 'cn',
        keyword: 'ba.stun',
        context: '攻击使敌人晕眩#秒',
        seed: '晕眩',
        operators: ['char_001_a'],
        where: 'char_001_a 技能1 max',
      },
    ])
  })

  test('整段已標過該術語,重複出現處沒標的不列出', () => {
    expect(suspectsOf({ cn: oneSkillPerOperator({ char_001_a: '使敌人<$ba.stun>晕眩</>，晕眩结束后攻击力下降' }) })).toEqual([])
  })

  const DAMAGE_TERMS: Record<string, [string, string]> = {
    'ba.dt.apoptosis': ['凋亡损伤', '敌方的凋亡损伤'],
    'ba.dt.apoptosis2': ['凋亡损伤·我方', '我方的凋亡损伤'],
  }

  test('整段已標過同名的「·我方」術語,不列出', () => {
    const cn = oneSkillPerOperator({ char_001_a: '受到<$ba.dt.apoptosis2>凋亡损伤</>时，凋亡损伤累积提升' }, DAMAGE_TERMS)
    expect(suspectsOf({ cn })).toEqual([])
  })

  test('同名術語的同一處漏標只列一則,記在不帶 2 的 id 名下', () => {
    const cn = oneSkillPerOperator({ char_001_a: '攻击造成凋亡损伤' }, DAMAGE_TERMS)
    expect(suspectsOf({ cn }).map((s) => [s.keyword, s.context])).toEqual([['ba.dt.apoptosis', '攻击造成凋亡损伤']])
  })

  test('術語名稱去掉「·我方」後綴再掃', () => {
    const cn = oneSkillPerOperator({ char_001_a: '攻击造成凋亡损伤' }, { 'ba.dt.apoptosis2': DAMAGE_TERMS['ba.dt.apoptosis2'] })
    expect(suspectsOf({ cn }).map((s) => [s.keyword, s.seed])).toEqual([['ba.dt.apoptosis2', '凋亡损伤']])
  })

  test('非戰鬥術語與不當關鍵字的術語不掃', () => {
    const terms: Record<string, [string, string]> = { 'cc.room': ['制造站', '基建設施'], 'ba.binding': ['绑定', '與另一單位綁定'] }
    const cn = oneSkillPerOperator({ char_001_a: '与制造站绑定' }, terms)
    expect(suspectsOf({ cn, excludedTerms: ['ba.binding'] })).toEqual([])
  })

  test('種子字落在其他關鍵字的標記內,不列出', () => {
    const terms = { ...COMMON_TERMS, 'ba.fragile': ['脆弱', '受到的傷害提升'] as [string, string] }
    const cn = oneSkillPerOperator({ char_001_a: '使敌人<$ba.magicfragile>法术脆弱</>' }, terms)
    expect(suspectsOf({ cn })).toEqual([])
  })

  test('台服文字用台服的術語名稱掃', () => {
    const cn = oneSkillPerOperator({ char_001_a: '攻击使敌人<$ba.stun>晕眩</>' })
    const tw = oneSkillPerOperator({ char_001_a: '攻擊使敵人暈眩' }, { 'ba.stun': ['暈眩', '無法行動'] })
    expect(suspectsOf({ cn, tw }).map((s) => s.key)).toEqual(['tw ba.stun 攻擊使敵人暈眩'])
  })

  test('數字不同的同一種前後文合成一則,涉及的幹員全部列出', () => {
    const cn = oneSkillPerOperator({ char_001_a: '攻击使敌人晕眩1.5秒', char_002_b: '攻击使敌人晕眩3秒', char_003_c: '攻击使敌人晕眩10%' })
    const suspects = suspectsOf({ cn })
    expect(suspects.map((s) => [s.context, s.operators, s.where])).toEqual([
      ['攻击使敌人晕眩#秒', ['char_001_a', 'char_002_b'], 'char_001_a 技能1 max'],
      ['攻击使敌人晕眩#', ['char_003_c'], 'char_003_c 技能1 max'],
    ])
  })

  test('前後文取命中處前後各 8 個字,換行換成「⏎」', () => {
    const cn = oneSkillPerOperator({ char_001_a: '第一行很长的文字叙述\n攻击使敌人晕眩并且之后的文字很长很长' })
    expect(suspectsOf({ cn }).map((s) => s.context)).toEqual(['叙述⏎攻击使敌人晕眩并且之后的文字很'])
  })
})

describe('漏標稽核:補充關鍵字', () => {
  const supplements = [{ id: 'knockback', name: '推', cn: ['推开'], tw: ['推開'], definition: '推' }]

  test('種子字沒被標到,列為疑似漏標', () => {
    const cn = oneSkillPerOperator({ char_001_a: '将敌人向后推动一段距离', char_002_b: '将敌人推开' })
    expect(suspectsOf({ cn, supplements, auditSeeds: { knockback: ['推'] } })).toEqual([
      {
        key: 'cn sup.knockback 将敌人向后推动一段距离',
        server: 'cn',
        keyword: 'sup.knockback',
        context: '将敌人向后推动一段距离',
        seed: '推',
        operators: ['char_001_a'],
        where: 'char_001_a 技能1 max',
      },
    ])
  })

  test.each([
    ['沒寫種子字', {}],
    ['種子字是空的', { knockback: [] }],
  ])('%s時發建置警告,也不掃', (_, auditSeeds) => {
    const cn = oneSkillPerOperator({ char_001_a: '将敌人向后推动' })
    const { warnings, suspects } = buildIndex({ cn, supplements, auditSeeds })
    expect(warnings).toEqual(['補充關鍵字 knockback 沒有稽核種子字'])
    expect(suspects).toEqual([])
  })

  test('種子字清單有不存在的補充關鍵字時發建置警告', () => {
    const cn = oneSkillPerOperator({ char_001_a: '攻击力提升' })
    const { warnings } = buildIndex({ cn, supplements, auditSeeds: { knockback: ['推'], pull: ['拉'] } })
    expect(warnings).toEqual(['稽核種子字清單的 pull 不是補充關鍵字'])
  })
})
