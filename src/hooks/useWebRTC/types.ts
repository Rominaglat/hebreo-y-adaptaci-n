export interface Participant {
  id: string;
  user_id: string;
  user_name: string;
  room_id: string;
  is_muted: boolean;
  is_video_on: boolean;
  is_screen_sharing: boolean;
  joined_at: string;
  last_seen_at?: string;
}

export interface PeerState {
  peerId: string;
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  // Budget for ICE restarts. Prevents an infinite restart loop when TURN is
  // unreachable (which would otherwise spam offers into webrtc_signals).
  iceRestartAttempts: number;
}

export interface UseWebRTCProps {
  roomId: string;
  localUserId: string;
  localUserName: string;
}

// Discriminator for join failures so the UI can show a specific message.
//   - `room_full`   : trigger rejected — capacity reached.
//   - `room_locked` : RLS rejected — non-host tried to join a locked room.
//   - `unknown`     : everything else (network, RLS without a specific code).
export type JoinErrorKind = 'room_full' | 'room_locked' | 'unknown';

export interface JoinError {
  kind: JoinErrorKind;
  // Raw message from the backend so we can show it in the toast and so
  // diagnostics aren't swallowed when the backend rejects for an
  // unexpected reason.
  detail?: string;
}

export interface UseWebRTCReturn {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  participants: Participant[];
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'failed';
  joinError: JoinError | null;
  toggleMute: () => void;
  toggleVideo: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  joinRoom: () => Promise<void>;
  leaveRoom: () => Promise<void>;
}

// ICE Server configuration with STUN and free TURN servers
export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    // Google STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Open Relay TURN servers (free, no auth required)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};
