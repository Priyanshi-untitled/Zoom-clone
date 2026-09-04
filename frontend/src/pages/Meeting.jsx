import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { io } from 'socket.io-client'
import axios from 'axios'
import { BASE_URL } from '../config'
import './Meeting.css'

const peerConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" }
    ],
    iceCandidatePoolSize: 10
}

// HD Bitrate Booster to prevent blurriness and pixelation in WebRTC video feeds
const boostSdpBitrate = (sdp, bitrateKbps = 3500) => {
    if (!sdp) return sdp
    let modifiedSdp = sdp.replace(/m=video ([^\r\n]+)([\r\n]+)/g, (match) => {
        return `${match}b=AS:${bitrateKbps}\r\nb=TIAS:${bitrateKbps * 1000}\r\n`
    })
    modifiedSdp = modifiedSdp.replace(/(a=fmtp:\d+ [^\r\n]+)/g, (match) => {
        if (!match.includes('x-google-min-bitrate')) {
            return `${match};x-google-min-bitrate=1500;x-google-start-bitrate=2500;x-google-max-bitrate=5000`
        }
        return match
    })
    return modifiedSdp
}

// Polished Remote Video component with dedicated persistent audio element to guarantee mic audio always plays
function RemoteVideo({ stream, name, isCameraOff, isMuted, isSpeaking }) {
    const videoRef = useRef(null)
    const audioRef = useRef(null)

    useEffect(() => {
        if (videoRef.current && stream && !isCameraOff) {
            if (videoRef.current.srcObject !== stream) {
                videoRef.current.srcObject = stream
            }
            videoRef.current.play().catch(() => {})
        }
    }, [stream, isCameraOff])

    useEffect(() => {
        if (audioRef.current && stream) {
            if (audioRef.current.srcObject !== stream) {
                audioRef.current.srcObject = stream
            }
            audioRef.current.play().catch(() => {})
        }
    }, [stream])

    const getInitials = (userName) => {
        if (!userName) return "?";
        return userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    return (
        <div className={`video-box ${isCameraOff || !stream ? 'camera-off' : ''} ${isSpeaking && !isMuted ? 'speaking-border' : ''}`}>
            {/* Dedicated hidden audio element to ensure remote mic audio ALWAYS plays seamlessly even when camera is off */}
            <audio ref={audioRef} autoPlay playsInline />

            {isCameraOff || !stream ? (
                <div className="video-placeholder">
                    <div className="avatar-circle">
                        {getInitials(name)}
                    </div>
                </div>
            ) : (
                <video ref={videoRef} autoPlay playsInline muted></video>
            )}
            <div className="video-label-row">
                <span className="video-label">
                    {name || "Participant"} {isSpeaking && !isMuted && <span className="speaking-indicator-dot">🎙️</span>}
                </span>
                {isMuted && <span className="mute-icon">Muted</span>}
            </div>
        </div>
    )
}

function Meeting() {
    const socketRef = useRef(null)
    const peersRef = useRef({})           // { userId: RTCPeerConnection }
    const localStreamRef = useRef(null)
    const screenStreamRef = useRef(null)
    const isScreenSharingRef = useRef(false)
    const iceCandidatesQueue = useRef({})  // { userId: [candidates] }
    
    // File Sharing References & Receivers
    const dataChannelsRef = useRef({})     // { userId: RTCDataChannel }
    const fileChunksRef = useRef({})       // { userId: { name, size, receivedSize, chunks: [] } }
    const remoteAudioIntervals = useRef({}) // { userId: intervalId }
    const localAudioIntervalRef = useRef(null)

    const { code } = useParams()
    const navigate = useNavigate()
    const location = useLocation()

    // State for local display name
    const [displayName, setDisplayName] = useState(
        location.state?.guestName || sessionStorage.getItem("guestName") || "Guest"
    )

    const [isMuted, setIsMuted] = useState(false)
    const [isCameraOff, setIsCameraOff] = useState(false)
    const [isScreenSharing, setIsScreenSharing] = useState(false)
    const [remoteStreams, setRemoteStreams] = useState({})   // { userId: MediaStream }
    const [participants, setParticipants] = useState({})     // { socketId: name }
    const [participantStates, setParticipantStates] = useState({}) // { socketId: { isMuted, isCameraOff } }
    
    // Voice activity states
    const [isLocalSpeaking, setIsLocalSpeaking] = useState(false)
    const [remoteSpeakingStates, setRemoteSpeakingStates] = useState({}) // { userId: boolean }

    // Sidebar panel controls
    const [showSidebar, setShowSidebar] = useState(false)
    const [sidebarTab, setSidebarTab] = useState("chat") // "chat", "files", "polls", or "notes"
    const showSidebarRef = useRef(showSidebar)
    const sidebarTabRef = useRef(sidebarTab)

    useEffect(() => {
        showSidebarRef.current = showSidebar
    }, [showSidebar])

    useEffect(() => {
        sidebarTabRef.current = sidebarTab
    }, [sidebarTab])
    
    // Chat states
    const [messages, setMessages] = useState([])              // [{sender, data}]
    const [chatInput, setChatInput] = useState("")
    const [reactionPopup, setReactionPopup] = useState(null)  // emoji active on screen
    const chatEndRef = useRef(null)

    // Standout feature states (Polls)
    const [activePoll, setActivePoll] = useState(null)       // { question, options, votes: { socketId: optionIndex }, creatorId }
    const [pollQuestion, setPollQuestion] = useState("")
    const [pollOptions, setPollOptions] = useState(["", ""])
    const [hasVoted, setHasVoted] = useState(false)

    // In-Call Notifications state
    const [notifications, setNotifications] = useState([])    // [{ id, text, type }]

    // Decentralized File Sharing States
    const [fileTransfers, setFileTransfers] = useState({})    // { userId: { name, progress, status: "sending"|"receiving" } }
    const [receivedFiles, setReceivedFiles] = useState([])    // [{ name, url, sender, size }]

    // AI Notes & Real-time Transcription States
    const [transcriptLogs, setTranscriptLogs] = useState([])
    const [activeSubtitles, setActiveSubtitles] = useState(null)
    const [summaryText, setSummaryText] = useState("")
    const recognitionRef = useRef(null)

    // Speech Recognition Lang state (fixes Hindi/Hinglish speech note drops)
    const [transcriptionLang, setTranscriptionLang] = useState("en-US")
    const [isAiRecording, setIsAiRecording] = useState(true)
    const isAiRecordingRef = useRef(true)
    const speechRestartTimeoutRef = useRef(null)
    const localSpeechTimeoutRef = useRef(null)
    const remoteSpeechTimeoutsRef = useRef({})

    // Meeting Call Duration Timer
    const [meetingDuration, setMeetingDuration] = useState(0)

    useEffect(() => {
        const timer = setInterval(() => {
            setMeetingDuration(prev => prev + 1)
        }, 1000)
        return () => clearInterval(timer)
    }, [])

    const formatDuration = (seconds) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    const copyInviteLink = () => {
        const inviteUrl = window.location.href
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(inviteUrl).then(() => {
                addNotification(`Link copied to clipboard! (Room: ${code})`, "info")
            }).catch(() => {
                addNotification(`Room Code: ${code}`, "info")
            })
        } else {
            addNotification(`Room Code: ${code}`, "info")
        }
    }

    // Toggle AI Speech Recording ON/OFF to give users full control and prevent mobile mic chime spam
    const toggleAiRecording = () => {
        const newState = !isAiRecording
        setIsAiRecording(newState)
        isAiRecordingRef.current = newState
        if (newState) {
            try {
                recognitionRef.current?.start()
                addNotification("AI Speech Transcription activated.", "info")
            } catch (e) {}
        } else {
            if (speechRestartTimeoutRef.current) clearTimeout(speechRestartTimeoutRef.current)
            try {
                recognitionRef.current?.stop()
                addNotification("AI Speech Transcription paused.", "info")
            } catch (e) {}
        }
    }

    // Comprehensive Executive Meeting Minutes & Summary Generator
    const generateMeetingSummary = (logs, roomCode, durationSec) => {
        if (!logs || logs.length === 0) {
            return "No speech recorded yet. Speak in the meeting to generate real-time AI notes and executive summary."
        }

        const participantsList = Array.from(new Set(logs.map(l => l.name)))
        const totalStatements = logs.length

        // Group contributions by participant
        const speakerMap = {}
        participantsList.forEach(p => {
            speakerMap[p] = logs.filter(l => l.name === p).map(l => l.text)
        })

        // Action keywords (English + Hindi/Hinglish)
        const actionKeywords = [
            "i will", "we need to", "make sure", "todo", "action", "task", "scheduled", "assign", 
            "karna hai", "karunga", "karungi", "dekh lena", "send me", "share with", "follow up", 
            "deadline", "tomorrow", "next week", "bhej dunga", "bhej dena", "check karo", "complete"
        ]
        const actionItems = []

        // Decision keywords
        const decisionKeywords = [
            "decided", "agreed", "confirmed", "approved", "we should", "resolved", 
            "theek hai", "done", "final", "pakka", "finalize", "chosen", "agreed on", "fix"
        ]
        const decisions = []

        // Questions & key discussions
        const questions = []
        const keyHighlights = []

        logs.forEach(log => {
            const text = (log.text || "").trim()
            const lower = text.toLowerCase()

            if (text.endsWith('?') || lower.startsWith('kya') || lower.startsWith('kaise') || lower.startsWith('why') || lower.startsWith('how') || lower.startsWith('what')) {
                if (!questions.some(q => q.includes(text))) {
                    questions.push(`**${log.name}** asked: "${text}"`)
                }
            }

            if (actionKeywords.some(kw => lower.includes(kw))) {
                actionItems.push(`**${log.name}**: "${text}"`)
            }

            if (decisionKeywords.some(kw => lower.includes(kw))) {
                decisions.push(`**${log.name}**: "${text}"`)
            }

            if (text.length > 15 && keyHighlights.length < 12) {
                keyHighlights.push(`• **${log.name}**: "${text}"`)
            }
        })

        let executiveNarrative = ""
        if (participantsList.length > 1) {
            executiveNarrative = `Collaborative multi-participant meeting between **${participantsList.join(' and ')}** spanning **${formatDuration(durationSec)}**. The participants actively discussed project updates, exchanged ideas, and aligned on key deliverables across **${totalStatements}** diarized speech statements.`
        } else {
            executiveNarrative = `Active briefing by **${participantsList[0] || "Participant"}** lasting **${formatDuration(durationSec)}** with **${totalStatements}** recorded speech statements documenting key agenda items and operational notes.`
        }

        return `
# 📝 Executive Meeting Minutes & Summary
**Meeting Code:** \`${roomCode}\`  
**Date:** ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}  
**Duration:** ${formatDuration(durationSec)}  
**Participants:** ${participantsList.join(', ') || "None"}

---

## 📌 1. Executive Summary
${executiveNarrative}

---

## 💡 2. Key Discussion Topics & Points
${keyHighlights.length > 0 
    ? keyHighlights.join('\n\n') 
    : "Active participant discussion recorded."
}

---

## 👥 3. Participant Contribution Breakdown
${participantsList.map(p => {
    const pLogs = speakerMap[p] || []
    return `### 👤 ${p} (${pLogs.length} statements)
${pLogs.slice(0, 5).map(t => `- "${t}"`).join('\n')}${pLogs.length > 5 ? `\n- *...and ${pLogs.length - 5} more statements*` : ''}`
}).join('\n\n')}

---

## 🛠️ 4. Action Items & Next Steps
${actionItems.length > 0 
    ? actionItems.map(item => `- [ ] ${item}`).join('\n') 
    : "- [ ] Follow up on discussed agenda items."
}

---

## 🤝 5. Key Decisions & Agreements
${decisions.length > 0 
    ? decisions.map(dec => `- ✅ ${dec}`).join('\n') 
    : "- Core consensus maintained across all discussion points."
}

${questions.length > 0 ? `
---

## ❓ 6. Questions & Inquiries Raised
${questions.map(q => `- ${q}`).join('\n')}
` : ''}

---

## 🗒️ 7. Full Chronological Transcript
\`\`\`text
${logs.map(log => `[${log.timestamp}] ${log.name}: ${log.text}`).join('\n')}
\`\`\`
`.trim()
    }

    // Zoom-inspired custom layout states
    const [showShareMenu, setShowShareMenu] = useState(false)
    const [showHostPopover, setShowHostPopover] = useState(false)
    const [showReactPopover, setShowReactPopover] = useState(false)
    const [showWhiteboard, setShowWhiteboard] = useState(false)

    // Room Host identification socket tracking
    const [hostSocketId, setHostSocketId] = useState(null)
    const [isHost, setIsHost] = useState(true)

    // Collaborative whiteboard sharing ownership
    const [whiteboardSharer, setWhiteboardSharer] = useState(null) // { id, name }

    // Whiteboard presenter actions (Restricts stop/close access to the sharer)
    const startWhiteboard = () => {
        setShowWhiteboard(true)
        setWhiteboardSharer({ id: socketRef.current?.id, name: displayName })
        socketRef.current?.emit('whiteboard-start', displayName)
        addNotification("You started the collaborative whiteboard.", "info")
        setShowShareMenu(false)
    }

    const stopWhiteboard = () => {
        setShowWhiteboard(false)
        setWhiteboardSharer(null)
        socketRef.current?.emit('whiteboard-stop')
        addNotification("You closed the whiteboard.", "info")
        setShowShareMenu(false)
    }

    // Helper to dismiss all floating dropdowns/popovers on backdrop click
    const closeAllPopovers = () => {
        setShowShareMenu(false)
        setShowReactPopover(false)
        setShowHostPopover(false)
    }

    // Local Video stream state (fixes local disappearing stream on toggling off/on)
    const [currentLocalStream, setCurrentLocalStream] = useState(null)
    const localVideoRef = useRef(null)

    // Setup local video render effect (keeps srcObject persistent on updates)
    useEffect(() => {
        if (localVideoRef.current && currentLocalStream && !isCameraOff) {
            if (localVideoRef.current.srcObject !== currentLocalStream) {
                localVideoRef.current.srcObject = currentLocalStream
            }
            localVideoRef.current.play().catch(() => {})
        }
    })

    // Collaborative Whiteboard State references
    const canvasRef = useRef(null)
    const [drawingColor, setDrawingColor] = useState("#6366f1")
    const [drawingSize, setDrawingSize] = useState(3)
    const [isDrawing, setIsDrawing] = useState(false)
    const [isEraser, setIsEraser] = useState(false)
    const lastPosRef = useRef({ x: 0, y: 0 })

    // Setup Canvas dynamic resizing inside whiteboard
    useEffect(() => {
        if (!showWhiteboard || !canvasRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // Match container size
        canvas.width = canvas.parentElement.clientWidth
        canvas.height = canvas.parentElement.clientHeight
        
        // Re-draw background grid/canvas styling
        ctx.fillStyle = "#09090b"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
    }, [showWhiteboard])

    const getCoordinates = (e) => {
        const canvas = canvasRef.current
        if (!canvas) return { x: 0, y: 0 }
        const rect = canvas.getBoundingClientRect()
        if (e.touches && e.touches.length > 0) {
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            }
        }
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        }
    }

    const startDrawing = (e) => {
        if (e.type === 'touchstart') {
            e.preventDefault()
        }
        const { x, y } = getCoordinates(e)
        lastPosRef.current = { x, y }
        setIsDrawing(true)
    }

    const draw = (e) => {
        if (!isDrawing || !canvasRef.current) return
        if (e.type === 'touchmove') {
            e.preventDefault()
        }
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        const { x, y } = getCoordinates(e)

        const prevX = lastPosRef.current.x
        const prevY = lastPosRef.current.y
        const color = isEraser ? "#09090b" : drawingColor // Canvas background matches zinc 950
        const size = drawingSize

        // Draw line locally
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = size
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(x, y)
        ctx.stroke()

        // Sync drawing strokes
        socketRef.current?.emit('draw', { prevX, prevY, x, y, color, size })

        lastPosRef.current = { x, y }
    }

    const stopDrawing = (e) => {
        if (e && e.type === 'touchend') {
            e.preventDefault()
        }
        setIsDrawing(false)
    }

    const clearCanvas = () => {
        if (!canvasRef.current) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = "#09090b"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        
        socketRef.current?.emit('clear-canvas')
    }

    // Dynamic Language change synchronization for Speech Recognition
    useEffect(() => {
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop()
            } catch (e) {}
            
            recognitionRef.current.lang = transcriptionLang
            
            const currentMuted = !localStreamRef.current?.getAudioTracks()[0]?.enabled
            if (localStreamRef.current && !currentMuted) {
                // Short timeout to let the recognition engine shut down cleanly before starting again
                setTimeout(() => {
                    try {
                        recognitionRef.current?.start()
                    } catch (e) {}
                }, 300)
            }
        }
    }, [transcriptionLang])

    // ---- Helper: add in-call visual notification ----
    const addNotification = (text, type = "info") => {
        const id = Date.now() + Math.random().toString(36).substr(2, 9)
        setNotifications(prev => [...prev, { id, text, type }])
        
        // Auto remove after 4 seconds
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id))
        }, 4000)
    }

    // ---- Helper: setup WebRTC data channel for file transfer ----
    const setupDataChannel = (userId, channel) => {
        channel.binaryType = "arraybuffer"
        
        channel.onopen = () => {
            dataChannelsRef.current[userId] = channel
        }

        channel.onclose = () => {
            delete dataChannelsRef.current[userId]
        }

        channel.onmessage = (event) => {
            const data = event.data
            if (typeof data === "string") {
                try {
                    const parsed = JSON.parse(data)
                    if (parsed.type === "meta") {
                        fileChunksRef.current[userId] = {
                            name: parsed.name,
                            size: parsed.size,
                            receivedSize: 0,
                            chunks: []
                        }
                        setFileTransfers(prev => ({
                            ...prev,
                            [userId]: { name: parsed.name, progress: 0, status: "receiving" }
                        }))
                        addNotification(`Receiving file "${parsed.name}"...`, "file")
                    }
                } catch (e) {
                    console.error("Data channel meta error:", e)
                }
            } else {
                // Binary chunk received
                const transfer = fileChunksRef.current[userId]
                if (transfer) {
                    transfer.chunks.push(data)
                    transfer.receivedSize += data.byteLength
                    const progress = Math.round((transfer.receivedSize / transfer.size) * 100)
                    
                    setFileTransfers(prev => ({
                        ...prev,
                        [userId]: { ...prev[userId], progress }
                    }))

                    if (transfer.receivedSize >= transfer.size) {
                        const blob = new Blob(transfer.chunks)
                        const url = URL.createObjectURL(blob)
                        
                        const senderName = participants[userId] || "Participant"
                        setReceivedFiles(prev => [
                            ...prev,
                            { 
                                name: transfer.name, 
                                url, 
                                sender: senderName, 
                                size: transfer.size 
                            }
                        ])

                        addNotification(`Received file "${transfer.name}" from ${senderName}`, "file")

                        // Clean up transfer state
                        setFileTransfers(prev => {
                            const updated = { ...prev }
                            delete updated[userId]
                            return updated
                        })
                        delete fileChunksRef.current[userId]
                    }
                }
            }
        }
    }

    const handleSendFile = (e) => {
        const file = e.target.files[0]
        if (!file) return

        const activePeers = Object.keys(dataChannelsRef.current)
        if (activePeers.length === 0) {
            alert("No active connections to send files to.")
            return
        }

        addNotification(`Sharing file "${file.name}" with participants...`, "file")

        activePeers.forEach(peerId => {
            const channel = dataChannelsRef.current[peerId]
            if (channel && channel.readyState === "open") {
                // Send metadata header
                channel.send(JSON.stringify({ type: "meta", name: file.name, size: file.size }))

                const chunkSize = 16384 // 16KB
                let offset = 0
                const fileReader = new FileReader()

                fileReader.onload = (event) => {
                    const buffer = event.target.result
                    channel.send(buffer)
                    offset += buffer.byteLength
                    const progress = Math.round((offset / file.size) * 100)

                    setFileTransfers(prev => ({
                        ...prev,
                        [peerId]: { name: file.name, progress, status: "sending" }
                    }))

                    if (offset < file.size) {
                        readNextChunk()
                    } else {
                        // Finished sending
                        setTimeout(() => {
                            setFileTransfers(prev => {
                                const updated = { ...prev }
                                delete updated[peerId]
                                return updated
                            })
                        }, 1000)
                    }
                }

                const readNextChunk = () => {
                    const slice = file.slice(offset, offset + chunkSize)
                    fileReader.readAsArrayBuffer(slice)
                }

                readNextChunk()
            }
        })
    }

    // ---- Helper: create peer connection for remote participant ----
    const createPeerConnection = (userId, isOfferer = false) => {
        if (peersRef.current[userId]) {
            try {
                peersRef.current[userId].close()
            } catch (e) {}
        }

        const peer = new RTCPeerConnection(peerConfig)

        // Add audio track from localStream
        const audioTrack = localStreamRef.current?.getAudioTracks()[0]
        if (audioTrack) {
            peer.addTrack(audioTrack, localStreamRef.current)
        }

        // Add video track (check if currently screen sharing)
        const videoTrack = isScreenSharingRef.current && screenStreamRef.current
            ? screenStreamRef.current.getVideoTracks()[0]
            : localStreamRef.current?.getVideoTracks()[0]

        if (videoTrack) {
            peer.addTrack(videoTrack, isScreenSharingRef.current ? screenStreamRef.current : localStreamRef.current)
        }

        // Create or handle WebRTC data channels
        if (isOfferer) {
            const channel = peer.createDataChannel("file-transfer", { ordered: true })
            setupDataChannel(userId, channel)
        }

        peer.ondatachannel = (event) => {
            if (event.channel.label === "file-transfer") {
                setupDataChannel(userId, event.channel)
            }
        }

        peer.ontrack = (event) => {
            const remoteStream = event.streams[0] || new MediaStream([event.track])
            setRemoteStreams(prev => {
                const existing = prev[userId]
                if (existing && existing !== remoteStream) {
                    if (!existing.getTracks().some(t => t.id === event.track.id)) {
                        existing.addTrack(event.track)
                        return { ...prev, [userId]: new MediaStream(existing.getTracks()) }
                    }
                    return prev
                }
                return { ...prev, [userId]: remoteStream }
            })

            // Audio Level Detector for active speaker outline
            if (remoteStream.getAudioTracks().length > 0) {
                try {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext
                    const audioContext = new AudioCtx()
                    const source = audioContext.createMediaStreamSource(remoteStream)
                    const analyser = audioContext.createAnalyser()
                    analyser.fftSize = 256
                    source.connect(analyser)

                    const bufferLength = analyser.frequencyBinCount
                    const dataArray = new Uint8Array(bufferLength)

                    const checkRemoteVol = () => {
                        analyser.getByteFrequencyData(dataArray)
                        let sum = 0
                        for (let i = 0; i < bufferLength; i++) {
                            sum += dataArray[i]
                        }
                        const average = sum / bufferLength
                        setRemoteSpeakingStates(prev => ({
                            ...prev,
                            [userId]: average > 25
                        }))
                    }
                    if (remoteAudioIntervals.current[userId]) {
                        clearInterval(remoteAudioIntervals.current[userId])
                    }
                    const intervalId = setInterval(checkRemoteVol, 200)
                    remoteAudioIntervals.current[userId] = intervalId
                } catch (err) {
                    console.error("Remote audio analyzer setup failure:", err)
                }
            }
        }

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current?.emit('signal', userId, JSON.stringify({ ice: event.candidate }))
            }
        }

        // Configure sender parameters to maintain crystal clear HD resolution and high bitrate
        const videoSender = peer.getSenders().find(s => s.track && s.track.kind === 'video')
        if (videoSender && videoSender.getParameters) {
            try {
                const params = videoSender.getParameters()
                if (!params.encodings || params.encodings.length === 0) {
                    params.encodings = [{}]
                }
                params.encodings[0].maxBitrate = 4000000 // 4 Mbps Full HD
                params.encodings[0].maxFramerate = 30
                params.degradationPreference = 'maintain-resolution' // Prioritize crisp pixels over dropping resolution
                videoSender.setParameters(params).catch(() => {})
            } catch (e) {}
        }

        peersRef.current[userId] = peer
        return peer
    }

    // Mobile browser audio unlocker for flawless WebRTC voice transmission
    useEffect(() => {
        const unlockAudio = () => {
            const AudioCtx = window.AudioContext || window.webkitAudioContext
            if (AudioCtx) {
                const ctx = new AudioCtx()
                if (ctx.state === 'suspended') {
                    ctx.resume().catch(() => {})
                }
            }
        }
        window.addEventListener('click', unlockAudio, { once: true })
        window.addEventListener('touchstart', unlockAudio, { once: true })
        return () => {
            window.removeEventListener('click', unlockAudio)
            window.removeEventListener('touchstart', unlockAudio)
        }
    }, [])

    // ---- Mute / Camera toggle ----
    const toggleMute = () => {
        const audioTracks = localStreamRef.current?.getAudioTracks() || []
        if (audioTracks.length > 0) {
            const currentEnabled = audioTracks[0].enabled
            const newEnabled = !currentEnabled
            audioTracks.forEach(track => {
                track.enabled = newEnabled
            })
            setIsMuted(!newEnabled)
            socketRef.current?.emit('toggle-mute', !newEnabled)

            // Sync local Speech recognition with mute toggle
            if (recognitionRef.current && isAiRecordingRef.current) {
                if (newEnabled) {
                    try {
                        recognitionRef.current.start()
                    } catch (e) {}
                } else {
                    if (speechRestartTimeoutRef.current) clearTimeout(speechRestartTimeoutRef.current)
                    try {
                        recognitionRef.current.stop()
                    } catch (e) {}
                }
            }
        }
    }

    const toggleCamera = () => {
        const videoTrack = localStreamRef.current?.getVideoTracks()[0]
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled
            setIsCameraOff(!videoTrack.enabled)
            socketRef.current?.emit('toggle-camera', !videoTrack.enabled)
        }
    }

    // ---- Screen Share (Enhanced for Desktop & Mobile) ----
    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                addNotification("Screen sharing is not supported by your current browser. Please use Chrome on Android or Desktop.", "info")
                return
            }
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: "always" },
                    audio: false
                })
                screenStreamRef.current = screenStream
                const screenTrack = screenStream.getVideoTracks()[0]

                // Replace video track in all active peer connections
                Object.values(peersRef.current).forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video')
                    if (sender) sender.replaceTrack(screenTrack)
                })

                setCurrentLocalStream(screenStream)
                setIsScreenSharing(true)
                isScreenSharingRef.current = true
                addNotification("Screen sharing started successfully!", "info")

                // When user clicks browser's built-in "Stop sharing" button
                screenTrack.onended = () => stopScreenShare()

            } catch (err) {
                console.warn("Screen share error:", err)
                if (err.name === "NotAllowedError") {
                    addNotification("Screen sharing cancelled or permission denied.", "info")
                } else {
                    addNotification("Screen sharing failed: " + (err.message || err.name), "info")
                }
            }
        } else {
            stopScreenShare()
        }
    }

    const stopScreenShare = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop())
        }
        const camTrack = localStreamRef.current?.getVideoTracks()[0]

        if (camTrack) {
            Object.values(peersRef.current).forEach(peer => {
                const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video')
                if (sender) sender.replaceTrack(camTrack)
            })
        }

        if (localStreamRef.current) {
            setCurrentLocalStream(localStreamRef.current)
        }
        setIsScreenSharing(false)
        isScreenSharingRef.current = false
    }

    // ---- Chat ----
    const sendMessage = () => {
        if (chatInput.trim() === "") return
        socketRef.current?.emit('chat-message', chatInput, displayName)
        setMessages(prev => [...prev, { sender: "You", data: chatInput }])
        setChatInput("")
    }

    // ---- Emoji Reaction ----
    const sendReaction = (emoji) => {
        socketRef.current?.emit('chat-message', `__REACTION__${emoji}`, displayName)
        setReactionPopup(emoji)
        setTimeout(() => setReactionPopup(null), 1800)
    }

    // ---- Poll Creation ----
    const addPollOptionField = () => {
        if (pollOptions.length < 5) {
            setPollOptions([...pollOptions, ""])
        }
    }

    const removePollOptionField = (idx) => {
        if (pollOptions.length > 2) {
            setPollOptions(pollOptions.filter((_, i) => i !== idx))
        }
    }

    const updatePollOptionVal = (idx, val) => {
        const updated = [...pollOptions]
        updated[idx] = val
        setPollOptions(updated)
    }

    const createPoll = () => {
        const filteredOptions = pollOptions.filter(o => o.trim() !== "")
        if (!pollQuestion.trim() || filteredOptions.length < 2) return
        socketRef.current?.emit('create-poll', pollQuestion, filteredOptions)
        setPollQuestion("")
        setPollOptions(["", ""])
    }

    const castVote = (optionIdx) => {
        socketRef.current?.emit('cast-vote', optionIdx)
        setHasVoted(true)
    }

    // ---- AI Notes Real-time Compiler ----
    useEffect(() => {
        setSummaryText(generateMeetingSummary(transcriptLogs, code, meetingDuration))
    }, [transcriptLogs, code, meetingDuration])

    const downloadSummaryFile = () => {
        const fullMarkdownReport = generateMeetingSummary(transcriptLogs, code, meetingDuration)
        const element = document.createElement("a")
        const file = new Blob([fullMarkdownReport], { type: 'text/markdown;charset=utf-8' })
        element.href = URL.createObjectURL(file)
        element.download = `Meeting_Summary_${code}.md`
        document.body.appendChild(element)
        element.click()
        document.body.removeChild(element)
    }

    // Toggle sidebar tabs on bottom controls clicks like Zoom
    const handleToggleSidebarTab = (tabName) => {
        if (showSidebar && sidebarTab === tabName) {
            setShowSidebar(false)
        } else {
            setShowSidebar(true)
            setSidebarTab(tabName)
        }
    }

    // Host utility actions
    const handleHostMuteAll = (shouldMute) => {
        socketRef.current?.emit('host-mute-all', shouldMute)
        addNotification(shouldMute ? "You muted all participants." : "You unmuted all participants.", "info")
    }

    const handleHostDisableCams = (shouldDisable) => {
        socketRef.current?.emit('host-disable-video', shouldDisable)
        addNotification(shouldDisable ? "You disabled all participant cameras." : "You enabled all participant cameras.", "info")
    }

    // ---- Leave Meeting ----
    const leaveMeeting = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop())
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop())
        }
        Object.values(peersRef.current).forEach(peer => peer.close())
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop()
            } catch (e) {}
        }
        if (socketRef.current) {
            socketRef.current.disconnect()
        }
        navigate('/dashboard')
    }

    // Auto-scroll chat
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages, showSidebar, sidebarTab])

    // Get current grid configuration
    const getGridClass = () => {
        const otherParticipantsCount = Object.keys(participants).filter(id => id !== socketRef.current?.id).length
        const totalCount = otherParticipantsCount + 1
        if (totalCount === 1) return "grid-1"
        if (totalCount === 2) return "grid-2"
        if (totalCount <= 4) return "grid-4"
        return "grid-multi"
    }

    // Init call & socket
    useEffect(() => {
        const init = async () => {
            const cleanCode = (code || "").toString().replace(/^\/meeting\//, "").split("/").pop().trim()
            let resolvedName = location.state?.guestName || sessionStorage.getItem("guestName")
            
            // If logged in, fetch user details from database
            const token = localStorage.getItem("token")
            if (token && token !== "null" && token !== "undefined" && !location.state?.guestName) {
                try {
                    const res = await axios.get(`${BASE_URL}/api/v1/users/profile`, {
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    })
                    if (res.data && res.data.name) {
                        resolvedName = res.data.name
                        sessionStorage.setItem("guestName", resolvedName)
                    }
                } catch (e) {
                    console.error("Failed to fetch user profile:", e)
                }
            }

            // Fallback if no name found
            if (!resolvedName) {
                resolvedName = "Guest_" + Math.floor(Math.random() * 1000)
            }

            setDisplayName(resolvedName)
            sessionStorage.setItem("guestName", resolvedName)

            // Setup audio/video media with studio noise/echo cancellation constraints & Full HD 1080p
            const videoMediaConstraints = { 
                width: { min: 640, ideal: 1920, max: 1920 }, 
                height: { min: 480, ideal: 1080, max: 1080 }, 
                frameRate: { ideal: 30, max: 60 },
                facingMode: "user" 
            }
            const audioMediaConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            }

            let stream = null
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: videoMediaConstraints, 
                    audio: audioMediaConstraints 
                })
            } catch (mediaErr) {
                console.warn("Could not get Full HD video, trying 720p fallback:", mediaErr)
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: audioMediaConstraints 
                    })
                } catch (fallbackErr) {
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: audioMediaConstraints })
                        setIsCameraOff(true)
                    } catch (audioErr) {
                        console.error("Could not get any media stream:", audioErr)
                        stream = new MediaStream()
                        setIsCameraOff(true)
                        setIsMuted(true)
                    }
                }
            }

            setCurrentLocalStream(stream)
            localStreamRef.current = stream

            // Local Mic Volume level check for local speaking border
            if (stream.getAudioTracks().length > 0) {
                try {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext
                    const audioContext = new AudioCtx()
                    const source = audioContext.createMediaStreamSource(stream)
                    const analyser = audioContext.createAnalyser()
                    analyser.fftSize = 256
                    source.connect(analyser)

                    const bufferLength = analyser.frequencyBinCount
                    const dataArray = new Uint8Array(bufferLength)

                    const checkLocalVol = () => {
                        if (!localStreamRef.current || localStreamRef.current.getAudioTracks()[0]?.enabled === false) {
                            setIsLocalSpeaking(false)
                            return
                        }
                        analyser.getByteFrequencyData(dataArray)
                        let sum = 0
                        for (let i = 0; i < bufferLength; i++) {
                            sum += dataArray[i]
                        }
                        const average = sum / bufferLength
                        setIsLocalSpeaking(average > 25)
                    }
                    localAudioIntervalRef.current = setInterval(checkLocalVol, 200)
                } catch (err) {
                    console.error("Local audio analyzer setup failure:", err)
                }
            }

            // Web Speech API initialization
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
            if (SpeechRecognition) {
                const rec = new SpeechRecognition()
                rec.continuous = true
                rec.interimResults = true
                rec.lang = transcriptionLang

                rec.onresult = (event) => {
                    let interimText = ''
                    let finalText = ''
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalText += event.results[i][0].transcript
                        } else {
                            interimText += event.results[i][0].transcript
                        }
                    }

                    const activeText = (finalText || interimText).trim()
                    if (activeText) {
                        socketRef.current?.emit('user-speech', activeText, finalText !== '')
                        setActiveSubtitles({ sender: "You", text: activeText })

                        if (finalText !== '') {
                            if (localSpeechTimeoutRef.current) clearTimeout(localSpeechTimeoutRef.current)
                            setTranscriptLogs(prev => [...prev, {
                                name: "You",
                                text: finalText.trim(),
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            }])
                            setTimeout(() => {
                                setActiveSubtitles(prev => (prev && prev.sender === "You" ? null : prev))
                            }, 3000)
                        } else {
                            // Mobile Android debounce fallback: commit text after 1.5s silence if isFinal is never emitted
                            if (localSpeechTimeoutRef.current) clearTimeout(localSpeechTimeoutRef.current)
                            localSpeechTimeoutRef.current = setTimeout(() => {
                                setTranscriptLogs(prev => [...prev, {
                                    name: "You",
                                    text: activeText,
                                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                }])
                                socketRef.current?.emit('user-speech', activeText, true)
                                setActiveSubtitles(prev => (prev && prev.sender === "You" ? null : prev))
                            }, 1500)
                        }
                    }
                }

                rec.onend = () => {
                    if (!isAiRecordingRef.current) return
                    const currentMuted = !localStreamRef.current?.getAudioTracks()[0]?.enabled
                    if (localStreamRef.current && !currentMuted) {
                        if (speechRestartTimeoutRef.current) clearTimeout(speechRestartTimeoutRef.current)
                        speechRestartTimeoutRef.current = setTimeout(() => {
                            if (isAiRecordingRef.current && recognitionRef.current) {
                                try {
                                    recognitionRef.current.start()
                                } catch (e) {}
                            }
                        }, 1500)
                    }
                }

                rec.onerror = (event) => {
                    console.error("Speech Recognition Error:", event.error)
                }

                recognitionRef.current = rec
                
                if (stream.getAudioTracks()[0]?.enabled) {
                    try {
                        rec.start()
                    } catch (e) {
                        console.error("Speech Recognition starting error:", e)
                    }
                }
            } else {
                console.warn("Speech Recognition not supported in this browser.")
            }

            socketRef.current = io(BASE_URL)

            socketRef.current.on('connect', () => {
                socketRef.current.emit('join-call', cleanCode, resolvedName)
            })

            // Verify room entry failures
            socketRef.current.on('join-error', (errMsg) => {
                alert(errMsg)
                navigate('/dashboard')
            })

            // When a user joins
            socketRef.current.on('user-joined', async (newUserId, newUserName, usersList, hostId) => {
                setHostSocketId(hostId)
                const myId = socketRef.current?.id
                if (hostId === myId || usersList.length <= 1) {
                    setIsHost(true)
                } else {
                    setIsHost(hostId === myId)
                }

                const newParticipants = {}
                const newStates = {}
                usersList.forEach(u => {
                    newParticipants[u.id] = u.name
                    newStates[u.id] = { isMuted: u.isMuted, isCameraOff: u.isCameraOff }
                })
                setParticipants(newParticipants)
                setParticipantStates(newStates)

                if (newUserId !== socketRef.current.id) {
                    try {
                        const peer = createPeerConnection(newUserId, true) // isOfferer = true
                        const offer = await peer.createOffer({
                            offerToReceiveAudio: true,
                            offerToReceiveVideo: true
                        })
                        const boostedOffer = new RTCSessionDescription({
                            type: offer.type,
                            sdp: boostSdpBitrate(offer.sdp, 4000)
                        })
                        await peer.setLocalDescription(boostedOffer)
                        socketRef.current.emit('signal', newUserId, JSON.stringify({ sdp: peer.localDescription }))
                    } catch (offerErr) {
                        console.error("Error creating WebRTC offer:", offerErr)
                    }
                }
            })

            // When a user leaves
            socketRef.current.on('user-left', (userId, newHostId) => {
                if (newHostId) {
                    setHostSocketId(newHostId)
                    if (newHostId === socketRef.current?.id) {
                        setIsHost(true)
                        addNotification("You are now the meeting host.", "info")
                    }
                }
                if (peersRef.current[userId]) {
                    peersRef.current[userId].close()
                    delete peersRef.current[userId]
                }
                if (dataChannelsRef.current[userId]) {
                    dataChannelsRef.current[userId].close()
                    delete dataChannelsRef.current[userId]
                }
                if (remoteAudioIntervals.current[userId]) {
                    clearInterval(remoteAudioIntervals.current[userId])
                    delete remoteAudioIntervals.current[userId]
                }
                setRemoteStreams(prev => {
                    const updated = { ...prev }
                    delete updated[userId]
                    return updated
                })
                setParticipants(prev => {
                    const updated = { ...prev }
                    delete updated[userId]
                    return updated
                })
                setParticipantStates(prev => {
                    const updated = { ...prev }
                    delete updated[userId]
                    return updated
                })
                setRemoteSpeakingStates(prev => {
                    const updated = { ...prev }
                    delete updated[userId]
                    return updated
                })
                delete iceCandidatesQueue.current[userId]
            })

            // Signal handler for WebRTC negotiations
            socketRef.current.on('signal', async (fromId, message) => {
                try {
                    const signalData = JSON.parse(message)
                    let peer = peersRef.current[fromId]
                    if (!peer) {
                        peer = createPeerConnection(fromId, false)
                    }

                    if (signalData.sdp) {
                        await peer.setRemoteDescription(new RTCSessionDescription(signalData.sdp))
                        if (signalData.sdp.type === 'offer') {
                            const answer = await peer.createAnswer({
                                offerToReceiveAudio: true,
                                offerToReceiveVideo: true
                            })
                            const boostedAnswer = new RTCSessionDescription({
                                type: answer.type,
                                sdp: boostSdpBitrate(answer.sdp, 4000)
                            })
                            await peer.setLocalDescription(boostedAnswer)
                            socketRef.current.emit('signal', fromId, JSON.stringify({ sdp: peer.localDescription }))
                        }
                        
                        if (iceCandidatesQueue.current[fromId]) {
                            for (const candidate of iceCandidatesQueue.current[fromId]) {
                                await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding queued ICE", e))
                            }
                            delete iceCandidatesQueue.current[fromId]
                        }
                    } else if (signalData.ice) {
                        if (peer.remoteDescription && peer.remoteDescription.type) {
                            await peer.addIceCandidate(new RTCIceCandidate(signalData.ice)).catch(e => console.error("Error adding ICE", e))
                        } else {
                            if (!iceCandidatesQueue.current[fromId]) {
                                iceCandidatesQueue.current[fromId] = []
                            }
                            iceCandidatesQueue.current[fromId].push(signalData.ice)
                        }
                    }
                } catch (sigErr) {
                    console.error("Signal processing error:", sigErr)
                }
            })

            // User audio/video toggle notifications
            socketRef.current.on('user-toggle-mute', (userId, mutedState) => {
                setParticipantStates(prev => ({
                    ...prev,
                    [userId]: { ...prev[userId], isMuted: mutedState }
                }))
            })

            socketRef.current.on('user-toggle-camera', (userId, cameraState) => {
                setParticipantStates(prev => ({
                    ...prev,
                    [userId]: { ...prev[userId], isCameraOff: cameraState }
                }))
            })

            // Chat & Reactions receiver
            socketRef.current.on('chat-message', (data, sender, senderSocketId) => {
                if (data.startsWith('__REACTION__')) {
                    const emoji = data.replace('__REACTION__', '')
                    setReactionPopup(emoji)
                    setTimeout(() => setReactionPopup(null), 1800)
                } else {
                    setMessages(prev => [...prev, { sender, data }])
                    if (!showSidebarRef.current || sidebarTabRef.current !== "chat") {
                        addNotification(`New chat from ${sender}: "${data.length > 25 ? data.substring(0, 22) + '...' : data}"`, "chat")
                    }
                }
            })

            // Poll updates
            socketRef.current.on('poll-update', (pollData) => {
                setActivePoll(pollData)
                if (pollData) {
                    const voteCount = Object.keys(pollData.votes).length
                    if (voteCount === 0) {
                        setHasVoted(false)
                        if (pollData.creatorId !== socketRef.current?.id) {
                            addNotification(`New poll launched: "${pollData.question}"`, "poll")
                        }
                    }
                } else {
                    setHasVoted(false)
                }
            })

            // Speech transcription broadcast receiver (Captures speech from all participants)
            socketRef.current.on('user-speech', (speechData) => {
                const { senderId, name, text, isFinal } = speechData
                const senderName = name || "Participant"
                const activeId = senderId || senderName
                setActiveSubtitles({ sender: senderName, text })

                const commitRemote = (phrase) => {
                    if (!phrase || !phrase.trim()) return
                    setTranscriptLogs(prev => [...prev, {
                        name: senderName,
                        text: phrase.trim(),
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }])
                    setTimeout(() => {
                        setActiveSubtitles(prev => (prev && prev.sender === senderName ? null : prev))
                    }, 3000)
                }

                if (isFinal) {
                    if (remoteSpeechTimeoutsRef.current[activeId]) {
                        clearTimeout(remoteSpeechTimeoutsRef.current[activeId])
                        delete remoteSpeechTimeoutsRef.current[activeId]
                    }
                    commitRemote(text)
                } else {
                    // Mobile Android fallback: commit remote interim speech if no new text arrives within 1.5s
                    if (remoteSpeechTimeoutsRef.current[activeId]) {
                        clearTimeout(remoteSpeechTimeoutsRef.current[activeId])
                    }
                    remoteSpeechTimeoutsRef.current[activeId] = setTimeout(() => {
                        commitRemote(text)
                        delete remoteSpeechTimeoutsRef.current[activeId]
                    }, 1500)
                }
            })

            // Collaborative Whiteboard Listeners
            socketRef.current.on('draw', (data) => {
                const canvas = canvasRef.current
                if (!canvas) return
                const ctx = canvas.getContext('2d')
                ctx.beginPath()
                ctx.strokeStyle = data.color
                ctx.lineWidth = data.size
                ctx.moveTo(data.prevX, data.prevY)
                ctx.lineTo(data.x, data.y)
                ctx.stroke()
            })

            socketRef.current.on('clear-canvas', () => {
                const canvas = canvasRef.current
                if (!canvas) return
                const ctx = canvas.getContext('2d')
                ctx.fillStyle = "#09090b"
                ctx.fillRect(0, 0, canvas.width, canvas.height)
            })

            socketRef.current.on('whiteboard-start', (sharerId, sharerName) => {
                setShowWhiteboard(true)
                setWhiteboardSharer({ id: sharerId, name: sharerName })
                addNotification(`${sharerName || "A participant"} started the collaborative whiteboard.`, "info")
            })

            socketRef.current.on('whiteboard-stop', () => {
                setShowWhiteboard(false)
                setWhiteboardSharer(null)
                addNotification("The collaborative whiteboard was closed by the presenter.", "info")
            })

            // Host remote overrides triggers (supports true/false parameters to allow toggles)
            socketRef.current.on('host-mute-all', (shouldMute) => {
                const audioTracks = localStreamRef.current?.getAudioTracks() || []
                if (audioTracks.length > 0) {
                    audioTracks.forEach(track => {
                        track.enabled = !shouldMute
                    })
                    setIsMuted(shouldMute)
                    socketRef.current?.emit('toggle-mute', shouldMute)
                    addNotification(shouldMute ? "You have been muted by the host." : "You have been unmuted by the host.", "info")

                    if (recognitionRef.current) {
                        if (!shouldMute) {
                            try { recognitionRef.current.start() } catch (e) {}
                        } else {
                            try { recognitionRef.current.stop() } catch (e) {}
                        }
                    }
                }
            })

            socketRef.current.on('host-disable-video', (shouldDisable) => {
                const videoTrack = localStreamRef.current?.getVideoTracks()[0]
                if (videoTrack) {
                    videoTrack.enabled = !shouldDisable
                    setIsCameraOff(shouldDisable)
                    socketRef.current?.emit('toggle-camera', shouldDisable)
                    addNotification(shouldDisable ? "Your camera was turned off by the host." : "Your camera was turned on by the host.", "info")
                }
            })
        }
        
        init()

        return () => {
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop())
            }
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop())
            }
            Object.values(peersRef.current).forEach(peer => {
                peer.close()
            })
            peersRef.current = {}
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.stop()
                } catch (e) {}
                recognitionRef.current = null
            }
            if (socketRef.current) {
                socketRef.current.disconnect()
            }
            if (localAudioIntervalRef.current) {
                clearInterval(localAudioIntervalRef.current)
            }
            Object.values(remoteAudioIntervals.current).forEach(id => clearInterval(id))
        }
    }, [])

    // Get current votes tally
    const getVotesTally = () => {
        if (!activePoll) return []
        const tally = activePoll.options.map(() => 0)
        let total = 0
        Object.values(activePoll.votes).forEach(optionIdx => {
            tally[optionIdx]++
            total++
        })
        return tally.map((count) => ({
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0
        }))
    }

    const votesTally = getVotesTally()

    const getInitials = (userName) => {
        if (!userName) return "?";
        return userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    return (
        <div className="meeting-wrapper">
            {/* In-Call Notifications container */}
            <div className="notifications-container">
                {notifications.map(n => (
                    <div key={n.id} className={`notification-toast toast-${n.type}`}>
                        <span className="toast-icon">
                            {n.type === 'chat' && '💬'}
                            {n.type === 'poll' && '📊'}
                            {n.type === 'file' && '📁'}
                        </span>
                        <div className="toast-text">{n.text}</div>
                        <button 
                            className="toast-close-btn" 
                            onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))}
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            {/* Screen share notification banner */}
            {isScreenSharing && (
                <div className="screen-share-banner">
                    <span>🖥️ You are sharing your screen to the meeting</span>
                    <button className="stop-share-btn" onClick={stopScreenShare}>Stop Sharing</button>
                </div>
            )}

            <div className="meeting-main-content">
                {/* Sleek Authentically Zoom Top Header Bar */}
                <div className="zoom-top-bar">
                    <div className="top-bar-left">
                        <span className="room-code-badge" onClick={copyInviteLink} title="Click to copy invite link">
                            <span>Room: <strong>{code}</strong></span>
                            <span className="copy-icon">📋</span>
                        </span>
                        <span className="encryption-badge">🔒 Encrypted</span>
                    </div>
                    <div className="top-bar-center">
                        <span className="call-duration-tag">⏱️ {formatDuration(meetingDuration)}</span>
                    </div>
                    <div className="top-bar-right">
                        <button className="invite-top-btn" onClick={copyInviteLink}>
                            🔗 Copy Link
                        </button>
                    </div>
                </div>

                {/* Collaborative drawing canvas overlay */}
                {showWhiteboard ? (
                    <div className="whiteboard-overlay-container">
                        <div className="whiteboard-header">
                            <span className="board-title">
                                ✏️ Collaborative Whiteboard {(!whiteboardSharer?.id || whiteboardSharer?.id === socketRef.current?.id) ? "(You are presenting)" : `(Shared by ${whiteboardSharer?.name || "Presenter"})`}
                            </span>
                            
                            <div className="whiteboard-tool-bar">
                                <button className={`tool-btn ${!isEraser ? 'active' : ''}`} onClick={() => setIsEraser(false)}>✏️ Pen</button>
                                <button className={`tool-btn ${isEraser ? 'active' : ''}`} onClick={() => setIsEraser(true)}>🧽 Eraser</button>
                                
                                {!isEraser && (
                                    <div className="color-selectors">
                                        <span onClick={() => setDrawingColor("#6366f1")} style={{ background: "#6366f1" }} className={drawingColor === "#6366f1" ? 'selected' : ''}></span>
                                        <span onClick={() => setDrawingColor("#ef4444")} style={{ background: "#ef4444" }} className={drawingColor === "#ef4444" ? 'selected' : ''}></span>
                                        <span onClick={() => setDrawingColor("#10b981")} style={{ background: "#10b981" }} className={drawingColor === "#10b981" ? 'selected' : ''}></span>
                                        <span onClick={() => setDrawingColor("#f59e0b")} style={{ background: "#f59e0b" }} className={drawingColor === "#f59e0b" ? 'selected' : ''}></span>
                                        <span onClick={() => setDrawingColor("#ffffff")} style={{ background: "#ffffff" }} className={drawingColor === "#ffffff" ? 'selected' : ''}></span>
                                    </div>
                                )}

                                <div className="stroke-size-selector">
                                    <label>Size:</label>
                                    <input type="range" min="1" max="15" value={drawingSize} onChange={(e) => setDrawingSize(parseInt(e.target.value))} />
                                    <span>{drawingSize}px</span>
                                </div>
                            </div>

                            <div className="whiteboard-actions">
                                {(!whiteboardSharer?.id || whiteboardSharer?.id === socketRef.current?.id || isHost) && (
                                    <button className="clear-btn" onClick={clearCanvas}>Clear Board</button>
                                )}
                                {(!whiteboardSharer?.id || whiteboardSharer?.id === socketRef.current?.id || isHost) ? (
                                    <button className="close-btn stop-board-btn" onClick={stopWhiteboard} title="End whiteboard session for all participants">
                                        🛑 Stop Sharing Board
                                    </button>
                                ) : (
                                    <button className="close-btn minimize-btn" onClick={() => setShowWhiteboard(false)} title="Hide whiteboard locally">
                                        ✕ Hide Board
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="canvas-wrapper">
                            <canvas 
                                ref={canvasRef} 
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                            />
                        </div>
                    </div>
                ) : (
                    <div className={`video-grid ${getGridClass()}`}>
                        {/* Local Feed */}
                        <div className={`video-box local-video-box ${isCameraOff ? 'camera-off' : ''} ${isLocalSpeaking ? 'speaking-border' : ''}`}>
                            {isCameraOff ? (
                                <div className="video-placeholder">
                                    <div className="avatar-circle">
                                        {getInitials(displayName)}
                                    </div>
                                </div>
                            ) : (
                                <video ref={localVideoRef} autoPlay muted playsInline></video>
                            )}
                            <div className="video-label-row">
                                <span className="video-label">
                                    {displayName} (You) {isLocalSpeaking && <span className="speaking-indicator-dot">🎙️</span>}
                                </span>
                                {isMuted && <span className="mute-icon">Muted</span>}
                            </div>
                        </div>

                        {/* Remote Feeds */}
                        {Object.keys(participants)
                            .filter(userId => userId !== socketRef.current?.id)
                            .map((userId) => (
                                <RemoteVideo 
                                    key={userId} 
                                    stream={remoteStreams[userId]} 
                                    name={participants[userId]} 
                                    isCameraOff={participantStates[userId]?.isCameraOff}
                                    isMuted={participantStates[userId]?.isMuted}
                                    isSpeaking={remoteSpeakingStates[userId]}
                                />
                            ))}
                    </div>
                )}

                {/* Subtitles Overlay CC */}
                {activeSubtitles && (
                    <div className="subtitles-overlay-banner">
                        <span className="subtitle-speaker">{activeSubtitles.sender}:</span>
                        <span className="subtitle-text">"{activeSubtitles.text}"</span>
                    </div>
                )}

                {/* Floating Animated Emoji Burst on Screen */}
                {reactionPopup && (
                    <div className="reaction-popup-badge">
                        <span className="reaction-emoji-anim">{reactionPopup}</span>
                    </div>
                )}

                {/* Floating Popovers Backdrop Overlay */}
                {(showShareMenu || showReactPopover || showHostPopover) && (
                    <div className="popovers-backdrop" onClick={closeAllPopovers} />
                )}

                {/* React Emojis Floating Popover */}
                {showReactPopover && (
                    <div className="floating-popover zoom-reaction-popover">
                        <span onClick={() => sendReaction("👍")} title="Thumbs Up">👍</span>
                        <span onClick={() => sendReaction("❤️")} title="Heart">❤️</span>
                        <span onClick={() => sendReaction("😂")} title="Laugh">😂</span>
                        <span onClick={() => sendReaction("👏")} title="Applause">👏</span>
                        <span onClick={() => sendReaction("🎉")} title="Tada">🎉</span>
                        <span onClick={() => sendReaction("🔥")} title="Fire">🔥</span>
                    </div>
                )}

                {/* Share Options Floating Popover */}
                {showShareMenu && (
                    <div className="floating-popover zoom-share-popover">
                        <button onClick={() => { toggleScreenShare(); setShowShareMenu(false); }}>
                            <span className="popover-icon">🖥️</span>
                            <span>{isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}</span>
                        </button>
                        <button onClick={showWhiteboard ? stopWhiteboard : startWhiteboard}>
                            <span className="popover-icon">📋</span>
                            <span>{showWhiteboard ? "Stop Sharing Whiteboard" : "Collaborative Whiteboard"}</span>
                        </button>
                    </div>
                )}

                {/* Host Tools Floating Popover */}
                {showHostPopover && (
                    <div className="floating-popover zoom-host-popover">
                        <div className="popover-header">🛡️ Host Security Tools</div>
                        <button onClick={() => { handleHostMuteAll(true); setShowHostPopover(false); }}>
                            <span className="popover-icon">🎙️❌</span>
                            <span>Mute All Participants</span>
                        </button>
                        <button onClick={() => { handleHostMuteAll(false); setShowHostPopover(false); }}>
                            <span className="popover-icon">🎙️</span>
                            <span>Unmute All Participants</span>
                        </button>
                        <button onClick={() => { handleHostDisableCams(true); setShowHostPopover(false); }}>
                            <span className="popover-icon">🎥❌</span>
                            <span>Turn Off All Cameras</span>
                        </button>
                        <button onClick={() => { handleHostDisableCams(false); setShowHostPopover(false); }}>
                            <span className="popover-icon">🎥</span>
                            <span>Turn On All Cameras</span>
                        </button>
                    </div>
                )}

                {/* Authentically Zoom-inspired Bottom Controls Bar */}
                <div className="zoom-controls-bar">
                    
                    {/* Audio & Camera Buttons (Dropdown styles) */}
                    <div className="zoom-media-controls">
                        <button 
                            className={`zoom-btn ${isMuted ? 'muted' : ''}`} 
                            onClick={toggleMute}
                            title={isMuted ? "Unmute Mic" : "Mute Mic"}
                        >
                            <span className="zoom-btn-icon">{isMuted ? "🎙️❌" : "🎙️"}</span>
                            <span className="zoom-btn-label">{isMuted ? "Unmute" : "Mute"} <span className="chevron-up">^</span></span>
                        </button>
                        
                        <button 
                            className={`zoom-btn ${isCameraOff ? 'off' : ''}`} 
                            onClick={toggleCamera}
                            title={isCameraOff ? "Start Video" : "Stop Video"}
                        >
                            <span className="zoom-btn-icon">{isCameraOff ? "🎥❌" : "🎥"}</span>
                            <span className="zoom-btn-label">{isCameraOff ? "Start Video" : "Stop Video"} <span className="chevron-up">^</span></span>
                        </button>
                    </div>

                    {/* Central Ribbon Navigation items */}
                    <div className="zoom-controls-group">
                        <button 
                            className={`zoom-btn ${showSidebar && sidebarTab === 'participants' ? 'active' : ''}`}
                            onClick={() => handleToggleSidebarTab('participants')}
                            title="Meeting Participants"
                        >
                            <span className="zoom-btn-icon">👥<span className="count-badge">{Object.keys(participants).length || 1}</span></span>
                            <span className="zoom-btn-label">Participants <span className="chevron-up">^</span></span>
                        </button>

                        <button 
                            className={`zoom-btn ${showSidebar && sidebarTab === 'chat' ? 'active' : ''}`} 
                            onClick={() => handleToggleSidebarTab('chat')}
                        >
                            <span className="zoom-btn-icon">💬</span>
                            <span className="zoom-btn-label">Chat <span className="chevron-up">^</span></span>
                        </button>

                        <button 
                            className={`zoom-btn ${showSidebar && sidebarTab === 'polls' ? 'active' : ''}`} 
                            onClick={() => handleToggleSidebarTab('polls')}
                        >
                            <span className="zoom-btn-icon">📊</span>
                            <span className="zoom-btn-label">Polls <span className="chevron-up">^</span></span>
                        </button>

                        {/* Reaction button */}
                        <button 
                            className={`zoom-btn ${showReactPopover ? 'active' : ''}`}
                            onClick={() => {
                                setShowReactPopover(prev => !prev);
                                setShowShareMenu(false);
                                setShowHostPopover(false);
                            }}
                            title="Emoji Reactions"
                        >
                            <span className="zoom-btn-icon">❤️</span>
                            <span className="zoom-btn-label">React</span>
                        </button>

                        {/* Share dropdown button */}
                        <button 
                            className={`zoom-btn green-btn ${showShareMenu ? 'active' : ''}`} 
                            onClick={() => {
                                setShowShareMenu(prev => !prev);
                                setShowReactPopover(false);
                                setShowHostPopover(false);
                            }}
                            title="Share Screen or Whiteboard"
                        >
                            <span className="zoom-btn-icon">⬆️</span>
                            <span className="zoom-btn-label">Share <span className="chevron-up">^</span></span>
                        </button>

                        {/* Security / Host actions (Available for the Room Host) */}
                        {isHost && (
                            <button 
                                className={`zoom-btn ${showHostPopover ? 'active' : ''}`} 
                                onClick={() => {
                                    setShowHostPopover(prev => !prev);
                                    setShowShareMenu(false);
                                    setShowReactPopover(false);
                                }}
                                title="Host Security Tools"
                            >
                                <span className="zoom-btn-icon">🛡️</span>
                                <span className="zoom-btn-label">Host tools</span>
                            </button>
                        )}

                        <button 
                            className={`zoom-btn ${showSidebar && sidebarTab === 'notes' ? 'active' : ''}`} 
                            onClick={() => handleToggleSidebarTab('notes')}
                        >
                            <span className="zoom-btn-icon">✨</span>
                            <span className="zoom-btn-label">Zoom AI</span>
                        </button>

                        <button 
                            className={`zoom-btn ${showSidebar && sidebarTab === 'files' ? 'active' : ''}`} 
                            onClick={() => handleToggleSidebarTab('files')}
                        >
                            <span className="zoom-btn-icon">...</span>
                            <span className="zoom-btn-label">More</span>
                        </button>
                    </div>

                    {/* Red Leave button */}
                    <div className="zoom-actions-right">
                        <button onClick={leaveMeeting} className="zoom-leave-btn">Leave</button>
                    </div>
                </div>
            </div>

            {/* Sidebar Tabbed Panel (Participants + Chat + Files + Polls + AI Notes) */}
            {showSidebar && (
                <div className="sidebar-panel">
                    <div className="sidebar-tabs">
                        <button 
                            className={`tab-btn ${sidebarTab === 'participants' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('participants')}
                        >
                            👥 ({Object.keys(participants).length || 1})
                        </button>
                        <button 
                            className={`tab-btn ${sidebarTab === 'chat' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('chat')}
                        >
                            Chat
                        </button>
                        <button 
                            className={`tab-btn ${sidebarTab === 'polls' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('polls')}
                        >
                            Polls
                        </button>
                        <button 
                            className={`tab-btn ${sidebarTab === 'notes' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('notes')}
                        >
                            AI Notes
                        </button>
                        <button 
                            className={`tab-btn ${sidebarTab === 'files' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('files')}
                        >
                            Files
                        </button>
                        <button className="close-sidebar-btn" onClick={() => setShowSidebar(false)}>✕</button>
                    </div>

                    <div className="sidebar-tab-content">
                        {/* 1. Full Line-by-Line Zoom-Style Participants List */}
                        {sidebarTab === 'participants' && (
                            <div className="participants-tab-panel">
                                <div className="participants-header">
                                    <div className="participants-title-row">
                                        <h4>In-Meeting ({Object.keys(participants).length || 1})</h4>
                                        <button className="copy-invite-pill-btn" onClick={copyInviteLink} title="Copy invite link">
                                            🔗 Copy Link
                                        </button>
                                    </div>
                                    <p className="participants-subtext">Active participants currently in this meeting room</p>
                                </div>

                                <div className="participants-scroll-list">
                                    {/* Local User (You) Card */}
                                    <div className="participant-card local-card">
                                        <div className="participant-card-left">
                                            <div className="participant-avatar local-avatar">
                                                {getInitials(displayName)}
                                            </div>
                                            <div className="participant-info">
                                                <div className="participant-name-row">
                                                    <span className="participant-name">{displayName}</span>
                                                    <span className="participant-badge-you">(Me)</span>
                                                    {isHost && <span className="participant-badge-host">Host</span>}
                                                </div>
                                                <span className="participant-status-text">
                                                    {isLocalSpeaking ? "🎙️ Speaking..." : (isMuted ? "Mic Muted" : "Active")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="participant-card-right">
                                            <button 
                                                className={`status-indicator-btn ${isMuted ? 'muted' : 'active'}`}
                                                onClick={toggleMute}
                                                title={isMuted ? "Unmute My Mic" : "Mute My Mic"}
                                            >
                                                {isMuted ? "🎙️❌" : "🎙️"}
                                            </button>
                                            <button 
                                                className={`status-indicator-btn ${isCameraOff ? 'off' : 'active'}`}
                                                onClick={toggleCamera}
                                                title={isCameraOff ? "Turn On Camera" : "Turn Off Camera"}
                                            >
                                                {isCameraOff ? "🎥❌" : "🎥"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Remote Participants (Line by line) */}
                                    {Object.keys(participants)
                                        .filter(userId => userId !== socketRef.current?.id)
                                        .map((userId) => {
                                            const name = participants[userId] || "Participant"
                                            const state = participantStates[userId] || {}
                                            const isRemoteMuted = state.isMuted
                                            const isRemoteCamOff = state.isCameraOff
                                            const isRemoteSpeaking = remoteSpeakingStates[userId]
                                            const isRemoteHost = userId === hostSocketId

                                            return (
                                                <div key={userId} className="participant-card">
                                                    <div className="participant-card-left">
                                                        <div className="participant-avatar">
                                                            {getInitials(name)}
                                                        </div>
                                                        <div className="participant-info">
                                                            <div className="participant-name-row">
                                                                <span className="participant-name">{name}</span>
                                                                {isRemoteHost && <span className="participant-badge-host">Host</span>}
                                                            </div>
                                                            <span className="participant-status-text">
                                                                {isRemoteSpeaking ? "🎙️ Speaking..." : (isRemoteMuted ? "Mic Muted" : "Active")}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="participant-card-right">
                                                        <span 
                                                            className={`status-indicator-btn ${isRemoteMuted ? 'muted' : 'active'}`}
                                                            title={isRemoteMuted ? "Mic is muted" : "Mic is unmuted"}
                                                        >
                                                            {isRemoteMuted ? "🎙️❌" : "🎙️"}
                                                        </span>
                                                        <span 
                                                            className={`status-indicator-btn ${isRemoteCamOff ? 'off' : 'active'}`}
                                                            title={isRemoteCamOff ? "Camera is off" : "Camera is on"}
                                                        >
                                                            {isRemoteCamOff ? "🎥❌" : "🎥"}
                                                        </span>

                                                        {/* Quick Host Mute Control */}
                                                        {isHost && (
                                                            <button 
                                                                className="quick-host-btn" 
                                                                onClick={() => {
                                                                    socketRef.current?.emit('host-mute-user', userId, !isRemoteMuted)
                                                                    addNotification(`Requested ${isRemoteMuted ? "unmute" : "mute"} for ${name}.`, "info")
                                                                }}
                                                                title={isRemoteMuted ? `Ask ${name} to unmute` : `Mute ${name}`}
                                                            >
                                                                {isRemoteMuted ? "Unmute" : "Mute"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                </div>

                                {/* Bottom Bulk Actions */}
                                <div className="participants-bottom-actions">
                                    {isHost && (
                                        <div className="host-bulk-actions-row">
                                            <button className="bulk-btn mute-all" onClick={() => handleHostMuteAll(true)}>
                                                🎙️ Mute All
                                            </button>
                                            <button className="bulk-btn unmute-all" onClick={() => handleHostMuteAll(false)}>
                                                🎙️ Unmute All
                                            </button>
                                        </div>
                                    )}
                                    <button className="invite-full-width-btn" onClick={copyInviteLink}>
                                        🔗 Copy Meeting Invite Link
                                    </button>
                                </div>
                            </div>
                        )}

                        {sidebarTab === 'chat' && (
                            <div className="chat-tab-panel">
                                <div className="chat-messages-container">
                                    {messages.length === 0 ? (
                                        <div className="empty-chat-state">No messages yet. Send a message to start chatting!</div>
                                    ) : (
                                        messages.map((msg, index) => (
                                            <div key={index} className={`chat-message-bubble ${msg.sender === "You" ? 'sent' : 'received'}`}>
                                                <div className="msg-sender">{msg.sender}</div>
                                                <div className="msg-text">{msg.data}</div>
                                            </div>
                                        ))
                                    )}
                                    <div ref={chatEndRef}></div>
                                </div>
                                <div className="chat-input-row">
                                    <input
                                        type="text"
                                        placeholder="Type a message..."
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                                    />
                                    <button onClick={sendMessage} className="chat-send-btn">Send</button>
                                </div>
                            </div>
                        )}

                        {sidebarTab === 'files' && (
                            <div className="files-tab-panel">
                                <h4>Decentralized File Share</h4>
                                <p className="files-description">
                                    Share files directly between browsers. Files are sent peer-to-peer and are never uploaded to any server.
                                </p>
                                
                                <div className="file-upload-section">
                                    <label htmlFor="file-selector" className="file-selector-label">
                                        Choose File to Share
                                    </label>
                                    <input 
                                        id="file-selector" 
                                        type="file" 
                                        onChange={handleSendFile} 
                                        style={{ display: "none" }}
                                    />
                                </div>

                                {Object.keys(fileTransfers).map(peerId => {
                                    const transfer = fileTransfers[peerId]
                                    return (
                                        <div key={peerId} className="transfer-progress-card">
                                            <span className="transfer-title">{transfer.status === "sending" ? "Sending" : "Receiving"}: {transfer.name}</span>
                                            <div className="transfer-bar-track">
                                                <div className="transfer-bar-fill" style={{ width: `${transfer.progress}%` }}></div>
                                            </div>
                                            <span className="transfer-percent">{transfer.progress}%</span>
                                        </div>
                                    )
                                })}

                                <div className="divider-line"></div>

                                <h4>Received Files</h4>
                                <div className="received-files-list">
                                    {receivedFiles.length === 0 ? (
                                        <div className="empty-files-state">No files received yet.</div>
                                    ) : (
                                        receivedFiles.map((file, idx) => (
                                            <div key={idx} className="received-file-item">
                                                <div className="file-info-col">
                                                    <span className="file-name" title={file.name}>{file.name}</span>
                                                    <span className="file-meta">From: {file.sender} • {formatBytes(file.size)}</span>
                                                </div>
                                                <a href={file.url} download={file.name} className="download-file-btn">
                                                    Download
                                                </a>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {sidebarTab === 'polls' && (
                            <div className="polls-tab-panel">
                                {activePoll ? (
                                    <div className="active-poll-card">
                                        <div className="active-poll-tag">Active Poll</div>
                                        <h4>{activePoll.question}</h4>
                                        
                                        <div className="poll-options-list">
                                            {activePoll.options.map((option, idx) => {
                                                const totalVotes = Object.keys(activePoll.votes).length
                                                const userVote = activePoll.votes[socketRef.current?.id]
                                                const percentage = votesTally[idx]?.percent || 0
                                                const voteCount = votesTally[idx]?.count || 0

                                                return (
                                                    <div key={idx} className="poll-option-item-container">
                                                        {hasVoted || userVote !== undefined ? (
                                                            <div className="poll-results-row">
                                                                <div className="results-label-row">
                                                                    <span>{option} {userVote === idx && <strong className="voted-marker">(Your Vote)</strong>}</span>
                                                                    <span>{voteCount} ({percentage}%)</span>
                                                                </div>
                                                                <div className="results-bar-track">
                                                                    <div className="results-bar-fill" style={{ width: `${percentage}%` }}></div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <button className="poll-vote-btn" onClick={() => castVote(idx)}>
                                                                {option}
                                                            </button>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {/* Reset/End Poll capability strictly protected (only for the creator) */}
                                        {activePoll.creatorId === socketRef.current?.id && (
                                            <button 
                                                className="reset-poll-btn" 
                                                onClick={() => socketRef.current.emit('end-poll')}
                                            >
                                                End Poll for Everyone
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="create-poll-card">
                                        <h4>Create a Poll</h4>
                                        <div className="input-group">
                                            <label>Poll Question</label>
                                            <input 
                                                type="text" 
                                                placeholder="What is your favorite color?" 
                                                value={pollQuestion}
                                                onChange={(e) => setPollQuestion(e.target.value)}
                                            />
                                        </div>
                                        <div className="poll-options-setup">
                                            <label>Options (Min 2)</label>
                                            {pollOptions.map((opt, idx) => (
                                                <div key={idx} className="poll-option-input-row">
                                                    <input 
                                                        type="text" 
                                                        placeholder={`Option ${idx + 1}`}
                                                        value={opt}
                                                        onChange={(e) => updatePollOptionVal(idx, e.target.value)}
                                                    />
                                                    {pollOptions.length > 2 && (
                                                        <button className="del-opt-btn" onClick={() => removePollOptionField(idx)}>✕</button>
                                                    )}
                                                </div>
                                            ))}
                                            {pollOptions.length < 5 && (
                                                <button className="add-opt-btn" onClick={addPollOptionField}>+ Add Option</button>
                                            )}
                                        </div>
                                        <button className="launch-poll-btn" onClick={createPoll}>
                                            🚀 Launch Poll
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {sidebarTab === 'notes' && (
                            <div className="notes-tab-panel">
                                <div className="notes-header-row">
                                    <h4>AI Meeting Minutes</h4>
                                    
                                    {/* AI Recording Pause/Resume Button */}
                                    <button 
                                        className={`ai-record-toggle-btn ${isAiRecording ? 'active' : ''}`}
                                        onClick={toggleAiRecording}
                                        title="Toggle AI Speech Transcription"
                                    >
                                        {isAiRecording ? "🎙️ Active" : "⏸️ Paused"}
                                    </button>

                                    {/* Transcription Language Selector Dropdown (resolves Hindi/Hinglish transcription drops) */}
                                    <div className="transcription-lang-selector">
                                        <select 
                                            value={transcriptionLang} 
                                            onChange={(e) => setTranscriptionLang(e.target.value)}
                                            title="Speech Recognition Language"
                                        >
                                            <option value="en-US">English (US)</option>
                                            <option value="hi-IN">Hindi (India)</option>
                                            <option value="en-IN">English (India)</option>
                                        </select>
                                    </div>

                                    <button className="summary-dl-btn" onClick={downloadSummaryFile}>
                                        📥 Download .MD
                                    </button>
                                </div>
                                <p className="notes-description">
                                    Speech is transcribed and parsed automatically into tasks, summaries, and speaker diarization notes.
                                </p>

                                <div className="notes-divider"></div>

                                {/* Live Summary Block */}
                                <div className="notes-block-section">
                                    <div className="notes-section-title">✨ Live AI Meeting Minutes</div>
                                    <div className="live-summary-container">
                                        <div className="markdown-live-body">
                                            {transcriptLogs.length === 0 ? (
                                                <p className="waiting-placeholder">Waiting for participants to speak to build summary...</p>
                                            ) : (
                                                <pre className="summary-pre-text">{summaryText}</pre>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Live Diarization logs List */}
                                <div className="notes-block-section flex-expand">
                                    <div className="notes-section-title">🗒️ Live Diarized Transcript</div>
                                    <div className="transcript-live-feed">
                                        {transcriptLogs.length === 0 ? (
                                            <div className="empty-notes-state">
                                                No speech recorded. Unmute microphone and start speaking to diarize notes.
                                            </div>
                                        ) : (
                                            transcriptLogs.map((log, idx) => (
                                                <div key={idx} className="transcript-log-item">
                                                    <div className="log-meta">
                                                        <span className="log-speaker">{log.name}</span>
                                                        <span className="log-time">{log.timestamp}</span>
                                                    </div>
                                                    <p className="log-text">"{log.text}"</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default Meeting