# Lightning FM :: Desktop App

The artist and listener app for [Lightning FM](https://lightning.fm), a music platform using the [Bitcoin Lightning Network](https://lightning.network/) and [Nostr](https://nostr.org/) built around exit rights: your catalog is signed by your key, your money settles to your wallet, and leaving costs you nothing.

Tauri v2 shell, React frontend, Rust backend with an embedded Lightning node ([ldk-node](https://github.com/lightningdevkit/ldk-node)). No external daemon required.

## What it does

- **Identity**: your Nostr key is created (or imported) locally and stored in the macOS Keychain. It never leaves your machine.
- **Publish**: tracks upload to a Blossom media server and publish as kind 31337 Nostr events signed by your key, to the Lightning FM relay and public relays. The full wire format is documented at [lightning.fm/interop](https://lightning.fm/interop).
- **Listen**: streaming is free, no account. The catalog is read from relays; audio is fetched by content hash from Blossom.
- **Sell**: attach a purchasable download (lossless master, stems zip, or the stream file itself) to any track. Buyers pay an invoice minted by your own wallet, settlement confirms via LUD-21, and the download unlocks. Fulfillment runs through the hosted gate on lightning.fm or through [your own artist node](https://github.com/Lightning-FM/lightning-fm-artist-nodes); either way the platform's cut is structurally 0% because the money never touches it.
- **Run a node**: the embedded ldk-node opens channels, pays, and receives without any external Lightning software.

## Prerequisites

- Rust (stable toolchain)
- Node.js 22+
- macOS (Keychain-backed key storage; other platforms not yet supported)
- Docker, only if you want the isolated local dev environment

## Quick start

```sh
npm install
npm run tauri:dev
```

For development against an isolated local relay and Blossom server instead of production infrastructure:

```sh
cd dev && docker compose up -d   # relay on :7777, blossom on :7778
cd ..
npm run tauri:dev:private        # separate Keychain slot, local endpoints
```

`tauri:dev:private` uses its own Keychain service name, so it never touches a real identity.

## Layout

- `src/` React frontend (library, upload, dashboard, onboarding)
- `src-tauri/src/` Rust backend: `node` (Lightning), `relay` (Nostr), `identity`, `upload`, `playback`, `streaming`, `products`, `purchases`, `metadata`, `waveform`
- `dev/` local relay + Blossom compose for isolated development

Frontend and backend communicate only through Tauri commands and events.

## About the launch catalog

The catalog Lightning FM launched with was seeded by us: a handful of house-produced test artists, published with keys we held, used to exercise every rail (publishing, streaming, purchases, payouts) end to end before asking real artists to trust it. Those artists have since been retired to our private test network and their events deleted from the relays. Today's catalog is 0GGM3NT3D, which is the operator's own music, plus onboarded artists. We would rather say this plainly than have you discover it in the commit history; the same history also shows an early 10% hosting-fee experiment that was scrapped when the current pricing landed, and the commit that removed it.

## License

[MIT](LICENSE)
