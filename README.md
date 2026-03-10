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

## Working on a new (unfinished) project

Every push to `main` deploys live, so don't push unfinished work there. Two options:

### Option A — Feature branch (suggested)

Work in a branch. Vercel auto-generates a **preview URL** for every branch so you can see it live before shipping.

```
git checkout -b my-new-project
# work and commit freely...
git push -u origin my-new-project
# Vercel posts a preview URL in the GitHub PR / branch

# When ready to ship:
git checkout main
git merge my-new-project
git push
git branch -d my-new-project
```

Only add the project to `index.html` as part of the final merge commit.

### Option B — Git worktree

Lets you work on a branch in a separate folder on disk without switching branches in this directory. Useful when juggling two projects simultaneously.

```
git checkout -b my-new-project
git worktree add ../my-new-project-wip my-new-project
# now ../my-new-project-wip is a separate working directory on that branch
# work there, commit freely, push when ready as in Option A

# Clean up when done:
git worktree remove ../my-new-project-wip
```

## Adding a new project (when ready to ship)

**1. Create a subfolder and build the project:**
```
mkdir my-new-project
```

**2. Add an entry to `index.html`** — copy an existing `<li>` block in the `<ul class="projects">` section and update the href, title, and description.

**3. Push:**
```
git add .
git commit -m "Add my-new-project"
git push
```

## Git history

Both existing projects were migrated from standalone repos using `git subtree add`, so their full commit history is preserved inline in this repo's `main` branch:

- `music-practice-stage` — migrated from a standalone repo using `git subtree add`
- `lego-mosaic-helper` — migrated from a standalone repo using `git subtree add`

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

- Each subfolder has `.claude/settings.local.json` for local Claude settings
- When working on a specific project, open Claude from that subfolder so it picks up the right context
- Project-level memory is stored locally in `~/.claude/projects/` (not committed to the repo)
