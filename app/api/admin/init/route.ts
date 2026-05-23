import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashPassword } from '@/lib/crypto'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  const supabase = getSupabase()

  // Block if already initialised
  const { data: existing } = await supabase.from('admin_passwords').select('id').limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Already initialised' }, { status: 400 })
  }

  const { main, duress } = await req.json()
  if (!main || !duress) {
    return NextResponse.json({ error: 'Both passwords required' }, { status: 400 })
  }
  if (main === duress) {
    return NextResponse.json({ error: 'Main and duress passwords must differ' }, { status: 400 })
  }
  if (main.length < 8 || duress.length < 8) {
    return NextResponse.json({ error: 'Passwords must be at least 8 characters' }, { status: 400 })
  }

  const mainHash = await hashPassword(main)
  const duressHash = await hashPassword(duress)
  // after-duress placeholder — will be replaced when duress is triggered
  const afterDuressHash = await hashPassword(main + '_reset')

  const { error } = await supabase.from('admin_passwords').insert([
    { password_hash: mainHash,        label: 'main',        is_main: true,  is_duress: false, requires_change: false },
    { password_hash: duressHash,      label: 'duress',      is_main: false, is_duress: true,  requires_change: false },
    { password_hash: afterDuressHash, label: 'after-duress',is_main: false, is_duress: false, requires_change: true  },
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
