import { describe, expect, test } from 'vitest'
import { buildIndex } from '../build/buildIndex'
import { diffKnown } from '../build/known'
import { basicSkill, COMMON_TERMS, operator, server } from './fixtures'

/** 每段技能敘述都缺結尾的關閉標記,各產生一則「標記未關閉」警告。 */
function warningsOf(descriptions: string[]): string[] {
  const skills = descriptions.map((description, i) => basicSkill(`sk_x_${i}`, '技', { description }))
  const cn = server({
    terms: COMMON_TERMS,
    operators: { char_001_x: operator({ name: '甲', skills: skills.map((s) => s.skillId) }) },
    skills,
  })
  return buildIndex({ cn }).warnings
}

const unclosedA = '使敌人<$ba.cold>寒冷'
const unclosedB = '使敌人<$ba.stun>晕眩'

describe('已知清單比對:警告', () => {
  test('已知警告清單為空時,全部警告都是新出現的', () => {
    const warnings = warningsOf([unclosedA, unclosedB])
    expect(warnings).toHaveLength(2)
    expect(diffKnown(warnings, [])).toEqual({ added: warnings, resolved: [] })
  })

  test('清單裡有的警告不算新出現的', () => {
    const warnings = warningsOf([unclosedA, unclosedB])
    expect(diffKnown(warnings, [warnings[0]])).toEqual({ added: [warnings[1]], resolved: [] })
  })

  test('清單裡有、這次沒出現的警告列為已消失', () => {
    const known = warningsOf([unclosedA, unclosedB])
    expect(diffKnown(warningsOf([unclosedA]), known)).toEqual({ added: [], resolved: [known[1]] })
  })

  test('全文一字不差才算同一則', () => {
    const warnings = warningsOf([unclosedA])
    const known = [warnings[0] + ' ']
    expect(diffKnown(warnings, known)).toEqual({ added: warnings, resolved: known })
  })

  test('含換行的警告也能比對', () => {
    const warnings = warningsOf(['使敌人<$ba.cold>寒冷\n持续3秒'])
    expect(warnings[0]).toContain('\n')
    expect(diffKnown(warningsOf(['使敌人<$ba.cold>寒冷\n持续3秒']), warnings)).toEqual({ added: [], resolved: [] })
  })
})

describe('已知清單比對:疑似漏標', () => {
  function suspectKeysOf(descriptions: string[]): string[] {
    const skills = descriptions.map((description, i) => basicSkill(`sk_x_${i}`, '技', { description }))
    const operators = Object.fromEntries(skills.map((s, i) => [`char_00${i}_x`, operator({ name: `幹員${i}`, skills: [s.skillId] })]))
    return buildIndex({ cn: server({ terms: COMMON_TERMS, operators, skills }) }).suspects.map((s) => s.key)
  }

  test('已知清單為空時,全部疑似漏標都是新出現的', () => {
    const keys = suspectKeysOf(['攻击使敌人晕眩2秒', '使敌人寒冷'])
    expect(keys).toHaveLength(2)
    expect(diffKnown(keys, [])).toEqual({ added: keys, resolved: [] })
  })

  test('只差數字的同一種寫法是同一則,收進已知清單後不再算新出現的', () => {
    const known = suspectKeysOf(['攻击使敌人晕眩2秒'])
    expect(diffKnown(suspectKeysOf(['攻击使敌人晕眩3.5秒']), known)).toEqual({ added: [], resolved: [] })
  })

  test('已知的疑似漏標補標之後,列為已消失', () => {
    const known = suspectKeysOf(['攻击使敌人晕眩2秒', '使敌人寒冷'])
    const now = suspectKeysOf(['攻击使敌人<$ba.stun>晕眩</>2秒', '使敌人寒冷'])
    expect(diffKnown(now, known)).toEqual({ added: [], resolved: ['cn ba.stun 攻击使敌人晕眩#秒'] })
  })

  test('前後文不同的寫法是新出現的', () => {
    const known = suspectKeysOf(['攻击使敌人晕眩2秒'])
    const now = suspectKeysOf(['技能期间使敌人晕眩'])
    expect(diffKnown(now, known)).toEqual({ added: now, resolved: known })
  })
})

describe('清單外勢力的警告', () => {
  const POWER_NAMES = { kazimierz: '卡西米尔', siracusa: '叙拉古' }

  function powerWarnings(spec: { talent?: string; skill?: string; trait?: string }): string[] {
    const skills = spec.skill ? [basicSkill('sk_x_1', '技', { description: spec.skill })] : []
    const cn = server({
      terms: COMMON_TERMS,
      powerNames: POWER_NAMES,
      operators: {
        char_001_x: operator({
          name: '甲',
          trait: spec.trait,
          skills: skills.map((s) => s.skillId),
          talents: spec.talent ? [{ name: '天賦', description: spec.talent }] : [],
        }),
      },
      skills,
    })
    return buildIndex({ cn, powerList: [['kazimierz']] }).warnings
  }

  test('天賦的【勢力名】不在清單時發警告,寫出幹員、敘述來源與勢力名', () => {
    expect(powerWarnings({ talent: '编入【叙拉古】干员时攻击力+10%' })).toEqual(['幹員 char_001_x 天賦1:【叙拉古】是勢力清單外的勢力 siracusa'])
  })

  test('技能的【勢力名】不在清單時也發警告', () => {
    expect(powerWarnings({ skill: '【叙拉古】干员攻击力+10%' })).toEqual(['幹員 char_001_x 技能1:【叙拉古】是勢力清單外的勢力 siracusa'])
  })

  test('清單內的勢力不發警告', () => {
    expect(powerWarnings({ talent: '编入【卡西米尔】干员时攻击力+10%', skill: '【卡西米尔】干员攻击力+10%' })).toEqual([])
  })

  test('特性中的【勢力名】不檢查', () => {
    expect(powerWarnings({ trait: '【叙拉古】干员攻击力+10%' })).toEqual([])
  })

  test('【】內不是勢力名稱的詞不發警告', () => {
    expect(powerWarnings({ talent: '编入【萨卡兹】干员时攻击力+10%', skill: '【狙击】干员攻击速度+10' })).toEqual([])
  })

  test('召喚物的天賦或技能也檢查', () => {
    const cn = server({
      terms: COMMON_TERMS,
      powerNames: POWER_NAMES,
      operators: {
        char_002_y: operator({ name: '乙', skills: ['sk_y_1'], skillTokens: { sk_y_1: 'token_002_y' }, tokens: ['token_002_y'] }),
        token_002_y: operator({
          name: '小乙',
          profession: 'TOKEN',
          skills: ['sktok_y_1'],
          talents: [{ name: '小天賦', description: '周围【叙拉古】干员攻击力+10%' }],
        }),
      },
      skills: [basicSkill('sk_y_1', '召唤', { description: '召唤小乙' }), basicSkill('sktok_y_1', '小技', { description: '【叙拉古】干员防御力+10%' })],
    })
    expect(buildIndex({ cn, powerList: [['kazimierz']] }).warnings).toEqual([
      '幹員 char_002_y 召喚物 token_002_y 技能1:【叙拉古】是勢力清單外的勢力 siracusa',
      '幹員 char_002_y 召喚物 token_002_y 天賦1:【叙拉古】是勢力清單外的勢力 siracusa',
    ])
  })
})
