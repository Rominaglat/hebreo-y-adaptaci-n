# Learning Portal

A single-tenant Hebrew (RTL) learning portal built with React, Vite, TypeScript, Tailwind, shadcn/ui, and Supabase (PostgreSQL + Deno Edge Functions).

Each customer deployment is its own Supabase project and its own frontend hosting — there is no shared infrastructure between tenants.

## Tech stack

- Frontend: React 19, TypeScript, Vite, TailwindCSS, shadcn/ui
- Backend: Supabase (PostgreSQL) with Deno Edge Functions
- Hosting: Vercel (or any static host that supports SPA rewrites)

## Getting started

```sh
# Install dependencies
npm install

# Start the dev server
npm run dev

# Type-check + run unit tests
npm test

# Production build
npm run build
```

Create a `.env` file based on `.env.example` and point it at your own Supabase project.

## Deployment

See [`docs/deployment/single-tenant-setup.md`](docs/deployment/single-tenant-setup.md) for the full single-tenant deployment runbook — provisioning a fresh Supabase project, seeding the tenant row, configuring edge function secrets, and wiring up the frontend host.
