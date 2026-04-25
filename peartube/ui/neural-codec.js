/**
 * Neural Codec Module — PearTube
 * Canvas-based Neural Encoding (downscale + compress) and Decoding (upscale + sharpen)
 * Designed as a pluggable module: swap the internals for a real ONNX/TF.js model later.
 */

const ENCODE_WIDTH = 426  // 240p width (16:9)
const ENCODE_HEIGHT = 240
const CHUNK_SIZE = 256 * 1024 // 256KB per Hypercore block

/**
 * Neural Encode: Re-encode a video file to low resolution WebM
 * @param {File} videoFile - Original video file from <input>
 * @param {object} opts
 * @param {function} opts.onProgress - callback(percent)
 * @returns {Promise<{encodedBlob: Blob, thumbnail: string, metadata: object}>}
 */
export async function neuralEncode(videoFile, opts = {}) {
  const { onProgress } = opts

  // Create hidden video element to decode the source
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  const url = URL.createObjectURL(videoFile)
  video.src = url

  // Wait for metadata
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve
    video.onerror = () => reject(new Error('Failed to load video'))
  })

  const duration = video.duration
  const srcWidth = video.videoWidth
  const srcHeight = video.videoHeight

  // Calculate target dimensions preserving aspect ratio
  const aspect = srcWidth / srcHeight
  let targetW, targetH
  if (aspect >= 1) {
    targetW = ENCODE_WIDTH
    targetH = Math.round(ENCODE_WIDTH / aspect)
  } else {
    targetH = ENCODE_HEIGHT
    targetW = Math.round(ENCODE_HEIGHT * aspect)
  }
  // Ensure even dimensions for video encoding
  targetW = targetW % 2 === 0 ? targetW : targetW + 1
  targetH = targetH % 2 === 0 ? targetH : targetH + 1

  // Create canvas for downscaling
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')

  // Extract thumbnail from first frame
  video.currentTime = Math.min(1, duration * 0.1)
  await new Promise(r => { video.onseeked = r })
  ctx.drawImage(video, 0, 0, targetW, targetH)
  const thumbnail = canvas.toDataURL('image/jpeg', 0.7)

  // Reset to start
  video.currentTime = 0
  await new Promise(r => { video.onseeked = r })

  // Use MediaRecorder to re-encode at low resolution
  const stream = canvas.captureStream(30) // 30 fps
  
  // Try VP9 first, fallback to VP8
  let mimeType = 'video/webm;codecs=vp9,opus'
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8,opus'
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm'
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 300000 // 300kbps — aggressive compression
  })

  const chunks = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // Start recording
  const recordingDone = new Promise(resolve => {
    recorder.onstop = resolve
  })

  recorder.start(100) // collect data every 100ms

  // Play video and draw frames to canvas
  video.play()

  await new Promise((resolve) => {
    const drawFrame = () => {
      if (video.paused || video.ended) {
        recorder.stop()
        resolve()
        return
      }
      ctx.drawImage(video, 0, 0, targetW, targetH)
      if (onProgress) {
        onProgress(Math.min(95, (video.currentTime / duration) * 95))
      }
      requestAnimationFrame(drawFrame)
    }
    video.onended = () => {
      recorder.stop()
      resolve()
    }
    drawFrame()
  })

  await recordingDone

  // Cleanup
  video.pause()
  URL.revokeObjectURL(url)

  const encodedBlob = new Blob(chunks, { type: mimeType.split(';')[0] })

  if (onProgress) onProgress(100)

  const metadata = {
    title: videoFile.name.replace(/\.[^/.]+$/, ''),
    duration,
    width: targetW,
    height: targetH,
    originalWidth: srcWidth,
    originalHeight: srcHeight,
    mimeType: mimeType.split(';')[0],
    chunkSize: CHUNK_SIZE,
    totalChunks: Math.ceil(encodedBlob.size / CHUNK_SIZE),
    fileSize: encodedBlob.size,
    timestamp: Date.now()
  }

  return { encodedBlob, thumbnail, metadata }
}

/**
 * Chunkenize a Blob into fixed-size ArrayBuffer chunks
 * @param {Blob} blob
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* chunkBlob(blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, bytes.length)
    yield bytes.slice(offset, end)
  }
}

/**
 * Reassemble chunks into a playable Blob URL
 * @param {Uint8Array[]} chunks - Array of chunk buffers
 * @param {string} mimeType
 * @returns {string} - Object URL for the video
 */
export function assembleVideo(chunks, mimeType) {
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
  return URL.createObjectURL(blob)
}

/**
 * Neural Decode: Apply upscale enhancement to a video element
 * Uses CSS filters + optional canvas post-processing
 * @param {HTMLVideoElement} videoEl
 * @param {object} opts
 * @param {number} opts.scale - upscale factor (default 2)
 */
export function neuralDecode(videoEl, opts = {}) {
  // CSS-based neural enhancement (fast, GPU-accelerated)
  videoEl.style.imageRendering = 'high-quality'
  videoEl.style.filter = 'contrast(1.04) saturate(1.1) brightness(1.02)'
  
  // The CSS approach is performant for real-time playback.
  // For a real neural upscaler, replace the body of this function with:
  //
  // import * as tf from '@tensorflow/tfjs'
  // const model = await tf.loadLayersModel('/models/esrgan/model.json')
  // ... process frames through the model on a canvas ...
}

/**
 * Format seconds to MM:SS
 */
export function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Format relative time (e.g. "2 hours ago")
 */
export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  return Math.floor(seconds / 86400) + 'd ago'
}
