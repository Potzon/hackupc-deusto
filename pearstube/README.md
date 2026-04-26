# PearsTube

Censorship-resistant P2P video on Pear, with the DCVC neural codec for hostile-network bandwidth.

## Pitch

YouTube without YouTube. Channels are Hyperdrives, the feed is a hyperswarm topic, comments are an Autobase. Every video is run through a neural compressor that shrinks it to ~2% of the original size, so it actually moves over throttled networks (protests under censorship, disaster zones, refugee corridors).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Renderer (Electron / React + Vite)         │
│   ui-src/  ──build──▶  ui/                  │
└─────────────────┬───────────────────────────┘
                  │  parent.send / on('message')   (JSON line protocol)
┌─────────────────▼───────────────────────────┐
│  Main process (Bare runtime, index.js)      │
│   • lib/state.js       Hyperdrive + Hyperbee per user (own channel + subs)
│   • lib/swarm.js       Hyperswarm discovery (built into state)
│   • lib/protocol.js    IPC dispatcher
│   • lib/compressor.js  Bridges to ../hackupc-deusto/cli.py via bare-subprocess
└─────────────────────────────────────────────┘
```

### P2P building blocks used

| Concern | Module |
|---|---|
| Per-user channel storage | **Hyperdrive** (`/videos/<id>.bin`, `/meta.json`) |
| Channel metadata (sortable) | **Hyperbee** |
| Peer discovery | **Hyperswarm** on a fixed `pearstube-discovery-v1` topic + per-channel discovery |
| Multi-writer comments | **Hypercore** per-user (Autobase-ready scaffolding in `state.commentsCore`) |
| Storage | **Corestore** with namespacing |

## Run it

Requires Node 18+ (Vite 5), `python3` with the DCVC compressor working in `../hackupc-deusto/`, and `ffmpeg` on PATH.

```bash
cd pearstube
npm install
npm run dev
```

The dev script builds the React UI then launches Pear in dev mode. Your channel link prints to stdout: `pear://<64-hex-key>` — share it with another peer to subscribe.

### One environmental gotcha

If you see `Cannot find module '/path/to/project/run'` when launching, your shell has `ELECTRON_RUN_AS_NODE=1` set, which makes Electron act as a plain Node interpreter. The `npm run dev` script unsets it, but if you run `pear run` directly, do:

```bash
unset ELECTRON_RUN_AS_NODE
pear run -d .
```

### Where data lives

Pear gives each app a per-install storage dir. Your hypercores live in `${Pear.config.storage}/store`, decoded mp4 cache in `${Pear.config.storage}/playback-cache`.

## Demo flow

1. Launch the app on machine A. Copy the `pear://...` channel link from the sidebar.
2. Click **Upload**, pick an mp4, set a title. Hit **Compress & Publish**. The Python compressor runs (see progress lines), the resulting `.bin` lands in your Hyperdrive, metadata in your Hyperbee.
3. Launch the app on machine B. Click **Subscriptions**, paste the link from A, **Subscribe**.
4. Machine B sees the new video appear in its **Feed** within seconds. Click to watch — the `.bin` is fetched from machine A's drive over Hyperswarm, decoded by the local Python decompressor, and played back.
5. Comments are appended to each user's local hypercore; replication of the comments stream is wired into corestore.

## What's stubbed for the hackathon (be honest in the demo)

- **Comments are single-writer per user.** The `commentsCore` exists per node but isn't yet wrapped in an Autobase view that aggregates remote writers. The plumbing is there — drop in an `autobase` instance over the discovered comment cores to finish.
- **The Python compressor must be installed locally on every peer.** A real release would either ship the model weights inside the Pear app, or stream raw frames + neural codec spec.
- **No auth on subscribe.** Anyone with your channel key can replicate.
- **Compression quality is hardcoded** to `qp=3` — the DCVC config uses fixed test config. To expose quality slider, parameterize `cli.py`.

## File layout

```
pearstube/
├── index.js               # Pear/Bare main entry
├── package.json
├── vite.config.js
├── lib/
│   ├── state.js           # P2P state: corestore, drives, swarm, comments
│   ├── protocol.js        # IPC: maps cmd messages to state methods
│   └── compressor.js      # Spawns python cli.py
├── ui-src/                # React source (Vite root)
│   ├── index.html
│   ├── main.jsx
│   ├── App.jsx
│   ├── api.js             # Pipe-IPC client
│   ├── styles.css
│   └── components/
│       ├── Sidebar.jsx
│       ├── Feed.jsx
│       ├── MyChannel.jsx
│       ├── Upload.jsx
│       ├── VideoView.jsx
│       └── Toast.jsx
└── ui/                    # Vite build output (gitignored, served by pear-bridge)
```
