# Torn Company App / Faction Warboard (Spider-Verse)

## Overview & Architecture
This repository contains the full-stack web application and automated Discord combat bot powering **spider-verse.net** for Torn City faction warfare, chain management, economy, and member intelligence.

### Stack & Core Components
- **Runtime**: Node.js (CommonJS, Express monolith in `server.js`).
- **Real-Time Layer**: WebSockets (`ws`) broadcasting live attacks, claims, war state, and chain counters to connected clients.
- **Frontend**: High-performance static web app in `public/` using native Vanilla CSS design tokens (`global.css`, `style.css`). Modern dark-mode cyberpunk aesthetic.
- **Database**: Dual-layer storage:
  - MongoDB via Mongoose (when `MONGODB_URI` environment variable is set).
  - Local JSON fallbacks in `data/` and root directory (`company_history.json`, `inactivity_alerts.json`, `war_flight_archive.json`, `claims.json`).
- **External Integrations**:
  - **Torn City API v1 & v2**: Used for faction basic, attacks, chain, profile, and bazaar/market queries. API keys are rotated using an internal pool (`apiPoolConfig.keys`).
  - **FFScouter API**: Provides estimated battle stats (`/api/v1/get-stats`) and flight telemetry (`/api/v1/player-flights`).
  - **Discord API v10**: REST API for alert embeds and Discord Gateway (`discord.js` v14) for slash commands and interactive button handlers.

---

## Critical Safety & Coding Protocols

1. **Syntax Verification**:
   - Always run `node -c server.js` before committing any changes to `server.js`.
   - `server.js` is an extensive, mission-critical file. Never replace or truncate large sections blindly. Make localized, surgical updates.

2. **Multi-Tenant State Isolation**:
   - Attacks, targets, claims, and warboard states are isolated per faction using `getFactionWarState(factionId)`. Never mix state across different faction IDs.

3. **API Key Security**:
   - Never log personal API keys to stdout/stderr.
   - Never broadcast one member's API key to other users over WebSockets or HTTP responses.

4. **Discord Component Constraints**:
   - **Webhooks**: Only support Link buttons (`style: 5`). Discord rejects `custom_id` interactive buttons on webhook payloads.
   - **Bot Gateways**: Support both Link buttons (`style: 5`) and interactive Action buttons (`style: 1..4`, e.g. `claim_<targetId>`).
   - Maximum of 5 buttons per `ActionRow` (type: 1), and max 5 ActionRows per message.

5. **Deployment & GitHub Sync Flow (MANDATORY)**:
   - **Always Commit & Push**: Every time any code, configuration, or documentation change is made, immediately run `node -c server.js`, commit with a clear message, and push to `origin/main` on GitHub (`git push origin main`). Never leave changes unpushed.
   - The production deployment on Render is linked to GitHub repository:
     `hulbertowen-droid/torn-company-app` on the `main` branch.
   - Pushing to `origin/main` automatically triggers Render to build and deploy live to **https://spider-verse.net**.

---

## Key File Structure
- `server.js`: Central backend server, API endpoints, background scanners, WebSocket hub, and Discord bot.
- `public/`:
  - `index.html`: Live Warboard with real-time target grids and claims.
  - `chain.html`: Dedicated chain watcher, timer countdowns, and hit history.
  - `dashboard.html`: Faction war dashboard, stats comparison, and leaderboards.
  - `discord.html`: Discord alert configurations, token settings, trigger toggles, and slash command registration.
  - `travel.html`: Live foreign destination tracker and overseas restock intel.
  - `bazaar.html`: Market undercut watcher and price monitoring.
  - `members.html`: Faction roster, activity tracker, and readiness breakdown.
  - `recruit/`: Faction recruitment portal for scouting factionless players.
- `scripts/`: Maintenance scripts and archived migration tools.
