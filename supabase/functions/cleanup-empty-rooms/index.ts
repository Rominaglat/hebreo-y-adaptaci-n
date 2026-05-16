import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    // Authentication check - require admin user or cron secret
    const authHeader = req.headers.get('Authorization')
    const cronSecret = req.headers.get('x-cron-secret')
    const cronSecretEnv = Deno.env.get('CRON_SECRET') ?? ''

    let isAuthorized = false

    // Option 1: Cron secret for scheduled jobs.
    // SEC-018 follow-up — use a dedicated CRON_SECRET env var instead of the
    // service-role key. Constant-time compare.
    if (cronSecret && cronSecretEnv) {
      const a = new TextEncoder().encode(cronSecret)
      const b = new TextEncoder().encode(cronSecretEnv)
      let diff = a.length === b.length ? 0 : 1
      const len = Math.max(a.length, b.length)
      for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
      if (diff === 0) {
        isAuthorized = true
        console.log('Authorized via cron secret')
      }
    }
    
    // Option 2: Authenticated admin user
    if (!isAuthorized && authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const supabase = createClient(supabaseUrl, supabaseServiceKey)
      
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      
      if (!authError && user) {
        // Check if user is admin
        const { data: roleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single()
        
        if (!roleError && roleData) {
          isAuthorized = true
          console.log('Authorized via admin user:', user.id)
        }
      }
    }
    
    if (!isAuthorized) {
      console.error('Unauthorized access attempt to cleanup-empty-rooms')
      return new Response(
        JSON.stringify({ error: 'Unauthorized - admin access required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get rooms that are older than 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

    // First, get all rooms
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name, created_at')
      .lt('created_at', thirtyMinutesAgo)

    if (roomsError) {
      console.error('Error fetching rooms:', roomsError)
      throw roomsError
    }

    if (!rooms || rooms.length === 0) {
      console.log('No old rooms found')
      return new Response(
        JSON.stringify({ message: 'No old rooms to clean up', deleted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const roomIds = rooms.map(r => r.id)

    // Get participant counts for these rooms
    const { data: participants, error: participantsError } = await supabase
      .from('room_participants')
      .select('room_id')
      .in('room_id', roomIds)

    if (participantsError) {
      console.error('Error fetching participants:', participantsError)
      throw participantsError
    }

    // Find rooms with no participants
    const roomsWithParticipants = new Set(participants?.map(p => p.room_id) || [])
    const emptyRooms = rooms.filter(r => !roomsWithParticipants.has(r.id))

    if (emptyRooms.length === 0) {
      console.log('No empty rooms found')
      return new Response(
        JSON.stringify({ message: 'No empty rooms to clean up', deleted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emptyRoomIds = emptyRooms.map(r => r.id)
    console.log(`Found ${emptyRoomIds.length} empty rooms to delete:`, emptyRooms.map(r => r.name))

    // Delete WebRTC signals for these rooms first
    const { error: signalsError } = await supabase
      .from('webrtc_signals')
      .delete()
      .in('room_id', emptyRoomIds)

    if (signalsError) {
      console.error('Error deleting signals:', signalsError)
    }

    // Delete the empty rooms
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .in('id', emptyRoomIds)

    if (deleteError) {
      console.error('Error deleting rooms:', deleteError)
      throw deleteError
    }

    console.log(`Successfully deleted ${emptyRoomIds.length} empty rooms`)

    return new Response(
      JSON.stringify({ 
        message: `Cleaned up ${emptyRoomIds.length} empty rooms`,
        deleted: emptyRoomIds.length,
        roomNames: emptyRooms.map(r => r.name)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Cleanup error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
