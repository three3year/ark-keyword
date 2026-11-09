// 維護者在本機執行:抓陸服與台服原始資料 → 建置索引 → 寫進 public/data/index.json 與 public/data/operators/。
//   npm run build-index            重新下載原始資料
//   npm run build-index:offline    沿用 .cache/raw 裡已下載的資料
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prepareAvatars, prepareSkillIcons } from './images'
import { attachOperatorFiles, buildIndex, type KeywordGroup, type Overrides, type PowerList, skillIconId, skillIconPath, type SupplementKeyword } from './buildIndex'
import type { RawServer } from './raw'
import { diffWarnings, KNOWN_WARNINGS, NEW_WARNINGS, RESOLVED_WARNINGS } from './warnings'
import { DATA_SOURCES, rawBase } from '../src/core/sources'

const ROOT = join(import.meta.dirname, '..')
const CACHE = join(ROOT, '.cache', 'raw')
const OUT_INDEX = join(ROOT, 'public', 'data', 'index.json')
const OUT_OPERATORS = join(ROOT, 'public', 'data', 'operators')
const REVIEW_DIR = join(ROOT, 'review')

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

/** 快取裡記錄某個伺服器資料下載時間的檔案。 */
const DOWNLOADED_AT = 'downloaded_at.txt'

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

/** 快取裡的下載時間;還沒有記錄的舊快取,以幹員表檔案的修改時間代替。 */
async function downloadedAt(server: ServerKey): Promise<string> {
  const record = join(CACHE, server, DOWNLOADED_AT)
  if (existsSync(record)) return (await readFile(record, 'utf8')).trim()
  return (await stat(join(CACHE, server, 'character_table.json'))).mtime.toISOString()
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function loadServer(server: ServerKey): Promise<RawServer> {
  const f = (name: string) => join(CACHE, server, `${name}.json`)
  const optional = async <T>(name: string): Promise<T | undefined> => (existsSync(f(name)) ? readJson<T>(f(name)) : undefined)
  return {
    characterTable: await readJson(f('character_table')),
    skillTable: await readJson(f('skill_table')),
    gamedataConst: await readJson(f('gamedata_const')),
    uniequipTable: await optional('uniequip_table'),
    battleEquipTable: await optional('battle_equip_table'),
    charPatchTable: await optional('char_patch_table'),
    itemTable: await optional('item_table'),
    handbookTeamTable: await optional('handbook_team_table'),
    downloadedAt: await downloadedAt(server),
  }
}

async function main() {
  const offline = process.argv.includes('--offline')
  if (!offline) await Promise.all((Object.keys(SOURCES) as ServerKey[]).map(downloadServer))

  const cn = await loadServer('cn')
  const tw = await loadServer('tw')
  const groups = await readJson<KeywordGroup[]>(join(ROOT, 'data', 'keyword-groups.json'))
  const overrides = await readJson<Overrides>(join(ROOT, 'data', 'effect-overrides.json'))
  const supplements = await readJson<SupplementKeyword[]>(join(ROOT, 'data', 'supplementary-keywords.json'))
  const excludedTerms = await readJson<string[]>(join(ROOT, 'data', 'excluded-terms.json'))
  const prtsPages = await readJson<Record<string, string>>(join(ROOT, 'data', 'prts-pages.json'))
  const twPowerNames = await readJson<Record<string, string>>(join(ROOT, 'data', 'tw-power-names.json'))
  const powerList = await readJson<PowerList>(join(ROOT, 'data', 'power-list.json'))
  const knownWarnings = await readJson<string[]>(KNOWN_WARNINGS)
  const { index, operatorFiles, warnings, pending } = buildIndex({ cn, tw, groups, supplements, overrides, excludedTerms, prtsPages, twPowerNames, powerList })

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
  await writeFile(join(REVIEW_DIR, 'build-warnings.txt'), warnings.join('\n') + '\n')
  await writeFile(join(REVIEW_DIR, 'pending-review.json'), JSON.stringify(pending, null, 1))
  console.log(`待複核:${pending.length} 個配對(review/pending-review.json)`)

  const { newWarnings, resolvedWarnings } = diffWarnings(warnings, knownWarnings)
  await writeFile(NEW_WARNINGS, JSON.stringify(newWarnings, null, 2) + '\n')
  await writeFile(RESOLVED_WARNINGS, JSON.stringify(resolvedWarnings, null, 2) + '\n')
  console.log(`警告:共 ${warnings.length} 則(review/build-warnings.txt)`)
  console.log(`  新警告:${newWarnings.length} 則(review/new-warnings.json)`)
  console.log(`  已消失的已知警告:${resolvedWarnings.length} 則(review/resolved-warnings.json)`)
  if (newWarnings.length > 0) {
    console.warn('⚠ 新警告前 10 則:')
    for (const w of newWarnings.slice(0, 10)) console.warn('  ' + w)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
