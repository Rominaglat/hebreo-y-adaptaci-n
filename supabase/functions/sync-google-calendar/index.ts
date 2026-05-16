import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";


const DEFAULT_CALENDAR_ID = 'your-calendar-id@group.calendar.google.com';

// platform_settings was dropped alongside the multi-tenancy layer. Override
// the calendar URL by setting GOOGLE_CALENDAR_URL as an edge-function secret.
function getCalendarUrl(): string {
  const override = Deno.env.get('GOOGLE_CALENDAR_URL');
  if (override) return override;
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(DEFAULT_CALENDAR_ID)}/public/basic.ics`;
}

interface ParsedEvent {
  uid: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
}

function parseICalDate(dateStr: string): Date {
  // Handle YYYYMMDDTHHMMSSZ format
  if (dateStr.includes('T')) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    const hour = parseInt(dateStr.substring(9, 11));
    const minute = parseInt(dateStr.substring(11, 13));
    const second = parseInt(dateStr.substring(13, 15));
    
    if (dateStr.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    return new Date(year, month, day, hour, minute, second);
  }
  
  // Handle YYYYMMDD format (all-day events)
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(year, month, day, 0, 0, 0);
}

function unfoldICalContent(content: string): string {
  // iCal lines can be folded - continued lines start with a space or tab
  return content.replace(/\r?\n[ \t]/g, '');
}

function unescapeICalText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseICalEvents(icalData: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const unfolded = unfoldICalContent(icalData);
  const lines = unfolded.split(/\r?\n/);
  
  let currentEvent: Partial<ParsedEvent> | null = null;
  
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.uid && currentEvent.title && currentEvent.start_time && currentEvent.end_time) {
        events.push(currentEvent as ParsedEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const keyPart = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 1);
        
        // Extract the property name (before any parameters like ;TZID=...)
        const key = keyPart.split(';')[0];
        
        switch (key) {
          case 'UID':
            currentEvent.uid = value;
            break;
          case 'SUMMARY':
            currentEvent.title = unescapeICalText(value);
            break;
          case 'DESCRIPTION':
            currentEvent.description = unescapeICalText(value);
            break;
          case 'LOCATION':
            currentEvent.location = unescapeICalText(value);
            break;
          case 'DTSTART':
            currentEvent.start_time = parseICalDate(value).toISOString();
            break;
          case 'DTEND':
            currentEvent.end_time = parseICalDate(value).toISOString();
            break;
        }
      }
    }
  }
  
  return events;
}

async function userHasAdminAccess(supabase: any, userId: string): Promise<boolean> {
  const { data: roles, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .in('role', ['admin', 'super_admin']);

  if (error) {
    console.log('Role lookup error:', error.message);
    return false;
  }
  return (roles?.length ?? 0) > 0;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Authentication check - require admin user or cron secret
    const authHeader = req.headers.get('Authorization');
    const cronSecret = req.headers.get('x-cron-secret');

    console.log('Auth check - hasAuthHeader:', !!authHeader, 'hasCronSecret:', !!cronSecret);

    let isAuthorized = false;

    // Option 1: Cron secret for scheduled jobs (uses service role key)
    if (cronSecret && cronSecret === supabaseServiceKey) {
      isAuthorized = true;
      console.log('Authorized via cron secret');
    }

    // Option 2: Authenticated admin user (single-tenant: user_roles)
    if (!isAuthorized && authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      console.log('Auth result - user:', user?.id, 'error:', authError?.message);

      if (!authError && user) {
        isAuthorized = await userHasAdminAccess(supabase, user.id);
        if (isAuthorized) {
          console.log('Authorized via admin/super_admin role:', user.id);
        }
      }
    }

    if (!isAuthorized) {
      console.error('Unauthorized access attempt to sync-google-calendar');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - admin access required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get calendar URL (env override or hardcoded default)
    const icalUrl = getCalendarUrl();
    
    console.log('Fetching iCal from:', icalUrl);
    
    // Fetch the iCal data with retry logic for rate limiting
    const maxRetries = 3;
    let lastError: Error | null = null;
    let icalData: string | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await fetch(icalUrl);
      
      if (response.ok) {
        icalData = await response.text();
        console.log('Received iCal data, length:', icalData.length);
        break;
      }
      
      if (response.status === 429) {
        // Rate limited - wait with exponential backoff before retrying
        const waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`Rate limited (429). Attempt ${attempt}/${maxRetries}. Waiting ${waitTime}ms before retry...`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // All retries exhausted
        lastError = new Error('Calendar sync temporarily unavailable due to rate limiting. Please try again in a few minutes.');
      } else {
        lastError = new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
        break;
      }
    }
    
    if (!icalData) {
      throw lastError || new Error('Failed to fetch calendar data');
    }
    
    // Parse events from iCal
    const parsedEvents = parseICalEvents(icalData);
    console.log('Parsed events count:', parsedEvents.length);
    
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get all current google_event_ids from the parsed events
    const syncedEventIds = parsedEvents.map(e => e.uid);
    
    // Delete events that no longer exist in Google Calendar
    // Only delete events that have a google_event_id (synced from Google)
    // Single-tenant: no tenant filter — every synced event belongs to the one tenant.
    let deletedCount = 0;
    if (syncedEventIds.length > 0) {
      const { data: deletedEvents, error: deleteError } = await supabase
        .from('events')
        .delete()
        .not('google_event_id', 'is', null)
        .not('google_event_id', 'in', `(${syncedEventIds.map(id => `"${id}"`).join(',')})`)
        .select('id');

      if (deleteError) {
        console.error('Error deleting removed events:', deleteError);
      } else {
        deletedCount = deletedEvents?.length || 0;
        console.log('Deleted events no longer in calendar:', deletedCount);
      }
    } else {
      // Calendar empty — wipe all synced events.
      const { data: deletedEvents, error: deleteError } = await supabase
        .from('events')
        .delete()
        .not('google_event_id', 'is', null)
        .select('id');

      if (deleteError) {
        console.error('Error deleting all synced events:', deleteError);
      } else {
        deletedCount = deletedEvents?.length || 0;
        console.log('Deleted all synced events (calendar empty):', deletedCount);
      }
    }

    // Upsert events to database
    let upsertedCount = 0;
    for (const event of parsedEvents) {
      const { error } = await supabase
        .from('events')
        .upsert({
          google_event_id: event.uid,
          title: event.title,
          description: event.description,
          start_time: event.start_time,
          end_time: event.end_time,
          location: event.location,
        }, {
          onConflict: 'google_event_id',
        });
      
      if (error) {
        console.error('Error upserting event:', event.title, error);
      } else {
        upsertedCount++;
      }
    }
    
    console.log('Successfully synced events:', upsertedCount, 'Deleted:', deletedCount);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: upsertedCount,
        deleted: deletedCount,
        total: parsedEvents.length 
      }),
      { 
        status: 200, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      }
    );
    
  } catch (error: unknown) {
    console.error('Error syncing calendar:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      }
    );
  }
});
