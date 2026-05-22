export type Note = {
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

export async function fetchNotes(): Promise<Note[]> {
  const res = await fetch('/api/notes')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function saveNoteApi(
  body: Record<string, unknown>,
  noteId?: string
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const url = noteId ? `/api/notes/${noteId}` : '/api/notes'
  const method = noteId ? 'PATCH' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { ok: res.ok, data }
}

export async function deleteNoteApi(
  noteId: string
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
  const data = await res.json()
  return { ok: res.ok, data }
}

// toB64: correctly unwraps typed arrays to their underlying ArrayBuffer
export const toB64 = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)))

export const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptNote(
  text: string,
  password: string
): Promise<{ ciphertext: string; salt: string; iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  )
  return { ciphertext: toB64(encrypted), salt: toB64(salt), iv: toB64(iv) }
}

export async function decryptNote(
  ciphertext: string,
  password: string,
  saltB64: string,
  ivB64: string
): Promise<string | null> {
  try {
    const key = await deriveKey(password, fromB64(saltB64))
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) },
      key,
      fromB64(ciphertext)
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}
