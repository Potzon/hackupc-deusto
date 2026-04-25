/** @typedef {import('pear-interface')} */ /* global Pear */

import Hyperswarm from 'hyperswarm'
import Hyperdrive from 'hyperdrive'
import Corestore from 'corestore'
import b4a from 'b4a'

const status = document.getElementById('status')
const shareKey = document.getElementById('share-key')

function setStatus(msg) {
  status.textContent = msg
}

// --- SHARE SIDE ---

document.getElementById('pick-file').addEventListener('click', async () => {
  const [fileHandle] = await window.showOpenFilePicker({
    types: [{ description: 'Videos', accept: { 'video/*': ['.mp4', '.mkv', '.webm'] } }]
  })

  const file = await fileHandle.getFile()
  setStatus(`Selected: ${file.name} — setting up drive...`)

  const store = new Corestore('./store-sender')
  const drive = new Hyperdrive(store)
  await drive.ready()

  const key = b4a.toString(drive.key, 'hex')
  shareKey.textContent = `Share key: ${key}`
  shareKey.style.display = 'block'

  setStatus('Writing file to drive...')
  const buf = await file.arrayBuffer()
  await drive.put('/video/' + file.name, Buffer.from(buf))
  setStatus('File written. Seeding...')

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    setStatus('Peer connected!')
    store.replicate(conn)
  })
  swarm.join(drive.discoveryKey)
  await swarm.flush()
  setStatus('Seeding — share the key above!')
})

// --- RECEIVE SIDE ---

document.getElementById('connect-btn').addEventListener('click', async () => {
  const key = document.getElementById('peer-key').value.trim()
  if (!key) return setStatus('Paste a key first')

  setStatus('Connecting to peer...')
  const store = new Corestore('./store-receiver')
  const drive = new Hyperdrive(store, b4a.from(key, 'hex'))
  await drive.ready()

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => {
    setStatus('Peer found! Downloading...')
    store.replicate(conn)
  })
  swarm.join(drive.discoveryKey)
  await swarm.flush()

  // wait for file to appear
  drive.watch('/video/', async () => {
    const files = await drive.readdir('/video/')
    if (files.length === 0) return
    const filename = files[0]
    setStatus(`Downloading ${filename}...`)
    const buf = await drive.get('/video/' + filename)
    const blob = new Blob([buf], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setStatus(`Downloaded: ${filename}`)
  })
})