import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const patterns = {
  '防御力(全部)': /防御力/g,
  '防御力,扣掉減防比對字串已涵蓋的': /防御力(?!-|下降|降低|额外-)/g,
  '法术抗性(全部)': /法术抗性/g,
  '法术抗性,扣掉減抗比對字串已涵蓋的': /法术抗性(?!-)/g,
}
const contexts = Object.fromEntries(Object.keys(patterns).map((k) => [k, new Set()]))
for (const f of readdirSync(dir)) {
  const o = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  for (const e of o.entries ?? [])
    for (const st of e.stages ?? []) {
      if (!st.cn) continue
      const t = st.cn.runs.map((r) => r.t).join('').replace(/\d+(\.\d+)?/g, '#')
      for (const [k, p] of Object.entries(patterns))
        for (const m of t.matchAll(p)) contexts[k].add(t.slice(Math.max(0, m.index - 8), m.index + m[0].length + 8))
    }
}
for (const [k, s] of Object.entries(contexts)) console.log(`${k}: ${s.size}`)
