import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Calendar,
  Clock,
  ArrowLeft,
  ArrowRight,
  GraduationCap,
  Megaphone,
  MapPin,
  Link as LinkIcon,
  ExternalLink,
  Users,
  Check
} from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StreakIndicator } from '@/components/StreakIndicator';
import GoalWidget from '@/components/GoalWidget';
import { AchievementsGrid } from '@/components/AchievementBadge';
import { RecommendedCourses } from '@/components/RecommendedCourses';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// ─── Animated counter hook ───
function useCountUp(end: number, duration = 1200) {
  const [count, setCount] = useState(0);
  const prevEnd = useRef(0);

  useEffect(() => {
    if (end === prevEnd.current) return;
    prevEnd.current = end;
    if (end === 0) { setCount(0); return; }

    const startTime = performance.now();
    const startVal = 0;

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(startVal + (end - startVal) * eased));
      if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }, [end, duration]);

  return count;
}

// ─── Stats Card Component ───
interface StatCardProps {
  value: number;
  label: string;
  icon: React.ReactNode;
  gradient: string;
  iconColor: string;
  suffix?: string;
  delay?: number;
}

function StatCard({ value, label, icon, gradient, iconColor, suffix = '', delay = 0 }: StatCardProps) {
  const animatedValue = useCountUp(value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.33, 1, 0.68, 1] }}
    >
      <Card className="card-premium cursor-default overflow-hidden relative group border-border/60">
        {/* Subtle gradient background — always faintly visible, brighter on hover */}
        <div className={cn("absolute inset-0 opacity-40 group-hover:opacity-100 transition-opacity duration-300", gradient)} />
        {/* Decorative corner glow */}
        <div className="absolute top-0 end-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors duration-500 pointer-events-none" />

        <CardContent className="p-4 sm:p-6 relative z-10">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className={cn(
              "flex w-11 h-11 sm:w-12 sm:h-12 rounded-xl items-center justify-center flex-shrink-0 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:rotate-3",
              iconColor
            )}>
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight truncate tabular-nums">
                {animatedValue}{suffix}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5 font-medium">{label}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface DashboardStats {
  myCourses: number;
  myProgress: number;
  announcements: number;
  upcomingEvents: number;
}

interface UpcomingEvent {
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

export default function Dashboard() {
  const { profile, user, tenantProfile, isAdmin } = useAuth();
  const { t, language } = useLanguage();
  const { currentTenant } = useTenant();
  const { toast } = useToast();

  const displayName = (tenantProfile?.full_name || profile?.full_name || '').trim();
  const firstName = displayName.split(' ')[0] || t('dashboard.fallbackName');
  const [stats, setStats] = useState<DashboardStats>({
    myCourses: 0,
    myProgress: 0,
    announcements: 0,
    upcomingEvents: 0
  });
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<UpcomingEvent | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);


  const fetchDashboardData = async () => {
    if (!user) return;

    try {
      const [
        myCoursesRes,
        myProgressRes,
        announcementsRes,
        eventsRes,
        eventsCountRes
      ] = await Promise.all([
        // My enrolled courses count
        supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        // My average progress
        supabase
          .from('enrollments')
          .select('progress_percentage')
          .eq('user_id', user.id),
        // Announcements count
        supabase
          .from('announcements')
          .select('id', { count: 'exact', head: true }),
        // Upcoming events for display (limit 3)
        supabase
          .from('events')
          .select('id, title, description, start_time, end_time, location, meeting_url')
          .gte('start_time', new Date().toISOString())
          .order('start_time', { ascending: true })
          .limit(3),
        // Total upcoming events count
        supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .gte('start_time', new Date().toISOString())
      ]);

      // Calculate average progress
      let avgProgress = 0;
      if (myProgressRes.data && myProgressRes.data.length > 0) {
        const total = myProgressRes.data.reduce((sum: number, e: any) => sum + (e.progress_percentage || 0), 0);
        avgProgress = Math.round(total / myProgressRes.data.length);
      }

      setStats({
        myCourses: myCoursesRes.count || 0,
        myProgress: avgProgress,
        announcements: announcementsRes.count || 0,
        upcomingEvents: eventsCountRes.count || 0
      });

      if (eventsRes.data && eventsRes.data.length > 0) {
        // Fetch RSVP data for each event
        const eventsWithRsvp: UpcomingEvent[] = await Promise.all(
          eventsRes.data.map(async (event: any) => {
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
        setUpcomingEvents(eventsWithRsvp);
      } else {
        setUpcomingEvents([]);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('dashboard.goodMorning');
    if (hour < 18) return t('dashboard.goodAfternoon');
    return t('dashboard.goodEvening');
  };

  const formatEventTime = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`;
  };

  const dateLocale = language === 'he' ? he : language === 'es' ? es : enUS;
  const dateLocaleString = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  const longDateFormat = language === 'he' ? 'EEEE, d בMMMM yyyy' : language === 'es' ? "EEEE, d 'de' MMMM 'de' yyyy" : 'EEEE, MMMM d, yyyy';

  const handleRsvp = async (eventId: string, currentlyRsvped: boolean) => {
    if (!user) return;

    try {
      if (currentlyRsvped) {
        await supabase
          .from('event_rsvps')
          .delete()
          .eq('event_id', eventId)
          .eq('user_id', user.id);

        toast({ title: t('dashboard.unregisteredToast') });
      } else {
        await supabase
          .from('event_rsvps')
          .insert({ event_id: eventId, user_id: user.id });

        toast({
          title: t('dashboard.registeredToast'),
          description: t('dashboard.registeredToastDesc')
        });
      }

      // Update local state
      setUpcomingEvents(prev =>
        prev.map(e =>
          e.id === eventId
            ? {
              ...e,
              user_rsvped: !currentlyRsvped,
              rsvp_count: currentlyRsvped ? e.rsvp_count - 1 : e.rsvp_count + 1
            }
            : e
        )
      );

      // Also update selected event if open
      if (selectedEvent && selectedEvent.id === eventId) {
        setSelectedEvent({
          ...selectedEvent,
          user_rsvped: !currentlyRsvped,
          rsvp_count: currentlyRsvped ? selectedEvent.rsvp_count - 1 : selectedEvent.rsvp_count + 1
        });
      }
    } catch (error) {
      console.error('Error updating RSVP:', error);
      toast({
        title: t('common.error'),
        variant: 'destructive'
      });
    }
  };

  // Clean description from Google Meet boilerplate text
  const cleanDescription = (description: string | null): string | null => {
    if (!description) return null;

    // Remove common Google Meet patterns
    const patterns = [
      /Über Google Meet teilnehmen:.*$/gms,
      /Join with Google Meet:.*$/gms,
      /הצטרף באמצעות Google Meet:.*$/gms,
      /Oder telefonisch:.*$/gms,
      /Or dial:.*$/gms,
      /Weitere Telefonnummern:.*$/gms,
      /More phone numbers:.*$/gms,
      /Weitere Informationen zu Meet:.*$/gms,
      /Learn more about Meet:.*$/gms,
      /https:\/\/meet\.google\.com\/[^\s]+/g,
      /https:\/\/tel\.meet\/[^\s]+/g,
      /\+\d{1,3}\s*\d{2,3}[-\s]\d{3}[-\s]\d{4}\s*PIN:?\s*\d+#?/g,
      /pin=\d+&hs=\d+/g,
      /https:\/\/support\.google\.com\/a\/users\/answer\/\d+/g,
    ];

    let cleaned = description;
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Trim extra whitespace and newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned || null;
  };

  const ArrowIcon = language === 'he' ? ArrowLeft : ArrowRight;

  return (

      <div className="space-y-5 sm:space-y-6 w-full min-w-0">
        {/* Premium Hero Greeting */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.33, 1, 0.68, 1] }}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7"
        >
          {/* Decorative blur orbs */}
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 w-full min-w-0">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
                {getGreeting()}, <span className="text-gradient">{firstName}</span>! 👋
              </h1>
              <p className="text-muted-foreground mt-1.5 truncate">
                {t('dashboard.welcomeSubtitle')}
              </p>
            </div>
            <Button asChild size="lg" className="sm:w-auto overflow-hidden shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
              <Link to="/courses" className="flex items-center content-center justify-center">
                <span className="truncate">{t('dashboard.allCourses')}</span>
                <ArrowIcon className="w-4 h-4 mx-2 flex-shrink-0" />
              </Link>
            </Button>
          </div>
        </motion.div>

        {/* Stats Grid - Animated stat cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full min-w-0">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3 sm:p-6 pt-3 sm:pt-6">
                  <div className="flex items-center gap-3">
                    <Skeleton className="hidden sm:block w-12 h-12 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-8 w-16" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full min-w-0">
            <StatCard
              value={stats.myCourses}
              label={t('dashboard.myCourses')}
              icon={<BookOpen className="w-6 h-6 text-primary dark:text-primary" />}
              iconColor="bg-primary/10 dark:bg-primary/20"
              gradient="bg-gradient-to-br from-primary/5 to-transparent dark:from-primary/10"
              delay={0}
            />
            <StatCard
              value={stats.myProgress}
              label={t('courses.progress')}
              suffix="%"
              icon={<GraduationCap className="w-6 h-6 text-accent dark:text-accent" />}
              iconColor="bg-accent/10 dark:bg-accent/20"
              gradient="bg-gradient-to-br from-accent/5 to-transparent dark:from-accent/10"
              delay={0.08}
            />
            <StatCard
              value={stats.announcements}
              label={t('announcements.title')}
              icon={<Megaphone className="w-6 h-6 text-warning dark:text-warning" />}
              iconColor="bg-warning/10 dark:bg-warning/20"
              gradient="bg-gradient-to-br from-warning/5 to-transparent dark:from-warning/10"
              delay={0.16}
            />
            <StatCard
              value={stats.upcomingEvents}
              label={t('calendar.events')}
              icon={<Calendar className="w-6 h-6 text-secondary-foreground dark:text-secondary-foreground" />}
              iconColor="bg-secondary dark:bg-secondary"
              gradient="bg-gradient-to-br from-secondary/40 to-transparent dark:from-secondary/30"
              delay={0.24}
            />
          </div>
        )}

        {/* Weekly study goal */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.28, ease: [0.33, 1, 0.68, 1] }}
        >
          <GoalWidget />
        </motion.div>

        {/* Recent Courses & Upcoming Events - Only for regular tenants (not main) */}
        {currentTenant?.slug !== 'main' && (
          <div className="grid lg:grid-cols-2 gap-4 sm:gap-6 w-full min-w-0">
            {/* Recommended For You */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.32, ease: [0.33, 1, 0.68, 1] }}
            >
              <RecommendedCourses />
            </motion.div>

            {/* Upcoming Events */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4, ease: [0.33, 1, 0.68, 1] }}
            >
            <Card className="overflow-hidden min-w-0 border-border/60 shadow-sm hover:shadow-md transition-shadow duration-300">
              <CardHeader className="p-5 sm:p-6 w-full min-w-0 overflow-hidden">
                <CardTitle className="flex items-center gap-2.5 text-lg sm:text-xl tracking-tight w-full min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-accent" />
                  </div>
                  <span className="truncate">{t('dashboard.upcomingEvents')}</span>
                </CardTitle>
                <CardDescription className="truncate mt-1">{t('dashboard.upcomingEventsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 p-5 pt-0 sm:p-6 sm:pt-0">
                {upcomingEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-3">
                      <Calendar className="w-8 h-8 text-accent/60" />
                    </div>
                    <p className="text-muted-foreground text-sm">{t('dashboard.noUpcomingEvents')}</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 w-full min-w-0 overflow-hidden">
                    {upcomingEvents.map((event) => {
                      const eventDate = new Date(event.start_time);
                      const dayName = eventDate.toLocaleDateString(dateLocaleString, { weekday: 'short' });
                      const dayNum = eventDate.getDate();
                      const month = eventDate.toLocaleDateString(dateLocaleString, { month: 'short' });
                      const time = eventDate.toLocaleTimeString(dateLocaleString, { hour: '2-digit', minute: '2-digit' });

                      return (
                        <div
                          key={event.id}
                          className="flex items-center gap-2 sm:gap-4 p-3 rounded-xl border border-border/50 hover:bg-accent/5 hover:border-accent/30 transition-all duration-200 cursor-pointer overflow-hidden w-full min-w-0 group"
                          onClick={() => {
                            setSelectedEvent(event);
                            setEventDetailOpen(true);
                          }}
                        >
                          <div className="flex flex-col items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-accent/15 to-accent/5 text-accent flex-shrink-0 group-hover:scale-105 transition-transform">
                            <span className="text-[10px] font-semibold uppercase tracking-wider">{dayName}</span>
                            <span className="text-xl font-bold leading-none">{dayNum}</span>
                            <span className="text-[9px] opacity-70 uppercase">{month}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{event.title}</p>
                            <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground w-full min-w-0">
                              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{time}</span>
                            </div>
                            {isAdmin && event.rsvp_count > 0 && (
                              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground w-full min-w-0">
                                <Users className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{event.rsvp_count} {t('calendar.participants')}</span>
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            className="h-8 text-xs flex-shrink-0"
                            variant={event.user_rsvped ? "secondary" : "default"}
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
                      );
                    })}
                  </div>
                )}
                <Button variant="outline" className="w-full mt-2" asChild>
                  <Link to="/calendar">
                    {t('dashboard.showCalendar')}
                    <ArrowIcon className="w-4 h-4 mx-2" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
            </motion.div>
          </div>
        )}

        {/* Streak + Achievements bento grid */}
        {currentTenant?.slug !== 'main' && (
          <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 w-full min-w-0">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.55, ease: [0.33, 1, 0.68, 1] }}
              className="lg:col-span-1"
            >
              <StreakIndicator />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.65, ease: [0.33, 1, 0.68, 1] }}
              className="lg:col-span-2"
            >
              <AchievementsGrid />
            </motion.div>
          </div>
        )}

        {/* Event Details Dialog */}
        <Dialog open={eventDetailOpen} onOpenChange={setEventDetailOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            {selectedEvent && (
              <>
                <DialogHeader className="flex-shrink-0">
                  <DialogTitle className="text-xl break-words leading-tight">{selectedEvent.title}</DialogTitle>
                  <DialogDescription>
                    {format(new Date(selectedEvent.start_time), longDateFormat, { locale: dateLocale })}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4 overflow-y-auto flex-1 min-h-0">
                  <div className="flex items-center gap-3 text-muted-foreground min-w-0">
                    <Clock className="w-5 h-5 flex-shrink-0" />
                    <span className="break-words">{formatEventTime(selectedEvent.start_time, selectedEvent.end_time)}</span>
                  </div>

                  {selectedEvent.location && (
                    <div className="flex items-start gap-3 text-muted-foreground min-w-0">
                      <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span className="break-words">{selectedEvent.location}</span>
                    </div>
                  )}

                  {selectedEvent.meeting_url && (
                    <div className="flex items-start gap-3 min-w-0">
                      <LinkIcon className="w-5 h-5 flex-shrink-0 text-muted-foreground mt-0.5" />
                      <a
                        href={selectedEvent.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 break-all min-w-0"
                      >
                        <span className="break-all">{t('calendar.joinMeeting')}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Users className="w-5 h-5 flex-shrink-0" />
                    <span>{selectedEvent.rsvp_count} {t('calendar.participants')}</span>
                  </div>

                  {cleanDescription(selectedEvent.description) && (
                    <div className="pt-4 border-t">
                      <p className="text-muted-foreground whitespace-pre-wrap break-words">{cleanDescription(selectedEvent.description)}</p>
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
                    onClick={() => handleRsvp(selectedEvent.id, selectedEvent.user_rsvped)}
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
      </div>
  );
}