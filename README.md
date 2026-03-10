# projects.zurassic.com

Monorepo for all projects hosted at [projects.zurassic.com](https://projects.zurassic.com).

## Structure

```
projects.zurassic.com/
├── index.html              # Landing page listing all projects
├── vercel.json             # Root Vercel config (cleanUrls, trailingSlash)
├── music-practice-stage/   # Metronome + practice tools
└── lego-mosaic-helper/     # LEGO mosaic image converter
```

Each subfolder is a self-contained static app (HTML/CSS/JS, no build step).

## Deployment

Connected to Vercel on the `main` branch. **Every push to `main` auto-deploys everything.**

```
git push
```

That's it. No subtree commands, no per-project branches, no prefix flags needed.

URLs map directly to folder names:
- `/` → `index.html`
- `/music-practice-stage/` → `music-practice-stage/index.html`
- `/lego-mosaic-helper/` → `lego-mosaic-helper/index.html`

## Adding a new project

**1. Create a subfolder and build the project:**
```
mkdir my-new-project
```

**2. Add a card to `index.html`** — copy an existing `<li>` block in the `<ul class="projects">` section, increment the number, and update the href, title, and description.

**3. Push:**
```
git add .
git commit -m "Add my-new-project"
git push
```

## Git history

Both existing projects were migrated from standalone repos using `git subtree add`, so their full commit history is preserved inline in this repo's `main` branch:

- `music-practice-stage` — migrated from `/code/metronome`
- `lego-mosaic-helper` — migrated from `/code/lego-helper` (was also at `github.com/hamxiaoz/lego-mosaic-helper`)

To see history for a specific subfolder:
```
git log -- music-practice-stage/
git log -- lego-mosaic-helper/
```

## Vercel setup

- **Project:** `projects.zurassic.com` on Vercel dashboard
- **Repo:** `hamxiaoz/projects.zurassic.com`, branch `main`, root `/`
- **Domain:** `projects.zurassic.com` (CNAME managed in Namecheap — no changes needed unless moving to a new Vercel project)
- **Config:** `vercel.json` at root — `cleanUrls: true`, `trailingSlash: true` (trailing slash is required so relative asset paths in subfolders resolve correctly)

## Claude / AI context

- Project-level memory for `music-practice-stage` is at:
  `~/.claude/projects/-Users-andrew-code-projects-zurassic-com-music-practice-stage/memory/MEMORY.md`
- Each subfolder has `.claude/settings.local.json` for local Claude settings
- When working on a specific project, open Claude from that subfolder so it picks up the right context
