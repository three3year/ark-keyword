import { describe, expect, test } from 'vitest'
import { type BuildInput, type Overrides, type SupplementKeyword, buildIndex } from '../build/buildIndex'
import { keywordGroups, operatorDetail, query } from '../src/core/query'
import type { EffectType } from '../src/core/types'
import realSupplements from '../data/supplementary-keywords.json'
import { applying, COMMON_TERMS, basicSkill, highlights, operator, plain, server } from './fixtures'

const supplements: SupplementKeyword[] = [
  { id: 'knockback', name: '擊退', cn: ['推开', '击退'], tw: ['推開', '擊退'], definition: '把敵人往遠離自己的方向推動' },
  { id: 'truedmg', name: '真實傷害', cn: ['真实伤害'], tw: ['真實傷害'], definition: '無視防禦與法術抗性的傷害' },
  { id: 'lift', name: '浮起', cn: ['浮空'], tw: ['浮空'], definition: '測試用' },
]

/** 建一次索引,把待複核的配對全判為施加,再帶著這份覆寫重建。 */
function buildWithPendingReviewedAsApply(input: BuildInput) {
  const first = buildIndex(input)
  const overrides: Overrides = Object.fromEntries(first.pending.map((p) => [p.key, { types: ['apply'], reviewed: true }]))
  return buildIndex({ ...input, overrides })
}

function fixture(descriptions: Record<string, string>) {
  const operators = Object.fromEntries(Object.keys(descriptions).map((name, i) => [`char_${500 + i}_s`, operator({ name, skills: [`sk_${i}`] })]))
  const skills = Object.values(descriptions).map((d, i) => basicSkill(`sk_${i}`, `技${i}`, { description: d }))
  return server({ terms: COMMON_TERMS, operators, skills })
}

describe('補充關鍵字', () => {
  test('以純文字比對清單中的字串,命中處高亮', () => {
    const { index } = buildIndex({ cn: fixture({ 推人者: '攻击将敌人<@ba.vup>推开</>一段距离', 無關者: '攻击力提升' }), supplements })
    const results = query(index, { conditions: applying('sup.knockback'), server: 'cn' })
    expect(results.map((r) => r.name)).toEqual(['推人者'])
    const runs = results[0].entries[0].stages[0].runs
    expect(plain(runs)).toBe('攻击将敌人推开一段距离')
    expect(highlights(runs)).toEqual([['推开', 'sup.knockback']])
  })

  test('比對字串可以跨越樣式標記', () => {
    const { index } = buildIndex({ cn: fixture({ 甲: '造成<@ba.vup>真实</>伤害' }), supplements })
    const [r] = query(index, { conditions: applying('sup.truedmg'), server: 'cn' })
    expect(highlights(r.entries[0].stages[0].runs)).toEqual([['真实伤害', 'sup.truedmg']])
  })

  test('已在術語標記內的文字不重複計算', () => {
    const { index } = buildIndex({
      cn: fixture({ 術語者: '使敌人<$ba.levitate>浮空</>', 純文字者: '使敌人浮空2秒' }),
      supplements,
    })
    expect(query(index, { conditions: applying('sup.lift'), server: 'cn' }).map((r) => r.name)).toEqual(['純文字者'])
    expect(query(index, { conditions: applying('ba.levitate'), server: 'cn' }).map((r) => r.name)).toEqual(['術語者'])
  })

  test('補充關鍵字可與術語多選 OR,並接受效果類型判定', () => {
    const { index } = buildIndex({
      cn: fixture({ 兩者: '使敌人<$ba.cold>寒冷</>并将其推开', 只寒冷: '使敌人<$ba.cold>寒冷</>', 無關: '攻击力提升' }),
      supplements,
    })
    const results = query(index, { conditions: applying('ba.cold', 'sup.knockback'), server: 'cn' })
    expect(results.map((r) => r.name)).toEqual(['兩者', '只寒冷'])
    expect(results.map((r) => r.entries[0].stages[0].effects)).toEqual([
      { 'ba.cold': ['apply'], 'sup.knockback': ['apply'] },
      { 'ba.cold': ['apply'] },
    ])
  })

  describe('友方技力回復(維護者清單的比對字串)', () => {
    const cases: [name: string, cn: string, tw: string][] = [
      ['瞬間回復', '治疗友方单位时，使目标额外回复2点技力', '治療友方單位時，使目標額外回復2點技力'],
      ['擊殺回復', '击杀敌人后，攻击范围内所有友方干员技力+2', '擊殺敵人後，攻擊範圍內所有友方幹員技力+2'],
      ['回復速度', '攻击范围内的友方干员技力回复速度+0.3/秒', '攻擊範圍內的友方幹員技力回復速度+0.3/秒'],
      ['初始技力', '编入队伍时所有【叙拉古】干员的初始技力+5', '編入隊伍時所有【敘拉古】幹員的初始技力+5'],
      ['立刻獲得', '部署当前复制的干员时使其立刻获得10技力', '部署當前複製的幹員時使其立刻獲得10技力'],
      ['只提技力', '技力满时可使用装备应变来开启技能', '技力滿時可使用裝備應變來開啟技能'],
    ]
    function servers() {
      const operators = (style: 'array' | 'object') =>
        Object.fromEntries(cases.map(([name], i) => [`char_700_${i}`, operator({ name, skills: [`sk_${i}`], style })]))
      const skills = (lang: 1 | 2, style: 'array' | 'object') => cases.map((c, i) => basicSkill(`sk_${i}`, `技${i}`, { description: c[lang] }, style))
      return {
        cn: server({ terms: COMMON_TERMS, operators: operators('array'), skills: skills(1, 'array') }),
        tw: server({ terms: COMMON_TERMS, operators: operators('object'), skills: skills(2, 'object') }),
      }
    }

    test.each(['cn', 'tw'] as const)('%s:給其他友方幹員的瞬間回復、擊殺回復、回復速度、初始技力、立刻獲得命中,只提到技力的不命中', (srv) => {
      const { index } = buildWithPendingReviewedAsApply({ ...servers(), supplements: realSupplements })
      const results = query(index, { conditions: applying('sup.sprecovery'), server: srv })
      expect(results.map((r) => r.name).sort()).toEqual(['初始技力', '回復速度', '擊殺回復', '瞬間回復', '立刻獲得'].sort())
      const keyword = keywordGroups(index, srv).flatMap((g) => g.rows.flat()).find((k) => k.id === 'sup.sprecovery')!
      expect(keyword.name).toBe('友方技力回復')
      expect(keyword.unofficial).toBe(true)
      expect(plain(keyword.definition)).toBe('使其他友方幹員立即獲得技力、提高初始技力,或提升技力的回復速度。')
    })
  })

  describe('減抗(維護者清單的比對字串)', () => {
    const cases: [name: string, cn: string, tw: string][] = [
      ['百分比', '攻击范围内的敌军法术抗性-40%', '攻擊範圍內的敵軍法術抗性-40%'],
      ['固定值', '使目标法术抗性-10，持续5秒', '使目標法術抗性-10，持續5秒'],
      ['無視法抗', '攻击时无视目标20点法术抗性', '攻擊時無視目標20點法術抗性'],
    ]
    function servers() {
      const operators = (style: 'array' | 'object') =>
        Object.fromEntries(cases.map(([name], i) => [`char_710_${i}`, operator({ name, skills: [`sk_${i}`], style })]))
      const skills = (lang: 1 | 2, style: 'array' | 'object') => cases.map((c, i) => basicSkill(`sk_${i}`, `技${i}`, { description: c[lang] }, style))
      return {
        cn: server({ terms: COMMON_TERMS, operators: operators('array'), skills: skills(1, 'array') }),
        tw: server({ terms: COMMON_TERMS, operators: operators('object'), skills: skills(2, 'object') }),
      }
    }

    test.each(['cn', 'tw'] as const)('%s:「法術抗性-」命中並高亮,無視法抗不命中;定義標為非官方', (srv) => {
      const { index } = buildWithPendingReviewedAsApply({ ...servers(), supplements: realSupplements })
      const results = query(index, { conditions: applying('sup.resdown'), server: srv })
      expect(results.map((r) => r.name).sort()).toEqual(['百分比', '固定值'].sort())
      for (const r of results) expect(highlights(r.entries[0].stages[0].runs)).toEqual([['法術抗性-', 'sup.resdown']])
      const keyword = keywordGroups(index, srv).flatMap((g) => g.rows.flat()).find((k) => k.id === 'sup.resdown')!
      expect(keyword.name).toBe('減抗')
      expect(keyword.unofficial).toBe(true)
      expect(plain(keyword.definition)).toBe('降低敵人的法術抗性。')
    })
  })

  describe('效果類型為空的補充關鍵字配對不標記', () => {
    function buildReviewed(input: BuildInput, decide: (text: string, keyword: string) => EffectType[]) {
      const first = buildIndex(input)
      const overrides: Overrides = Object.fromEntries(first.pending.map((p) => [p.key, { types: decide(p.text, p.keyword), reviewed: true }]))
      return buildIndex({ ...input, overrides })
    }

    test('覆寫為空類型的敘述裡,這個關鍵字不標記也不列入;另一段覆寫為施加的照樣標記並列入', () => {
      const cn = fixture({ 空類型: '使敌人<$ba.cold>寒冷</>并将其推开', 施加: '攻击将敌人推开' })
      const { index } = buildReviewed({ cn, supplements }, (text, keyword) =>
        keyword === 'sup.knockback' && text.includes('寒冷') ? [] : ['apply'],
      )
      const results = query(index, { conditions: applying('ba.cold', 'sup.knockback'), server: 'cn' })
      expect(results.map((r) => [r.name, highlights(r.entries[0].stages[0].runs)])).toEqual([
        ['空類型', [['寒冷', 'ba.cold']]],
        ['施加', [['推开', 'sup.knockback']]],
      ])
      expect(query(index, { conditions: applying('sup.knockback'), server: 'cn' }).map((r) => r.name)).toEqual(['施加'])
    })

    test('術語的空類型配對照舊標記', () => {
      const cn = fixture({ 甲: '使敌人<$ba.cold>寒冷</>并将其推开' })
      const { index } = buildReviewed({ cn, supplements }, (_, keyword) => (keyword === 'ba.cold' ? [] : ['apply']))
      const [r] = query(index, { conditions: applying('sup.knockback'), server: 'cn' })
      expect(highlights(r.entries[0].stages[0].runs)).toEqual([
        ['寒冷', 'ba.cold'],
        ['推开', 'sup.knockback'],
      ])
    })

    test('規則判定為空、還沒複核的補充關鍵字配對同樣不標記,仍列入待複核', () => {
      const cn = fixture({ 甲: '使敌人<$ba.cold>寒冷</>，敌人被推开时攻击力下降' })
      const { index, pending } = buildIndex({ cn, supplements })
      expect(pending.map((p) => [p.keyword, p.ruleTypes])).toEqual([
        ['ba.cold', ['apply']],
        ['sup.knockback', []],
      ])
      const [r] = query(index, { conditions: applying('ba.cold'), server: 'cn' })
      expect(highlights(r.entries[0].stages[0].runs)).toEqual([['寒冷', 'ba.cold']])
    })

    test('台服文字與陸服一致、陸服覆寫為空類型時,兩服文字都不標記,仍判為兩服一致,台服配對不進待複核', () => {
      const raw = (description: string, style: 'array' | 'object') =>
        server({ terms: COMMON_TERMS, operators: { char_500_s: operator({ name: '甲', skills: ['sk_0'], style }) }, skills: [basicSkill('sk_0', '技', { description }, style)] })
      const input: BuildInput = { cn: raw('将敌人推开', 'array'), tw: raw('將敵人推開', 'object'), supplements }
      const { pending, operatorFiles } = buildReviewed(input, () => [])
      expect(pending).toEqual([])
      const detail = (srv: 'cn' | 'tw') => operatorDetail(operatorFiles[0], { server: srv, conditions: [], branchName: '' }).tabs[0].entries[0].stages[0].runs
      expect(plain(detail('cn'))).toBe('將敵人推開')
      expect(highlights(detail('cn'))).toEqual([])
      expect(highlights(detail('tw'))).toEqual([])
    })
  })

  test('面板依清單排列,定義標為非官方', () => {
    const { index } = buildIndex({
      cn: fixture({ 甲: '将敌人推开', 乙: '造成真实伤害', 丙: '使敌人浮空2秒' }),
      groups: [
        { name: '控場', rows: [['ba.stun', 'sup.lift', 'sup.knockback']] },
        { name: '傷害', rows: [['sup.truedmg']] },
      ],
      supplements,
    })
    const panel = keywordGroups(index, 'cn')
    expect(panel.map((g) => [g.name, g.rows.map((r) => r.map((k) => k.name))])).toEqual([
      ['控場', [['浮起', '擊退']]],
      ['傷害', [['真實傷害']]],
    ])
    const knockback = panel[0].rows[0][1]
    expect(knockback.unofficial).toBe(true)
    expect(plain(knockback.definition)).toBe('把敵人往遠離自己的方向推動')
  })
})
