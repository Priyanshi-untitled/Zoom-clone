import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { io } from 'socket.io-client'
import axios from 'axios'
import { BASE_URL } from '../config'
import './Meeting.css'

const peerConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
}
function RemoteVideo({ stream, name, isCameraOff, isMuted, isSpeaking }) {
    const videoRef = useRef(null)

    useEffect(() => {
        if (videoRef.current && stream && !isCameraOff) {
            if (videoRef.current.srcObject !== stream) {
                videoRef.current.srcObject = stream
            }
            videoRef.current.play().catch(() => {})
        }
    }) // Runs on every render to ensure srcObject binding is persistent

    const getInitials = (userName) => {
        if (!userName) return "?";
        return userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    return (
        <div className={`video-box ${isCameraOff ? 'camera-off' : ''} ${isSpeaking ? 'speaking-border' : ''}`}>
            {isCameraOff ? (
                <div className="video-placeholder">
                    <div className="avatar-circle">
                        {getInitials(name)}
                    </div>
                </div>
            ) : (
                <video ref={videoRef} autoPlay playsInline></video>
            )}
            <div className="video-label-row">
                <span className="video-label">
                    {name || "Participant"} {isSpeaking && <span className="speaking-indicator-dot">🎙️</span>}
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

    // Zoom-inspired custom layout states
    const [showShareMenu, setShowShareMenu] = useState(false)
    const [showHostPopover, setShowHostPopover] = useState(false)
    const [showReactPopover, setShowReactPopover] = useState(false)
    const [showWhiteboard, setShowWhiteboard] = useState(false)

    // Room Host identification socket tracking
    const [hostSocketId, setHostSocketId] = useState(null)

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

    const startDrawing = (e) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        
        lastPosRef.current = { x, y }
        setIsDrawing(true)
    }

    const draw = (e) => {
        if (!isDrawing || !canvasRef.current) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

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

    const stopDrawing = () => {
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

    // ---- Helper: ek naye user ke liye peer connection banao ----
    const createPeerConnection = (userId, isOfferer = false) => {
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
                socketRef.current.emit('signal', userId, JSON.stringify({ ice: event.candidate }))
            }
        }

        peersRef.current[userId] = peer
        return peer
    }

    // ---- Mute / Camera toggle ----
    const toggleMute = () => {
        const audioTrack = localStreamRef.current.getAudioTracks()[0]
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
        socketRef.current.emit('toggle-mute', !audioTrack.enabled)

        // Sync local Speech recognition with mute toggle
        if (recognitionRef.current) {
            if (audioTrack.enabled) {
                try {
                    recognitionRef.current.start()
                } catch (e) {
                    console.warn("Speech recognition already running:", e)
                }
            } else {
                try {
                    recognitionRef.current.stop()
                } catch (e) {}
            }
        }
    }

    const toggleCamera = () => {
        const videoTrack = localStreamRef.current.getVideoTracks()[0]
        videoTrack.enabled = !videoTrack.enabled
        setIsCameraOff(!videoTrack.enabled)
        socketRef.current.emit('toggle-camera', !videoTrack.enabled)
    }

    // ---- Screen Share ----
    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
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

                // When user clicks browser's built-in "Stop sharing" button
                screenTrack.onended = () => stopScreenShare()

            } catch (err) {
                console.log("Screen share error:", err)
            }
        } else {
            stopScreenShare()
        }
    }

    const stopScreenShare = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop())
        }
        const camTrack = localStreamRef.current.getVideoTracks()[0]

        Object.values(peersRef.current).forEach(peer => {
            const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video')
            if (sender) sender.replaceTrack(camTrack)
        })

        setCurrentLocalStream(localStreamRef.current)
        setIsScreenSharing(false)
        isScreenSharingRef.current = false
    }

    // ---- Chat ----
    const sendMessage = () => {
        if (chatInput.trim() === "") return
        socketRef.current.emit('chat-message', chatInput, displayName)
        setMessages(prev => [...prev, { sender: "You", data: chatInput }])
        setChatInput("")
    }

    // ---- Emoji Reaction ----
    const sendReaction = (emoji) => {
        socketRef.current.emit('chat-message', `__REACTION__${emoji}`, displayName)
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
        socketRef.current.emit('create-poll', pollQuestion, filteredOptions)
        setPollQuestion("")
        setPollOptions(["", ""])
    }

    const castVote = (optionIdx) => {
        socketRef.current.emit('cast-vote', optionIdx)
        setHasVoted(true)
    }

    // ---- AI Notes Real-time Compiler ----
    useEffect(() => {
        if (transcriptLogs.length === 0) {
            setSummaryText("No transcription logs recorded yet. Speak in the meeting to generate live notes!")
            return
        }

        // Assemble full diarized logs
        const fullTranscript = transcriptLogs.map(log => `[${log.timestamp}] ${log.name}: ${log.text}`).join('\n')

        // Extract unique participant list
        const speakers = Array.from(new Set(transcriptLogs.map(log => log.name)))
        
        // Semantic filters to parse decisions and actions in real-time
        const actionKeywords = ["i will", "we need to", "make sure", "todo", "action", "task", "scheduled", "assign"]
        const actionItems = []
        const decisionKeywords = ["decided", "agreed", "confirmed", "approved", "we should", "resolved"]
        const decisions = []

        transcriptLogs.forEach(log => {
            const lowerText = log.text.toLowerCase()
            if (actionKeywords.some(keyword => lowerText.includes(keyword))) {
                actionItems.push(`${log.name} committed to: "${log.text}"`)
            }
            if (decisionKeywords.some(keyword => lowerText.includes(keyword))) {
                decisions.push(`Resolved: "${log.text}" (Suggested by ${log.name})`)
            }
        })

        const summaryOutput = `
# 📝 Live Meeting Notes
**Room:** ${code}
**Date:** ${new Date().toLocaleDateString()}
**Participants:** ${speakers.join(', ') || "No active speakers"}

---

## 📌 Executive Summary
Active discussion containing **${transcriptLogs.length}** diarized speech statements.

---

## 🛠️ Action Items & Checklists
${actionItems.length > 0 
    ? actionItems.map(item => `- [ ] ${item}`).join('\n') 
    : "- Speak/assign tasks (e.g. 'I will finish...') to auto-log action items."
}

---

## 🤝 Key Decisions Made
${decisions.length > 0 
    ? decisions.map(dec => `- ${dec}`).join('\n') 
    : "- Say statements like 'We decided...' or 'Confirmed...' to auto-log decisions."
}
        `.trim()

        setSummaryText(summaryOutput)
    }, [transcriptLogs, code])

    const downloadSummaryFile = () => {
        const element = document.createElement("a")
        const file = new Blob([summaryText + `\n\n---\n\n## 🗒️ Complete Chronological Transcript Logs\n\`\`\`text\n` + transcriptLogs.map(log => `[${log.timestamp}] ${log.name}: ${log.text}`).join('\n') + `\n\`\`\``], { type: 'text/plain' })
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

    // Host utility actions (Now supports explicit enable/disable signals)
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
        const count = Object.keys(remoteStreams).length + 1
        if (count === 1) return "grid-1"
        if (count === 2) return "grid-2"
        if (count <= 4) return "grid-4"
        return "grid-multi"
    }

    // Init call & socket
    useEffect(() => {
        const init = async () => {
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

            // Setup audio media
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            setCurrentLocalStream(stream)
            localStreamRef.current = stream

            // Local Mic Volume level check for local speaking border
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

                    const activeText = finalText || interimText
                    if (activeText.trim()) {
                        socketRef.current?.emit('user-speech', activeText, finalText !== '')
                        setActiveSubtitles({ sender: "You", text: activeText })

                        if (finalText !== '') {
                            setTranscriptLogs(prev => [...prev, {
                                name: "You",
                                text: finalText,
                                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            }])
                            setTimeout(() => {
                                setActiveSubtitles(prev => (prev && prev.sender === "You" ? null : prev))
                            }, 3000)
                        }
                    }
                }

                rec.onend = () => {
                    const currentMuted = !localStreamRef.current?.getAudioTracks()[0]?.enabled
                    if (localStreamRef.current && !currentMuted) {
                        try {
                            rec.start()
                        } catch (e) {}
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
                socketRef.current.emit('join-call', code, resolvedName)
            })

            // Verify room entry failures
            socketRef.current.on('join-error', (errMsg) => {
                alert(errMsg)
                navigate('/dashboard')
            })

            // When a user joins (direct overwrite fixes user count leaks)
            socketRef.current.on('user-joined', async (newUserId, newUserName, usersList, hostId) => {
                setHostSocketId(hostId)
                const newParticipants = {}
                const newStates = {}
                usersList.forEach(u => {
                    newParticipants[u.id] = u.name
                    newStates[u.id] = { isMuted: u.isMuted, isCameraOff: u.isCameraOff }
                })
                setParticipants(newParticipants)
                setParticipantStates(newStates)

                if (newUserId !== socketRef.current.id) {
                    createPeerConnection(newUserId, true) // isOfferer = true
                    const peer = peersRef.current[newUserId]
                    const offer = await peer.createOffer()
                    await peer.setLocalDescription(offer)
                    socketRef.current.emit('signal', newUserId, JSON.stringify({ sdp: peer.localDescription }))
                }
            })

            // When a user leaves
            socketRef.current.on('user-left', (userId, newHostId) => {
                if (newHostId) {
                    setHostSocketId(newHostId)
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
                const signalData = JSON.parse(message)
                let peer = peersRef.current[fromId]
                if (!peer) {
                    peer = createPeerConnection(fromId, false)
                }

                if (signalData.sdp) {
                    await peer.setRemoteDescription(new RTCSessionDescription(signalData.sdp))
                    if (signalData.sdp.type === 'offer') {
                        const answer = await peer.createAnswer()
                        await peer.setLocalDescription(answer)
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

            // Speech transcription broadcast receiver
            socketRef.current.on('user-speech', (speechData) => {
                const { name, text, isFinal } = speechData
                setActiveSubtitles({ sender: name, text })

                if (isFinal) {
                    setTranscriptLogs(prev => [...prev, {
                        name,
                        text,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }])

                    setTimeout(() => {
                        setActiveSubtitles(prev => (prev && prev.sender === name ? null : prev))
                    }, 3000)
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

            socketRef.current.on('whiteboard-start', () => {
                setShowWhiteboard(true)
                addNotification("Collaborative whiteboard started by host.", "info")
            })

            // Host remote overrides triggers (supports true/false parameters to allow toggles)
            socketRef.current.on('host-mute-all', (shouldMute) => {
                const audioTrack = localStreamRef.current?.getAudioTracks()[0]
                if (audioTrack) {
                    audioTrack.enabled = !shouldMute
                    setIsMuted(shouldMute)
                    socketRef.current?.emit('toggle-mute', shouldMute)
                    addNotification(shouldMute ? "You have been muted by the host." : "You have been unmuted by the host.", "info")
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
                {/* Collaborative drawing canvas overlay */}
                {showWhiteboard ? (
                    <div className="whiteboard-overlay-container">
                        <div className="whiteboard-header">
                            <span className="board-title">✏️ Collaborative Whiteboard</span>
                            
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
                                <button className="clear-btn" onClick={clearCanvas}>Clear Board</button>
                                <button className="close-btn" onClick={() => setShowWhiteboard(false)}>✕ Close</button>
                            </div>
                        </div>
                        <div className="canvas-wrapper">
                            <canvas 
                                ref={canvasRef} 
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                            />
                        </div>
                    </div>
                ) : (
                    <div className={`video-grid ${getGridClass()}`}>
                        {/* Local Feed using callback ref for mount cycle bindings */}
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

                        {/* Remote Feeds using stable callback ref */}
                        {Object.entries(remoteStreams).map(([userId, stream]) => (
                            <RemoteVideo 
                                key={userId} 
                                stream={stream} 
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

                {reactionPopup && <div className="reaction-popup">{reactionPopup}</div>}

                {/* Authentically Zoom-inspired Bottom Controls Bar (Matches Uploaded Image Spec) */}
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

                    {/* Central Ribbon Navigation items (Matches Zoom layout exactly) */}
                    <div className="zoom-controls-group">
                        <button 
                            className="zoom-btn"
                            onClick={() => addNotification(`Total Participants: ${Object.keys(participants).length || 1}`, "info")}
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

                        {/* Reaction popup selector */}
                        <div className="zoom-reaction-container">
                            <button 
                                className={`zoom-btn ${showReactPopover ? 'active' : ''}`}
                                onClick={() => setShowReactPopover(!showReactPopover)}
                            >
                                <span className="zoom-btn-icon">❤️</span>
                                <span className="zoom-btn-label">React</span>
                            </button>
                            {showReactPopover && (
                                <div className="zoom-reaction-popover">
                                    <span onClick={() => { sendReaction("👍"); setShowReactPopover(false); }}>👍</span>
                                    <span onClick={() => { sendReaction("😂"); setShowReactPopover(false); }}>😂</span>
                                    <span onClick={() => { sendReaction("❤️"); setShowReactPopover(false); }}>❤️</span>
                                    <span onClick={() => { sendReaction("👏"); setShowReactPopover(false); }}>👏</span>
                                </div>
                            )}
                        </div>

                        {/* Share dropdown popover (Screen share & Whiteboard) */}
                        <div className="zoom-share-container">
                            <button 
                                className="zoom-btn green-btn" 
                                onClick={() => setShowShareMenu(!showShareMenu)}
                            >
                                <span className="zoom-btn-icon">⬆️</span>
                                <span className="zoom-btn-label">Share <span className="chevron-up">^</span></span>
                            </button>
                            {showShareMenu && (
                                <div className="zoom-share-popover">
                                    <button onClick={() => { toggleScreenShare(); setShowShareMenu(false); }}>🖥️ Share Screen</button>
                                    <button onClick={() => { setShowWhiteboard(true); socketRef.current?.emit('whiteboard-start'); setShowShareMenu(false); }}>📋 Collaborative Whiteboard</button>
                                </div>
                            )}
                        </div>

                        {/* Security / Host actions (Exclusively visible for the Room Host/Creator) */}
                        {socketRef.current?.id === hostSocketId && (
                            <div className="zoom-host-container">
                                <button 
                                    className={`zoom-btn ${showHostPopover ? 'active' : ''}`} 
                                    onClick={() => setShowHostPopover(!showHostPopover)}
                                >
                                    <span className="zoom-btn-icon">🛡️</span>
                                    <span className="zoom-btn-label">Host tools</span>
                                </button>
                                {showHostPopover && (
                                    <div className="zoom-host-popover">
                                        <button onClick={() => { handleHostMuteAll(true); setShowHostPopover(false); }}>🎙️ Mute All</button>
                                        <button onClick={() => { handleHostMuteAll(false); setShowHostPopover(false); }}>🎙️ Unmute All</button>
                                        <button onClick={() => { handleHostDisableCams(true); setShowHostPopover(false); }}>🎥 Turn Off All Cams</button>
                                        <button onClick={() => { handleHostDisableCams(false); setShowHostPopover(false); }}>🎥 Turn On All Cams</button>
                                    </div>
                                )}
                            </div>
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

            {/* Sidebar Tabbed Panel (Chat + Files + Polls + AI Notes) */}
            {showSidebar && (
                <div className="sidebar-panel">
                    <div className="sidebar-tabs">
                        <button 
                            className={`tab-btn ${sidebarTab === 'chat' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('chat')}
                        >
                            Chat
                        </button>
                        <button 
                            className={`tab-btn ${sidebarTab === 'files' ? 'active' : ''}`}
                            onClick={() => setSidebarTab('files')}
                        >
                            Files
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
                        <button className="close-sidebar-btn" onClick={() => setShowSidebar(false)}>✕</button>
                    </div>

                    <div className="sidebar-tab-content">
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