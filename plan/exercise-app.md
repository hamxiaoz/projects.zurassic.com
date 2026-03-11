# Exercise App — Plan

## Overview

A web app to create and manage personalized workout plans. Each plan is tied to a person and contains structured exercise data including YouTube demos, muscle visualization, and a stats dashboard. No login — all data stored in localStorage.

---

## Decisions Made

| Question | Decision |
|---|---|
| Videos | YouTube embeds only; multiple per exercise (no hard cap) |
| Muscle map | Interactive — click to filter exercises; show muscle name labels |
| Auth | None — localStorage, anonymous |
| Plans per person | Multiple plans per person |
| Entry point | Landing / stats dashboard → pick profile → plans |
| Theming | CSS custom properties from the start for easy theme swapping |

---

## App Pages / Flow

```
/ (Landing + Stats Dashboard)
  └─ [Pick Profile] ──────────→ /profile/:id
                                    ├─ Plans list
                                    └─ /plan/:id
                                          ├─ Muscle map
                                          └─ Exercise list
```

### Page 1 — Landing / Dashboard (default route)

The landing page doubles as the stats dashboard. No login means stats are aggregate across all local profiles.

**Dashboard panels:**
- Total workouts logged across all profiles
- Most trained muscle groups (bar or bubble chart)
- Active profiles with avatar/color chips → click to enter
- "Add new profile" button
- A hero section briefly explaining the app (shown prominently until at least one profile exists, then collapsed/subtle)

### Page 2 — Profile Home

After picking a profile:
- List of that person's workout plans (cards)
- Quick stat strip: total exercises, muscles covered this week
- [+ New Plan] button

### Page 3 — Plan Detail

Split layout (desktop: side by side; mobile: stacked):

**Left / Top — Muscle Map**
- Front/back SVG diagram (toggle button)
- Highlighted muscles from exercises in this plan
- Click a highlighted muscle → filters the exercise list below
- Muscle name label appears on hover/tap
- Color: primary muscles bold, secondary muscles light

**Right / Bottom — Exercise List**
- Each card shows:
  - Name
  - Sets × reps or duration
  - Frequency (e.g. 3×/week or M/W/F)
  - Muscle tags (clickable, synced with map)
  - YouTube video chips — each labeled (e.g. "Form demo", "Variation")
    - Click chip → expands inline YouTube embed below the card
    - Multiple chips shown in a row so it's clear there are multiple
  - [Edit] [Delete] actions

---

## Data Model

```ts
interface Profile {
  id: string
  name: string
  color: string        // theme accent for this profile
  createdAt: string
}

interface WorkoutPlan {
  id: string
  profileId: string
  name: string
  days: DayOfWeek[]   // e.g. ["mon", "wed", "fri"]
  createdAt: string
}

interface Exercise {
  id: string
  planId: string
  name: string
  sets: number
  reps: number | null
  durationSeconds: number | null
  frequencyPerWeek: number
  videos: VideoEntry[]
  primaryMuscles: MuscleGroup[]
  secondaryMuscles: MuscleGroup[]
}

interface VideoEntry {
  url: string          // YouTube URL
  label: string        // e.g. "Form demo", "Easier variation"
}
```

### Muscle Groups

```
Upper body:  shoulders, chest, upper-back, traps, biceps, triceps, forearms, neck
Core:        abs, obliques, lower-back
Lower body:  glutes, quads, hamstrings, calves, hip-flexors, adductors
```

---

## Theming

Use **CSS custom properties** for all colors. Define a default theme at `:root` and override per-theme with a `data-theme` attribute on `<html>`.

```css
:root {
  --color-bg: #f9f9f9;
  --color-surface: #ffffff;
  --color-primary: #3a86ff;
  --color-primary-subtle: #d0e4ff;
  --color-accent: #ff6b6b;
  --color-text: #1a1a1a;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-muscle-primary: #ef4444;
  --color-muscle-secondary: #fca5a5;
  --radius-card: 12px;
  --radius-btn: 8px;
}

[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  /* etc. */
}
```

Each profile can optionally override `--color-primary` with their own accent color.

---

## Framework: React vs Svelte

| | React | Svelte |
|---|---|---|
| **Ecosystem** | Huge — easy to find SVG body map libs, YouTube embed components | Smaller but sufficient |
| **Boilerplate** | More verbose (useState, useEffect) | Less — reactive by default |
| **Bundle size** | Larger (runtime included) | Smaller (compiles away) |
| **CSS theming** | Works fine with CSS vars | Works fine with CSS vars |
| **State for this app** | Context + useReducer or Zustand for localStorage sync | Svelte stores (built-in, very clean) |
| **Hiring / handoff** | More devs know React | Less common |
| **Best fit for this app** | If you want a larger ecosystem and are comfortable with React | If you want cleaner, less verbose code for a self-contained app |

**Recommendation:** **Svelte (SvelteKit)** — this app has no complex state requirements, is self-contained, and Svelte's reactivity + stores map naturally to "profile selected → plan loaded → exercises filtered by muscle." The result will be noticeably leaner. SvelteKit also gives routing for free.

If you prefer staying in React-land: **React + Vite + Zustand** is the pragmatic choice.

---

## Tech Stack (recommended)

| Concern | Choice |
|---|---|
| Framework | SvelteKit (or React + Vite) |
| Storage | localStorage with a thin wrapper (JSON serialization) |
| Muscle SVG | Custom SVG with named `<path>` IDs per muscle group |
| Video | YouTube iframe API or `youtube-nocookie.com` embed |
| Charts (dashboard) | Chart.js or Recharts (lightweight) |
| Hosting | Vercel — `projects.zurassic.com/exercise` |
| Theming | CSS custom properties + `data-theme` attribute |

---

## UI Sketches

### Landing / Dashboard
```
┌───────────────────────────────────────────────┐
│  FitPlans                          [+ Profile] │
│  ─────────────────────────────────────────     │
│  ┌─ Top Muscles ──────────────────────────┐    │
│  │  Chest ████████  Shoulders ██████      │    │
│  │  Glutes █████    Triceps ████          │    │
│  └────────────────────────────────────────┘    │
│                                                │
│  Profiles                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  Alice   │  │   Bob    │  │  + New   │     │
│  │  🔵      │  │  🟢      │  │          │     │
│  │ 3 plans  │  │ 1 plan   │  │          │     │
│  └──────────┘  └──────────┘  └──────────┘     │
└───────────────────────────────────────────────┘
```

### Plan Detail
```
┌───────────────────────────────────────────────┐
│  ← Alice   Monday Upper Body    [Edit] [+ Ex] │
│  ─────────────────────────────────────────     │
│  ┌─ Muscle Map ─────────┐  ┌─ Exercises ────┐ │
│  │  [front] [back]      │  │ Push-up        │ │
│  │                      │  │ 3×12 · 3×/week │ │
│  │   ░░░ shoulders ░░░  │  │ Chest Triceps  │ │
│  │   ███ chest ███      │  │ [Form] [Var.]  │ │
│  │   ░░ triceps ░░      │  │                │ │
│  │                      │  │ ─────────────  │ │
│  │  (click to filter)   │  │ Overhead Press │ │
│  └──────────────────────┘  │ 3×10 · 3×/week │ │
│                             │ Shoulders      │ │
│                             │ [Form demo]    │ │
│                             └────────────────┘ │
└───────────────────────────────────────────────┘
```

---

## Open / Nice-to-Have Later

- [ ] PWA / offline support
- [ ] Export plan as PDF or shareable link
- [ ] Log completed workouts (track actual sessions, not just plans)
- [ ] Rest timer
- [ ] Multi-device sync (Supabase when ready)
- [ ] Dark mode toggle (easy with CSS vars already in place)
