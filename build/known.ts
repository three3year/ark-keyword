// 已知清單:維護者確認過、不必每次都處理的建置警告與疑似漏標。
// 建置指令(build/cli.ts)把這次的清單與已知清單比對,寫出新出現的與已消失的;
// build/acceptKnown.ts 據以把已知清單改成這次的全部。
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

/** 一份已知清單與建置寫出的兩份比對結果。 */
export interface KnownList {
  /** 摘要裡的名稱。 */
  name: string
  /** 維護者清單,內容是識別鍵的列表。 */
  known: string
  /** 已知清單裡沒有的;每項是識別鍵,或帶識別鍵 key 的物件。 */
  added: string
  /** 已知清單裡有、這次沒出現的識別鍵。 */
  resolved: string
}

export const KNOWN_LISTS = {
  /** 警告以全文當識別鍵。 */
  warnings: {
    name: '已知警告',
    known: join(ROOT, 'data', 'known-warnings.json'),
    added: join(ROOT, 'review', 'new-warnings.json'),
    resolved: join(ROOT, 'review', 'resolved-warnings.json'),
  },
  /** 疑似漏標以「伺服器 關鍵字 前後文」當識別鍵。 */
  suspects: {
    name: '已知疑似漏標',
    known: join(ROOT, 'data', 'known-suspects.json'),
    added: join(ROOT, 'review', 'new-suspects.json'),
    resolved: join(ROOT, 'review', 'resolved-suspects.json'),
  },
} satisfies Record<string, KnownList>

/** 以識別鍵比對(一字不差才算同一則),分出新出現的與已消失的已知項目。 */
export function diffKnown(current: string[], known: string[]): { added: string[]; resolved: string[] } {
  const currentSet = new Set(current)
  const knownSet = new Set(known)
  return {
    added: current.filter((k) => !knownSet.has(k)),
    resolved: known.filter((k) => !currentSet.has(k)),
  }
}
