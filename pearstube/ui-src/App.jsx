import React, { useEffect, useState, useCallback } from 'react'
import { api, on } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Feed from './components/Feed.jsx'
import VideoView from './components/VideoView.jsx'
import Upload from './components/Upload.jsx'
import MyChannel from './components/MyChannel.jsx'
import Toast from './components/Toast.jsx'

const short = (k) => k ? k.slice(0, 8) + '…' + k.slice(-6) : ''

export default function App() {
  const [identity, setIdentity] = useState(null)
  const [page, setPage] = useState({ name: 'feed' })
  const [feed, setFeed] = useState([])
  const [mine, setMine] = useState([])
  const [subs, setSubs] = useState([])
  const [status, setStatus] = useState({ peers: 0 })
  const [toast, setToast] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [f, m, s, st] = await Promise.all([
        api.feedVideos(),
        api.myVideos(),
        api.subscriptions(),
        api.status()
      ])
      setFeed(f); setMine(m); setSubs(s); setStatus(st)
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    api.identity().then(setIdentity).catch(console.error)
    refresh()
    const offV = on('videos-changed', refresh)
    const offS = on('status', setStatus)
    const offT = on('toast', setToast)
    const interval = setInterval(refresh, 5000)
    return () => { offV(); offS(); offT(); clearInterval(interval) }
  }, [refresh])

  function showToast(message, kind = 'info') {
    setToast({ message, kind })
    setTimeout(() => setToast(null), 3500)
  }

  return (
    <div className="app">
      <Sidebar
        identity={identity}
        page={page}
        setPage={setPage}
        subs={subs}
        status={status}
        onCopyKey={() => {
          if (identity?.channelKey) {
            navigator.clipboard.writeText(`pear://${identity.channelKey}`)
            showToast('Channel link copied', 'success')
          }
        }}
      />
      <main className="main">
        {page.name === 'feed' && (
          <Feed
            videos={feed}
            onPlay={(v) => setPage({ name: 'video', video: v })}
            short={short}
          />
        )}
        {page.name === 'mine' && (
          <MyChannel
            videos={mine}
            identity={identity}
            onPlay={(v) => setPage({ name: 'video', video: v, mine: true })}
            short={short}
          />
        )}
        {page.name === 'upload' && (
          <Upload
            onDone={() => { setPage({ name: 'mine' }); refresh(); showToast('Video published', 'success') }}
            onError={(msg) => showToast(msg, 'error')}
          />
        )}
        {page.name === 'subscribe' && (
          <SubscribePage
            subs={subs}
            onAdd={async (link) => {
              try {
                await api.subscribe(link)
                showToast('Subscribed', 'success')
                refresh()
              } catch (e) { showToast(e.message, 'error') }
            }}
            onRemove={async (key) => { await api.unsubscribe(key); refresh() }}
            short={short}
          />
        )}
        {page.name === 'video' && (
          <VideoView
            video={page.video}
            mine={page.mine}
            onBack={() => setPage({ name: page.mine ? 'mine' : 'feed' })}
            short={short}
            showToast={showToast}
          />
        )}
      </main>
      {toast && <Toast {...toast} />}
    </div>
  )
}

function SubscribePage({ subs, onAdd, onRemove, short }) {
  const [link, setLink] = useState('')
  return (
    <div>
      <h1 className="page-title">Subscriptions</h1>
      <div className="subscribe-form">
        <input
          placeholder="pear://<channel-key>"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button className="primary" onClick={() => { onAdd(link); setLink('') }} disabled={!link.trim()}>
          Subscribe
        </button>
      </div>
      {subs.length === 0 ? (
        <div className="empty"><div className="big">📡</div>No subscriptions yet. Paste a pear:// link above.</div>
      ) : (
        <div>
          {subs.map((s) => (
            <div key={s.key} className="subscription-item" style={{ background: 'var(--panel)', marginBottom: 8, padding: 12, borderRadius: 8 }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{short(s.key)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {s.videos} videos · {s.peers} peers
                </div>
              </div>
              <button className="ghost" onClick={() => onRemove(s.key)}>Unsubscribe</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
