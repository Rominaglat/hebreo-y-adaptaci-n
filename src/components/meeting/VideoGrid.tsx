import { cn } from "@/lib/utils";
import VideoTile from "../VideoTile";
import WhiteboardOverlay from "../WhiteboardOverlay";
import SyncedVideoPlayer from "../SyncedVideoPlayer";
import { DrawingStroke, CursorPosition } from "@/hooks/useWhiteboard";
import { RefObject } from "react";

interface Participant {
  user_id: string;
  user_name: string;
  is_muted: boolean;
  is_video_on: boolean;
  is_screen_sharing: boolean;
}

interface VideoState {
  playing: boolean;
  currentTime: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface VideoGridProps {
  // Video streams
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  participants: Participant[];
  
  // Local user info
  userId: string;
  userName: string;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isHost: boolean;
  
  // Shared video
  sharedVideoUrl: string | null;
  videoState: VideoState;
  videoRef: RefObject<HTMLVideoElement>;
  onPlay: () => void;
  onPause: () => void;
  onSeek: () => void;
  onCloseVideo: () => void;
  
  // Whiteboard
  showWhiteboard: boolean;
  strokes: DrawingStroke[];
  cursors: Map<string, CursorPosition>;
  isDrawingEnabled: boolean;
  pendingRequests: { userId: string; userName: string }[];
  approvedUsers: Set<string>;
  onAddStroke: (stroke: DrawingStroke) => void;
  onUpdateStroke: (id: string, point: { x: number; y: number }) => void;
  onCursorMove: (x: number, y: number) => void;
  onClearBoard: () => void;
  onRequestAccess: () => void;
  onApproveAccess: (userId: string) => void;
  onRevokeAccess: (userId: string) => void;
  onCloseWhiteboard: () => void;
}

const VideoGrid = ({
  localStream,
  screenStream,
  remoteStreams,
  participants,
  userId,
  userName,
  isMuted,
  isVideoOn,
  isScreenSharing,
  isHost,
  sharedVideoUrl,
  videoState,
  videoRef,
  onPlay,
  onPause,
  onSeek,
  onCloseVideo,
  showWhiteboard,
  strokes,
  cursors,
  isDrawingEnabled,
  pendingRequests,
  approvedUsers,
  onAddStroke,
  onUpdateStroke,
  onCursorMove,
  onClearBoard,
  onRequestAccess,
  onApproveAccess,
  onRevokeAccess,
  onCloseWhiteboard,
}: VideoGridProps) => {
  const remoteParticipantsCount = participants.filter(p => p.user_id !== userId).length;
  const totalTiles = 1 + remoteParticipantsCount + (isScreenSharing ? 1 : 0);
  
  const getGridClass = () => {
    if (sharedVideoUrl) {
      if (totalTiles === 1) return "grid-cols-1";
      if (totalTiles === 2) return "grid-cols-2";
      return "grid-cols-2 sm:grid-cols-3";
    }
    if (totalTiles === 1) return "grid-cols-1";
    if (totalTiles === 2) return "grid-cols-1 sm:grid-cols-2";
    if (totalTiles <= 4) return "grid-cols-2";
    return "grid-cols-2 sm:grid-cols-3";
  };

  const screenSharer = participants.find(p => p.is_screen_sharing && p.user_id !== userId);

  // Whiteboard props for reuse
  const whiteboardProps = {
    strokes,
    cursors,
    isDrawingEnabled,
    isHost,
    pendingRequests,
    approvedUsers,
    onAddStroke,
    onUpdateStroke,
    onCursorMove,
    onClearBoard,
    onRequestAccess,
    onApproveAccess,
    onRevokeAccess,
    onClose: onCloseWhiteboard,
    userId,
    userName,
  };

  return (
    <main className="flex-1 p-2 sm:p-4 flex flex-col gap-2 sm:gap-4 overflow-hidden relative">
      {/* Shared video player */}
      {sharedVideoUrl && (
        <div className="relative bg-black rounded-xl overflow-hidden shrink-0" style={{ height: '50%', minHeight: '200px' }}>
          <SyncedVideoPlayer
            videoUrl={sharedVideoUrl}
            videoRef={videoRef}
            videoState={videoState}
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
            onClose={onCloseVideo}
            canClose={isHost}
          />
          {/* Whiteboard overlay on shared video */}
          {showWhiteboard && (
            <WhiteboardOverlay {...whiteboardProps} />
          )}
        </div>
      )}
      
      {/* Video grid */}
      <div className={cn(
        "grid gap-2 sm:gap-4 flex-1 min-h-0 auto-rows-fr relative",
        getGridClass()
      )}>
        {/* Screen share video (separate from camera) */}
        {isScreenSharing && screenStream && (
          <div className="relative">
            <VideoTile
              stream={screenStream}
              name={`${userName} - שיתוף מסך`}
              isMuted={true}
              isVideoOn={true}
              isScreenSharing={true}
              isLocal={true}
              isLarge={!sharedVideoUrl}
            />
            {/* Whiteboard overlay on local screen share */}
            {showWhiteboard && !sharedVideoUrl && (
              <WhiteboardOverlay {...whiteboardProps} />
            )}
          </div>
        )}

        {/* Local camera video */}
        <VideoTile
          stream={localStream}
          name={userName}
          isMuted={isMuted}
          isVideoOn={isVideoOn}
          isScreenSharing={false}
          isLocal={true}
          isLarge={remoteStreams.size === 0 && !sharedVideoUrl && !isScreenSharing && participants.length <= 1}
        />

        {/* Remote participants */}
        {participants
          .filter(p => p.user_id !== userId)
          .map((participant) => {
            const stream = remoteStreams.get(participant.user_id);
            const isRemoteScreenSharing = participant.is_screen_sharing;
            
            return (
              <div key={participant.user_id} className="relative">
                <VideoTile
                  stream={stream || null}
                  name={participant.user_name || 'משתתף'}
                  isMuted={participant.is_muted || false}
                  isVideoOn={participant.is_video_on !== false}
                  isScreenSharing={isRemoteScreenSharing}
                  isLarge={isRemoteScreenSharing && !sharedVideoUrl}
                />
                {/* Whiteboard overlay on remote screen share */}
                {showWhiteboard && !sharedVideoUrl && isRemoteScreenSharing && (
                  <WhiteboardOverlay {...whiteboardProps} />
                )}
              </div>
            );
          })}
      </div>
    </main>
  );
};

export default VideoGrid;
