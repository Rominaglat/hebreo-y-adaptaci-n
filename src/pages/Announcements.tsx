import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Megaphone, 
  Plus, 
  Pin,
  Calendar,
  User,
  Loader2,
  Trash2,
  Bell,
  BellOff,
  Send,
  Pencil
} from 'lucide-react';
import { format } from 'date-fns';
import { he, enUS, es } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface Announcement {
  id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
}

interface SubscribedUser {
  user_id: string;
  full_name: string;
  email: string;
}

export default function Announcements() {
  const { user, isAdmin, isAdminOrInstructor } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const { isSupported, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();
  const navigate = useNavigate();
  
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    content: '',
    is_pinned: false
  });

  const [subscribedUsers, setSubscribedUsers] = useState<SubscribedUser[]>([]);
  const [selectedTestUser, setSelectedTestUser] = useState<string>('');
  const [isSendingTest, setIsSendingTest] = useState(false);

  useEffect(() => {
    fetchAnnouncements();
    fetchSubscribedUsers();

    const channel = supabase
      .channel('announcements-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => fetchAnnouncements()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchAnnouncements = async () => {
    try {
      // Fetch announcements first
      const { data: announcementsData, error } = await supabase
        .from('announcements')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (announcementsData && announcementsData.length > 0) {
        // Get unique author IDs
        const authorIds = [...new Set(announcementsData.map(a => a.author_id).filter(Boolean))];

        // Fetch author profile data (single source of truth post tenant_memberships drop)
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', authorIds);

        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

        setAnnouncements(
          announcementsData.map(a => {
            const profile = profileMap.get(a.author_id);
            return {
              ...a,
              author_name: profile?.full_name || t('profile.admin'),
              author_avatar: profile?.avatar_url || null
            };
          })
        );
      } else {
        setAnnouncements([]);
      }
    } catch (error) {
      console.error('Error fetching announcements:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubscribedUsers = async () => {
    try {
      // Get all subscribed users
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('user_id');

      if (subError) throw subError;

      if (subscriptions && subscriptions.length > 0) {
        const userIds = [...new Set(subscriptions.map(s => s.user_id))];

        // Fetch profile data (single source of truth post tenant_memberships drop)
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);

        if (profilesError) throw profilesError;

        setSubscribedUsers(
          profiles?.map(p => ({
            user_id: p.id,
            full_name: p.full_name,
            email: p.email
          })) || []
        );
      }
    } catch (error) {
      console.error('Error fetching subscribed users:', error);
    }
  };

  const handleSendTestNotification = async () => {
    if (!selectedTestUser || !newAnnouncement.title.trim() || !newAnnouncement.content.trim()) return;

    setIsSendingTest(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          title: `🧪 ${newAnnouncement.title.trim()}`,
          body: newAnnouncement.content.trim().substring(0, 100) + (newAnnouncement.content.length > 100 ? '...' : ''),
          url: '/announcements',
          userId: selectedTestUser,
        },
      });

      if (error) throw error;

      const sent = Number((data as any)?.sent ?? 0);
      const failed = Number((data as any)?.failed ?? 0);

      if (sent > 0) {
        const failedSuffix = failed ? t('announcementsPage.testFailedSuffix').replace('{failed}', String(failed)) : '';
        toast({
          title: t('announcementsPage.testSent'),
          description: t('announcementsPage.testSentDesc')
            .replace('{sent}', String(sent))
            .replace('{failedSuffix}', failedSuffix),
        });
      } else if (failed > 0) {
        toast({
          title: t('announcementsPage.sendFailed'),
          description: t('announcementsPage.sendFailedDesc').replace('{failed}', String(failed)),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('announcementsPage.noSubscriptions'),
          description: t('announcementsPage.noSubscriptionsDesc'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast({
        title: t('common.error'),
        description: t('announcementsPage.testSendError'),
        variant: 'destructive',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!user || !newAnnouncement.title.trim() || !newAnnouncement.content.trim()) return;

    setIsCreating(true);

    try {
      const { error } = await supabase
        .from('announcements')
        .insert({
          title: newAnnouncement.title.trim(),
          content: newAnnouncement.content.trim(),
          is_pinned: newAnnouncement.is_pinned,
          author_id: user.id,
        });

      if (error) throw error;

      // Send push notification to all subscribers
      try {
        const { data: pushData, error: pushError } = await supabase.functions.invoke('send-push-notification', {
          body: {
            title: newAnnouncement.title.trim(),
            body: newAnnouncement.content.trim().substring(0, 100) + (newAnnouncement.content.length > 100 ? '...' : ''),
            url: '/announcements',
          },
        });

        if (pushError) throw pushError;

        const sent = Number((pushData as any)?.sent ?? 0);
        const failed = Number((pushData as any)?.failed ?? 0);

        if (sent === 0) {
          // Show a soft warning only if nothing was actually sent.
          toast({
            title: t('announcementsPage.publishedNoPush'),
            description: t('announcementsPage.publishedNoPushDesc')
              .replace('{sent}', String(sent))
              .replace('{failed}', String(failed)),
            variant: 'destructive',
          });
        }
      } catch (pushError) {
        console.error('Error sending push notification:', pushError);
        toast({
          title: t('announcementsPage.publishedPushFailed'),
          description: t('announcementsPage.publishedPushFailedDesc'),
          variant: 'destructive',
        });
      }

      toast({
        title: t('announcements.published'),
        description: t('announcements.publishedDesc'),
      });

      setNewAnnouncement({ title: '', content: '', is_pinned: false });
      setDialogOpen(false);
      fetchAnnouncements();
    } catch (error) {
      console.error('Error creating announcement:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    try {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: t('announcements.deleted'),
        description: t('announcements.deletedDesc'),
      });

      fetchAnnouncements();
    } catch (error) {
      console.error('Error deleting announcement:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    }
  };

  const handleEditAnnouncement = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setNewAnnouncement({
      title: announcement.title,
      content: announcement.content,
      is_pinned: announcement.is_pinned
    });
    setDialogOpen(true);
  };

  const handleUpdateAnnouncement = async () => {
    if (!editingAnnouncement || !newAnnouncement.title.trim() || !newAnnouncement.content.trim()) return;

    setIsCreating(true);

    try {
      const { error } = await supabase
        .from('announcements')
        .update({
          title: newAnnouncement.title.trim(),
          content: newAnnouncement.content.trim(),
          is_pinned: newAnnouncement.is_pinned,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingAnnouncement.id);

      if (error) throw error;

      toast({
        title: t('announcementsPage.updated'),
        description: t('announcementsPage.updatedDesc'),
      });

      setNewAnnouncement({ title: '', content: '', is_pinned: false });
      setEditingAnnouncement(null);
      setDialogOpen(false);
      fetchAnnouncements();
    } catch (error) {
      console.error('Error updating announcement:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCloseDialog = (open: boolean) => {
    if (!open) {
      setDialogOpen(false);
      setEditingAnnouncement(null);
      setNewAnnouncement({ title: '', content: '', is_pinned: false });
    } else {
      setDialogOpen(true);
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('announcements.title')}</h1>
              <p className="text-muted-foreground mt-1.5">
                {t('announcementsPage.headerSubtitle')}
              </p>
            </div>

            <div className="flex items-center gap-2">
            {isSubscribed ? (
              <Button
                variant="outline"
                onClick={unsubscribe}
                disabled={pushLoading}
              >
                {pushLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <BellOff className="w-4 h-4 mx-2" />
                    {t('announcementsPage.disableNotifications')}
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => navigate('/install')}
              >
                <Bell className="w-4 h-4 mx-2" />
                {t('notifications.enable')}
              </Button>
            )}
            
            {isAdminOrInstructor && (
              <>
                <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mx-2" />
                      {t('announcements.publishAnnouncement')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>
                        {editingAnnouncement
                          ? t('announcementsPage.editAnnouncement')
                          : t('announcements.newAnnouncement')
                        }
                      </DialogTitle>
                      <DialogDescription>
                        {editingAnnouncement
                          ? t('announcementsPage.editAnnouncementDesc')
                          : t('announcements.newAnnouncementDesc')
                        }
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="title">{t('announcements.announcementTitle')}</Label>
                        <Input
                          id="title"
                          placeholder={t('announcements.titlePlaceholder')}
                          value={newAnnouncement.title}
                          onChange={(e) => setNewAnnouncement({ ...newAnnouncement, title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="content">{t('announcements.content')}</Label>
                        <Textarea
                          id="content"
                          placeholder={t('announcements.contentPlaceholder')}
                          className="min-h-[150px]"
                          value={newAnnouncement.content}
                          onChange={(e) => setNewAnnouncement({ ...newAnnouncement, content: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="pin">{t('announcements.pinAnnouncement')}</Label>
                          <p className="text-sm text-muted-foreground">
                            {t('announcements.pinAnnouncementDesc')}
                          </p>
                        </div>
                        <Switch
                          id="pin"
                          checked={newAnnouncement.is_pinned}
                          onCheckedChange={(checked) => setNewAnnouncement({ ...newAnnouncement, is_pinned: checked })}
                        />
                      </div>

                      {/* Test Notification Section - only for new announcements */}
                      {!editingAnnouncement && subscribedUsers.length > 0 && (
                        <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
                          <Label className="text-sm font-medium">
                            {t('announcementsPage.sendTestToUser')}
                          </Label>
                          <div className="flex gap-2">
                            <Select value={selectedTestUser} onValueChange={setSelectedTestUser}>
                              <SelectTrigger className="flex-1">
                                <SelectValue placeholder={t('announcementsPage.selectUserPlaceholder')} />
                              </SelectTrigger>
                              <SelectContent>
                                {subscribedUsers.map((user) => (
                                  <SelectItem key={user.user_id} value={user.user_id}>
                                    {user.full_name} ({user.email})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleSendTestNotification}
                              disabled={!selectedTestUser || !newAnnouncement.title.trim() || !newAnnouncement.content.trim() || isSendingTest}
                            >
                              {isSendingTest ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Send className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('announcementsPage.sendTestHint')}
                          </p>
                        </div>
                      )}

                      <Button 
                        className="w-full" 
                        onClick={editingAnnouncement ? handleUpdateAnnouncement : handleCreateAnnouncement}
                        disabled={!newAnnouncement.title.trim() || !newAnnouncement.content.trim() || isCreating}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                            {editingAnnouncement
                              ? t('announcementsPage.updating')
                              : t('announcements.publishing')
                            }
                          </>
                        ) : (
                          editingAnnouncement
                            ? t('announcementsPage.updateAnnouncement')
                            : t('announcements.publish')
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </div>

        {/* Announcements List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <Megaphone className="w-10 h-10 text-primary/50" />
              </div>
              <h3 className="text-lg font-medium mb-2">{t('announcements.noAnnouncements')}</h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                {t('announcements.noAnnouncementsDesc')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {announcements.map((announcement) => (
              <Card
                key={announcement.id}
                className={cn(
                  "transition-all duration-300 ease-out-cubic border-border/60 overflow-hidden",
                  announcement.is_pinned
                    ? "border-primary/40 bg-gradient-to-br from-primary/[0.04] via-card to-accent/[0.03] shadow-sm"
                    : "hover:shadow-md hover:border-border"
                )}
              >
                {announcement.is_pinned && (
                  <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Avatar className="w-11 h-11 ring-2 ring-background shadow-sm flex-shrink-0">
                        <AvatarImage src={announcement.author_avatar || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-primary font-semibold">
                          {getInitials(announcement.author_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-lg tracking-tight">{announcement.title}</CardTitle>
                          {announcement.is_pinned && (
                            <Badge className="text-xs bg-primary/15 text-primary border-primary/30 hover:bg-primary/20">
                              <Pin className="w-3 h-3 mx-1" />
                              {t('announcements.pinned')}
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="flex items-center gap-1 font-medium">
                            <User className="w-3 h-3" />
                            {announcement.author_name}
                          </span>
                          <span className="text-border">•</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(announcement.created_at), language === 'he' ? 'd בMMMM yyyy' : 'd MMMM yyyy', { locale: language === 'he' ? he : language === 'es' ? es : enUS })}
                          </span>
                        </CardDescription>
                      </div>
                    </div>
                    
                    {isAdminOrInstructor && (
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-muted-foreground hover:text-primary"
                          onClick={() => handleEditAnnouncement(announcement)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('announcements.deleteAnnouncement')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('announcements.deleteAnnouncementDesc')}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row-reverse gap-2">
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteAnnouncement(announcement.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground whitespace-pre-wrap">{announcement.content}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}