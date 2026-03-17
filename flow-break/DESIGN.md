# Flow Break — Design Notes

## Sitting History & Stats Feature

### Sit / Break Detection Logic

Detection is driven entirely by the camera's person-detection model (COCO-SSD). There is no separate logic for stats — it piggybacks on the same signal that drives the break-reminder timer.

- **Sitting** = `personPresent` is `true` (person detected in webcam with confidence > 0.5)
- **Break** = `personPresent` is `false` (person absent)

A 5-second grace period (`GRACE_MS = 5000`) prevents brief look-aways from splitting a sitting session. `personPresent` only flips to `false` after the person has been absent for more than 5 seconds continuously.

### Alarm Dismissal Logic

The alarm (`isWarning = true`) fires when `sittingSec >= thresholdSec`. It can be cleared in three ways:

1. **Hand gesture** — hold open palm to camera for 3 seconds → `dismissAlarm()` immediately
2. **Walk away** — person absent for `ALARM_AWAY_MS` (15 seconds) → `dismissAlarm()` + break session starts
3. **Stop button** — clears everything

The 15-second away grace (`ALARM_AWAY_MS`) is intentionally longer than the detection grace (`GRACE_MS = 5s`). This prevents a brief camera detection glitch from silently killing an active alarm. The sequence:

```
alarm fires (isWarning = true):

  personPresent → false (after GRACE_MS):
    start alarmAwayTimer (15s)
    alarm keeps ringing

  personPresent → true again (within 15s):
    cancel alarmAwayTimer
    alarm continues ringing

  alarmAwayTimer fires (person truly gone 15s):
    dismissAlarm() → sittingSec resets
    break session opens in DB
```

`alarmAwayTimer` is also cancelled in `dismissAlarm()` and `stop()` to avoid double-firing.

### Storage: Why IndexedDB over localStorage

We store individual sit and break records (start time, end time, duration) to support the day timeline view. With detailed per-session records the data volume is:

```
~100 bytes/record × 20 records/day × 365 days = ~730 KB/year
```

Over multiple years this approaches localStorage's ~5 MB cap. More importantly:

- **localStorage has no structured queries** — loading a single day's records requires parsing the entire history blob
- **localStorage is synchronous** — parsing/writing large JSON blocks on the main thread
- **IndexedDB** provides a `date` index for efficient range queries, is async (non-blocking), and has no practical size limit

localStorage is used for small scalar preferences (sitting threshold, sound/FX/breath selections). IndexedDB is used only for session history.

### localStorage Keys

| Key | Value | Default |
|---|---|---|
| `fbVideoFx` | Index into VIDEO_FX array | 0 (None) |
| `fbAlarmSound` | Index into ALARM_SOUNDS array | 15 (Ascending) |
| `fbHandFx` | Index into HAND_FX_THEMES array | 2 (Lightning) |
| `fbBreath` | Index into BREATH_THEMES array, or -1 | -1 (off) |
| `flowBreakSession` | JSON crash-recovery checkpoint (see below) | absent |

### IndexedDB Schema

**Database:** `flowBreakDB` (version 1)
**Object store:** `sessions`
**Key path:** `id` (autoIncrement)
**Index:** `date` (string `"YYYY-MM-DD"`, non-unique) — for fetching all records in a day or date range

```js
// One record per continuous sitting or break period
{
  id: Number,           // autoIncrement primary key
  date: String,         // "YYYY-MM-DD" — indexed
  type: String,         // "sit" | "break"
  start: Number,        // Unix ms timestamp
  end: Number,          // Unix ms timestamp
  durationMin: Number   // float — actual minutes (end - start) / 60000
}
```

Both `sit` and `break` periods are stored as explicit records so the day timeline is a simple sorted fetch with no gap-filling logic needed in the UI.

### Session Lifecycle

Sessions are tracked in memory and written to IndexedDB only when they close:

```
personPresent false → true  (onPresenceGained):
  1. Cancel alarmAwayTimer if pending
  2. Close any open break record (write to DB)
  3. Open a new sit record (start = Date.now())
  4. Save localStorage checkpoint

personPresent true → false  (onPresenceLost):
  if alarm is active:
    start alarmAwayTimer (15s) — see alarm logic above
  else:
    1. Close the open sit record (write to DB)
    2. Set breakStart = Date.now()
    3. Save localStorage checkpoint

Page unload / Stop button:
  Close whatever record is currently open (write to DB)
```

A break record only opens after at least one sit session has occurred — the app never opens a break record as the very first event.

### Crash Recovery (localStorage Checkpoint)

IndexedDB writes are async and may not complete before the page unloads. To avoid losing the current in-progress session on refresh or tab close:

- **On session open** (`onPresenceGained` / `onPresenceLost`): write `{ type, date, start }` to `localStorage['flowBreakSession']` synchronously
- **On `beforeunload`**: finalize the checkpoint synchronously by adding `end` and `durationMin`
- **On normal session close**: write to IndexedDB, then clear the localStorage entry
- **On page load** (after IndexedDB opens): check for a finalized checkpoint (one with an `end` field) and write it to IndexedDB, then clear it

Browser crashes (no `beforeunload`) leave a checkpoint without an `end` — these are discarded on recovery since no reliable end time is available.

### Stats UI

**Weekly chart modal** (bar-chart button in top-right):
- Bar chart: X = last 7 days, two bars per day (sitting time vs break time in minutes)
- Green bars = sitting, gray bars = break
- Summary: total sessions and sitting time for the week

**Today view (main screen, below Start button)**:
- Always visible when there is data for today
- Horizontal timeline canvas: blue = sitting, gray = break, time labels at start/end
- Session list: each closed sit/break period with start–end times and duration
- In-progress session appended live (updated every 10 seconds via `tick()`)
- Also refreshes immediately on each session write (via `writeRecord` onsuccess)
