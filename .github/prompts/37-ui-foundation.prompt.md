---
mode: agent
description: Batch 37. Tailwind v4, shadcn/ui on Base UI, tokens, fonts, and dark mode. No view changes. About 20K tokens.
---
Build batch 37 only.
Read: `.github/prompts/PHASE4.md`, `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`.

## Build
1. Run `npm i -E tailwindcss @tailwindcss/vite tw-animate-css @fontsource-variable/geist @fontsource-variable/geist-mono`.
2. In `vite.config.ts`, add the Tailwind plugin and an `@` alias for `src`. Keep the batch 36 Splitwise plugin. In `tsconfig.json`, add the matching `paths`.
3. Run `npx shadcn@latest init --base base --preset nova`. If the CLI's flags differ, answer its prompts for Base UI and nova instead. Use `src/ui/theme.css` for CSS, `src/components/ui` for components, `src/lib/utils.ts` for utils, and lucide for icons.
4. Add these components: `button input label textarea select combobox checkbox switch badge card table tabs dialog alert-dialog alert sheet dropdown-menu popover tooltip separator skeleton sidebar command sonner chart empty kbd`. If the CLI doesn't know a name, skip it and note it in `PROGRESS.md`.
5. In `theme.css`, add `--positive`, `--negative`, `--warning`, and their foregrounds, for light and dark. Set Geist and Geist Mono as the sans and mono fonts.
6. In `src/main.tsx`:
   - Import Geist and `theme.css` before `styles.css`. `styles.css` has no layers, so its rules win and today's views look the same.
   - Toggle `dark` on `<html>` from `prefers-color-scheme`, and keep following it as it changes.

## Tests
The existing e2e specs must still pass unchanged. That's the proof nothing moved.

## Done when
All four commands pass. Update `PROGRESS.md`. Next is 38.
