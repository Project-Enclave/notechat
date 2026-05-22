export type Message = {
  id: string
  username: string
  content: string
  created_at: string
}

export async function fetchMessages(): Promise<Message[]> {
  const res = await fetch('/api/messages')
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function postMessage(
  username: string,
  content: string
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, content }),
  })
  const data = await res.json()
  return { ok: res.ok, data }
}
