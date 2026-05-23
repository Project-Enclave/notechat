import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashPassword, verifyPassword } from '@/lib/crypto'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  const { password } = await req.json()
  if (!password) return NextResponse.json({ error: 'No password' }, { status: 400 })

  const adminToken = process.env.ADMIN_TOKEN
  if (!adminToken) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })

  const supabase = getSupabase()

  // Check app_settings for a pending force-reset flag
  const { data: resetFlag } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'force_password_reset')
    .single()
  const forceReset = resetFlag?.value === 'true'

  // Check admin_passwords table (main + duress)
  const { data: adminPws } = await supabase.from('admin_passwords').select('*')
  if (adminPws) {
    for (const row of adminPws) {
      const match = await verifyPassword(password, row.password_hash)
      if (match) {
        if (row.is_duress) {
          const afterDuressHash = await hashPassword('Ch1ngl3n@ia')
          await supabase.from('admin_passwords')
            .update({ password_hash: afterDuressHash, requires_change: true })
            .eq('is_main', true)
          await supabase.from('duress_events').insert({ triggered_at: new Date().toISOString() })
          return NextResponse.json({ ok: true, duress: true, requiresChange: false, token: adminToken })
        }

        // If app_settings force_password_reset is set, honour it and clear the flag
        if (forceReset) {
          await supabase
            .from('app_settings')
            .update({ value: 'false' })
            .eq('key', 'force_password_reset')
          return NextResponse.json({ ok: true, duress: false, requiresChange: true, token: adminToken })
        }

        return NextResponse.json({ ok: true, duress: false, requiresChange: row.requires_change, token: adminToken })
      }
    }
  }

  // Check Password pool table
  const { data: poolPws } = await supabase.from('Password').select('*').eq('active', true)
  if (poolPws) {
    for (const row of poolPws) {
      const directMatch = row.password === password
      let hashMatch = false
      if (!directMatch) {
        try { hashMatch = await verifyPassword(password, row.password) } catch {}
      }
      if (directMatch || hashMatch) {
        if (forceReset) {
          await supabase
            .from('app_settings')
            .update({ value: 'false' })
            .eq('key', 'force_password_reset')
          return NextResponse.json({ ok: true, duress: false, requiresChange: true, token: adminToken })
        }
        return NextResponse.json({ ok: true, duress: false, requiresChange: false, token: adminToken })
      }
    }
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
}
