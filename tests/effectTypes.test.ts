import { describe, expect, test } from 'vitest'
import { type Overrides, buildIndex } from '../build/buildIndex'
import { availableTypes, defaultType, query } from '../src/core/query'
import { EFFECT_TYPES, type EffectType, type SearchIndex, type Server } from '../src/core/types'
import { COMMON_TERMS, basicSkill, operator, server } from './fixtures'

const DODGE = { id: 'dodge', name: '閃避', cn: ['闪避'], tw: ['閃避'], definition: '使攻擊無效' }
const PULL = { id: 'pull', name: '拉', cn: ['拖拽'], tw: ['拖拽'], definition: '把敵人拉近' }

/** 每位幹員一個技能,技能敘述由參數給定。 */
function fixture(descriptions: Record<string, string>) {
  const operators = Object.fromEntries(
    Object.keys(descriptions).map((name, i) => [`char_${400 + i}_x`, operator({ name, skills: [`sk_${i}`] })]),
  )
  const skills = Object.values(descriptions).map((d, i) => basicSkill(`sk_${i}`, `技${i}`, { description: d }))
  return server({
    terms: {
      ...COMMON_TERMS,
      'ba.inspire': ['鼓舞', '攻击力提升'],
      'ba.sleep': ['沉睡', '无法行动'],
      'ba.invisible': ['隐匿', '不会成为目标'],
      'ba.root': ['束缚', '无法移动'],
      'ba.debuff': ['异常状态', '负面效果'],
      'ba.dt.element': ['元素损伤', '元素伤害'],
    },
    operators,
    skills,
  })
}

/** 以哪些效果類型搭配這個關鍵字當搜尋條件時,找得到索引裡唯一的幹員。 */
function typesFound(index: SearchIndex, keyword: string, server: Server = 'cn'): EffectType[] {
  return EFFECT_TYPES.filter((type) => query(index, { conditions: [{ keyword, type }], server }).length > 0)
}

function effectOf(description: string, keyword: string): EffectType[] {
  return typesFound(buildIndex({ cn: fixture({ 甲: description }), supplements: [DODGE, PULL] }).index, keyword)
}

function results(index: SearchIndex, conditions: [EffectType, string][]) {
  return query(index, { conditions: conditions.map(([type, keyword]) => ({ keyword, type })), server: 'cn' })
}

function names(index: SearchIndex, conditions: [EffectType, string][]): string[] {
  return results(index, conditions).map((r) => r.name)
}

describe('效果類型的規則判定', () => {
  test.each([
    ['攻击使敌人<$ba.cold>寒冷</>3秒', 'ba.cold', ['apply']],
    ['对周围敌人造成伤害并使其陷入<$ba.stun>晕眩</>', 'ba.stun', ['apply']],
    ['范围内友方单位获得<$ba.inspire>鼓舞</>', 'ba.inspire', ['apply']],
    ['对<$ba.cold>寒冷</>状态的敌人造成的伤害提升30%', 'ba.cold', ['exploit']],
    ['攻击处于<$ba.levitate>浮空</>的敌人时攻击力提升', 'ba.levitate', ['exploit']],
    ['成功闪避后自身下一次攻击攻击力+100%', 'sup.dodge', ['exploit']],
    ['自身有23%的概率<$ba.stun>晕眩</>敌人0.7秒', 'ba.stun', ['apply']],
    ['使敌人陷入<$ba.sleep>沉睡</>后攻击力提升', 'ba.sleep', ['apply', 'exploit']],
    ['自身免疫<$ba.stun>晕眩</>', 'ba.stun', ['counter']],
    ['技能期间不会被<$ba.frozen>冻结</>', 'ba.frozen', ['counter']],
    ['攻击范围内敌人的<$ba.invisible>隐匿</>效果失效', 'ba.invisible', ['counter']],
    ['攻击无视目标的物理闪避', 'sup.dodge', ['counter']],
    ['使敌人<$ba.sleep>沉睡</>，攻击<$ba.sleep>沉睡</>的目标时攻击力提升', 'ba.sleep', ['apply', 'exploit']],
    ['技能可以使敌人产生位移\n拖拽期间敌人受到正比于距离的法术伤害', 'sup.pull', ['exploit']],
    ['使目标<$ba.root>束缚</>3秒，该次<$ba.root>束缚</>期间目标受到的神经损伤提升', 'ba.root', ['apply', 'exploit']],
    ['处于<$ba.debuff>异常状态</>时可以释放技能并清除<$ba.debuff>异常状态</>', 'ba.debuff', ['exploit', 'counter']],
    ['立刻清除自身的<$ba.dt.element>元素损伤</>', 'ba.dt.element', ['counter']],
  ])('%s → %s 為 %j', (description, keyword, expected) => {
    expect(effectOf(description, keyword)).toEqual(expected)
  })

  test.each([
    ['成功闪避后自身下一次攻击攻击力+100%', '成功閃避後自身下一次攻擊攻擊力+120%', 'sup.dodge', ['exploit']],
    ['攻击范围扩大并使敌人<$ba.invisible>隐匿</>失效1', '攻擊範圍擴大並使敵人<$ba.invisible>隱匿</>失效2', 'ba.invisible', ['counter']],
    ['自身免疫<$ba.stun>晕眩</>1', '自身免疫<$ba.stun>暈眩</>2', 'ba.stun', ['counter']],
    ['拖拽期间敌人受到1倍伤害', '拖拽期間敵人受到2倍傷害', 'sup.pull', ['exploit']],
    [
      '使目标<$ba.root>束缚</>3秒，该次<$ba.root>束缚</>期间伤害提升1',
      '使目標<$ba.root>束縛</>3秒，該次<$ba.root>束縛</>期間傷害提升2',
      'ba.root',
      ['apply', 'exploit'],
    ],
    [
      '处于<$ba.debuff>异常状态</>时可以释放技能并清除<$ba.debuff>异常状态</>1',
      '處於<$ba.debuff>異常狀態</>時可以釋放技能並清除<$ba.debuff>異常狀態</>2',
      'ba.debuff',
      ['exploit', 'counter'],
    ],
    ['立刻清除自身的<$ba.dt.element>元素损伤</>1', '立刻清除自身的<$ba.dt.element>元素損傷</>2', 'ba.dt.element', ['counter']],
  ])('繁中(台服文字與陸服不一致時各自判定):%s → %s', (cnText, twText, keyword, expected) => {
    const { index } = buildIndex({ cn: fixture({ 甲: cnText }), tw: fixture({ 甲: twText }), supplements: [DODGE, PULL] })
    expect(typesFound(index, keyword, 'tw')).toEqual(expected)
  })

  test('句型判定不出、又不在覆寫檔的配對不會成為命中敘述,並列入待複核清單', () => {
    const cn = fixture({ 甲: '场上存在<$ba.cold>寒冷</>相关的效果时攻击力提升' })
    const { index, pending } = buildIndex({ cn })
    expect(typesFound(index, 'ba.cold')).toEqual([])
    expect(pending.map((p) => [p.keyword, p.ruleTypes])).toEqual([['ba.cold', []]])
  })
})

describe('搜尋條件', () => {
  const cn = fixture({
    施加者: '攻击使敌人<$ba.cold>寒冷</>',
    利用者: '对<$ba.cold>寒冷</>状态的敌人伤害提升',
    反制者: '免疫<$ba.cold>寒冷</>',
    施加又利用: '使敌人<$ba.cold>寒冷</>，对<$ba.cold>寒冷</>的敌人伤害提升',
  })

  test('一個搜尋條件只列出該效果類型;一段多類型的敘述在每種類型下都找得到', () => {
    const { index } = buildIndex({ cn })
    expect(names(index, [['apply', 'ba.cold']])).toEqual(['施加者', '施加又利用'])
    expect(names(index, [['exploit', 'ba.cold']])).toEqual(['利用者', '施加又利用'])
    expect(names(index, [['counter', 'ba.cold']])).toEqual(['反制者'])
  })

  test('同一關鍵字的施加-X OR 利用-X:只施加或只利用的幹員都列入,每段命中敘述只標出它符合的條件', () => {
    const operators = {
      char_401_a: operator({ name: '分兩段', skills: ['sk_a', 'sk_b'] }),
      char_402_b: operator({ name: '只施加', skills: ['sk_a'] }),
      char_403_c: operator({ name: '只利用', skills: ['sk_b'] }),
      char_404_d: operator({ name: '都沒有', skills: ['sk_c'] }),
    }
    const skills = [
      basicSkill('sk_a', '甲', { description: '使敌人<$ba.cold>寒冷</>' }),
      basicSkill('sk_b', '乙', { description: '对<$ba.cold>寒冷</>的敌人伤害提升' }),
      basicSkill('sk_c', '丙', { description: '免疫<$ba.cold>寒冷</>' }),
    ]
    const { index } = buildIndex({ cn: server({ terms: COMMON_TERMS, operators, skills }) })
    const conditions: [EffectType, string][] = [
      ['apply', 'ba.cold'],
      ['exploit', 'ba.cold'],
    ]
    expect(names(index, conditions)).toEqual(['分兩段', '只施加', '只利用'])
    expect(results(index, conditions).map((r) => [r.name, r.entries.map((e) => [e.source, e.stages[0].effects])])).toEqual([
      ['分兩段', [['技能1', { 'ba.cold': ['apply'] }], ['技能2', { 'ba.cold': ['exploit'] }]]],
      ['只施加', [['技能1', { 'ba.cold': ['apply'] }]]],
      ['只利用', [['技能1', { 'ba.cold': ['exploit'] }]]],
    ])
  })

  test('施加-X OR 利用-Y:只命中其中一個條件的幹員也列入,效果只列命中的那個', () => {
    const { index } = buildIndex({
      cn: fixture({
        施加暈眩利用寒冷: '使敌人<$ba.stun>晕眩</>，对<$ba.cold>寒冷</>的敌人伤害提升',
        只施加暈眩: '使敌人<$ba.stun>晕眩</>',
        只利用寒冷: '对<$ba.cold>寒冷</>的敌人伤害提升',
        只施加寒冷: '使敌人<$ba.cold>寒冷</>',
      }),
    })
    const conditions: [EffectType, string][] = [
      ['apply', 'ba.stun'],
      ['exploit', 'ba.cold'],
    ]
    expect(names(index, conditions)).toEqual(['施加暈眩利用寒冷', '只施加暈眩', '只利用寒冷'])
    expect(results(index, conditions).map((r) => r.entries[0].stages[0].effects)).toEqual([
      { 'ba.stun': ['apply'], 'ba.cold': ['exploit'] },
      { 'ba.stun': ['apply'] },
      { 'ba.cold': ['exploit'] },
    ])
  })

  test('結果階段只列符合搜尋條件的效果類型', () => {
    const { index } = buildIndex({ cn })
    const [r] = query(index, { conditions: [{ keyword: 'ba.cold', type: 'exploit' }], server: 'cn' }).filter((r) => r.name === '施加又利用')
    expect(r.entries[0].stages[0].effects).toEqual({ 'ba.cold': ['exploit'] })
  })

  test('沒有搜尋條件時沒有結果', () => {
    const { index } = buildIndex({ cn })
    expect(query(index, { conditions: [], server: 'cn' })).toEqual([])
  })
})

describe('覆寫檔與待複核清單', () => {
  test('覆寫檔的判定優先於規則,能覆寫成多種效果類型,且不再列入待複核', () => {
    const cn = fixture({ 甲: '使敌人<$ba.cold>寒冷</>' })
    const first = buildIndex({ cn })
    expect(first.pending.map((p) => [p.keyword, p.ruleTypes, p.text])).toEqual([['ba.cold', ['apply'], '使敌人寒冷']])

    const overrides: Overrides = { [first.pending[0].key]: { types: ['exploit', 'apply'], reviewed: true } }
    const second = buildIndex({ cn, overrides })
    expect(typesFound(second.index, 'ba.cold')).toEqual(['apply', 'exploit'])
    expect(second.pending).toEqual([])
  })

  test('覆寫成沒有效果類型的配對不會成為命中敘述', () => {
    const cn = fixture({ 甲: '使敌人<$ba.cold>寒冷</>' })
    const key = buildIndex({ cn }).pending[0].key
    const { index, pending } = buildIndex({ cn, overrides: { [key]: { types: [], reviewed: true } } })
    expect(typesFound(index, 'ba.cold')).toEqual([])
    expect(pending).toEqual([])
  })

  test('待複核清單只列新增或變動的配對', () => {
    const before = fixture({ 甲: '使敌人<$ba.cold>寒冷</>', 乙: '免疫<$ba.stun>晕眩</>' })
    const first = buildIndex({ cn: before })
    expect(first.pending).toHaveLength(2)
    const overrides: Overrides = Object.fromEntries(first.pending.map((p) => [p.key, { types: p.ruleTypes, reviewed: true }]))

    const after = fixture({ 甲: '使敌人<$ba.cold>寒冷</>', 乙: '免疫<$ba.stun>晕眩</>和<$ba.cold>寒冷</>' })
    const second = buildIndex({ cn: after, overrides })
    expect(second.pending.map((p) => [p.keyword, p.text])).toEqual([
      ['ba.stun', '免疫晕眩和寒冷'],
      ['ba.cold', '免疫晕眩和寒冷'],
    ])
  })

  test('同一段敘述在多處出現時只列一次', () => {
    const { pending } = buildIndex({ cn: fixture({ 甲: '使敌人<$ba.cold>寒冷</>', 乙: '使敌人<$ba.cold>寒冷</>' }) })
    expect(pending).toHaveLength(1)
    expect(pending[0].where).toHaveLength(2)
  })
})

describe('兩服一致時的台服覆寫差異警告', () => {
  const cnText = '使敌人<$ba.cold>寒冷</>'
  const twText = '使敵人<$ba.cold>寒冷</>'
  /** 台服文字的覆寫鍵:把台服文字單獨當陸服建置時,待複核清單給的鍵。 */
  const twKey = buildIndex({ cn: fixture({ 甲: twText }) }).pending[0].key

  function build(overrides?: Overrides) {
    return buildIndex({ cn: fixture({ 甲: cnText }), tw: fixture({ 甲: twText }), overrides })
  }

  test('台服覆寫判定和沿用的陸服效果類型不同時發警告,寫出幹員、出處、關鍵字與兩邊的判定', () => {
    const { warnings } = build({ [twKey]: { types: ['exploit'], reviewed: true } })
    expect(warnings).toEqual(['幹員 char_400_x 技能1 max:台服與陸服文字一致,沿用陸服判定;ba.cold 的台服覆寫判定(利用)與陸服(施加)不同'])
  })

  test('台服覆寫判定與陸服相同,或台服沒有覆寫判定時,不發警告', () => {
    expect(build({ [twKey]: { types: ['apply'], reviewed: true } }).warnings).toEqual([])
    expect(build().warnings).toEqual([])
  })

  test('有差異時效果類型照樣沿用陸服的,台服搜尋結果不變', () => {
    const { index } = build({ [twKey]: { types: ['exploit'], reviewed: true } })
    expect(typesFound(index, 'ba.cold', 'tw')).toEqual(['apply'])
  })
})

describe('類型鈕反灰:關鍵字在目前伺服器有資料的效果類型', () => {
  const operators = {
    char_401_a: operator({ name: '兩服都有', skills: ['sk_a'] }),
    char_402_b: operator({ name: '只有陸服', skills: ['sk_b'] }),
  }
  const skills = [
    basicSkill('sk_a', '甲', { description: '使敌人<$ba.cold>寒冷</>' }),
    basicSkill('sk_b', '乙', { description: '对<$ba.cold>寒冷</>的敌人伤害提升' }),
  ]
  const cn = server({ terms: COMMON_TERMS, operators, skills })
  const tw = server({ terms: COMMON_TERMS, operators: { char_401_a: operators.char_401_a }, skills: [skills[0]] })

  test('只回傳有資料的類型', () => {
    const { index } = buildIndex({ cn, tw })
    expect(availableTypes(index, 'cn', 'ba.cold')).toEqual(['apply', 'exploit'])
    expect(availableTypes(index, 'cn', 'ba.stun')).toEqual([])
  })

  test('某類型只有陸服有時,台服模式下不回傳', () => {
    const { index } = buildIndex({ cn, tw })
    expect(availableTypes(index, 'tw', 'ba.cold')).toEqual(['apply'])
  })

  test('判定不出效果類型的敘述不提供任何類型', () => {
    const { index } = buildIndex({ cn: fixture({ 甲: '场上存在<$ba.cold>寒冷</>相关的效果时攻击力提升' }) })
    expect(availableTypes(index, 'cn', 'ba.cold')).toEqual([])
  })
})

describe('面板點關鍵字時預設亮的效果類型', () => {
  const operators = {
    char_401_a: operator({ name: '兩服都有', skills: ['sk_a'] }),
    char_402_b: operator({ name: '只有陸服', skills: ['sk_b'] }),
  }
  const skills = [
    basicSkill('sk_a', '甲', { description: '对<$ba.cold>寒冷</>的敌人伤害提升，免疫<$ba.stun>晕眩</>，自身免疫<$ba.frozen>冻结</>' }),
    basicSkill('sk_b', '乙', { description: '使敌人<$ba.cold>寒冷</>，攻击<$ba.stun>晕眩</>的敌人伤害提升，使敌人<$ba.levitate>浮空</>' }),
  ]
  const cn = server({ terms: COMMON_TERMS, operators, skills })
  const tw = server({ terms: COMMON_TERMS, operators: { char_401_a: operators.char_401_a }, skills: [skills[0]] })
  const { index } = buildIndex({ cn, tw })

  test('有施加資料時亮施加', () => {
    expect(defaultType(index, 'cn', 'ba.cold')).toBe('apply')
  })

  test('只有利用與反制時亮利用', () => {
    expect(defaultType(index, 'cn', 'ba.stun')).toBe('exploit')
  })

  test('只有反制時亮反制', () => {
    expect(defaultType(index, 'cn', 'ba.frozen')).toBe('counter')
  })

  test('某類型只有陸服有時,台服亮下一個有資料的類型', () => {
    expect(defaultType(index, 'tw', 'ba.cold')).toBe('exploit')
    expect(defaultType(index, 'tw', 'ba.stun')).toBe('counter')
  })

  test('都沒有資料時亮施加', () => {
    expect(defaultType(index, 'tw', 'ba.levitate')).toBe('apply')
  })
})
