import { Button } from "@/components/ui/button";
import { 
  Mic, MicOff, Video, VideoOff, Phone, 
  MessageSquare, Users, Monitor, MonitorOff,
  Play, Circle, Square, PenTool
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MeetingControlsProps {
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isRecording: boolean;
  isHost: boolean;
  showChat: boolean;
  showParticipants: boolean;
  showWhiteboard: boolean;
  recordingTime: number;
  hasSharedContent: boolean; // Either screen share or shared video
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleRecording: () => void;
  onToggleWhiteboard: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onOpenVideoDialog: () => void;
  onLeave: () => void;
  hasSharedVideoUrl: boolean;
}

const formatRecordingTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const MeetingControls = ({
  isMuted,
  isVideoOn,
  isScreenSharing,
  isRecording,
  isHost,
  showChat,
  showParticipants,
  showWhiteboard,
  recordingTime,
  hasSharedContent,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onToggleRecording,
  onToggleWhiteboard,
  onToggleChat,
  onToggleParticipants,
  onOpenVideoDialog,
  onLeave,
  hasSharedVideoUrl,
}: MeetingControlsProps) => {
  return (
    <footer className="glass h-16 sm:h-20 px-2 sm:px-4 flex items-center justify-center border-t border-border shrink-0">
      <div className="flex items-center gap-1.5 sm:gap-3 overflow-x-auto max-w-full px-2">
        {/* Mute */}
        <Button
          variant={isMuted ? "destructive" : "glass"}
          size="icon"
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
          onClick={onToggleMute}
          title={isMuted ? "בטל השתקה" : "השתק"}
        >
          {isMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
        </Button>

        {/* Video */}
        <Button
          variant={!isVideoOn ? "destructive" : "glass"}
          size="icon"
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
          onClick={onToggleVideo}
          title={isVideoOn ? "כבה מצלמה" : "הפעל מצלמה"}
        >
          {isVideoOn ? <Video className="w-4 h-4 sm:w-5 sm:h-5" /> : <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" />}
        </Button>
        
        {/* Screen share - hidden on mobile */}
        <Button
          variant={isScreenSharing ? "default" : "glass"}
          size="icon"
          className="hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
          onClick={onToggleScreenShare}
          title={isScreenSharing ? "הפסק שיתוף מסך" : "שתף מסך"}
        >
          {isScreenSharing ? <MonitorOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Monitor className="w-4 h-4 sm:w-5 sm:h-5" />}
        </Button>
        
        {/* Recording button - only for host, hidden on mobile */}
        {isHost && (
          <Button
            variant={isRecording ? "destructive" : "glass"}
            size="icon"
            className={cn("hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full relative shrink-0", isRecording && "animate-pulse")}
            onClick={onToggleRecording}
            title={isRecording ? "עצירת הקלטה" : "התחלת הקלטה"}
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
        )}

        {/* Whiteboard button - when sharing video or screen */}
        {hasSharedContent && (
          <Button
            variant={showWhiteboard ? "default" : "glass"}
            size="icon"
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
            onClick={onToggleWhiteboard}
            title={showWhiteboard ? "סגירת לוח ציור" : "פתיחת לוח ציור"}
          >
            <PenTool className="w-4 h-4 sm:w-5 sm:h-5" />
          </Button>
        )}
        
        {/* Watch course video together button */}
        <Button
          variant={hasSharedVideoUrl ? "default" : "glass"}
          size="icon"
          className="w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
          onClick={onOpenVideoDialog}
          title="צפה בסרטון מהקורס יחד"
        >
          <Play className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>

        {/* Chat button - hidden on mobile */}
        <Button
          variant="glass"
          size="icon"
          className={cn("hidden sm:flex w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0", showChat && "bg-primary text-primary-foreground")}
          onClick={onToggleChat}
          title="צ'אט"
        >
          <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>

        {/* Participants button */}
        <Button
          variant="glass"
          size="icon"
          className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0", showParticipants && "bg-primary text-primary-foreground")}
          onClick={onToggleParticipants}
          title="משתתפים"
        >
          <Users className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>
        
        <div className="w-px h-6 sm:h-8 bg-border mx-1 sm:mx-2 shrink-0" />
        
        {/* Leave button */}
        <Button
          variant="destructive"
          className="h-10 sm:h-12 px-3 sm:px-6 rounded-full gap-1 sm:gap-2 text-xs sm:text-sm shrink-0"
          onClick={onLeave}
        >
          <Phone className="w-4 h-4 sm:w-5 sm:h-5 rotate-[135deg]" />
          <span className="hidden xs:inline">עזוב</span>
        </Button>
      </div>
    </footer>
  );
};

export default MeetingControls;
