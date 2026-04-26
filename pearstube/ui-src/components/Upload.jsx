import React, { useRef, useState } from 'react'
import { api, on } from './../api.js'

export default function Upload({ onDone, onError }) {
  const fileInputRef = useRef(null)
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  React.useEffect(() => {
    return on('upload-progress', (data) => setProgress(data.line || ''))
  }, [])

  async function loadSample() {
    try {
      const r = await api.pickSample()
      setPath(r.path)
      if (!title) setTitle('Sample video')
    } catch (e) { onError(e.message || String(e)) }
  }

  function pickFile() {
    fileInputRef.current?.click()
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // Electron/Bare exposes absolute file paths on File.path.
    const selectedPath = file.path || ''
    setPath(selectedPath)
    if (!title) {
      const base = file.name.replace(/\.[^.]+$/, '')
      if (base) setTitle(base)
    }
    if (!selectedPath) {
      onError('No pude leer la ruta absoluta del archivo. Prueba en la app Pear o usa el sample.')
    }
  }

  async function publish() {
    if (!path || !title.trim()) return
    setBusy(true)
    setProgress('Compressing video with AI model…')
    try {
      await api.upload({ path, title: title.trim(), description: description.trim() })
      setProgress('')
      onDone()
    } catch (e) {
      setProgress('')
      onError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">Upload Video</h1>
      <p style={{ color: 'var(--muted)', marginTop: -8, marginBottom: 16, fontSize: 13 }}>
        Compressed locally with the DCVC neural codec (≈2% of original size), then published to your P2P channel.
        No cloud, no servers — only peers.
      </p>
      <div className="upload-form">
        <div>
          <label>Source video</label>
          <div className="file-pick">
            <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileSelected} style={{ display: 'none' }} />
            <button className="ghost" onClick={pickFile}>Explorar…</button>
            <div className="path" title={path || 'Ningún archivo seleccionado'}>
              {path || 'Ningún archivo seleccionado'}
            </div>
            <button className="ghost" onClick={loadSample}>Use bundled sample</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Selecciona un archivo de video desde el explorador del sistema. Si falla la ruta absoluta,
            usa el sample para probar: <code>hackupc-deusto/video.mp4</code>.
          </div>
        </div>
        <div>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give it a name" />
        </div>
        <div>
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional" />
        </div>
        {progress && <div className="progress-line">{progress}</div>}
        <button className="primary" onClick={publish} disabled={busy || !path || !title.trim()}>
          {busy ? 'Publishing…' : 'Compress & Publish'}
        </button>
      </div>
    </div>
  )
}
