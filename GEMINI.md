# GEMINI Agent Rules — swipe-to-hire

## Critical: graph.ts is Read-Only for Implementation

**Do NOT implement new code inside `packages/agent/graph.ts`** (graph nodes, agent logic, LangGraph wiring).

In `packages/agent/graph.ts` you are allowed to:
- Delete dead code
- Add new TypeScript interfaces, types, exported Zod schemas, or exported constants
- Add new exported function **signatures** (with stub body that throws `new Error('not implemented')`)

For any new logic or changes to existing logic in `graph.ts`, instead of implementing:
1. Write a **comment block** with pseudo-code describing what needs to change
2. Add a `// TODO(user):` instruction explaining what the user needs to implement or update

### Example
```typescript
// TODO(user): Update jobsSearchNode to accept userInsights from DB.
// Pseudo-code:
//   const insights = db.getUserInsights(userId)
//   if (insights.length > 0) {
//     messages.push(new SystemMessage(`User insights: ${insights.join('\n')}`))
//   }
```

All other files (e.g. `db.ts`, `bot.ts`, `api.ts`, etc.) can be fully implemented.

---

## Deployment — RPi via `npm run release`

### Prerequisites on RPi
```bash
# On RPi: clone the repo and install deps once
git clone https://github.com/mikhailkogan17/swipe-to-hire.git ~/swipe-to-hire
cd ~/swipe-to-hire
npm install
cp .env.example .env   # fill in real keys
```

### Local → RPi deploy flow
```
npm run release          # patch bump (0.1.0 → 0.1.1)
npm run release:minor    # minor bump (0.1.0 → 0.2.0)
npm run release:major    # major bump (0.1.0 → 1.0.0)
```

What `npm run release` does (see `scripts/release.js`):
1. Checks for uncommitted changes (refuses if dirty)
2. Bumps version in `package.json`
3. Builds miniapp: `npm run build:miniapp`
4. Commits `package.json` + `packages/miniapp/dist`
5. Creates git tag `v<version>`
6. `git push && git push --tags`
7. SSH into `pi@raspberrypi.local` → `git pull && npm run build:miniapp && docker-compose up -d --build bot`

### Environment variables for release
```bash
# Optional overrides (defaults work for RPi on local network)
export RPI_HOST=pi@raspberrypi.local   # default
export RPI_DIR=/home/pi/swipe-to-hire  # default
```

### Manual RPi deploy (without release script)
```bash
ssh pi@raspberrypi.local
cd ~/swipe-to-hire
git pull
npm run build:miniapp
docker-compose up -d --build bot
```

### Checking logs on RPi
```bash
ssh pi@raspberrypi.local "cd ~/swipe-to-hire && docker-compose logs -f bot"
```

### Miniapp served via nginx (port 8209)
The miniapp `dist/` is mounted as a volume into the nginx container.
After `git pull` + `npm run build:miniapp` on RPi, restart nginx:
```bash
docker-compose restart miniapp
```

---

## Testing

```bash
npm test                  # unit tests only (fast, no API calls)
npm run test:integration  # real API calls (OpenRouter + RapidAPI)
npm run test:all          # both
npm run test:watch        # watch mode for unit tests
```

Integration tests use `OPENROUTER_API_KEY` from `.env` (or the fallback key in the test file).
Set `RAPIDAPI_KEY` in `.env` to enable the full graph integration test.

---

## Project structure

```
packages/
  agent/    — LangGraph pipeline (graph.ts, db.ts, env.ts)
  bot/      — Telegraf bot + Fastify API + scheduler
  miniapp/  — React/Vite Telegram Mini App
  types/    — Shared TypeScript types
  cli/      — CLI runner for local dev
scripts/
  release.js  — version bump + deploy
vitest.config.ts
```

