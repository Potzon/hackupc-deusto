import React, { useEffect, useState } from 'react'
import { api, on, backendUrl } from './../api.js'

export default function VideoView({ video, onBack, short, showToast }) {
  const [playUrl, setPlayUrl] = useState(null)
  const [progress, setProgress] = useState('Fetching .bin from peers…')
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let off
    (async () => {
      try {
        off = on('prepare-progress', (data) => {
          if (data.id === video.id) setProgress(data.line || '')
        })
        const r = await api.prepare({ video })
        setPlayUrl(backendUrl(r.url))
        setProgress('')
      } catch (e) {
        setError(e.message || String(e))
        setProgress('')
      }
    })()
    return () => { if (off) off() }
  }, [video.id])

  useEffect(() => {
    refreshComments()
    const t = setInterval(refreshComments, 4000)
    return () => clearInterval(t)
  }, [video.id])

  async function refreshComments() {
    try { setComments(await api.comments(video.id)) } catch {}
  }

  async function postComment(e) {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      await api.comment(video.id, commentText.trim())
      setCommentText('')
      refreshComments()
    } catch (e) { showToast(e.message, 'error') }
  }

  return (
    <div className="video-detail">
      <button className="ghost" onClick={onBack} style={{ marginBottom: 12 }}>← Back</button>
      <div className="player">
        {playUrl ? (
          <video src={playUrl} controls autoPlay />
        ) : (
          <div className="placeholder">
            {error ? <span style={{ color: 'var(--danger)' }}>⚠ {error}</span> : (
              <>
                <div>🍐 Receiving & decoding…</div>
                <div className="progress">{progress}</div>
              </>
            )}
          </div>
        )}
      </div>
      <h2>{video.title || 'Untitled'}</h2>
      <div className="author-line">
        by {short(video.author)} · {video.binSize ? `${(video.binSize / 1024).toFixed(1)} KB on the wire` : ''}
        {video.originalSize && video.binSize ? (
          <> · <span style={{ color: 'var(--accent)' }}>{((video.binSize / video.originalSize) * 100).toFixed(1)}% of original</span></>
        ) : null}
      </div>
      {video.description && <p style={{ marginTop: 12, color: 'var(--muted)' }}>{video.description}</p>}

      <div className="comments">
        <h3>Comments <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400 }}>· multi-writer via Autobase</span></h3>
        <form className="comment-form" onSubmit={postComment}>
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
          />
          <button className="primary" type="submit" disabled={!commentText.trim()}>Post</button>
        </form>
        {comments.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No comments yet.</div>
        ) : comments.map((c, i) => (
          <div key={i} className="comment">
            <div className="author">{short(c.author)} · {new Date(c.at).toLocaleString()}</div>
            <div>{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
