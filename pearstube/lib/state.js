import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperbee from 'hyperbee'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import path from 'node:path'

const TOPIC = crypto.hash(b4a.from('pearstube-discovery-v1'))

export class State {
  constructor(storageDir) {
    this.storageDir = storageDir
    this.store = new Corestore(path.join(storageDir, 'store'))
    this.swarm = null
    this.driveByKey = new Map()
    this.beeByKey = new Map()
    this.peerCount = 0
    this.subscriptions = new Set()
    this.eventBus = null
    this.myDrive = null
    this.myBee = null
    this.subsCore = null
    this.subsBee = null
    this.commentsCore = null
  }

  emit(event, data) {
    if (this.eventBus) this.eventBus(event, data)
  }

  async ready() {
    await this.store.ready()

    this.myDrive = new Hyperdrive(this.store.namespace('my-channel'))
    await this.myDrive.ready()

    const beeCore = this.store.namespace('my-channel-meta').get({ name: 'meta' })
    await beeCore.ready()
    this.myBee = new Hyperbee(beeCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await this.myBee.ready()

    this.subsCore = this.store.namespace('subs').get({ name: 'subs' })
    await this.subsCore.ready()
    this.subsBee = new Hyperbee(this.subsCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
    await this.subsBee.ready()

    this.commentsCore = this.store.namespace('comments').get({ name: 'comments' })
    await this.commentsCore.ready()

    await this.loadSubscriptions()

    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn) => {
      this.peerCount++
      this.emit('status', { peers: this.peerCount })
      this.store.replicate(conn)
      conn.on('close', () => {
        this.peerCount = Math.max(0, this.peerCount - 1)
        this.emit('status', { peers: this.peerCount })
      })
      conn.on('error', () => {})
    })

    this.swarm.join(TOPIC, { server: true, client: true })
    this.swarm.join(this.myDrive.discoveryKey, { server: true, client: true })
  }

  myChannelKey() { return b4a.toString(this.myDrive.key, 'hex') }

  async loadSubscriptions() {
    for await (const { key } of this.subsBee.createReadStream()) {
      await this.attachSubscription(key)
    }
  }

  async attachSubscription(hexKey) {
    if (this.subscriptions.has(hexKey)) return
    if (hexKey === this.myChannelKey()) return
    this.subscriptions.add(hexKey)
    const key = b4a.from(hexKey, 'hex')
    const drive = new Hyperdrive(this.store.namespace('sub-' + hexKey), key)
    await drive.ready()
    this.driveByKey.set(hexKey, drive)
    if (this.swarm) this.swarm.join(drive.discoveryKey, { server: false, client: true })
  }

  async subscribe(link) {
    let raw = link.trim()
    if (raw.startsWith('pear://')) raw = raw.slice(7)
    raw = raw.replace(/\/$/, '')
    if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('Invalid pear:// channel link')
    const hexKey = raw.toLowerCase()
    if (hexKey === this.myChannelKey()) throw new Error('Cannot subscribe to your own channel')
    await this.subsBee.put(hexKey, { addedAt: Date.now() })
    await this.attachSubscription(hexKey)
  }

  async unsubscribe(hexKey) {
    await this.subsBee.del(hexKey)
    this.subscriptions.delete(hexKey)
    const d = this.driveByKey.get(hexKey)
    if (d) {
      try { this.swarm.leave(d.discoveryKey) } catch {}
      await d.close()
      this.driveByKey.delete(hexKey)
    }
  }

  async listSubscriptions() {
    const out = []
    for (const hexKey of this.subscriptions) {
      const drive = this.driveByKey.get(hexKey)
      let videos = 0
      if (drive) {
        try {
          for await (const _ of drive.list('/videos', { recursive: false })) videos++
        } catch {}
      }
      out.push({ key: hexKey, videos, peers: drive ? drive.peers.length : 0 })
    }
    return out
  }

  async listMyVideos() {
    return await this._listVideosFromBee(this.myBee, this.myChannelKey())
  }

  async _listVideosFromBee(bee, author) {
    const out = []
    for await (const { key, value } of bee.createReadStream({ gte: 'video:', lt: 'video;' })) {
      out.push({ ...value, id: key.slice('video:'.length), author })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  async listFeedVideos() {
    const all = []
    const mine = await this.listMyVideos()
    all.push(...mine)
    for (const hexKey of this.subscriptions) {
      const drive = this.driveByKey.get(hexKey)
      if (!drive) continue
      try {
        const buf = await drive.get('/meta.json')
        if (!buf) continue
        const list = JSON.parse(b4a.toString(buf))
        for (const v of list) all.push({ ...v, author: hexKey })
      } catch {}
    }
    return all.sort((a, b) => b.createdAt - a.createdAt)
  }

  async publishVideo({ id, title, description, binBuffer, originalSize, jsonMeta }) {
    const filePath = `/videos/${id}.bin`
    await this.myDrive.put(filePath, binBuffer)
    if (jsonMeta) {
      await this.myDrive.put(`/videos/${id}.json`, b4a.from(JSON.stringify(jsonMeta)))
    }
    const record = {
      title,
      description,
      createdAt: Date.now(),
      binSize: binBuffer.length,
      originalSize,
      path: filePath
    }
    await this.myBee.put(`video:${id}`, record)
    await this._republishMeta()
    this.emit('videos-changed', {})
    return { ...record, id, author: this.myChannelKey() }
  }

  async _republishMeta() {
    const list = await this.listMyVideos()
    await this.myDrive.put('/meta.json', b4a.from(JSON.stringify(list)))
  }

  async getBinBuffer(authorHex, videoId) {
    const drive = authorHex === this.myChannelKey() ? this.myDrive : this.driveByKey.get(authorHex)
    if (!drive) throw new Error('Channel not in store')
    const buf = await drive.get(`/videos/${videoId}.bin`)
    if (!buf) throw new Error('Video file not yet replicated')
    return buf
  }

  async appendComment(videoId, text) {
    const entry = {
      videoId,
      text,
      author: this.myChannelKey(),
      at: Date.now()
    }
    await this.commentsCore.append(b4a.from(JSON.stringify(entry)))
    return entry
  }

  async listComments(videoId) {
    const out = []
    const len = this.commentsCore.length
    for (let i = 0; i < len; i++) {
      try {
        const buf = await this.commentsCore.get(i)
        const e = JSON.parse(b4a.toString(buf))
        if (e.videoId === videoId) out.push(e)
      } catch {}
    }
    return out.sort((a, b) => a.at - b.at)
  }

  async close() {
    try { if (this.swarm) await this.swarm.destroy() } catch {}
    try { await this.store.close() } catch {}
  }
}
