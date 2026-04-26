import fs from 'node:fs'
import path from 'node:path'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { compressVideo, decompressBin, probeCompressor } from './compressor.js'

export function attachWebSocket(ws, { state, playbackCache }) {
  function emit(event, data) {
    if (ws.readyState !== ws.OPEN) return
    ws.send(JSON.stringify({ type: 'event', event, data }))
  }
  state.eventBus = emit

  ws.on('message', async (data) => {
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.type !== 'cmd') return
    try {
      const result = await handle(msg.cmd, msg.args || {}, { state, emit, playbackCache })
      ws.send(JSON.stringify({ type: 'reply', id: msg.id, ok: true, result }))
    } catch (err) {
      console.error('cmd error', msg.cmd, err)
      ws.send(JSON.stringify({ type: 'reply', id: msg.id, ok: false, error: err.message || String(err) }))
    }
  })
}

async function handle(cmd, args, { state, emit, playbackCache }) {
  switch (cmd) {
    case 'identity':
      return { channelKey: state.myChannelKey() }

    case 'status':
      return { peers: state.peerCount }

    case 'myVideos':
      return await state.listMyVideos()

    case 'feedVideos':
      return await state.listFeedVideos()

    case 'subscriptions':
      return await state.listSubscriptions()

    case 'subscribe':
      await state.subscribe(args.link); return { ok: true }

    case 'unsubscribe':
      await state.unsubscribe(args.key); return { ok: true }

    case 'pickSample': {
      // For demo convenience: return path to the bundled hackupc-deusto/video.mp4
      const probe = probeCompressor()
      const sample = path.join(probe.repo, 'video.mp4')
      if (!fs.existsSync(sample)) throw new Error('No sample at ' + sample)
      return { path: sample }
    }

    case 'upload': {
      const { path: videoPath, title, description } = args
      if (!fs.existsSync(videoPath)) throw new Error('File not found: ' + videoPath)
      const probe = probeCompressor()
      if (!probe.exists) throw new Error(`Python compressor missing at ${probe.cli}`)
      const originalSize = fs.statSync(videoPath).size
      const id = b4a.toString(crypto.randomBytes(8), 'hex')
      const onProgress = (line) => emit('upload-progress', { line })
      onProgress('Probing video…')
      const { binBuffer, jsonMeta } = await compressVideo({ videoPath, onProgress })
      onProgress(`Publishing ${binBuffer.length} bytes to peers…`)
      const rec = await state.publishVideo({ id, title, description, binBuffer, originalSize, jsonMeta })
      return rec
    }

    case 'prepare': {
      const v = args.video
      fs.mkdirSync(playbackCache, { recursive: true })
      const mp4Path = path.join(playbackCache, `${v.author}-${v.id}.mp4`)
      // Public URL is served by the same HTTP server at /playback/<file>
      const publicUrl = `/playback/${encodeURIComponent(`${v.author}-${v.id}.mp4`)}`
      if (fs.existsSync(mp4Path)) return { url: publicUrl }
      const onProgress = (line) => emit('prepare-progress', { id: v.id, line })
      onProgress('Fetching .bin from peers…')
      const binBuffer = await state.getBinBuffer(v.author, v.id)
      onProgress(`Got ${binBuffer.length} bytes — decoding with AI model…`)
      await decompressBin({ binBuffer, outputMp4Path: mp4Path, onProgress })
      return { url: publicUrl }
    }

    case 'comments':
      return await state.listComments(args.videoId)

    case 'comment':
      return await state.appendComment(args.videoId, args.text)

    default:
      throw new Error('Unknown command: ' + cmd)
  }
}
