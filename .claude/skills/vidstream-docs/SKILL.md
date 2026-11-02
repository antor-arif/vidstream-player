---
name: vidstream-docs
description: Conventions and known problems for the vidstream-player documentation site in vidstream-player-docs/ (Next.js 15 App Router + MDX, Tailwind, next-themes, LiveDemo and Playground that run the real player). Use this skill whenever adding, editing or reviewing a docs page, MDX component, sidebar/navigation entry, changelog or migration note, landing-page section, or the interactive playground — and whenever a change to the player (new option, event, method, fix or removal) needs its documentation updated, because the docs currently disagree with the code in many places and must be corrected against the source, not copied from.
---

# vidstream-player docs site

> This skill ships inside the player repo (`Vidstream-player/.claude/skills/`). The docs site is a **separate repo**: github.com/antor-arif/vidstream-player-docs — clone it next to the player (`<parent>/vidstream-player-docs`) before working on it.

`D:\Projects\Vidstream\vidstream-player-docs` is its own git repo (last commit `5f89dcd`, 2026-06-10). It documents the SDK in `../Vidstream-player`. For anything about how the player itself behaves, use the `vidstream-player` skill. That skill's `references/api-surface.md` is the source of truth for options, methods and events.

## Stack and commands
- Stack: Next 15 (App Router), React 19, `@next/mdx` (remark-gfm; rehype-slug, autolink-headings, pretty-code with shiki), Tailwind 3.4 + typography, next-themes (class strategy, dark by default), lucide-react, geist. Requires Node ≥ 20.
- Commands: `npm run dev`, `npm run build`, `npm run lint` (`next lint`, flat config in `eslint.config.mjs`).
- Keep webpack (plain `next dev`): the rehype-pretty-code options contain functions, which Turbopack can't serialize.
- Deploy target is Netlify (`netlify.toml`: `npm run build`, Node 20, Next runtime). No `output: 'export'`. The `out/` folder is a stale artifact of an earlier static export and is not used.
- No env vars are used.
- **The site runs the frozen npm package `vidstream-player@2.0.0`** (pinned in package.json), not the local source, so live demos show the old 2.0.0 bugs. The player is now distributed from GitHub only; switch the dependency to `github:antor-arif/vidstream-player#<tag>` (see the `vidstream-release` skill).
  - To preview unreleased player changes: build the player, then in the docs run `npm install ../Vidstream-player` temporarily.
  - That rewrites package.json and the lockfile, so revert both before committing unless the user wants to keep it.
  - After a real release, bump the pinned version (see the `vidstream-release` skill).

## Layout
```
src/app/layout.tsx                 root: fonts, ThemeProvider, metadata (title template '%s | Vidstream Player')
src/app/page.tsx                   landing: Hero, Stats, FeaturesGrid, FrameworksSection, QuickStart (src/components/landing/*)
src/app/playground/page.tsx        → src/components/playground/PlaygroundPage.tsx
src/app/docs/layout.tsx            Navbar + Sidebar + <article class="prose prose-sm dark:prose-invert"> + TableOfContents + Footer
src/app/docs/page.tsx              redirect → /docs/getting-started/introduction
src/app/docs/<section>/<slug>/page.mdx   sections: getting-started, features, frameworks, api (+ changelog/page.mdx)
src/lib/navigation.ts              sidebar + mobile nav data (NavSection[])
src/components/docs/*              MDX building blocks
mdx-components.tsx                 element → component mapping + globally registered components
src/app/globals.css                theme tokens (HSL vars), utilities, and overrides of player classes (~L160-235)
```

## Adding a docs page
1. Create `src/app/docs/<section>/<slug>/page.mdx`. The route is `/docs/<section>/<slug>/` (`trailingSlash: true`).
2. Start it exactly like the existing pages. There is no YAML frontmatter support; metadata is an export:
   ```mdx
   import { DocPageHeader } from '@/components/docs/DocPageHeader'
   import { Callout } from '@/components/docs/Callout'
   import { PropsTable } from '@/components/docs/PropsTable'

   export const metadata = {
     title: 'Chapters',
     description: 'WebVTT chapter markers on the seek bar with events.',
   }

   <DocPageHeader
     title="Chapters"
     description="Load chapter markers from a WebVTT file or array. Displayed on the seekbar, with events fired on change."
     badge="Feature"
   />
   ```
   - Badge convention: `"Feature"` for feature pages, `"Framework"` for framework pages, none for getting-started, API and changelog.
   - Import only what the page uses (several pages have unused imports, so don't copy those).
3. Use `##` and `###` for sections, never a markdown `#` (DocPageHeader renders the h1). The right-hand TOC lists h2 and h3 and only appears with two or more headings.
4. Register it in `src/lib/navigation.ts`: `{ title: 'Mini Player', href: '/docs/features/mini-player' }`, with no trailing slash and in the right section. An optional `badge` renders as a pill.
5. If it's a feature, also consider:
   - a card in `src/components/landing/FeaturesGrid.tsx` (`{ icon, title, description, href, color, bg }`);
   - the hard-coded counts ("9 production-ready features" in FeaturesGrid ~L108 and `introduction/page.mdx` ~L21, "10+" in `Stats.tsx`);
   - the API pages (`api/config`, `api/types`, `api/events`, `api/player-instance`).
6. Run `npm run build` to catch MDX syntax errors. A broken MDX page fails the whole build.

## MDX components
They are registered globally in `mdx-components.tsx`, but pages import them explicitly by convention, so keep doing that.

| Component | Props | Example |
|---|---|---|
| `DocPageHeader` | `title, description, badge?` | see above |
| `Callout` | `type?: 'info'|'warning'|'error'|'success'|'tip'` (default info), `title?` | `<Callout type="warning" title="Heads up">Text with \`code\`</Callout>` |
| `PropsTable` | `rows: { prop, type, default?: string, required?, description }[]` | `<PropsTable rows={[{ prop: 'miniPlayer.width', type: 'number', default: '320', description: 'Width in px' }]} />` |
| `Steps` / `Step` | `Step { title }`, auto-numbered | `<Steps><Step title="Install">` + blank line + fenced code + blank line + `</Step></Steps>` |
| `LiveDemo` | `config?: { src?, type?, poster?, title?, theme?, autoplay?, muted?=true, loop?, height?, extra?: Partial<PlayerConfig>, onReady? }, label?, className?` | `<LiveDemo label="Live HLS demo" config={{ extra: { chaptersVtt: '/demo-chapters.vtt' } }} />` |
| `FrameworkTabs` / `TabPanel` | `tabs: { id, label, icon?, content }[]` | exists but unused |

Element mapping notes (`mdx-components.tsx`):
- `pre` becomes `CodeBlock` with a copy button.
- Relative links (`/…`) become `next/link`. Every other href, **including `#anchors`**, opens in a new tab (a known bug).
- Tables are wrapped in a bordered scroll container.

Code fences in use: `ts tsx js html bash css vue svelte vtt`.

**LiveDemo internals** (`src/components/docs/LiveDemo.tsx`, `'use client'`):
- It does `import * as VidPkg from 'vidstream-player'` and picks the constructor `VideoPlayer ?? VidstreamPlayer ?? default`.
- It builds `{ source, autoplay, muted, loop, theme: { accentColor:'#ef4444', progressColor:'#ef4444', ...theme }, ...extra }` and destroys the player on unmount.
- The effect has empty deps, so remount it with a new `key` to apply config changes. The Playground does this with `key = JSON.stringify(config without muted)`.
- MDX pages render it directly (SSR-prerendered client component). Hero and Playground use `next/dynamic(..., { ssr: false })`.

Styling: use semantic Tailwind tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted/40`, `text-primary`), `cn()` from `@/lib/utils`, lucide icons and the `@/*` alias. Primary is red (`0 84% 60%` dark), accent is orange.

## Writing docs that stay true
The docs have drifted from the code. references/docs-drift.md lists every known mismatch with the correct behaviour. Before writing or editing any API claim:
1. **Check it against the player source** (`Vidstream-player/src/types/index.ts` and the implementing code), or against `vidstream-player/references/api-surface.md`. Don't copy a claim from another docs page, the README or the changelog without checking.
2. **Document what the shipped version does.** If a typed option doesn't work (for example `keyboardShortcuts`, `playbackRate`, `security`), don't advertise it. Either leave it out or add `<Callout type="warning">` explaining the limitation and the workaround, and link the fix once it exists.
3. **Keep these names exactly right:**
   - the custom element is `<video-player>`;
   - DOM event payloads are under `e.detail.data` (state under `e.detail.state`);
   - bus `seek` is `{ fromTime, toTime }`;
   - imports are `vidstream-player`, `vidstream-player/react`, `vidstream-player/webcomponent` and `vidstream-player/styles`.
4. **When the player changes**, update every place the fact appears:
   - the feature page;
   - `api/config`, `api/types`, `api/events` and `api/player-instance`;
   - the framework pages, whose samples repeat options;
   - landing `QuickStart` and `Hero` samples;
   - the README in the player repo;
   - the changelog, and the migration guide for anything breaking.
5. **Code samples must be valid.** Several current ones are not: undefined helpers, Next 15 `params` used synchronously, `@Component({ ... })`.
6. **Removed features** (auto-resume) belong only in the migration guide and changelog. `features/auto-resume` is an orphan page that is not in the nav and still badged "Feature".

## Reference files
- `references/docs-drift.md`: every known docs-vs-code mismatch (with the correct facts), internal contradictions between docs pages, site bugs (sidebar active state, TOC, anchors, syntax colours), broken samples and coverage gaps. Read it before editing any API page or when asked to "fix the docs".
