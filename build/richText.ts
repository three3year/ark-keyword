// 遊戲敘述文字的解析:填入佔位符、拆出術語標記與樣式標記,產生供高亮與懸停定義使用的 runs。
//
// 標記語法:
//   <@style.id>…</>  樣式標記(只影響顏色)
//   <$term.id>…</>   術語標記(帶官方定義的效果詞)
//   </>              關閉最內層標記;標記可以巢狀
// 其他角括號(例如「<替身>」)是純文字。
// 佔位符:{key}、{key:0%}、{key:0.0}、{-key:0%}、{a@b:0%}、{x.y};key 不分大小寫。
import type { Run } from '../src/core/types'
import type { RawBlackboard } from './raw'

export type Values = Map<string, number | string>

export interface ParseContext {
  values: Values
  /** 警告訊息中用來定位的描述,例如「技能 skchr_x_1 等級7」。 */
  where: string
  warn: (message: string) => void
}

const STYLE_CLASS: Record<string, string> = {
  'ba.vup': 'up',
  'ba.vdown': 'down',
  'ba.kw': 'kw',
  'ba.rem': 'rem',
  'ba.talpu': 'pot',
}

/** 只有戰鬥術語(ba.*)會成為關鍵字。 */
export function isBattleTerm(termId: string): boolean {
  return termId.startsWith('ba.')
}

/** 會成為關鍵字的戰鬥術語:ba. 開頭、不在不當關鍵字的術語清單裡。 */
export function isKeywordTerm(termId: string, excluded: Set<string>): boolean {
  return isBattleTerm(termId) && !excluded.has(termId)
}

export function toValues(blackboard: RawBlackboard, extra?: Record<string, number>): Values {
  const values: Values = new Map()
  if (Array.isArray(blackboard)) {
    for (const item of blackboard) {
      const v = item.valueStr != null && item.valueStr !== '' ? item.valueStr : item.value
      if (v != null) values.set(item.key.toLowerCase(), v)
    }
  } else if (blackboard) {
    for (const [key, v] of Object.entries(blackboard)) values.set(key.toLowerCase(), v)
  }
  for (const [key, v] of Object.entries(extra ?? {})) if (!values.has(key)) values.set(key, v)
  return values
}

function trimNumber(v: number): string {
  return String(Number(v.toFixed(6)))
}

function formatValue(value: number, format: string | undefined): string | undefined {
  if (format === undefined || format === '') return trimNumber(value)
  const m = /^0(?:\.(0+))?(%)?$/.exec(format)
  if (!m) return undefined
  const decimals = m[1]?.length ?? 0
  const scaled = m[2] ? value * 100 : value
  // 遊戲以「四捨五入遠離零」格式化;先去掉浮點誤差再取位數
  const rounded = Math.sign(scaled) * Math.round(Number(Math.abs(scaled).toFixed(6)) * 10 ** decimals) / 10 ** decimals
  return rounded.toFixed(decimals) + (m[2] ?? '')
}

function fillPlaceholders(raw: string, ctx: ParseContext): string {
  return raw.replace(/\{(-?)([^{}:]+)(?::([^{}]*))?\}/g, (whole, neg: string, key: string, format: string | undefined) => {
    const v = ctx.values.get(key.trim().toLowerCase())
    if (v === undefined) {
      ctx.warn(`${ctx.where}:找不到佔位符 ${whole} 的數值:${raw}`)
      return whole
    }
    if (typeof v === 'string') return v
    const text = formatValue(neg ? -v : v, format)
    if (text === undefined) {
      ctx.warn(`${ctx.where}:無法辨識的佔位符格式 ${whole}:${raw}`)
      return trimNumber(v)
    }
    return text
  })
}

interface Open {
  kind: 'style' | 'term'
  id: string
}

/** 解析一段敘述。回傳的 runs 中,戰鬥術語的文字帶 k(術語 id),包住它的【】留在高亮之外。 */
export function parseRichText(raw: string, ctx: ParseContext): Run[] {
  // 遊戲文字以字面的「\n」兩個字元表示換行
  const text = fillPlaceholders(raw, ctx).replaceAll('\\n', '\n')
  const runs: Run[] = []
  const stack: Open[] = []

  const emit = (t: string) => {
    if (!t) return
    const term = [...stack].reverse().find((o) => o.kind === 'term')
    const style = [...stack].reverse().find((o) => o.kind === 'style')
    const k = term && isBattleTerm(term.id) ? term.id : undefined
    const s = style ? STYLE_CLASS[style.id] : undefined
    if (k) {
      // 術語標記包住【】時,括號不算在高亮內
      const m = /^(【?)(.*?)(】?)$/s.exec(t)!
      push(runs, { t: m[1], s })
      push(runs, { t: m[2], k, s })
      push(runs, { t: m[3], s })
    } else {
      push(runs, { t, s })
    }
  }

  let i = 0
  let buf = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '<') {
      const rest = text.slice(i)
      const open = /^<([@$])([A-Za-z0-9_.]+)>/.exec(rest)
      if (open) {
        emit(buf)
        buf = ''
        stack.push({ kind: open[1] === '@' ? 'style' : 'term', id: open[2] })
        i += open[0].length
        continue
      }
      if (rest.startsWith('</>')) {
        emit(buf)
        buf = ''
        if (stack.length === 0) ctx.warn(`${ctx.where}:多出的關閉標記 </>:${raw}`)
        else stack.pop()
        i += 3
        continue
      }
      // 全是 ASCII 卻不合語法的角括號,是無法辨識的標記;其他(例如「<替身>」)是純文字
      const tag = /^<[!-~]+>/.exec(rest)
      if (tag) ctx.warn(`${ctx.where}:無法辨識的標記 ${tag[0]}:${raw}`)
    }
    buf += ch
    i++
  }
  emit(buf)
  if (stack.length > 0) ctx.warn(`${ctx.where}:標記未關閉:${raw}`)
  return runs
}

/** 加入一段 run,與前一段屬性相同時合併。 */
export function push(runs: Run[], run: Run): void {
  if (!run.t) return
  const last = runs[runs.length - 1]
  if (last && last.k === run.k && last.s === run.s && last.p === run.p) {
    last.t += run.t
    return
  }
  const clean: Run = { t: run.t }
  if (run.k) clean.k = run.k
  if (run.s) clean.s = run.s
  if (run.p) clean.p = run.p
  runs.push(clean)
}

export function plainText(runs: Run[]): string {
  return runs.map((r) => r.t).join('')
}
