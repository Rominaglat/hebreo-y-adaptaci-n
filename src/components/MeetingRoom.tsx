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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebRTC } from "@/hooks/useWebRTC/index";
import { useSyncedVideo } from "@/hooks/useSyncedVideo";
import { useWhiteboard } from "@/hooks/useWhiteboard";
import { useActiveSpeakers } from "@/hooks/useActiveSpeakers";
import { useRaisedHands } from "@/hooks/useRaisedHands";
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
}

const MeetingRoom = ({ room, onLeave, userId, userName }: MeetingRoomProps) => {
  const { toast } = useToast();
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
  });

  // Surface a join failure (locked room, room full, RLS deny) and bounce
  // the user back to the lobby with a toast instead of leaving them staring
  // at a blank meeting screen. The underlying error detail is included so
  // the user (and we) can see WHY an "unknown" error actually fired.
  useEffect(() => {
    if (!joinError) return;
    const titles: Record<string, string> = {
      room_full: "החדר מלא",
      room_locked: "החדר נעול",
      unknown: "כניסה לחדר נכשלה",
    };
    const descriptions: Record<string, string> = {
      room_full: "החדר הזה הגיע למספר המשתתפים המרבי. אפשר לנסות מאוחר יותר.",
      room_locked: "החדר נעול על ידי המארח. ניתן להיכנס רק כשהמארח פותח אותו.",
      unknown: "אירעה שגיאה בכניסה לחדר.",
    };
    const baseDescription = descriptions[joinError.kind] ?? descriptions.unknown;
    const description = joinError.detail
      ? `${baseDescription}\nפרטים: ${joinError.detail}`
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

  // Layout mode — defaults to "speaker" so shared video / screen share
  // automatically dominates the layout (the user's stated preference).
  // The toggle button lets the user override to a flat grid.
  const [viewMode, setViewMode] = useState<"grid" | "speaker">("speaker");
  // Pinned participant — overrides active-speaker selection in speaker view.
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);

  // Single source of truth for layout switching between mobile sheet and
  // desktop aside so RoomChat doesn't mount in both places at once (which
  // caused chat subscriptions to fight each other).
  const isMobile = useIsMobile();

  // Track the room's is_recording flag in real time so non-host participants
  // see the privacy banner the moment the host starts/stops recording.
  const [roomIsRecording, setRoomIsRecording] = useState<boolean>(!!room.is_recording);
  useEffect(() => {
    setRoomIsRecording(!!room.is_recording);
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
          const next = payload.new as { is_recording?: boolean | null };
          setRoomIsRecording(!!next.is_recording);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room.id, room.is_recording]);

  const {
    sharedVideoUrl,
    videoState,
    videoRef,
    updateSharedVideo,
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
          title: "התראה לפני הקלטה",
          description:
            "סרטוני YouTube ו-Vimeo לא ייכללו בקובץ ההקלטה מסיבות אבטחה של הדפדפן. כדי להקליט סרטון, יש להשתמש בקובץ ישיר (.mp4).",
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

      // Capture the direct synced-video player's audio too. createMedia-
      // ElementSource reroutes the element's output through our context,
      // so we MUST also connect to the default destination — otherwise the
      // user stops hearing the video while recording.
      const syncedVideoEl = document.querySelector<HTMLVideoElement>(
        'video[data-synced-video="true"]',
      );
      if (syncedVideoEl) {
        try {
          const source = audioContext.createMediaElementSource(syncedVideoEl);
          source.connect(audioDestination);
          source.connect(audioContext.destination);
        } catch (err) {
          // createMediaElementSource can only be called once per element.
          // If the user re-records the same video, just skip — the prior
          // source is still wired.
          console.warn('[recording] synced-video audio already wired:', err);
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
          ctx.fillText('אין וידאו פעיל', canvas.width / 2, canvas.height / 2);
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
        a.download = `הקלטה-${room.name}-${new Date().toISOString().slice(0, 10)}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        combinedStream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
        
        toast({
          title: "ההקלטה הורדה!",
          description: `קובץ ההקלטה נשמר במחשב שלך (${extension.toUpperCase()})`,
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
        title: "ההקלטה התחילה",
        description: "מקליט את כל הוידאו בחדר",
        duration: 3000,
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: "שגיאה בהקלטה",
        description: "לא ניתן להתחיל את ההקלטה",
        variant: "destructive",
        duration: 4000,
      });
    }
  }, [room.name, toast, localStream, remoteStreams, stopRecording]);

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href + '?room=' + room.id);
    setCopied(true);
    toast({
      title: "הקישור הועתק!",
      description: "שתף את הקישור עם אחרים להזמנה לחדר",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectVideo = (videoUrl: string, lessonTitle: string) => {
    updateSharedVideo(videoUrl);
    setVideoDialogOpen(false);
    toast({
      title: "סרטון נבחר",
      description: `כעת צופים ב: ${lessonTitle}`,
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
        title: 'שגיאה',
        description: 'לא ניתן לעדכן את השם. יש לנסות שוב.',
        variant: 'destructive',
      });
      return;
    }
    setDisplayName(trimmed);
    setNameDialogOpen(false);
    toast({ title: 'השם עודכן' });
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
  // Shared video has no sensible grid representation (it's an iframe), so
  // it always uses spotlight. Screen-share is "tile-able" so the toggle
  // applies there.
  const spotlight =
    primaryKind === "shared-video" ||
    (primaryKind !== null && viewMode === "speaker");


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
            <p className="text-[10px] sm:text-xs text-muted-foreground">{participants.length} משתתפים</p>
          </div>
        </div>
        <Button 
          variant="glass" 
          size="sm" 
          className="gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
          onClick={copyRoomLink}
        >
          {copied ? <Check className="w-3 h-3 sm:w-4 sm:h-4" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
          <span className="hidden sm:inline">הזמנת אחרים</span>
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
                  />
                )}
                {primaryKind === "local-screen" && screenStream && (
                  <VideoTile
                    stream={screenStream}
                    name={`${displayName} — שיתוף מסך`}
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
                    name={`${screenSharer.user_name || 'משתתף'} — שיתוף מסך`}
                    isMuted={screenSharer.is_muted || false}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLarge={true}
                  />
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

              {/* Thumbnail strip — horizontal scroll of every participant. */}
              <div className="shrink-0 flex gap-2 overflow-x-auto pb-1 h-24 sm:h-32">
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
                {participants
                  .filter(p => p.user_id !== userId)
                  .map((participant) => {
                    const stream = remoteStreams.get(participant.user_id);
                    return (
                      <div key={participant.user_id} className="w-32 sm:w-44 shrink-0 h-full">
                        <VideoTile
                          stream={stream || null}
                          name={participant.user_name || 'משתתף'}
                          isMuted={participant.is_muted || false}
                          isVideoOn={participant.is_video_on !== false}
                          isScreenSharing={false}
                          isSpeaking={activeSpeakers.has(participant.user_id)}
                          isHandRaised={raisedHands.has(participant.user_id)}
                          isHost={participant.user_id === room.host_id}
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
                    name={`${displayName} — שיתוף מסך`}
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
                    name={`${screenSharer.user_name || 'משתתף'} — שיתוף מסך`}
                    isMuted={screenSharer.is_muted || false}
                    isVideoOn={true}
                    isScreenSharing={true}
                    isLarge={true}
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
                  .filter(p => p.user_id !== userId)
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
                        title={pinnedUserId === participant.user_id ? "ביטול הצמדה" : "הצמדת המשתתף"}
                      >
                        <VideoTile
                          stream={stream || null}
                          name={participant.user_name || 'משתתף'}
                          isMuted={participant.is_muted || false}
                          isVideoOn={participant.is_video_on !== false}
                          isScreenSharing={false}
                          isSpeaking={activeSpeakers.has(participant.user_id)}
                          isHandRaised={raisedHands.has(participant.user_id)}
                          isHost={participant.user_id === room.host_id}
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
                {showChat ? "צ'אט" : "משתתפים"}
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
                            {isSelf && ' (את/ה)'}
                            {isParticipantHost && (
                              <span className="ms-1.5 text-[10px] text-amber-500 font-semibold">מארח</span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                            {p.is_screen_sharing && (
                              <span className="flex items-center gap-1 text-primary">
                                <Monitor className="w-3 h-3" /> משתף מסך
                              </span>
                            )}
                            {raisedHands.has(p.user_id) && (
                              <span className="flex items-center gap-1 text-amber-500">
                                <Hand className="w-3 h-3" /> יד מורמת
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
                              title="עריכת שם"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
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
            <SheetTitle>{showChat ? "צ'אט" : "משתתפים"}</SheetTitle>
          </SheetHeader>
          {/* Chat takes full sheet body; participants get their own scroll. */}
          {showChat && (
            <div className="flex-1 min-h-0 flex flex-col">
              <RoomChat roomId={room.id} userId={userId} userName={displayName} />
            </div>
          )}
          {showParticipants && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
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
                          {isSelf && ' (את/ה)'}
                          {isParticipantHost && (
                            <span className="ms-1.5 text-[10px] text-amber-500 font-semibold">מארח</span>
                          )}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {p.is_screen_sharing && (
                            <span className="flex items-center gap-1 text-primary">
                              <Monitor className="w-3 h-3" /> משתף מסך
                            </span>
                          )}
                          {raisedHands.has(p.user_id) && (
                            <span className="flex items-center gap-1 text-amber-500">
                              <Hand className="w-3 h-3" /> יד מורמת
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
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
                aria-label={isMuted ? "ביטול השתקה" : "השתקה"}
              >
                {isMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isMuted ? "ביטול השתקה (M)" : "השתקה (M)"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={!isVideoOn ? "destructive" : "glass"}
                size="icon"
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                onClick={toggleVideo}
                aria-label={isVideoOn ? "כיבוי מצלמה" : "הפעלת מצלמה"}
              >
                {isVideoOn ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isVideoOn ? "כיבוי מצלמה (V)" : "הפעלת מצלמה (V)"}</TooltipContent>
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
                aria-label={isLocalRaised ? "הורדת היד" : "הרמת היד"}
              >
                <Hand className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isLocalRaised ? "הורדת היד" : "הרמת היד"}</TooltipContent>
          </Tooltip>

          {/* View mode toggle — only meaningful when there's primary content
              to spotlight (a shared video or a screen share). Hidden
              otherwise so the toggle never looks like it does nothing. */}
          {primaryKind !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="glass"
                  size="icon"
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                  onClick={() => setViewMode((m) => (m === "grid" ? "speaker" : "grid"))}
                  aria-label="החלפת תצוגה"
                >
                  {viewMode === "grid" ? (
                    <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <LayoutGrid className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "grid" ? "תצוגת ספוטלייט (שיתוף ראשי)" : "תצוגת רשת"}
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
                aria-label={isScreenSharing ? "הפסקת שיתוף מסך" : "שיתוף מסך"}
              >
                {isScreenSharing ? <MonitorOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Monitor className="w-4 h-4 sm:w-5 sm:h-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isScreenSharing ? "הפסקת שיתוף מסך" : "שיתוף מסך"}</TooltipContent>
          </Tooltip>
          
          {/* Recording button - only for host, hidden on mobile */}
          {isHost && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isRecording ? "destructive" : "glass"}
                  size="icon"
                  className={cn("hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full relative shrink-0", isRecording && "animate-pulse")}
                  onClick={isRecording ? stopRecording : startRecording}
                  aria-label={isRecording ? "עצירת הקלטה" : "התחלת הקלטה"}
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
              <TooltipContent>{isRecording ? "עצירת הקלטה" : "התחלת הקלטה"}</TooltipContent>
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
                  aria-label={showWhiteboard ? "סגירת לוח ציור" : "פתיחת לוח ציור"}
                >
                  <PenTool className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{showWhiteboard ? "סגירת לוח ציור" : "פתיחת לוח ציור"}</TooltipContent>
            </Tooltip>
          )}

          {/* Watch course video together button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={sharedVideoUrl ? "default" : "glass"}
                size="icon"
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                onClick={() => setVideoDialogOpen(true)}
                aria-label="צפייה בסרטון מהקורס"
              >
                <Play className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>צפייה בסרטון מהקורס יחד</TooltipContent>
          </Tooltip>
          <VideoSelectDialog
            open={videoDialogOpen}
            onOpenChange={setVideoDialogOpen}
            lessons={courseLessons}
            loading={loadingLessons}
            onSelectVideo={handleSelectVideo}
          />

          {/* Chat — desktop opens the side aside; mobile opens the bottom sheet.
              Unread badge on the icon when new messages arrive while panel is closed. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="glass"
                size="icon"
                className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0 relative", showChat && "bg-primary text-primary-foreground")}
                onClick={() => { setShowChat(!showChat); setShowParticipants(false); }}
                aria-label="צ'אט"
              >
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                {unreadCount > 0 && !showChat && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center"
                    aria-label={`${unreadCount} הודעות חדשות`}
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>צ'אט (C)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="glass"
                size="icon"
                className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0 relative", showParticipants && "bg-primary text-primary-foreground")}
                onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); }}
                aria-label="משתתפים"
              >
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                {raisedHands.size > 0 && !showParticipants && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold flex items-center justify-center">
                    <Hand className="w-3 h-3" />
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>משתתפים</TooltipContent>
          </Tooltip>

          <div className="w-px h-6 sm:h-8 bg-border mx-1 sm:mx-2 shrink-0" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                className="h-10 sm:h-12 px-3 sm:px-6 rounded-full gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
                onClick={handleLeave}
                aria-label="יציאה מהחדר"
              >
                <Phone className="w-4 h-4 sm:w-5 sm:h-5 rotate-[135deg]" />
                <span className="hidden xs:inline">עזוב</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>יציאה מהחדר (Esc)</TooltipContent>
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
          השיחה מוקלטת
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
          <span>החיבור נכשל</span>
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
            חיבור מחדש
          </Button>
        </div>
      )}

      {/* Leave-confirmation dialog. */}
      <Dialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>יציאה מהחדר</DialogTitle>
            <DialogDescription>
              {isHost
                ? "אתם המארחים. יציאה תשאיר את החדר פעיל למשתתפים האחרים."
                : "האם לצאת מהחדר?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmLeaveOpen(false);
                performLeave();
              }}
            >
              יציאה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>עריכת השם שלך</DialogTitle>
            <DialogDescription>
              השם שיוצג למשתתפים האחרים בחדר.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="display-name">שם</Label>
            <Input
              id="display-name"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="הזנת שם..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveDisplayName();
              }}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNameDialogOpen(false)}>
              ביטול
            </Button>
            <Button
              onClick={saveDisplayName}
              disabled={!pendingName.trim() || savingName}
            >
              {savingName ? 'בשמירה...' : 'שמירה'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeetingRoom;
