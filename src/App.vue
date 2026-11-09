<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { loadIndex } from './core/loadIndex'
import { availableTypes, branchName, defaultType, filterOptions, footerItems, powerName, query, startsSearch } from './core/query'
import {
  EFFECT_TYPE_LABELS,
  EFFECT_TYPES,
  PROFESSION_LABELS,
  PROFESSIONS,
  type EffectType,
  type IndexKeyword,
  type Profession,
  type ResultOperator,
  type SearchCondition,
  type SearchIndex,
  type Server,
  sortTypes,
} from './core/types'
import FilterBar from './components/FilterBar.vue'
import KeywordPanel from './components/KeywordPanel.vue'
import KeywordTip from './components/KeywordTip.vue'
import OperatorDetail from './components/OperatorDetail.vue'
import ResultCard from './components/ResultCard.vue'
import { loadAppearance, loadServer, saveAppearance, saveServer, type Appearance } from './ui/storage'
import { hideTip, isTouch, showTip, tip } from './ui/tip'

const index = shallowRef<SearchIndex>()
const error = ref('')
/** 搜尋條件:每個 chip 一個關鍵字(依加入順序)與它亮著的效果類型,每亮一顆就是一個搜尋條件。 */
const selection = ref<{ keyword: string; types: EffectType[] }[]>([])
const selected = computed(() => selection.value.map((s) => s.keyword))
const conditions = computed<SearchCondition[]>(() => selection.value.flatMap((s) => s.types.map((type) => ({ keyword: s.keyword, type }))))
const server = ref<Server>(loadServer())
watch(server, saveServer)
const SERVERS: { value: Server; label: string }[] = [
  { value: 'cn', label: '陸服' },
  { value: 'tw', label: '台服' },
]
/** 外觀:固定亮色或暗色時標記在根元素上,跟隨系統時不標記,交給系統偏好。 */
const appearance = ref<Appearance>(loadAppearance())
watch(appearance, saveAppearance)
watch(
  appearance,
  (a) => {
    if (a === 'system') delete document.documentElement.dataset.appearance
    else document.documentElement.dataset.appearance = a
  },
  { immediate: true },
)
/** 鈕面寫縮寫,懸停文字與無障礙名稱用全名。 */
const APPEARANCES: { value: Appearance; label: string; fullName: string }[] = [
  { value: 'system', label: '系統', fullName: '跟隨系統' },
  { value: 'light', label: '亮', fullName: '亮色' },
  { value: 'dark', label: '暗', fullName: '暗色' },
]
const rarities = ref<number[]>([])
/** 職業條件:彼此 OR,與搜尋條件 AND。 */
const professions = ref<Profession[]>([])
/** 職業條件依遊戲內職業順序,不依點選先後。 */
const sortedProfessions = computed(() => PROFESSIONS.filter((p) => professions.value.includes(p)))
/** 勢力條件(勢力 id):彼此 OR,與搜尋條件、職業條件 AND;切換伺服器不改。 */
const powers = ref<string[]>([])
/** 勢力條件依面板(維護者清單)順序,不依點選先後。 */
const sortedPowers = computed(() =>
  (index.value?.powerRows.flat() ?? []).map((p) => p.id).filter((id) => powers.value.includes(id)),
)
const searching = computed(() => startsSearch({ conditions: conditions.value, professions: professions.value, powers: powers.value }))
// 窄螢幕上關鍵字面板收合成抽屜
const drawerOpen = ref(false)
/** 抽屜鈕計數:抽屜裡亮著的鈕(關鍵字與勢力);職業鈕不在抽屜裡,不算。 */
const drawerCount = computed(() => selected.value.length + powers.value.length)

onMounted(async () => {
  try {
    index.value = await loadIndex()
  } catch (e) {
    error.value = String(e)
  }
})

const keywordMap = computed(() => new Map<string, IndexKeyword>((index.value?.keywords ?? []).map((k) => [k.id, k])))
const footer = computed(() => (index.value ? footerItems(index.value) : []))
const options = computed(() => (index.value ? filterOptions(index.value) : { rarities: [], professions: [] }))
const results = computed(() =>
  index.value
    ? query(index.value, {
        conditions: conditions.value,
        server: server.value,
        rarities: rarities.value,
        professions: professions.value,
        powers: powers.value,
      })
    : [],
)

/** 各 chip 的關鍵字在目前伺服器有資料的效果類型;沒資料的類型鈕反灰。 */
const available = computed(
  () => new Map(selection.value.map((s) => [s.keyword, index.value ? availableTypes(index.value, server.value, s.keyword) : []])),
)

function hasData(id: string, type: EffectType): boolean {
  return !!available.value.get(id)?.includes(type)
}

/** 沒有結果時列出目前生效的條件,讓使用者知道要放寬哪一項。 */
const emptyConditions = computed(() => {
  const list: string[] = []
  if (professions.value.length) list.push(`職業:${sortedProfessions.value.map((p) => PROFESSION_LABELS[p]).join('、')}`)
  if (powers.value.length) list.push(`勢力:${sortedPowers.value.map(powerLabel).join('、')}`)
  if (conditions.value.length) list.push(`搜尋條件:${conditions.value.map((c) => `${EFFECT_TYPE_LABELS[c.type]}-${keywordName(c.keyword)}`).join('、')}`)
  list.push(`伺服器:${server.value === 'tw' ? '台服' : '陸服'}`)
  if (rarities.value.length) list.push(`星級:${[...rarities.value].sort((a, b) => b - a).map((r) => `${r}★`).join('、')}`)
  return list
})

function keywordName(id: string): string {
  return keywordMap.value.get(id)?.name ?? id
}

/**
 * 關鍵字面板的點選:未選就加入,只亮目前伺服器有資料的第一個類型(通常是施加,最常問的「誰能上 X」);已選就移除。
 * 之後切換伺服器不改已加入的 chip。
 */
function toggle(id: string) {
  if (selected.value.includes(id)) remove(id)
  else if (index.value) selection.value = [...selection.value, { keyword: id, types: [defaultType(index.value, server.value, id)] }]
}

function remove(id: string) {
  selection.value = selection.value.filter((s) => s.keyword !== id)
}

function removeProfession(p: Profession) {
  professions.value = professions.value.filter((x) => x !== p)
}

/** 面板的勢力鈕:未選就加入,已選就移除。 */
function togglePower(id: string) {
  powers.value = powers.value.includes(id) ? powers.value.filter((x) => x !== id) : [...powers.value, id]
}

function powerLabel(id: string): string {
  return index.value ? powerName(index.value, server.value, id) : id
}

/** chip 上的類型鈕:切換該類型;關掉最後一顆等於移除 chip。 */
function toggleType(id: string, type: EffectType) {
  selection.value = selection.value
    .map((s) => {
      if (s.keyword !== id) return s
      const on = s.types.includes(type) ? s.types.filter((t) => t !== type) : [...s.types, type]
      return { keyword: id, types: sortTypes(on) }
    })
    .filter((s) => s.types.length > 0)
}

// ---- 幹員詳情 ----

/** 打開中的幹員詳情;每次打開都是新的一份(分頁與階段回到預設)。 */
const detail = shallowRef<{ op: ResultOperator; path?: string; key: number }>()
let detailTrigger: HTMLElement | undefined
let opened = 0

/** 打開時加一筆瀏覽紀錄(網址不變),讓返回鍵關閉詳情而不是離開網站。 */
function openDetail(op: ResultOperator, trigger: HTMLElement) {
  hideTip()
  detailTrigger = trigger
  detail.value = { op, path: index.value?.operators.find((o) => o.id === op.id)?.detail, key: ++opened }
  history.pushState({ operatorDetail: true }, '')
}

/** 關閉鈕、Esc、點背景:收回打開時加的瀏覽紀錄,由 popstate 關閉。 */
function closeDetail() {
  if (!detail.value) return
  if (history.state?.operatorDetail) history.back()
  else hideDetail()
}

function hideDetail() {
  detail.value = undefined
  hideTip()
  nextTick(() => detailTrigger?.focus())
}

function onPopState() {
  if (detail.value) hideDetail()
}

// 詳情打開時背後的頁面不捲動
watch(detail, (d) => document.documentElement.classList.toggle('modal-open', !!d))

// ---- 提示框:以事件委派處理所有帶 data-k(關鍵字)與 data-p(潛能加成、信賴加成)的元素 ----

function target(e: Event): HTMLElement | null {
  return (e.target as HTMLElement | null)?.closest?.('[data-k],[data-p]') ?? null
}

function onOver(e: MouseEvent) {
  if (isTouch() || tip.pinned) return
  const el = target(e)
  if (!el) return
  if (el.dataset.k) showTip(el, { keyword: el.dataset.k })
  else if (el.dataset.p) showTip(el, { text: el.dataset.p })
}

function onOut(e: MouseEvent) {
  if (tip.pinned) return
  if (target(e)) hideTip()
}

function onClick(e: MouseEvent) {
  const el = target(e)
  if (!el) {
    if (tip.pinned) hideTip()
    return
  }
  if (el.dataset.p) {
    showTip(el, { text: el.dataset.p }, { pinned: true })
  } else if (el.dataset.k && el.classList.contains('chip-name')) {
    showTip(el, { keyword: el.dataset.k }, { pinned: true })
  } else if (el.dataset.k && el.classList.contains('kw') && isTouch()) {
    // 觸控裝置沒有懸停:點面板的關鍵字按鈕時,除了切換選取也顯示定義
    showTip(el, { keyword: el.dataset.k }, { pinned: true })
  } else if (el.dataset.k && el.closest('.rich') && (isTouch() || el.closest('.detail'))) {
    // 敘述裡的詞只供查定義、不切換選取:觸控裝置沒有懸停,點了顯示定義;
    // 幹員詳情裡桌機點擊也釘住定義;結果卡上桌機點擊不做事
    showTip(el, { keyword: el.dataset.k }, { pinned: true })
  } else if (el.dataset.k && tip.pinned) {
    // 桌機點不釘選的詞:關掉釘住的提示框,改顯示這個詞的懸停提示
    showTip(el, { keyword: el.dataset.k })
  }
}

/** Esc:詳情裡釘住的定義先關掉,再按一次才關閉詳情。 */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const pinnedInDetail = !!detail.value && tip.pinned
  hideTip()
  drawerOpen.value = false
  if (!pinnedInDetail) closeDetail()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('popstate', onPopState)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('popstate', onPopState)
})
</script>

<template>
  <div class="app" @mouseover="onOver" @mouseout="onOut" @click="onClick">
    <header class="top">
      <h1>明日方舟關鍵字搜尋</h1>
      <div class="toggles">
        <div v-if="index" class="segmented" role="radiogroup" aria-label="伺服器">
          <button
            v-for="sv in SERVERS"
            :key="sv.value"
            role="radio"
            :aria-checked="server === sv.value"
            :class="{ on: server === sv.value }"
            @click="server = sv.value"
          >
            {{ sv.label }}
          </button>
        </div>
        <!-- 外觀不需要資料:載入中與錯誤頁也能切 -->
        <div class="segmented" role="radiogroup" aria-label="外觀">
          <button
            v-for="a in APPEARANCES"
            :key="a.value"
            role="radio"
            :aria-checked="appearance === a.value"
            :aria-label="a.fullName"
            :title="a.fullName"
            :class="{ on: appearance === a.value }"
            @click="appearance = a.value"
          >
            {{ a.label }}
          </button>
        </div>
      </div>
    </header>
    <!-- 窄螢幕上浮在右下角;抽屜打開時隱藏 -->
    <button v-if="index" v-show="!drawerOpen" class="drawer-btn" @click.stop="drawerOpen = true">
      關鍵字<template v-if="drawerCount">({{ drawerCount }})</template>
    </button>
    <p v-if="error" class="error">{{ error }}</p>
    <main v-else-if="index" class="layout">
      <div v-if="drawerOpen" class="backdrop" @click="drawerOpen = false"></div>
      <aside class="panel" :class="{ open: drawerOpen }" aria-label="關鍵字面板">
        <div class="drawer-head">
          <strong>關鍵字</strong>
          <button class="btn" @click="drawerOpen = false">完成</button>
        </div>
        <KeywordPanel
          :index="index"
          :server="server"
          :selected="selected"
          :powers="powers"
          @toggle="toggle"
          @toggle-power="togglePower"
        />
      </aside>
      <section class="results">
        <FilterBar v-model:rarities="rarities" v-model:professions="professions" :options="options" />
        <!-- 職業與勢力 chip 一行在上(職業在前)、搜尋條件 chip 在下 -->
        <div v-if="sortedProfessions.length > 0 || powers.length > 0" class="chips">
          <span v-for="p in sortedProfessions" :key="p" class="chip profession-chip" data-testid="profession-chip">
            <span class="profession-name">{{ PROFESSION_LABELS[p] }}</span>
            <button class="chip-x" :aria-label="`移除 ${PROFESSION_LABELS[p]}`" @click.stop="removeProfession(p)">×</button>
          </span>
          <span v-for="p in sortedPowers" :key="p" class="chip power-chip" data-testid="power-chip">
            <span class="power-name">{{ powerLabel(p) }}</span>
            <button class="chip-x" :aria-label="`移除 ${powerLabel(p)}`" @click.stop="togglePower(p)">×</button>
          </span>
        </div>
        <div v-if="selection.length > 0" class="chips">
          <span v-for="s in selection" :key="s.keyword" class="chip" data-testid="chip">
            <span :data-k="s.keyword" class="chip-name">{{ keywordName(s.keyword) }}</span>
            <span class="chip-types" role="group" :aria-label="`${keywordName(s.keyword)}的效果類型`">
              <!-- 沒資料的類型鈕不能點;已亮著的(例如切換伺服器後才沒資料)仍可關掉 -->
              <button
                v-for="t in EFFECT_TYPES"
                :key="t"
                type="button"
                class="chip-type"
                :class="[`fx-${t}`, { on: s.types.includes(t), 'no-data': !hasData(s.keyword, t) }]"
                :aria-pressed="s.types.includes(t)"
                :disabled="!hasData(s.keyword, t) && !s.types.includes(t)"
                :title="hasData(s.keyword, t) ? undefined : `目前伺服器沒有${EFFECT_TYPE_LABELS[t]}-${keywordName(s.keyword)}的敘述`"
                @click.stop="toggleType(s.keyword, t)"
              >
                {{ EFFECT_TYPE_LABELS[t] }}
              </button>
            </span>
            <button class="chip-x" :aria-label="`移除 ${keywordName(s.keyword)}`" @click.stop="remove(s.keyword)">×</button>
          </span>
        </div>
        <p v-if="!searching" class="hint">點選關鍵字、職業或勢力開始搜尋</p>
        <template v-else>
          <div class="result-meta">
            <span data-testid="result-count">共 {{ results.length }} 位幹員</span>
            <span class="sort-note" title="遊戲資料沒有實裝時間,實裝順序以潛能信物編號近似">排序:星級 → 職業 → 分支 → 實裝新到舊(近似)</span>
          </div>
          <div v-if="results.length === 0" class="empty" data-testid="empty">
            <strong>沒有符合的幹員</strong>
            <ul>
              <li v-for="c in emptyConditions" :key="c">{{ c }}</li>
            </ul>
          </div>
          <!-- 只有職業或勢力條件時結果卡只有卡頭:排成多欄的小卡 -->
          <div class="result-list" :class="{ compact: conditions.length === 0 }" data-testid="result-list">
            <ResultCard
              v-for="op in results"
              :key="op.id"
              :op="op"
              :selected="selected"
              :keywords="keywordMap"
              :branch-name="branchName(index, op)"
              @open="(trigger) => openDetail(op, trigger)"
            />
          </div>
        </template>
      </section>
    </main>
    <p v-else class="hint">載入中…</p>
    <footer v-if="index" class="footer">
      <template v-for="(item, i) in footer" :key="item.label">
        <template v-if="i > 0"> · </template>
        <a :href="item.source.url" target="_blank" rel="noopener noreferrer" :title="`資料來源:${item.source.name}`">{{ item.label }}</a>
        <template v-if="item.version">{{ ` ${item.version} · ${item.downloadedAt}` }}</template>
      </template>
    </footer>
    <OperatorDetail
      v-if="index && detail"
      :key="detail.key"
      :op="detail.op"
      :path="detail.path"
      :branch-name="branchName(index, detail.op)"
      :server="server"
      :conditions="conditions"
      :selected="selected"
      :keywords="keywordMap"
      @close="closeDetail"
    />
    <KeywordTip :keywords="keywordMap" />
  </div>
</template>
