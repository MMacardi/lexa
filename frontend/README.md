# Onomika — frontend

Next.js 15 (App Router) + Tailwind 4 + TanStack Query. Talks to the Express backend in
`../backend` over `/api/*`.

## Run locally

```bash
npm install
npm run dev -- -p 3001   # the backend owns :3000
```

Or start everything from the repo root with `docker compose up -d`.

## Environment

See `.env.example`. In short:

- **Local**: `NEXT_PUBLIC_API_URL=http://localhost:3000`. The browser calls the backend
  directly.
- **Production (Vercel)**: leave `NEXT_PUBLIC_API_URL` unset and set `BACKEND_URL` to the
  Railway URL. `next.config.ts` proxies `/api/*` there, so the session cookies stay
  first-party.

Deployment steps are in [`../DEPLOY.md`](../DEPLOY.md).

## Landing screenshots

With local Docker running, Chrome installed and this directory's dependencies installed:

```bash
npm run landing:shots
npm run landing:shots -- plan,today
```

The script runs guest onboarding and uses a fresh local demo account to capture Plan,
Today, Reader, Flashcards, Writing and Mika in Russian, English and Chinese. It writes
600 × 1022 WebP images to `public/landing/`. Reader lookups and the Mika conversation
make a few paid Qwen calls (roughly under ¥0.05 for a full run). Chrome's temporary
profile stays in the project's `.review/browser-tmp` directory.
