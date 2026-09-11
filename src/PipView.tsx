import { useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { ICameraVideoTrack, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import { AudioOnlyPlaceholder, CameraOffPlaceholder, LocalVideoSurface, MicMutedBadge, RemoteVideoSurface } from './VideoTile'

type CallType = 'video' | 'audio'

function DraggableOverlay({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  children: React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null)
  const [pos, setPos] = useState({ x: 16, y: 16 })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, startPos: pos }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current || !containerRef.current || !boxRef.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    const container = containerRef.current.getBoundingClientRect()
    const box = boxRef.current.getBoundingClientRect()
    const maxX = Math.max(container.width - box.width - 8, 8)
    const maxY = Math.max(container.height - box.height - 8, 8)
    setPos({
      x: Math.min(Math.max(dragState.current.startPos.x - dx, 8), maxX),
      y: Math.min(Math.max(dragState.current.startPos.y - dy, 8), maxY),
    })
  }

  const onPointerUp = () => {
    dragState.current = null
  }

  return (
    <div
      ref={boxRef}
      className="pip-overlay"
      style={{ right: pos.x, bottom: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {children}
    </div>
  )
}

export function PipView({
  callType,
  localVideoTrack,
  camOn,
  micOn,
  remoteUsers,
}: {
  callType: CallType
  localVideoTrack: ICameraVideoTrack | null
  camOn: boolean
  micOn: boolean
  remoteUsers: IAgoraRTCRemoteUser[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [primaryUid, setPrimaryUid] = useState<string | number | null>(null)

  const primary = remoteUsers.find((u) => u.uid === primaryUid) ?? remoteUsers[0] ?? null
  const others = remoteUsers.filter((u) => u.uid !== primary?.uid)
  const primaryHasVideo = Boolean(primary?.videoTrack) && Boolean(primary?.hasVideo)

  return (
    <div className="pip-container" ref={containerRef}>
      <div className="pip-main">
        {primary ? (
          primaryHasVideo ? <RemoteVideoSurface user={primary} /> : <AudioOnlyPlaceholder />
        ) : (
          <div className="pip-waiting">Waiting for a remote participant to join…</div>
        )}
        <div className="pip-main-label">{primary ? `Remote user ${primary.uid}` : 'No remote participant yet'}</div>
        {primary && !primary.hasAudio && <MicMutedBadge />}
      </div>

      <DraggableOverlay containerRef={containerRef}>
        <div className="pip-overlay-label">You</div>
        {callType === 'video' ? (
          camOn ? <LocalVideoSurface track={localVideoTrack} /> : <CameraOffPlaceholder />
        ) : (
          <AudioOnlyPlaceholder />
        )}
        {!micOn && <MicMutedBadge />}
      </DraggableOverlay>

      {others.length > 0 && (
        <div className="pip-thumbnails">
          {others.map((user) => {
            const hasVideo = Boolean(user.videoTrack) && user.hasVideo
            return (
              <button
                key={user.uid}
                type="button"
                className="pip-thumb"
                onClick={() => setPrimaryUid(user.uid)}
                title={`Switch to user ${user.uid}`}
              >
                {hasVideo ? <RemoteVideoSurface user={user} /> : <AudioOnlyPlaceholder />}
                <div className="pip-thumb-label">{user.uid}</div>
                {!user.hasAudio && <MicMutedBadge />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
