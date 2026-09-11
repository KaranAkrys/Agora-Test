import { useEffect, useRef } from 'react'
import { LogIn, Mic, MicOff, User, Users } from 'lucide-react'
import type { ICameraVideoTrack, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'

export function MicMutedBadge() {
  return (
    <div className="mic-badge" title="Microphone muted">
      <MicOff size={13} />
    </div>
  )
}

export function AudioOnlyPlaceholder() {
  return (
    <div className="audio-placeholder">
      <div className="audio-icon">
        <Mic size={28} />
      </div>
      <div className="audio-caption">Audio only — no camera published</div>
    </div>
  )
}

export function CameraOffPlaceholder() {
  return (
    <div className="audio-placeholder">
      <div className="user-avatar">
        <User size={30} />
      </div>
      <div className="audio-caption">Camera off</div>
    </div>
  )
}

export function NotJoinedTile() {
  return (
    <div className="video-tile">
      <div className="video-label">No active call</div>
      <div className="audio-placeholder">
        <div className="user-avatar">
          <LogIn size={28} />
        </div>
        <div className="audio-caption">No channel joined — fill in the details above and tap Join Call</div>
      </div>
    </div>
  )
}

export function WaitingForParticipantTile() {
  return (
    <div className="video-tile">
      <div className="video-label">Remote participant</div>
      <div className="audio-placeholder">
        <div className="user-avatar">
          <Users size={28} />
        </div>
        <div className="audio-caption">Waiting for a remote participant to join…</div>
      </div>
    </div>
  )
}

export function LocalVideoSurface({ track }: { track: ICameraVideoTrack | null }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (ref.current && track) {
      track.play(ref.current)
    }
    return () => {
      track?.stop()
    }
  }, [track])

  return <div className="video-surface" ref={ref} />
}

export function RemoteVideoSurface({ user }: { user: IAgoraRTCRemoteUser }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const hasVideo = Boolean(user.videoTrack) && user.hasVideo

  useEffect(() => {
    if (ref.current && user.videoTrack && user.hasVideo) {
      user.videoTrack.play(ref.current)
    }
    return () => {
      user.videoTrack?.stop()
    }
  }, [user, hasVideo])

  return <div className="video-surface" ref={ref} />
}

export function LocalTile({
  track,
  callType,
  camOn,
  micOn,
}: {
  track: ICameraVideoTrack | null
  callType: 'video' | 'audio'
  camOn: boolean
  micOn: boolean
}) {
  const showVideo = callType === 'video' && camOn
  const label = callType === 'video' ? (camOn ? 'Video' : 'Camera off') : 'Audio only'

  return (
    <div className="video-tile">
      <div className="video-label">You (local) — {label}</div>
      {showVideo ? (
        <LocalVideoSurface track={track} />
      ) : callType === 'video' ? (
        <CameraOffPlaceholder />
      ) : (
        <AudioOnlyPlaceholder />
      )}
      {!micOn && <MicMutedBadge />}
    </div>
  )
}

export function RemoteTile({ user }: { user: IAgoraRTCRemoteUser }) {
  const hasVideo = Boolean(user.videoTrack) && user.hasVideo

  return (
    <div className="video-tile">
      <div className="video-label">
        Remote user {user.uid} — {hasVideo ? 'Video' : 'Audio only'}
      </div>
      {hasVideo ? <RemoteVideoSurface user={user} /> : <AudioOnlyPlaceholder />}
      {!user.hasAudio && <MicMutedBadge />}
    </div>
  )
}
