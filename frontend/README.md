# frontend

Static site — Vite + vanilla TypeScript + Tailwind v4, multi-page, deployed to GitHub Pages.
Specs: [docs/01-product-spec.md](../docs/01-product-spec.md) (UX) and
[docs/03-architecture.md](../docs/03-architecture.md) (stack rationale, layout).

## Develop

```sh
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5173/fantasy_polls/
npm run build          # tsc --noEmit + vite build → dist/
npm run preview
```

Without the env vars the site still builds and renders: every page shows a
dismissible "not connected" banner and skeleton/empty states instead of data.

## Layout

- `*.html` — one entry per page (MPA, no router), each listed in `vite.config.ts`.
- `src/lib/` — `supabase.ts` (client factory, null when unconfigured),
  `i18n.ts` (`t()`, `data-i18n`, he/rtl default), `ui.ts` (chrome, seat-stepper
  form, tables, countdown), `database.types.ts` (hand-written; to be replaced
  by `supabase gen types`).
- `src/pages/` — one module per page; `src/i18n/{he,en}.json` — all UI strings.

RTL/LTR is served by one stylesheet: logical utilities only (`ms-*`, `pe-*`,
`text-start`, `start-0`), language + direction set before first paint from
`localStorage.lang`.
