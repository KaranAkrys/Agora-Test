import { useEffect, useRef, useState } from 'react'
import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng'
import './App.css'

type LogLine = { time: string; text: string }

const DEFAULT_APP_ID = 'dd400f2227314618814501df77c74007'

function App() {
  const [appId, setAppId] = useState(() => localStorage.getItem('agora_app_id') ?? DEFAULT_APP_ID)
  const [channel, setChannel] = useState(() => localStorage.getItem('agora_channel') ?? 'test-room')
  const [token, setToken] = useState(() => localStorage.getItem('agora_token') ?? '')
  const [uid, setUid] = useState(() => localStorage.getItem('agora_uid') ?? '')

  const [joined, setJoined] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([])

  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null)
  const localVideoRef = useRef<ICameraVideoTrack | null>(null)
  const localVideoDivRef = useRef<HTMLDivElement | null>(null)

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
    localStorage.setItem('agora_uid', uid)
  }, [uid])

  const ensureClient = () => {
    if (!clientRef.current) {
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType)
        log(`Subscribed to ${user.uid}'s ${mediaType} track`)
        if (mediaType === 'video') {
          setRemoteUsers((prev) => {
            const others = prev.filter((u) => u.uid !== user.uid)
            return [...others, user]
          })
        }
        if (mediaType === 'audio') {
          user.audioTrack?.play()
        }
      })

      client.on('user-unpublished', (user, mediaType) => {
        log(`${user.uid} unpublished ${mediaType}`)
        if (mediaType === 'video') {
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid))
        }
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
      const numericUid = uid.trim() ? Number(uid.trim()) : null

      log(`Joining channel "${channel}" ...`)
      await client.join(appId.trim(), channel.trim(), token.trim() || null, numericUid)
      log('Joined channel successfully')

      const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks()
      localAudioRef.current = audioTrack
      localVideoRef.current = videoTrack

      if (localVideoDivRef.current) {
        videoTrack.play(localVideoDivRef.current)
      }

      await client.publish([audioTrack, videoTrack])
      log('Published local audio + video tracks')

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

  useEffect(() => {
    return () => {
      localAudioRef.current?.close()
      localVideoRef.current?.close()
      clientRef.current?.leave().catch(() => {})
    }
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
        <div className="field">
          <label>Token (optional)</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Leave blank if project is in Testing Mode"
            disabled={joined}
          />
        </div>
        <div className="field">
          <label>UID (optional)</label>
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            placeholder="Leave blank to auto-assign"
            disabled={joined}
          />
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
              <button onClick={toggleCam}>{camOn ? 'Turn Camera Off' : 'Turn Camera On'}</button>
            </>
          )}
        </div>
      </div>

      <div className="videos">
        <div className="video-tile">
          <div className="video-label">You (local)</div>
          <div className="video-surface" ref={localVideoDivRef} />
        </div>
        {remoteUsers.map((user) => (
          <RemoteTile key={user.uid} user={user} />
        ))}
      </div>

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

function RemoteTile({ user }: { user: IAgoraRTCRemoteUser }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (ref.current && user.videoTrack) {
      user.videoTrack.play(ref.current)
    }
    return () => {
      user.videoTrack?.stop()
    }
  }, [user])

  return (
    <div className="video-tile">
      <div className="video-label">Remote user {user.uid}</div>
      <div className="video-surface" ref={ref} />
    </div>
  )
}

export default App
