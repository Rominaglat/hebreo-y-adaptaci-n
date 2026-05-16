import { useEffect, useState, useCallback } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  Link as LinkIcon,
  Users,
  Plus,
  Check,
  Loader2,
  RefreshCw,
  ExternalLink,
  Settings
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths, subMonths, isPast } from 'date-fns';
import { he, enUS } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { MemberProfileDialog, MemberProfile } from '@/components/MemberProfileDialog';

interface Event {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  meeting_url: string | null;
  rsvp_count: number;
  user_rsvped: boolean;
}

interface RsvpAttendee {
  id: string;
  user_id: string;
  profile?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

export default function CalendarPage() {
  const { user, isAdmin } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    location: '',
    meeting_url: ''
  });
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [rsvpAttendees, setRsvpAttendees] = useState<RsvpAttendee[]>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);
  const [attendeesEvent, setAttendeesEvent] = useState<Event | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(null);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);

  const hebrewDays = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const englishDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const weekDays = language === 'he' ? hebrewDays : englishDays;

  // NOTE: `platform_settings` was dropped along with the multi-tenancy DB layer.
  // The Google Calendar iCal URL now lives as a constant; if you need to change
  // it, edit the value below or move it to an env var. The settings dialog is
  // still rendered for visual continuity but its Save is a no-op (see below).
  const GOOGLE_CALENDAR_ICAL_URL = '';
  const fetchCalendarSettings = useCallback(async () => {
    if (GOOGLE_CALENDAR_ICAL_URL) setCalendarUrl(GOOGLE_CALENDAR_ICAL_URL);
  }, []);

  // Convert various Google Calendar URL formats to the proper iCal export URL
  const convertToICalUrl = (url: string): string => {
    const trimmedUrl = url.trim();
    
    // Already in correct iCal format
    if (trimmedUrl.includes('/calendar/ical/') && trimmedUrl.endsWith('.ics')) {
      return trimmedUrl;
    }
    
    // Extract calendar ID from various URL formats
    let calendarId: string | null = null;
    
    // Format: ?cid=CALENDAR_ID
    const cidMatch = trimmedUrl.match(/[?&]cid=([^&]+)/);
    if (cidMatch) {
      calendarId = decodeURIComponent(cidMatch[1]);
    }
    
    // Format: /calendar/embed?src=CALENDAR_ID
    const srcMatch = trimmedUrl.match(/[?&]src=([^&]+)/);
    if (srcMatch) {
      calendarId = decodeURIComponent(srcMatch[1]);
    }
    
    // Format: /calendar/ical/CALENDAR_ID/... (extract the ID)
    const icalPathMatch = trimmedUrl.match(/\/calendar\/ical\/([^/]+)\//);
    if (icalPathMatch) {
      calendarId = decodeURIComponent(icalPathMatch[1]);
    }
    
    // If we found a calendar ID, construct the proper iCal URL
    if (calendarId) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    }
    
    // Return as-is if we can't parse it
    return trimmedUrl;
  };

  const saveCalendarSettings = async () => {
    // platform_settings was dropped — persistence isn't wired up. Until a
    // replacement is in place, the URL only lives in this component's state
    // for the current session. Edit GOOGLE_CALENDAR_ICAL_URL above to change
    // the baked-in default.
    if (!calendarUrl.trim()) return;

    setSavingSettings(true);
    try {
      const icalUrl = convertToICalUrl(calendarUrl);
      setCalendarUrl(icalUrl);

      toast({
        title: language === 'he' ? 'ההגדרה לא נשמרת בשרת' : 'Setting not persisted',
        description:
          language === 'he'
            ? 'שמירה לשרת מושבתת כרגע. הערך יישמר עד לרענון.'
            : 'Server-side persistence is currently disabled. The value will hold until refresh.',
      });
      setSettingsOpen(false);
      syncGoogleCalendar({ toastOnSuccess: true, focusOnSyncedEvents: true });
    } catch (error) {
      console.error('Error applying calendar settings:', error);
      toast({
        title: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  // Sync with Google Calendar
  const syncGoogleCalendar = async (
    options: { toastOnSuccess?: boolean; focusOnSyncedEvents?: boolean } = {}
  ) => {
    if (!isAdmin) return;

    const { toastOnSuccess = false, focusOnSyncedEvents = false } = options;

    setSyncing(true);
    setSyncError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        console.log('No auth token available, skipping sync');
        return;
      }

      const { data, error } = await supabase.functions.invoke('sync-google-calendar', {
        body: {},
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('Calendar sync result:', data);
      
      // Check if response indicates success (even if there's a parsing error)
      if (data?.success) {
        setSyncError(null);
      } else if (error) {
        throw error;
      } else if (data?.error) {
        throw new Error(data.error);
      }
      
      setSyncError(null);

      const loadedEvents = await fetchEvents();

      if (focusOnSyncedEvents && loadedEvents.length > 0) {
        const now = new Date();
        const upcoming = loadedEvents.find((e) => new Date(e.start_time) >= now);
        const focusEvent = upcoming ?? loadedEvents[loadedEvents.length - 1];
        const focusDate = new Date(focusEvent.start_time);

        setCurrentMonth(focusDate);
        setSelectedDate(focusDate);
      }

      if (toastOnSuccess) {
        const total = (data as any)?.total ?? (data as any)?.synced ?? loadedEvents.length;
        toast({
          title: language === 'he' ? 'הסנכרון הושלם' : 'Sync complete',
          description:
            language === 'he'
              ? `סונכרנו ${total} אירועים מהיומן.`
              : `Synced ${total} events from the calendar.`,
        });
      }
    } catch (error: any) {
      console.error('Error syncing calendar:', error);
      const errorMessage =
        language === 'he' ? 'שגיאה בסנכרון היומן. יש לנסות שוב.' : 'Error syncing calendar. Please try again.';
      setSyncError(errorMessage);
      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchEvents();
    if (isAdmin) {
      fetchCalendarSettings();
      syncGoogleCalendar();
    }

    // Set up periodic sync every 5 minutes (only for admins)
    let syncInterval: NodeJS.Timeout | null = null;
    if (isAdmin) {
      syncInterval = setInterval(() => syncGoogleCalendar(), 5 * 60 * 1000);
    }

    // Set up realtime subscription for events table
    const eventsChannel = supabase
      .channel('events-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        () => fetchEvents()
      )
      .subscribe();

    const rsvpChannel = supabase
      .channel('event-rsvps-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_rsvps' },
        () => fetchEvents()
      )
      .subscribe();

    return () => {
      if (syncInterval) clearInterval(syncInterval);
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(rsvpChannel);
    };
  }, [user, isAdmin]);

  const fetchEvents = async (): Promise<Event[]> => {
    try {
      const { data: eventsData, error } = await supabase
        .from('events')
        .select('*')
        .order('start_time', { ascending: true });

      if (error) throw error;

      const baseEvents: Event[] = (eventsData ?? []).map((event: any) => ({
        ...event,
        rsvp_count: 0,
        user_rsvped: false,
      }));

      if (!user || !eventsData) {
        setEvents(baseEvents);
        return baseEvents;
      }

      const eventsWithRsvp: Event[] = await Promise.all(
        eventsData.map(async (event: any) => {
          const { count } = await supabase
            .from('event_rsvps')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', event.id);

          const { data: userRsvp } = await supabase
            .from('event_rsvps')
            .select('id')
            .eq('event_id', event.id)
            .eq('user_id', user.id)
            .maybeSingle();

          return {
            ...event,
            rsvp_count: count || 0,
            user_rsvped: !!userRsvp,
          };
        })
      );

      setEvents(eventsWithRsvp);
      return eventsWithRsvp;
    } catch (error) {
      console.error('Error fetching events:', error);
      setEvents([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async () => {
    if (!user || !newEvent.title.trim() || !newEvent.start_time || !newEvent.end_time) return;

    setIsCreating(true);

    try {
      const { error } = await supabase
        .from('events')
        .insert({
          title: newEvent.title.trim(),
          description: newEvent.description.trim() || null,
          start_time: new Date(newEvent.start_time).toISOString(),
          end_time: new Date(newEvent.end_time).toISOString(),
          location: newEvent.location.trim() || null,
          meeting_url: newEvent.meeting_url.trim() || null,
          created_by: user.id,
        });

      if (error) throw error;

      toast({
        title: t('calendar.eventCreated'),
        description: t('calendar.eventCreatedDesc'),
      });

      setNewEvent({
        title: '',
        description: '',
        start_time: '',
        end_time: '',
        location: '',
        meeting_url: ''
      });
      setDialogOpen(false);
      fetchEvents();
    } catch (error) {
      console.error('Error creating event:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRsvp = async (eventId: string, currentlyRsvped: boolean) => {
    if (!user) return;

    try {
      if (currentlyRsvped) {
        await supabase
          .from('event_rsvps')
          .delete()
          .eq('event_id', eventId)
          .eq('user_id', user.id);
        
        toast({ title: t('calendar.unregistered') });
      } else {
        await supabase
          .from('event_rsvps')
          .insert({ event_id: eventId, user_id: user.id });
        
        toast({ title: t('calendar.registered'), description: t('calendar.registeredDesc') });
      }

      fetchEvents();
    } catch (error) {
      console.error('Error updating RSVP:', error);
    }
  };

  // Fetch attendees for an event (admin only)
  const fetchEventAttendees = async (eventId: string) => {
    if (!isAdmin) return;
    setLoadingAttendees(true);
    setRsvpAttendees([]);
    try {
      const { data, error } = await supabase
        .from('event_rsvps')
        .select('id, user_id')
        .eq('event_id', eventId);

      if (error) throw error;

      const userIds = data?.map((r) => r.user_id) || [];

      // Profiles are the single source of truth post tenant_memberships drop.
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      const attendees: RsvpAttendee[] =
        data?.map((rsvp) => {
          const profile = profiles?.find((p) => p.id === rsvp.user_id);

          const displayName = profile?.full_name || null;
          const avatarUrl = profile?.avatar_url || null;

          return {
            id: rsvp.id,
            user_id: rsvp.user_id,
            profile: { full_name: displayName, avatar_url: avatarUrl },
          };
        }) || [];

      setRsvpAttendees(attendees);
    } catch (err) {
      console.error('Error fetching attendees:', err);
    } finally {
      setLoadingAttendees(false);
    }
  };

  const openMemberProfile = (attendee: RsvpAttendee) => {
    setSelectedMember({
      id: attendee.id,
      user_id: attendee.user_id,
      full_name: attendee.profile?.full_name || null,
      avatar_url: attendee.profile?.avatar_url || null,
      bio: null,
      phone: null,
    });
    setMemberDialogOpen(true);
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const eventsOnDate = (date: Date) => {
    return events.filter(event => isSameDay(new Date(event.start_time), date));
  };

  const selectedDateEvents = eventsOnDate(selectedDate);

  const formatEventTime = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`;
  };

  const dateLocale = language === 'he' ? he : enUS;

  return (

      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('calendar.title')}</h1>
              <p className="text-muted-foreground mt-1.5">
                {language === 'he' ? 'אירועים, מפגשים ופגישות בקרוב' : 'Upcoming events, sessions and meetings'}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => syncGoogleCalendar({ toastOnSuccess: true, focusOnSyncedEvents: true })}
                disabled={syncing}
                className="text-xs sm:text-sm"
              >
                <RefreshCw className={cn("w-4 h-4 mx-1 sm:mx-2", syncing && "animate-spin")} />
                <span className="hidden sm:inline">{syncing ? t('calendar.syncing') : t('calendar.sync')}</span>
              </Button>
            )}
            
            {isAdmin && (
              <>
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4 mx-1" />
                      <span className="hidden sm:inline">{language === 'he' ? 'הגדרות' : 'Settings'}</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{language === 'he' ? 'הגדרות יומן' : 'Calendar Settings'}</DialogTitle>
                      <DialogDescription>
                        {language === 'he' ? 'הגדרת לינק הסנכרון ליומן גוגל' : 'Configure the Google Calendar sync link'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="calendar-url">{language === 'he' ? 'לינק iCal של יומן גוגל' : 'Google Calendar iCal URL'}</Label>
                        <Input
                          id="calendar-url"
                          placeholder="https://calendar.google.com/calendar/ical/..."
                          value={calendarUrl}
                          onChange={(e) => setCalendarUrl(e.target.value)}
                          dir="ltr"
                        />
                        <p className="text-xs text-muted-foreground">
                          {language === 'he' 
                            ? 'העתק את כתובת ה-iCal מהגדרות היומן בגוגל (יומן ציבורי)' 
                            : 'Copy the iCal address from Google Calendar settings (public calendar)'}
                        </p>
                      </div>
                      <Button 
                        className="w-full" 
                        onClick={saveCalendarSettings}
                        disabled={!calendarUrl.trim() || savingSettings}
                      >
                        {savingSettings ? (
                          <>
                            <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                            {language === 'he' ? 'שומר...' : 'Saving...'}
                          </>
                        ) : (
                          language === 'he' ? 'שמור' : 'Save'
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mx-2" />
                      {t('calendar.createEvent')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{t('calendar.newEvent')}</DialogTitle>
                      <DialogDescription>
                        {t('calendar.newEventDesc')}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="event-title">{t('calendar.eventTitle')}</Label>
                        <Input
                          id="event-title"
                          placeholder={t('calendar.eventTitlePlaceholder')}
                          value={newEvent.title}
                          onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="start-time">{t('calendar.startTime')}</Label>
                          <Input
                            id="start-time"
                            type="datetime-local"
                            value={newEvent.start_time}
                            onChange={(e) => setNewEvent({ ...newEvent, start_time: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="end-time">{t('calendar.endTime')}</Label>
                          <Input
                            id="end-time"
                            type="datetime-local"
                            value={newEvent.end_time}
                            onChange={(e) => setNewEvent({ ...newEvent, end_time: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="description">{t('calendar.eventDescription')}</Label>
                        <Textarea
                          id="description"
                          placeholder={t('calendar.descriptionPlaceholder')}
                          value={newEvent.description}
                          onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="location">{t('calendar.location')}</Label>
                        <Input
                          id="location"
                          placeholder={t('calendar.locationPlaceholder')}
                          value={newEvent.location}
                          onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="meeting-url">{t('calendar.meetingUrl')}</Label>
                        <Input
                          id="meeting-url"
                          placeholder="https://..."
                          value={newEvent.meeting_url}
                          onChange={(e) => setNewEvent({ ...newEvent, meeting_url: e.target.value })}
                        />
                      </div>
                      <Button 
                        className="w-full" 
                        onClick={handleCreateEvent}
                        disabled={!newEvent.title.trim() || !newEvent.start_time || !newEvent.end_time || isCreating}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                            {t('calendar.creating')}
                          </>
                        ) : (
                          t('calendar.createEvent')
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Calendar */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-base sm:text-lg">{format(currentMonth, 'MMMM yyyy', { locale: dateLocale })}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <span className="sr-only">{t('calendar.nextMonth')}</span>
                    →
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-8 text-xs sm:text-sm"
                    onClick={() => {
                      setCurrentMonth(new Date());
                      setSelectedDate(new Date());
                    }}
                  >
                    {t('calendar.today')}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <span className="sr-only">{t('calendar.prevMonth')}</span>
                    ←
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-2 sm:p-6">
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                {weekDays.map(day => (
                  <div key={day} className="text-center text-xs sm:text-sm font-medium text-muted-foreground py-1 sm:py-2">
                    {day}
                  </div>
                ))}
                
                {/* Empty cells for days before month start */}
                {Array.from({ length: monthStart.getDay() }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-8 sm:h-12" />
                ))}
                
                {daysInMonth.map(day => {
                  const dayEvents = eventsOnDate(day);
                  const isSelected = isSameDay(day, selectedDate);
                  
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        "h-8 sm:h-12 rounded-md sm:rounded-lg flex flex-col items-center justify-center relative transition-colors",
                        isSelected && "bg-primary text-primary-foreground",
                        !isSelected && isToday(day) && "bg-secondary",
                        !isSelected && !isToday(day) && "hover:bg-secondary/50",
                        !isSameMonth(day, currentMonth) && "text-muted-foreground"
                      )}
                    >
                      <span className="text-xs sm:text-sm">{format(day, 'd')}</span>
                      {dayEvents.length > 0 && (
                        <div className={cn(
                          "w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full mt-0.5",
                          isSelected ? "bg-primary-foreground" : "bg-primary"
                        )} />
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Events List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base">
                {format(selectedDate, 'EEEE, d בMMMM', { locale: dateLocale })}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                {selectedDateEvents.length} {t('calendar.events')}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              {selectedDateEvents.length === 0 ? (
                <div className="text-center py-6 sm:py-8">
                  <CalendarIcon className="w-8 h-8 sm:w-10 sm:h-10 text-muted-foreground mx-auto mb-2 sm:mb-3" />
                  <p className="text-xs sm:text-sm text-muted-foreground">{t('calendar.noEvents')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDateEvents.map(event => {
                    const eventEndTime = new Date(event.end_time);
                    const isEventPast = isPast(eventEndTime);
                    
                    return (
                    <div 
                      key={event.id} 
                      className={cn(
                        "p-2.5 sm:p-3 rounded-lg bg-secondary/50 space-y-1.5 sm:space-y-2 cursor-pointer hover:bg-secondary/70 transition-colors overflow-hidden",
                        isEventPast && "opacity-50 grayscale"
                      )}
                      onClick={() => {
                        setSelectedEvent(event);
                        setEventDetailOpen(true);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm sm:text-base truncate flex-1">{event.title}</h4>
                        {isEventPast && (
                          <span className="text-[10px] sm:text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                            {language === 'he' ? 'עבר' : 'Past'}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground min-w-0">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{formatEventTime(event.start_time, event.end_time)}</span>
                      </div>
                      
                      {event.location && (
                        <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground min-w-0">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{event.location}</span>
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-1.5 sm:pt-2">
                        <button
                          type="button"
                          className={cn(
                            "flex items-center gap-1 text-xs sm:text-sm text-muted-foreground",
                            isAdmin && event.rsvp_count > 0 && "hover:text-primary cursor-pointer underline-offset-2 hover:underline"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAdmin && event.rsvp_count > 0) {
                              setAttendeesEvent(event);
                              fetchEventAttendees(event.id);
                              setAttendeesDialogOpen(true);
                            }
                          }}
                          disabled={!isAdmin || event.rsvp_count === 0}
                        >
                          <Users className="w-3 h-3" />
                          {event.rsvp_count} {t('calendar.participants')}
                        </button>
                        
                        <Button
                          size="sm"
                          className="h-7 sm:h-8 text-xs sm:text-sm px-2 sm:px-3"
                          variant={event.user_rsvped ? "secondary" : "default"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRsvp(event.id, event.user_rsvped);
                          }}
                          disabled={isEventPast}
                        >
                          {event.user_rsvped ? (
                            <>
                              <Check className="w-3 h-3 mx-1" />
                              <span className="hidden xs:inline">{t('calendar.attending')}</span>
                            </>
                          ) : (
                            t('calendar.rsvp')
                          )}
                        </Button>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Events */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">{t('calendar.upcomingEvents')}</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            {loading ? (
              <div className="flex items-center justify-center py-6 sm:py-8">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-primary" />
              </div>
            ) : events.filter(e => new Date(e.start_time) >= new Date()).length === 0 ? (
              <div className="text-center py-6 sm:py-8">
                <CalendarIcon className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-2 sm:mb-3" />
                <p className="text-sm text-muted-foreground">{t('calendar.noUpcoming')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {events
                  .filter(e => new Date(e.start_time) >= new Date())
                  .slice(0, 6)
                  .map(event => (
                    <div 
                      key={event.id} 
                      className="p-3 sm:p-4 rounded-lg border bg-card cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => {
                        setSelectedEvent(event);
                        setEventDetailOpen(true);
                      }}
                    >
                      <h4 className="font-medium text-sm sm:text-base mb-2 truncate">{event.title}</h4>
                      <div className="space-y-1 text-xs sm:text-sm text-muted-foreground">
                        <div className="flex items-center gap-2 min-w-0">
                          <CalendarIcon className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{format(new Date(event.start_time), 'd בMMMM yyyy', { locale: dateLocale })}</span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{formatEventTime(event.start_time, event.end_time)}</span>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{event.location}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2 sm:mt-3 pt-2 sm:pt-3 border-t">
                        <button
                          type="button"
                          className={cn(
                            "text-xs text-muted-foreground",
                            isAdmin && event.rsvp_count > 0 && "hover:text-primary cursor-pointer underline-offset-2 hover:underline"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAdmin && event.rsvp_count > 0) {
                              setAttendeesEvent(event);
                              fetchEventAttendees(event.id);
                              setAttendeesDialogOpen(true);
                            }
                          }}
                          disabled={!isAdmin || event.rsvp_count === 0}
                        >
                          {event.rsvp_count} {t('calendar.participants')}
                        </button>
                        <Button
                          size="sm"
                          className="h-7 sm:h-8 text-xs sm:text-sm"
                          variant={event.user_rsvped ? "secondary" : "outline"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRsvp(event.id, event.user_rsvped);
                          }}
                        >
                          {event.user_rsvped ? (
                            <>
                              <Check className="w-3 h-3 mx-1" />
                              {t('calendar.attending')}
                            </>
                          ) : (
                            t('calendar.rsvp')
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Event Details Dialog */}
        <Dialog open={eventDetailOpen} onOpenChange={setEventDetailOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {selectedEvent && (
              <>
                <DialogHeader className="flex-shrink-0">
                  <DialogTitle className="text-xl break-words leading-tight pr-6">{selectedEvent.title}</DialogTitle>
                  <DialogDescription>
                    {format(new Date(selectedEvent.start_time), 'EEEE, d בMMMM yyyy', { locale: dateLocale })}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0">
                  <div className="flex items-center gap-3 text-muted-foreground min-w-0">
                    <Clock className="w-5 h-5 flex-shrink-0" />
                    <span className="break-words">{formatEventTime(selectedEvent.start_time, selectedEvent.end_time)}</span>
                  </div>
                  
                  {selectedEvent.location && (
                    <div className="flex items-start gap-3 text-muted-foreground min-w-0">
                      <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span className="break-words overflow-hidden">{selectedEvent.location}</span>
                    </div>
                  )}
                  
                  {selectedEvent.meeting_url && (
                    <div className="flex items-center gap-3 w-full max-w-full">
                      <LinkIcon className="w-5 h-5 flex-shrink-0 text-muted-foreground" />
                      <a 
                        href={selectedEvent.meeting_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        <span>{t('calendar.joinMeeting')}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  )}
                  
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-3 text-muted-foreground",
                      isAdmin && selectedEvent.rsvp_count > 0 && "hover:text-primary cursor-pointer underline-offset-2 hover:underline"
                    )}
                    onClick={() => {
                      if (isAdmin && selectedEvent.rsvp_count > 0) {
                        setAttendeesEvent(selectedEvent);
                        fetchEventAttendees(selectedEvent.id);
                        setAttendeesDialogOpen(true);
                      }
                    }}
                    disabled={!isAdmin || selectedEvent.rsvp_count === 0}
                  >
                    <Users className="w-5 h-5 flex-shrink-0" />
                    <span>{selectedEvent.rsvp_count} {t('calendar.participants')}</span>
                  </button>
                  
                  {selectedEvent.description && (
                    <div className="pt-4 border-t">
                      <p className="text-muted-foreground whitespace-pre-wrap break-words">{selectedEvent.description}</p>
                    </div>
                  )}
                </div>
                  
                <div className="flex gap-3 pt-4 flex-shrink-0 border-t mt-4">
                  {selectedEvent.meeting_url && (
                    <Button variant="outline" className="flex-1 min-w-0" asChild>
                      <a href={selectedEvent.meeting_url} target="_blank" rel="noopener noreferrer" className="truncate">
                        <ExternalLink className="w-4 h-4 mx-2 flex-shrink-0" />
                        <span className="truncate">{t('calendar.joinMeeting')}</span>
                      </a>
                    </Button>
                  )}
                  <Button
                    className="flex-1 min-w-0"
                    variant={selectedEvent.user_rsvped ? "secondary" : "default"}
                    onClick={() => {
                      handleRsvp(selectedEvent.id, selectedEvent.user_rsvped);
                      setSelectedEvent({
                        ...selectedEvent,
                        user_rsvped: !selectedEvent.user_rsvped,
                        rsvp_count: selectedEvent.user_rsvped 
                          ? selectedEvent.rsvp_count - 1 
                          : selectedEvent.rsvp_count + 1
                      });
                    }}
                  >
                    {selectedEvent.user_rsvped ? (
                      <>
                        <Check className="w-4 h-4 mx-2 flex-shrink-0" />
                        <span className="truncate">{t('calendar.attending')}</span>
                      </>
                    ) : (
                      <span className="truncate">{t('calendar.rsvp')}</span>
                    )}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Attendees Popup Dialog */}
        <Dialog open={attendeesDialogOpen} onOpenChange={setAttendeesDialogOpen}>
          <DialogContent className="max-w-sm overflow-x-hidden">
            <DialogHeader>
              <DialogTitle>
                {language === 'he' ? 'רשימת נרשמים' : 'Attendee List'}
              </DialogTitle>
              {attendeesEvent && (
                <DialogDescription className="truncate">
                  {attendeesEvent.title}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="pt-2">
              {loadingAttendees ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : rsvpAttendees.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {language === 'he' ? 'אין נרשמים' : 'No attendees'}
                </p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {rsvpAttendees.map((att) => (
                    <li 
                      key={att.id} 
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer"
                      onClick={() => openMemberProfile(att)}
                    >
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={att.profile?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {att.profile?.full_name
                            ? att.profile.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                            : '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm truncate hover:text-primary transition-colors">
                        {att.profile?.full_name || (language === 'he' ? 'משתמש' : 'User')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Member Profile Dialog */}
        <MemberProfileDialog
          member={selectedMember}
          open={memberDialogOpen}
          onOpenChange={setMemberDialogOpen}
        />
      </div>
  );
}