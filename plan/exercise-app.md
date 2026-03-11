# Exercise App — Plan

## Overview

A web app to create and manage personalized workout plans. Each plan is tied to a person and contains structured exercise data including demos and muscle visualization.

---

## Core Features

### 1. Person Management
- Create profiles (name, optional avatar/color)
- Each person has their own set of workout plans
- Simple list view to switch between people

### 2. Workout Plan
Each person can have one or more named plans (e.g. "Monday Upper Body", "Full Body Beginner").

Each **exercise entry** in a plan includes:

| Field | Description |
|---|---|
| **Move** | Exercise name (e.g. "Push-up", "Goblet Squat") |
| **Duration / Reps** | Time-based (e.g. 30s) or rep-based (e.g. 3×12) |
| **Frequency** | How often per week (e.g. 3×/week) or which days |
| **Demo Videos** | 1–2 embedded YouTube/Vimeo links or short clips |
| **Muscle Groups** | Tags for which muscles are targeted |

### 3. Muscle Visualization
- Display a front/back body SVG diagram
- Highlight muscles targeted by the exercises in the current plan
- Color intensity could reflect volume (light = secondary, bold = primary)
- Tap/click a muscle to filter exercises targeting it

### 4. Demo Videos
- Embed 1–2 videos per exercise (YouTube iframe or link)
- Show as a thumbnail that expands inline, not a separate page
- Mobile-friendly (no autoplay)

---

## Data Model (rough)

```
Person
  id, name, color/avatar

WorkoutPlan
  id, personId, name, days[]

Exercise
  id, planId
  name: string
  sets: number
  reps: number | null
  durationSeconds: number | null
  frequencyPerWeek: number
  videoUrls: string[]        // max 2
  muscles: MuscleGroup[]     // e.g. ["chest", "triceps", "shoulders"]
```

### Muscle Group Tags (initial set)
- Upper: shoulders, chest, upper-back, traps, biceps, triceps, forearms
- Core: abs, obliques, lower-back
- Lower: glutes, quads, hamstrings, calves, hip-flexors

---

## UI / UX Sketch

```
┌─────────────────────────────────┐
│  [Alice ▾]   My Plans           │
│  ─────────────────────────────  │
│  + New Plan    [Monday Upper ▾] │
│                                 │
│  ┌─ Muscle Map ──────────────┐  │
│  │   [front/back body SVG]   │  │
│  │   highlighted: chest,     │  │
│  │   triceps, shoulders      │  │
│  └───────────────────────────┘  │
│                                 │
│  Exercises                      │
│  ┌────────────────────────────┐ │
│  │ Push-up                    │ │
│  │ 3×12 · 3×/week             │ │
│  │ 🎬 [Demo 1] [Demo 2]       │ │
│  │ 💪 Chest · Triceps         │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │ Overhead Press             │ │
│  │ 3×10 · 3×/week             │ │
│  │ 🎬 [Demo 1]                │ │
│  │ 💪 Shoulders · Triceps     │ │
│  └────────────────────────────┘ │
│  [+ Add Exercise]               │
└─────────────────────────────────┘
```

---

## Tech Stack Considerations

| Concern | Option A (simple) | Option B (scalable) |
|---|---|---|
| Framework | Vanilla JS + HTML | React / Svelte |
| Storage | localStorage | Supabase / Firebase |
| Muscle SVG | Static SVG with CSS classes | D3 or custom SVG map |
| Video | YouTube iframe embed | Direct `<video>` for uploads |
| Hosting | Vercel (fits existing setup) | Same |

**Recommended starting point:** React (or Svelte) + localStorage, deploy to Vercel under `projects.zurassic.com/exercise-app`. Upgrade to a backend if multi-device sync becomes needed.

---

## Open Questions

- [ ] Should multiple people share plans, or are plans strictly per-person?
- [ ] Is offline support needed (PWA)?
- [ ] Video: embed external links only, or allow file uploads?
- [ ] Should the muscle map be interactive (click to filter) or read-only?
- [ ] One app per person or a single app with a person switcher?
- [ ] Any login/auth, or purely local/anonymous?
