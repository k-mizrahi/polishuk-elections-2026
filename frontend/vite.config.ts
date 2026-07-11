import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const pages = ['index', 'login', 'bets', 'polls', 'leaderboard', 'archive', 'profile', 'admin']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    base: env.VITE_BASE_PATH || '/polishuk-elections-2026/',
    plugins: [tailwindcss()],
    build: {
      target: 'es2022', // page modules use top-level await
      rollupOptions: {
        input: Object.fromEntries(
          pages.map((p) => [p, new URL(`./${p}.html`, import.meta.url).pathname]),
        ),
      },
    },
  }
})
