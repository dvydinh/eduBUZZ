import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { supabase } from './supabase'


import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  Monitor,
  MonitorOff,
  Hand,
  PhoneOff,
  Lock,
  LockOpen,
  Send,
  Plus,
  X,
  Search,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Bell,
  ArrowLeft,
  FileText,
  CalendarDays,
  Upload,
  Volume2,
  Maximize2,
  Minimize2,
  PenTool,
} from 'lucide-react'
import { useBee } from './useBee'
import { getSocket, api } from './api'
import { InteractiveWhiteboard } from './Whiteboard'

type Role = 'student' | 'tutor'
const SAMPLE_PDF = 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf'
const SAMPLE_AUDIO = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
const SAMPLE_IMG = 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&h=520&fit=crop&auto=format'
const MONTH = 'August 2026'

/* --------------------------------- data ----------------------------------- */

type Course = { id: string; name: string; goal: string; progress: number; students: number; color: string; is_enrolled?: boolean }
type HW = {
  id: number
  courseId: string
  title: string
  dueDay: number
  points: number
  desc: string
  kind: 'line' | 'pdf'
  pdfUrl?: string
  audioUrl?: string
  imageUrl?: string
  status: 'open' | 'submitted' | 'closed'
  submissions: number
  mySubmitted?: boolean
}
/* NOTE: `c` (correct index) is intentionally absent — answers graded server-side */
type QQ = { id: number; courseId: string; title: string; dueDay: number; best: number | null; color: string; audioUrl?: string; imageUrl?: string; qs: { id: number; q: string; a: string[] }[] }
type Res = { id: number; courseId: string; name: string; size: string }
type Reminder = { id: number; day: number; label: string }

/* helper: map DB snake_case to camelCase for HW */
function mapHW(row: any): HW {
  return {
    id: row.id,
    courseId: row.course_id ?? row.courseId,
    title: row.title,
    dueDay: row.due_day ?? row.dueDay,
    points: row.points,
    desc: row.description ?? row.desc ?? '',
    kind: row.kind,
    pdfUrl: row.pdf_url ?? row.pdfUrl,
    audioUrl: row.audio_url ?? row.audioUrl,
    imageUrl: row.image_url ?? row.imageUrl,
    status: row.status,
    submissions: row.submissions ?? 0,
    mySubmitted: row.mySubmitted ?? false,
  }
}
function mapRes(row: any): Res {
  return { id: row.id, courseId: row.course_id ?? row.courseId, name: row.name, size: row.size }
}

/* --------------------------------- art ------------------------------------ */

function Bee({ size = 44 }: { size?: number }) {
  const src = useBee()
  return <img src={src} alt="eduBUZZ bee" width={size} height={size} className="select-none object-contain" style={{ width: size, height: size }} draggable={false} />
}
function Comb({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l6 3.5v7L12 17l-6-3.5v-7L12 3z" fill="currentColor" opacity="0.9" />
      <path d="M12 9l6 3.5v7L12 23l-6-3.5v-7L12 9z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

/* -------------------------------- widgets --------------------------------- */

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full px-3 py-1 text-sm font-bold" style={{ background: 'var(--bg-soft)', color: 'var(--ink-soft)' }}>{children}</span>
}
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`pop rounded-[28px] p-6 ${className}`} style={{ background: 'var(--card)', border: '3px solid var(--card-line)', boxShadow: 'var(--shadow)' }}>{children}</div>
}
function Btn({ children, onClick, tone = 'honey', className = '' }: { children: React.ReactNode; onClick?: () => void; tone?: 'honey' | 'grape' | 'ghost'; className?: string }) {
  const tones: Record<string, React.CSSProperties> = {
    honey: { background: 'var(--honey)', color: '#4a3b12', border: '3px solid #4a3b12' },
    grape: { background: 'var(--grape)', color: '#fff', border: '3px solid #4a3b12' },
    ghost: { background: 'transparent', color: 'var(--ink)', border: '3px solid var(--card-line)' },
  }
  return <button onClick={onClick} className={`squish inline-flex items-center gap-2 rounded-full px-6 py-3 font-extrabold ${className}`} style={{ fontFamily: 'var(--font-display)', ...tones[tone] }}>{children}</button>
}
function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-6" style={{ background: 'rgba(74,59,18,0.45)' }} onClick={onClose}>
      <div className={`pop w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-[32px] p-8`} onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card)', border: '4px solid #4a3b12', boxShadow: '0 16px 0 rgba(74,59,18,0.2)' }}>
        {children}
      </div>
    </div>
  )
}
const inputCls = 'w-full rounded-2xl px-5 py-3 font-bold outline-none'
const inputStyle: React.CSSProperties = { border: '3px solid var(--card-line)', background: 'var(--bg)', color: 'var(--ink)' }
const dueLabel = (d: number) => `Aug ${d}`

// Optional image + audio attachments, rendered only when present.
function Media({ imageUrl, audioUrl }: { imageUrl?: string; audioUrl?: string }) {
  if (!imageUrl && !audioUrl) return null
  return (
    <div className="mb-4 space-y-3">
      {imageUrl && (
        <img src={imageUrl} alt="Attachment" className="w-full rounded-2xl object-cover" style={{ maxHeight: 260, border: '3px solid var(--card-line)', background: 'var(--bg-soft)' }} />
      )}
      {audioUrl && (
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-soft)', border: '3px solid var(--card-line)' }}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--honey)', border: '2px solid #4a3b12', color: '#4a3b12' }}>
            <Volume2 size={18} strokeWidth={2.6} />
          </span>
          <audio controls src={audioUrl} className="w-full" />
        </div>
      )}
    </div>
  )
}

// File picker → object URL, so attachments render/play inline (no download).
function FilePick({ accept, label, value, onPick, sample }: { accept: string; label: string; value: string; onPick: (url: string) => void; sample?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-soft)', border: '3px dashed var(--card-line)' }}>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            onPick(URL.createObjectURL(f))
            setChosen(f.name)
          }
        }}
      />
      <Btn tone="ghost" onClick={() => ref.current?.click()}>
        <Upload size={18} /> {label}
      </Btn>
      <span className="min-w-0 flex-1 truncate font-bold" style={{ color: value ? 'var(--ink)' : 'var(--ink-soft)' }}>
        {chosen || (value ? 'Attached' : 'None')}
      </span>
      {sample && (
        <button
          onClick={() => {
            onPick(sample)
            setChosen('Sample')
          }}
          className="squish text-sm font-extrabold underline"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--honey-deep)' }}
        >
          use sample
        </button>
      )}
    </div>
  )
}

// Optional image + audio pickers for add-forms.
function MediaInputs({ img, audio, setImg, setAudio }: { img: string; audio: string; setImg: (v: string) => void; setAudio: (v: string) => void }) {
  return (
    <>
      <FilePick accept="image/*" label="Add image" value={img} onPick={setImg} sample={SAMPLE_IMG} />
      <FilePick accept="audio/*" label="Add audio" value={audio} onPick={setAudio} sample={SAMPLE_AUDIO} />
    </>
  )
}

function IconToggle({ on, onIcon: On, offIcon: Off, label, onClick, danger }: { on: boolean; onIcon: typeof Mic; offIcon: typeof Mic; label: string; onClick: () => void; danger?: boolean }) {
  const Icon = on ? On : Off
  return (
    <button onClick={onClick} className="squish flex flex-col items-center gap-1">
      <span className="grid h-14 w-14 place-items-center rounded-full" style={{ background: danger ? '#ff9db0' : on ? 'var(--honey)' : 'var(--bg-soft)', border: '3px solid #4a3b12', color: '#4a3b12' }}>
        <Icon size={24} strokeWidth={2.6} />
      </span>
      <span className="text-xs font-extrabold" style={{ color: 'var(--ink-soft)' }}>{label}</span>
    </button>
  )
}

/* --------------------------------- login ---------------------------------- */

function Login({ onEnter }: { onEnter: (name: string, role: Role) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [role, setRole] = useState<Role>('student')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const ok = () => (mode === 'signin' ? email.trim() && code.trim().length >= 4 : name.trim() && email.trim() && code.trim().length >= 4)
  const submit = async () => {
    if (!ok()) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    setLoading(true)
    setErr('')
    try {
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: code })
        if (error) throw error
        onEnter(data.user.user_metadata?.name || 'User', data.user.user_metadata?.role as Role || 'student')
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: code,
          options: { data: { name: name.trim(), role } }
        })
        if (error) throw error
        if (!data.session) {
          setErr('Vui lòng kiểm tra hộp thư email của bạn để xác nhận tài khoản!')
          return
        }
        onEnter(data.user?.user_metadata?.name || name.trim(), data.user?.user_metadata?.role as Role || role)
      }
    } catch (e: any) {
      setErr(e.message || 'Something went wrong')
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setLoading(false)
    }
  }
  const handleRoleSelect = (r: Role) => {
    setRole(r)
    if (mode === 'signin') {
      setEmail(r === 'student' ? 'student@edubuzz.app' : 'tutor@edubuzz.app')
      setCode('demo1234')
    } else {
      setEmail('')
      setCode('')
    }
  }

  const tab = (m: typeof mode, label: string) => (
    <button onClick={() => setMode(m)} className="squish flex-1 rounded-full px-3 py-2 text-sm font-bold" style={{ fontFamily: 'var(--font-display)', background: mode === m ? '#ffcf3f' : 'transparent', color: '#4a3b12', border: mode === m ? '3px solid #4a3b12' : '3px solid transparent' }}>{label}</button>
  )
  const roleBtn = (r: Role, label: string) => (
    <button onClick={() => handleRoleSelect(r)} className="squish flex-1 rounded-2xl px-3 py-3 font-extrabold" style={{ fontFamily: 'var(--font-display)', background: role === r ? '#a37bff' : '#fffdf4', color: role === r ? '#fff' : '#4a3b12', border: '3px solid #4a3b12' }}>{label}</button>
  )
  const li: React.CSSProperties = { border: '3px solid #4a3b12', background: '#fffdf4', color: '#4a3b12' }
  return (
    <div className="living-gradient relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="bee-fly-a pointer-events-none absolute -left-32 -top-32"><Bee size={64} /></div>
      <div className="bee-fly-b pointer-events-none absolute -right-32 -top-32" style={{ animationDelay: '4s' }}><Bee size={48} /></div>
      <div className="pop relative z-10 w-full max-w-md rounded-[36px] p-9 text-center" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(14px)', border: '4px solid #4a3b12', boxShadow: '0 18px 0 rgba(74,59,18,0.18)', animation: shake ? 'pop 0.1s 3 alternate' : undefined }}>
        <div className="mb-1 flex justify-center"><Bee size={64} /></div>
        <h1 className="text-5xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#4a3b12' }}>edu<span style={{ color: '#f4a71d' }}>BUZZ</span></h1>
        <p className="mb-5 mt-1 text-lg font-bold" style={{ color: '#8a7742' }}>{mode === 'signin' ? 'welcome back!' : 'join the hive'}</p>
        <div className="mb-4 flex gap-3">{roleBtn('student', "I’m a Student")}{roleBtn('tutor', "I’m a Tutor")}</div>
        <div className="mb-6 flex rounded-full p-1" style={{ background: '#fff6d6', border: '3px solid #4a3b12' }}>{tab('signin', 'Sign in')}{tab('signup', 'Sign up')}</div>
        {err && <p className="mb-3 rounded-2xl px-4 py-2 text-sm font-extrabold" style={{ background: '#ffd6de', color: '#c25a6a' }}>{err}</p>}
        <div className="space-y-4 text-left">
          {mode !== 'signin' && <input className={inputCls} style={li} placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className={inputCls} style={li} type="email" placeholder="you@hive.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={inputCls} style={li} type="password" placeholder={'Password'} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div className="mt-7 space-y-3">
          <Btn onClick={submit}>{loading ? 'Loading…' : mode === 'signin' ? 'Sign in →' : 'Create account →'}</Btn>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------- honey edge ------------------------------- */

function HoneyEdge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-full h-24 overflow-hidden">
      <svg className="absolute inset-x-0 top-[-2px] w-full" height="70" viewBox="0 0 1200 70" preserveAspectRatio="none">
        <path d="M0 0 H1200 V16 C1160 16 1150 54 1120 54 C1090 54 1082 16 1050 16 C1000 16 995 40 965 40 C935 40 930 16 890 16 C840 16 838 62 800 62 C762 62 760 16 715 16 C665 16 662 44 630 44 C598 44 596 16 550 16 C500 16 498 52 462 52 C426 52 424 16 380 16 C330 16 328 42 296 42 C264 42 262 16 220 16 C168 16 166 58 128 58 C90 58 88 16 48 16 C24 16 18 30 0 30 Z" fill="var(--honey)" />
      </svg>
      {[{ x: '11%', d: 0 }, { x: '38%', d: 1.2 }, { x: '66%', d: 0.6 }, { x: '88%', d: 1.8 }].map((p) => (
        <span key={p.x} className="honey-drop absolute top-[42px]" style={{ left: p.x, width: 14, height: 14, borderRadius: '50% 50% 55% 55%', background: 'var(--honey)', animationDelay: `${p.d}s` }} />
      ))}
    </div>
  )
}

/* -------------------------------- Meeting --------------------------------- */

function VideoPlayer({ stream, muted, className }: { stream?: MediaStream; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={className || "h-full w-full object-cover rounded-2xl"} />
}

type Peer = { n: string; muted: boolean; camOff: boolean; screen: boolean; stream?: MediaStream }

function Meeting({ isTutor, name, courseId }: { isTutor: boolean; name: string; courseId: string }) {
  const [cam, setCam] = useState(false)
  const [mic, setMic] = useState(false)
  const [locked, setLocked] = useState(false)
  const [share, setShare] = useState(false)
  const [board, setBoard] = useState(false)
  const [hand, setHand] = useState(false)
  const [left, setLeft] = useState(false)

  useEffect(() => {
    if (left) {
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      setLocalStream(null)
      Object.values(pcsRef.current).forEach(pc => pc.close())
      getSocket().disconnect()
    }
  }, [left])

  const [peers, setPeers] = useState<Record<string, Peer>>({})
  const [chat, setChat] = useState<{ who: string; msg: string }[]>([])
  const [draft, setDraft] = useState('')

  const wrap = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  const localStreamRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({})
  const screenStreamRef = useRef<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  // Fullscreen logic
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrap.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrap.current?.requestFullscreen?.()
  }

  // WebRTC Setup
  useEffect(() => {
    const socket = getSocket()
    socket.connect()

    // Do NOT request media immediately. Start muted/camOff and wait for user to toggle.
    socket.emit('join-room', courseId, { name, muted: true, camOff: true })

    const createPeer = (id: string, n: string) => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pcsRef.current[id] = pc

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!))
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal', id, { type: 'candidate', candidate: e.candidate })
      }

      pc.ontrack = (e) => {
        setPeers(prev => ({ ...prev, [id]: { ...prev[id], stream: e.streams[0] } }))
      }

      return pc
    }

    socket.on('user-joined', async (id: string, user: any) => {
      setPeers(prev => ({ ...prev, [id]: { n: user.name, muted: user.muted, camOff: user.camOff, screen: false } }))
      const pc = createPeer(id, user.name)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('signal', id, { type: 'offer', offer })
    })

    socket.on('signal', async (id: string, data: any) => {
      let pc = pcsRef.current[id]
      if (data.type === 'offer') {
        setPeers(prev => ({ ...prev, [id]: prev[id] || { n: 'User', muted: false, camOff: false, screen: false } }))
        pc = createPeer(id, 'User')
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('signal', id, { type: 'answer', answer })
      } else if (data.type === 'answer') {
        await pc?.setRemoteDescription(new RTCSessionDescription(data.answer))
      } else if (data.type === 'candidate') {
        await pc?.addIceCandidate(new RTCIceCandidate(data.candidate))
      }
    })

    socket.on('user-left', (id: string) => {
      pcsRef.current[id]?.close()
      delete pcsRef.current[id]
      setPeers(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    })

    socket.on('chat-message', (msg: any) => setChat(c => [...c, msg]))
    socket.on('toggle-status', (id: string, status: any) => {
      setPeers(prev => prev[id] ? { ...prev, [id]: { ...prev[id], ...status } } : prev)
    })

    return () => {
      socket.off('user-joined')
      socket.off('signal')
      socket.off('user-left')
      socket.off('chat-message')
      socket.off('toggle-status')
      Object.values(pcsRef.current).forEach(pc => pc.close())
      localStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [courseId, name])

  const toggleCam = async () => {
    const next = !cam
    setCam(next)
    getSocket().emit('toggle-status', { camOff: !next })

    if (next) {
      // Turning ON
      try {
        const vStream = await navigator.mediaDevices.getUserMedia({ video: true })
        const vTrack = vStream.getVideoTracks()[0]
        
        let targetStream = localStream
        if (!targetStream) {
          targetStream = new MediaStream()
          localStreamRef.current = targetStream
        }
        targetStream.addTrack(vTrack)
        setLocalStream(new MediaStream(targetStream.getTracks()))

        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(vTrack)
          else pc.addTrack(vTrack, targetStream!)
        })
      } catch (err) {
        setCam(false)
        getSocket().emit('toggle-status', { camOff: true })
        alert("Could not access camera.")
      }
    } else {
      // Turning OFF
      if (localStream) {
        localStream.getVideoTracks().forEach(t => {
          t.stop()
          localStream.removeTrack(t)
        })
        setLocalStream(new MediaStream(localStream.getTracks()))
      }
    }
  }

  const toggleMic = async () => {
    const next = !mic
    setMic(next)
    getSocket().emit('toggle-status', { muted: !next })

    if (next) {
      // Turning ON
      try {
        const aStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const aTrack = aStream.getAudioTracks()[0]
        
        let targetStream = localStream
        if (!targetStream) {
          targetStream = new MediaStream()
          localStreamRef.current = targetStream
        }
        targetStream.addTrack(aTrack)
        setLocalStream(new MediaStream(targetStream.getTracks()))

        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
          if (sender) sender.replaceTrack(aTrack)
          else pc.addTrack(aTrack, targetStream!)
        })
      } catch (err) {
        setMic(false)
        getSocket().emit('toggle-status', { muted: true })
        alert("Could not access microphone.")
      }
    } else {
      // Turning OFF
      if (localStream) {
        localStream.getAudioTracks().forEach(t => {
          t.stop()
          localStream.removeTrack(t)
        })
        setLocalStream(new MediaStream(localStream.getTracks()))
      }
    }
  }

  const toggleShare = async () => {
    if (!share) {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          alert('Screen sharing is not supported in this browser (requires HTTPS/localhost).')
          return
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        setShare(true)
        screenStreamRef.current = stream
        getSocket().emit('toggle-status', { screen: true })
        
        const videoTrack = stream.getVideoTracks()[0]
        const audioTrack = stream.getAudioTracks()[0]
        
        Object.values(pcsRef.current).forEach(pc => {
          const vSender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (vSender) vSender.replaceTrack(videoTrack)
          
          if (audioTrack) {
            const aSender = pc.getSenders().find(s => s.track?.kind === 'audio')
            if (aSender) aSender.replaceTrack(audioTrack)
          }
        })
        
        videoTrack.onended = () => {
          setShare(false)
          getSocket().emit('toggle-status', { screen: false })
          const camTrack = localStreamRef.current?.getVideoTracks()[0]
          const micTrack = localStreamRef.current?.getAudioTracks()[0]
          Object.values(pcsRef.current).forEach(pc => {
            const vSender = pc.getSenders().find(s => s.track?.kind === 'video')
            if (vSender && camTrack) vSender.replaceTrack(camTrack)
            
            const aSender = pc.getSenders().find(s => s.track?.kind === 'audio')
            if (aSender && micTrack) aSender.replaceTrack(micTrack)
          })
        }
      } catch { /* ignore */ }
    } else {
      setShare(false)
      getSocket().emit('toggle-status', { screen: false })
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      const camTrack = localStreamRef.current?.getVideoTracks()[0]
      const micTrack = localStreamRef.current?.getAudioTracks()[0]
      Object.values(pcsRef.current).forEach(pc => {
        const vSender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (vSender && camTrack) vSender.replaceTrack(camTrack)
        
        const aSender = pc.getSenders().find(s => s.track?.kind === 'audio')
        if (aSender && micTrack) aSender.replaceTrack(micTrack)
      })
    }
  }

  const send = () => {
    if (!draft.trim()) return
    const msg = { who: name, msg: draft.trim() }
    setChat(c => [...c, msg])
    getSocket().emit('chat-message', msg)
    setDraft('')
  }

  const toggleMute = (n2: string) => alert('Cannot force mute peers yet.')

  if (left)
    return (
      <Card className="text-center">
        <div className="mb-3 flex justify-center"><Bee size={80} /></div>
        <h3 className="mb-4 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>You left the meeting</h3>
        <Btn onClick={() => { setLeft(false); window.location.reload(); }}>Re-join</Btn>
      </Card>
    )

  const renderControls = (overlay = false) => (
    <div className={`flex flex-wrap justify-center gap-3 ${overlay ? 'absolute bottom-6 left-1/2 -translate-x-1/2 p-3 bg-white/90 backdrop-blur-md rounded-full shadow-xl border-2 border-[var(--card-line)] z-50' : ''}`}>
      <IconToggle on={cam} onIcon={Video} offIcon={VideoOff} label="Cam" onClick={toggleCam} />
      <IconToggle on={mic} onIcon={Mic} offIcon={MicOff} label="Mic" onClick={toggleMic} />
      <IconToggle on={share} onIcon={Monitor} offIcon={MonitorOff} label="Share" onClick={toggleShare} />
      <IconToggle on={board} onIcon={PenTool} offIcon={PenTool} label="Board" onClick={() => setBoard(b => !b)} />
      {!isTutor && <IconToggle on={hand} onIcon={Hand} offIcon={Hand} label="Raise" onClick={() => { setHand(!hand); getSocket().emit('toggle-status', { hand: !hand }) }} />}
      <button onClick={toggleFull} className="squish grid h-12 w-12 place-items-center rounded-full bg-gray-100 border-2 border-[var(--card-line)] text-gray-700" title={full ? 'Exit full screen' : 'Full screen'}>
        {full ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
      </button>
      <IconToggle on={false} onIcon={PhoneOff} offIcon={PhoneOff} label="Leave" onClick={() => setLeft(true)} danger />
    </div>
  )

  const hasActiveCam = cam || mic || Object.values(peers).some(p => !p.camOff || !p.muted)

  const renderCamColumn = () => (
    <div className="flex flex-col gap-4 overflow-y-auto pr-2 w-64 shrink-0">
      {/* Self */}
      {(cam || mic) && (
        <div className="shrink-0 h-48 w-full rounded-2xl overflow-hidden bg-black relative border-2 border-[var(--card-line)] shadow-sm">
          {cam && localStream ? <VideoPlayer stream={localStream} muted={true} /> : <div className="absolute inset-0 bg-gray-100 flex items-center justify-center"><VideoOff className="text-gray-400" size={32} /></div>}
          <div className="absolute bottom-2 left-2 right-2 bg-black/60 rounded px-3 py-1.5 text-sm font-bold text-white flex items-center justify-between">
            <span className="truncate">{name} (You) {hand && '✋'}</span>
            {!mic && <MicOff size={16} />}
          </div>
        </div>
      )}
      {/* Peers */}
      {Object.entries(peers).map(([id, p]) => (
        (!p.camOff || p.muted === false) && (
          <div key={id} className="shrink-0 h-48 w-full rounded-2xl overflow-hidden bg-black relative border-2 border-[var(--card-line)] shadow-sm">
            {p.stream && !p.camOff ? <VideoPlayer stream={p.stream} /> : <div className="absolute inset-0 bg-gray-100 flex items-center justify-center"><VideoOff className="text-gray-400" size={32} /></div>}
            <div className="absolute bottom-2 left-2 right-2 bg-black/60 rounded px-3 py-1.5 text-sm font-bold text-white flex items-center justify-between">
              <span className="truncate">{p.n}</span>
              {p.muted && <MicOff size={16} />}
            </div>
          </div>
        )
      ))}
    </div>
  )

  const renderChat = () => (
    <Card className="flex-1 flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Chat</h3>
        <Pill>{Object.keys(peers).length + 1} here</Pill>
      </div>
      <div className="flex-1 min-h-[200px] overflow-y-auto flex flex-col-reverse space-y-2 space-y-reverse mb-4 pr-2">
        {chat.map((c, i) => <p key={i} className="text-sm font-bold leading-relaxed bg-gray-50 p-2.5 rounded-xl"><span style={{ color: 'var(--honey-deep)' }}>{c.who}:</span> <span style={{ color: 'var(--ink)' }}>{c.msg}</span></p>)}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Say hi…" className="w-full rounded-full px-5 py-2.5 font-bold outline-none" style={inputStyle} />
        <button onClick={send} className="squish grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: 'var(--honey)', border: '3px solid #4a3b12', color: '#4a3b12' }}><Send size={18} strokeWidth={2.6} /></button>
      </div>
    </Card>
  )

  if (board || share || Object.values(peers).some(p => p.screen)) {
    // Find active screen stream if any
    const activeScreenStream = share ? screenStreamRef.current : Object.values(peers).find(p => p.screen)?.stream;
    return (
      <div ref={wrap} className={`flex gap-4 ${full ? 'fixed inset-0 z-50 p-4' : 'h-[85vh]'}`} style={full ? { background: 'var(--bg)' } : undefined}>
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 relative rounded-[28px] overflow-hidden border-[3px] border-[var(--card-line)] shadow-xl bg-black flex items-center justify-center">
            {activeScreenStream ? (
              <VideoPlayer stream={activeScreenStream} className="w-full h-full object-contain" />
            ) : (
              <InteractiveWhiteboard courseId={courseId} />
            )}
            {renderControls(true)}
          </div>
        </div>
        {!full && (
          <div className="w-80 shrink-0 flex flex-col gap-4">
            {hasActiveCam && renderCamColumn()}
            {renderChat()}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={wrap} className={`grid gap-6 lg:grid-cols-[1.6fr_1fr] ${full ? 'fixed inset-0 z-50 p-6 overflow-y-auto' : ''}`} style={full ? { background: 'var(--bg)' } : undefined}>
      <Card className="flex flex-col">
        <div className="mb-4 flex items-center justify-between">
          <Pill>{isTutor ? 'You are the host' : 'Live session'}</Pill>
          <div className="flex items-center gap-3">
            {locked && <span className="flex items-center gap-1 text-sm font-extrabold" style={{ color: 'var(--honey-deep)' }}><Lock size={16} /> Locked</span>}
            <button onClick={toggleFull} className="squish grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink)' }} title={full ? 'Exit full screen' : 'Full screen'}>
              {full ? <Minimize2 size={18} strokeWidth={2.6} /> : <Maximize2 size={18} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
        <div className="mb-6 flex-1 grid place-items-center rounded-[24px] overflow-hidden relative" style={{ minHeight: 400, background: 'var(--bg-soft)', border: '3px dashed var(--card-line)' }}>
          {cam && localStream ? (
            <VideoPlayer stream={localStream} muted={true} />
          ) : (
            <div className="text-center">
              <div className="mb-3 flex justify-center"><VideoOff size={72} strokeWidth={2.2} color="var(--ink-soft)" /></div>
              <p className="text-3xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-soft)' }}>Camera off</p>
            </div>
          )}
        </div>
        {renderControls(false)}
      </Card>

      <div className="space-y-6 flex flex-col h-[85vh]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{isTutor ? 'Host controls' : 'In the room'}</h3>
            <Pill>{Object.keys(peers).length + 1} here</Pill>
          </div>
          <div className="mb-4 space-y-2 max-h-60 overflow-y-auto pr-2">
            {/* Self */}
            <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: 'var(--bg-soft)' }}>
              <span className="font-extrabold text-lg">{name} (You) {hand && '✋'}</span>
              <span style={{ color: 'var(--ink-soft)' }}>{!mic ? <MicOff size={20} /> : <Mic size={20} />}</span>
            </div>
            {/* Peers */}
            {Object.entries(peers).map(([id, p]) => (
              <div key={id} className="rounded-2xl overflow-hidden mb-3" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)' }}>
                {p.stream && !p.camOff ? (
                  <div className="h-40 bg-black"><VideoPlayer stream={p.stream} /></div>
                ) : null}
                <div className="flex items-center justify-between px-4 py-3 bg-white/50">
                  <span className="font-extrabold text-lg">{p.n}</span>
                  <span style={{ color: 'var(--ink-soft)' }}>{p.muted ? <MicOff size={20} /> : <Mic size={20} />}</span>
                </div>
              </div>
            ))}
          </div>
          {isTutor && <Btn tone={locked ? 'grape' : 'honey'} onClick={() => setLocked((v) => !v)} className="w-full justify-center">{locked ? <LockOpen size={18} /> : <Lock size={18} />}{locked ? 'Unlock room' : 'Lock room'}</Btn>}
        </Card>
        {renderChat()}
      </div>
    </div>
  )
}

/* ------------------------------- Resources -------------------------------- */

function Resources({ isTutor, courseId, list, setList }: { isTutor: boolean; courseId: string; list: Res[]; setList: React.Dispatch<React.SetStateAction<Res[]>> }) {
  const [q, setQ] = useState('')
  const shown = list.filter((f) => f.courseId === courseId && f.name.toLowerCase().includes(q.toLowerCase()))
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.resources.create(courseId, formData)
      setList((f) => [mapRes(res), ...f])
    } catch { /* ignore */ }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const removeRes = async (id: number) => {
    try {
      await api.resources.remove(id)
      setList((l) => l.filter((x) => x.id !== id))
    } catch { /* ignore */ }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2" color="var(--ink-soft)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search materials…" className="w-full rounded-full py-3 pl-12 pr-5 font-bold outline-none" style={{ border: '3px solid var(--card-line)', background: 'var(--card)', color: 'var(--ink)' }} />
        </div>
        {isTutor && (
          <label className="flex items-center gap-2 px-4 py-2 rounded-xl cursor-pointer font-bold text-sm bg-[var(--honey)] hover:opacity-90 transition border-2 border-[#4a3b12] text-[#4a3b12]">
            <Plus size={18} /> Upload
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
          </label>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {shown.map((f) => (
          <Card key={f.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: 'var(--bg-soft)', border: '3px solid var(--card-line)' }}><Comb size={22} /></div>
              <div><p className="font-extrabold">{f.name}</p><p className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{f.size}</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => alert('Downloading ' + f.name)} className="squish grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--honey)', border: '3px solid #4a3b12', color: '#4a3b12' }}><Download size={18} strokeWidth={2.6} /></button>
              {isTutor && <button onClick={() => removeRes(f.id)} className="squish grid h-10 w-10 place-items-center rounded-full" style={{ background: '#ff9db0', border: '3px solid #4a3b12', color: '#4a3b12' }}><Trash2 size={18} strokeWidth={2.6} /></button>}
            </div>
          </Card>
        ))}
        {shown.length === 0 && <Card className="text-center font-extrabold md:col-span-2"><span style={{ color: 'var(--ink-soft)' }}>No materials yet</span></Card>}
      </div>
    </div>
  )
}

/* -------------------------------- Homework -------------------------------- */

const hwBadge: Record<HW['status'], { bg: string; label: string }> = {
  open: { bg: '#fff6d6', label: 'Open' },
  submitted: { bg: '#c9f0c9', label: '✓ Submitted' },
  closed: { bg: '#ffd6de', label: '🔒 Closed' },
}

// File-browse submit box — student picks a file, then submits.
function SubmitBox({ onSubmit }: { onSubmit: () => void }) {
  const [file, setFile] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-3">
      <input ref={ref} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl p-4" style={{ background: 'var(--bg-soft)', border: '3px dashed var(--card-line)' }}>
        <Btn tone="ghost" onClick={() => ref.current?.click()}><Upload size={18} /> Browse…</Btn>
        <span className="truncate font-bold" style={{ color: file ? 'var(--ink)' : 'var(--ink-soft)' }}>{file ?? 'No file chosen'}</span>
      </div>
      <Btn onClick={onSubmit}>Submit work</Btn>
    </div>
  )
}

// Shared detail body (task + optional PDF + role actions).
function HwActions({ cur, isTutor, onSubmit, onToggleClose, onDelete }: { cur: HW; isTutor: boolean; onSubmit: () => void; onToggleClose: () => void; onDelete: () => void }) {
  if (isTutor)
    return (
      <div className="space-y-3">
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--bg-soft)' }}>
          <p className="text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--honey-deep)' }}>{cur.submissions}</p>
          <p className="font-bold" style={{ color: 'var(--ink-soft)' }}>submissions received</p>
        </div>
        <div className="flex gap-3">
          <Btn onClick={onToggleClose}>{cur.status === 'closed' ? 'Reopen' : 'Close now'}</Btn>
          <Btn tone="ghost" onClick={onDelete}><Trash2 size={18} /> Delete</Btn>
        </div>
      </div>
    )
  if (cur.status === 'open' && !cur.mySubmitted) return <SubmitBox onSubmit={onSubmit} />
  if (cur.status === 'submitted' || cur.mySubmitted) return <p className="font-extrabold" style={{ color: '#3a8a3a' }}>✓ You have submitted this. Nice!</p>
  return <p className="font-extrabold" style={{ color: '#c25a6a' }}>🔒 Deadline passed — submissions locked.</p>
}

// Full-screen PDF homework page.
function HomeworkFull({ cur, isTutor, back, onSubmit, onToggleClose, onDelete }: { cur: HW; isTutor: boolean; back: () => void; onSubmit: () => void; onToggleClose: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-5xl px-6 py-6">
        <button onClick={back} className="squish mb-4 inline-flex items-center gap-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-soft)' }}>
          <ArrowLeft size={20} strokeWidth={2.6} /> Back to homework
        </button>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: '#ffd6de', border: '2px solid #4a3b12', color: '#4a3b12' }}><FileText size={18} strokeWidth={2.6} /></span>
          <h2 className="text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{cur.title}</h2>
          <span className="rounded-full px-3 py-0.5 text-sm font-extrabold" style={{ background: hwBadge[cur.status].bg, color: '#4a3b12' }}>{hwBadge[cur.status].label}</span>
        </div>
        <p className="mb-4 font-bold" style={{ color: 'var(--ink-soft)' }}>Due {dueLabel(cur.dueDay)} · {cur.points} points</p>
        <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
          <div className="overflow-hidden rounded-[24px]" style={{ border: '3px solid var(--card-line)', background: '#fff' }}>
            {cur.pdfUrl && <iframe src={`${cur.pdfUrl}#navpanes=0`} title="Homework PDF" className="w-full" style={{ height: '80vh', border: 'none' }} />}
          </div>
          <div className="space-y-5">
            <Card>
              <h3 className="mb-2 text-xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>The task</h3>
              <p className="mb-3 font-bold" style={{ color: 'var(--ink)' }}>{cur.desc}</p>
              <Media imageUrl={cur.imageUrl} audioUrl={cur.audioUrl} />
            </Card>
            <Card>
              <HwActions cur={cur} isTutor={isTutor} onSubmit={onSubmit} onToggleClose={onToggleClose} onDelete={onDelete} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function Homework({ isTutor, courseId, list, setList }: { isTutor: boolean; courseId: string; list: HW[]; setList: React.Dispatch<React.SetStateAction<HW[]>> }) {
  const items = list.filter((h) => h.courseId === courseId)
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', dueDay: '9', points: '10', desc: '', pdfUrl: '', imageUrl: '', audioUrl: '' })
  const cur = openId != null ? list.find((h) => h.id === openId) ?? null : null

  const submit = async (id: number) => {
    try {
      await api.homework.submit(id)
      setList((l) => l.map((h) => (h.id === id ? { ...h, mySubmitted: true, submissions: h.submissions + 1 } : h)))
      setOpenId(null)
    } catch { /* ignore */ }
  }
  const toggleClose = async (id: number) => {
    try {
      const res = await api.homework.toggleClose(id) as any
      setList((l) => l.map((x) => (x.id === id ? { ...x, status: res.status } : x)))
      setOpenId(null)
    } catch { /* ignore */ }
  }
  const del = async (id: number) => {
    try {
      await api.homework.remove(id)
      setList((l) => l.filter((x) => x.id !== id))
      setOpenId(null)
    } catch { /* ignore */ }
  }
  const add = async () => {
    if (!form.title.trim()) return
    const pdf = form.pdfUrl.trim()
    try {
      const res = await api.homework.create(courseId, {
        title: form.title,
        dueDay: Number(form.dueDay) || 1,
        points: Number(form.points) || 0,
        desc: form.desc,
        kind: pdf ? 'pdf' : 'line',
        pdfUrl: pdf || undefined,
        imageUrl: form.imageUrl.trim() || undefined,
        audioUrl: form.audioUrl.trim() || undefined,
      })
      setList((l) => [...l, mapHW(res)])
      setForm({ title: '', dueDay: '9', points: '10', desc: '', pdfUrl: '', imageUrl: '', audioUrl: '' })
      setAdding(false)
    } catch { /* ignore */ }
  }
  const badge = hwBadge

  if (cur && cur.kind === 'pdf')
    return <HomeworkFull cur={cur} isTutor={isTutor} back={() => setOpenId(null)} onSubmit={() => submit(cur.id)} onToggleClose={() => toggleClose(cur.id)} onDelete={() => del(cur.id)} />

  return (
    <div className="space-y-4">
      {isTutor && <div className="flex justify-end"><Btn onClick={() => setAdding(true)}><Plus size={18} /> Add homework</Btn></div>}
      {items.map((h) => (
        <div key={h.id} className="squish pop cursor-pointer rounded-[28px] p-6" onClick={() => setOpenId(h.id)} style={{ background: 'var(--card)', border: '3px solid var(--card-line)', boxShadow: 'var(--shadow)' }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-3">
                {h.kind === 'pdf' && <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: '#ffd6de', border: '2px solid #4a3b12', color: '#4a3b12' }}><FileText size={16} strokeWidth={2.6} /></span>}
                <h3 className="text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{h.title}</h3>
                <span className="rounded-full px-3 py-0.5 text-sm font-extrabold" style={{ background: badge[h.status].bg, color: '#4a3b12' }}>{badge[h.status].label}</span>
              </div>
              <p className="font-bold" style={{ color: 'var(--ink-soft)' }}>Due {dueLabel(h.dueDay)} · {h.points} pts · {h.kind === 'pdf' ? 'PDF task' : 'Task'} {isTutor && `· ${h.submissions} submitted`}</p>
            </div>
            <span className="text-sm font-extrabold" style={{ color: 'var(--honey-deep)' }}>Open →</span>
          </div>
        </div>
      ))}
      {items.length === 0 && <Card className="text-center font-extrabold"><span style={{ color: 'var(--ink-soft)' }}>No homework yet</span></Card>}

      {cur && (
        <Modal onClose={() => setOpenId(null)}>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{cur.title}</h3>
            <span className="rounded-full px-3 py-0.5 text-sm font-extrabold" style={{ background: badge[cur.status].bg, color: '#4a3b12' }}>{badge[cur.status].label}</span>
          </div>
          <p className="mb-4 font-bold" style={{ color: 'var(--ink-soft)' }}>Due {dueLabel(cur.dueDay)} · {cur.points} points</p>
          <div className="mb-4 rounded-2xl p-4 font-bold" style={{ background: 'var(--bg-soft)', color: 'var(--ink)' }}>{cur.desc}</div>
          <Media imageUrl={cur.imageUrl} audioUrl={cur.audioUrl} />
          <HwActions cur={cur} isTutor={isTutor} onSubmit={() => submit(cur.id)} onToggleClose={() => toggleClose(cur.id)} onDelete={() => del(cur.id)} />
        </Modal>
      )}

      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <h3 className="mb-1 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>New homework</h3>
          <p className="mb-5 font-bold" style={{ color: 'var(--ink-soft)' }}>Leave the PDF link blank for a simple task line.</p>
          <div className="space-y-4">
            <input className={inputCls} style={inputStyle} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="flex gap-3">
              <input className={inputCls} style={inputStyle} type="number" placeholder="Due day (Aug)" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
              <input className={inputCls} style={inputStyle} type="number" placeholder="Points" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
            </div>
            <textarea className={inputCls} style={{ ...inputStyle, minHeight: 90 }} placeholder="Instructions…" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
            <FilePick accept="application/pdf" label="Attach PDF" value={form.pdfUrl} onPick={(v) => setForm({ ...form, pdfUrl: v })} sample={SAMPLE_PDF} />
            <MediaInputs img={form.imageUrl} audio={form.audioUrl} setImg={(v) => setForm({ ...form, imageUrl: v })} setAudio={(v) => setForm({ ...form, audioUrl: v })} />
          </div>
          <div className="mt-6 flex gap-3"><Btn onClick={add}>Post</Btn><Btn tone="ghost" onClick={() => setAdding(false)}>Cancel</Btn></div>
        </Modal>
      )}
    </div>
  )
}

/* -------------------------------- Quizzes --------------------------------- */

function QuizPlayer({ quiz, onExit, onScore }: { quiz: QQ; onExit: () => void; onScore: (pct: number) => void }) {
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correctIdx, setCorrectIdx] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const [grading, setGrading] = useState(false)
  const cur = quiz.qs[i]
  const choose = async (idx: number) => {
    if (picked != null || grading) return
    setPicked(idx)
    setGrading(true)
    try {
      /* Server grades the answer — correct_index never existed on client */
      const res = await api.quizzes.answer(quiz.id, cur.id, idx)
      setCorrectIdx(res.correctIndex)
      if (res.correct) setScore((s) => s + 1)
    } catch {
      /* If grading fails, treat as wrong */
    } finally {
      setGrading(false)
    }
  }
  const next = async () => {
    if (i + 1 < quiz.qs.length) {
      setI(i + 1)
      setPicked(null)
      setCorrectIdx(null)
    } else {
      const pct = Math.round((score / quiz.qs.length) * 100)
      setDone(true)
      try {
        const res = await api.quizzes.finish(quiz.id, pct)
        onScore(res.best)
      } catch {
        onScore(pct)
      }
    }
  }
  return (
    <Modal onClose={onExit}>
      {done ? (
        <div className="text-center">
          <Bee size={80} />
          <h3 className="mt-2 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{Math.round((score / quiz.qs.length) * 100)}%</h3>
          <p className="mb-6 font-bold" style={{ color: 'var(--ink-soft)' }}>{score} / {quiz.qs.length} correct — sweet work!</p>
          <Btn onClick={onExit}>Back to quizzes</Btn>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between"><Pill>Question {i + 1} / {quiz.qs.length}</Pill><button onClick={onExit} style={{ color: 'var(--ink-soft)' }}><X size={22} strokeWidth={2.6} /></button></div>
          <Media imageUrl={quiz.imageUrl} audioUrl={quiz.audioUrl} />
          <h3 className="mb-6 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{cur.q}</h3>
          <div className="space-y-3">
            {cur.a.map((opt, idx) => {
              const isCorrect = correctIdx != null && idx === correctIdx
              const chosen = picked === idx
              let bg = 'var(--bg-soft)'
              if (picked != null && isCorrect) bg = '#c9f0c9'
              else if (chosen) bg = '#ffd6de'
              return <button key={opt} onClick={() => choose(idx)} className="squish w-full rounded-2xl px-5 py-3 text-left font-extrabold" style={{ background: bg, border: '3px solid #4a3b12', color: '#4a3b12' }}>{opt}{grading && chosen ? ' …' : ''}</button>
            })}
          </div>
          {picked != null && !grading && <div className="mt-6"><Btn onClick={next}>{i + 1 < quiz.qs.length ? 'Next →' : 'See score'}</Btn></div>}
        </>
      )}
    </Modal>
  )
}

function Quizzes({ isTutor, courseId, list, setList }: { isTutor: boolean; courseId: string; list: QQ[]; setList: React.Dispatch<React.SetStateAction<QQ[]>> }) {
  const items = list.filter((q) => q.courseId === courseId)
  const [active, setActive] = useState<QQ | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ n: '', dueDay: '15', audioUrl: '', imageUrl: '', q: '', a1: '', a2: '', a3: '' })
  const add = async () => {
    if (!form.n.trim() || !form.q.trim()) return
    try {
      const res = await api.quizzes.create(courseId, {
        title: form.n,
        dueDay: Number(form.dueDay) || 1,
        color: '#a37bff',
        imageUrl: form.imageUrl.trim() || undefined,
        audioUrl: form.audioUrl.trim() || undefined,
        questions: [{ q: form.q, a: [form.a1 || 'A', form.a2 || 'B', form.a3 || 'C'], c: 0 }],
      })
      setList((l) => [...l, res])
      setForm({ n: '', dueDay: '15', audioUrl: '', imageUrl: '', q: '', a1: '', a2: '', a3: '' })
      setAdding(false)
    } catch { /* ignore */ }
  }
  const removeQuiz = async (id: number) => {
    try {
      await api.quizzes.remove(id)
      setList((l) => l.filter((x) => x.id !== id))
    } catch { /* ignore */ }
  }
  const saveScore = (id: number, pct: number) => setList((l) => l.map((q) => (q.id === id ? { ...q, best: Math.max(pct, q.best ?? 0) } : q)))
  return (
    <>
      {isTutor && <div className="mb-4 flex justify-end"><Btn onClick={() => setAdding(true)}><Plus size={18} /> Add quiz</Btn></div>}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((q) => (
          <Card key={q.id}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pill>{q.qs.length} questions</Pill>
                {q.audioUrl && <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}><Volume2 size={14} strokeWidth={2.6} /></span>}
                {q.imageUrl && <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}><FileText size={14} strokeWidth={2.6} /></span>}
              </div>
              {q.best != null && <span className="font-extrabold" style={{ color: 'var(--honey-deep)' }}>Best {q.best}%</span>}
            </div>
            <div className="mb-4 h-2 w-full rounded-full" style={{ background: q.color }} />
            <h3 className="mb-1 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{q.title}</h3>
            <p className="mb-4 text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>Due {dueLabel(q.dueDay)}</p>
            <div className="flex gap-2">
              <Btn tone={q.best == null ? 'grape' : 'honey'} onClick={() => setActive(q)}>{isTutor ? 'Preview' : q.best == null ? 'Start quiz' : 'Retry'}</Btn>
              {isTutor && <Btn tone="ghost" onClick={() => removeQuiz(q.id)}><Trash2 size={18} /></Btn>}
            </div>
          </Card>
        ))}
        {items.length === 0 && <Card className="text-center font-extrabold"><span style={{ color: 'var(--ink-soft)' }}>No quizzes yet</span></Card>}
      </div>
      {active && <QuizPlayer quiz={active} onExit={() => setActive(null)} onScore={(pct) => saveScore(active.id, pct)} />}
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <h3 className="mb-5 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>New quiz</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <input className={inputCls} style={inputStyle} placeholder="Quiz title" value={form.n} onChange={(e) => setForm({ ...form, n: e.target.value })} />
              <input className={inputCls} style={inputStyle} type="number" placeholder="Due day" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
            </div>
            <MediaInputs img={form.imageUrl} audio={form.audioUrl} setImg={(v) => setForm({ ...form, imageUrl: v })} setAudio={(v) => setForm({ ...form, audioUrl: v })} />
            <input className={inputCls} style={inputStyle} placeholder="First question" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
            <p className="text-sm font-extrabold" style={{ color: 'var(--ink-soft)' }}>Answers (first is correct)</p>
            <input className={inputCls} style={inputStyle} placeholder="Correct answer" value={form.a1} onChange={(e) => setForm({ ...form, a1: e.target.value })} />
            <input className={inputCls} style={inputStyle} placeholder="Wrong answer" value={form.a2} onChange={(e) => setForm({ ...form, a2: e.target.value })} />
            <input className={inputCls} style={inputStyle} placeholder="Wrong answer" value={form.a3} onChange={(e) => setForm({ ...form, a3: e.target.value })} />
          </div>
          <div className="mt-6 flex gap-3"><Btn onClick={add}>Create</Btn><Btn tone="ghost" onClick={() => setAdding(false)}>Cancel</Btn></div>
        </Modal>
      )}
    </>
  )
}

/* ----------------------------- Flashcards --------------------------------- */

type FCDeck = { id: number; course_id: string; name: string; description: string; created_by: string; card_count: number }
type FCCard = { id: number; deck_id: number; front: string; back: string; image_url?: string; created_by: string; progress: { ease_factor: number; interval_days: number; repetitions: number; next_review: string; last_reviewed: string } | null }

function speak(text: string) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  }
}

function FlashcardStudy({ deckId, deckName, onBack }: { deckId: number; deckName: string; onBack: () => void }) {
  const [cards, setCards] = useState<FCCard[]>([])
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState<Record<number, boolean>>({})
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [swipeDir, setSwipeDir] = useState<string | null>(null)

  useEffect(() => {
    api.flashcards.listCards(deckId).then(c => { setCards(c); setLoading(false) }).catch(() => setLoading(false))
  }, [deckId])

  const current = cards[idx]
  const known = Object.values(results).filter(Boolean).length
  const unknown = Object.values(results).filter(v => !v).length

  const handleReview = async (quality: number) => {
    if (!current) return
    const isKnown = quality >= 3
    setResults(r => ({ ...r, [current.id]: isKnown }))
    setSwipeDir(isKnown ? 'right' : 'left')
    api.flashcards.reviewCard(current.id, quality).catch(() => {})

    setTimeout(() => {
      setSwipeDir(null)
      setFlipped(false)
      if (idx + 1 >= cards.length) {
        setDone(true)
      } else {
        setIdx(i => i + 1)
      }
    }, 250)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dx = e.changedTouches[0].clientX - touchStart.current.x
    const dy = e.changedTouches[0].clientY - touchStart.current.y
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    if (Math.max(absDx, absDy) < 60) return // too small, treat as tap

    if (absDx > absDy) {
      // Horizontal swipe
      handleReview(dx > 0 ? 4 : 1) // right = known, left = unknown
    } else {
      // Vertical swipe
      handleReview(dy > 0 ? 4 : 1) // down = known, up = unknown
    }
    touchStart.current = null
  }

  if (loading) return <Card><p className="text-center font-bold" style={{ color: 'var(--ink-soft)' }}>Loading cards...</p></Card>
  if (cards.length === 0) return <Card><p className="text-center font-bold" style={{ color: 'var(--ink-soft)' }}>No cards in this deck yet.</p><div className="mt-4 text-center"><Btn tone="ghost" onClick={onBack}>Back</Btn></div></Card>

  if (done) {
    return (
      <Card>
        <div className="text-center">
          <div className="mb-4 text-6xl">🎉</div>
          <h3 className="mb-2 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Session Complete!</h3>
          <p className="mb-6 font-bold" style={{ color: 'var(--ink-soft)' }}>
            You reviewed {cards.length} cards
          </p>
          <div className="mb-6 flex justify-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-extrabold" style={{ color: '#22c55e' }}>{known}</div>
              <div className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>Known</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-extrabold" style={{ color: '#ef4444' }}>{unknown}</div>
              <div className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>Review again</div>
            </div>
          </div>
          <div className="flex justify-center gap-3">
            <Btn onClick={() => { setIdx(0); setFlipped(false); setResults({}); setDone(false) }}>Study Again</Btn>
            <Btn tone="ghost" onClick={onBack}>Back to Decks</Btn>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="squish inline-flex items-center gap-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-soft)' }}>
          <ArrowLeft size={20} strokeWidth={2.6} /> Back
        </button>
        <Pill>{idx + 1} / {cards.length}</Pill>
      </div>

      <h3 className="mb-4 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{deckName}</h3>

      {/* Progress bar */}
      <div className="mb-6 h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-soft)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${((idx) / cards.length) * 100}%`, background: 'linear-gradient(90deg, #22c55e, var(--honey))' }} />
      </div>

      {/* Card */}
      <div
        ref={cardRef}
        onClick={() => setFlipped(f => !f)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`squish relative mx-auto cursor-pointer select-none overflow-hidden rounded-[32px] p-8 transition-all duration-300 ${swipeDir === 'right' ? 'translate-x-[120%] opacity-0' : swipeDir === 'left' ? '-translate-x-[120%] opacity-0' : ''}`}
        style={{
          background: 'var(--card)',
          border: '4px solid ' + (flipped ? '#22c55e' : '#4a3b12'),
          boxShadow: 'var(--shadow)',
          minHeight: 280,
          maxWidth: 500,
          perspective: '1000px',
        }}
      >
        <div className="flex flex-col items-center justify-center" style={{ minHeight: 200 }}>
          {!flipped ? (
            <>
              {current.image_url && (
                <img src={current.image_url} alt="" className="mb-4 max-h-40 rounded-2xl object-contain" style={{ border: '3px solid var(--card-line)' }} />
              )}
              <p className="text-center text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{current.front}</p>
              <button
                onClick={(e) => { e.stopPropagation(); speak(current.front) }}
                className="squish mt-3 grid h-10 w-10 place-items-center rounded-full"
                style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}
              >
                <Volume2 size={18} strokeWidth={2.6} />
              </button>
            </>
          ) : (
            <>
              <p className="text-center text-2xl font-bold" style={{ color: '#22c55e', fontFamily: 'var(--font-display)' }}>{current.back}</p>
              <button
                onClick={(e) => { e.stopPropagation(); speak(current.back) }}
                className="squish mt-3 grid h-10 w-10 place-items-center rounded-full"
                style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}
              >
                <Volume2 size={18} strokeWidth={2.6} />
              </button>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>
          {flipped ? 'Tap to see front' : 'Tap to flip'}
        </p>
      </div>

      {/* Desktop buttons */}
      <div className="mt-6 flex justify-center gap-4">
        <button
          onClick={() => handleReview(1)}
          className="squish flex items-center gap-2 rounded-full px-6 py-3 font-extrabold"
          style={{ fontFamily: 'var(--font-display)', background: '#fee2e2', color: '#dc2626', border: '3px solid #dc2626' }}
        >
          <X size={18} strokeWidth={3} /> Don't know
        </button>
        <button
          onClick={() => handleReview(4)}
          className="squish flex items-center gap-2 rounded-full px-6 py-3 font-extrabold"
          style={{ fontFamily: 'var(--font-display)', background: '#dcfce7', color: '#16a34a', border: '3px solid #16a34a' }}
        >
          ✓ Know it
        </button>
      </div>

      <p className="mt-4 text-center text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>
        On mobile: swipe right/down = know · swipe left/up = don't know
      </p>
    </div>
  )
}

function Flashcards({ isTutor, courseId }: { isTutor: boolean; courseId: string }) {
  const [decks, setDecks] = useState<FCDeck[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [studyDeck, setStudyDeck] = useState<FCDeck | null>(null)
  const [editDeck, setEditDeck] = useState<FCDeck | null>(null)
  const [editCards, setEditCards] = useState<FCCard[]>([])
  const [cardForm, setCardForm] = useState({ front: '', back: '', image_url: '' })
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.flashcards.listDecks(courseId).then(setDecks).catch(() => {})
  }, [courseId])

  const createDeck = async () => {
    if (!form.name.trim()) return
    try {
      const deck = await api.flashcards.createDeck(courseId, { name: form.name, description: form.description })
      setDecks(d => [deck, ...d])
      setForm({ name: '', description: '' })
      setAdding(false)
    } catch { /* ignore */ }
  }

  const deleteDeck = async (id: number) => {
    try {
      await api.flashcards.deleteDeck(id)
      setDecks(d => d.filter(x => x.id !== id))
    } catch { /* ignore */ }
  }

  const openEdit = async (deck: FCDeck) => {
    setEditDeck(deck)
    try {
      const cards = await api.flashcards.listCards(deck.id)
      setEditCards(cards)
    } catch { setEditCards([]) }
  }

  const addCard = async () => {
    if (!editDeck || !cardForm.front.trim() || !cardForm.back.trim()) return
    try {
      const card = await api.flashcards.addCard(editDeck.id, {
        front: cardForm.front,
        back: cardForm.back,
        image_url: cardForm.image_url || undefined,
      })
      setEditCards(c => [...c, card])
      setDecks(d => d.map(x => x.id === editDeck.id ? { ...x, card_count: x.card_count + 1 } : x))
      setCardForm({ front: '', back: '', image_url: '' })
    } catch { /* ignore */ }
  }

  const deleteCard = async (cardId: number) => {
    if (!editDeck) return
    try {
      await api.flashcards.deleteCard(cardId)
      setEditCards(c => c.filter(x => x.id !== cardId))
      setDecks(d => d.map(x => x.id === editDeck.id ? { ...x, card_count: Math.max(0, x.card_count - 1) } : x))
    } catch { /* ignore */ }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editDeck) return
    setUploading(true)
    try {
      const { url } = await api.flashcards.uploadImage(editDeck.id, file)
      setCardForm(f => ({ ...f, image_url: url }))
    } catch { /* ignore */ }
    setUploading(false)
  }

  // Study mode
  if (studyDeck) {
    return <FlashcardStudy deckId={studyDeck.id} deckName={studyDeck.name} onBack={() => setStudyDeck(null)} />
  }

  // Edit mode (manage cards in a deck)
  if (editDeck) {
    return (
      <div>
        <button onClick={() => setEditDeck(null)} className="squish mb-4 inline-flex items-center gap-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-soft)' }}>
          <ArrowLeft size={20} strokeWidth={2.6} /> Back to decks
        </button>
        <h3 className="mb-2 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{editDeck.name}</h3>
        <p className="mb-6 font-bold" style={{ color: 'var(--ink-soft)' }}>{editDeck.description || 'No description'}</p>

        {/* Add card form */}
        <Card className="mb-6">
          <h4 className="mb-4 text-xl font-extrabold" style={{ fontFamily: 'var(--font-display)' }}>Add new card</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <input className={inputCls} style={inputStyle} placeholder="Front (term / question)" value={cardForm.front} onChange={e => setCardForm(f => ({ ...f, front: e.target.value }))} />
            <input className={inputCls} style={inputStyle} placeholder="Back (definition / answer)" value={cardForm.back} onChange={e => setCardForm(f => ({ ...f, back: e.target.value }))} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="squish flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 font-extrabold text-sm" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}>
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Add image'}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
            </label>
            {cardForm.image_url && <img src={cardForm.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" style={{ border: '2px solid var(--card-line)' }} />}
          </div>
          <div className="mt-4">
            <Btn onClick={addCard}><Plus size={18} /> Add card</Btn>
          </div>
        </Card>

        {/* Card list */}
        <div className="space-y-3">
          {editCards.map((c, i) => (
            <div key={c.id} className="flex items-center gap-4 rounded-2xl px-5 py-4" style={{ background: 'var(--card)', border: '3px solid var(--card-line)' }}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-extrabold text-sm" style={{ background: 'var(--honey)', border: '2px solid #4a3b12', color: '#4a3b12' }}>{i + 1}</span>
              {c.image_url && <img src={c.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" style={{ border: '2px solid var(--card-line)' }} />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-extrabold">{c.front}</p>
                <p className="truncate text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{c.back}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); speak(c.front) }} className="squish grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}>
                <Volume2 size={14} />
              </button>
              <button onClick={() => deleteCard(c.id)} className="squish grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: '#fee2e2', border: '2px solid #dc2626', color: '#dc2626' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {editCards.length === 0 && <p className="py-8 text-center font-bold" style={{ color: 'var(--ink-soft)' }}>No cards yet. Add your first card above!</p>}
        </div>
      </div>
    )
  }

  // Deck list
  return (
    <>
      <div className="mb-4 flex justify-end"><Btn onClick={() => setAdding(true)}><Plus size={18} /> New deck</Btn></div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {decks.map(d => (
          <Card key={d.id}>
            <div className="mb-3 flex items-center justify-between">
              <Pill>{d.card_count} cards</Pill>
            </div>
            <h3 className="mb-1 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{d.name}</h3>
            <p className="mb-4 text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{d.description || 'No description'}</p>
            <div className="flex flex-wrap gap-2">
              <Btn tone={d.card_count > 0 ? 'grape' : 'ghost'} onClick={() => d.card_count > 0 ? setStudyDeck(d) : openEdit(d)}>
                {d.card_count > 0 ? 'Study' : 'Add cards'}
              </Btn>
              <Btn tone="ghost" onClick={() => openEdit(d)}><PenTool size={16} /> Edit</Btn>
              <Btn tone="ghost" onClick={() => deleteDeck(d.id)}><Trash2 size={16} /></Btn>
            </div>
          </Card>
        ))}
        {decks.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <div className="mb-4 text-5xl">📚</div>
            <p className="font-bold" style={{ color: 'var(--ink-soft)' }}>No flashcard decks yet. Create one to start studying!</p>
          </div>
        )}
      </div>
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <h3 className="mb-5 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>New flashcard deck</h3>
          <div className="space-y-4">
            <input className={inputCls} style={inputStyle} placeholder="Deck name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className={inputCls} style={inputStyle} placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="mt-6 flex gap-3"><Btn onClick={createDeck}>Create</Btn><Btn tone="ghost" onClick={() => setAdding(false)}>Cancel</Btn></div>
        </Modal>
      )}
    </>
  )
}

/* ---------------------------- Course workspace ---------------------------- */

const subTabs = ['Meeting', 'Homework', 'Quizzes', 'Flashcards', 'Resources'] as const
type Sub = (typeof subTabs)[number]

function CourseWorkspace({
  course,
  isTutor,
  name,
  back,
  hw,
  setHw,
  quizzes,
  setQuizzes,
  resources,
  setResources,
}: {
  course: Course
  isTutor: boolean
  name: string
  back: () => void
  hw: HW[]
  setHw: React.Dispatch<React.SetStateAction<HW[]>>
  quizzes: QQ[]
  setQuizzes: React.Dispatch<React.SetStateAction<QQ[]>>
  resources: Res[]
  setResources: React.Dispatch<React.SetStateAction<Res[]>>
}) {
  const [sub, setSub] = useState<Sub>('Meeting')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [inviteMsg, setInviteMsg] = useState('')

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviteStatus('loading')
    setInviteMsg('')
    try {
      await api.courses.invite(course.id, inviteEmail.trim())
      setInviteStatus('success')
      setInviteMsg('Invitation sent! They have been added to the course.')
      setInviteEmail('')
    } catch (err: any) {
      setInviteStatus('error')
      setInviteMsg(err.message || err.body?.error || 'Failed to invite')
    }
  }

  return (
    <div>
      <button onClick={back} className="squish mb-4 inline-flex items-center gap-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-soft)' }}>
        <ArrowLeft size={20} strokeWidth={2.6} /> All courses
      </button>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: course.color, border: '3px solid #4a3b12' }}><Comb size={28} /></div>
          <div>
            <h2 className="text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{course.name}</h2>
            <p className="font-bold" style={{ color: 'var(--ink-soft)' }}>{course.goal} · {course.students} learners</p>
          </div>
        </div>
        <button onClick={() => setInviteOpen(true)} className="squish rounded-2xl px-5 py-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', background: '#a37bff', color: '#fff', border: '3px solid #4a3b12' }}>+ Invite</button>
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setInviteOpen(false)}>
          <div className="w-full max-w-sm rounded-[36px] bg-white p-6" style={{ border: '4px solid #4a3b12', boxShadow: '0 12px 0 rgba(74,59,18,0.18)' }} onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-2xl font-bold text-center" style={{ fontFamily: 'var(--font-display)', color: '#4a3b12' }}>Invite Student</h3>
            <form onSubmit={handleInvite}>
              <input 
                type="email" 
                placeholder="Student's email" 
                value={inviteEmail} 
                onChange={e => setInviteEmail(e.target.value)} 
                className="w-full rounded-2xl p-3 font-bold mb-4 outline-none" 
                style={{ border: '3px solid #4a3b12', background: '#fffdf4', color: '#4a3b12' }} 
              />
              {inviteMsg && (
                <p className={`mb-4 text-sm font-bold text-center ${inviteStatus === 'error' ? 'text-red-500' : 'text-green-600'}`}>{inviteMsg}</p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => {setInviteOpen(false); setInviteStatus('idle'); setInviteMsg('');}} className="squish flex-1 rounded-2xl py-3 font-extrabold text-sm" style={{ border: '3px solid #4a3b12', background: '#fffdf4', color: '#4a3b12' }}>Cancel</button>
                <button type="submit" disabled={inviteStatus === 'loading'} className="squish flex-1 rounded-2xl py-3 font-extrabold text-sm" style={{ border: '3px solid #4a3b12', background: '#ffcf3f', color: '#4a3b12' }}>{inviteStatus === 'loading' ? '...' : 'Send'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="mb-6 flex flex-wrap gap-2">
        {subTabs.map((t) => (
          <button key={t} onClick={() => setSub(t)} className="squish rounded-full px-5 py-2.5 font-extrabold" style={{ fontFamily: 'var(--font-display)', background: sub === t ? 'var(--honey)' : 'var(--card)', color: sub === t ? '#4a3b12' : 'var(--ink-soft)', border: '3px solid ' + (sub === t ? '#4a3b12' : 'var(--card-line)') }}>{t}</button>
        ))}
      </div>
      <div key={sub}>
        {sub === 'Meeting' && <Meeting isTutor={isTutor} name={name} courseId={course.id} />}
        {sub === 'Homework' && <Homework isTutor={isTutor} courseId={course.id} list={hw} setList={setHw} />}
        {sub === 'Quizzes' && <Quizzes isTutor={isTutor} courseId={course.id} list={quizzes} setList={setQuizzes} />}
        {sub === 'Resources' && <Resources isTutor={isTutor} courseId={course.id} list={resources} setList={setResources} />}
        {sub === 'Flashcards' && <Flashcards isTutor={isTutor} courseId={course.id} />}
      </div>
    </div>
  )
}

/* ----------------------------- Courses list ------------------------------- */

function CoursesList({ courses, setCourses, isTutor, onOpen, isExplore }: { courses: Course[]; setCourses: React.Dispatch<React.SetStateAction<Course[]>>; isTutor: boolean; onOpen: (c: Course) => void; isExplore?: boolean }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', goal: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [joining, setJoining] = useState<string | null>(null)

  const displayedCourses = isExplore 
    ? courses.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.goal.toLowerCase().includes(searchQuery.toLowerCase()))
    : courses.filter(c => c.is_enrolled)

  const add = async () => {
    if (!form.name.trim()) return
    try {
      const res = await api.courses.create({ name: form.name, goal: form.goal || 'New course' })
      setCourses((l) => [...l, { ...res, is_enrolled: true }])
      setForm({ name: '', goal: '' })
      setAdding(false)
    } catch { /* ignore */ }
  }
  const removeCourse = async (id: string) => {
    try {
      await api.courses.remove(id)
      setCourses((l) => l.filter((x) => x.id !== id))
      setConfirm(null)
    } catch { /* ignore */ }
  }
  const joinCourse = async (id: string) => {
    setJoining(id)
    try {
      await api.courses.join(id)
      setCourses((l) => l.map(c => c.id === id ? { ...c, is_enrolled: true, students: c.students + 1 } : c))
    } catch (e: any) {
      alert(e.message || "Failed to join course")
    } finally {
      setJoining(null)
    }
  }

  return (
    <>
      {isExplore && (
        <div className="mb-6 relative">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2" color="var(--ink-soft)" />
          <input 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder="Search all courses..." 
            className="w-full rounded-full py-3 pl-12 pr-5 font-bold outline-none" 
            style={{ border: '3px solid var(--card-line)', background: 'var(--card)', color: 'var(--ink)' }} 
          />
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {displayedCourses.map((c) => (
          <div key={c.id} className="squish pop rounded-[28px] p-6" style={{ background: 'var(--card)', border: '3px solid var(--card-line)', boxShadow: 'var(--shadow)' }}>
            <div className="mb-4 flex items-start justify-between">
              <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: c.color, border: '3px solid #4a3b12' }}><Comb size={24} /></div>
              <Pill>{c.students} learners</Pill>
            </div>
            <h3 className="text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{c.name}</h3>
            <p className="mb-4 font-bold" style={{ color: 'var(--ink-soft)' }}>{c.goal}</p>
            <div className="mb-2 flex justify-between text-sm font-extrabold" style={{ color: 'var(--ink-soft)' }}><span>Progress</span><span>{c.progress}%</span></div>
            <div className="mb-5 h-4 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-soft)' }}><div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.progress}%`, background: 'linear-gradient(90deg,var(--honey-deep),var(--honey))' }} /></div>
            <div className="flex flex-wrap items-center gap-2">
              {c.is_enrolled ? (
                <Btn onClick={() => onOpen(c)}>Open course</Btn>
              ) : (
                isTutor ? (
                  <Btn tone="ghost" onClick={() => onOpen(c)}>View only</Btn>
                ) : (
                  <Btn tone="honey" onClick={() => joinCourse(c.id)}>
                    {joining === c.id ? 'Joining...' : 'Join Course'}
                  </Btn>
                )
              )}
              
              {isTutor && c.is_enrolled &&
                (confirm === c.id ? (
                  <><span className="font-extrabold">Delete?</span><Btn tone="grape" onClick={() => removeCourse(c.id)}>Yes</Btn><Btn tone="ghost" onClick={() => setConfirm(null)}>No</Btn></>
                ) : (
                  <Btn tone="ghost" onClick={() => setConfirm(c.id)}><Trash2 size={18} /></Btn>
                ))}
            </div>
          </div>
        ))}
        {!isExplore && isTutor && (
          <div className="squish grid cursor-pointer place-items-center rounded-[28px] p-6 text-center" onClick={() => setAdding(true)} style={{ background: 'var(--card)', border: '3px dashed var(--card-line)' }}>
            <div>
              <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--honey)', border: '3px solid #4a3b12', color: '#4a3b12' }}><Plus size={28} strokeWidth={3} /></span>
              <p className="font-extrabold" style={{ color: 'var(--ink-soft)' }}>Start a new hive</p>
            </div>
          </div>
        )}
      </div>
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <h3 className="mb-5 text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>New course</h3>
          <div className="space-y-4">
            <input className={inputCls} style={inputStyle} placeholder="Course name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} style={inputStyle} placeholder="Goal / subtitle" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </div>
          <div className="mt-6 flex gap-3"><Btn onClick={add}>Create</Btn><Btn tone="ghost" onClick={() => setAdding(false)}>Cancel</Btn></div>
        </Modal>
      )}
    </>
  )
}

/* --------------------------- Personal Schedule ---------------------------- */

type Deadline = { day: number; label: string; sub: string; tone: string }

function Schedule({ courses, hw, quizzes, reminders, setReminders }: { courses: Course[]; hw: HW[]; quizzes: QQ[]; reminders: Reminder[]; setReminders: React.Dispatch<React.SetStateAction<Reminder[]>> }) {
  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? 'Course'
  const deadlines: Deadline[] = [
    ...hw.map((h) => ({ day: h.dueDay, label: h.title, sub: courseName(h.courseId) + ' · homework', tone: '#ffcf3f' })),
    ...quizzes.map((q) => ({ day: q.dueDay, label: q.title, sub: courseName(q.courseId) + ' · quiz', tone: '#a37bff' })),
    ...reminders.map((r) => ({ day: r.day, label: r.label, sub: 'Personal reminder', tone: '#ff9db0' })),
  ].sort((a, b) => a.day - b.day)

  const byDay = new Map<number, Deadline[]>()
  deadlines.forEach((d) => byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]))

  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const startPad = 6
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: 31 }, (_, i) => i + 1)]

  const addReminder = async (day: number) => {
    const label = prompt(`Add reminder on ${dueLabel(day)}:`)
    if (label) {
      try {
        const res = await api.reminders.create({ day, label })
        setReminders((r) => [...r, res])
      } catch { /* ignore */ }
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-3xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{MONTH}</h3>
          <div className="flex gap-2">
            <button className="squish grid h-11 w-11 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '3px solid var(--card-line)', color: 'var(--ink)' }}><ChevronLeft size={20} strokeWidth={2.6} /></button>
            <button className="squish grid h-11 w-11 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '3px solid var(--card-line)', color: 'var(--ink)' }}><ChevronRight size={20} strokeWidth={2.6} /></button>
          </div>
        </div>
        <div className="mb-2 grid grid-cols-7 gap-2 text-center">{dow.map((d, i) => <span key={i} className="text-sm font-extrabold" style={{ color: 'var(--ink-soft)' }}>{d}</span>)}</div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((d, i) => {
            if (d == null) return <div key={i} />
            const evs = byDay.get(d)
            return (
              <button key={i} onClick={() => addReminder(d)} className="squish relative aspect-square rounded-2xl p-1.5 text-left" style={{ background: evs ? evs[0].tone : 'var(--bg-soft)', border: '2px solid ' + (evs ? '#4a3b12' : 'transparent') }}>
                <span className="text-sm font-extrabold" style={{ color: '#4a3b12' }}>{d}</span>
                {evs && <span className="absolute inset-x-1 bottom-1 truncate text-[10px] font-extrabold" style={{ color: '#4a3b12' }}>{evs.length > 1 ? `${evs.length} events` : evs[0].label}</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-4 text-sm font-extrabold" style={{ color: 'var(--ink-soft)' }}>
          {[['#ffcf3f', 'Homework'], ['#a37bff', 'Quiz'], ['#ff9db0', 'Reminder']].map(([c, l]) => <span key={l} className="flex items-center gap-2"><span className="h-4 w-4 rounded-full" style={{ background: c, border: '2px solid #4a3b12' }} />{l}</span>)}
        </div>
        <p className="mt-4 text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>Tap any day to add a personal reminder.</p>
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <Bell size={22} strokeWidth={2.6} color="var(--honey-deep)" />
          <h3 className="text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Upcoming</h3>
        </div>
        <div className="space-y-3">
          {deadlines.length === 0 && <p className="font-bold" style={{ color: 'var(--ink-soft)' }}>Nothing scheduled 🎉</p>}
          {deadlines.map((d, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--bg-soft)' }}>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: d.tone, border: '2px solid #4a3b12' }}>
                <div className="text-center leading-none">
                  <div className="text-[9px] font-extrabold" style={{ color: '#4a3b12' }}>AUG</div>
                  <div className="text-base font-extrabold" style={{ color: '#4a3b12', fontFamily: 'var(--font-display)' }}>{d.day}</div>
                </div>
              </div>
              <div className="min-w-0">
                <p className="truncate font-extrabold">{d.label}</p>
                <p className="truncate text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{d.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ----------------------------- My Resources ------------------------------- */

function MyResources() {
  const [data, setData] = useState<{ resources: any[]; decks: any[] }>({ resources: [], decks: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.myResources.list().then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <Card><p className="text-center font-bold" style={{ color: 'var(--ink-soft)' }}>Loading...</p></Card>

  return (
    <div className="space-y-8">
      {/* My uploaded resources */}
      <div>
        <h3 className="mb-4 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <span className="mr-2">📁</span>My Uploaded Files
        </h3>
        {data.resources.length === 0 ? (
          <Card><p className="font-bold" style={{ color: 'var(--ink-soft)' }}>You haven't uploaded any files yet.</p></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.resources.map((r: any) => (
              <Card key={r.id}>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'var(--honey)', border: '2px solid #4a3b12', color: '#4a3b12' }}>
                    <FileText size={20} strokeWidth={2.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold">{r.name}</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{r.size}</p>
                  </div>
                  {r.file_url && (
                    <a href={r.file_url} target="_blank" rel="noreferrer" className="squish grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-soft)', border: '2px solid var(--card-line)', color: 'var(--ink-soft)' }}>
                      <Download size={16} />
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* My flashcard decks */}
      <div>
        <h3 className="mb-4 text-2xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          <span className="mr-2">📚</span>My Flashcard Decks
        </h3>
        {data.decks.length === 0 ? (
          <Card><p className="font-bold" style={{ color: 'var(--ink-soft)' }}>You haven't created any flashcard decks yet.</p></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.decks.map((d: any) => (
              <Card key={d.id}>
                <Pill>{d.card_count} cards</Pill>
                <h4 className="mt-3 text-xl font-extrabold" style={{ fontFamily: 'var(--font-display)' }}>{d.name}</h4>
                <p className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>{d.description || 'No description'}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* --------------------------------- shell ---------------------------------- */

export default function App() {
  const [session, setSession] = useState<{ name: string; role: Role } | null>(null)
  const [dark, setDark] = useState(false)
  const [view, setView] = useState<'courses' | 'explore' | 'schedule' | 'myresources'>('courses')
  const [openCourse, setOpenCourse] = useState<Course | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [courses, setCourses] = useState<Course[]>([])
  const [hw, setHw] = useState<HW[]>([])
  const [quizzes, setQuizzes] = useState<QQ[]>([])
  const [resources, setResources] = useState<Res[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])

  /* Check for existing session cookie on mount */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        setSession({ 
          name: currentSession.user.user_metadata?.name || 'User', 
          role: (currentSession.user.user_metadata?.role as Role) || 'student' 
        })
      }
    }).catch(() => {})
    .finally(() => setCheckingAuth(false))
  }, [])

  /* Fetch all data when session is established */
  const loadData = useCallback(async () => {
    if (!session) return
    try {
      const [c, r] = await Promise.all([
        api.courses.list(),
        api.reminders.list(),
      ])
      setCourses(c)
      setReminders(r)
    } catch { /* ignore */ }
  }, [session])

  useEffect(() => { loadData() }, [loadData])

  /* Fetch course-specific data when a course is opened */
  useEffect(() => {
    if (!openCourse) return
    const courseId = openCourse.id
    Promise.all([
      api.homework.list(courseId).then((rows) => setHw(rows.map(mapHW))),
      api.quizzes.list(courseId).then((rows) => setQuizzes(rows)),
      api.resources.list(courseId).then((rows) => setResources(rows.map(mapRes))),
    ]).catch(() => { /* ignore */ })
  }, [openCourse])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const isTutor = session?.role === 'tutor'
  if (checkingAuth) return <div className="grid min-h-screen place-items-center" style={{ background: 'var(--bg)' }}><Bee size={80} /></div>
  if (!session) return <Login onEnter={(name, role) => setSession({ name, role })} />

  const navBtn = (v: 'courses' | 'explore' | 'schedule' | 'myresources', label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button
      onClick={() => {
        setView(v)
        setOpenCourse(null)
      }}
      className="squish inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-extrabold"
      style={{ fontFamily: 'var(--font-display)', background: view === v && !openCourse ? 'var(--honey)' : 'var(--card)', color: view === v && !openCourse ? '#4a3b12' : 'var(--ink-soft)', border: '3px solid ' + (view === v && !openCourse ? '#4a3b12' : 'var(--card-line)') }}
    >
      <Icon size={18} /> {label}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="relative" style={{ background: 'var(--honey)', borderBottom: '4px solid #4a3b12' }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-2">
            <Bee size={44} />
            <span className="text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: '#4a3b12' }}>edu<span style={{ color: '#fff' }}>BUZZ</span></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 font-extrabold sm:flex" style={{ color: '#4a3b12' }}>
              {session.name}
              <span className="rounded-full px-3 py-0.5 text-sm" style={{ background: isTutor ? '#a37bff' : '#fffdf4', color: isTutor ? '#fff' : '#4a3b12', border: '2px solid #4a3b12' }}>{isTutor ? 'Tutor' : 'Student'}</span>
            </span>
            <button onClick={() => setDark((v) => !v)} className="squish rounded-full px-5 py-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', background: '#fffdf4', color: '#4a3b12', border: '3px solid #4a3b12' }}>{dark ? 'Light' : 'Dark'}</button>
            <button onClick={async () => { try { await supabase.auth.signOut() } catch {} setSession(null) }} className="squish rounded-full px-5 py-2 font-extrabold" style={{ fontFamily: 'var(--font-display)', background: '#4a3b12', color: 'var(--honey)', border: '3px solid #4a3b12' }}>Exit</button>
          </div>
        </div>
        <HoneyEdge />
      </header>

      <nav className="mx-auto mt-24 max-w-6xl px-6">
        <div className="flex flex-wrap gap-2">
          {navBtn('courses', 'My Courses', Comb)}
          {navBtn('explore', 'Explore', Search)}
          {navBtn('schedule', 'My Schedule', CalendarDays)}
          {navBtn('myresources', 'My Resources', FileText)}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {openCourse ? (
          <CourseWorkspace course={openCourse} isTutor={isTutor} name={session.name} back={() => setOpenCourse(null)} hw={hw} setHw={setHw} quizzes={quizzes} setQuizzes={setQuizzes} resources={resources} setResources={setResources} />
        ) : view === 'courses' ? (
          <>
            <h2 className="mb-6 text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>My Courses</h2>
            <CoursesList courses={courses} setCourses={setCourses} isTutor={isTutor} onOpen={setOpenCourse} isExplore={false} />
          </>
        ) : view === 'explore' ? (
          <>
            <h2 className="mb-6 text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>Explore Courses</h2>
            <CoursesList courses={courses} setCourses={setCourses} isTutor={isTutor} onOpen={setOpenCourse} isExplore={true} />
          </>
        ) : view === 'schedule' ? (
          <>
            <h2 className="mb-6 text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>My Schedule</h2>
            <Schedule courses={courses} hw={hw} quizzes={quizzes} reminders={reminders} setReminders={setReminders} />
          </>
        ) : view === 'myresources' ? (
          <>
            <h2 className="mb-6 text-4xl" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>My Resources</h2>
            <MyResources />
          </>
        ) : null}
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-center font-bold" style={{ color: 'var(--ink-soft)' }}>eduBUZZ · sweet, secure, guest-friendly learning 🍯</footer>
    </div>
  )
}
