// 用法:node count.mjs <operators 資料夾> <cn|tw> <字串1> [字串2...]
// 列出敘述純文字含任一字串的幹員 id 與敘述條數;召喚物的敘述在 entries 裡(帶 summon 欄位),算在幹員名下。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, srv, ...needles] = process.argv.slice(2)
const ops = new Set()
let descs = 0
for (const f of readdirSync(dir)) {
  const o = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  if (srv === 'tw' && !o.inTw) continue

  const entries = o.entries ?? []
  for (const e of entries) {
    for (const st of e.stages ?? []) {
      const side = st[srv]
      if (!side) continue
      const text = side.runs.map((r) => r.t).join('')
      if (needles.some((n) => text.includes(n))) {
        descs++
        ops.add(o.id)
      }
    }
  }
}
console.log(`${ops.size} 位 / ${descs} 段`)
console.log([...ops].join('、'))
