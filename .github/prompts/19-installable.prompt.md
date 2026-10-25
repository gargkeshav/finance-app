
---mode: agentdescription: Batch 19, optional. Installable offline app shell and a narrow layout for a phone later. About 25K tokens.---
Build batch 19 only. Optional: run it only if the user asks for it.
Read: `.github/prompts/PHASE2.md`, `index.html`, `vite.config.ts`, `src/main.tsx`, `src/ui/LocalApp.tsx`.Create: `public/manifest.webmanifest`, `public/icon.svg`, `public/sw.js`.
## Build
1. The manifest: name "Finance", `display: standalone`, the SVG icon, and neutral colours.2. `sw.js` caches the built app shell only. Never cache the ledger file or any Splitwise request. Pass everything else to the network.3. `main.tsx` registers the worker in production builds only.4. Narrow screens, 600px and below: the sidebar becomes a top row that scrolls sideways. Add at most 30 lines to `styles.css`.5. The page opens with `npm run build`, then `npx vite preview`. Chrome on a Mac can install it.6. On Android Chrome, the file picker API is missing, so the download and upload fallback is used. Say that in `DataView` when that mode is active.
## Tests
None.
## Done when
`npm run build` passes, and installing in Chrome and opening offline shows the shell. Update `PROGRESS.md`. Phase 2 is complete.

