# Student OS

An offline-first academic planner: upload your timetable once, and it tracks attendance, plans your day, schedules spaced-repetition revisions and syncs across devices. Gemini AI assists throughout, through the server only.

## Quick start

Requirements: Node 20+ and PostgreSQL. Run `docker compose up -d` for a local Postgres.

```bash
npm install
cp apps/server/.env.example apps/server/.env   # set GEMINI_API_KEY to enable AI
npm run db:deploy -w @student-os/server        # apply migrations
npm run dev                                    # API on :4000, web on :5173
```

The web app works without the server, in guest/local mode. All data stays in IndexedDB until you sign in.

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests for all packages |
| `npm run typecheck` | TypeScript across the monorepo |
| `npm run build` | Production builds (server bundle + PWA) |
| `node apps/server/scripts/e2e-sync.mjs` | End-to-end API/sync check against a running server |

## Layout

```
packages/core   Shared domain logic (no I/O): entity schemas, attendance math,
                recurrence engine, adaptive revision, priority scoring,
                conflict resolution, AI output schemas. Used by both apps.
apps/server     Express + Prisma/Postgres: auth, /api/sync, read APIs, AIService (Gemini).
apps/web        React + Vite + Tailwind PWA, Dexie (IndexedDB), sync engine, UI.
```

## How it works

**Local first.** The UI only reads and writes IndexedDB (`apps/web/src/lib/repo.ts`). Each write stamps sync metadata and appends to an outbox in the same transaction. The sync engine (`lib/sync.ts`) pushes the outbox and pulls changes in one `POST /api/sync` request. It coalesces edits per record and retries with backoff. It never overwrites a record that still has unsent local edits.

**Conflicts.** Each record carries the server `version` it was based on. If the server holds a newer version, the write with the later `updatedAt` wins, with deviceId as the tie-breaker. The losing version is kept in `ConflictLog`. Attendance changes are also appended to `AttendanceRecord`, so no mark is ever lost.

**Classes.** `ClassSchedule` is the weekly rule, and `ClassInstance` is what happened on a given date. Future classes are generated on demand. An instance is stored only once you mark, cancel or reschedule it. Instance ids are UUIDv5 of `scheduleId + date`, so two offline devices marking the same class produce the same record.

**Attendance.** Attendance is attended ÷ conducted. Cancelled classes and rescheduled originals don't count, and the replacement class does. "Can miss" and "needed" figures account for the classes actually left before the semester end date.

**Revision.** The default ladder is Day 1/3/7/30/90/180. A rating of *forgot* means tomorrow and restarts the ladder. *Partially* means 2 days and repeats the stage. *Remembered* advances to the next stage. *Easy* advances and stretches future gaps. Each topic learns a personal ease multiplier.

**AI.** The browser → server → Gemini. The API key lives only on the server. The client builds a minimal context filtered by the user's *AI data controls* (`lib/ai.ts`). Attendance figures are pre-computed so the model quotes them rather than doing the arithmetic. Every response is validated with Zod (`packages/core/src/ai.ts`), with one corrective retry. Proposed changes come back as typed actions that the student reviews and accepts. AI output never carries database ids and is never applied silently.

## Status

Done:
- Onboarding
- Timetable import: AI for PDF/image/Excel/CSV, a local CSV fallback, and a review table where rows can be edited, added, deleted and merged
- Recurring classes with holidays and semester bounds
- Attendance: present/absent/cancelled/rescheduled/decide-later, risk levels, what-if calculator, attendance calendar
- Today planner and natural-language task creation
- Calendar with day, week, month and agenda views
- Tasks with transparent priority reasons and dependencies
- Revision: adaptive schedule, knowledge tree, AI flashcards and quizzes
- Exams and assignments, with an AI exam preparation plan
- Notes in Markdown, with AI summaries
- Study Copilot chat with reviewable actions
- Daily and weekly reviews with AI summaries
- Analytics and streaks
- Offline global search
- Notification center
- Settings: theme/accent, AI data controls, export
- Email and Google auth, multi-device sync
- Installable PWA with an offline app shell

Not built yet:
- **Web Push.** Reminders fire while the app or installed PWA is open. Reminders while it's fully closed need a server push service.
- **Note attachments.** Images and PDFs on notes aren't supported yet.
- **Planned features.** Focus timer, voice commands and burnout/workload detection.
- **Data handling.** A sync-conflict review UI (conflicts are logged on the server), account deletion, and server-side AI conversation history.

Note: the first `npm install` in a new workspace sometimes didn't record dependencies with this npm version. If a package is missing, re-run the install.
