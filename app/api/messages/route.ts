import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// In-memory rate limit: max 10 POSTs per IP per minute
const ipBucket = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const bucket = ipBucket.get(ip)
  if (!bucket || now > bucket.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + 60_000 })
    return false // not limited
  }
  bucket.count++
  return bucket.count > 10
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getBanReason(
  supabase: ReturnType<typeof getSupabase>,
  username: string
): Promise<string | null> {
  const { data } = await supabase
    .from('banned_users')
    .select('reason')
    .eq('username', username.toLowerCase())
    .limit(1)
  if (!data || data.length === 0) return null
  return data[0].reason ?? ''
}

async function isLockedDown(
  supabase: ReturnType<typeof getSupabase>
): Promise<boolean> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'lockdown')
    .limit(1)
  return !!data && data.length > 0 && data[0].value === 'true'
}

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const supabase = getSupabase()
  const { username, content } = await req.json()
  if (!username?.trim() || !content?.trim())
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  if (await isLockedDown(supabase))
    return NextResponse.json(
      { error: 'Chat is locked down. No new messages allowed.' },
      { status: 403 }
    )

  const banReason = await getBanReason(supabase, username)
  if (banReason !== null)
    return NextResponse.json({ error: 'You are banned.', dos: true }, { status: 403 })

  const { data, error } = await supabase
    .from('messages')
    .insert({ username: username.trim(), content: content.trim() })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
