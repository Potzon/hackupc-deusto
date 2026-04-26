import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { State } from './lib/state.js'
import { attachWebSocket } from './lib/protocol.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE_PORT = Number(process.env.PEARSTUBE_PORT || 8787)
const STORAGE_DIR = process.env.PEARSTUBE_STORAGE
  || path.join(__dirname, '.pearstube', 'default')
const PLAYBACK_CACHE = path.join(STORAGE_DIR, 'playback-cache')

fs.mkdirSync(STORAGE_DIR, { recursive: true })
fs.mkdirSync(PLAYBACK_CACHE, { recursive: true })

console.log(`[pearstube] storage: ${STORAGE_DIR}`)

const state = new State(STORAGE_DIR)
await state.ready()
console.log(`[pearstube] my channel: pear://${state.myChannelKey()}`)

const server = http.createServer((req, res) => {
  // CORS for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname.startsWith('/playback/')) {
    const fname = decodeURIComponent(url.pathname.slice('/playback/'.length))
    const safe = path.basename(fname)
    const filePath = path.join(PLAYBACK_CACHE, safe)
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('not found'); return }
    serveVideo(req, res, filePath)
    return
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, channel: state.myChannelKey(), peers: state.peerCount }))
    return
  }

  res.writeHead(404); res.end('not found')
})

const wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (ws) => {
  console.log('[pearstube] UI connected')
  attachWebSocket(ws, { state, playbackCache: PLAYBACK_CACHE })
  ws.on('close', () => console.log('[pearstube] UI disconnected'))
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const trying = nextPort + 1
    console.warn(`[pearstube] port ${nextPort} busy, trying ${trying}`)
    nextPort = trying
    server.listen(nextPort)
    return
  }
  throw err
})

let nextPort = BASE_PORT
server.listen(nextPort, () => {
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : nextPort
  console.log(`[pearstube] backend listening on http://localhost:${port}`)
  console.log(`[pearstube] open the Vite dev URL in your browser`)
})

function serveVideo(req, res, filePath) {
  const stat = fs.statSync(filePath)
  const range = req.headers.range
  if (!range) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes'
    })
    fs.createReadStream(filePath).pipe(res)
    return
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  const start = m[1] ? parseInt(m[1], 10) : 0
  const end = m[2] ? parseInt(m[2], 10) : stat.size - 1
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': 'video/mp4'
  })
  fs.createReadStream(filePath, { start, end }).pipe(res)
}

const shutdown = async () => {
  console.log('\n[pearstube] shutting down…')
  try { await state.close() } catch {}
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
