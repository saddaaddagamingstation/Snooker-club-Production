# Snooker Club Management System — PRD

## Original Problem Statement
Complete responsive Snooker Club Management System web app with modern dark UI, billiards/snooker theme. Roles: Admin (full access) and Staff (configurable permissions). Auth with email/password, forgot password, remember me. Dashboard with KPIs & charts. Tables (available/running/reserved/maintenance). Sessions with auto-locked hourly rate. Snack catalog + snack ordering during session. Billing with discount/tax, print, PDF, WhatsApp share. Reports (daily/weekly/monthly) with CSV export. Currency ₹ INR.

## Architecture
- Frontend: React (JS) + Tailwind + shadcn/ui + Recharts + Sonner
- Backend: FastAPI + Motor (MongoDB async)
- Auth: JWT (bcrypt hashing, 7-day tokens, Bearer header)
- Design: dark theme, black + dark gray + green accents (Manrope/Figtree/JetBrains Mono)

## User Personas
- **Admin** (supremepoolandsnooker@gmail.com / SupremeSnookerClub2ndfloor): full control including staff & permissions
- **Staff** (staff@snooker.com / staff123): default permission = manage_sessions only; other perms toggled by admin

## Permission Keys
- `manage_tables` — create/edit/delete snooker tables
- `manage_snacks` — create/edit/delete snacks catalog
- `manage_sessions` — start/end sessions, add snacks
- `view_reports` — view daily/weekly/monthly reports
- `manage_users` — create/edit/delete team members

## Implemented (2026-05-19 → 2026-07-16)
- JWT auth (login, /me, forgot/reset password) with bcrypt
- Seed admin + staff on startup
- Tables CRUD with statuses
- Snacks CRUD
- Session lifecycle: start (auto-locks rate) → add snacks → end (auto-calculates bill with discount/tax)
- Dashboard: 6 KPIs, daily revenue chart, snack pie, peak hours bar
- Reports with period filter (daily/weekly/monthly) + date range + CSV export + print-to-PDF
- Bill/invoice view with WhatsApp share (wa.me), print stylesheet
- Role & permission-based route/nav gating
- Staff & Permissions admin page with toggle switches

## Backlog / Not Implemented
- P2: Notification center (push toasts exist; no persistent center)
- P2: Snack image upload (URL field only)
- P2: Real WhatsApp Business API integration (uses wa.me web share)
- P2: Multi-club/tenancy
