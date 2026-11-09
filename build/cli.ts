// 維護者在本機執行:抓陸服與台服原始資料 → 建置索引 → 寫進 public/data/index.json 與 public/data/operators/。
//   npm run build-index            重新下載原始資料
//   npm run build-index:offline    沿用 .cache/raw 裡已下載的資料
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { prepareAvatars, prepareSkillIcons } from './images'
import { attachOperatorFiles, buildIndex, skillIconId, skillIconPath } from './buildIndex'
import { CACHE, DOWNLOADED_AT, loadBuildInput, readJson } from './input'
import { diffKnown, KNOWN_LISTS, type KnownList } from './known'
import { REVIEW_DIR, ROOT } from './paths'
import { DATA_SOURCES, rawBase } from '../src/core/sources'

const OUT_INDEX = join(ROOT, 'public', 'data', 'index.json')
const OUT_OPERATORS = join(ROOT, 'public', 'data', 'operators')

const SOURCES = {
  cn: {
    base: rawBase(DATA_SOURCES.cn),
    files: [
      'character_table',
      'skill_table',
      'gamedata_const',
      'uniequip_table',
      'battle_equip_table',
      'char_patch_table',
      'item_table',
      'handbook_team_table',
    ],
  },
  tw: {
    base: rawBase(DATA_SOURCES.tw),
    files: ['character_table', 'skill_table', 'gamedata_const', 'uniequip_table', 'char_patch_table'],
  },
} as const

type ServerKey = keyof typeof SOURCES

async function download(server: ServerKey, file: string): Promise<void> {
  const url = `${SOURCES[server].base}/${file}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下載失敗 ${res.status}:${url}`)
  const path = join(CACHE, server, `${file}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  console.log(`已下載 ${server}/${file}.json`)
}

/** 下載某個伺服器的所有檔案,完成後在該服快取記下下載時間。 */
async function downloadServer(server: ServerKey): Promise<void> {
  await Promise.all(SOURCES[server].files.map((file) => download(server, file)))
  await writeFile(join(CACHE, server, DOWNLOADED_AT), new Date().toISOString())
}

async function main() {
  const offline = process.argv.includes('--offline')
  if (!offline) await Promise.all((Object.keys(SOURCES) as ServerKey[]).map(downloadServer))

  const input = await loadBuildInput()
  const { cn } = input
  const { index, operatorFiles, warnings, pending, suspects } = buildIndex(input)

  // 頭像:職業形態(阿米婭)沒有專屬頭像時改用預設形態
  const formDefault = new Map<string, string>()
  for (const info of Object.values(cn.charPatchTable?.infos ?? {})) for (const id of info.tmplIds) formDefault.set(id, info.default)
  const avatars = await prepareAvatars(
    index.operators.map((o) => ({ id: o.id, candidates: [...new Set([o.id, formDefault.get(o.id) ?? o.id])] })),
    { root: ROOT, offline, warn: (m) => warnings.push(m) },
  )
  for (const op of index.operators) {
    const avatar = avatars.get(op.id)
    if (avatar) op.avatar = avatar
  }

  // 技能圖示:只下載幹員與召喚物用到的;缺圖的技能拿掉圖示路徑,介面顯示預留圖
  const iconIds = new Map<string, string>()
  for (const s of Object.values(cn.skillTable)) iconIds.set(skillIconPath(skillIconId(s)), skillIconId(s))
  const skillEntries = [...index.operators, ...operatorFiles].flatMap((o) => o.entries).filter((e) => e.icon)
  const wanted = [...new Set(skillEntries.map((e) => e.icon!))]
  const icons = await prepareSkillIcons(
    wanted.map((path) => ({ path, iconId: iconIds.get(path)! })),
    { root: ROOT, offline, warn: (m) => warnings.push(m) },
  )
  for (const e of skillEntries) if (!icons.has(e.icon!)) delete e.icon

  // 幹員檔:整個資料夾換成這次建置的檔案
  const files = attachOperatorFiles(index, operatorFiles)
  await mkdir(OUT_OPERATORS, { recursive: true })
  for (const name of await readdir(OUT_OPERATORS)) if (!files.has(`data/operators/${name}`)) await rm(join(OUT_OPERATORS, name))
  for (const [path, json] of files) await writeFile(join(ROOT, 'public', path), json)

  await mkdir(dirname(OUT_INDEX), { recursive: true })
  const json = JSON.stringify(index)
  await writeFile(OUT_INDEX, json)
  console.log(`索引:${index.operators.length} 位幹員、${index.keywords.length} 個關鍵字,${(json.length / 1024).toFixed(0)} KB`)
  console.log(`幹員檔:${files.size} 個;技能圖示:${icons.size} 個`)

  await mkdir(REVIEW_DIR, { recursive: true })
  await writeFile(join(REVIEW_DIR, 'pending-review.json'), JSON.stringify(pending, null, 1))
  console.log(`待複核:${pending.length} 個配對(review/pending-review.json)`)
  await writeFile(KNOWN_LISTS.suspects.all, JSON.stringify(suspects, null, 1))
  await reportKnown(KNOWN_LISTS.suspects, suspects, (s) => s.key, (s) => `${s.key}(${s.where})`)
  await writeFile(KNOWN_LISTS.warnings.all, warnings.join('\n') + '\n')
  await reportKnown(KNOWN_LISTS.warnings, warnings, (w) => w, (w) => w)
}

/** 與已知清單比對:寫出新出現與已消失的項目,印出摘要與前 10 則新項目。 */
async function reportKnown<T>(list: KnownList, items: T[], keyOf: (item: T) => string, describe: (item: T) => string) {
  const diff = diffKnown(items.map(keyOf), await readJson<string[]>(list.known))
  const addedKeys = new Set(diff.added)
  const added = items.filter((item) => addedKeys.has(keyOf(item)))
  await writeFile(list.added, JSON.stringify(added, null, 2) + '\n')
  await writeFile(list.resolved, JSON.stringify(diff.resolved, null, 2) + '\n')
  const shown = (path: string) => `review/${basename(path)}`
  console.log(`${list.noun}:共 ${items.length} 則(${shown(list.all)})`)
  console.log(`  ${list.newNoun}:${added.length} 則(${shown(list.added)})`)
  console.log(`  已消失的已知${list.noun}:${diff.resolved.length} 則(${shown(list.resolved)})`)
  if (added.length === 0) return
  console.warn(`⚠ ${list.newNoun}前 10 則:`)
  for (const item of added.slice(0, 10)) console.warn('  ' + describe(item))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
