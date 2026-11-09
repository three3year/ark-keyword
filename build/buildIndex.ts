// 索引建置:原始遊戲資料 → 索引。純函式,不做任何 I/O。
//
// 每段敘述(技能、天賦、特性的某個階段)都由一個「產生器」對陸服與台服各解析一次:
// 陸服文字用於陸服模式的比對;台服文字用於台服模式的比對與顯示,
// 並在術語、數值、補充關鍵字都和陸服一致時,供陸服模式改顯示繁中。
// 模組3 階段只有陸服資料(台服資料庫沒有模組戰鬥資料)。
import { createHash } from 'node:crypto'
import type {
  DataVersion,
  EffectType,
  IndexEntry,
  IndexGroup,
  IndexKeyword,
  IndexModule,
  IndexOperator,
  IndexPower,
  IndexStage,
  IndexSummon,
  IndexText,
  OperatorAttributes,
  OperatorFile,
  OperatorPowers,
  PerServer,
  PowerId,
  Profession,
  Run,
  SearchIndex,
  Server,
  SkillStats,
  SpType,
  SummonOrigin,
  Trigger,
} from '../src/core/types'
import { PROFESSION_LABELS, PROFESSIONS, sortTypes } from '../src/core/types'
import { ruleEffectTypes } from './effectType'
import { withPotentialBonus } from './potential'
import type {
  RawCharacter,
  RawEquip,
  RawEquipPart,
  RawEquipTalentCandidate,
  RawEquipTraitCandidate,
  RawPower,
  RawServer,
  RawSkill,
  RawSkillLevel,
  RawTalentCandidate,
  RawUnlockCondition,
} from './raw'
import { parseRichText, plainText, push, toValues } from './richText'
import { type SupplementMatcher, markSupplements } from './supplements'

function dataVersion(raw: RawServer): DataVersion {
  return { version: raw.gamedataConst.dataVersion ?? '', downloadedAt: raw.downloadedAt }
}

/** 維護者清單:關鍵字面板的分組,形狀同索引(術語或 sup.<id> 補充關鍵字都能排進任何一行)。沒列到的關鍵字歸到「未分組」。 */
export type KeywordGroup = IndexGroup

/** 維護者清單:補充關鍵字。關鍵字 id 為 sup.<id>。 */
export interface SupplementKeyword {
  id: string
  name: string
  /** 簡中比對字串(陸服文字)。 */
  cn: string[]
  /** 繁中比對字串(台服文字)。 */
  tw: string[]
  definition: string
}

/** 勢力的維護者清單裡附了顯示名稱的一項;沒附的伺服器用該伺服器的勢力名稱。 */
export interface PowerListEntry {
  id: PowerId
  cn?: string
  tw?: string
}

/** 勢力的維護者清單的一項:勢力 id,或附了顯示名稱的勢力。 */
export type PowerListItem = PowerId | PowerListEntry

/** 勢力的維護者清單:可選的勢力,由行組成(國家、組織、團隊各一行),順序就是面板順序。 */
export type PowerList = PowerListItem[][]

export function powerListEntry(item: PowerListItem): PowerListEntry {
  return typeof item === 'string' ? { id: item } : item
}

export function listedPowerIds(list: PowerList): PowerId[] {
  return list.flat().map((item) => powerListEntry(item).id)
}

/** 效果類型覆寫檔:以「敘述文字雜湊:關鍵字」為鍵,建置時優先於規則判定。types 為空表示複核後判定沒有效果類型。 */
export type Overrides = Record<string, { types: EffectType[]; reviewed: boolean; note?: string }>

/** 覆寫檔的文字格式:依鍵排序、一筆一行,讓版控 diff 穩定好讀。 */
export function formatOverrides(overrides: Overrides): string {
  const lines = Object.entries(overrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

/** 待複核的配對:雜湊還不在覆寫檔裡的「敘述 × 關鍵字」。 */
export interface PendingReview {
  key: string
  keyword: string
  /** 規則判定的效果類型;判定不出時為空清單。 */
  ruleTypes: EffectType[]
  text: string
  /** 這段敘述出現的位置,例如「char_002_amiya 技能1 m3」。 */
  where: string[]
}

export interface BuildInput extends PerServer<RawServer> {
  groups?: KeywordGroup[]
  supplements?: SupplementKeyword[]
  overrides?: Overrides
  /** 維護者清單:談不上效果類型、不當關鍵字的術語 id(隊伍名等);敘述中顯示為一般文字。 */
  excludedTerms?: string[]
  /** 維護者對照:幹員 id → PRTS 頁名。陸服名與其他幹員重複(例如阿米婭的職業形態)時必填。 */
  prtsPages?: Record<string, string>
  /** 維護者對照:台服勢力 ID → 繁中名稱(台服資料沒有勢力名稱表)。 */
  twPowerNames?: Record<PowerId, string>
  powerList?: PowerList
}

export interface BuildOutput {
  index: SearchIndex
  /** 每位幹員一個幹員檔,順序同索引的幹員。 */
  operatorFiles: OperatorFile[]
  warnings: string[]
  pending: PendingReview[]
}

const UNGROUPED = '未分組'

/** 一個模組在第3級對特性與天賦的改寫。 */
interface ModuleLevel3 {
  equip: RawEquip
  trait?: RawEquipTraitCandidate
  /** 天賦位置 → 改寫後的候選版本(各潛能);-1 為模組新增的天賦。 */
  talents: Map<number, RawEquipTalentCandidate[]>
}

/** 對某個伺服器產生一段敘述的 runs;該伺服器沒有這段敘述時回傳 undefined。 */
type Producer = (server: Server) => Run[] | undefined

class Builder {
  readonly warnings: string[] = []
  readonly warn = (message: string) => {
    this.warnings.push(message)
  }
  readonly pending = new Map<string, PendingReview>()
  readonly operatorFiles: OperatorFile[] = []
  readonly matchers: Record<Server, SupplementMatcher[]>
  readonly excluded: Set<string>
  readonly listedPowerIds: PowerId[]
  readonly cnPowerIdByName: Map<string, PowerId>

  constructor(readonly input: BuildInput) {
    this.excluded = new Set(input.excludedTerms)
    this.listedPowerIds = listedPowerIds(input.powerList ?? [])
    this.cnPowerIdByName = new Map(Object.values(input.cn.handbookTeamTable ?? {}).map((p) => [p.powerName, p.powerId]))
    const supplements = input.supplements ?? []
    this.matchers = {
      cn: supplements.map((s) => ({ id: supplementId(s), strings: s.cn })),
      tw: supplements.map((s) => ({ id: supplementId(s), strings: s.tw })),
    }
  }

  raw(server: Server): RawServer | undefined {
    return server === 'cn' ? this.input.cn : this.input.tw
  }

  /** 幹員、召喚物或職業形態(阿米婭)。 */
  char(server: Server, id: string): RawCharacter | undefined {
    const raw = this.raw(server)
    return raw?.characterTable[id] ?? raw?.charPatchTable?.patchChars[id]
  }

  build(): SearchIndex {
    const { cn, tw } = this.input
    const operators: IndexOperator[] = []
    // 阿米婭等有多個職業形態的幹員:每個形態各成一位幹員,名字後面標職業
    const forms = new Set(Object.values(cn.charPatchTable?.infos ?? {}).flatMap((i) => i.tmplIds))
    const chars = [...Object.entries(cn.characterTable), ...Object.entries(cn.charPatchTable?.patchChars ?? {})].filter(([id, char]) =>
      isOperator(id, char),
    )
    this.checkPrtsPages(chars)
    for (const [id, char] of chars) {
      const op = this.operator(id, char)
      if (forms.has(id)) op.name = `${op.name}(${PROFESSION_LABELS[op.profession]})`
      operators.push(op)
    }
    const versions: SearchIndex['versions'] = { cn: dataVersion(cn) }
    if (tw) versions.tw = dataVersion(tw)
    const keywords = this.keywords(operators)
    return {
      versions,
      groups: this.groups(keywords),
      keywords,
      subProfessions: this.subProfessions(operators),
      powerRows: this.powerRows(),
      operators,
    }
  }

  /** 陸服名重複的幹員都必須在 PRTS 頁名對照裡,否則會連到別人的頁面。 */
  checkPrtsPages(chars: [string, RawCharacter][]) {
    const byName = new Map<string, string[]>()
    for (const [id, char] of chars) byName.set(char.name, [...(byName.get(char.name) ?? []), id])
    const missing = [...byName].filter(([, ids]) => ids.length > 1 && ids.some((id) => !this.input.prtsPages?.[id]))
    if (missing.length > 0)
      throw new Error(`陸服名重複的幹員要在 PRTS 頁名對照裡指定頁名:${missing.map(([name, ids]) => `${name}(${ids.join('、')})`).join(';')}`)
  }

  /** 分支名稱優先用台服;順序取陸服資料。 */
  subProfessions(operators: IndexOperator[]): SearchIndex['subProfessions'] {
    const out: SearchIndex['subProfessions'] = {}
    const twNames = this.input.tw?.uniequipTable?.subProfDict ?? {}
    const cnNames = this.input.cn.uniequipTable?.subProfDict ?? {}
    for (const op of operators) {
      const id = op.subProfession
      if (out[id]) continue
      out[id] = { name: twNames[id]?.subProfessionName ?? cnNames[id]?.subProfessionName ?? id, profession: op.profession }
      const order = cnNames[id]?.subProfessionCatagory
      if (order !== undefined) out[id].order = order
    }
    return out
  }

  /**
   * 實裝順序:遊戲資料沒有可靠的實裝時間欄位,以潛能信物的排序編號近似
   * (同星級內依實裝先後遞增);沒有潛能信物的幹員視為最舊。
   */
  release(char: RawCharacter): number {
    const items = this.input.cn.itemTable?.items ?? {}
    const itemId = [char.potentialItemId, char.classicPotentialItemId, char.activityPotentialItemId].find((i) => i && items[i])
    return itemId ? items[itemId].sortId : 0
  }

  operator(id: string, char: RawCharacter): IndexOperator {
    const twChar = this.char('tw', id)
    const modules = this.modules(id)
    const entries: IndexEntry[] = []

    const trait = this.traitEntry(id, modules)
    if (trait) entries.push(trait)
    ;(char.talents ?? []).forEach((_, i) => {
      const entry = this.talentEntry(id, i, modules)
      if (entry) entries.push(entry)
    })
    const added = this.addedTalentEntry(id, (char.talents ?? []).length + 1, modules)
    if (added) entries.push(added)
    entries.push(...this.skillEntries(id))

    // 召喚物的天賦與技能歸到所屬幹員
    const summons: IndexSummon[] = []
    const displayOnly = new Set(Object.keys(char.displayTokenDict ?? {}))
    for (const [summonId, from] of summonSources(char)) {
      const summon = this.char('cn', summonId)
      if (!summon) {
        // 顯示用清單裡偶有只供顯示的 id(實際召喚物另有 id),不必警告
        if (!displayOnly.has(summonId)) this.warn(`幹員 ${id}:幹員表沒有召喚物 ${summonId}`)
        continue
      }
      // 對應不到時介面接在最後一個分頁
      if (from.length === 0) this.warn(`幹員 ${id}:召喚物 ${summonId} 對應不到召喚它的技能或帶出它的天賦`)
      const twSummon = this.char('tw', summonId)
      summons.push({ id: summonId, name: twSummon?.name ?? summon.name, inTw: !!twSummon, from })
      for (const f of from)
        if (f.kind === 'skill' && !summon.skills[f.no - 1]?.skillId && summon.skills.some((s) => s.skillId))
          this.warn(`幹員 ${id}:召喚物 ${summonId} 由技能${f.no}召喚,但召喚物技能表第 ${f.no} 格沒有技能`)
      // 依序是召喚物技能、召喚物特性、召喚物天賦
      const summonEntries: IndexEntry[] = this.skillEntries(summonId, summonSkillSlots(from, summon.skills.length))
      const trait = this.traitEntry(summonId, [])
      if (trait) summonEntries.push(trait)
      ;(summon.talents ?? []).forEach((_, i) => {
        const entry = this.talentEntry(summonId, i, [])
        if (entry) summonEntries.push(entry)
      })
      for (const e of summonEntries) entries.push({ ...e, summon: summonId })
    }
    this.checkUnlistedPowers(id, entries)

    const twEquips = this.input.tw?.uniequipTable?.equipDict ?? {}
    const indexModules: IndexModule[] = modules.map((m) => {
      const twEquip = twEquips[m.equip.uniEquipId]
      return { id: m.equip.uniEquipId, name: twEquip?.uniEquipName ?? m.equip.uniEquipName, code: m.equip.typeIcon.toUpperCase(), inTw: !!twEquip }
    })
    const attributes: OperatorFile['attributes'] = { cn: operatorAttributes(char) }
    if (twChar) attributes.tw = operatorAttributes(twChar)
    const powers: OperatorFile['powers'] = { cn: this.powers('cn', char) }
    if (twChar) powers.tw = this.powers('tw', twChar)
    this.operatorFiles.push({ id, inTw: !!twChar, modules: indexModules, summons, entries, attributes, powers })

    const op: IndexOperator = {
      id,
      name: twChar?.name ?? char.name,
      rarity: Number(char.rarity.replace('TIER_', '')),
      profession: char.profession as Profession,
      subProfession: char.subProfessionId,
      release: this.release(char),
      inTw: !!twChar,
      prtsPage: this.input.prtsPages?.[id] ?? char.name,
      modules: indexModules,
      summons,
      entries: entries.filter((e) => e.stages.some((st) => hasHits(st.cn) || (st.tw && hasHits(st.tw)))),
    }
    const listed = this.listedPowers(char, twChar)
    if (listed) op.powers = listed
    return op
  }

  listedPowers(char: RawCharacter, twChar: RawCharacter | undefined): PerServer<PowerId[]> | undefined {
    const of = (c: RawCharacter) => {
      const own = new Set([c, ...(c.subPower ?? [])].flatMap(powerIds))
      return this.listedPowerIds.filter((id) => own.has(id))
    }
    const cn = of(char)
    const tw = twChar ? of(twChar) : cn
    if (cn.length === 0 && tw.length === 0) return undefined
    return tw.join() === cn.join() ? { cn } : { cn, tw }
  }

  checkUnlistedPowers(id: string, entries: IndexEntry[]) {
    for (const e of entries) {
      if (e.kind === 'trait') continue
      const source = `${e.summon ? `召喚物 ${e.summon} ` : ''}${e.kind === 'talent' ? '天賦' : '技能'}${e.no}`
      for (const stage of e.stages)
        for (const [, name] of plainText(stage.cn.runs).matchAll(BRACKETED)) {
          const powerId = this.cnPowerIdByName.get(name)
          if (powerId && !this.listedPowerIds.includes(powerId)) this.warnOnce(`幹員 ${id} ${source}:【${name}】是勢力清單外的勢力 ${powerId}`)
        }
    }
  }

  powerRows(): IndexPower[][] {
    return (this.input.powerList ?? []).map((row) =>
      row.map((item) => {
        const { id, cn, tw } = powerListEntry(item)
        const name: PerServer<string> = { cn: cn ?? this.powerName('cn', id) }
        if (this.input.tw) name.tw = tw ?? this.powerName('tw', id)
        return { id, name }
      }),
    )
  }

  powers(server: Server, char: RawCharacter): OperatorPowers {
    const names = (p: RawPower) => powerIds(p).map((id) => this.powerName(server, id))
    return { power: names(char), hiddenPowers: (char.subPower ?? []).map(names) }
  }

  powerName(server: Server, id: PowerId): string {
    if (server === 'tw') {
      const name = this.input.twPowerNames?.[id]
      if (name) return name
      this.warnOnce(`台服勢力名稱對照表沒有 ${id},改用陸服名稱`)
    }
    const name = this.input.cn.handbookTeamTable?.[id]?.powerName
    if (name) return name
    this.warnOnce(`陸服勢力名稱表沒有 ${id},顯示勢力 ID`)
    return id
  }

  warnOnce(message: string) {
    if (!this.warnings.includes(message)) this.warn(message)
  }

  // ---------- 技能 ----------

  /** slots:召喚物才給,只收這幾格(1 起算),並記在 skills。 */
  skillEntries(ownerId: string, slots?: Set<number>): IndexEntry[] {
    const char = this.char('cn', ownerId)!
    const entries: IndexEntry[] = []
    const seen = new Map<string, IndexEntry | undefined>()
    char.skills.forEach((s, i) => {
      if (!s.skillId || (slots && !slots.has(i + 1))) return
      // 召喚物的技能表會在好幾格放同一個技能,只收一次,記下所有格
      if (seen.has(s.skillId)) {
        seen.get(s.skillId)?.skills?.push(i + 1)
        return
      }
      seen.set(s.skillId, undefined)
      const skillId = s.skillId
      const skill = this.input.cn.skillTable[skillId]
      if (!skill) {
        this.warn(`${ownerId}:技能表沒有 ${skillId}`)
        return
      }
      const no = i + 1
      const stages: IndexStage[] = []
      for (const { kind, index } of skillStages(skill)) {
        const level = (server: Server) => this.raw(server)?.skillTable[skillId]?.levels[index]
        const stage = this.stage({ kind }, `${ownerId} 技能${no} ${kind}`, (server) => {
          const lv = level(server)
          if (!lv) return undefined
          return this.parse(lv.description ?? '', skillValues(lv), `${serverPrefix(server)}技能 ${skillId} ${kind}`)
        })
        if (!stage) continue
        if (kind === 'max') stage.level = index + 1
        const stats = (lv: RawSkillLevel) => skillStats(lv, (type) => this.warn(`技能 ${skillId}:不認得的觸發方式 ${type},當成手動觸發`))
        stage.stats = { cn: stats(level('cn')!) }
        const tw = level('tw')
        if (stage.tw && tw) {
          const twStats = stats(tw)
          if (JSON.stringify(twStats) !== JSON.stringify(stage.stats.cn)) stage.stats.tw = twStats
        }
        stages.push(stage)
      }
      const name = this.input.tw?.skillTable[skillId]?.levels[0]?.name ?? skill.levels[0]?.name
      // 台服沒有 iconId,一律用陸服的(兩服的 skillId 相同)
      const entry: IndexEntry = { kind: 'skill', no, name, icon: skillIconPath(skillIconId(skill)), stages }
      if (slots) entry.skills = [no]
      seen.set(skillId, entry)
      entries.push(entry)
    })
    return entries
  }

  // ---------- 特性 ----------

  traitEntry(id: string, modules: ModuleLevel3[]): IndexEntry | undefined {
    const traitRuns = (server: Server) => {
      const char = this.char(server, id)
      if (!char) return undefined
      const top = [...(char.trait?.candidates ?? [])]
        .filter((c) => c.requiredPotentialRank === 0)
        .sort((a, b) => unlockOrder(b.unlockCondition) - unlockOrder(a.unlockCondition))[0]
      const raw = top?.overrideDescripton ?? char.description
      if (!raw) return undefined
      return this.parse(raw, toValues(top?.blackboard), `${serverPrefix(server)}幹員 ${id} 特性`)
    }
    const base = this.stage({ kind: 'base' }, `${id} 特性`, traitRuns)
    if (!base) return undefined
    const stages: IndexStage[] = [base]
    for (const m of modules) {
      const trait = m.trait
      if (!trait) continue
      const stage = this.stage({ kind: 'module', module: m.equip.uniEquipId }, `${id} 特性 模組3 ${m.equip.uniEquipId}`, (server) => {
        if (server !== 'cn') return undefined
        const where = `模組 ${m.equip.uniEquipId} 特性`
        const values = toValues(trait.blackboard)
        const runs = trait.overrideDescripton ? this.parse(trait.overrideDescripton, values, where) : [...(traitRuns('cn') ?? [])]
        if (trait.additionalDescription) runs.push({ t: '\n' }, ...this.parse(trait.additionalDescription, values, where))
        return runs
      })
      if (stage) stages.push(stage)
    }
    return { kind: 'trait', stages }
  }

  // ---------- 天賦 ----------

  talentEntry(id: string, index: number, modules: ModuleLevel3[]): IndexEntry | undefined {
    const no = index + 1
    const visible = (server: Server) =>
      (this.char(server, id)?.talents?.[index]?.candidates ?? []).filter((c) => !c.isHideTalent && c.description)
    const stages: IndexStage[] = []
    const base = this.stage({ kind: 'base' }, `${id} 天賦${no}`, (server) => {
      const candidates = visible(server)
      if (candidates.length === 0) return undefined
      return this.talentRuns(candidates, (c) => c.description!, `${serverPrefix(server)}幹員 ${id} 天賦${no}`)
    })
    if (base) stages.push(base)
    for (const m of modules) {
      const rewrite = m.talents.get(index)
      if (!rewrite) continue
      const stage = this.stage({ kind: 'module', module: m.equip.uniEquipId }, `${id} 天賦${no} 模組3 ${m.equip.uniEquipId}`, (server) =>
        server === 'cn' ? this.talentRuns(rewrite, (c) => c.upgradeDescription!, `模組 ${m.equip.uniEquipId} 天賦${no}`) : undefined,
      )
      if (stage) stages.push(stage)
    }
    if (stages.length === 0) return undefined
    const name = visible('tw')[0]?.name ?? visible('cn')[0]?.name ?? modules.map((m) => m.talents.get(index)?.[0].name).find(Boolean)
    return { kind: 'talent', no, name: name ?? undefined, stages }
  }

  /**
   * 模組新增的天賦:併成一段天賦,編號接續幹員原有天賦,每個新增天賦的模組各成一個模組3 階段。
   * 名稱取第一個模組的天賦名;各模組的天賦名不同時發警告。
   */
  addedTalentEntry(id: string, no: number, modules: ModuleLevel3[]): IndexEntry | undefined {
    const stages: IndexStage[] = []
    const names: string[] = []
    for (const m of modules) {
      const added = m.talents.get(-1)
      if (!added) continue
      const stage = this.stage({ kind: 'module', module: m.equip.uniEquipId }, `${id} 天賦${no} 模組3 ${m.equip.uniEquipId}`, (server) =>
        server === 'cn' ? this.talentRuns(added, (c) => c.upgradeDescription!, `模組 ${m.equip.uniEquipId} 新增天賦`) : undefined,
      )
      if (!stage) continue
      stages.push(stage)
      names.push(added[0].name ?? '')
    }
    if (stages.length === 0) return undefined
    const distinct = [...new Set(names)]
    if (distinct.length > 1) this.warn(`幹員 ${id}:各模組新增的天賦名稱不同(${distinct.join('、')}),只顯示第一個`)
    return { kind: 'talent', no, name: names[0] || undefined, stages }
  }

  /** 取最高解鎖條件(精英二)的潛能1 版本,並以高潛能版本補上「(+B)」。 */
  talentRuns<C extends RawTalentCandidate>(candidates: C[], textOf: (c: C) => string, where: string): Run[] {
    const top = Math.max(...candidates.map((c) => unlockOrder(c.unlockCondition)))
    const versions = candidates.filter((c) => unlockOrder(c.unlockCondition) === top).sort((a, b) => a.requiredPotentialRank - b.requiredPotentialRank)
    const parse = (c: C) => this.parse(textOf(c), toValues(c.blackboard), where)
    const [base, ...higher] = versions
    const baseRuns = parse(base)
    const merged = withPotentialBonus(
      baseRuns,
      higher.map((c) => ({ rank: c.requiredPotentialRank, runs: parse(c) })),
    )
    if (!merged) {
      this.warn(`${where}:潛能加成對不齊,只顯示潛能1 敘述:${textOf(versions[versions.length - 1])}`)
      return baseRuns
    }
    return merged
  }

  // ---------- 模組 ----------

  /** 幹員的進階模組,各取第3級對特性與天賦的改寫(只看幹員本身,不看召喚物)。 */
  modules(charId: string): ModuleLevel3[] {
    const { uniequipTable, battleEquipTable } = this.input.cn
    if (!uniequipTable || !battleEquipTable) return []
    const out: ModuleLevel3[] = []
    for (const equip of Object.values(uniequipTable.equipDict)) {
      if (equip.charId !== charId || equip.type !== 'ADVANCED') continue
      const level3 = battleEquipTable[equip.uniEquipId]?.phases.find((p) => p.equipLevel === 3)
      if (!level3) continue
      const parts = level3.parts.filter((p) => !p.isToken)
      out.push({ equip, trait: moduleTrait(parts), talents: moduleTalents(parts) })
    }
    return out
  }

  // ---------- 敘述文字 ----------

  /** 解析一段遊戲文字;排除的術語不帶關鍵字標記。 */
  parse(raw: string, values: Map<string, number | string>, where: string): Run[] {
    const runs = parseRichText(raw, { values, where, warn: this.warn })
    if (!runs.some((r) => r.k && this.excluded.has(r.k))) return runs
    const out: Run[] = []
    for (const r of runs) push(out, r.k && this.excluded.has(r.k) ? { ...r, k: undefined } : r)
    return out
  }

  /** 以產生器分別產生陸服與台服文字,組成一個階段。陸服沒有這段敘述時回傳 undefined。 */
  stage(head: Pick<IndexStage, 'kind' | 'module'>, where: string, produce: Producer): IndexStage | undefined {
    const cnRuns = produce('cn')
    if (!cnRuns) return undefined
    const stage: IndexStage = { ...head, cn: this.finish(cnRuns, 'cn', where) }
    const twRuns = this.input.tw ? produce('tw') : undefined
    if (twRuns) {
      const marked = markSupplements(twRuns, this.matchers.tw)
      if (signature(marked) === signature(stage.cn.runs)) {
        // 與陸服一致:沿用陸服的效果類型,陸服模式可改顯示繁中
        stage.tw = { runs: marked, hits: structuredClone(stage.cn.hits) }
        stage.twSame = true
      } else {
        stage.tw = this.finish(twRuns, 'tw', `${where}(台服)`)
      }
    }
    return stage
  }

  /**
   * 解析完成的 runs → 索引文字:標出補充關鍵字,判定每個關鍵字的效果類型
   * (覆寫檔優先,否則用規則判定,判定不出時為空清單;覆寫檔沒有的配對列入待複核清單)。
   */
  finish(parsed: Run[], server: Server, where: string): IndexText {
    const runs = markSupplements(parsed, this.matchers[server])
    const text = plainText(runs)
    const hash = textHash(text)
    const hits: IndexText['hits'] = {}
    for (const [keyword, ruleTypes] of Object.entries(ruleEffectTypes(runs))) {
      const key = `${hash}:${keyword}`
      const override = this.input.overrides?.[key]
      hits[keyword] = override ? sortTypes(override.types) : ruleTypes
      if (override) continue
      const pending = this.pending.get(key)
      if (pending) {
        if (!pending.where.includes(where)) pending.where.push(where)
      } else this.pending.set(key, { key, keyword, ruleTypes, text, where: [where] })
    }
    return { runs, hits }
  }

  // ---------- 關鍵字 ----------

  /**
   * 面板排列:維護者清單的分組與行,只留索引裡的關鍵字(重複列出的取第一次);
   * 沒列到的關鍵字歸到最後的「未分組」,為一行。空行與空分組不列。
   */
  groups(keywords: IndexKeyword[]): IndexGroup[] {
    const ids = new Set(keywords.map((k) => k.id))
    const listed = new Set<string>()
    /** 索引裡有、且還沒排進前面任何一行的關鍵字;收下後記為已排。 */
    const firstListed = (id: string) => {
      if (!ids.has(id) || listed.has(id)) return false
      listed.add(id)
      return true
    }
    const groups = (this.input.groups ?? []).map((g) => ({ name: g.name, rows: g.rows.map((row) => row.filter(firstListed)) }))
    groups.push({ name: UNGROUPED, rows: [keywords.map((k) => k.id).filter(firstListed)] })
    return groups
      .map((g) => ({ name: g.name, rows: g.rows.filter((row) => row.length > 0) }))
      .filter((g) => g.rows.length > 0)
  }

  /** 索引裡的關鍵字:敘述中用到的術語(依 id),再來是補充關鍵字(依維護者清單)。 */
  keywords(operators: IndexOperator[]): IndexKeyword[] {
    const used = new Set<string>()
    for (const op of operators)
      for (const e of op.entries)
        for (const st of e.stages) for (const k of [...Object.keys(st.cn.hits), ...Object.keys(st.tw?.hits ?? {})]) used.add(k)
    const cnTerms = this.input.cn.gamedataConst.termDescriptionDict
    const twTerms = this.input.tw?.gamedataConst.termDescriptionDict ?? {}
    const keywords: IndexKeyword[] = []
    for (const id of [...used].filter((id) => !id.startsWith('sup.')).sort((a, b) => a.localeCompare(b))) {
      // 名稱與定義優先用台服
      const term = twTerms[id] ?? cnTerms[id]
      if (!term) this.warn(`術語字典沒有 ${id}`)
      keywords.push({
        id,
        name: term?.termName ?? id,
        kind: 'term',
        definition: term ? this.parse(term.description, new Map(), `術語 ${id} 定義`) : [],
      })
    }
    for (const s of this.input.supplements ?? [])
      keywords.push({ id: supplementId(s), name: s.name, kind: 'supplement', definition: [{ t: s.definition }] })
    return keywords
  }
}

/** 警告訊息裡標出台服的文字,方便和陸服的同一段區分。 */
function serverPrefix(server: Server): string {
  return server === 'tw' ? '台服' : ''
}

function supplementId(s: SupplementKeyword): string {
  return `sup.${s.id}`
}

function isOperator(id: string, char: RawCharacter): boolean {
  return id.startsWith('char_') && (PROFESSIONS as readonly string[]).includes(char.profession) && !char.isNotObtainable
}

function hasHits(text: IndexText): boolean {
  return Object.keys(text.hits).length > 0
}

const PHASE_NUMBERS = [0, 1, 2] as const

function operatorAttributes(char: RawCharacter): OperatorAttributes {
  const phase: OperatorAttributes['phase'] | undefined = PHASE_NUMBERS[char.phases.length - 1]
  if (phase === undefined) throw new Error(`${char.name}:精英化階段有 ${char.phases.length} 個,預期 1–3 個`)
  const top = char.phases[phase]
  const a = top.attributesKeyFrames.at(-1)!.data
  const trust = char.favorKeyFrames?.at(-1)?.data
  return {
    phase,
    level: top.maxLevel,
    hp: a.maxHp,
    atk: a.atk,
    def: a.def,
    res: a.magicResistance,
    cost: a.cost,
    block: a.blockCnt,
    intervalSeconds: a.baseAttackTime,
    redeploySeconds: a.respawnTime,
    trust: { hp: trust?.maxHp ?? 0, atk: trust?.atk ?? 0, def: trust?.def ?? 0 },
  }
}

function powerIds(p: RawPower): PowerId[] {
  return [p.nationId, p.groupId, p.teamId].filter((id): id is string => !!id)
}

const PHASES: Record<string, number> = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 }

function unlockOrder(c: RawUnlockCondition): number {
  return (PHASES[c.phase] ?? 0) * 1000 + c.level
}

/**
 * 幹員會部署或產生的召喚物與帶出它的敘述:顯示用召喚物清單、技能指定的召喚物、天賦帶出的召喚物(天賦任一候選帶出的都算)。
 * 只在顯示用清單裡的召喚物沒有來源。
 */
function summonSources(char: RawCharacter): Map<string, SummonOrigin[]> {
  const out = new Map<string, SummonOrigin[]>(Object.keys(char.displayTokenDict ?? {}).map((id) => [id, []]))
  const add = (id: string, origin: SummonOrigin) => {
    const from = out.get(id) ?? []
    if (!from.some((f) => f.kind === origin.kind && f.no === origin.no)) from.push(origin)
    out.set(id, from)
  }
  char.skills.forEach((s, i) => {
    if (s.overrideTokenKey) add(s.overrideTokenKey, { kind: 'skill', no: i + 1 })
  })
  ;(char.talents ?? []).forEach((t, i) => {
    for (const c of t.candidates ?? []) if (c.tokenKey) add(c.tokenKey, { kind: 'talent', no: i + 1 })
  })
  return out
}

/**
 * 召喚物技能表第 N 格只在幹員技能 N 時生效:技能召喚的只收召喚它那幾個技能的格,
 * 天賦帶出的(任何技能都在)與對應不到來源的收全部格。
 */
function summonSkillSlots(from: SummonOrigin[], count: number): Set<number> {
  const all = from.length === 0 || from.some((f) => f.kind === 'talent')
  return new Set(all ? Array.from({ length: count }, (_, i) => i + 1) : from.map((f) => f.no))
}

function moduleTrait(parts: RawEquipPart[]): RawEquipTraitCandidate | undefined {
  for (const p of parts) {
    const c = (p.overrideTraitDataBundle?.candidates ?? []).find((c) => c.overrideDescripton || c.additionalDescription)
    if (c) return c
  }
  return undefined
}

function moduleTalents(parts: RawEquipPart[]): Map<number, RawEquipTalentCandidate[]> {
  const talents = new Map<number, RawEquipTalentCandidate[]>()
  for (const p of parts) {
    const candidates = (p.addOrOverrideTalentDataBundle?.candidates ?? []).filter((c) => c.upgradeDescription && !c.isHideTalent)
    if (candidates.length === 0 || talents.has(candidates[0].talentIndex)) continue
    talents.set(candidates[0].talentIndex, candidates)
  }
  return talents
}

/** 技能取等級7與專精3;沒有專精的技能只取最高等級。index 為 levels 的位置。 */
function skillStages(skill: RawSkill): { kind: IndexStage['kind']; index: number }[] {
  const n = skill.levels.length
  if (n >= 10) return [{ kind: 'lv7', index: 6 }, { kind: 'm3', index: 9 }]
  return [{ kind: 'max', index: n - 1 }]
}

const SP_TYPES: Record<string, SpType> = {
  INCREASE_WITH_TIME: 'time',
  INCREASE_WHEN_ATTACK: 'attack',
  INCREASE_WHEN_TAKEN_DAMAGE: 'hit',
}

const TRIGGERS: Record<string, Trigger> = { MANUAL: 'manual', AUTO: 'auto', PASSIVE: 'passive' }

/** 技能階段的技力:被動技能與沒有回復類型(spType 8)的技能不帶技力;持續時間與充能次數只留有意義的值。 */
function skillStats(level: RawSkillLevel, unknownTrigger: (type: string) => void): SkillStats {
  const trigger = TRIGGERS[level.skillType ?? '']
  if (!trigger) unknownTrigger(String(level.skillType))
  const stats: SkillStats = { trigger: trigger ?? 'manual' }
  const sp = level.spData
  const type = sp && SP_TYPES[String(sp.spType)]
  if (type && stats.trigger !== 'passive') stats.sp = { type, init: sp.initSp, cost: sp.spCost }
  if ((level.duration ?? 0) > 0) stats.duration = level.duration
  if (level.durationType === 'AMMO') stats.ammo = true
  if ((sp?.maxChargeTime ?? 1) > 1) stats.charges = sp!.maxChargeTime
  return stats
}

/** 技能圖示的檔名 id:iconId,沒有時用 skillId。 */
export function skillIconId(skill: RawSkill): string {
  return skill.iconId || skill.skillId
}

/** 技能圖示在網站上的相對路徑;不能放進網址的字元換成底線。 */
export function skillIconPath(iconId: string): string {
  return `skill-icons/${iconId.replace(/[^\w-]/g, '_')}.webp`
}

function skillValues(level: RawSkillLevel) {
  return toValues(level.blackboard, { duration: level.duration ?? 0 })
}

const NUMBER = /\d+(?:\.\d+)?/g
const BRACKETED = /【([^】]+)】/g

/** 比較陸服與台服文字是否「一致」:術語順序、數值、補充關鍵字都相同。 */
function signature(runs: Run[]): string {
  const terms = runs.filter((r) => r.k && !r.k.startsWith('sup.')).map((r) => r.k)
  const sups = [...new Set(runs.filter((r) => r.k?.startsWith('sup.')).map((r) => r.k))].sort()
  const numbers = plainText(runs).match(NUMBER) ?? []
  return JSON.stringify([terms, numbers, sups])
}

/** 敘述文字的雜湊:覆寫檔的鍵。文字一變,雜湊就變,配對就重新列入待複核。 */
function textHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16)
}

export function buildIndex(input: BuildInput): BuildOutput {
  const builder = new Builder(input)
  const index = builder.build()
  return { index, operatorFiles: builder.operatorFiles, warnings: builder.warnings, pending: [...builder.pending.values()] }
}

/**
 * 決定幹員檔的位置並寫進索引:檔名帶內容雜湊,網站更新資料後不會讀到和索引不同版本的幹員檔。
 * 回傳 網站上的相對路徑 → 檔案內容。要在幹員檔內容定案(例如拿掉缺圖的技能圖示)之後呼叫。
 */
export function attachOperatorFiles(index: SearchIndex, files: OperatorFile[]): Map<string, string> {
  const out = new Map<string, string>()
  const byId = new Map(files.map((f) => [f.id, f]))
  for (const op of index.operators) {
    const json = JSON.stringify(byId.get(op.id))
    op.detail = `data/operators/${op.id}.${textHash(json).slice(0, 8)}.json`
    out.set(op.detail, json)
  }
  return out
}
