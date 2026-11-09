import { defineConfig, devices } from '@playwright/test'

// 煙霧測試對打包後的網頁執行:先 npm run build,再由 vite preview 提供靜態檔。
// 平行的 worktree 用 PORT 環境變數各開各的埠。
const port = process.env.PORT ?? '4173'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}/` },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
})
