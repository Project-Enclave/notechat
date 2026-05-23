'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [main, setMain] = useState('')
  const [duress, setDuress] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!main.trim() || !duress.trim()) { setError('Both fields required'); return }
    if (main === duress) { setError('Main and duress passwords must differ'); return }
    if (main.length < 8 || duress.length < 8) { setError('Passwords must be at least 8 characters'); return }
    setLoading(true)
    const r = await fetch('/api/admin/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main, duress }),
    })
    const res = await r.json()
    setLoading(false)
    if (!r.ok) {
      setError(res.error || 'Setup failed')
      if (res.error === 'Already initialised') router.replace('/admin')
      return
    }
    router.replace('/admin')
  }

  const inp: React.CSSProperties = {
    padding: '0.45rem 0.75rem', borderRadius: 6,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--fg)', fontFamily: 'inherit', fontSize: '0.875rem', width: '100%'
  }
  const btn: React.CSSProperties = {
    padding: '0.45rem 1rem', borderRadius: 6, border: 'none',
    background: 'var(--accent)', color: '#fff',
    fontFamily: 'inherit', fontSize: '0.875rem', cursor: 'pointer',
    opacity: loading ? 0.6 : 1
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 320 }}>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-0.02em' }}>first-time setup</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            Set your admin and duress passwords. This can only be done once.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>main password</label>
          <input
            type="password" value={main}
            onChange={e => setMain(e.target.value)}
            placeholder="min 8 characters"
            style={inp} autoFocus
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>duress password</label>
          <input
            type="password" value={duress}
            onChange={e => setDuress(e.target.value)}
            placeholder="used to trigger duress mode"
            style={inp}
          />
        </div>
        {error && <p style={{ color: 'var(--error)', fontSize: '0.8rem' }}>{error}</p>}
        <button type="submit" style={btn} disabled={loading}>
          {loading ? 'setting up...' : 'complete setup'}
        </button>
        <p style={{ fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.4 }}>
          Already set up? <a href="/admin" style={{ color: 'var(--accent)' }}>go to admin</a>
        </p>
      </form>
    </main>
  )
}
