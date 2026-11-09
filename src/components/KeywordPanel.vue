<script setup lang="ts">
import { computed } from 'vue'
import { keywordGroups, powerPanel } from '../core/query'
import type { PowerId, SearchIndex, Server } from '../core/types'

const props = defineProps<{
  index: SearchIndex
  server: Server
  selected: string[]
  powers: PowerId[]
}>()
const emit = defineEmits<{ toggle: [id: string]; togglePower: [id: PowerId] }>()

const groups = computed(() => keywordGroups(props.index, props.server))
const powerPanelRows = computed(() => powerPanel(props.index, props.server))
</script>

<template>
  <div class="kw-panel">
    <section v-for="g in groups" :key="g.name" class="kw-group">
      <h2 class="kw-group-name">{{ g.name }}</h2>
      <!-- 每行從新的一行開始,行內放不下時折行 -->
      <div v-for="(row, i) in g.rows" :key="i" class="kw-list">
        <button
          v-for="k in row"
          :key="k.id"
          class="kw"
          :class="{ on: selected.includes(k.id), sup: k.unofficial }"
          :data-k="k.id"
          :aria-pressed="selected.includes(k.id)"
          @click="emit('toggle', k.id)"
        >
          {{ k.name }}
        </button>
      </div>
    </section>
    <section v-if="powerPanelRows.length > 0" class="kw-group">
      <h2 class="kw-group-name">勢力</h2>
      <div v-for="(row, i) in powerPanelRows" :key="i" class="kw-list">
        <button
          v-for="p in row"
          :key="p.id"
          class="kw power"
          :class="{ on: powers.includes(p.id) }"
          :aria-pressed="powers.includes(p.id)"
          @click="emit('togglePower', p.id)"
        >
          {{ p.name }}
        </button>
      </div>
    </section>
  </div>
</template>
