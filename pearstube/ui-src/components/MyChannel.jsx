import React from 'react'
import Feed from './Feed.jsx'

export default function MyChannel({ videos, identity, onPlay, short }) {
  return (
    <div>
      <h1 className="page-title">My Channel</h1>
      {identity && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 12 }}>
          Share your channel:
          <div style={{ fontFamily: 'monospace', color: 'var(--accent)', marginTop: 4, wordBreak: 'break-all' }}>
            pear://{identity.channelKey}
          </div>
        </div>
      )}
      {videos.length === 0 ? (
        <div className="empty">
          <div className="big">🎬</div>
          You haven't published anything yet. Hit Upload to share your first video.
        </div>
      ) : (
        <Feed videos={videos} onPlay={onPlay} short={short} />
      )}
    </div>
  )
}
