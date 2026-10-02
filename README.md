# Student OS

An offline-first academic planner: upload your timetable once, and it tracks attendance, plans your day, schedules spaced-repetition revisions, reminds you on every device and syncs everything. Study Copilot (Gemini, via the server only) can manage the app in plain language, but every change it proposes needs your confirmation.

## Quick start

Requirements: Node 20+ and PostgreSQL. Run `docker compose up -d` for a local Postgres.

```bash
npm install
cp apps/server/.env.example apps/server/.env   # set GEMINI_API_KEY to enable AI
npm run vapid -w @student-os/server            # paste the keys into .env to enable push reminders
npm run db:deploy -w @student-os/server        # apply migrations
npm run dev                                    # API on :4000, web on :5173
```

The web app works without the server, in guest/local mode. All data stays in IndexedDB until you sign in.

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests for all packages |
| `TEST_DATABASE_URL=… npm test -w @student-os/server` | Also runs the push scheduler tests against a real (throwaway) Postgres |
| `npm run typecheck` | TypeScript across the monorepo |
| `npm run build` | Production builds (server bundle + PWA) |
| `node apps/server/scripts/e2e-sync.mjs` | End-to-end API/sync check against a running server |

## Layout

```
packages/core   Shared domain logic (no I/O): entity schemas, attendance math,
                recurrence engine, adaptive revision, priority scoring, conflict
                resolution, notification planner, AI action registry.
apps/server     Express + Prisma/Postgres: auth, /api/sync, push scheduler + Web Push,
                notification actions, AI command endpoint (Gemini).
apps/web        React + Vite + Tailwind PWA, Dexie (IndexedDB), sync engine,
                notification scheduler, service worker, Copilot, UI.
```

## How it works

**Local first.** The UI only reads and writes IndexedDB (`apps/web/src/lib/repo.ts`). Each write stamps sync metadata and appends to an outbox in the same transaction. The sync engine (`lib/sync.ts`) pushes the outbox and pulls changes in one `POST /api/sync` request. It coalesces edits per record and retries with backoff. It never overwrites a record that still has unsent local edits. Records the server rejects are retried the next time the app starts.

**Conflicts.** Each record carries the server `version` it was based on. If the server holds a newer version, the write with the later `updatedAt` wins, with deviceId as the tie-breaker. The losing version is kept in `ConflictLog`. Attendance changes are also appended to `AttendanceRecord`, so no mark is ever lost.

**Classes.** `ClassSchedule` is the weekly rule, and `ClassInstance` is what happened on a given date. Future classes are generated on demand. An instance is stored only once you mark, cancel or reschedule it. Instance ids are UUIDv5 of `scheduleId + date`, so two offline devices marking the same class produce the same record.

**Attendance.** Attendance is attended ÷ conducted. Cancelled classes and rescheduled originals don't count, and the replacement class does. "Can miss" and "needed" figures account for the classes actually left before the semester end date.

**Revision.** The default ladder is Day 1/3/7/30/90/180. A rating of *forgot* means tomorrow and restarts the ladder. *Partially* means 2 days and repeats the stage. *Remembered* advances to the next stage. *Easy* advances and stretches future gaps. Each topic learns a personal ease multiplier.

### Notifications

One pure planner (`packages/core/src/notifications.ts`) decides what is due from your data and local wall-clock time. It covers classes, attendance prompts, revisions, tasks, assignments, exams, study sessions, custom and recurring reminders, daily and weekly reviews, attendance risk, AI suggestions and sync. Every notification gets a deterministic id. The same planner runs in three places:

| When | Where | Works offline |
| --- | --- | --- |
| App or installed PWA open | In-app scheduler, every 30 s (`lib/notifications.ts`) | Yes |
| App closed, Chromium PWA | Service worker periodic background sync (best effort, browser-throttled) | Yes |
| App or browser closed | Server push scheduler → Web Push (VAPID) → service worker | No (needs network) |

**No duplicates.** Each device reports what it showed to the server. The server waits one minute after a notification is due, then pushes it only to devices that haven't reported it. A unique `(user, key)` record plus a per-device delivery row stop double sends across ticks, restarts and multiple server instances. When a push reaches a device that already shows the notification, it reuses the same tag silently. Sync never re-triggers notifications, and cancelled, rescheduled or deleted items simply stop being planned. The server uses the timezone saved in your settings, so reminders arrive at local wall-clock time, DST included.

**Quick actions** (Present, Absent, Cancelled, Complete, Done, Snooze, Start, Skip) behave differently depending on the app's state:
- **App open:** the action is applied locally and synced.
- **App closed and online:** the service worker calls `POST /api/notifications/action`. The server requires both the session cookie and a signed, expiring token for the same user, then applies the change through the normal sync path.
- **Otherwise:** a snooze is stored locally, and other actions open the app to finish.

Settings → Notifications covers sound, vibration and an optional in-app chime, plus per-category on/off and timing (e.g. classes 30/15/5 minutes before, exams 30/14/7/1 days before). It also turns push on or off for each device. On iPhone and iPad, web notifications only work after Add to Home Screen.

### Study Copilot (confirmation-based AI control)

```
message → /api/ai/command (Gemini sees only permitted actions + filtered context)
        → intents validated against the action registry (packages/core/src/actions.ts)
        → permission check → resolve targets against real data → conflict check
        → confirmation card → you confirm → executed via the normal write path → synced
        → logged with before/after snapshots (AI activity) → undoable
```

- **Action registry.** 26 actions, covering tasks, classes, attendance, events, plans, topics, revisions, exams, assignments, notes, reminders, flashcards, quizzes and navigation. Each has a schema, a required permission, a risk level and the systems it affects. Gemini can only emit these.
- **No guessing.** Gemini never sees database ids. Records appear in the context with opaque refs, and the client resolves targets itself. If nothing matches, it refuses ("I couldn't find…"). If several match, it asks which one with buttons. It won't record attendance for a class that hasn't started, or invent a subject.
- **Confirmation cards.** Each card shows exactly what changes and what else updates (calendar, reminders, attendance), plus any clashes. Cards offer **Confirm / Edit / Cancel**. Bulk changes list every affected item, with **Review** to untick items.
- **Permissions.** Settings → AI permissions controls what Copilot can read and propose. Delete and bulk changes are off by default.
- **History and undo.** Results offer **Undo**. *AI activity* lists every proposal and decision. Undo skips records that changed since, instead of overwriting them.
- **Conversation.** Pending proposals are kept in the conversation, so "make it two hours" corrects the last one. Voice input works where the browser supports speech recognition. Copilot is a panel on every page (press `.`) and a full page at `/assistant`.

## Status

Done:
- Onboarding
- Timetable import: AI for PDF/image/Excel/CSV, a local CSV fallback, and a review table where rows can be edited, added, deleted and merged
- Recurring classes with holidays and semester bounds
- Attendance: present/absent/cancelled/rescheduled/decide-later, risk levels, what-if calculator, attendance calendar
- Today planner, calendar (day, week, month, agenda), tasks with transparent priority reasons and due times
- Revision: adaptive schedule, knowledge tree, AI flashcards and quizzes
- Exams and assignments, notes in Markdown, daily and weekly reviews, analytics and streaks
- Offline global search
- Notification system:
  - planner covering every category
  - in-app, periodic-sync and Web Push delivery
  - quick actions and snooze
  - custom and recurring reminders
  - notification center with history and the next 24 hours
  - per-category preferences, sound and vibration
- Study Copilot: action registry, confirmations, clarification, permissions, AI activity history, undo, voice input
- Email and Google auth, multi-device sync, installable PWA with an offline app shell

Verified in this environment:
- unit and integration tests across all three packages;
- the push scheduler against a real Postgres (PGlite);
- a real Web Push delivered to headless Edge through Windows' push service while the app was closed;
- the full UI flows in headless Edge.

Copilot UI tests used canned AI responses, because no Gemini key was available.

Not built yet:
- **Note attachments.** Images and PDFs on notes aren't supported yet.
- **Planned features.** Focus timer and burnout/workload detection.
- **Data handling.** A sync-conflict review UI (conflicts are logged on the server), account deletion, and cross-device read state for the notification center (read marks are stored per device; the server records them but doesn't send them back).
- **Closed-app reminders without network.** These depend on periodic background sync, which browsers run rarely and only for installed Chromium PWAs. No web platform API supports exact offline alarms.

Note: the first `npm install` in a new workspace sometimes didn't record dependencies with this npm version. If a package is missing, re-run the install.
