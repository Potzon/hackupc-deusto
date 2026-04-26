import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function compressorRepo() {
  return path.resolve(__dirname, '..', '..', 'hackupc-deusto')
}

const PYTHON = process.env.PEARSTUBE_PYTHON || 'python3'

export function probeCompressor() {
  const repo = compressorRepo()
  const cli = path.join(repo, 'cli.py')
  return { repo, cli, exists: fs.existsSync(cli) }
}

function runPython(args, { onLine }) {
  const { repo } = probeCompressor()
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    const collect = (chunk) => {
      buf += chunk.toString()
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line && onLine) onLine(line)
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (buf.trim() && onLine) onLine(buf.trim())
      if (code === 0) resolve()
      else reject(new Error(`python exited ${code}`))
    })
  })
}

export async function compressVideo({ videoPath, frames = 0, onProgress }) {
  const { repo, exists } = probeCompressor()
  if (!exists) throw new Error(`Compressor not found at ${repo}/cli.py`)

  if (!frames || frames <= 0) frames = await countFrames(videoPath, onProgress)

  await runPython(['cli.py', 'compress', videoPath, String(frames)], { onLine: onProgress })

  const binPath = path.join(repo, 'out_bin', 'MP4_DEMO', 'test_video_frames_q3.bin')
  const jsonPath = path.join(repo, 'out_bin', 'MP4_DEMO', 'test_video_frames_q3.json')
  if (!fs.existsSync(binPath)) throw new Error('Compression finished but no .bin produced')

  const binBuffer = fs.readFileSync(binPath)
  let jsonMeta = null
  if (fs.existsSync(jsonPath)) {
    try { jsonMeta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) } catch {}
  }
  return { binBuffer, jsonMeta }
}

export async function decompressBin({ binBuffer, outputMp4Path, onProgress }) {
  const { repo, exists } = probeCompressor()
  if (!exists) throw new Error(`Compressor not found at ${repo}/cli.py`)
  const tmpBinDir = path.join(repo, 'out_bin', 'MP4_DEMO')
  fs.mkdirSync(tmpBinDir, { recursive: true })
  const tmpBin = path.join(tmpBinDir, 'test_video_frames_q3.bin')
  fs.writeFileSync(tmpBin, binBuffer)
  const outDir = path.dirname(outputMp4Path)
  fs.mkdirSync(outDir, { recursive: true })
  await runPython(['cli.py', 'decompress', tmpBin, outputMp4Path], { onLine: onProgress })
  if (!fs.existsSync(outputMp4Path)) throw new Error('Decompression finished but no mp4 produced')
}

async function countFrames(videoPath, onLine) {
  return await new Promise((resolve) => {
    let out = ''
    const child = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-count_packets', '-show_entries', 'stream=nb_read_packets',
      '-of', 'csv=p=0', videoPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (c) => { out += c.toString() })
    child.stderr.on('data', () => {})
    child.on('error', () => resolve(300))
    child.on('exit', () => {
      const n = parseInt(out.trim(), 10)
      if (Number.isFinite(n) && n > 0) {
        if (onLine) onLine(`Detected ${n} frames`)
        resolve(n)
      } else {
        resolve(300)
      }
    })
  })
}
