// 讀取建置索引的輸入:.cache/raw 裡兩服的原始資料,加上 data/ 的維護者清單。
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Server } from '../src/core/types'
import type { AuditSeeds } from './audit'
import type { BuildInput, KeywordGroup, Overrides, PowerList, SupplementKeyword, TermMatch } from './buildIndex'
import { ROOT } from './paths'
import type { RawServer } from './raw'

export const CACHE = join(ROOT, '.cache', 'raw')

/** 快取裡記錄某個伺服器資料下載時間的檔案。 */
export const DOWNLOADED_AT = 'downloaded_at.txt'

/** 快取裡的下載時間;還沒有記錄的舊快取,以幹員表檔案的修改時間代替。 */
async function downloadedAt(server: Server): Promise<string> {
  const record = join(CACHE, server, DOWNLOADED_AT)
  if (existsSync(record)) return (await readFile(record, 'utf8')).trim()
  return (await stat(join(CACHE, server, 'character_table.json'))).mtime.toISOString()
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function loadServer(server: Server): Promise<RawServer> {
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

export function readData<T>(name: string): Promise<T> {
  return readJson<T>(join(ROOT, 'data', `${name}.json`))
}

export async function loadBuildInput(): Promise<Required<BuildInput>> {
  return {
    cn: await loadServer('cn'),
    tw: await loadServer('tw'),
    groups: await readData<KeywordGroup[]>('keyword-groups'),
    overrides: await readData<Overrides>('effect-overrides'),
    supplements: await readData<SupplementKeyword[]>('supplementary-keywords'),
    termMatches: await readData<TermMatch[]>('term-matches'),
    excludedTerms: await readData<string[]>('excluded-terms'),
    prtsPages: await readData<Record<string, string>>('prts-pages'),
    twPowerNames: await readData<Record<string, string>>('tw-power-names'),
    powerList: await readData<PowerList>('power-list'),
    auditSeeds: await readData<AuditSeeds>('audit-seeds'),
  }
}
