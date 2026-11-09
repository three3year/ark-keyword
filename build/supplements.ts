// 補充關鍵字:遊戲沒有標記為術語、由維護者清單比對純文字的關鍵字(推、拉、沉默、減速…)。
// 術語比對清單(遊戲漏標的術語)也走同一輪比對。
// 比對在整段純文字上進行,所以可以跨越樣式標記;已在術語標記內的文字不比對,避免重複計算。
import type { Run } from '../src/core/types'
import { push } from './richText'

export interface SupplementMatcher {
  /** 關鍵字 id:補充關鍵字為 sup.xxx,術語比對清單為術語 id。 */
  id: string
  strings: string[]
}

/** 在 runs 中標出補充關鍵字。較長的比對字串優先,已標記的文字不再重疊標記。 */
export function markSupplements(runs: Run[], matchers: SupplementMatcher[]): Run[] {
  if (matchers.length === 0) return runs
  const text = runs.map((r) => r.t).join('')
  // 每個字元目前的關鍵字:術語的字元一開始就佔用
  const owner: (string | undefined)[] = []
  for (const r of runs) for (let i = 0; i < r.t.length; i++) owner.push(r.k)

  const patterns = matchers
    .flatMap((m) => m.strings.filter(Boolean).map((s) => ({ id: m.id, s })))
    .sort((a, b) => b.s.length - a.s.length)
  let changed = false
  for (const { id, s } of patterns) {
    for (let from = text.indexOf(s); from !== -1; from = text.indexOf(s, from + 1)) {
      if (owner.slice(from, from + s.length).some(Boolean)) continue
      for (let i = from; i < from + s.length; i++) owner[i] = id
      changed = true
    }
  }
  if (!changed) return runs

  const out: Run[] = []
  let offset = 0
  for (const r of runs) {
    for (let i = 0; i < r.t.length; i++) {
      const k = owner[offset + i]
      // 新標上的補充關鍵字不保留樣式,跨越樣式標記的命中才會合成一段高亮
      const fresh = k && k !== r.k
      push(out, { ...r, t: r.t[i], k, s: fresh ? undefined : r.s })
    }
    offset += r.t.length
  }
  return out
}
