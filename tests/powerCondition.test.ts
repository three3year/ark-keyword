import { describe, expect, test } from 'vitest'
import { type BuildInput, buildIndex } from '../build/buildIndex'
import { powerPanel, query } from '../src/core/query'
import type { RawPower } from '../build/raw'
import { applying, basicSkill, COMMON_TERMS, operator, server, withRelease } from './fixtures'

const CN_NAMES = {
  kazimierz: '卡西米尔',
  siracusa: '叙拉古',
  kjerag: '谢拉格',
  rhodes: '罗德岛',
  abyssal: '深海猎人',
  sui: '炎-岁',
  yan: '炎',
  sees: 'S.E.E.S.',
}
const TW_NAMES = { kazimierz: '卡西米爾', siracusa: '敘拉古', kjerag: '謝拉格', rhodes: '羅德島', abyssal: '深海獵人', sui: '炎-歲', yan: '炎' }

interface Member {
  id: string
  name: string
  rarity?: number
  profession?: string
  power?: RawPower
  hiddenPowers?: RawPower[]
  cold?: boolean
  talent?: string
}

function fixture(members: Member[], twMembers: Member[] = []): BuildInput {
  const op = (m: Member, style: 'array' | 'object') =>
    operator({
      name: m.name,
      rarity: m.rarity,
      profession: m.profession,
      style,
      power: m.power,
      hiddenPowers: m.hiddenPowers,
      skills: m.cold ? ['sk_cold'] : [],
      talents: m.talent ? [{ name: '天賦', description: m.talent }] : [],
    })
  const skills = [basicSkill('sk_cold', '冷', { description: '使敌人<$ba.cold>寒冷</>' })]
  const cn = server({ terms: COMMON_TERMS, powerNames: CN_NAMES, skills, operators: Object.fromEntries(members.map((m) => [m.id, op(m, 'array')])) })
  const tw = server({ terms: COMMON_TERMS, skills, operators: Object.fromEntries(twMembers.map((m) => [m.id, op(m, 'object')])) })
  return {
    cn: withRelease(cn, members.map((m) => m.id)),
    tw,
    twPowerNames: TW_NAMES,
    powerList: [['kazimierz', 'siracusa', 'kjerag', 'rhodes'], ['abyssal', { id: 'sui', cn: '岁', tw: '歲' }], ['sees']],
  }
}

const names = (raw: BuildInput, opts: Partial<Parameters<typeof query>[1]>) =>
  query(buildIndex(raw).index, { conditions: [], server: 'cn', ...opts }).map((r) => r.name)

describe('勢力條件', () => {
  test('只有勢力條件:列出該勢力全部幹員(含沒有任何關鍵字的),命中敘述為空', () => {
    const raw = fixture([
      { id: 'char_801_a', name: '卡西米爾寒冷', power: { nationId: 'kazimierz' }, cold: true },
      { id: 'char_802_b', name: '卡西米爾無關鍵字', power: { nationId: 'kazimierz' } },
      { id: 'char_803_c', name: '敘拉古', power: { nationId: 'siracusa' }, cold: true },
    ])
    const results = query(buildIndex(raw).index, { conditions: [], server: 'cn', powers: ['kazimierz'] })
    expect(results.map((r) => r.name)).toEqual(['卡西米爾無關鍵字', '卡西米爾寒冷'])
    expect(results.every((r) => r.entries.length === 0)).toBe(true)
  })

  test('隱藏勢力含該值的幹員列入;天賦要求該勢力、自己不是成員的不列', () => {
    const raw = fixture([
      { id: 'char_801_a', name: '深海獵人', power: { nationId: 'rhodes' }, hiddenPowers: [{ groupId: 'abyssal' }] },
      { id: 'char_802_b', name: '濁心', power: { nationId: 'rhodes' }, talent: '【深海猎人】干员攻击力+10%' },
      { id: 'char_803_c', name: '隱藏勢力第二個', power: { nationId: 'rhodes' }, hiddenPowers: [{ nationId: 'yan' }, { nationId: 'kjerag' }] },
    ])
    expect(names(raw, { powers: ['abyssal'] })).toEqual(['深海獵人'])
    expect(names(raw, { powers: ['kjerag'] })).toEqual(['隱藏勢力第二個'])
  })

  test('兩個勢力條件 OR;與職業條件、搜尋條件都是 AND', () => {
    const raw = fixture([
      { id: 'char_801_a', name: '卡西米爾術師', power: { nationId: 'kazimierz' }, cold: true },
      { id: 'char_802_b', name: '卡西米爾近衛', profession: 'WARRIOR', power: { nationId: 'kazimierz' } },
      { id: 'char_803_c', name: '敘拉古術師', power: { nationId: 'siracusa' } },
      { id: 'char_804_d', name: '謝拉格術師', power: { nationId: 'kjerag' }, cold: true },
    ])
    expect(names(raw, { powers: ['kazimierz', 'siracusa'] })).toEqual(['卡西米爾近衛', '敘拉古術師', '卡西米爾術師'])
    expect(names(raw, { powers: ['kazimierz'], professions: ['CASTER'] })).toEqual(['卡西米爾術師'])
    expect(names(raw, { powers: ['kazimierz', 'siracusa'], conditions: applying('ba.cold') })).toEqual(['卡西米爾術師'])
  })

  test('勢力條件 + 星級篩選:只列符合星級的', () => {
    const raw = fixture([
      { id: 'char_801_a', name: '六星', rarity: 6, power: { nationId: 'kjerag' } },
      { id: 'char_802_b', name: '五星', rarity: 5, power: { nationId: 'kjerag' } },
    ])
    expect(names(raw, { powers: ['kjerag'], rarities: [5] })).toEqual(['五星'])
  })

  test('兩服勢力不同時依目前伺服器判定;台服模式略過台服未實裝的幹員', () => {
    const changed = { id: 'char_801_a', name: '兩服不同', power: { nationId: 'rhodes' }, hiddenPowers: [{ nationId: 'siracusa' }] }
    const cnOnlyMember = { id: 'char_802_b', name: '台服未實裝', power: { nationId: 'siracusa' } }
    const raw = fixture([changed, cnOnlyMember], [{ ...changed, hiddenPowers: [{ nationId: 'kjerag' }] }])
    expect(names(raw, { powers: ['siracusa'], server: 'cn' })).toEqual(['台服未實裝', '兩服不同'])
    expect(names(raw, { powers: ['siracusa'], server: 'tw' })).toEqual([])
    expect(names(raw, { powers: ['kjerag'], server: 'tw' })).toEqual(['兩服不同'])
    expect(names(raw, { powers: ['kjerag'], server: 'cn' })).toEqual([])
  })
})

describe('勢力面板', () => {
  const roster: Member[] = [
    { id: 'char_801_a', name: '卡西米爾', power: { nationId: 'kazimierz' } },
    { id: 'char_802_b', name: '謝拉格(隱藏)', power: { nationId: 'rhodes' }, hiddenPowers: [{ nationId: 'kjerag' }] },
    { id: 'char_803_c', name: '黍', power: { nationId: 'yan', groupId: 'sui' } },
    { id: 'char_804_d', name: '結城理', power: { teamId: 'sees' } },
  ]

  test('依清單的行與順序,只列目前伺服器有成員的勢力;變空的行不列;名稱用覆寫或該伺服器的勢力名稱', () => {
    const raw = fixture(roster, roster.filter((m) => m.id !== 'char_804_d'))
    const panel = (on: 'cn' | 'tw') => powerPanel(buildIndex(raw).index, on).map((row) => row.map((p) => `${p.id}:${p.name}`))
    expect(panel('cn')).toEqual([['kazimierz:卡西米尔', 'kjerag:谢拉格', 'rhodes:罗德岛'], ['sui:岁'], ['sees:S.E.E.S.']])
    expect(panel('tw')).toEqual([['kazimierz:卡西米爾', 'kjerag:謝拉格', 'rhodes:羅德島'], ['sui:歲']])
  })
})

