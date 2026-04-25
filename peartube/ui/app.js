/** @typedef {import('pear-interface')} */
 
/* global Pear */
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import Hypercore from 'hypercore'
import Corestore from 'corestore'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import os from 'os'

// Pear apps provide configuration related to the run environment.
// Depending on how it's launched, Pear.config.dir usually points to the app directory.
const peartubeDir = Pear.config.dir || process.cwd();
const repoRoot = path.resolve(peartubeDir, '../')

const { teardown, updates } = Pear

const store = new Corestore(Pear.config.storage)
const swarm = new Hyperswarm()
let currentVideoCore = null; // Currently playing or seeding video core
let knownVideos = []; // Local cache of catalog

// Global Topic for the catalog (determines the network we join for discovery)
const GLOBAL_DISCOVERY_TOPIC = crypto.hash(b4a.from('peartube-neural-catalog-v1'))

teardown(() => {
  swarm.destroy()
  store.close()
})

updates(() => Pear.reload())

swarm.on('connection', (peer) => {
  store.replicate(peer)
  
  const handshakeMsg = JSON.stringify({ type: 'catalog-sync', videos: knownVideos })
  peer.write(b4a.from(handshakeMsg))
  
  peer.on('data', data => {
    try {
      const msg = JSON.parse(b4a.toString(data))
      if (msg.type === 'new-video') {
        addVideoToGallery(msg.title, msg.topic, msg.binTopic)
      } else if (msg.type === 'catalog-sync') {
        if (msg.videos && Array.isArray(msg.videos)) {
          msg.videos.forEach(v => addVideoToGallery(v.title, v.topic, v.binTopic))
        }
      }
    } catch (e) {
      // Ignore normal replication noise
    }
  })
})

swarm.on('update', () => {
  document.querySelector('#global-peers').textContent = swarm.connections.size
})

const discovery = swarm.join(GLOBAL_DISCOVERY_TOPIC, { client: true, server: true })
discovery.flushed().then(() => {
  console.log('Joined global neural catalog.')
})

document.querySelector('#btn-show-upload').addEventListener('click', () => {
  document.querySelector('#upload-modal').classList.remove('hidden')
})
document.querySelector('#btn-close-upload').addEventListener('click', () => {
  document.querySelector('#upload-modal').classList.add('hidden')
})
document.querySelector('#btn-publish-video').addEventListener('click', publishVideo)
document.querySelector('#btn-back-gallery').addEventListener('click', () => {
  document.querySelector('#player-view').classList.add('hidden')
  document.querySelector('#gallery-view').classList.remove('hidden')
  document.querySelector('#player').src = "" // Stop video
})
document.querySelector('#btn-play-normal').addEventListener('click', () => {
  startViewerPlayback(window.currentPlayContext.topic, false)
})
document.querySelector('#btn-play-neural').addEventListener('click', () => {
  startViewerPlayback(window.currentPlayContext.binTopic, true)
})

async function publishVideo() {
  const fileInput = document.querySelector('#video-file')
  const binInput = document.querySelector('#bin-file')
  const titleInput = document.querySelector('#video-title')
  
  if (!fileInput.files.length && !binInput.files.length) {
    alert("At least one video or .bin file required")
    return
  }

  const file = fileInput.files.length > 0 ? fileInput.files[0] : null
  const binFile = binInput.files.length > 0 ? binInput.files[0] : null
  const title = titleInput.value
  
  document.querySelector('#upload-modal').classList.add('hidden')

  let topicHex = null
  let binTopicHex = null

  if (file) {
    const core = store.get({ name: `video-core-${Date.now()}` })
    await core.ready()
    swarm.join(core.discoveryKey, { server: true, client: false })
    topicHex = b4a.toString(core.key, 'hex')
    
    const chunkSize = 128 * 1024;
    let offset = 0;
    file.arrayBuffer().then(async (buffer) => {
      const totalBytes = buffer.byteLength;
      while (offset < totalBytes) {
        const chunk = new Uint8Array(buffer, offset, Math.min(chunkSize, totalBytes - offset));
        await core.append(chunk);
        offset += chunk.length;
      }
      console.log("Seeding complete for mp4:", title);
    })
  }

  if (binFile) {
    const binCore = store.get({ name: `video-core-bin-${Date.now()}` })
    await binCore.ready()
    swarm.join(binCore.discoveryKey, { server: true, client: false })
    binTopicHex = b4a.toString(binCore.key, 'hex')
    
    const chunkSize = 128 * 1024;
    let offset = 0;
    binFile.arrayBuffer().then(async (buffer) => {
      const totalBytes = buffer.byteLength;
      while (offset < totalBytes) {
        const chunk = new Uint8Array(buffer, offset, Math.min(chunkSize, totalBytes - offset));
        await binCore.append(chunk);
        offset += chunk.length;
      }
      console.log("Seeding complete for bin:", title);
    })
  }
  
  addVideoToGallery(title, topicHex, binTopicHex)

  const msgPayload = JSON.stringify({ type: 'new-video', title, topic: topicHex, binTopic: binTopicHex })
  for (const peer of swarm.connections) {
    peer.write(b4a.from(msgPayload))
  }
}

function addVideoToGallery(title, topic, binTopic) {
  const id = topic || binTopic
  if (document.querySelector(`[data-id="${id}"]`)) return;

  knownVideos.push({ title, topic, binTopic })

  const grid = document.querySelector('#gallery-grid')
  
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.id = id
  card.innerHTML = `
    <div class="thumbnail">▶</div>
    <div class="title" title="${title}">${title}</div>
    <div class="topic">${(topic || binTopic).substring(0, 10)}...</div>
    <div style="color: #f39c12; margin-top: 5px; font-size: 0.8rem;">${binTopic ? '🤖 Neural Supported' : 'Standard Quality'}</div>
  `
  card.addEventListener('click', () => playVideo(topic, binTopic, title))
  
  grid.prepend(card)
}

// playVideo only shows the player interface waiting for selection
async function playVideo(topicHex, binTopicHex, title) {
  document.querySelector('#gallery-view').classList.add('hidden')
  document.querySelector('#player-view').classList.remove('hidden')
  document.querySelector('#now-playing-title').innerText = title
  
  const activeTopic = topicHex || binTopicHex
  document.querySelector('#stream-topic').innerText = `${activeTopic.substring(0, 16)}...`
  
  document.querySelector('#loading-video').classList.add('hidden')
  document.querySelector('#video-container').classList.add('hidden')
  document.querySelector('#player').src = ""
  
  // Disable buttons if a particular topic doesn't exist
  document.querySelector('#btn-play-normal').disabled = !topicHex
  document.querySelector('#btn-play-normal').style.opacity = topicHex ? '1' : '0.3'
  
  document.querySelector('#btn-play-neural').disabled = !binTopicHex
  document.querySelector('#btn-play-neural').style.opacity = binTopicHex ? '1' : '0.3'

  window.currentPlayContext = { topic: topicHex, binTopic: binTopicHex, title }
}

async function startViewerPlayback(targetTopic, isNeural) {
  if (!targetTopic) return;

  document.querySelector('#loading-video').classList.remove('hidden')
  document.querySelector('#video-container').classList.add('hidden')
  
  const progressBar = document.querySelector('#loading-progress')
  const progressText = document.querySelector('#loading-percentage')
  
  progressBar.value = 0
  progressText.innerText = '0%'

  const coreKey = b4a.from(targetTopic, 'hex')
  currentVideoCore = store.get({ key: coreKey })
  await currentVideoCore.ready()

  const subDiscovery = swarm.join(currentVideoCore.discoveryKey, { client: true, server: false })
  await subDiscovery.flushed()

  await currentVideoCore.update()
  const length = currentVideoCore.length

  let chunks = []
  
  for (let i = 0; i < length; i++) {
    const block = await currentVideoCore.get(i)
    chunks.push(block)
    
    const percent = Math.round(((i + 1) / length) * 100)
    progressBar.value = percent
    progressText.innerText = `${percent}%`
  }

  const superBuffer = new Blob(chunks, { type: isNeural ? 'application/octet-stream' : 'video/mp4' })
  
  if (isNeural) {
    progressText.innerText = "P2P completed. Decoding 2% Neural Payload with AI..."
    progressBar.removeAttribute('value')
    
    // Save to temp and decode
    const tempDir = os.tmpdir()
    const binPath = path.join(tempDir, `${targetTopic}.bin`)
    const mp4Path = path.join(tempDir, `${targetTopic}.mp4`)
    
    fs.writeFileSync(binPath, Buffer.concat(chunks.map(c => Buffer.from(c.buffer))))
    
    const py = spawn('python3', ['cli.py', 'decompress', binPath, mp4Path], { cwd: repoRoot })
    
    py.stdout.on('data', (data) => console.log(`Python stdout: ${data}`));
    py.stderr.on('data', (data) => console.error(`Python stderr: ${data}`));
    
    py.on('close', (code) => {
      progressBar.setAttribute('value', 100)
      if (code !== 0) {
        console.error(`Python process exited with code ${code}`);
        alert(`Failed to decode neural video. Check terminal for Python errors (code ${code}).`)
        document.querySelector('#loading-video').classList.add('hidden')
        return
      }
      playFileBlob(mp4Path)
    })

  } else {
    document.querySelector('#loading-video').classList.add('hidden')
    document.querySelector('#video-container').classList.remove('hidden')
    const player = document.querySelector('#player')
    player.src = URL.createObjectURL(superBuffer)
    player.play().catch(() => {})
  }
}

function playFileBlob(filePath) {
  document.querySelector('#loading-video').classList.add('hidden')
  document.querySelector('#video-container').classList.remove('hidden')
  
  const buf = fs.readFileSync(filePath)
  const blob = new Blob([buf], { type: 'video/mp4' })
  const player = document.querySelector('#player')
  player.src = URL.createObjectURL(blob)
  player.play().catch(() => {})
}

