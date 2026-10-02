# Student OS

An offline-first academic planner: upload your timetable once, and it tracks attendance, plans your day, schedules spaced-repetition revisions, reminds you on every device and syncs everything. AI Pilot (Gemini, via the server only) sets up your workspace with you and can manage the whole app in plain language, but every change it proposes needs your confirmation.

## Quick start

Requirements: Node 20+ and PostgreSQL. Run `docker compose up -d` for a local Postgres.

```bash
npm install
cp apps/server/.env.example apps/server/.env   # set GEMINI_API_KEY to enable AI
npm run vapid -w @student-os/server            # paste the keys into .env to enable push reminders
npm run db:deploy -w @student-os/server        # apply migrations
npm run dev                                    # API on :4000, web on :5173
```

The app opens on a sign-in page (Google or email + password). If the server can't be reached, it offers "Use on this device only", and data stays in IndexedDB until you sign in.

## User flow

```
Open app → signed in? ── no ──→ Sign in / Sign up (Google or email + password, nothing else)
              │ yes
              ▼
        setup complete? ── yes ──→ Home
              │ no (a returning user's settings arrive with the first sync, so we wait for it)
              ▼
     🤖 AI Pilot  or  ⚙ Manual setup   (switch any time; answers carry over)
              ▼
            Home
```

- **AI Pilot setup** is a chat that asks one thing at a time: timetable upload (Gemini reads PDF / image / screenshot / Excel / CSV, and you confirm before anything is saved), minimum and target attendance, optional academic details, reminders and notification permission, revision intervals, study times and daily target. Short answers like "75%", "5th sem", "15 Dec", "evening and night" or "3 hours" are understood by deterministic parsers (`apps/web/src/lib/setup-parse.ts`), so they can't be misread into wrong settings.
- **Manual setup** is a 7-step wizard: basic info, subjects, class schedule, attendance rules, revision, notifications, study preferences. Every step can be skipped.
- **Navigation.** Laptop: sidebar with Home, AI Pilot, Todos, Calendar, Revision, Attendance, Subjects, Notes, Exams, Analytics, Settings. Phone: bottom bar Home · AI · Todos · Calendar · **+** (add task, class, event, topic, exam, assignment, note…), with every other section under the profile button.
- **Todos** combines today's classes, tasks, due revisions, assignments, exams and personal items, with Today / Upcoming / Overdue views and All / Study / Revision / Assignments / Personal filters. Revisions from the spaced-repetition schedule appear on their due date automatically.
- **AI everywhere.** Home, Todos, Calendar, Revision and Attendance each have an "Ask AI…" bar with page-specific suggestions; the AI button in the header opens AI Pilot from any page (or press `.`).

## Deploy to Vercel

One Vercel project serves both the PWA and the API (an Express app bundled into a single serverless function by `scripts/vercel-build.mjs`, using the Build Output API).

1. **Import the repo** at vercel.com/new. Keep the root directory as the repository root; `vercel.json` sets the install and build commands.
2. **Add a database.** In the project: Storage → Create Database → Neon (Postgres) → connect it. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Production builds apply migrations automatically (using the unpooled URL).
3. **Set environment variables** (Settings → Environment Variables):

   | Variable | Needed for | Value |
   | --- | --- | --- |
   | `JWT_SECRET` | sign-in (required) | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `GEMINI_API_KEY` | AI Pilot, timetable reading | a key from Google AI Studio |
   | `GOOGLE_CLIENT_ID` | "Continue with Google" | OAuth client (Web application); add `https://<your-app>.vercel.app` to *Authorized JavaScript origins* |
   | `SMTP_URL` | Email codes (required) | One-time codes for sign-up, sign-in, forgot password and email changes. e.g. Gmail `smtps://you%40gmail.com:APP-PASSWORD@smtp.gmail.com:465` (use a Google *App password*) or Resend `smtps://resend:API-KEY@smtp.resend.com:465`. Without it, production refuses to send codes; development prints them to the server console |
   | `MAIL_FROM` | Email codes | Sender, e.g. `Student OS <you@gmail.com>` (must be an address your SMTP account may send from) |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push reminders when the app is closed | `npm run vapid -w @student-os/server` |
   | `CRON_SECRET` | push reminders on Vercel | 16+ random characters |
   | `PUSH_CRON_SCHEDULE` | push reminders on Vercel **Pro** | `* * * * *` (Hobby allows only daily crons; instead, call `GET /api/cron/push` every minute from a free scheduler such as cron-job.org with the header `Authorization: Bearer <CRON_SECRET>`) |

4. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.
5. **Check it:** `https://<your-app>.vercel.app/api/health` → `{"ok":true}`, and `/api/ai/status` → `{"available":true}`. If a variable is missing, API calls answer with a message naming it (for example `JWT_SECRET: Set a JWT_SECRET of at least 32 characters in production`) and the sign-in page shows it.

The Android app works against the same deployment: set its server address to `https://<your-app>.vercel.app`.

Build locally with `npm run vercel-build` (output in `.vercel/output`), or deploy from your machine with `npx vercel --prod`.

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests for all packages |
| `TEST_DATABASE_URL=… npm test -w @student-os/server` | Also runs the push scheduler tests against a real (throwaway) Postgres |
| `npm run typecheck` | TypeScript across the monorepo |
| `npm run build` | Production builds (server bundle + PWA) |
| `npm run vercel-build` | Vercel build output (PWA + bundled API function) in `.vercel/output` |
| `node apps/server/scripts/e2e-sync.mjs` | End-to-end API/sync check against a running server |

## Layout

```
packages/core   Shared domain logic (no I/O): entity schemas, attendance math,
                recurrence engine, adaptive revision, priority scoring, conflict
                resolution, notification planner, AI action registry.
apps/server     Express + Prisma/Postgres: auth, /api/sync, push scheduler + Web Push,
                notification actions, AI command endpoint (Gemini).
apps/web        React + Vite + Tailwind PWA, Dexie (IndexedDB), sync engine,
                notification scheduler, service worker, AI Pilot, UI.
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

### AI Pilot (confirmation-based AI control)

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
- **Permissions.** Settings → AI Pilot shows a permission tree per area (Profile, Todos, Schedule, Attendance, Revision, Exams, Subjects, Notes, App settings, Notifications). Each area has view/create/update/delete switches and an access level: **Ask first** (every change needs confirming) or **Full access** (creates and updates apply straight away, still logged and undoable; deletions and bulk changes always ask). Permissions are enforced on the server (`validateIntents`, using the signed-in user's stored settings rather than what the client sends) and again on the device. Turned-off actions are named in the prompt, so the AI says it isn't allowed instead of improvising.
- **AI Power is user-only.** AI Power (Low / Balanced / High / Max: model choice and conversation memory) and the AI permissions themselves can never be changed by AI, whatever else is allowed. This is enforced in code, not only in the prompt: the server rejects any intent that touches them, the client handler refuses them, and the storage layer throws if a settings write made during an AI action changes them.
- **Profile.** With *Update profile* allowed, AI Pilot can change your name, college, course, semester, bio and study hours (shown as before → after, then confirmed).
- **Reliability.** Gemini 3 models run at their default temperature (Google warns lower values cause looping and degraded output, which showed up as broken JSON). Overloaded or unknown models fall back to the next one in `GEMINI_FALLBACK_MODELS`; a rejected API key is reported as such instead of being retried. Each request has a time budget (`AI_TIMEOUT_MS`) so serverless functions answer before they time out, and large photos are downscaled in the browser before upload (Vercel caps request bodies at 4.5 MB).
- **History and undo.** Results offer **Undo**. *AI activity* lists every proposal and decision. Undo skips records that changed since, instead of overwriting them.
- **Conversation.** Pending proposals are kept in the conversation, so "make it two hours" corrects the last one. Voice input works where the browser supports speech recognition. AI Pilot is a panel on every page (press `.` or the AI button) and a full page at `/assistant`.

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
- AI Pilot: guided setup, action registry, confirmations, clarification, permissions, AI activity history, undo, voice input
- Email and Google auth, multi-device sync, installable PWA with an offline app shell

Verified in this environment:
- unit and integration tests across all three packages;
- the push scheduler against a real Postgres (PGlite);
- a real Web Push delivered to headless Edge through Windows' push service while the app was closed;
- the full UI flows in headless Edge.

AI Pilot UI tests used canned AI responses, because no Gemini key was available.

Not built yet:
- **Note attachments.** Images and PDFs on notes aren't supported yet.
- **Planned features.** Focus timer and burnout/workload detection.
- **Data handling.** A sync-conflict review UI (conflicts are logged on the server), account deletion, and cross-device read state for the notification center (read marks are stored per device; the server records them but doesn't send them back).
- **Closed-app reminders without network.** These depend on periodic background sync, which browsers run rarely and only for installed Chromium PWAs. No web platform API supports exact offline alarms.

Note: the first `npm install` in a new workspace sometimes didn't record dependencies with this npm version. If a package is missing, re-run the install.
