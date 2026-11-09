// 天賦的潛能加成「A(+B)」:A 取潛能1 的敘述;B 取高潛能版本裡 <@ba.talpu>(+B)</> 標記,
// 插在潛能1 敘述中對應數字的後面。以「第幾個數字」對齊,所以兩個版本的數字個數必須相同
// (遊戲資料裡偶有措辭不同,例如「当阻挡住」與「阻挡」,數字順序仍一致)。
import type { Run } from '../src/core/types'
import { plainText, push, startsMark } from './richText'

export interface PotentialVersion {
  /** requiredPotentialRank:潛能等級 - 1。 */
  rank: number
  runs: Run[]
}

const NUMBER = /\d+(?:\.\d+)?/g

interface Bonus {
  text: string
  /** 標記與前一個數字結尾之間的文字長度(例如「9%」的「%」)。 */
  gap: number
  minRank: number
  maxRank: number
}

/** 找出一個高潛能版本中的加成標記:標記前面是第幾個數字、與該數字相隔幾個字、加成文字。 */
function markers(runs: Run[]): { after: number; gap: number; text: string }[] {
  const found: { after: number; gap: number; text: string }[] = []
  let visible = ''
  for (const r of runs) {
    if (r.s === 'pot') {
      const numbers = [...visible.matchAll(NUMBER)]
      const last = numbers[numbers.length - 1]
      const gap = last ? visible.length - (last.index! + last[0].length) : 0
      found.push({ after: numbers.length, gap, text: r.t })
    } else visible += r.t
  }
  return found
}

function label(b: Bonus): string {
  return b.minRank === b.maxRank ? `潛能 ${b.minRank + 1} 獲得` : `潛能 ${b.minRank + 1}~${b.maxRank + 1} 逐級獲得`
}

/** 在 base 敘述中插入潛能加成。對不齊時回傳 undefined,由呼叫端警告。 */
export function withPotentialBonus(base: Run[], higher: PotentialVersion[]): Run[] | undefined {
  if (higher.length === 0) return base
  const bonuses = new Map<number, Bonus>()
  for (const v of [...higher].sort((a, b) => a.rank - b.rank)) {
    for (const m of markers(v.runs)) {
      const prev = bonuses.get(m.after)
      bonuses.set(m.after, { text: m.text, gap: m.gap, minRank: prev?.minRank ?? v.rank, maxRank: v.rank })
    }
  }
  if (bonuses.size === 0) return base

  const top = [...higher].sort((a, b) => b.rank - a.rank)[0]
  const topVisible = plainText(top.runs.filter((r) => r.s !== 'pot'))
  const numbers = [...plainText(base).matchAll(NUMBER)]
  if ((topVisible.match(NUMBER) ?? []).length !== numbers.length) return undefined

  // 計算每個要插入加成的位置(base 純文字中第 n 個數字的結尾,再加上單位等間隔字)
  const inserts = new Map<number, Bonus>()
  for (const [after, bonus] of bonuses) {
    const n = numbers[after - 1]
    if (!n) return undefined
    inserts.set(n.index! + n[0].length + bonus.gap, bonus)
  }

  const out: Run[] = []
  let offset = 0
  base.forEach((r, index) => {
    let start = 0
    for (let i = 1; i <= r.t.length; i++) {
      const bonus = inserts.get(offset + i)
      if (!bonus) continue
      push(out, { ...r, t: r.t.slice(start, i) }, start === 0 && startsMark(base, index))
      push(out, { t: bonus.text, s: 'pot', p: label(bonus) })
      start = i
    }
    push(out, { ...r, t: r.t.slice(start) }, start === 0 && startsMark(base, index))
    offset += r.t.length
  })
  return out
}
