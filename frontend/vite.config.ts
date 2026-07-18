import { renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const pages = ['index', 'login', 'bets', 'polls', 'dashboard', 'leaderboard', 'archive', 'rules', 'profile', 'admin']

/** MPA HTML is emitted at its source path regardless of input key, so
 * coming-soon builds (single coming-soon.html entry) rename it to the
 * site root once the bundle is on disk. */
function comingSoonIndex(): Plugin {
  return {
    name: 'coming-soon-index',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist/', import.meta.url))
      renameSync(`${dist}coming-soon.html`, `${dist}index.html`)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  // Pre-launch gate: VITE_COMING_SOON=1 ships ONLY the landing page.
  const comingSoon = env.VITE_COMING_SOON === '1'
  return {
    base: env.VITE_BASE_PATH || '/polishuk-elections-2026/',
    plugins: [tailwindcss(), ...(comingSoon ? [comingSoonIndex()] : [])],
    build: {
      target: 'es2022', // page modules use top-level await
      rollupOptions: {
        input: comingSoon
          ? { 'coming-soon': new URL('./coming-soon.html', import.meta.url).pathname }
          : Object.fromEntries(
              pages.map((p) => [p, new URL(`./${p}.html`, import.meta.url).pathname]),
            ),
      },
    },
  }
})
