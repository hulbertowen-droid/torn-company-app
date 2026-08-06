# Torn Recruit Platform

A standalone, blazing-fast Torn City faction recruiting platform. Built as a subfolder of your existing tool.

## Architecture

- **MongoDB** — stores all player data (millions of records)
- **BullMQ + Redis** — delayed job queue for background player refresh workers
- **WebSockets** — pushes newly recruitable players to all connected browsers live
- **Partial Index** — MongoDB only indexes factionless + active players, so searches are instant regardless of total DB size

## Setup

### 1. Install dependencies (from root)
Already done — `bullmq`, `ioredis`, `ws` are installed.

### 2. Create your .env file
```bash
cp recruit/.env.example recruit/.env
```
Edit `recruit/.env`:
```
MONGO_URI=mongodb://localhost:27017/torn_recruit
REDIS_URL=redis://localhost:6379
PORT=4000
```

### 3. Start MongoDB and Redis
You need both running locally:
- **MongoDB**: https://www.mongodb.com/try/download/community
- **Redis**: https://redis.io/download (or use Redis Cloud free tier)

For Redis Cloud (free): https://redis.com/try-free/
For MongoDB Atlas (free): https://www.mongodb.com/cloud/atlas/register

### 4. Run the platform
```bash
node recruit/server.js
```

Open: http://localhost:4000

### 5. Register your faction
Click "Register Faction" in the top-right, paste your Torn API key.
This:
- Verifies your identity
- Loads your member list (auto-excluded from search results)
- Adds your key to the shared API pool so the background workers start scanning

## How It Works

1. After you register, background workers begin scanning Torn IDs starting from 1
2. Each player profile is fetched, parsed, and stored in MongoDB
3. Factionless + active players are automatically indexed for instant recruiter search
4. The refresh rate is dynamic:
   - Factionless players active in last hour → refreshed every 20 minutes
   - Factionless players active in last 12 hours → every 1 hour
   - Faction members → every 24 hours
   - Inactive players → weekly
5. When a player becomes factionless, they appear live in all connected browsers

## Adding More API Keys (Recommended)

More API keys = faster data. Ask your members to contribute:
```
POST /api/auth/add-key
{ "apiKey": "their_torn_api_key" }
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /api/auth/register | Register faction, add key to pool |
| POST | /api/auth/add-key | Add additional API key to pool |
| GET | /api/search | Instant recruitable player search |
| GET | /api/admin/status | Platform health + queue stats |
| POST | /api/admin/queue-player | Force-refresh a specific player ID |
| WS | /live | Live player availability WebSocket feed |
