import React from 'react'

function relTime(ts) {
  const d = (Date.now() - ts) / 1000
  if (d < 60) return `${Math.floor(d)}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

function formatBytes(n) {
  if (!n) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function Feed({ videos, onPlay, short }) {
  return (
    <div>
      <h1 className="page-title">Feed</h1>
      {videos.length === 0 ? (
        <div className="empty">
          <div className="big">📡</div>
          No videos in your feed yet. Subscribe to a channel or upload your own.
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((v) => (
            <div key={v.id} className="video-card" onClick={() => onPlay(v)}>
              <div className="thumb">▶</div>
              <div className="meta">
                <div className="title">{v.title || 'Untitled'}</div>
                <div className="author">{short(v.author)}</div>
                <div className="stats">
                  <span>{relTime(v.createdAt)}</span>
                  <span className="badge">{formatBytes(v.binSize)}</span>
                  {v.originalSize && v.binSize ? (
                    <span style={{ color: 'var(--accent)' }}>
                      {((v.binSize / v.originalSize) * 100).toFixed(1)}% of original
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
