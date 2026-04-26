const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP || 'http://localhost:8787'
const BACKEND_WS = import.meta.env.VITE_BACKEND_WS || 'ws://localhost:8787/ws'

const pending = new Map()
const eventListeners = new Map()
const connectionListeners = new Set()
let nextId = 1
let ws = null
let connected = false
let queue = []
let reconnectTimer = null

function connect() {
  ws = new WebSocket(BACKEND_WS)
  ws.onopen = () => {
    connected = true
    fireConnection(true)
    while (queue.length) ws.send(queue.shift())
  }
  ws.onclose = () => {
    connected = false
    fireConnection(false)
    // Reject pending callers so the UI can show errors instead of hanging.
    for (const [id, p] of pending) p.reject(new Error('Backend connection lost'))
    pending.clear()
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 1500)
  }
  ws.onerror = () => {}
  ws.onmessage = (ev) => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type === 'reply') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error || 'Unknown error'))
    } else if (msg.type === 'event') {
      const ls = eventListeners.get(msg.event) || []
      for (const fn of ls) {
        try { fn(msg.data) } catch (e) { console.error(e) }
      }
    }
  }
}

connect()

function fireConnection(state) {
  for (const fn of connectionListeners) {
    try { fn(state) } catch (e) { console.error(e) }
  }
}

export function onConnection(fn) {
  connectionListeners.add(fn)
  fn(connected)
  return () => connectionListeners.delete(fn)
}

function send(obj) {
  const payload = JSON.stringify(obj)
  if (connected && ws.readyState === WebSocket.OPEN) ws.send(payload)
  else queue.push(payload)
}

export function call(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    send({ type: 'cmd', id, cmd, args })
  })
}

export function on(event, fn) {
  if (!eventListeners.has(event)) eventListeners.set(event, [])
  eventListeners.get(event).push(fn)
  return () => {
    const ls = eventListeners.get(event) || []
    eventListeners.set(event, ls.filter((f) => f !== fn))
  }
}

export function backendUrl(pathname) {
  return BACKEND_HTTP + pathname
}

export const api = {
  identity: () => call('identity'),
  myVideos: () => call('myVideos'),
  feedVideos: () => call('feedVideos'),
  subscriptions: () => call('subscriptions'),
  subscribe: (link) => call('subscribe', { link }),
  unsubscribe: (key) => call('unsubscribe', { key }),
  upload: (args) => call('upload', args),
  prepare: (args) => call('prepare', args),
  comments: (videoId) => call('comments', { videoId }),
  comment: (videoId, text) => call('comment', { videoId, text }),
  pickSample: () => call('pickSample'),
  status: () => call('status')
}
