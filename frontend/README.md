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
