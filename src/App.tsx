import { useEffect, useRef, useState } from 'react'
import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng'
import './App.css'

type LogLine = { time: string; text: string }
type CallType = 'video' | 'audio'

function App() {
  const [appId, setAppId] = useState(() => localStorage.getItem('agora_app_id') ?? '')
  const [channel, setChannel] = useState(() => localStorage.getItem('agora_channel') ?? 'test-room')
  const [token, setToken] = useState(() => localStorage.getItem('agora_token') ?? '')
  const [callType, setCallType] = useState<CallType>(
    () => (localStorage.getItem('agora_call_type') as CallType) ?? 'video'
  )

  const [joined, setJoined] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([])
  const [recording, setRecording] = useState(false)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordedMime, setRecordedMime] = useState<string>('')

  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null)
  const localVideoRef = useRef<ICameraVideoTrack | null>(null)
  const localVideoDivRef = useRef<HTMLDivElement | null>(null)
  const activeCallTypeRef = useRef<CallType>('video')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const remoteUsersRef = useRef<IAgoraRTCRemoteUser[]>([])

  const log = (text: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text }].slice(-100))
  }

  useEffect(() => {
    localStorage.setItem('agora_app_id', appId)
  }, [appId])
  useEffect(() => {
    localStorage.setItem('agora_channel', channel)
  }, [channel])
  useEffect(() => {
    localStorage.setItem('agora_token', token)
  }, [token])
  useEffect(() => {
    localStorage.setItem('agora_call_type', callType)
  }, [callType])
  useEffect(() => {
    remoteUsersRef.current = remoteUsers
  }, [remoteUsers])

  const ensureClient = () => {
    if (!clientRef.current) {
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType)
        log(`Subscribed to ${user.uid}'s ${mediaType} track`)
        // Trigger a re-render either way so audio-only remote users still get a tile
        setRemoteUsers((prev) => {
          const others = prev.filter((u) => u.uid !== user.uid)
          return [...others, user]
        })
        if (mediaType === 'audio') {
          user.audioTrack?.play()
        }
      })

      client.on('user-unpublished', (user, mediaType) => {
        log(`${user.uid} unpublished ${mediaType}`)
        setRemoteUsers((prev) => {
          const others = prev.filter((u) => u.uid !== user.uid)
          // keep the tile if the user still has another media type published
          if (user.hasAudio || user.hasVideo) {
            return [...others, user]
          }
          return others
        })
      })

      client.on('user-left', (user) => {
        log(`User ${user.uid} left the channel`)
        setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid))
      })

      client.on('connection-state-change', (curState, prevState) => {
        log(`Connection state: ${prevState} -> ${curState}`)
      })
    }
    return clientRef.current
  }

  const handleJoin = async () => {
    if (!appId.trim()) {
      log('ERROR: App ID is required')
      return
    }
    if (!channel.trim()) {
      log('ERROR: Channel name is required')
      return
    }
    try {
      const client = ensureClient()

      log(`Joining channel "${channel}" as a ${callType.toUpperCase()} call ...`)
      await client.join(appId.trim(), channel.trim(), token.trim() || null, null)
      log('Joined channel successfully')

      activeCallTypeRef.current = callType

      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack()
      localAudioRef.current = audioTrack

      if (callType === 'video') {
        const videoTrack = await AgoraRTC.createCameraVideoTrack()
        localVideoRef.current = videoTrack
        if (localVideoDivRef.current) {
          videoTrack.play(localVideoDivRef.current)
        }
        await client.publish([audioTrack, videoTrack])
        log('Published local audio + video tracks')
      } else {
        await client.publish([audioTrack])
        log('Published local audio track only (audio call — no camera captured)')
      }

      setJoined(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`ERROR joining: ${message}`)
    }
  }

  const handleLeave = async () => {
    try {
      localAudioRef.current?.close()
      localVideoRef.current?.close()
      localAudioRef.current = null
      localVideoRef.current = null

      await clientRef.current?.leave()
      log('Left channel')
      setJoined(false)
      setRemoteUsers([])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`ERROR leaving: ${message}`)
    }
  }

  const toggleMic = async () => {
    if (!localAudioRef.current) return
    const next = !micOn
    await localAudioRef.current.setEnabled(next)
    setMicOn(next)
    log(`Microphone ${next ? 'enabled' : 'muted'}`)
  }

  const toggleCam = async () => {
    if (!localVideoRef.current) return
    const next = !camOn
    await localVideoRef.current.setEnabled(next)
    setCamOn(next)
    log(`Camera ${next ? 'enabled' : 'disabled'}`)
  }

  const startRecording = () => {
    if (!localAudioRef.current) {
      log('ERROR: no local audio track — join the call before recording')
      return
    }
    try {
      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioContextCtor()
      const destination = ctx.createMediaStreamDestination()

      const localTrack = localAudioRef.current.getMediaStreamTrack()
      const localSource = ctx.createMediaStreamSource(new MediaStream([localTrack]))
      localSource.connect(destination)

      let mixedCount = 1
      remoteUsersRef.current.forEach((user) => {
        if (user.audioTrack) {
          const remoteTrack = user.audioTrack.getMediaStreamTrack()
          const remoteSource = ctx.createMediaStreamSource(new MediaStream([remoteTrack]))
          remoteSource.connect(destination)
          mixedCount += 1
        }
      })

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(destination.stream, { mimeType })
      recordedChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(blob)
        setRecordedUrl((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl)
          return url
        })
        setRecordedMime(mimeType)
        log(`Recording stopped — ${(blob.size / 1024).toFixed(1)} KB captured, ready below`)
        ctx.close().catch(() => {})
      }

      recorder.start()
      audioCtxRef.current = ctx
      mediaRecorderRef.current = recorder
      setRecording(true)
      log(
        `Recording started (Web Audio API, no backend) — mixing ${mixedCount} audio source${mixedCount > 1 ? 's' : ''} (your mic${mixedCount > 1 ? ' + remote participant(s)' : ', no remote participants yet'})`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`ERROR starting recording: ${message}`)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  useEffect(() => {
    return () => {
      localAudioRef.current?.close()
      localVideoRef.current?.close()
      clientRef.current?.leave().catch(() => {})
      mediaRecorderRef.current?.stop()
      audioCtxRef.current?.close().catch(() => {})
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="wrap">
      <h1>Agora Video Call — Test Harness</h1>
      <p className="subtitle">
        Standalone test page. Not wired to any backend — paste credentials below to try a call.
      </p>

      <div className="panel">
        <div className="field">
          <label>App ID</label>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="From your Agora console project"
            disabled={joined}
          />
        </div>
        <div className="field">
          <label>Channel name</label>
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="e.g. opd-session-test-1"
            disabled={joined}
          />
        </div>
        <div className="field field-full">
          <label>Token (optional)</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Leave blank if project is in Testing Mode"
            disabled={joined}
          />
        </div>
        <div className="field call-type-field">
          <label>Consultation type</label>
          <div className="segmented">
            <button
              type="button"
              className={callType === 'video' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setCallType('video')}
              disabled={joined}
            >
              Video Call
            </button>
            <button
              type="button"
              className={callType === 'audio' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setCallType('audio')}
              disabled={joined}
            >
              Audio Call
            </button>
          </div>
        </div>

        <div className="actions">
          {!joined ? (
            <button className="primary" onClick={handleJoin}>
              Join Call
            </button>
          ) : (
            <>
              <button className="danger" onClick={handleLeave}>
                Leave Call
              </button>
              <button onClick={toggleMic}>{micOn ? 'Mute Mic' : 'Unmute Mic'}</button>
              {activeCallTypeRef.current === 'video' && (
                <button onClick={toggleCam}>{camOn ? 'Turn Camera Off' : 'Turn Camera On'}</button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="videos">
        <div className="video-tile">
          <div className="video-label">You (local) — {callType === 'video' ? 'Video' : 'Audio only'}</div>
          {callType === 'video' ? (
            <div className="video-surface" ref={localVideoDivRef} />
          ) : (
            <AudioOnlyPlaceholder />
          )}
        </div>
        {remoteUsers.map((user) => (
          <RemoteTile key={user.uid} user={user} />
        ))}
      </div>

      {joined && (
        <div className="panel recording-panel">
          <div className="recording-row">
            <div className="recording-status">
              {recording ? (
                <span className="rec-indicator">
                  <span className="rec-dot" /> Recording…
                </span>
              ) : (
                <span className="rec-idle">Not recording</span>
              )}
            </div>
            <div className="actions">
              {!recording ? (
                <button className="primary" onClick={startRecording}>
                  Start Recording
                </button>
              ) : (
                <button className="danger" onClick={stopRecording}>
                  Stop Recording
                </button>
              )}
            </div>
          </div>
          <p className="recording-note">
            Client-side only — mixes your mic + every currently-connected remote participant's audio via the Web
            Audio API, right in this browser tab. Nothing is uploaded or saved anywhere; nothing is sent to a
            backend. Participants who join after you click Start won't be included in the mix.
          </p>

          {recordedUrl && (
            <div className="recorded-result">
              <div className="recorded-label">Last recording ({recordedMime})</div>
              <audio className="recorded-audio" controls src={recordedUrl} />
              <a className="download-link" href={recordedUrl} download={`consult-recording-${Date.now()}.webm`}>
                Download recording
              </a>
            </div>
          )}
        </div>
      )}

      <div className="log-panel">
        <div className="log-title">Event log</div>
        <div className="log-body">
          {logs.length === 0 && <div className="log-empty">Nothing yet — join a channel to see events.</div>}
          {logs.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{l.time}</span> {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AudioOnlyPlaceholder() {
  return (
    <div className="audio-placeholder">
      <div className="audio-icon">🎙️</div>
      <div className="audio-caption">Audio only — no camera published</div>
    </div>
  )
}

function RemoteTile({ user }: { user: IAgoraRTCRemoteUser }) {
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

  return (
    <div className="video-tile">
      <div className="video-label">Remote user {user.uid} — {hasVideo ? 'Video' : 'Audio only'}</div>
      {hasVideo ? <div className="video-surface" ref={ref} /> : <AudioOnlyPlaceholder />}
    </div>
  )
}

export default App
