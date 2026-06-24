import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  UseWebRTCProps,
  UseWebRTCReturn,
  Participant,
  PeerState,
  JoinError,
  JoinErrorKind,
  ICE_SERVERS,
} from './types';

export { type Participant } from './types';

export const useWebRTC = ({ roomId, localUserId, localUserName, devicePrefs }: UseWebRTCProps): UseWebRTCReturn => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('disconnected');
  const [joinError, setJoinError] = useState<JoinError | null>(null);

  const peers = useRef<Map<string, PeerState>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isJoined = useRef(false);
  // Explicit stash for the camera video track so that screen-share end can
  // always restore it, even if the track was toggled or replaced mid-session.
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  // Screen-share outgoing tracks. While sharing, every peer's video sender
  // carries screenVideoTrackRef, and (when the share has audio) the audio
  // sender carries mixedAudioTrackRef — a Web-Audio mix of mic + tab/system
  // audio so peers hear BOTH the presenter and the shared content. Kept in
  // refs so a peer that connects mid-share gets the same tracks.
  const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const mixCtxRef = useRef<AudioContext | null>(null);
  // Heartbeat timer + window-unload handler — keep refs so cleanup is reliable.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unloadHandlerRef = useRef<(() => void) | null>(null);

  // Initialize local media with fallbacks.
  //
  // Honors the lobby's device choices (devicePrefs): the exact camera/mic the
  // user picked, and whether to start with camera off / muted. The mic is
  // ALWAYS acquired (even when starting muted) so the unmute button works
  // instantly — we just disable the track. The camera is only acquired when
  // videoOn is true (matches Meet: no camera light when you join camera-off;
  // toggleVideo re-acquires on demand).
  const initLocalStream = useCallback(async (): Promise<MediaStream> => {
    console.log('[WebRTC] Initializing local stream...', devicePrefs);

    const wantVideo = devicePrefs?.videoOn !== false;
    const startUnmuted = devicePrefs?.micOn !== false;
    const cameraId = devicePrefs?.cameraId;
    const micId = devicePrefs?.micId;

    const baseVideo: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
    };
    const baseAudio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    // Apply local state from a freshly-acquired stream, respecting the lobby's
    // start-muted choice.
    const apply = (stream: MediaStream, gotVideo: boolean) => {
      if (!startUnmuted) {
        stream.getAudioTracks().forEach((tr) => { tr.enabled = false; });
      }
      setLocalStream(stream);
      localStreamRef.current = stream;
      setIsVideoOn(gotVideo);
      setIsMuted(!startUnmuted || stream.getAudioTracks().length === 0);
      return stream;
    };

    // 1) Preferred: honor exact device ids + on/off intent.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: wantVideo
          ? { ...baseVideo, ...(cameraId ? { deviceId: { exact: cameraId } } : {}) }
          : false,
        audio: { ...baseAudio, ...(micId ? { deviceId: { exact: micId } } : {}) },
      });
      console.log('[WebRTC] Got stream honoring lobby prefs');
      return apply(stream, wantVideo && stream.getVideoTracks().length > 0);
    } catch (error) {
      // 2) A pinned device may have vanished between lobby and call
      //    (OverconstrainedError) — retry relaxed but keep the on/off intent.
      console.warn('[WebRTC] Preferred constraints failed, retrying relaxed:', error);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? baseVideo : false,
          audio: baseAudio,
        });
        console.log('[WebRTC] Got relaxed stream');
        return apply(stream, wantVideo && stream.getVideoTracks().length > 0);
      } catch (error2) {
        // 3) Audio-only fallback.
        console.warn('[WebRTC] Failed to get video, trying audio only:', error2);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          console.log('[WebRTC] Got audio-only stream');
          return apply(audioStream, false);
        } catch (audioError) {
          // 4) Nothing available — empty stream so the user can still see/hear others.
          console.warn('[WebRTC] Failed to get any media, creating empty stream:', audioError);
          const emptyStream = new MediaStream();
          setLocalStream(emptyStream);
          localStreamRef.current = emptyStream;
          setIsVideoOn(false);
          setIsMuted(true);
          return emptyStream;
        }
      }
    }
  }, [devicePrefs]);

  // Create and configure peer connection.
  //
  // Guard: if we already have a peer for this id, return it. Without this,
  // a realtime "participant joined" event firing concurrently with the
  // catch-up SELECT can build two RTCPeerConnections for the same peer,
  // overwriting the first (and dropping its pending ICE candidates).
  const createPeerConnection = useCallback((peerId: string): PeerState => {
    const existing = peers.current.get(peerId);
    if (existing) return existing;

    console.log('[WebRTC] Creating peer connection for:', peerId);

    const pc = new RTCPeerConnection(ICE_SERVERS);

    const peerState: PeerState = {
      peerId,
      connection: pc,
      stream: null,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      iceRestartAttempts: 0,
    };

    // Handle ICE candidates
    pc.onicecandidate = async ({ candidate }) => {
      if (candidate) {
        console.log('[WebRTC] Sending ICE candidate to:', peerId);
        try {
          await supabase.from('webrtc_signals').insert([{
            room_id: roomId,
            from_user: localUserId,
            to_user: peerId,
            signal_type: 'ice-candidate',
            signal_data: JSON.parse(JSON.stringify({ candidate: candidate.toJSON() })),
          }]);
        } catch (err) {
          console.error('[WebRTC] Failed to send ICE candidate:', err);
        }
      }
    };

    // Handle incoming tracks
    pc.ontrack = ({ track, streams }) => {
      console.log('[WebRTC] Received track from:', peerId, track.kind);
      
      track.onunmute = () => {
        console.log('[WebRTC] Track unmuted:', peerId, track.kind);
      };

      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        let stream = newMap.get(peerId);
        
        if (!stream) {
          stream = new MediaStream();
          newMap.set(peerId, stream);
        }
        
        // Remove existing track of same kind
        const existingTrack = stream.getTracks().find(t => t.kind === track.kind);
        if (existingTrack) {
          stream.removeTrack(existingTrack);
        }
        
        stream.addTrack(track);
        peerState.stream = stream;
        
        return newMap;
      });
    };

    // Handle connection state changes.
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);

      switch (pc.connectionState) {
        case 'connected':
          setConnectionStatus('connected');
          break;
        case 'failed':
          // Surface to the user — the banner key is on this state.
          setConnectionStatus('failed');
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            newMap.delete(peerId);
            return newMap;
          });
          break;
        case 'disconnected':
          console.log('[WebRTC] Peer disconnected:', peerId);
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            newMap.delete(peerId);
            return newMap;
          });
          break;
      }
    };

    // ICE-restart budget: TURN-down can otherwise spin forever, spamming
    // signals. Cap at 3 attempts per peer; after that, give up and surface
    // 'failed' so the user can rejoin.
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state with', peerId, ':', pc.iceConnectionState);

      if (pc.iceConnectionState === 'failed') {
        const state = peers.current.get(peerId);
        if (state && state.iceRestartAttempts < 3) {
          state.iceRestartAttempts += 1;
          console.log(`[WebRTC] ICE failed, restart attempt ${state.iceRestartAttempts}/3`);
          pc.restartIce();
        } else {
          console.warn('[WebRTC] ICE restart budget exhausted for', peerId);
          setConnectionStatus('failed');
        }
      } else if (pc.iceConnectionState === 'connected') {
        // Reset the budget on a successful reconnect so future failures get a
        // fresh quota.
        const state = peers.current.get(peerId);
        if (state) state.iceRestartAttempts = 0;
      }
    };

    // Handle negotiation needed
    pc.onnegotiationneeded = async () => {
      console.log('[WebRTC] Negotiation needed with:', peerId);
      
      const state = peers.current.get(peerId);
      if (!state) return;
      
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        
        console.log('[WebRTC] Sending offer to:', peerId);
        await supabase.from('webrtc_signals').insert([{
          room_id: roomId,
          from_user: localUserId,
          to_user: peerId,
          signal_type: 'offer',
          signal_data: JSON.parse(JSON.stringify({ sdp: pc.localDescription })),
        }]);
      } catch (err) {
        console.error('[WebRTC] Failed to create offer:', err);
      } finally {
        state.makingOffer = false;
      }
    };

    // Always add the local mic + camera tracks first. This is what makes a
    // peer that connects DURING a screen share still hear our microphone — the
    // old `screenStream || localStream` OR added only the screen tracks and
    // silently dropped the mic for late joiners.
    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach(track => {
        console.log('[WebRTC] Adding local track to peer:', track.kind);
        pc.addTrack(track, localStream);
      });
    }

    // If a screen share is already in progress, swap the senders to carry the
    // screen content — mirroring exactly what already-connected peers received
    // via replaceTrack in startScreenShare.
    if (screenStreamRef.current) {
      const screenVideo = screenVideoTrackRef.current;
      if (screenVideo) {
        const vSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (vSender) vSender.replaceTrack(screenVideo);
        else pc.addTrack(screenVideo, screenStreamRef.current);
      }
      const mixedAudio = mixedAudioTrackRef.current;
      if (mixedAudio) {
        const aSender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (aSender) aSender.replaceTrack(mixedAudio);
      }
    }

    peers.current.set(peerId, peerState);
    return peerState;
  }, [roomId, localUserId]);

  // Handle incoming signals
  const handleSignal = useCallback(async (signal: any) => {
    if (signal.to_user !== localUserId) return;
    
    const peerId = signal.from_user;
    let peerState = peers.current.get(peerId);
    
    if (!peerState) {
      peerState = createPeerConnection(peerId);
    }
    
    const pc = peerState.connection;

    try {
      switch (signal.signal_type) {
        case 'offer': {
          console.log('[WebRTC] Received offer from:', peerId);
          
          const offerCollision = 
            peerState.makingOffer || 
            pc.signalingState !== 'stable';
          
          // Polite peer yields to impolite peer (higher ID is impolite)
          const isPolite = localUserId < peerId;
          peerState.ignoreOffer = !isPolite && offerCollision;
          
          if (peerState.ignoreOffer) {
            console.log('[WebRTC] Ignoring colliding offer from:', peerId);
            return;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          console.log('[WebRTC] Sending answer to:', peerId);
          await supabase.from('webrtc_signals').insert([{
            room_id: roomId,
            from_user: localUserId,
            to_user: peerId,
            signal_type: 'answer',
            signal_data: JSON.parse(JSON.stringify({ sdp: pc.localDescription })),
          }]);
          break;
        }
        
        case 'answer': {
          console.log('[WebRTC] Received answer from:', peerId);
          
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data.sdp));
          } else {
            console.log('[WebRTC] Ignoring answer in wrong state:', pc.signalingState);
          }
          break;
        }
        
        case 'ice-candidate': {
          if (signal.signal_data.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.signal_data.candidate));
            } catch (err) {
              if (!peerState.ignoreOffer) {
                console.error('[WebRTC] Failed to add ICE candidate:', err);
              }
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('[WebRTC] Error handling signal:', err);
    }
  }, [localUserId, roomId, createPeerConnection]);

  // Toggle mute. Includes `last_seen_at` in every status update so we double
  // as a heartbeat — prevents the TTL cron from racing with a status write.
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      const newMuted = !isMuted;
      setIsMuted(newMuted);

      supabase.from('room_participants')
        .update({ is_muted: newMuted, last_seen_at: new Date().toISOString() } as never)
        .eq('room_id', roomId)
        .eq('user_id', localUserId)
        .then(() => console.log('[WebRTC] Updated mute status'));
    }
  }, [isMuted, roomId, localUserId]);

  // Toggle video. If the camera track has ended (browser evicted it, user
  // pressed stop on the permission prompt, etc.) we re-acquire it instead of
  // leaving the user stuck with a dead preview.
  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return;

    const videoTracks = localStreamRef.current.getVideoTracks();
    const allEnded = videoTracks.length === 0 || videoTracks.every(t => t.readyState === 'ended');

    if (allEnded) {
      // Re-acquire camera from scratch — honoring the lobby-selected camera.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
            ...(devicePrefs?.cameraId ? { deviceId: { exact: devicePrefs.cameraId } } : {}),
          },
          audio: false,
        });
        const newTrack = stream.getVideoTracks()[0];
        if (newTrack) {
          // Drop any remaining video tracks and add the fresh one.
          videoTracks.forEach(t => localStreamRef.current!.removeTrack(t));
          localStreamRef.current.addTrack(newTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

          // Push the new track to every peer connection.
          peers.current.forEach((peerState) => {
            const sender = peerState.connection.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(newTrack);
            else peerState.connection.addTrack(newTrack, localStreamRef.current!);
          });
        }
        setIsVideoOn(true);
        await supabase.from('room_participants')
          .update({ is_video_on: true, last_seen_at: new Date().toISOString() } as never)
          .eq('room_id', roomId)
          .eq('user_id', localUserId);
      } catch (err) {
        console.error('[WebRTC] Failed to re-acquire camera:', err);
        setIsVideoOn(false);
      }
      return;
    }

    videoTracks.forEach(track => {
      track.enabled = !track.enabled;
    });
    const newVideoOn = !isVideoOn;
    setIsVideoOn(newVideoOn);

    await supabase.from('room_participants')
      .update({ is_video_on: newVideoOn, last_seen_at: new Date().toISOString() } as never)
      .eq('room_id', roomId)
      .eq('user_id', localUserId);
  }, [isVideoOn, roomId, localUserId, devicePrefs]);

  // Start screen sharing
  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      setScreenStream(stream);
      screenStreamRef.current = stream;
      setIsScreenSharing(true);

      // Stash the live camera track before we replace senders so that
      // stopScreenShare can put it back exactly as it was.
      const liveCameraTrack = localStreamRef.current?.getVideoTracks().find(
        (t) => t.readyState !== 'ended',
      );
      if (liveCameraTrack) cameraTrackRef.current = liveCameraTrack;

      const videoTrack = stream.getVideoTracks()[0];
      screenVideoTrackRef.current = videoTrack;

      // If the user shared a tab/window WITH audio, mix it with the mic so
      // peers hear both the presenter and the shared content. Each peer only
      // has a single audio m-line, so we send ONE mixed track (not two) — the
      // receiver's ontrack keeps a single audio track per peer.
      const screenAudioTrack = stream.getAudioTracks()[0] ?? null;
      let outgoingAudio: MediaStreamTrack | null = null;
      if (screenAudioTrack) {
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          mixCtxRef.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          // Mic source (the same track mute toggles, so muting still works).
          const micTrack = localStreamRef.current?.getAudioTracks()[0];
          if (micTrack) {
            ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
          }
          // Shared-content audio source.
          ctx.createMediaStreamSource(new MediaStream([screenAudioTrack])).connect(dest);
          outgoingAudio = dest.stream.getAudioTracks()[0] ?? null;
          mixedAudioTrackRef.current = outgoingAudio;
        } catch (err) {
          console.warn('[WebRTC] Failed to mix screen audio, sending mic only:', err);
        }
      }

      peers.current.forEach((peerState) => {
        const pc = peerState.connection;
        const vSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (vSender) vSender.replaceTrack(videoTrack);
        else pc.addTrack(videoTrack, stream);
        if (outgoingAudio) {
          const aSender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (aSender) aSender.replaceTrack(outgoingAudio);
        }
      });

      await supabase.from('room_participants')
        .update({ is_screen_sharing: true, last_seen_at: new Date().toISOString() } as never)
        .eq('room_id', roomId)
        .eq('user_id', localUserId);

      // Browser-driven stop ("Stop sharing" button) ends the track. Route to
      // the same cleanup as the in-app stop button.
      videoTrack.onended = () => {
        stopScreenShare();
      };

      console.log('[WebRTC] Screen sharing started');
    } catch (error) {
      console.error('[WebRTC] Error starting screen share:', error);
    }
  }, [roomId, localUserId]);

  // Stop screen sharing. Guarded: the browser's "Stop sharing" button fires
  // videoTrack.onended which calls this, AND the UI button does too — so the
  // function MUST be safe to call twice in quick succession.
  const stopScreenShare = useCallback(async () => {
    if (!screenStreamRef.current) return;
    // Detach onended immediately so the browser-driven path can't re-enter.
    screenStreamRef.current.getVideoTracks().forEach((t) => {
      t.onended = null;
    });

    screenStreamRef.current.getTracks().forEach(track => track.stop());
    setScreenStream(null);
    screenStreamRef.current = null;
    screenVideoTrackRef.current = null;
    setIsScreenSharing(false);

    // Restore each peer's audio sender to the RAW mic track (we may have
    // swapped it to a mic+screen mix in startScreenShare), then tear down the
    // mix graph.
    const micTrack = localStreamRef.current?.getAudioTracks()[0] ?? null;
    if (mixedAudioTrackRef.current) {
      peers.current.forEach((peerState) => {
        const aSender = peerState.connection.getSenders().find(s => s.track?.kind === 'audio');
        if (aSender) aSender.replaceTrack(micTrack);
      });
      mixedAudioTrackRef.current.stop();
      mixedAudioTrackRef.current = null;
    }
    if (mixCtxRef.current) {
      mixCtxRef.current.close().catch(() => {});
      mixCtxRef.current = null;
    }

    // Restore the original camera. Prefer the stashed track; if it died while
    // we were sharing, re-acquire from the camera (honoring the selected one).
    let restoredTrack: MediaStreamTrack | null = cameraTrackRef.current;
    if (!restoredTrack || restoredTrack.readyState === 'ended') {
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
            ...(devicePrefs?.cameraId ? { deviceId: { exact: devicePrefs.cameraId } } : {}),
          },
          audio: false,
        });
        restoredTrack = fresh.getVideoTracks()[0] ?? null;
        if (restoredTrack && localStreamRef.current) {
          // Drop dead tracks and add the fresh one to the local stream too.
          localStreamRef.current.getVideoTracks().forEach((t) => {
            if (t.readyState === 'ended') localStreamRef.current!.removeTrack(t);
          });
          localStreamRef.current.addTrack(restoredTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
      } catch (err) {
        console.error('[WebRTC] Failed to re-acquire camera after screen share:', err);
      }
    }

    if (restoredTrack) {
      peers.current.forEach((peerState) => {
        const sender = peerState.connection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(restoredTrack);
      });
    }
    cameraTrackRef.current = null;

    await supabase.from('room_participants')
      .update({ is_screen_sharing: false, last_seen_at: new Date().toISOString() } as never)
      .eq('room_id', roomId)
      .eq('user_id', localUserId);

    console.log('[WebRTC] Screen sharing stopped');
  }, [roomId, localUserId, devicePrefs]);

  // Join room.
  //
  // Order matters here — subscribe to realtime BEFORE inserting our participant
  // row. If we inserted first, a peer that already saw us could send an offer
  // into a postgres_changes channel we hadn't subscribed to yet, and the offer
  // would be silently dropped (the classic "subscribe-after-state" race).
  const joinRoom = useCallback(async () => {
    if (isJoined.current) {
      console.log('[WebRTC] Already joined');
      return;
    }

    console.log('[WebRTC] Joining room:', roomId);
    setConnectionStatus('connecting');
    isJoined.current = true;

    const joinStream = await initLocalStream();
    // Reflect the lobby's start-muted / camera-off choices in the very first
    // participant row so peers see the correct state immediately (not a flash
    // of "unmuted, camera on").
    const startVideoOn =
      devicePrefs?.videoOn !== false && joinStream.getVideoTracks().length > 0;
    const startMuted =
      devicePrefs?.micOn === false || joinStream.getAudioTracks().length === 0;

    // Clean up any stale signals addressed to us before we open the channel —
    // otherwise the SELECT inside handleSignal would replay them.
    await supabase
      .from('webrtc_signals')
      .delete()
      .eq('room_id', roomId)
      .or(`from_user.eq.${localUserId},to_user.eq.${localUserId}`);

    // 1) Subscribe FIRST. We will not see inserts that happened before this
    //    point, so we explicitly catch up on existing peers below in step 3.
    await new Promise<void>((resolve) => {
      channelRef.current = supabase
        .channel(`room-signals-${roomId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'webrtc_signals',
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            handleSignal(payload.new);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'room_participants',
            filter: `room_id=eq.${roomId}`,
          },
          async () => {
            const { data } = await supabase
              .from('room_participants')
              .select('*')
              .eq('room_id', roomId);

            if (!data) return;
            setParticipants(data);

            data.forEach((p) => {
              if (p.user_id !== localUserId && !peers.current.has(p.user_id)) {
                console.log('[WebRTC] New participant detected:', p.user_id);
                if (localUserId > p.user_id) {
                  createPeerConnection(p.user_id);
                }
              }
            });

            peers.current.forEach((_, peerId) => {
              if (!data.find((p) => p.user_id === peerId)) {
                console.log('[WebRTC] Participant left:', peerId);
                const peerState = peers.current.get(peerId);
                if (peerState) {
                  peerState.connection.close();
                  peers.current.delete(peerId);
                  setRemoteStreams((prev) => {
                    const newMap = new Map(prev);
                    newMap.delete(peerId);
                    return newMap;
                  });
                }
              }
            });
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
    });

    // 2) Now safe to register ourselves in the room.
    const { error: upsertError } = await supabase
      .from('room_participants')
      .upsert(
        {
          room_id: roomId,
          user_id: localUserId,
          user_name: localUserName,
          is_muted: startMuted,
          is_video_on: startVideoOn,
          is_screen_sharing: false,
          last_seen_at: new Date().toISOString(),
        } as never,
        { onConflict: 'room_id,user_id' },
      );

    if (upsertError) {
      console.error('[WebRTC] Failed to add participant:', upsertError);
      const rawMessage = upsertError.message ?? '';
      const lowerMessage = rawMessage.toLowerCase();
      const code = (upsertError as { code?: string }).code;
      let kind: JoinErrorKind;
      if (lowerMessage.includes('room_full')) {
        kind = 'room_full';
      } else if (code === '42501' || lowerMessage.includes('row-level security')) {
        kind = 'room_locked';
      } else {
        kind = 'unknown';
      }
      // Include the underlying error so the UI can show it (instead of an
      // opaque "אירעה שגיאה") and so it's visible without the console.
      const detail = [code, rawMessage].filter(Boolean).join(': ');
      setJoinError({ kind, detail });
      // Roll back so the cleanup path runs.
      isJoined.current = false;
      setConnectionStatus('disconnected');
      return;
    }

    // 3) Catch up on participants who existed before our subscription opened.
    const { data: existingParticipants } = await supabase
      .from('room_participants')
      .select('*')
      .eq('room_id', roomId);

    if (existingParticipants) {
      setParticipants(existingParticipants);

      existingParticipants.forEach((p) => {
        if (p.user_id !== localUserId) {
          if (localUserId > p.user_id) {
            console.log('[WebRTC] Initiating connection to existing participant:', p.user_id);
            createPeerConnection(p.user_id);
          }
        }
      });
    }

    // Mark the room-level connection as ready. Without this we'd sit at
    // "connecting" forever when the user is alone (no peer ever fires
    // its onconnectionstatechange to 'connected'). Per-peer failures
    // still set 'failed' downstream.
    setConnectionStatus('connected');

    // 4) Heartbeat — keep our row alive so the TTL cleanup job doesn't reap us
    //    while we're sitting idle.
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      // last_seen_at is added by migration 20260515120000 — cast around the
      // generated types until they're regenerated.
      supabase
        .from('room_participants')
        .update({ last_seen_at: new Date().toISOString() } as never)
        .eq('room_id', roomId)
        .eq('user_id', localUserId)
        .then(({ error }) => {
          if (error) console.warn('[WebRTC] Heartbeat update failed:', error);
        });
    }, 30_000);

    // 5) Best-effort cleanup if the user closes the tab or navigates away.
    //    Plain `fetch` may be cancelled mid-unload; `keepalive: true` tells
    //    the browser to let the request finish even after the page is gone.
    //    The 90s TTL cleanup is the final backstop if this still fails.
    const unload = () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        if (!supabaseUrl || !anonKey) return;

        const session = (
          supabase as unknown as { auth: { currentSession?: { access_token: string } } }
        ).auth.currentSession;
        const token = session?.access_token;
        if (!token) return;

        const url =
          `${supabaseUrl}/rest/v1/room_participants` +
          `?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(localUserId)}`;

        fetch(url, {
          method: 'DELETE',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
          },
          keepalive: true,
        }).catch(() => {});
      } catch {
        // swallow — page is unloading anyway.
      }
    };
    unloadHandlerRef.current = unload;
    window.addEventListener('beforeunload', unload);
    window.addEventListener('pagehide', unload);

    console.log('[WebRTC] Room joined successfully');
  }, [roomId, localUserId, localUserName, devicePrefs, initLocalStream, createPeerConnection, handleSignal]);

  // Leave room
  const leaveRoom = useCallback(async () => {
    console.log('[WebRTC] Leaving room');
    isJoined.current = false;
    setConnectionStatus('disconnected');

    // Stop heartbeat + detach unload handlers first so we don't fire them
    // mid-teardown.
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (unloadHandlerRef.current) {
      window.removeEventListener('beforeunload', unloadHandlerRef.current);
      window.removeEventListener('pagehide', unloadHandlerRef.current);
      unloadHandlerRef.current = null;
    }
    cameraTrackRef.current = null;

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    // Tear down the screen-audio mix graph if a share was active.
    screenVideoTrackRef.current = null;
    if (mixedAudioTrackRef.current) {
      mixedAudioTrackRef.current.stop();
      mixedAudioTrackRef.current = null;
    }
    if (mixCtxRef.current) {
      mixCtxRef.current.close().catch(() => {});
      mixCtxRef.current = null;
    }

    // Close all peer connections
    peers.current.forEach((peerState) => {
      peerState.connection.close();
    });
    peers.current.clear();

    // Unsubscribe from channel
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Remove from database
    await supabase
      .from('room_participants')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', localUserId);

    // Clean up signals
    await supabase
      .from('webrtc_signals')
      .delete()
      .eq('room_id', roomId)
      .or(`from_user.eq.${localUserId},to_user.eq.${localUserId}`);

    setRemoteStreams(new Map());
    setParticipants([]);
    
    console.log('[WebRTC] Left room');
  }, [roomId, localUserId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isJoined.current) {
        leaveRoom();
      }
    };
  }, []);

  // Propagate display-name changes after join. Without this, editing your
  // name only updates locally — peers keep seeing the old value because the
  // initial upsert ran during joinRoom and nothing else ever writes
  // user_name. The realtime subscription on room_participants will pick up
  // this UPDATE and refresh everyone's participants list.
  useEffect(() => {
    if (!isJoined.current) return;
    supabase
      .from('room_participants')
      .update({ user_name: localUserName, last_seen_at: new Date().toISOString() } as never)
      .eq('room_id', roomId)
      .eq('user_id', localUserId)
      .then(({ error }) => {
        if (error) console.warn('[WebRTC] Display-name update failed:', error);
      });
  }, [localUserName, roomId, localUserId]);

  return {
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
  };
};
