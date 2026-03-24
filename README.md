# Lightning FM — Desktop App

Tauri v2 + React + Rust. Embedded Lightning node (LDK), Nostr identity, P2P music streaming.

## Prerequisites

- **Rust** (stable toolchain)
- **Node.js** 22+
- **Docker** (Colima or Docker Desktop) — for local dev services

## Quick Start

```sh
# 1. Install dependencies
npm install

# 2. Start local dev services (Nostr relay + Blossom server)
colima start                      # if using Colima for Docker
cd dev && docker compose up -d    # relay on :7777, blossom on :3000
cd ..

# 3. Run the app
npx tauri dev
```

The app will:
1. Check macOS Keychain for an existing Nostr identity
2. Show onboarding if none found (create new or import nsec)
3. Start the LDK Lightning node on Signet
4. Load the test catalog from `test-data/`

## Dev Services

Local infrastructure runs via Docker Compose in `dev/`:

| Service | URL | Purpose |
|---|---|---|
| Nostr relay | `ws://localhost:7777` | Local Nostr events (kind 31337 tracks, kind 0 profiles) |
| Blossom server | `http://localhost:3000` | Local audio file storage (PUT /upload, GET /:hash) |

```sh
cd dev
docker compose up -d      # start in background
docker compose down        # stop
docker compose down -v     # stop and delete all data
docker compose logs -f     # tail logs
```

## Networks

Everything defaults to local/test networks. **No live network connections in dev.**

| Layer | Dev Default | Production (requires LFM_ENV=production) |
|---|---|---|
| Bitcoin | Signet (Mutinynet) | Mainnet |
| Lightning | LN on Signet | LN on Mainnet |
| Nostr relay | ws://localhost:7777 | wss://relay.damus.io, nos.lol, relay.nostr.band |
| Blossom | http://localhost:3000 | https://media.lightning.fm |

Override with env vars: `LFM_NOSTR_RELAYS`, `LFM_BLOSSOM_SERVER`, `LFM_ENV`.

## Tests

```sh
# Rust tests (113 tests, <1s)
cd src-tauri && cargo test

# React tests (18 tests, <1s)
npx vitest run

# Both
(cd src-tauri && cargo test) && npx vitest run
```

## Project Structure

```
app-desktop/
├── dev/                    # Docker Compose for local dev services
├── src/                    # React frontend
│   ├── App.tsx             # Main app shell, routing, player
│   ├── components/
│   │   ├── library/        # Catalog browsing (track list, artist grid)
│   │   ├── upload/         # Artist upload (3-pane: tracks, detail, preview)
│   │   ├── dashboard/      # Earnings, node status, withdrawals
│   │   ├── onboarding/     # Identity create/import flow
│   │   └── PaymentNotification.tsx
│   └── globals.css         # Design system (amber terminal)
├── src-tauri/src/          # Rust backend
│   ├── node.rs             # LDK node lifecycle
│   ├── identity.rs         # Nostr keypair + keychain
│   ├── relay.rs            # Nostr relay connection + events
│   ├── upload.rs           # Blossom upload
│   ├── metadata.rs         # ID3/Vorbis tag read/write (lofty)
│   ├── waveform.rs         # Audio peak generation (symphonia)
│   ├── playback.rs         # 3-tier audio fetch + cache
│   ├── streaming.rs        # Payment session + rake model
│   ├── credits.rs          # Listener funding
│   ├── events.rs           # LDK event loop → frontend
│   └── commands.rs         # Tauri command definitions
└── test-data/              # 40 test MP3s (4 artists × 10 tracks)
```
