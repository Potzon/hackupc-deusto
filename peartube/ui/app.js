// For interactive documentation and code auto-completion in editor
/** @typedef {import('pear-interface')} */
 
/* global Pear */
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import Hypercore from 'hypercore'
import Corestore from 'corestore'

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
  // Automatically replicate data blocks transparently across peers
  store.replicate(peer)
  
  // Handshake: send our known catalog to the newly connected peer
  const handshakeMsg = JSON.stringify({ type: 'catalog-sync', videos: knownVideos })
  peer.write(b4a.from(handshakeMsg))
  
  // Listen for global broadcast messages
  peer.on('data', data => {
    try {
      const msg = JSON.parse(b4a.toString(data))
      if (msg.type === 'new-video') {
        addVideoToGallery(msg.title, msg.topic)
      } else if (msg.type === 'catalog-sync') {
        if (msg.videos && Array.isArray(msg.videos)) {
          msg.videos.forEach(v => addVideoToGallery(v.title, v.topic))
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

// Join the global discovery swarm as soon as the app starts
const discovery = swarm.join(GLOBAL_DISCOVERY_TOPIC, { client: true, server: true })
discovery.flushed().then(() => {
  console.log('Joined global neural catalog.')
})

// === UI EVENT BINDINGS ===
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

// === CORE LOGIC ===

async function publishVideo() {
  const fileInput = document.querySelector('#video-file')
  const titleInput = document.querySelector('#video-title')
  
  if (!fileInput.files.length || !titleInput.value) {
    alert("Title and video file required")
    return
  }

  const file = fileInput.files[0]
  const title = titleInput.value
  
  document.querySelector('#upload-modal').classList.add('hidden')

  // Create a hypercore specifically for serving this video's chunks
  const core = store.get({ name: `video-core-${Date.now()}` })
  await core.ready()

  // Make the video available in the network
  swarm.join(core.discoveryKey, { server: true, client: false })

  const topicHex = b4a.toString(core.key, 'hex')
  
  // Add to local gallery
  addVideoToGallery(title, topicHex)

  // Broadcast the metadata payload to all connected peers in the Global Swarm
  const msgPayload = JSON.stringify({ type: 'new-video', title, topic: topicHex })
  for (const peer of swarm.connections) {
    peer.write(b4a.from(msgPayload))
  }

  // Segment the file and add chunks to Hypercore
  const chunkSize = 128 * 1024; // 128KB fragments
  let offset = 0;
  file.arrayBuffer().then(async (buffer) => {
    const totalBytes = buffer.byteLength;
    while (offset < totalBytes) {
      const chunk = new Uint8Array(buffer, offset, Math.min(chunkSize, totalBytes - offset));
      await core.append(chunk);
      offset += chunk.length;
    }
    console.log("Seeding complete for:", title);
  })
}

function addVideoToGallery(title, topic) {
  // Prevent duplicate cards
  if (document.querySelector(`[data-topic="${topic}"]`)) return;

  knownVideos.push({ title, topic })

  const grid = document.querySelector('#gallery-grid')
  
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.topic = topic
  card.innerHTML = `
    <div class="thumbnail">▶</div>
    <div class="title" title="${title}">${title}</div>
    <div class="topic">${topic.substring(0, 10)}...</div>
  `
  // Bind click event to play
  card.addEventListener('click', () => playVideo(topic, title))
  
  grid.prepend(card)
}

async function playVideo(topicHex, title) {
  document.querySelector('#gallery-view').classList.add('hidden')
  document.querySelector('#player-view').classList.remove('hidden')
  document.querySelector('#now-playing-title').innerText = title
  document.querySelector('#stream-topic').innerText = `${topicHex.substring(0, 16)}...`
  
  document.querySelector('#loading-video').classList.remove('hidden')
  document.querySelector('#video-container').classList.add('hidden')

  const coreKey = b4a.from(topicHex, 'hex')

  // Retrieve remote video Hypercore
  currentVideoCore = store.get({ key: coreKey })
  await currentVideoCore.ready()

  // Join the subset swarm specific to this video
  const subDiscovery = swarm.join(currentVideoCore.discoveryKey, { client: true, server: false })
  await subDiscovery.flushed()

  startViewerPlayback()
}

async function startViewerPlayback() {
  const player = document.querySelector('#player')

  // Await the network length synchronization
  await currentVideoCore.update()
  const length = currentVideoCore.length

  let chunks = []

  const progressBar = document.querySelector('#loading-progress')
  const progressText = document.querySelector('#loading-percentage')
  
  // Reset UI
  progressBar.value = 0
  progressText.innerText = '0%'

  // Download logic (Wait fully before playing. In production you'd use MSE for streams)
  for (let i = 0; i < length; i++) {
    const block = await currentVideoCore.get(i)
    chunks.push(block)
    
    // Update progress bar
    const percent = Math.round(((i + 1) / length) * 100)
    progressBar.value = percent
    progressText.innerText = `${percent}%`
  }

  // Done downloading
  document.querySelector('#loading-video').classList.add('hidden')
  document.querySelector('#video-container').classList.remove('hidden')

  const superBuffer = new Blob(chunks, { type: 'video/webm' })
  player.src = URL.createObjectURL(superBuffer)
  player.play().catch(() => {}) // Auto-play attempt
}