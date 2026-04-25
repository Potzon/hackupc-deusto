const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

// Replace new-video msg parsing
appJs = appJs.replace(
  /if \(msg\.type === 'new-video'\) \{\s*addVideoToGallery\(msg\.title\, msg\.topic\)\s*\} else if \(msg\.type === 'catalog-sync'\) \{\s*if \(msg\.videos && Array\.isArray\(msg\.videos\)\) \{\s*msg\.videos\.forEach\(v => addVideoToGallery\(v\.title\, v\.topic\)\)\s*\}\s*\}/g,
  `if (msg.type === 'new-video') {
        addVideoToGallery(msg.title, msg.topic, msg.binTopic)
      } else if (msg.type === 'catalog-sync') {
        if (msg.videos && Array.isArray(msg.videos)) {
          msg.videos.forEach(v => addVideoToGallery(v.title, v.topic, v.binTopic))
        }
      }`
);

// Publish video
appJs = appJs.replace(
  /async function publishVideo\(\) \{[\s\S]*?console\.log\("Seeding complete for:", title\);\s*\}\)\s*\}/,
  `async function publishVideo() {
  const fileInput = document.querySelector('#video-file')
  const binInput = document.querySelector('#bin-file')
  const titleInput = document.querySelector('#video-title')
  
  if (!fileInput.files.length && !binInput.files.length) {
    alert("At least one video or .bin file required")
    return
  }

  const file = fileInput.files.length ? fileInput.files[0] : null
  const binFile = binInput.files.length ? binInput.files[0] : null
  const title = titleInput.value
  
  document.querySelector('#upload-modal').classList.add('hidden')
  
  let topicHex = null;
  let binTopicHex = null;

  if (file) {
    const core = store.get({ name: \`video-core-\${Date.now()}\` })
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
    const binCore = store.get({ name: \`video-core-bin-\${Date.now()}\` })
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
}`
);

// AddVideoToGallery
appJs = appJs.replace(
  /function addVideoToGallery\(title, topic\) \{[\s\S]*?grid\.prepend\(card\)\s*\}/,
  `function addVideoToGallery(title, topic, binTopic) {
  const id = topic || binTopic
  if (document.querySelector(\`[data-id="\${id}"]\`)) return;

  knownVideos.push({ title, topic, binTopic })

  const grid = document.querySelector('#gallery-grid')
  const card = document.createElement('div')
  card.className = 'video-card'
  card.dataset.id = id
  card.innerHTML = \`
    <div class="thumbnail">▶</div>
    <div class="title" title="\${title}">\${title}</div>
    <div class="topic">\${(topic || binTopic).substring(0, 10)}...</div>
    <div style="color: #f39c12; margin-top: 5px; font-size: 0.8rem;">\${binTopic ? '🤖 Neural Supported' : 'Standard Quality'}</div>
  \`
  card.addEventListener('click', () => playVideo(topic, binTopic, title))
  
  grid.prepend(card)
}`
);

// Replace playVideo to accept binTopic
appJs = appJs.replace(
  /async function playVideo\(topicHex, title\) \{[\s\S]*?startViewerPlayback\(\)\s*\}/,
  `async function playVideo(topic, binTopic, title) {
  document.querySelector('#gallery-view').classList.add('hidden')
  document.querySelector('#player-view').classList.remove('hidden')
  document.querySelector('#now-playing-title').innerText = title
  
  const activeTopic = topic || binTopic;
  document.querySelector('#stream-topic').innerText = \`\${activeTopic.substring(0, 16)}...\`
  
  document.querySelector('#video-container').classList.add('hidden')
  document.querySelector('#loading-video').classList.add('hidden')
  
  // Expose to buttons
  window.currentPlayContext = { topic, binTopic, title }
}`
);

// Now we need a new play normal function and play neural
appJs += `
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

document.querySelector('#btn-play-normal').addEventListener('click', () => loadAndPlay(window.currentPlayContext.topic, false));
document.querySelector('#btn-play-neural').addEventListener('click', () => loadAndPlay(window.currentPlayContext.binTopic, true));

async function loadAndPlay(topicHex, isNeural) {
  if (!topicHex) { alert("Format not available for this video."); return; }
  
  document.querySelector('#loading-video').classList.remove('hidden')
  document.querySelector('#loading-percentage').innerText = isNeural ? '0% - Downloading .bin...' : '0%'

  const coreKey = b4a.from(topicHex, 'hex')
  currentVideoCore = store.get({ key: coreKey })
  await currentVideoCore.ready()

  const subDiscovery = swarm.join(currentVideoCore.discoveryKey, { client: true, server: false })
  await subDiscovery.flushed()
  
  await currentVideoCore.update()
  const length = currentVideoCore.length

  let chunks = []
  const progressBar = document.querySelector('#loading-progress')
  const progressText = document.querySelector('#loading-percentage')
  
  progressBar.value = 0

  for (let i = 0; i < length; i++) {
    const block = await currentVideoCore.get(i)
    chunks.push(block)
    const percent = Math.round(((i + 1) / length) * 100)
    progressBar.value = percent
    progressText.innerText = isNeural ? \`\${percent}% - Downloading .bin...\` : \`\${percent}%\`
  }

  const superBuffer = new Blob(chunks, { type: isNeural ? 'application/octet-stream' : 'video/mp4' })
  
  if (isNeural) {
    progressText.innerText = "Decoding 2% Neural Payload with AI..."
    progressBar.removeAttribute('value') // Indeterminate
    
    // Save .bin to temp, run cli.py decompress, read mp4 back.
    const tempDir = os.tmpdir()
    const binPath = path.join(tempDir, \`\${topicHex}.bin\`)
    const mp4Path = path.join(tempDir, \`\${topicHex}.mp4\`)
    
    fs.writeFileSync(binPath, Buffer.concat(chunks.map(c => Buffer.from(c.buffer))))
    
    const repoRoot = path.resolve(__dirname, '../../') 
    
    const py = spawn('python3', ['cli.py', 'decompress', binPath, mp4Path], { cwd: repoRoot })
    
    py.on('close', (code) => {
      progressBar.setAttribute('value', 100)
      if (code !== 0) {
        alert("Failed to decode neural video.")
        document.querySelector('#loading-video').classList.add('hidden')
        return
      }
      playFileBlob(mp4Path)
    })
  } else {
    document.querySelector('#loading-video').classList.add('hidden')
    document.querySelector('#video-container').classList.remove('hidden')
    document.querySelector('#player').src = URL.createObjectURL(superBuffer)
    document.querySelector('#player').play().catch(() => {})
  }
}

function playFileBlob(filePath) {
   document.querySelector('#loading-video').classList.add('hidden')
   document.querySelector('#video-container').classList.remove('hidden')
   
   // Pear can serve local files via file:// or we can read it to blob
   const buf = fs.readFileSync(filePath)
   const blob = new Blob([buf], { type: 'video/mp4' })
   document.querySelector('#player').src = URL.createObjectURL(blob)
   document.querySelector('#player').play().catch(() => {})
}
`;


fs.writeFileSync('app.js', appJs);
console.log("Replaced app JS");
