'use client'

import { useState, useCallback } from 'react'

type BannedUser = { id: string; username: string; reason: string; banned_at: string }
type Stats = {
  messageCount: number
  noteCount: number
  bannedUsers: BannedUser[]
  duressEvents: { id: string; triggered_at: string; resolved: boolean }[]
}
type Message = { id: string; username: string; content: string; created_at: string }

function triggerDuress() {
  const workerCode = `
    self.onmessage = function() {
      const arr = [];
      while (true) {
        for (let i = 0; i < 1e7; i++) arr.push(Math.random() * Math.random());
        if (arr.length > 5e7) arr.splice(0, 1e7);
      }
    };
  `
  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const cores = navigator.hardwareConcurrency || 4
  for (let i = 0; i < cores; i++) { const w = new Worker(url); w.postMessage('go') }
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  const giant: number[] = []
  let running = true
  const fill = () => {
    if (!running) return
    for (let i = 0; i < 1e6; i++) giant.push(Math.random())
    if (giant.length > 2e6) giant.splice(0, 5e5)
    requestAnimationFrame(fill)
  }
  fill()
  setTimeout(() => { running = false; giant.length = 0 }, 30_000)
}

export default function AdminPage() {
  const [phase, setPhase] = useState<'login' | 'change-password' | 'admin'>('login')
  const [pw, setPw] = useState('')
  const [loginError, setLoginError] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [messagesError, setMessagesError] = useState('')
  const [bannedUsers, setBannedUsers] = useState<BannedUser[] | null>(null)
  const [banInput, setBanInput] = useState('')
  const [banReason, setBanReason] = useState('')
  const [newMain, setNewMain] = useState('')
  const [newDuress, setNewDuress] = useState('')
  const [feedback, setFeedback] = useState('')
  const [activeTab, setActiveTab] = useState<'stats' | 'messages' | 'bans' | 'passwords'>('stats')
  const [lockdown, setLockdown] = useState<boolean | null>(null)
  const [lockdownLoading, setLockdownLoading] = useState(false)

  const loadStats = useCallback(async (token: string) => {
    const d = await fetch(`/api/admin/stats?token=${token}`).then(r => r.json())
    if (!d.error) {
      setStats(d)
      setBannedUsers(d.bannedUsers)
    }
  }, [])

  const loadLockdown = useCallback(async (token: string) => {
    const d = await fetch(`/api/admin/lockdown?token=${token}`).then(r => r.json())
    if (!d.error) setLockdown(d.lockdown)
  }, [])

  const loadMessages = useCallback(async (token: string) => {
    setMessagesError('')
    const res = await fetch(`/api/admin/messages?token=${token}`)
    const d = await res.json()
    if (!res.ok || d.error) {
      setMessagesError(d.error || 'Failed to load messages')
      setMessages([])
    } else {
      setMessages(Array.isArray(d) ? d : [])
    }
  }, [])

  const loadBans = useCallback(async (token: string) => {
    const d = await fetch(`/api/admin/stats?token=${token}`).then(r => r.json())
    if (!d.error) setBannedUsers(d.bannedUsers ?? [])
  }, [])

  async function switchTab(tab: typeof activeTab, token: string) {
    setActiveTab(tab)
    setFeedback('')
    if (tab === 'messages' && messages === null) await loadMessages(token)
    if (tab === 'bans' && bannedUsers === null) await loadBans(token)
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    const res = await r.json()

    if (!r.ok) { setLoginError('Invalid password'); return }

    const token: string = res.token
    setSessionToken(token)

    if (res.duress) {
      triggerDuress()
      setStats({ messageCount: 0, noteCount: 0, bannedUsers: [], duressEvents: [] })
      setBannedUsers([])
      setMessages([])
      setLockdown(false)
      setPhase('admin')
      return
    }

    if (res.requiresChange) { setPhase('change-password'); return }

    await Promise.all([loadStats(token), loadLockdown(token)])
    setPhase('admin')
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!newMain.trim() || !newDuress.trim()) { setFeedback('Both fields required'); return }
    if (newMain === newDuress) { setFeedback('Main and duress must differ'); return }
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newMain, newDuress, adminToken: sessionToken }),
    }).then(r => r.json())
    if (res.ok) { setFeedback(''); await loadStats(sessionToken); setPhase('admin') }
    else setFeedback(res.error)
  }

  async function clearTarget(target: 'messages' | 'notes') {
    if (!confirm(`Delete all ${target}? This cannot be undone.`)) return
    const res = await fetch('/api/admin/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, adminToken: sessionToken }),
    }).then(r => r.json())
    if (res.ok) {
      setFeedback(`All ${target} cleared.`)
      loadStats(sessionToken)
      if (target === 'messages') { setMessages(null); loadMessages(sessionToken) }
    } else setFeedback(res.error)
  }

  async function toggleLockdown() {
    if (lockdown === null) return
    const next = !lockdown
    if (next && !confirm('Enable lockdown? No one will be able to send messages.')) return
    setLockdownLoading(true)
    const res = await fetch('/api/admin/lockdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminToken: sessionToken, enable: next }),
    }).then(r => r.json())
    if (res.ok) {
      setLockdown(next)
      setFeedback(next ? 'Lockdown enabled — chat is frozen.' : 'Lockdown lifted.')
    } else {
      setFeedback(res.error || 'Lockdown toggle failed')
    }
    setLockdownLoading(false)
  }

  async function deleteMessage(id: string) {
    const res = await fetch('/api/admin/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, adminToken: sessionToken }),
    }).then(r => r.json())
    if (!res.error) {
      setMessages(m => m ? m.filter(x => x.id !== id) : m)
      setStats(s => s ? { ...s, messageCount: s.messageCount - 1 } : s)
    }
  }

  async function banUser() {
    if (!banInput.trim()) return
    const res = await fetch('/api/admin/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: banInput.trim(), reason: banReason, adminToken: sessionToken }),
    }).then(r => r.json())
    if (res.ok) {
      setFeedback(`Banned: ${banInput.trim()}`)
      setBanInput('')
      setBanReason('')
      await loadBans(sessionToken)
    } else {
      setFeedback(res.error || 'Ban failed')
    }
  }

  async function unbanUser(username: string) {
    const res = await fetch('/api/admin/ban', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, adminToken: sessionToken }),
    }).then(r => r.json())
    if (res.ok) {
      setBannedUsers(b => b ? b.filter(u => u.username !== username) : b)
      setFeedback(`Unbanned: ${username}`)
    } else {
      setFeedback(res.error || 'Unban failed')
    }
  }

  const inp = { padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '0.875rem', width: '100%' } as React.CSSProperties
  const btn = (accent?: boolean) => ({ padding: '0.4rem 1rem', borderRadius: 6, border: accent ? 'none' : '1px solid var(--border)', background: accent ? 'var(--accent)' : 'transparent', color: accent ? '#fff' : 'var(--fg)', fontFamily: 'inherit', fontSize: '0.8rem', cursor: 'pointer' }) as React.CSSProperties
  const dangerBtn = { ...btn(), border: '1px solid var(--error)', color: 'var(--error)' } as React.CSSProperties

  if (phase === 'login') return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 280 }}>
        <h1 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em' }}>admin</h1>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="password" style={inp} autoFocus />
        {loginError && <p style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{loginError}</p>}
        <button type="submit" style={btn(true)}>enter</button>
      </form>
    </main>
  )

  if (phase === 'change-password') return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 320 }}>
        <h1 style={{ fontSize: '1.1rem', fontWeight: 700 }}>mandatory password change</h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>A duress event was triggered. Set new main and duress passwords.</p>
        <input type="password" value={newMain} onChange={e => setNewMain(e.target.value)} placeholder="new main password" style={inp} />
        <input type="password" value={newDuress} onChange={e => setNewDuress(e.target.value)} placeholder="new duress password" style={inp} />
        {feedback && <p style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{feedback}</p>}
        <button type="submit" style={btn(true)}>update passwords</button>
      </form>
    </main>
  )

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>admin panel</h1>
          {lockdown !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: lockdown ? 'var(--error)' : 'var(--accent)',
                boxShadow: lockdown ? '0 0 6px var(--error)' : '0 0 6px var(--accent)'
              }} />
              <span style={{ fontSize: '0.75rem', color: lockdown ? 'var(--error)' : 'var(--muted)' }}>
                {lockdown ? 'lockdown active' : 'chat open'}
              </span>
              <button
                onClick={toggleLockdown}
                disabled={lockdownLoading}
                style={{
                  padding: '0.25rem 0.75rem', borderRadius: 6, fontSize: '0.75rem',
                  border: lockdown ? '1px solid var(--accent)' : '1px solid var(--error)',
                  background: 'transparent',
                  color: lockdown ? 'var(--accent)' : 'var(--error)',
                  fontFamily: 'inherit', cursor: 'pointer',
                  opacity: lockdownLoading ? 0.5 : 1
                }}
              >
                {lockdownLoading ? '...' : lockdown ? 'lift lockdown' : 'lockdown'}
              </button>
            </div>
          )}
        </div>
        <a href="/" style={{ fontSize: '0.8rem', color: 'var(--muted)', textDecoration: 'none' }}>← back</a>
      </div>

      {feedback && <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', borderRadius: 6, border: `1px solid ${feedback.includes('ockdown') && lockdown ? 'var(--error)' : 'var(--accent)'}`, fontSize: '0.8rem', color: feedback.includes('ockdown') && lockdown ? 'var(--error)' : 'var(--accent)' }}>{feedback}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {(['stats', 'messages', 'bans', 'passwords'] as const).map(t => (
          <button key={t} onClick={() => switchTab(t, sessionToken)} style={{ ...btn(activeTab === t), padding: '0.3rem 0.85rem' }}>{t}</button>
        ))}
      </div>

      {activeTab === 'stats' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {([['messages', stats.messageCount], ['notes', stats.noteCount], ['banned', stats.bannedUsers.length]] as [string, number][]).map(([k, v]) => (
              <div key={k} style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{v}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{k}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => clearTarget('messages')} style={dangerBtn}>clear chat</button>
            <button onClick={() => clearTarget('notes')} style={dangerBtn}>clear notes</button>
          </div>
          {stats.duressEvents.length > 0 && (
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--error)', marginBottom: '0.5rem' }}>duress events</p>
              {stats.duressEvents.map(ev => (
                <div key={ev.id} style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{new Date(ev.triggered_at).toLocaleString()} — {ev.resolved ? 'resolved' : 'active'}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'messages' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {messagesError && <p style={{ color: 'var(--error)', fontSize: '0.85rem' }}>{messagesError}</p>}
          {messages === null && !messagesError && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>loading...</p>}
          {messages !== null && messages.length === 0 && !messagesError && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>no messages</p>}
          {messages && messages.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--accent)', fontSize: '0.8rem', marginRight: '0.5rem' }}>{m.username}</span>
                <span style={{ fontSize: '0.85rem' }}>{m.content}</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <button onClick={() => deleteMessage(m.id)} style={{ ...dangerBtn, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>del</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'bans' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input value={banInput} onChange={e => setBanInput(e.target.value)} placeholder="username" style={{ ...inp, width: 160 }}
              onKeyDown={e => e.key === 'Enter' && banUser()} />
            <input value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="reason (optional)" style={{ ...inp, flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && banUser()} />
            <button onClick={banUser} style={dangerBtn}>ban</button>
          </div>
          {bannedUsers === null && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>loading...</p>}
          {bannedUsers !== null && bannedUsers.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>no banned users</p>}
          {bannedUsers && bannedUsers.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div>
                <span style={{ fontSize: '0.85rem' }}>{u.username}</span>
                {u.reason && <span style={{ color: 'var(--muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>— {u.reason}</span>}
              </div>
              <button onClick={() => unbanUser(u.username)} style={{ ...btn(), fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>unban</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'passwords' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 380 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Change main and duress passwords. Both are required.</p>
          <input type="password" value={newMain} onChange={e => setNewMain(e.target.value)} placeholder="new main password" style={inp} />
          <input type="password" value={newDuress} onChange={e => setNewDuress(e.target.value)} placeholder="new duress password" style={inp} />
          {feedback && <p style={{ fontSize: '0.8rem', color: 'var(--error)' }}>{feedback}</p>}
          <button onClick={e => changePassword(e as unknown as React.FormEvent)} style={btn(true)}>update passwords</button>
        </div>
      )}
    </main>
  )
}
