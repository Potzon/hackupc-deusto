import React, { useState } from 'react'
import { api, on } from './../api.js'

export default function Upload({ onDone, onError }) {
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
          <label>Source video — absolute path on this machine</label>
          <div className="file-pick">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/you/Videos/clip.mp4"
              style={{ flex: 1 }}
            />
            <button className="ghost" onClick={loadSample}>Use bundled sample</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Browsers can't read absolute paths from a file picker. Paste a path here, or click the
            sample button to point at <code>hackupc-deusto/video.mp4</code>.
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
