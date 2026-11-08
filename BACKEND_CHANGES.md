# Backend changes for the Guru Admin dashboard

Copy the files in this folder over your server project (same relative paths). Only **`app.js`** is an edited existing file; everything else is new.

## New API: `/admin-panel/*`
| File | What it provides |
|---|---|
| `routes/adminPanel.js` | staff login/sign-up/email verify, `me` + profile + password + avatar removal, overview, users (list/search/export/detail + subscription days, GT adjust, role, suspend, notify, pro verify/revoke/reject), team, pro token, **live events**, audit log (+CSV), wallet transfer |
| `routes/adminPanelLibrary.js` | categories, subjects, topics, questions: list/meta/CRUD, bulk upload/move/set/delete (professionals scoped to their subjects) |
| `routes/adminPanelSchools.js` | school list + cross-school classes/quizzes/assignments/announcements, detail, create/edit/rep/suspend/delete, subscription days, wallet adjust, members, classes, graduate, quiz/assignment/announcement moderation |
| `routes/adminPanelSupport.js` | ticket list/filter/sort/export, thread + internal notes, reply (socket + push), status/priority/assign |
| `routes/adminPanelAnalytics.js` | overview / users / schools / content / quizzes / financial |
| `routes/adminPanelNotify.js` | send/schedule push & email, history, cancel |

Existing endpoints reused as-is by the dashboard: `/competition/manage*`, `/competition/:id`, `/users/updateAvatar`, `/users/password/reset`.

## New models
`AuditLog` (append-only), `AdminMisc` → `AdminFlag` (suspensions), `ActivityEvent` (30-day TTL), `UserActivity` (presence), `TicketNote`, `AdminProfile`, `ProTokenLog`, `ScheduledNotification`.
No existing schema was modified.

## New middleware / services
- `middlewares/guard.js` – blocks **suspended users and schools on the mobile API**, records request-driven activity (login, quiz start, school join/leave, payout requests, …) and audits `/competition/manage` actions.
- `middlewares/staffAuth.js`, `controllers/auditService.js`, `controllers/memberAnalytics.js`, `controllers/notificationService.js` (+ 30s scheduler), `controllers/adminHelpers.js`
- `views/admin_mail.ejs` – announcement / promo / results email layout

## `app.js` (edited)
Mounts `/admin-panel`, the guard + tracking middlewares, competition audit, and starts the suspension cache + notification worker.

## Notes
- Sign-up for professionals now needs a **phone number** (your `User.contact` is required + unique). A valid pro token is single-use and rotates after sign-up (same as the mobile register flow).
- "Live" is query-driven: it merges recent quizzes, payments, sign-ups, tickets and schools with tracked request events; presence ("online now") comes from throttled per-user request tracking.
- School "wallet" = net of that school's ledger (`WalletTransaction.schoolId`); wallets themselves remain global.
- Users have no `createdAt`; join dates come from the ObjectId timestamp.
