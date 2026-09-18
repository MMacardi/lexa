# Backlog — one item per session

Take the top unchecked item, do it, tick it, `/clear`. Details for each item: grep
`IDEAS.md` for the quoted heading. New ideas go in IDEAS.md plus one line here.

## Now
- [x] **1. Deploy.** Merge `social` → `main` and push, then follow `DEPLOY.md` (Railway
      backend + Postgres, Vercel frontend). Needs you in the dashboards. Write the new
      URLs into DEPLOY.md.
- [ ] **1a. Mika page.** A full `/mika` page (sidebar entry) reusing the floating tutor's
      chat + "add these words" logic, with a welcome screen of preset prompts that double
      as a tour of the app. IDEAS: "Mika page".
- [ ] **2. Beta-gate fixes.** Skip the beta-code screen when `BETA_KEY` is empty; per-person
      rate limits behind the Vercel proxy (`trust proxy`). IDEAS: "Deploy / beta follow-ups".
- [ ] **3. Coach scenes: UX + bugs.** Play through the scenes and judge whether they're
      fun; fix bugs; add more presets. IDEAS: "Scenes — backlog".

## Before public launch
- [ ] **4. Per-user token cost + real ASR/OCR pricing.** IDEAS: "Per-user token attribution",
      "Accurate ASR/OCR cost".
- [ ] **5. AI prompt-injection hardening.** IDEAS: "AI prompt-injection hardening".
- [ ] **6. Domain + email.** Buy a domain, set `SMTP_URL` (Resend/Postmark), attach it to
      Vercel (also fixes China access). IDEAS: "Site email".
- [ ] **7. Legal pages.** Fill the `[ЗАПОЛНИТЬ: …]` placeholders in /privacy and /terms.
- [ ] **8. Bump Next.js** + `npm audit`. IDEAS: "Bump Next.js".
- [ ] **9. Payments.** YooKassa / Telegram Payments → `User.plan`; a Pro Plus tier for the
      Coach; flip `BETA_ALL_PRO=false`. IDEAS: "Payment", "Launch cluster C".

## Later
- [ ] 10. Weekly recap / coaching message.
- [ ] 11. Realtime WebSocket read-aloud. IDEAS: "True realtime WS read-aloud".
- [ ] 12. Admin charts + CSV export; owner alert emails.
- [ ] 13. Fresh example per review / difficulty adaptation (token toggle). IDEAS: "B6".
- [ ] 14. Meaning backfill (shorten old meanings). IDEAS: "B7".

## Parked (🧊, only if asked)
Phoneme-level pronunciation scoring · Traditional Chinese toggle · Social layer (shared
collections, folders, community) · OpenClaw revival · Custom free-text scenes · Anki export.
