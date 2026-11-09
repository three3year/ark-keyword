// 把一份已知清單改成最近一次建置的全部:加入新出現的、移除已消失的(兩者是建置寫在 review/ 的比對結果)。
//   npm run accept-warnings    已知警告清單 data/known-warnings.json
//   npm run accept-suspects    已知疑似漏標清單 data/known-suspects.json
// 維護者確認新出現的都不必處理後,緊接在建置之後執行。
import { readFile, writeFile } from 'node:fs/promises'
import { KNOWN_LISTS } from './known'

async function readList<T>(path: string): Promise<T[]> {
  return JSON.parse(await readFile(path, 'utf8')) as T[]
}

async function main() {
  const which = process.argv[2]
  if (!(which && which in KNOWN_LISTS)) throw new Error(`用法:tsx build/acceptKnown.ts <${Object.keys(KNOWN_LISTS).join('|')}>`)
  const list = KNOWN_LISTS[which as keyof typeof KNOWN_LISTS]
  const known = await readList<string>(list.known)
  const added = (await readList<string | { key: string }>(list.added)).map((item) => (typeof item === 'string' ? item : item.key))
  const resolved = new Set(await readList<string>(list.resolved))
  const next = [...new Set([...known.filter((k) => !resolved.has(k)), ...added])]
  await writeFile(list.known, JSON.stringify(next, null, 2) + '\n')
  console.log(`${list.name}:加入 ${added.length} 則、移除 ${resolved.size} 則,共 ${next.length} 則`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
