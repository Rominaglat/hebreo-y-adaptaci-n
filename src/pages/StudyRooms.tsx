import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, 
  Plus, 
  Video, 
  Lock, 
  Globe, 
  Trash2,
  Loader2,
  Play,
  Shield,
  Radio,
  Copy,
  Check,
  Search,
  X,
  ArrowUpDown,
  Pencil
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useTenant } from '@/contexts/TenantContext';
import { useRooms, Room } from '@/hooks/useRooms';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import MeetingRoom from '@/components/MeetingRoom';
import PreJoinScreen, { type PreJoinResult } from '@/components/study-rooms/PreJoinScreen';

interface CourseLesson {
  id: string;
  title: string;
  video_url: string;
  course_title: string;
}

export default function StudyRooms() {
  const { user, profile, isAdmin, isAdminOrInstructor } = useAuth();
  const { t } = useLanguage();
  const { completeStep } = useOnboarding();

  // Auto-complete study_room step on visit
  useEffect(() => {
    completeStep('study_room');
  }, [completeStep]);
  const { toast } = useToast();
  const { rooms, loading, createRoom, updateRoom, deleteRoom } = useRooms();
  
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  // Two-phase entry: user picks a room → PreJoinScreen for device check →
  // MeetingRoom. `pendingRoom` is the staging slot between the two.
  const [pendingRoom, setPendingRoom] = useState<Room | null>(null);
  // Device/start-state choices captured in the pre-join lobby and handed to
  // the MeetingRoom so the call actually uses the selected camera/mic and
  // honors the camera-off / muted toggles.
  const [joinPrefs, setJoinPrefs] = useState<PreJoinResult | undefined>(undefined);
  // Invite-link handling: /study-rooms?room=<id> goes STRAIGHT to the lobby.
  const [searchParams, setSearchParams] = useSearchParams();
  const handledInviteRef = useRef(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [courseLessons, setCourseLessons] = useState<CourseLesson[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showLiveOnly, setShowLiveOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'participants'>('newest');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  const [newRoom, setNewRoom] = useState({
    name: '',
    description: '',
    category: 'study',
    is_locked: false,
    is_live: false,
    max_participants: 10
  });

  // Filter and sort rooms
  const filteredRooms = useMemo(() => {
    let result = rooms.filter(room => {
      const matchesSearch = searchQuery === '' || 
        room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        room.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        room.host_name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = selectedCategory === null || room.category === selectedCategory;
      const matchesLive = !showLiveOnly || room.is_live;
      
      return matchesSearch && matchesCategory && matchesLive;
    });

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      } else if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else {
        return (b.participants_count || 0) - (a.participants_count || 0);
      }
    });

    return result;
  }, [rooms, searchQuery, selectedCategory, showLiveOnly, sortBy]);
  // Fetch lessons with videos
  useEffect(() => {
    const fetchLessons = async () => {
      setLoadingLessons(true);
      const { data, error } = await supabase
        .from('lessons')
        .select(`
          id,
          title,
          video_url,
          modules!inner (
            courses!inner (
              id,
              title,
              is_published
            )
          )
        `)
        .not('video_url', 'is', null);

      if (!error && data) {
        const lessons = data
          .filter((lesson: any) => lesson.modules?.courses?.is_published)
          .map((lesson: any) => ({
            id: lesson.id,
            title: lesson.title,
            video_url: lesson.video_url,
            course_title: lesson.modules?.courses?.title || ''
          }));
        setCourseLessons(lessons);
      }
      setLoadingLessons(false);
    };
    fetchLessons();
  }, []);

  const CATEGORIES = [
    { value: 'general', label: t('studyRooms.categoryGeneral') },
    { value: 'study', label: t('studyRooms.categoryStudy') },
    { value: 'project', label: t('studyRooms.categoryProject') },
    { value: 'discussion', label: t('studyRooms.categoryDiscussion') },
  ];

  const handleCreateRoom = async () => {
    if (!user || !profile || !newRoom.name.trim()) return;

    setIsCreating(true);

    try {
      await createRoom({
        name: newRoom.name.trim(),
        description: newRoom.description.trim() || undefined,
        category: newRoom.category,
        is_locked: newRoom.is_locked,
        is_live: newRoom.is_live,
        max_participants: newRoom.max_participants,
        host_name: profile.full_name,
      });

      toast({
        title: t('studyRooms.roomCreated'),
        description: t('studyRooms.roomCreatedDesc'),
      });

      setNewRoom({ name: '', description: '', category: 'study', is_locked: false, is_live: false, max_participants: 10 });
      setDialogOpen(false);
    } catch (error) {
      console.error('Error creating room:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    try {
      await deleteRoom(roomId);

      toast({
        title: t('studyRooms.roomDeleted'),
        description: t('studyRooms.roomDeletedDesc'),
      });
    } catch (error) {
      console.error('Error deleting room:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    }
  };

  const handleJoinRoom = (room: Room) => {
    if (room.is_locked && room.host_id !== user?.id) {
      toast({
        title: t('studyRooms.roomLocked'),
        description: t('studyRooms.roomLockedDesc'),
        variant: 'destructive',
      });
      return;
    }
    // Send the user to PreJoinScreen first — they can confirm devices and
    // grant permissions BEFORE the WebRTC stack starts firing offers.
    setPendingRoom(room);
  };

  // Invite link: arriving at /study-rooms?room=<id> opens the lobby directly.
  // The link is the invitation, so this bypasses the public-list lock gate —
  // anyone with the link lands in the lobby for that room (incl. private rooms).
  useEffect(() => {
    if (handledInviteRef.current) return;
    const roomIdParam = searchParams.get('room');
    if (!roomIdParam || !user || !profile || loading) return;
    handledInviteRef.current = true;
    // Strip the param so a later leave/refresh doesn't re-open the lobby.
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('room');
    setSearchParams(nextParams, { replace: true });
    const room = rooms.find((r) => r.id === roomIdParam);
    if (room) {
      setPendingRoom(room);
    } else {
      toast({
        title: t('studyRooms.roomNotFoundTitle'),
        description: t('studyRooms.roomNotFoundDesc'),
        variant: 'destructive',
      });
    }
  }, [searchParams, user, profile, loading, rooms, setSearchParams, toast, t]);

  const handleLeaveRoom = () => {
    setActiveRoom(null);
    setPendingRoom(null);
  };

  const getCategoryLabel = (category: string) => {
    return CATEGORIES.find(c => c.value === category)?.label || category;
  };

  const handleCopyRoomLink = (room: Room) => {
    const roomLink = `${window.location.origin}/study-rooms?room=${room.id}`;
    navigator.clipboard.writeText(roomLink);
    setCopiedRoomId(room.id);
    toast({
      title: t('studyRoomsPage.linkCopied'),
      description: t('studyRoomsPage.linkCopiedDesc'),
    });
    setTimeout(() => setCopiedRoomId(null), 2000);
  };

  const handleEditRoom = (room: Room) => {
    setEditingRoom({ ...room });
    setEditDialogOpen(true);
  };

  const handleUpdateRoom = async () => {
    if (!editingRoom || !editingRoom.name.trim()) return;

    setIsEditing(true);
    try {
      await updateRoom(editingRoom.id, {
        name: editingRoom.name.trim(),
        description: editingRoom.description?.trim() || undefined,
        category: editingRoom.category,
        max_participants: editingRoom.max_participants,
        is_locked: editingRoom.is_locked,
        is_live: editingRoom.is_live,
      });

      toast({
        title: t('studyRoomsPage.roomUpdated'),
        description: t('studyRoomsPage.roomUpdatedDesc'),
      });

      setEditDialogOpen(false);
      setEditingRoom(null);
    } catch (error) {
      console.error('Error updating room:', error);
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setIsEditing(false);
    }
  };

  const canCopyRoomLink = (room: Room) => {
    // If room is open (not locked), everyone can copy
    if (!room.is_locked) return true;
    // If room is locked, only host can copy
    return room.host_id === user?.id;
  };

  // Pre-join: device check before we mount the actual meeting.
  if (pendingRoom && !activeRoom && user && profile) {
    return (
      <PreJoinScreen
        roomName={pendingRoom.name}
        onJoin={(prefs) => {
          setJoinPrefs(prefs);
          setActiveRoom(pendingRoom);
          setPendingRoom(null);
        }}
        onCancel={() => setPendingRoom(null)}
      />
    );
  }

  // Show meeting room when active
  if (activeRoom && user && profile) {
    return (
      <MeetingRoom
        room={activeRoom}
        onLeave={handleLeaveRoom}
        userId={user.id}
        userName={profile.full_name}
        devicePrefs={joinPrefs}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Premium Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-5 sm:p-7">
          <div className="absolute -top-12 -end-12 w-48 h-48 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -start-12 w-48 h-48 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('studyRooms.title')}</h1>
              <p className="text-muted-foreground mt-1.5">
                {t('studyRoomsPage.headerSubtitle')}
              </p>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all">
                  <Plus className="w-4 h-4 mx-2" />
                  {t('studyRooms.createRoom')}
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('studyRooms.createStudyRoom')}</DialogTitle>
                <DialogDescription>
                  {t('studyRooms.createRoomDesc')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="room-name">{t('studyRooms.roomName')}</Label>
                  <Input
                    id="room-name"
                    placeholder={t('studyRooms.roomNamePlaceholder')}
                    value={newRoom.name}
                    onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">{t('studyRooms.roomDescription')}</Label>
                  <Textarea
                    id="description"
                    placeholder={t('studyRooms.descriptionPlaceholder')}
                    value={newRoom.description}
                    onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">{t('studyRooms.category')}</Label>
                  <Select
                    value={newRoom.category}
                    onValueChange={(value) => setNewRoom({ ...newRoom, category: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-participants">{t('studyRooms.maxParticipants')}</Label>
                  <Input
                    id="max-participants"
                    type="number"
                    min={2}
                    max={50}
                    value={newRoom.max_participants}
                    onChange={(e) =>
                      setNewRoom({
                        ...newRoom,
                        // Clamp to a P2P-mesh-sane range so the absurd legacy
                        // 1000-cap rooms can't reappear (the number input's max
                        // is only a hint; users can still type past it).
                        max_participants: Math.min(50, Math.max(2, parseInt(e.target.value) || 10)),
                      })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="is-locked">{t('studyRooms.lockedRoom')}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t('studyRooms.lockedRoomDesc')}
                    </p>
                  </div>
                  <Switch
                    id="is-locked"
                    checked={newRoom.is_locked}
                    onCheckedChange={(checked) => setNewRoom({ ...newRoom, is_locked: checked })}
                  />
                </div>
                {isAdminOrInstructor && (
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="is-live" className="flex items-center gap-2">
                        <Radio className="w-4 h-4 text-red-500" />
                        {t('studyRooms.liveRoom')}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t('studyRooms.liveRoomDesc')}
                      </p>
                    </div>
                    <Switch
                      id="is-live"
                      checked={newRoom.is_live}
                      onCheckedChange={(checked) => setNewRoom({ ...newRoom, is_live: checked })}
                    />
                  </div>
                )}
                <Button 
                  className="w-full" 
                  onClick={handleCreateRoom}
                  disabled={!newRoom.name.trim() || isCreating}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                      {t('studyRooms.creating')}
                    </>
                  ) : (
                    t('studyRooms.createRoom')
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('studyRoomsPage.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(null)}
            >
              {t('studyRoomsPage.filterAll')}
            </Button>
            {CATEGORIES.map(cat => (
              <Button
                key={cat.value}
                variant={selectedCategory === cat.value ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.value)}
              >
                {cat.label}
              </Button>
            ))}
            <div className="w-px h-6 bg-border self-center mx-1" />
            <Button
              variant={showLiveOnly ? "destructive" : "outline"}
              size="sm"
              onClick={() => setShowLiveOnly(!showLiveOnly)}
              className="gap-1"
            >
              <Radio className="w-3 h-3" />
              {t('studyRooms.live')}
            </Button>
          </div>
        </div>

        {/* Sort options */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('studyRoomsPage.sortLabel')}</span>
          <div className="flex gap-1">
            <Button
              variant={sortBy === 'newest' ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSortBy('newest')}
            >
              {t('studyRoomsPage.sortNewest')}
            </Button>
            <Button
              variant={sortBy === 'oldest' ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSortBy('oldest')}
            >
              {t('studyRoomsPage.sortOldest')}
            </Button>
            <Button
              variant={sortBy === 'participants' ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSortBy('participants')}
            >
              {t('studyRoomsPage.sortParticipants')}
            </Button>
          </div>
        </div>

        {/* Rooms Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredRooms.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {rooms.length === 0 ? t('studyRooms.noRooms') : t('studyRoomsPage.noResults')}
              </h3>
              <p className="text-muted-foreground mb-4">
                {rooms.length === 0 ? t('studyRooms.noRoomsDesc') : t('studyRoomsPage.noResultsDesc')}
              </p>
              {rooms.length === 0 && (
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="w-4 h-4 mx-2" />
                  {t('studyRooms.createRoom')}
                </Button>
              )}
              {(searchQuery || selectedCategory || showLiveOnly) && (
                <Button 
                  variant="outline" 
                  onClick={() => { setSearchQuery(''); setSelectedCategory(null); setShowLiveOnly(false); }}
                >
                  {t('studyRoomsPage.clearFilters')}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRooms.map((room) => (
              <Card key={room.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{room.name}</CardTitle>
                      <CardDescription>
                        {t('studyRooms.host')}: {room.host_name}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {room.is_live && (
                        <Badge variant="destructive" className="animate-pulse">
                          <Radio className="w-3 h-3 mx-1" /> {t('studyRooms.live')}
                        </Badge>
                      )}
                      <Badge variant={room.is_locked ? "secondary" : "outline"}>
                        {room.is_locked ? (
                          <><Lock className="w-3 h-3 mx-1" /> {t('studyRooms.locked')}</>
                        ) : (
                          <><Globe className="w-3 h-3 mx-1" /> {t('studyRooms.open')}</>
                        )}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {getCategoryLabel(room.category)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {room.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {room.description}
                    </p>
                  )}
                  {/* Participants avatars */}
                  {room.participants && room.participants.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex -space-x-2 rtl:space-x-reverse">
                        {room.participants.slice(0, 5).map((participant, index) => (
                          <Avatar 
                            key={participant.id}
                            className="w-7 h-7 border-2 border-background"
                            style={{ zIndex: room.participants!.length - index }}
                          >
                            <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-medium">
                              {participant.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {room.participants.length > 5 && (
                          <Avatar className="w-7 h-7 border-2 border-background">
                            <AvatarFallback className="bg-muted text-muted-foreground text-[10px] font-medium">
                              +{room.participants.length - 5}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {room.participants_count || 0} / {room.max_participants} {t('studyRooms.participants')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="flex-1 min-w-0"
                      onClick={() => handleJoinRoom(room)}
                      disabled={
                        (room.participants_count !== undefined && room.participants_count >= room.max_participants) ||
                        (room.is_locked && room.host_id !== user?.id)
                      }
                    >
                      {room.is_locked && room.host_id !== user?.id ? (
                        <Lock className="w-4 h-4 mx-1 shrink-0" />
                      ) : (
                        <Video className="w-4 h-4 mx-1 shrink-0" />
                      )}
                      <span className="truncate">
                        {room.is_locked && room.host_id !== user?.id
                          ? t('studyRooms.locked')
                          : t('studyRooms.joinRoom')}
                      </span>
                    </Button>
                    <div className="flex items-center gap-1 shrink-0">
                      {canCopyRoomLink(room) && (
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => handleCopyRoomLink(room)}
                          title={t('studyRoomsPage.copyRoomLink')}
                        >
                          {copiedRoomId === room.id ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                      {room.host_id === user?.id && (
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => handleEditRoom(room)}
                          title={t('studyRoomsPage.editRoom')}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {(room.host_id === user?.id || isAdmin) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9" title={isAdmin && room.host_id !== user?.id ? t('studyRoomsPage.deleteAsAdmin') : undefined}>
                              {isAdmin && room.host_id !== user?.id ? (
                                <Shield className="w-4 h-4 text-destructive" />
                              ) : (
                                <Trash2 className="w-4 h-4 text-destructive" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('studyRooms.deleteRoom')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('studyRooms.deleteRoomDesc')}
                                {isAdmin && room.host_id !== user?.id && (
                                  <span className="block mt-2 text-destructive font-medium">
                                    {t('studyRoomsPage.deleteAsAdminNote')}
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row-reverse gap-2">
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteRoom(room.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      </div>

      {/* Edit Room Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('studyRoomsPage.editRoom')}</DialogTitle>
            <DialogDescription>
              {t('studyRoomsPage.editRoomDesc')}
            </DialogDescription>
          </DialogHeader>
          {editingRoom && (
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="edit-room-name">{t('studyRooms.roomName')}</Label>
                <Input
                  id="edit-room-name"
                  placeholder={t('studyRooms.roomNamePlaceholder')}
                  value={editingRoom.name}
                  onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">{t('studyRooms.roomDescription')}</Label>
                <Textarea
                  id="edit-description"
                  placeholder={t('studyRooms.descriptionPlaceholder')}
                  value={editingRoom.description || ''}
                  onChange={(e) => setEditingRoom({ ...editingRoom, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">{t('studyRooms.category')}</Label>
                <Select
                  value={editingRoom.category}
                  onValueChange={(value) => setEditingRoom({ ...editingRoom, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-max-participants">{t('studyRooms.maxParticipants')}</Label>
                <Input
                  id="edit-max-participants"
                  type="number"
                  min={2}
                  max={50}
                  value={editingRoom.max_participants}
                  onChange={(e) => setEditingRoom({ ...editingRoom, max_participants: Math.min(50, Math.max(2, parseInt(e.target.value) || 10)) })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="edit-is-locked">{t('studyRooms.lockedRoom')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('studyRooms.lockedRoomDesc')}
                  </p>
                </div>
                <Switch
                  id="edit-is-locked"
                  checked={editingRoom.is_locked}
                  onCheckedChange={(checked) => setEditingRoom({ ...editingRoom, is_locked: checked })}
                />
              </div>
              {isAdminOrInstructor && (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="edit-is-live" className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-red-500" />
                      {t('studyRooms.liveRoom')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('studyRooms.liveRoomDesc')}
                    </p>
                  </div>
                  <Switch
                    id="edit-is-live"
                    checked={editingRoom.is_live}
                    onCheckedChange={(checked) => setEditingRoom({ ...editingRoom, is_live: checked })}
                  />
                </div>
              )}
              <Button 
                className="w-full" 
                onClick={handleUpdateRoom}
                disabled={!editingRoom.name.trim() || isEditing}
              >
                {isEditing ? (
                  <>
                    <Loader2 className="w-4 h-4 mx-2 animate-spin" />
                    {t('studyRoomsPage.updating')}
                  </>
                ) : (
                  t('studyRoomsPage.updateRoom')
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}