import React from 'react'

const short = (k) => k ? k.slice(0, 6) + '…' + k.slice(-4) : ''

export default function Sidebar({ identity, page, setPage, subs, status, onCopyKey }) {
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">
          <span className="pear">🍐</span>Pears<span style={{ color: 'var(--accent-2)' }}>Tube</span>
        </div>
        <div className="tagline">Censorship-resistant video. No servers. AI-compressed for hostile networks.</div>
      </div>

      <div>
        <div className={`status-pill ${status?.peers > 0 ? 'online' : ''}`}>
          <span className="dot"></span>
          {status?.peers ?? 0} peers · {status?.swarm ?? 'connecting'}
        </div>
      </div>

      <nav className="nav">
        <button className={page.name === 'feed' ? 'active' : ''} onClick={() => setPage({ name: 'feed' })}>
          📺 Feed
        </button>
        <button className={page.name === 'mine' ? 'active' : ''} onClick={() => setPage({ name: 'mine' })}>
          📡 My Channel
        </button>
        <button className={page.name === 'upload' ? 'active' : ''} onClick={() => setPage({ name: 'upload' })}>
          ⬆ Upload
        </button>
        <button className={page.name === 'subscribe' ? 'active' : ''} onClick={() => setPage({ name: 'subscribe' })}>
          🔗 Subscriptions
        </button>
      </nav>

      <div>
        <div className="section-title">My Channel</div>
        <div className="identity-card">
          {identity ? (
            <>
              <div>Public link:</div>
              <div className="key">pear://{identity.channelKey}</div>
              <button className="ghost" onClick={onCopyKey}>Copy link</button>
            </>
          ) : (
            <div style={{ color: 'var(--muted)' }}>Initializing…</div>
          )}
        </div>
      </div>

      {subs.length > 0 && (
        <div>
          <div className="section-title">Subscriptions</div>
          <div className="subscriptions">
            {subs.map((s) => (
              <div key={s.key} className="subscription-item">
                <span style={{ fontFamily: 'monospace' }}>{short(s.key)}</span>
                <span className="peers">{s.peers}p</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
