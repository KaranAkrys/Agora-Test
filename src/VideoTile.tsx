import { useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import type { ICameraVideoTrack, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'

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
}: {
  track: ICameraVideoTrack | null
  callType: 'video' | 'audio'
}) {
  return (
    <div className="video-tile">
      <div className="video-label">You (local) — {callType === 'video' ? 'Video' : 'Audio only'}</div>
      {callType === 'video' ? <LocalVideoSurface track={track} /> : <AudioOnlyPlaceholder />}
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
    </div>
  )
}
