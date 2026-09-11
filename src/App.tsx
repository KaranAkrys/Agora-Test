import { useEffect, useRef, useState } from 'react'
import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng'
import { AudioLines, Clock, Disc, Download, Mic, MicOff, PhoneOff, Square, Video, VideoOff } from 'lucide-react'
import './App.css'
import { LocalTile, NotJoinedTile, RemoteTile, WaitingForParticipantTile } from './VideoTile'
import { PipView } from './PipView'

type LogLine = { time: string; text: string }
type CallType = 'video' | 'audio'
type ViewMode = 'grid' | 'pip'

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = minutes.toString().padStart(2, '0')
  const ss = seconds.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

// Browsers' MediaRecorder only emits webm/opus (or ogg) for audio — there is no
// native "record as wav" option. We decode that compressed capture back into PCM
// and re-encode it as an uncompressed WAV file here so the download works in
// tools/players that don't handle webm/opus containers.
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataLength = buffer.length * blockAlign

  const arrayBuffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(arrayBuffer)

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch))
  }

  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

function connectTrackToDestination(
  ctx: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  track: MediaStreamTrack
) {
  ctx.createMediaStreamSource(new MediaStream([track])).connect(destination)
}

function App() {
  const [appId, setAppId] = useState(() => localStorage.getItem('agora_app_id') ?? '')
  const [channel, setChannel] = useState(() => localStorage.getItem('agora_channel') ?? 'test-room')
  const [token, setToken] = useState(() => localStorage.getItem('agora_token') ?? '')
  const [callType, setCallType] = useState<CallType>(
    () => (localStorage.getItem('agora_call_type') as CallType) ?? 'video'
  )
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('agora_view_mode') as ViewMode) ?? 'grid'
  )

  const [joined, setJoined] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([])
  const [localVideoTrack, setLocalVideoTrack] = useState<ICameraVideoTrack | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordedMime, setRecordedMime] = useState<string>('')
  const [callSeconds, setCallSeconds] = useState(0)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null)
  const localVideoRef = useRef<ICameraVideoTrack | null>(null)
  const activeCallTypeRef = useRef<CallType>('video')
  const callStartRef = useRef<number | null>(null)
  const recordingStartRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const remoteUsersRef = useRef<IAgoraRTCRemoteUser[]>([])
  const recordingRef = useRef(false)

  const log = (text: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text }].slice(-100))
  }

  useEffect(() => {
    if (!joined) return
    const id = setInterval(() => {
      if (callStartRef.current) {
        setCallSeconds(Math.floor((Date.now() - callStartRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [joined])

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      if (recordingStartRef.current) {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [recording])

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
    localStorage.setItem('agora_view_mode', viewMode)
  }, [viewMode])
  useEffect(() => {
    remoteUsersRef.current = remoteUsers
  }, [remoteUsers])
  useEffect(() => {
    recordingRef.current = recording
  }, [recording])

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
          if (recordingRef.current && audioCtxRef.current && destinationRef.current && user.audioTrack) {
            connectTrackToDestination(audioCtxRef.current, destinationRef.current, user.audioTrack.getMediaStreamTrack())
            log(`Added ${user.uid}'s audio to the in-progress recording`)
          }
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
        setLocalVideoTrack(videoTrack)
        await client.publish([audioTrack, videoTrack])
        log('Published local audio + video tracks')
      } else {
        await client.publish([audioTrack])
        log('Published local audio track only (audio call — no camera captured)')
      }

      callStartRef.current = Date.now()
      setCallSeconds(0)
      setJoined(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`ERROR joining: ${message}`)
    }
  }

  const handleLeave = async () => {
    if (recording) {
      const proceed = window.confirm(
        'A recording is in progress. Leaving now hides the Stop/Download controls and the recording will be stuck running with no way to retrieve it. Leave anyway?'
      )
      if (!proceed) return
    }
    try {
      localAudioRef.current?.close()
      localVideoRef.current?.close()
      localAudioRef.current = null
      localVideoRef.current = null
      setLocalVideoTrack(null)
      callStartRef.current = null
      setCallSeconds(0)

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

      connectTrackToDestination(ctx, destination, localAudioRef.current.getMediaStreamTrack())

      let mixedCount = 1
      remoteUsersRef.current.forEach((user) => {
        if (user.audioTrack) {
          connectTrackToDestination(ctx, destination, user.audioTrack.getMediaStreamTrack())
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
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        log(`Recording stopped — captured as ${mimeType} (browser's native MediaRecorder format), converting to WAV…`)

        try {
          const decodeCtx = new AudioContextCtor()
          const audioBuffer = await decodeCtx.decodeAudioData(await blob.arrayBuffer())
          const wavBlob = audioBufferToWav(audioBuffer)
          decodeCtx.close().catch(() => {})

          const url = URL.createObjectURL(wavBlob)
          setRecordedUrl((prevUrl) => {
            if (prevUrl) URL.revokeObjectURL(prevUrl)
            return url
          })
          setRecordedMime('audio/wav')
          log(`Converted to WAV — ${(wavBlob.size / 1024).toFixed(1)} KB, ready below`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log(`ERROR converting to WAV, keeping original ${mimeType}: ${message}`)
          const url = URL.createObjectURL(blob)
          setRecordedUrl((prevUrl) => {
            if (prevUrl) URL.revokeObjectURL(prevUrl)
            return url
          })
          setRecordedMime(mimeType)
        }

        ctx.close().catch(() => {})
        destinationRef.current = null
      }

      recorder.start()
      audioCtxRef.current = ctx
      destinationRef.current = destination
      mediaRecorderRef.current = recorder
      recordingStartRef.current = Date.now()
      setRecordingSeconds(0)
      setRecording(true)
      log(
        `Recording started (Web Audio API, no backend) — mixing ${mixedCount} audio source${mixedCount > 1 ? 's' : ''} (your mic${mixedCount > 1 ? ' + remote participant(s)' : ', no remote participants yet'}). Anyone who joins or rejoins afterward is added live.`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`ERROR starting recording: ${message}`)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    recordingStartRef.current = null
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

        {!joined && (
          <div className="actions">
            <button className="primary" onClick={handleJoin}>
              Join Call
            </button>
          </div>
        )}
      </div>

      {callType === 'video' && (
        <div className="view-mode-row">
          <div className="segmented">
            <button
              type="button"
              className={viewMode === 'grid' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setViewMode('grid')}
            >
              Grid view
            </button>
            <button
              type="button"
              className={viewMode === 'pip' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setViewMode('pip')}
            >
              Picture-in-picture
            </button>
          </div>
        </div>
      )}

      <div className="video-area">
        {!joined ? (
          <div className="videos">
            <NotJoinedTile />
          </div>
        ) : callType === 'video' && viewMode === 'pip' ? (
          <PipView
            callType={callType}
            localVideoTrack={localVideoTrack}
            camOn={camOn}
            micOn={micOn}
            remoteUsers={remoteUsers}
          />
        ) : (
          <div className="videos">
            <LocalTile track={localVideoTrack} callType={callType} camOn={camOn} micOn={micOn} />
            {remoteUsers.length > 0 ? (
              remoteUsers.map((user) => <RemoteTile key={user.uid} user={user} />)
            ) : (
              <WaitingForParticipantTile />
            )}
          </div>
        )}
      </div>

      {joined && (
        <div className="call-dock">
          <div className="call-dock-timer">
            <Clock size={13} />
            {formatDuration(callSeconds)}
          </div>
          <div className="meet-controls">
            <button
              type="button"
              className={micOn ? 'meet-btn' : 'meet-btn off'}
              onClick={toggleMic}
              title={micOn ? 'Mute microphone' : 'Unmute microphone'}
              aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            {activeCallTypeRef.current === 'video' && (
              <button
                type="button"
                className={camOn ? 'meet-btn' : 'meet-btn off'}
                onClick={toggleCam}
                title={camOn ? 'Turn camera off' : 'Turn camera on'}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {camOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            )}
            <button
              type="button"
              className="meet-btn leave"
              onClick={handleLeave}
              title="Leave call"
              aria-label="Leave call"
            >
              <PhoneOff size={20} />
            </button>
          </div>
          <div className="call-dock-spacer" />
        </div>
      )}

      {joined && (
        <div className="panel recording-panel">
          <div className="recording-row">
            <div className="recording-status">
              {recording ? (
                <span className="rec-indicator">
                  <span className="rec-dot" />
                  Recording {formatDuration(recordingSeconds)}
                </span>
              ) : (
                <span className="rec-idle">
                  <AudioLines size={15} />
                  Not recording
                </span>
              )}
            </div>
            <div className="actions">
              {!recording ? (
                <button className="primary rec-btn" onClick={startRecording}>
                  <Disc size={16} />
                  Start Recording
                </button>
              ) : (
                <button className="danger rec-btn" onClick={stopRecording}>
                  <Square size={16} />
                  Stop Recording
                </button>
              )}
            </div>
          </div>
          <p
            className="recording-note"
            title="Mixes your mic and every remote participant's audio live via the Web Audio API, right in this browser tab, including anyone who joins or rejoins after you click Start. Nothing is uploaded or saved anywhere. If a participant goes quiet (e.g. they left and haven't rejoined), that stretch is simply silent — it isn't filled in retroactively. Browsers' MediaRecorder only natively captures webm/opus for audio — we decode that and re-encode it as WAV on stop, so the download is a plain, universally playable WAV file."
          >
            Client-side only — mixes everyone's audio live in this tab, delivered as WAV. Nothing is uploaded anywhere.
          </p>

          {recordedUrl && (
            <div className="recorded-result">
              <div className="recorded-label">
                <AudioLines size={14} />
                Last recording ({recordedMime})
              </div>
              <audio className="recorded-audio" controls src={recordedUrl} />
              <a
                className="download-link"
                href={recordedUrl}
                download={`consult-recording-${Date.now()}.${recordedMime === 'audio/wav' ? 'wav' : 'webm'}`}
              >
                <Download size={14} />
                Download recording
              </a>
            </div>
          )}
        </div>
      )}

      <div className="log-panel">
        <div className="log-header">
          <div className="log-title">Event log {logs.length > 0 && `(${logs.length})`}</div>
          <button type="button" className="log-toggle" onClick={() => setShowLogs((prev) => !prev)}>
            {showLogs ? 'Hide logs' : 'Show logs'}
          </button>
        </div>
        {showLogs && (
          <div className="log-body">
            {logs.length === 0 && <div className="log-empty">Nothing yet — join a channel to see events.</div>}
            {logs.map((l, i) => (
              <div key={i} className="log-line">
                <span className="log-time">{l.time}</span> {l.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
