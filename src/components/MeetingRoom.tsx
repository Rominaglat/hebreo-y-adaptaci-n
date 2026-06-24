import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Mic, MicOff, Video, VideoOff, Phone,
  MessageSquare, Users, Monitor, MonitorOff,
  Copy, Check, Play, X, Circle, Square, PenTool, Pencil,
  Hand, LayoutGrid, Maximize2, RotateCw, Loader2,
  UserX, Lock, Unlock, PhoneOff, Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebRTC } from "@/hooks/useWebRTC/index";
import type { DevicePrefs } from "@/hooks/useWebRTC/types";
import { useSyncedVideo } from "@/hooks/useSyncedVideo";
import { useWhiteboard } from "@/hooks/useWhiteboard";
import { useActiveSpeakers } from "@/hooks/useActiveSpeakers";
import { useRaisedHands } from "@/hooks/useRaisedHands";
import { useRoomModeration } from "@/hooks/useRoomModeration";
import { useMutedSpeakingHint } from "@/hooks/useMutedSpeakingHint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import VideoTile from "./VideoTile";
import SyncedVideoPlayer from "./SyncedVideoPlayer";
import RoomChat from "./RoomChat";
import WhiteboardOverlay from "./WhiteboardOverlay";
import VideoSelectDialog from "./meeting/VideoSelectDialog";
import { useToast } from "@/hooks/use-toast";
import { Room } from "@/hooks/useRooms";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
interface CourseLesson {
  id: string;
  title: string;
  video_url: string;
  course_id: string;
  course_title: string;
  order_index: number;
  module_title: string;
  module_order: number;
}

interface MeetingRoomProps {
  room: Room;
  onLeave: () => void;
  userId: string;
  userName: string;
  /** Device + start-state choices carried over from the pre-join lobby. */
  devicePrefs?: DevicePrefs;
}

const MeetingRoom = ({ room, onLeave, userId, userName, devicePrefs }: MeetingRoomProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [courseLessons, setCourseLessons] = useState<CourseLesson[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);

  // Editable display name — the user's name as visible to other participants.
  // Starts from the prop (pulled from the profile) but can be edited in-call.
  const [displayName, setDisplayName] = useState(userName);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [pendingName, setPendingName] = useState(userName);
  const [savingName, setSavingName] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Post-gain audio of the synced watch-party video, exposed by
  // SyncedVideoPlayer. Used by the recorder instead of createMediaElementSource
  // (the element's single source node is already claimed by the player).
  const syncedAudioStreamRef = useRef<MediaStream | null>(null);
  
  const isHost = room.host_id === userId;

  const {
    localStream,
    screenStream,
    remoteStreams,
    participants,
    isMuted,
    isVideoOn,
    isScreenSharing,
    connectionStatus,
    joinError,
    toggleMute,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    joinRoom,
    leaveRoom,
  } = useWebRTC({
    roomId: room.id,
    localUserId: userId,
    localUserName: displayName,
    devicePrefs,
  });

  // Surface a join failure (locked room, room full, RLS deny) and bounce
  // the user back to the lobby with a toast instead of leaving them staring
  // at a blank meeting screen. The underlying error detail is included so
  // the user (and we) can see WHY an "unknown" error actually fired.
  useEffect(() => {
    if (!joinError) return;
    const titles: Record<string, string> = {
      room_full: t('meetingRoom.joinErrorRoomFullTitle'),
      room_locked: t('meetingRoom.joinErrorRoomLockedTitle'),
      unknown: t('meetingRoom.joinErrorUnknownTitle'),
    };
    const descriptions: Record<string, string> = {
      room_full: t('meetingRoom.joinErrorRoomFullDesc'),
      room_locked: t('meetingRoom.joinErrorRoomLockedDesc'),
      unknown: t('meetingRoom.joinErrorUnknownDesc'),
    };
    const baseDescription = descriptions[joinError.kind] ?? descriptions.unknown;
    const description = joinError.detail
      ? `${baseDescription}\n${t('meetingRoom.errorDetailsPrefix')}: ${joinError.detail}`
      : baseDescription;
    toast({
      title: titles[joinError.kind] ?? titles.unknown,
      description,
      variant: "destructive",
    });
    onLeave();
  }, [joinError, toast, onLeave]);

  // Leave-confirmation dialog. Always confirm before leaving — short
  // friction beats accidentally ending a call. Host has an extra warning.
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // Active speakers (audio-level driven, broadcast over realtime).
  const activeSpeakers = useActiveSpeakers({
    roomId: room.id,
    localUserId: userId,
    localStream,
    isMuted,
  });

  // Remember the most recent REMOTE speaker for the Speaker layout's big tile.
  // Ignores our own voice so we don't spotlight ourselves while others listen.
  useEffect(() => {
    const remoteSpeaker = participants.find(
      (p) => p.user_id !== userId && activeSpeakers.has(p.user_id),
    );
    if (remoteSpeaker) setActiveSpeakerSpotlight(remoteSpeaker.user_id);
  }, [activeSpeakers, participants, userId]);

  // "You're muted but talking" hint.
  const mutedSpeaking = useMutedSpeakingHint({ localStream, isMuted });

  // Raised hands (broadcast-only, ephemeral).
  const { raisedHands, isLocalRaised, raiseHand, lowerHand, lowerAllHands } = useRaisedHands({
    roomId: room.id,
    localUserId: userId,
  });

  // Unread chat counter — increments while the chat panel is closed.
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (showChat) {
      setUnreadCount(0);
      return;
    }
    const channel = supabase
      .channel(`unread-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const msg = payload.new as { user_id?: string } | null;
          if (msg && msg.user_id !== userId) {
            setUnreadCount((c) => c + 1);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room.id, userId, showChat]);

  // Layout mode — defaults to "grid" (everyone equal). A shared video forces
  // spotlight regardless; for screen share / active-speaker the user opts into
  // "speaker" via the toggle. Defaulting to grid avoids surprising people with
  // a stuck "expanded" view they can't escape.
  const [viewMode, setViewMode] = useState<"grid" | "speaker">("grid");
  // Pinned participant — overrides active-speaker selection in speaker view.
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  // Active-speaker spotlight: remember the most recent remote speaker so the
  // "Speaker" layout keeps a stable large tile through the natural gaps
  // between utterances (Google Meet keeps the last speaker on stage).
  const [activeSpeakerSpotlight, setActiveSpeakerSpotlight] = useState<string | null>(null);

  // Audio output (speaker) selection — applied to remote tiles via setSinkId.
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState<string>('default');
  useEffect(() => {
    const supportsSink = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';
    if (!supportsSink || !navigator.mediaDevices?.enumerateDevices) return;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
      } catch {
        /* ignore — fall back to the default speaker */
      }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, []);

  // Single source of truth for layout switching between mobile sheet and
  // desktop aside so RoomChat doesn't mount in both places at once (which
  // caused chat subscriptions to fight each other).
  const isMobile = useIsMobile();

  // Track the room's is_recording + is_locked flags in real time so every
  // participant sees the recording banner and the lock state live.
  const [roomIsRecording, setRoomIsRecording] = useState<boolean>(!!room.is_recording);
  const [roomLocked, setRoomLocked] = useState<boolean>(!!room.is_locked);
  useEffect(() => {
    setRoomIsRecording(!!room.is_recording);
    setRoomLocked(!!room.is_locked);
    const channel = supabase
      .channel(`room-state-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const next = payload.new as { is_recording?: boolean | null; is_locked?: boolean | null };
          setRoomIsRecording(!!next.is_recording);
          setRoomLocked(!!next.is_locked);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room.id, room.is_recording, room.is_locked]);

  const {
    sharedVideoUrl,
    videoState,
    videoRef,
    updateSharedVideo,
    updateVideoState,
    handlePlay,
    handlePause,
    handleSeek,
  } = useSyncedVideo({
    roomId: room.id,
    userId,
    userName,
    isHost,
  });

  const {
    strokes,
    cursors,
    isDrawingEnabled,
    pendingRequests,
    approvedUsers,
    addStroke,
    updateStroke,
    broadcastCursor,
    clearBoard,
    requestDrawAccess,
    approveDrawAccess,
    revokeDrawAccess,
  } = useWhiteboard({
    roomId: room.id,
    userId,
    userName,
    isHost,
  });

  // Tracks whether the component is still mounted — guards the lesson fetch
  // setState calls so React doesn't warn when the user leaves mid-fetch.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    joinRoom();

    // Fetch lessons with videos - only from enrolled courses
    const fetchLessons = async () => {
      if (!mountedRef.current) return;
      setLoadingLessons(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mountedRef.current) {
        if (mountedRef.current) setLoadingLessons(false);
        return;
      }

      const { data: enrollments } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('user_id', user.id);

      const enrolledCourseIds = enrollments?.map(e => e.course_id) || [];
      
      // Check if user is admin or instructor
      const { data: userRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();
      
      const isAdminOrInstructor = userRole?.role === 'admin' || userRole?.role === 'instructor';

      const { data, error } = await supabase
        .from('lessons')
        .select(`
          id,
          title,
          video_url,
          order_index,
          modules!inner (
            id,
            title,
            order_index,
            courses!inner (
              id,
              title,
              is_published
            )
          )
        `)
        .not('video_url', 'is', null)
        .order('order_index', { ascending: true });

      if (!error && data && mountedRef.current) {
        const lessons = data
          .filter((lesson: any) => {
            const courseId = lesson.modules?.courses?.id;
            const isPublished = lesson.modules?.courses?.is_published;
            // Show if admin/instructor OR if enrolled in the course
            return isPublished && (isAdminOrInstructor || enrolledCourseIds.includes(courseId));
          })
          .map((lesson: any) => ({
            id: lesson.id,
            title: lesson.title,
            video_url: lesson.video_url,
            course_id: lesson.modules?.courses?.id || '',
            course_title: lesson.modules?.courses?.title || '',
            order_index: lesson.order_index || 0,
            module_title: lesson.modules?.title || '',
            module_order: lesson.modules?.order_index || 0,
          }));
        setCourseLessons(lessons);
      }
      if (mountedRef.current) setLoadingLessons(false);
    };
    fetchLessons();

    return () => {
      mountedRef.current = false;
      // Stop recording first — once the MediaRecorder ends, onstop fires and
      // the chunks get flushed to a Blob URL the user can save. If we tear
      // down before stopping, the chunks are lost.
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.requestData();
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.warn('[MeetingRoom] Failed to stop recorder on unmount:', err);
        }
        // Clear the public is_recording flag so the consent banner doesn't stay
        // stuck ON for everyone when the host closes the tab / navigates away
        // mid-recording (the normal stopRecording path is bypassed on a raw
        // unmount). Best-effort fire-and-forget.
        if (isHost) {
          supabase.from('rooms')
            .update({ is_recording: false })
            .eq('id', room.id)
            .then(({ error }) => {
              if (error) console.warn('[MeetingRoom] Failed to clear is_recording on unmount:', error);
            });
        }
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      leaveRoom();
    };
  }, []);

  const performLeave = async () => {
    if (isRecording) {
      stopRecording();
    }
    // Reset transient dialog/panel state so a rejoin starts clean. Without
    // this, the user comes back to a half-open chat sidebar or a stuck
    // dialog from the previous session.
    setConfirmLeaveOpen(false);
    setNameDialogOpen(false);
    setVideoDialogOpen(false);
    setShowChat(false);
    setShowParticipants(false);
    setShowWhiteboard(false);
    await leaveRoom();
    onLeave();
  };

  const handleLeave = () => {
    setConfirmLeaveOpen(true);
  };

  // Host moderation — force-mute / remove / end-for-all. Every client listens;
  // only the host invokes the action helpers (gated in the UI).
  const { muteParticipant, removeParticipant, endCallForAll } = useRoomModeration({
    roomId: room.id,
    localUserId: userId,
    onForceMute: () => {
      if (!isMuted) toggleMute();
      toast({
        title: t('meetingRoom.mutedByHostTitle'),
        description: t('meetingRoom.mutedByHostDesc'),
      });
    },
    onKicked: () => {
      toast({
        title: t('meetingRoom.removedByHostTitle'),
        description: t('meetingRoom.removedByHostDesc'),
        variant: 'destructive',
      });
      performLeave();
    },
    onEndCall: () => {
      // The host doesn't receive their own broadcast, so this only fires for
      // other participants.
      toast({
        title: t('meetingRoom.callEndedByHostTitle'),
        description: t('meetingRoom.callEndedByHostDesc'),
      });
      performLeave();
    },
  });

  // Host ends the call for everyone: tell the room, then leave ourselves.
  const handleEndForAll = () => {
    endCallForAll();
    performLeave();
  };

  // Host toggles the room lock (blocks new non-host joins).
  const toggleRoomLock = async () => {
    const next = !roomLocked;
    setRoomLocked(next);
    const { error } = await supabase
      .from('rooms')
      .update({ is_locked: next })
      .eq('id', room.id);
    if (error) {
      setRoomLocked(!next);
      toast({
        title: t('common.error'),
        description: t('meetingRoom.lockErrorDesc'),
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: next ? t('meetingRoom.roomLockedTitle') : t('meetingRoom.roomUnlockedTitle'),
    });
  };

  // Keyboard shortcuts. Use document.activeElement so the check works even
  // when an input is wrapped (shadcn's Input renders <input>, but other
  // surfaces — textareas, contenteditable rich-text fields — must also opt
  // out so the user doesn't mute themselves by typing "m" in chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable
        ) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "v":
          e.preventDefault();
          toggleVideo();
          break;
        case "c":
          e.preventDefault();
          setShowChat((s) => !s);
          break;
        case "escape":
          setConfirmLeaveOpen((open) => !open);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute, toggleVideo]);

  const stopRecording = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    setIsRecording(false);
    setRecordingTime(0);

    // Clear the public flag so other participants stop seeing the banner.
    if (isHost) {
      supabase.from('rooms')
        .update({ is_recording: false })
        .eq('id', room.id)
        .then(({ error }) => {
          if (error) console.warn('[MeetingRoom] Failed to clear is_recording:', error);
        });
    }
  }, [isHost, room.id]);

  const startRecording = useCallback(async () => {
    try {
      // YouTube/Vimeo embeds are cross-origin iframes — the browser will
      // not let us draw them to a canvas. Warn the user up front so they
      // don't expect the synced video to appear in the file.
      const hasIframeVideo = !!document.querySelector('main iframe');
      if (hasIframeVideo) {
        toast({
          title: t('meetingRoom.recordingWarningTitle'),
          description: t('meetingRoom.recordingWarningDesc'),
          duration: 6000,
        });
      }

      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;
      canvasRef.current = canvas;

      const audioContext = new AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();
      audioContextRef.current = audioContext;
      audioDestinationRef.current = audioDestination;

      if (localStream) {
        const localAudioTracks = localStream.getAudioTracks();
        if (localAudioTracks.length > 0) {
          const localAudioStream = new MediaStream(localAudioTracks);
          const source = audioContext.createMediaStreamSource(localAudioStream);
          source.connect(audioDestination);
        }
      }

      remoteStreams.forEach((stream) => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const audioStream = new MediaStream(audioTracks);
          const source = audioContext.createMediaStreamSource(audioStream);
          source.connect(audioDestination);
        }
      });

      // Mix in the synced watch-party video's audio. We must NOT call
      // createMediaElementSource on the <video> — SyncedVideoPlayer already
      // claimed the element's single source node for its gain, and a second
      // call throws (which is why this audio used to silently vanish from
      // recordings). Instead consume the post-gain MediaStream the player
      // exposes via onAudioStreamReady. createMediaStreamSource may be called
      // freely, so re-recording works too.
      const syncedAudio = syncedAudioStreamRef.current;
      if (syncedAudio && syncedAudio.getAudioTracks().length > 0) {
        try {
          const source = audioContext.createMediaStreamSource(
            new MediaStream(syncedAudio.getAudioTracks()),
          );
          source.connect(audioDestination);
        } catch (err) {
          console.warn('[recording] failed to wire synced-video audio:', err);
        }
      }

      const drawFrame = () => {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grab every <video> in the document. Accept BOTH MediaStream
        // sources (cameras / screen share) AND URL-backed sources (the
        // synced video player for direct .mp4 files) — the previous
        // `v.srcObject &&` filter silently dropped the synced video.
        const allVideos = Array.from(document.querySelectorAll('video')).filter(
          (v) => (v.srcObject || v.currentSrc) && v.readyState >= 2 && v.videoWidth > 0,
        );
        // Deduplicate so the same source isn't drawn twice (e.g. the
        // spotlight primary and a thumbnail of the same stream).
        const seenKeys = new Set<unknown>();
        const videos: HTMLVideoElement[] = [];
        for (const v of allVideos) {
          const key = v.srcObject ?? v.currentSrc;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          videos.push(v);
        }

        if (videos.length === 0) {
          ctx.fillStyle = '#2d2d44';
          ctx.font = 'bold 48px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(t('meetingRoom.noActiveVideo'), canvas.width / 2, canvas.height / 2);
          animationFrameRef.current = requestAnimationFrame(drawFrame);
          return;
        }

        // Split into primary (synced video or screen share) and cameras.
        // The synced direct-video player wins over a screen share for the
        // big slot — that matches "if a video is playing, the video is
        // the focus". Cameras stack on the right.
        const primary =
          videos.find((v) => v.dataset.syncedVideo === 'true') ??
          videos.find((v) => v.dataset.screenShare === 'true');
        const cameras = primary ? videos.filter((v) => v !== primary) : videos;
        const padding = 12;
        const radius = 12;

        const drawVideo = (
          video: HTMLVideoElement,
          x: number,
          y: number,
          w: number,
          h: number,
          fit: 'cover' | 'contain',
        ) => {
          ctx.fillStyle = '#2d2d44';
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, radius);
          ctx.fill();
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, radius);
          ctx.clip();

          const videoRatio = video.videoWidth / video.videoHeight;
          const cellRatio = w / h;
          let drawWidth = w;
          let drawHeight = h;
          let drawX = x;
          let drawY = y;

          if (fit === 'cover') {
            if (videoRatio > cellRatio) {
              drawWidth = h * videoRatio;
              drawX = x - (drawWidth - w) / 2;
            } else {
              drawHeight = w / videoRatio;
              drawY = y - (drawHeight - h) / 2;
            }
          } else {
            // contain — letterbox to preserve the entire frame.
            if (videoRatio > cellRatio) {
              drawHeight = w / videoRatio;
              drawY = y + (h - drawHeight) / 2;
            } else {
              drawWidth = h * videoRatio;
              drawX = x + (w - drawWidth) / 2;
            }
          }

          ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
          ctx.restore();
        };

        if (primary) {
          // Primary fills ~78% of the width on the left; cameras stack on the right.
          const primaryW = Math.floor(canvas.width * 0.78) - padding * 2;
          const primaryH = canvas.height - padding * 2;
          drawVideo(primary, padding, padding, primaryW, primaryH, 'contain');

          const sidebarX = Math.floor(canvas.width * 0.78);
          const sidebarW = canvas.width - sidebarX - padding;
          const camCount = Math.max(1, cameras.length);
          const camH = Math.floor((canvas.height - padding * (camCount + 1)) / camCount);
          cameras.forEach((cam, idx) => {
            const camY = padding + idx * (camH + padding);
            drawVideo(cam, sidebarX, camY, sidebarW, camH, 'cover');
          });
        } else {
          // No screen share — even grid of cameras.
          const count = cameras.length;
          const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
          const rows = Math.ceil(count / cols);
          const cellWidth = canvas.width / cols;
          const cellHeight = canvas.height / rows;
          cameras.forEach((video, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const x = col * cellWidth + padding;
            const y = row * cellHeight + padding;
            const w = cellWidth - padding * 2;
            const h = cellHeight - padding * 2;
            drawVideo(video, x, y, w, h, 'cover');
          });
        }

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(canvas.width - 30, 30, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('REC', canvas.width - 50, 36);

        animationFrameRef.current = requestAnimationFrame(drawFrame);
      };

      drawFrame();

      const canvasStream = canvas.captureStream(30);
      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ];
      const combinedStream = new MediaStream(combinedTracks);

      let mimeType = 'video/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=h264,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp9,opus';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
          }
        }
      }

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 8000000,
      });

      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        const isMP4 = mimeType.includes('mp4');
        const extension = isMP4 ? 'mp4' : 'webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t('meetingRoom.recordingFilePrefix')}-${room.name}-${new Date().toISOString().slice(0, 10)}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        combinedStream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
          // Null the refs so a second recording starts from a clean slate
          // instead of reusing a closed context.
          audioContextRef.current = null;
          audioDestinationRef.current = null;
        }

        toast({
          title: t('meetingRoom.recordingDownloadedTitle'),
          description: `${t('meetingRoom.recordingDownloadedDesc')} (${extension.toUpperCase()})`,
          duration: 3000,
        });
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Publish the recording state to all participants — they see a banner
      // at the top of the room. Privacy + consent: people need to know.
      supabase.from('rooms')
        .update({ is_recording: true })
        .eq('id', room.id)
        .then(({ error }) => {
          if (error) console.warn('[MeetingRoom] Failed to set is_recording:', error);
        });

      toast({
        title: t('meetingRoom.recordingStartedTitle'),
        description: t('meetingRoom.recordingStartedDesc'),
        duration: 3000,
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      // Tear down the canvas draw loop + AudioContext if we threw after wiring
      // them up (e.g. MediaRecorder construction failed) — otherwise the rAF
      // loop and audio graph leak until the page is closed.
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
        audioDestinationRef.current = null;
      }
      toast({
        title: t('meetingRoom.recordingErrorTitle'),
        description: t('meetingRoom.recordingErrorDesc'),
        variant: "destructive",
        duration: 4000,
      });
    }
  }, [room.name, toast, localStream, remoteStreams, stopRecording, t]);

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const copyRoomLink = () => {
    // Clean canonical invite link (the in-call URL may already carry a query).
    navigator.clipboard.writeText(`${window.location.origin}/study-rooms?room=${room.id}`);
    setCopied(true);
    toast({
      title: t('meetingRoom.linkCopiedTitle'),
      description: t('meetingRoom.linkCopiedDesc'),
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectVideo = (videoUrl: string, lessonTitle: string) => {
    updateSharedVideo(videoUrl);
    setVideoDialogOpen(false);
    toast({
      title: t('meetingRoom.videoSelectedTitle'),
      description: `${t('meetingRoom.videoSelectedDesc')}: ${lessonTitle}`,
    });
  };

  const openNameDialog = () => {
    setPendingName(displayName);
    setNameDialogOpen(true);
  };

  const saveDisplayName = async () => {
    const trimmed = pendingName.trim();
    if (!trimmed || trimmed === displayName) {
      setNameDialogOpen(false);
      return;
    }
    setSavingName(true);
    const { error } = await supabase
      .from('room_participants')
      .update({ user_name: trimmed })
      .eq('room_id', room.id)
      .eq('user_id', userId);
    setSavingName(false);
    if (error) {
      toast({
        title: t('common.error'),
        description: t('meetingRoom.nameUpdateErrorDesc'),
        variant: 'destructive',
      });
      return;
    }
    setDisplayName(trimmed);
    setNameDialogOpen(false);
    toast({ title: t('meetingRoom.nameUpdatedTitle') });
  };

  const screenSharer = participants.find(p => p.is_screen_sharing && p.user_id !== userId);

  // What counts as "primary content" — content that should dominate the
  // layout. When primary content is active AND viewMode is "speaker", we
  // render the spotlight layout: primary fills the main area, participant
  // cameras shrink to a thumbnail strip along the bottom.
  type PrimaryKind = "shared-video" | "local-screen" | "remote-screen" | null;
  const primaryKind: PrimaryKind = sharedVideoUrl
    ? "shared-video"
    : isScreenSharing && screenStream
    ? "local-screen"
    : screenSharer
    ? "remote-screen"
    : null;
  // A pin only counts if that participant is still in the room.
  const pinnedValid =
    pinnedUserId && participants.some((p) => p.user_id === pinnedUserId)
      ? pinnedUserId
      : null;

  // Whom to spotlight as the big tile when NO screen share / shared video is
  // on stage. A pin always wins (even in grid view — "pin to spotlight").
  // Otherwise, in Speaker view we follow the active speaker (falling back to
  // the first remote participant so the stage is never empty).
  const spotlightUserId: string | null =
    primaryKind !== null
      ? null
      : pinnedValid
      ? pinnedValid
      : viewMode === "speaker"
      ? activeSpeakerSpotlight &&
        participants.some((p) => p.user_id === activeSpeakerSpotlight)
        ? activeSpeakerSpotlight
        : participants.find((p) => p.user_id !== userId)?.user_id ?? null
      : null;

  // Shared video has no sensible grid representation (it's an iframe), so
  // it always uses spotlight. Screen-share is "tile-able" so the toggle
  // applies there. A pinned/active-speaker participant also drives spotlight.
  const spotlight =
    primaryKind === "shared-video" ||
    (primaryKind !== null && viewMode === "speaker") ||
    spotlightUserId !== null;

  // The participant object to render in the big spotlight slot (may be self).
  const spotlightParticipant = spotlightUserId
    ? participants.find((p) => p.user_id === spotlightUserId) ?? null
    : null;


  // Calculate grid layout - count all participants
  const remoteParticipantsCount = participants.filter(p => p.user_id !== userId).length;
  const totalTiles = 1 + remoteParticipantsCount + (isScreenSharing ? 1 : 0);
  const getGridClass = () => {
    if (sharedVideoUrl) {
      // With shared video, show smaller video tiles
      if (totalTiles === 1) return "grid-cols-1";
      if (totalTiles === 2) return "grid-cols-2";
      return "grid-cols-2 sm:grid-cols-3";
    }
    // Without shared video
    if (totalTiles === 1) return "grid-cols-1";
    if (totalTiles === 2) return "grid-cols-1 sm:grid-cols-2";
    if (totalTiles <= 4) return "grid-cols-2";
    return "grid-cols-2 sm:grid-cols-3";
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <header className="glass h-12 sm:h-14 px-2 sm:px-4 flex items-center justify-between border-b border-border shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <Video className="w-3 h-3 sm:w-4 sm:h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground text-xs sm:text-sm truncate">{room.name}</h2>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{participants.length} {t('meetingRoom.participantsCount')}</p>
          </div>
        </div>
        <Button 
          variant="glass" 
          size="sm" 
          className="gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
          onClick={copyRoomLink}
        >
          {copied ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
          <span className="hidden sm:inline">{t('meetingRoom.inviteOthers')}</span>
        </Button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="flex-1 p-2 sm:p-4 flex flex-col gap-2 sm:gap-3 overflow-hidden relative">

          {spotlight ? (
            <>
              {/* Spotlight: primary content fills the main area. */}
              <div className="flex-1 min-h-0 bg-black rounded-xl overflow-hidden relative">
                {primaryKind === "shared-video" && sharedVideoUrl && (
                  <SyncedVideoPlayer
                    videoUrl={sharedVideoUrl}
                    videoRef={videoRef}
                    videoState={videoState}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onSeek={handleSeek}
                    onClose={() => updateSharedVideo(null)}
                    canClose={isHost}
                    canControl={isHost}
                    onReportState={updateVideoState}
                    onAudioStreamReady={(s) => { syncedAudioStreamRef.current = s; }}
                  />
                )}
                {primaryKind === "local-screen" && screenStream && (
                  <VideoTile
                    stream={screenStream}
                    name={`${displayName} — ${t('meetingRoom.screenShareLabel')}`}
                    isMuted={true}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLocal={true}
                    isLarge={true}
                  />
                )}
                {primaryKind === "remote-screen" && screenSharer && (
                  <VideoTile
                    stream={remoteStreams.get(screenSharer.user_id) || null}
                    name={`${screenSharer.user_name || t('meetingRoom.participant')} — ${t('meetingRoom.screenShareLabel')}`}
                    isMuted={screenSharer.is_muted || false}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLarge={true}
                    outputDeviceId={outputDeviceId}
                  />
                )}
                {/* Pinned / active-speaker participant spotlight (no screen
                    share or shared video active). Click the big tile to unpin
                    and return to auto / active-speaker follow. */}
                {primaryKind === null && spotlightParticipant && (
                  <div
                    className="w-full h-full cursor-pointer"
                    onClick={() => setPinnedUserId(null)}
                    title={t('meetingRoom.unpinParticipant')}
                  >
                    <VideoTile
                      stream={
                        spotlightParticipant.user_id === userId
                          ? localStream
                          : remoteStreams.get(spotlightParticipant.user_id) || null
                      }
                      name={
                        spotlightParticipant.user_id === userId
                          ? displayName
                          : spotlightParticipant.user_name || t('meetingRoom.participant')
                      }
                      isMuted={
                        spotlightParticipant.user_id === userId
                          ? isMuted
                          : spotlightParticipant.is_muted || false
                      }
                      isVideoOn={
                        spotlightParticipant.user_id === userId
                          ? isVideoOn
                          : spotlightParticipant.is_video_on !== false
                      }
                      isScreenSharing={false}
                      isLocal={spotlightParticipant.user_id === userId}
                      isLarge={true}
                      isSpeaking={activeSpeakers.has(spotlightParticipant.user_id)}
                      isHandRaised={raisedHands.has(spotlightParticipant.user_id)}
                      isHost={spotlightParticipant.user_id === room.host_id}
                      outputDeviceId={outputDeviceId}
                    />
                  </div>
                )}
                {showWhiteboard && (
                  <WhiteboardOverlay
                    strokes={strokes}
                    cursors={cursors}
                    isDrawingEnabled={isDrawingEnabled}
                    isHost={isHost}
                    pendingRequests={pendingRequests}
                    approvedUsers={approvedUsers}
                    onAddStroke={addStroke}
                    onUpdateStroke={updateStroke}
                    onCursorMove={broadcastCursor}
                    onClearBoard={clearBoard}
                    onRequestAccess={requestDrawAccess}
                    onApproveAccess={approveDrawAccess}
                    onRevokeAccess={revokeDrawAccess}
                    onClose={() => setShowWhiteboard(false)}
                    userId={userId}
                    userName={userName}
                  />
                )}
              </div>

              {/* Thumbnail strip — horizontal scroll of every participant
                  except whoever is currently in the big spotlight slot. */}
              <div className="shrink-0 flex gap-2 overflow-x-auto pb-1 h-24 sm:h-32">
                {spotlightUserId !== userId && (
                  <div className="w-32 sm:w-44 shrink-0 h-full">
                    <VideoTile
                      stream={localStream}
                      name={displayName}
                      isMuted={isMuted}
                      isVideoOn={isVideoOn}
                      isScreenSharing={false}
                      isLocal={true}
                      isSpeaking={activeSpeakers.has(userId)}
                      isHandRaised={raisedHands.has(userId)}
                      isHost={isHost}
                    />
                  </div>
                )}
                {participants
                  .filter(p =>
                    p.user_id !== userId &&
                    p.user_id !== spotlightUserId &&
                    // When a remote peer is the big screen-share tile, don't
                    // also render them in the strip — that would mount a second
                    // <audio> sink for the same peer and play them twice.
                    !(primaryKind === "remote-screen" && p.user_id === screenSharer?.user_id)
                  )
                  .map((participant) => {
                    const stream = remoteStreams.get(participant.user_id);
                    return (
                      <div
                        key={participant.user_id}
                        className="w-32 sm:w-44 shrink-0 h-full cursor-pointer"
                        onClick={() =>
                          setPinnedUserId((prev) =>
                            prev === participant.user_id ? null : participant.user_id,
                          )
                        }
                        title={pinnedUserId === participant.user_id ? t('meetingRoom.unpinParticipant') : t('meetingRoom.pinParticipant')}
                      >
                        <VideoTile
                          stream={stream || null}
                          name={participant.user_name || t('meetingRoom.participant')}
                          isMuted={participant.is_muted || false}
                          isVideoOn={participant.is_video_on !== false}
                          isScreenSharing={false}
                          isSpeaking={activeSpeakers.has(participant.user_id)}
                          isHandRaised={raisedHands.has(participant.user_id)}
                          isHost={participant.user_id === room.host_id}
                          outputDeviceId={outputDeviceId}
                        />
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <>
              {/* Grid mode — every participant gets equal real estate. If
                  there's a screen share active, it's included as a tile
                  alongside the cameras. */}
              <div className={cn(
                "grid gap-2 sm:gap-4 flex-1 min-h-0 auto-rows-fr relative",
                getGridClass()
              )}>
                {primaryKind === "local-screen" && screenStream && (
                  <VideoTile
                    stream={screenStream}
                    name={`${displayName} — ${t('meetingRoom.screenShareLabel')}`}
                    isMuted={true}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLocal={true}
                    isLarge={true}
                  />
                )}
                {primaryKind === "remote-screen" && screenSharer && (
                  <VideoTile
                    stream={remoteStreams.get(screenSharer.user_id) || null}
                    name={`${screenSharer.user_name || t('meetingRoom.participant')} — ${t('meetingRoom.screenShareLabel')}`}
                    isMuted={screenSharer.is_muted || false}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLarge={true}
                    outputDeviceId={outputDeviceId}
                  />
                )}

                <VideoTile
                  stream={localStream}
                  name={displayName}
                  isMuted={isMuted}
                  isVideoOn={isVideoOn}
                  isScreenSharing={false}
                  isLocal={true}
                  isLarge={primaryKind === null && remoteStreams.size === 0 && participants.length <= 1}
                  isSpeaking={activeSpeakers.has(userId)}
                  isHandRaised={raisedHands.has(userId)}
                  isHost={isHost}
                />

                {participants
                  .filter(p =>
                    p.user_id !== userId &&
                    // The screen-sharer is already the big tile above; skip
                    // their grid tile so we don't double up video + audio.
                    !(primaryKind === "remote-screen" && p.user_id === screenSharer?.user_id)
                  )
                  .map((participant) => {
                    const stream = remoteStreams.get(participant.user_id);
                    return (
                      <div
                        key={participant.user_id}
                        className="relative cursor-pointer"
                        onClick={() => {
                          setPinnedUserId((prev) =>
                            prev === participant.user_id ? null : participant.user_id,
                          );
                        }}
                        title={pinnedUserId === participant.user_id ? t('meetingRoom.unpinParticipant') : t('meetingRoom.pinParticipant')}
                      >
                        <VideoTile
                          stream={stream || null}
                          name={participant.user_name || t('meetingRoom.participant')}
                          isMuted={participant.is_muted || false}
                          isVideoOn={participant.is_video_on !== false}
                          isScreenSharing={false}
                          isSpeaking={activeSpeakers.has(participant.user_id)}
                          isHandRaised={raisedHands.has(participant.user_id)}
                          isHost={participant.user_id === room.host_id}
                          outputDeviceId={outputDeviceId}
                        />
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </main>

        {/* Desktop side panel — mounted ONLY on non-mobile so RoomChat doesn't
            run two subscriptions (it was mounted here AND in the mobile sheet
            simultaneously, which was scrambling messages). */}
        {(showChat || showParticipants) && !isMobile && (
          <aside className="flex w-72 lg:w-80 glass border-r border-border flex-col shrink-0">
            <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-sm">
                {showChat ? t('meetingRoom.chat') : t('meetingRoom.participants')}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                onClick={() => { setShowChat(false); setShowParticipants(false); }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            {/* Chat takes the full panel height; the wrapper provides its
                own scroll. Without this isolation, the outer `overflow-y-auto`
                would scroll the input out of view as messages stacked up. */}
            {showChat && (
              <div className="flex-1 min-h-0 flex flex-col">
                <RoomChat
                  roomId={room.id}
                  userId={userId}
                  userName={displayName}
                />
              </div>
            )}
            {showParticipants && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
                {isHost && (
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-1.5 text-xs"
                      onClick={toggleRoomLock}
                    >
                      {roomLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      {roomLocked ? t('meetingRoom.unlockRoom') : t('meetingRoom.lockRoom')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1 gap-1.5 text-xs"
                      onClick={handleEndForAll}
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      {t('meetingRoom.endForAll')}
                    </Button>
                  </div>
                )}
                <div className="space-y-2">
                  {participants.map((p) => {
                    const isSelf = p.user_id === userId;
                    const isParticipantHost = p.user_id === room.host_id;
                    return (
                      <div key={p.id} className="flex items-center gap-2 sm:gap-3 p-2 rounded-lg hover:bg-secondary/50">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full gradient-primary flex items-center justify-center text-xs sm:text-sm font-bold text-primary-foreground shrink-0">
                          {p.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                            {p.user_name}
                            {isSelf && ` (${t('meetingRoom.youSuffix')})`}
                            {isParticipantHost && (
                              <span className="ms-1.5 text-[10px] text-amber-500 font-semibold">{t('meetingRoom.hostBadge')}</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                            {p.is_screen_sharing && (
                              <span className="flex items-center gap-1 text-primary">
                                <Monitor className="w-3 h-3" /> {t('meetingRoom.sharingScreen')}
                              </span>
                            )}
                            {raisedHands.has(p.user_id) && (
                              <span className="flex items-center gap-1 text-amber-500">
                                <Hand className="w-3 h-3" /> {t('meetingRoom.handRaised')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isSelf && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={openNameDialog}
                              title={t('meetingRoom.editName')}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Host moderation actions for other participants. */}
                          {isHost && !isSelf && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => muteParticipant(p.user_id)}
                                disabled={p.is_muted}
                                title={t('meetingRoom.muteParticipant')}
                              >
                                <MicOff className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => removeParticipant(p.user_id)}
                                title={t('meetingRoom.removeParticipant')}
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {p.is_muted ? (
                            <MicOff className="w-3 h-3 sm:w-4 sm:h-4 text-destructive" />
                          ) : (
                            <Mic className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                          )}
                          {p.is_video_on ? (
                            <Video className="w-3 h-3 sm:w-4 sm:h-4 text-green-500" />
                          ) : (
                            <VideoOff className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Mobile: chat + participants render as a bottom sheet. Gated on
          isMobile so the desktop aside (above) and this sheet are never both
          in the DOM with the chat child mounted twice. */}
      <Sheet
        open={(showChat || showParticipants) && isMobile}
        onOpenChange={(open) => {
          if (!open) {
            setShowChat(false);
            setShowParticipants(false);
          }
        }}
      >
        <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle>{showChat ? t('meetingRoom.chat') : t('meetingRoom.participants')}</SheetTitle>
          </SheetHeader>
          {/* Chat takes full sheet body; participants get their own scroll. */}
          {showChat && (
            <div className="flex-1 min-h-0 flex flex-col">
              <RoomChat roomId={room.id} userId={userId} userName={displayName} />
            </div>
          )}
          {showParticipants && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {isHost && (
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={toggleRoomLock}
                  >
                    {roomLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {roomLocked ? t('meetingRoom.unlockRoom') : t('meetingRoom.lockRoom')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={handleEndForAll}
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    {t('meetingRoom.endForAll')}
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {participants.map((p) => {
                  const isSelf = p.user_id === userId;
                  const isParticipantHost = p.user_id === room.host_id;
                  return (
                    <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50">
                      <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                        {p.user_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {p.user_name}
                          {isSelf && ` (${t('meetingRoom.youSuffix')})`}
                          {isParticipantHost && (
                            <span className="ms-1.5 text-[10px] text-amber-500 font-semibold">{t('meetingRoom.hostBadge')}</span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {p.is_screen_sharing && (
                            <span className="flex items-center gap-1 text-primary">
                              <Monitor className="w-3 h-3" /> {t('meetingRoom.sharingScreen')}
                            </span>
                          )}
                          {raisedHands.has(p.user_id) && (
                            <span className="flex items-center gap-1 text-amber-500">
                              <Hand className="w-3 h-3" /> {t('meetingRoom.handRaised')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isHost && !isSelf && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => muteParticipant(p.user_id)}
                              disabled={p.is_muted}
                              title={t('meetingRoom.muteParticipant')}
                            >
                              <MicOff className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeParticipant(p.user_id)}
                              title={t('meetingRoom.removeParticipant')}
                            >
                              <UserX className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {p.is_muted ? <MicOff className="w-4 h-4 text-destructive" /> : <Mic className="w-4 h-4 text-green-500" />}
                        {p.is_video_on ? <Video className="w-4 h-4 text-green-500" /> : <VideoOff className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Controls - mobile optimized */}
      <footer className="glass h-16 sm:h-20 px-2 sm:px-4 flex items-center justify-center border-t border-border shrink-0">
        <TooltipProvider delayDuration={400}>
        <div className="flex items-center gap-1.5 sm:gap-3 overflow-x-auto max-w-full px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isMuted ? "destructive" : "glass"}
                size="icon"
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                onClick={toggleMute}
                aria-label={isMuted ? t('meetingRoom.unmute') : t('meetingRoom.mute')}
              >
                {isMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isMuted ? `${t('meetingRoom.unmute')} (M)` : `${t('meetingRoom.mute')} (M)`}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={!isVideoOn ? "destructive" : "glass"}
                size="icon"
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                onClick={toggleVideo}
                aria-label={isVideoOn ? t('meetingRoom.cameraOff') : t('meetingRoom.cameraOn')}
              >
                {isVideoOn ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isVideoOn ? `${t('meetingRoom.cameraOff')} (V)` : `${t('meetingRoom.cameraOn')} (V)`}</TooltipContent>
          </Tooltip>

          {/* Raise hand — broadcast-only, anyone can do it. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isLocalRaised ? "default" : "glass"}
                size="icon"
                className={cn(
                  "w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0",
                  isLocalRaised && "bg-amber-400 hover:bg-amber-500 text-amber-950",
                )}
                onClick={isLocalRaised ? lowerHand : raiseHand}
                aria-label={isLocalRaised ? t('meetingRoom.lowerHand') : t('meetingRoom.raiseHand')}
              >
                <Hand className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isLocalRaised ? t('meetingRoom.lowerHand') : t('meetingRoom.raiseHand')}</TooltipContent>
          </Tooltip>

          {/* View mode toggle — meaningful whenever there's something to
              spotlight: primary content (shared video / screen share) OR at
              least one remote participant (Speaker view follows the talker). */}
          {(primaryKind !== null || remoteParticipantsCount >= 1) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="glass"
                  size="icon"
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                  onClick={() => {
                    // Any view switch clears the pin so the grid is always
                    // reachable (a pin used to override the toggle and trap the
                    // user in spotlight).
                    setPinnedUserId(null);
                    setViewMode((m) => (m === "grid" ? "speaker" : "grid"));
                  }}
                  aria-label={t('meetingRoom.switchView')}
                >
                  {viewMode === "grid" ? (
                    <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <LayoutGrid className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "grid" ? t('meetingRoom.spotlightView') : t('meetingRoom.gridView')}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Screen share - hidden on mobile */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isScreenSharing ? "default" : "glass"}
                size="icon"
                className="hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                aria-label={isScreenSharing ? t('meetingRoom.stopScreenShare') : t('meetingRoom.startScreenShare')}
              >
                {isScreenSharing ? <MonitorOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Monitor className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isScreenSharing ? t('meetingRoom.stopScreenShare') : t('meetingRoom.startScreenShare')}</TooltipContent>
          </Tooltip>

          {/* Speaker (audio output) selector — only when the browser supports
              setSinkId and more than one output device exists. */}
          {audioOutputs.length > 1 && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="glass"
                      size="icon"
                      className="hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                      aria-label={t('meetingRoom.speakerLabel')}
                    >
                      <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('meetingRoom.speakerLabel')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center" className="max-w-[260px]">
                <DropdownMenuLabel>{t('meetingRoom.speakerLabel')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={outputDeviceId} onValueChange={setOutputDeviceId}>
                  {audioOutputs.map((d) => (
                    <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId} className="truncate">
                      {d.label || `${t('meetingRoom.speakerLabel')} ${d.deviceId.slice(0, 6)}`}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Recording button - only for host, hidden on mobile */}
          {isHost && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isRecording ? "destructive" : "glass"}
                  size="icon"
                  className={cn("hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full relative shrink-0", isRecording && "animate-pulse")}
                  onClick={isRecording ? stopRecording : startRecording}
                  aria-label={isRecording ? t('meetingRoom.stopRecording') : t('meetingRoom.startRecording')}
                >
                  {isRecording ? (
                    <>
                      <Square className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span className="absolute -top-1 -right-1 text-[10px] bg-destructive text-white px-1 rounded">
                        {formatRecordingTime(recordingTime)}
                      </span>
                    </>
                  ) : (
                    <Circle className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRecording ? t('meetingRoom.stopRecording') : t('meetingRoom.startRecording')}</TooltipContent>
            </Tooltip>
          )}

          {/* Whiteboard button - when sharing video or screen */}
          {(sharedVideoUrl || isScreenSharing || screenSharer) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showWhiteboard ? "default" : "glass"}
                  size="icon"
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                  onClick={() => setShowWhiteboard(!showWhiteboard)}
                  aria-label={showWhiteboard ? t('meetingRoom.closeWhiteboard') : t('meetingRoom.openWhiteboard')}
                >
                  <PenTool className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showWhiteboard ? t('meetingRoom.closeWhiteboard') : t('meetingRoom.openWhiteboard')}</TooltipContent>
            </Tooltip>
          )}

          {/* Watch course video together — host only (only the host can pick
              and drive the shared video; non-hosts just follow). */}
          {isHost && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={sharedVideoUrl ? "default" : "glass"}
                  size="icon"
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                  onClick={() => setVideoDialogOpen(true)}
                  aria-label={t('meetingRoom.watchCourseVideo')}
                >
                  <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('meetingRoom.watchCourseVideoTogether')}</TooltipContent>
            </Tooltip>
          )}
          {isHost && (
            <VideoSelectDialog
              open={videoDialogOpen}
              onOpenChange={setVideoDialogOpen}
              lessons={courseLessons}
              loading={loadingLessons}
              onSelectVideo={handleSelectVideo}
            />
          )}

          {/* Chat — desktop opens the side aside; mobile opens the bottom sheet.
              Unread badge on the icon when new messages arrive while panel is closed. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="glass"
                size="icon"
                className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0 relative", showChat && "bg-primary text-primary-foreground")}
                onClick={() => { setShowChat(!showChat); setShowParticipants(false); }}
                aria-label={t('meetingRoom.chat')}
              >
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                {unreadCount > 0 && !showChat && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center"
                    aria-label={`${unreadCount} ${t('meetingRoom.newMessagesA11y')}`}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`${t('meetingRoom.chat')} (C)`}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="glass"
                size="icon"
                className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0 relative", showParticipants && "bg-primary text-primary-foreground")}
                onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); }}
                aria-label={t('meetingRoom.participants')}
              >
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                {raisedHands.size > 0 && !showParticipants && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold flex items-center justify-center">
                    <Hand className="w-3 h-3" />
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('meetingRoom.participants')}</TooltipContent>
          </Tooltip>

          <div className="w-px h-6 sm:h-8 bg-border mx-1 sm:mx-2 shrink-0" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                className="h-10 sm:h-12 px-3 sm:px-6 rounded-full gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
                onClick={handleLeave}
                aria-label={t('meetingRoom.leaveRoom')}
              >
                <Phone className="w-4 h-4 sm:w-5 sm:h-5 rotate-[135deg]" />
                <span className="hidden xs:inline">{t('meetingRoom.leave')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`${t('meetingRoom.leaveRoom')} (Esc)`}</TooltipContent>
          </Tooltip>
        </div>
        </TooltipProvider>
      </footer>

      {/* Recording privacy banner — visible to all participants the moment
          the host hits record. Consent matters. */}
      {roomIsRecording && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-40 rounded-full px-4 py-2 text-sm font-medium shadow-lg bg-destructive text-destructive-foreground flex items-center gap-2"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
          </span>
          {t('meetingRoom.callRecording')}
        </div>
      )}

      {/* "You're muted but talking" nudge — Google Meet parity. Detected from
          a live clone of the mic so it works even while the real track is
          disabled. Sits just above the controls. */}
      {mutedSpeaking && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 rounded-full px-4 py-2 text-sm font-medium shadow-lg flex items-center gap-2 bg-foreground text-background"
        >
          <MicOff className="w-4 h-4" />
          <span>{t('meetingRoom.mutedHintTitle')} — {t('meetingRoom.mutedHintDesc')}</span>
        </div>
      )}

      {/* Connection-failed banner — only the failure state is surfaced as
          an overlay because it requires user action. The transient
          "connecting" state used to be shown here too, but it sat on top
          of the synced-video player's title bar and blocked controls; the
          local video tile appearing is sufficient feedback that we're
          live. Positioned bottom-center so it doesn't fight with the
          video header even when it does fire. */}
      {connectionStatus === "failed" && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-full px-4 py-2 text-sm font-medium shadow-lg flex items-center gap-2 bg-red-500 text-white">
          <span>{t('meetingRoom.connectionFailed')}</span>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-3 text-xs gap-1.5"
            onClick={async () => {
              await leaveRoom();
              await joinRoom();
            }}
          >
            <RotateCw className="w-3 h-3" />
            {t('meetingRoom.reconnect')}
          </Button>
        </div>
      )}

      {/* Leave-confirmation dialog. */}
      <Dialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('meetingRoom.leaveRoom')}</DialogTitle>
            <DialogDescription>
              {isHost
                ? t('meetingRoom.leaveAsHostDesc')
                : t('meetingRoom.leaveConfirmDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmLeaveOpen(false);
                performLeave();
              }}
            >
              {t('meetingRoom.leaveAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('meetingRoom.editYourName')}</DialogTitle>
            <DialogDescription>
              {t('meetingRoom.editYourNameDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="display-name">{t('meetingRoom.nameLabel')}</Label>
            <Input
              id="display-name"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder={t('meetingRoom.namePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveDisplayName();
              }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNameDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={saveDisplayName}
              disabled={!pendingName.trim() || savingName}
            >
              {savingName ? t('meetingRoom.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeetingRoom;
