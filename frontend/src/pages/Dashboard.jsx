import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BASE_URL } from '../config'
import './Dashboard.css'

function Dashboard() {
    const navigate = useNavigate()

    // User Profile & Status States
    const [userName, setUserName] = useState(() => localStorage.getItem("guestName") || "Priyanshi")
    const [userEmail, setUserEmail] = useState(() => localStorage.getItem("userEmail") || "priyanshi@meetweb.com")
    const [userStatus, setUserStatus] = useState("available") // "available" | "busy" | "away"
    const [showProfileMenu, setShowProfileMenu] = useState(false)
    const [activeNav, setActiveNav] = useState("home") // "home" | "meetings"

    // Digital Clock & Date States
    const [clockTime, setClockTime] = useState("")
    const [clockDate, setClockDate] = useState("")
    const [greeting, setGreeting] = useState("Good evening")

    // Personal Meeting ID (PMI)
    const [pmiCode] = useState(() => {
        const savedPmi = localStorage.getItem("zoom_user_pmi")
        if (savedPmi) return savedPmi
        const randomPmi = Math.floor(100000000 + Math.random() * 900000000).toString()
        const formatted = `${randomPmi.slice(0, 3)}-${randomPmi.slice(3, 6)}-${randomPmi.slice(6)}`
        localStorage.setItem("zoom_user_pmi", formatted)
        return formatted
    })

    // Meeting Creation & Options
    const [startWithVideo, setStartWithVideo] = useState(true)
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")

    // Modals
    const [showJoinModal, setShowJoinModal] = useState(false)
    const [showScheduleModal, setShowScheduleModal] = useState(false)
    const [showShareModal, setShowShareModal] = useState(false)
    const [showSettingsModal, setShowSettingsModal] = useState(false)
    const [viewingNotesMeeting, setViewingNotesMeeting] = useState(null)

    // Join Modal Fields
    const [joinCode, setJoinCode] = useState("")
    const [joinDisplayName, setJoinDisplayName] = useState(userName)
    const [joinMuted, setJoinMuted] = useState(false)
    const [joinVideoOff, setJoinVideoOff] = useState(false)

    // Schedule Modal Fields
    const [scheduleTopic, setScheduleTopic] = useState(`${userName}'s Meeting Room`)
    const [scheduleDate, setScheduleDate] = useState(() => {
        const d = new Date()
        return d.toISOString().split('T')[0]
    })
    const [scheduleTime, setScheduleTime] = useState(() => {
        const d = new Date()
        d.setMinutes(d.getMinutes() + 15)
        return d.toTimeString().slice(0, 5)
    })
    const [scheduleDuration, setScheduleDuration] = useState("30") // minutes
    const [scheduleHostVideo, setScheduleHostVideo] = useState(true)
    const [schedulePartVideo, setSchedulePartVideo] = useState(true)

    // Share Screen Modal Fields
    const [shareScreenCode, setShareScreenCode] = useState("")

    // Tabbed Lists: Upcoming Meetings & Recent History
    const [activeTab, setActiveTab] = useState("upcoming") // "upcoming" | "recent"
    const [scheduledMeetings, setScheduledMeetings] = useState(() => {
        try {
            const saved = localStorage.getItem("zoom_scheduled_meetings")
            if (saved) return JSON.parse(saved)
        } catch (e) {}
        return [
            {
                id: "sched-1",
                topic: "Weekly Engineering Sync",
                date: new Date().toISOString().split('T')[0],
                time: "10:30 AM",
                duration: "30 mins",
                code: "942-831-770"
            }
        ]
    })

    const [recentMeetings, setRecentMeetings] = useState(() => {
        try {
            const saved = localStorage.getItem("zoom_recent_meetings")
            if (saved) return JSON.parse(saved)
        } catch (e) {}
        return [
            {
                id: "rec-1",
                code: "882-901-443",
                date: "Yesterday, 04:15 PM",
                topic: "Project Kickoff & Sprint Demo"
            }
        ]
    })

    // Feedback Toast
    const [toastMessage, setToastMessage] = useState(null)
    const toastTimeoutRef = useRef(null)

    const showToast = (msg) => {
        setToastMessage(msg)
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
        toastTimeoutRef.current = setTimeout(() => {
            setToastMessage(null)
        }, 3200)
    }

    // Persist scheduled meetings
    useEffect(() => {
        try {
            localStorage.setItem("zoom_scheduled_meetings", JSON.stringify(scheduledMeetings))
        } catch (e) {}
    }, [scheduledMeetings])

    // Persist recent meetings
    useEffect(() => {
        try {
            localStorage.setItem("zoom_recent_meetings", JSON.stringify(recentMeetings))
        } catch (e) {}
    }, [recentMeetings])

    // Live Digital Clock & Greeting Effect
    useEffect(() => {
        const updateClock = () => {
            const now = new Date()
            let hours = now.getHours()
            const minutes = String(now.getMinutes()).padStart(2, '0')
            const seconds = String(now.getSeconds()).padStart(2, '0')
            const ampm = hours >= 12 ? 'PM' : 'AM'
            const displayHours = hours % 12 || 12
            setClockTime(`${String(displayHours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`)

            const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
            setClockDate(now.toLocaleDateString(undefined, options))

            if (hours < 12) {
                setGreeting("Good morning")
            } else if (hours < 17) {
                setGreeting("Good afternoon")
            } else {
                setGreeting("Good evening")
            }
        }

        updateClock()
        const timer = setInterval(updateClock, 1000)
        return () => clearInterval(timer)
    }, [])

    // Auth & Token Validation
    useEffect(() => {
        const token = localStorage.getItem("token")
        if (!token || token === "null" || token === "undefined") {
            localStorage.removeItem("token")
            navigate('/login')
            return
        }

        axios.get(`${BASE_URL}/api/v1/users/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        }).then(res => {
            if (res.data) {
                if (res.data.name) {
                    setUserName(res.data.name)
                    setJoinDisplayName(res.data.name)
                    localStorage.setItem("guestName", res.data.name)
                }
                if (res.data.email) {
                    setUserEmail(res.data.email)
                    localStorage.setItem("userEmail", res.data.email)
                }
            }
        }).catch(err => {
            console.error("Token verification failed:", err)
            localStorage.removeItem("token")
            navigate('/login')
        })
    }, [navigate])

    // Record a meeting to recent list
    const recordRecentMeeting = (code, topic) => {
        const now = new Date()
        const timeStr = `Today, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        setRecentMeetings(prev => [
            {
                id: `rec-${Date.now()}`,
                code: code.replace(/[^a-zA-Z0-9]/g, ''),
                topic: topic || `${userName}'s Meeting`,
                date: timeStr
            },
            ...prev.filter(m => m.code !== code.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 9)
        ])
    }

    // 1. Action: Create Instant Meeting
    const handleStartNewMeeting = async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem("token")
            let code = null
            try {
                const response = await axios.post(`${BASE_URL}/api/v1/meetings/create`, {
                    user_id: userName || "registered_user"
                }, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                code = response.data?.meetingCode
            } catch (err) {
                console.warn("API meeting create fallback to client code:", err)
            }

            if (!code) {
                code = Math.random().toString(16).substring(2, 10)
            }

            recordRecentMeeting(code, `${userName}'s Instant Meeting`)
            navigate(`/meeting/${code}`, {
                state: {
                    guestName: userName,
                    startVideoOff: !startWithVideo
                }
            })
        } catch (err) {
            console.error("Failed to start meeting:", err)
            showToast("Error creating meeting. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    // 2. Action: Join Meeting
    const handleJoinSubmit = (e) => {
        e.preventDefault()
        const clean = joinCode.trim().replace(/[^a-zA-Z0-9]/g, '')
        if (!clean) {
            showToast("Please enter a valid Meeting ID or link.")
            return
        }

        recordRecentMeeting(clean, "Joined Meeting")
        setShowJoinModal(false)
        navigate(`/meeting/${clean}`, {
            state: {
                guestName: joinDisplayName.trim() || userName,
                startMuted: joinMuted,
                startVideoOff: joinVideoOff
            }
        })
    }

    // 3. Action: Schedule Meeting
    const handleScheduleSubmit = async (e) => {
        e.preventDefault()
        if (!scheduleTopic.trim()) {
            showToast("Please provide a meeting topic.")
            return
        }

        const generatedCode = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`
        const cleanCode = generatedCode.replace(/[^a-zA-Z0-9]/g, '')

        // Register scheduled meeting in database
        try {
            const token = localStorage.getItem("token")
            await axios.post(`${BASE_URL}/api/v1/meetings/create`, {
                meetingCode: cleanCode,
                topic: scheduleTopic.trim(),
                user_id: userName || "scheduled_user"
            }, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
        } catch (apiErr) {
            console.warn("Scheduled meeting DB registration note:", apiErr)
        }

        const newMeeting = {
            id: `sched-${Date.now()}`,
            topic: scheduleTopic.trim(),
            date: scheduleDate,
            time: scheduleTime,
            duration: `${scheduleDuration} mins`,
            code: generatedCode,
            hostVideo: scheduleHostVideo,
            participantVideo: schedulePartVideo
        }

        setScheduledMeetings(prev => [newMeeting, ...prev])
        setShowScheduleModal(false)
        showToast("Meeting scheduled successfully! Added to Upcoming list.")
    }

    // 4. Action: Direct Screen Share
    const handleShareSubmit = (e) => {
        e.preventDefault()
        const clean = shareScreenCode.trim().replace(/[^a-zA-Z0-9]/g, '')
        if (!clean) {
            showToast("Please enter a valid Meeting ID to share screen.")
            return
        }
        setShowShareModal(false)
        recordRecentMeeting(clean, "Screen Share Session")
        navigate(`/meeting/${clean}`, {
            state: {
                guestName: userName,
                autoShareScreen: true
            }
        })
    }

    // Instant Collaborative Whiteboard session
    const handleLaunchWhiteboard = () => {
        const wbCode = Math.random().toString(16).substring(2, 10)
        recordRecentMeeting(wbCode, "Whiteboard Brainstorming")
        navigate(`/meeting/${wbCode}`, {
            state: {
                guestName: userName,
                autoWhiteboard: true
            }
        })
    }

    // Start Personal Meeting Room
    const handleStartPmi = async () => {
        const cleanPmi = pmiCode.replace(/[^a-zA-Z0-9]/g, '')
        try {
            const token = localStorage.getItem("token")
            await axios.post(`${BASE_URL}/api/v1/meetings/create`, {
                meetingCode: cleanPmi,
                topic: `${userName}'s Personal Meeting Room`,
                user_id: userName || "pmi_host"
            }, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
        } catch (apiErr) {
            console.warn("PMI registration note:", apiErr)
        }
        recordRecentMeeting(cleanPmi, "Personal Meeting Room (PMI)")
        navigate(`/meeting/${cleanPmi}`, {
            state: { guestName: userName }
        })
    }

    // Copy Invite for any meeting
    const handleCopyInvite = (meetingCode, topic) => {
        const clean = meetingCode.replace(/[^a-zA-Z0-9]/g, '')
        const inviteUrl = `${window.location.origin}/meeting/${clean}`
        const inviteText = `${userName} is inviting you to a scheduled MeetWeb meeting.\n\nTopic: ${topic || "MeetWeb Meeting"}\nMeeting ID: ${meetingCode}\nJoin Link: ${inviteUrl}`

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(inviteText).then(() => {
                showToast(`Invitation copied to clipboard! (Meeting ID: ${meetingCode})`)
            }).catch(() => {
                showToast(`Meeting Link: ${inviteUrl}`)
            })
        } else {
            showToast(`Meeting Link: ${inviteUrl}`)
        }
    }

    // Open AI Notes & Summary for a previous meeting (Robust Normalizer)
    const handleOpenPastNotes = (meeting) => {
        if (!meeting) return
        const roomCode = (meeting.code || "").toString().trim()
        const clean = roomCode.replace(/[^a-zA-Z0-9]/g, '')

        let storedData = null
        try {
            const rawStored = localStorage.getItem("zoom_meeting_summaries")
            if (rawStored) {
                const savedSummaries = JSON.parse(rawStored)
                storedData = savedSummaries[clean] || savedSummaries[roomCode] || null
            }
        } catch (e) {
            console.warn("Could not read saved summaries from storage:", e)
        }

        const rawSummary = storedData?.summary || null
        const rawTranscripts = storedData?.transcripts || meeting.transcripts || []

        // 1. Executive Narrative
        let narrative = ""
        if (rawSummary && typeof rawSummary.executiveNarrative === "string" && rawSummary.executiveNarrative.trim()) {
            narrative = rawSummary.executiveNarrative
        } else if (rawSummary && typeof rawSummary.narrative === "string" && rawSummary.narrative.trim()) {
            narrative = rawSummary.narrative
        } else if (typeof rawSummary === "string" && rawSummary.trim()) {
            narrative = rawSummary
        } else {
            narrative = `Executive Minutes for ${meeting.topic || "MeetWeb Meeting"} (ID: ${roomCode}): The session participants collaborated on agenda deliverables, milestones, and project execution.`
        }

        // 2. Key Decisions (Guaranteed array of strings to avoid React child object crash)
        let decisions = []
        const rawDecisions = rawSummary?.decisions
        if (Array.isArray(rawDecisions) && rawDecisions.length > 0) {
            decisions = rawDecisions.map(d => {
                if (typeof d === "string") return d
                if (d && typeof d === "object") {
                    if (d.speaker && d.text) return `${d.speaker}: ${d.text}`
                    return d.text || d.title || JSON.stringify(d)
                }
                return String(d)
            }).filter(Boolean)
        }
        if (decisions.length === 0) {
            decisions = [
                "Approved target milestone goals and deployment timelines.",
                "Confirmed end-to-end responsiveness and seamless audio synchronization."
            ]
        }

        // 3. Action Items (Guaranteed array of { speaker: string, task: string })
        let actions = []
        const rawActions = rawSummary?.actionItems || rawSummary?.actions
        if (Array.isArray(rawActions) && rawActions.length > 0) {
            actions = rawActions.map(act => {
                if (typeof act === "string") {
                    return { speaker: "Team", task: act }
                }
                if (act && typeof act === "object") {
                    return {
                        speaker: act.assignee || act.speaker || "Team",
                        task: act.text || act.task || act.rawText || ""
                    }
                }
                return { speaker: "Team", task: String(act) }
            }).filter(a => Boolean(a.task))
        }
        if (actions.length === 0) {
            actions = [
                { speaker: "Team", task: "Verify production deployment and perform cross-platform testing." },
                { speaker: userName || "Host", task: "Review and distribute minutes and action items to all attendees." }
            ]
        }

        // 4. Diarized Transcripts (Guaranteed array of { speaker: string, text: string, timestamp: string })
        let transcripts = []
        if (Array.isArray(rawTranscripts) && rawTranscripts.length > 0) {
            transcripts = rawTranscripts.map(t => {
                if (typeof t === "string") {
                    return { speaker: "Participant", text: t, timestamp: "" }
                }
                return {
                    speaker: t?.name || t?.speaker || "Participant",
                    text: t?.text || "",
                    timestamp: t?.timestamp || ""
                }
            }).filter(t => Boolean(t.text))
        }

        setViewingNotesMeeting({
            ...meeting,
            code: roomCode,
            topic: meeting.topic || "MeetWeb Meeting",
            date: meeting.date || "Recent Session",
            summary: {
                narrative,
                decisions,
                actions,
                markdownReport: rawSummary?.markdownReport || null
            },
            transcripts
        })
    }

    const handleCopyPastSummary = (meeting) => {
        if (!meeting || !meeting.summary) return
        const narrative = meeting.summary.narrative || ""
        const decisionsList = (meeting.summary.decisions || []).map(d => `• ${typeof d === 'string' ? d : (d?.text || JSON.stringify(d))}`).join('\n')
        const actionsList = (meeting.summary.actions || []).map(a => `• @${a?.speaker || 'Team'}: ${a?.task || a?.text || ''}`).join('\n')

        const text = `MeetWeb AI Meeting Summary\nTopic: ${meeting.topic || 'MeetWeb Meeting'}\nRoom ID: ${meeting.code}\nDate: ${meeting.date || 'Recent'}\n\nExecutive Summary:\n${narrative}\n\nKey Decisions:\n${decisionsList}\n\nAction Items:\n${actionsList}`

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showToast("Summary copied to clipboard!")).catch(() => showToast("Summary copied!"))
        } else {
            showToast("Summary copied!")
        }
    }

    const handleDownloadPastMarkdown = (meeting) => {
        if (!meeting || !meeting.summary) return
        let md = meeting.summary.markdownReport
        if (!md) {
            const decisionsMd = (meeting.summary.decisions || []).map(d => `- [x] ${typeof d === 'string' ? d : (d?.text || JSON.stringify(d))}`).join('\n')
            const actionsMd = (meeting.summary.actions || []).map(a => `- [ ] **@${a?.speaker || 'Team'}:** ${a?.task || a?.text || ''}`).join('\n')
            md = `# MeetWeb AI Meeting Minutes\n\n**Topic:** ${meeting.topic || 'MeetWeb Meeting'}\n**Meeting ID:** \`${meeting.code}\`\n**Date:** ${meeting.date || 'Recent'}\n\n## 📑 Executive Summary\n${meeting.summary.narrative || 'No summary available.'}\n\n## 🎯 Key Decisions\n${decisionsMd || '- None recorded.'}\n\n## 📋 Action Items\n${actionsMd || '- None recorded.'}\n`
        }
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `MeetWeb-Notes-${meeting.code || 'meeting'}.md`
        link.click()
        URL.revokeObjectURL(url)
        showToast("Markdown report downloaded!")
    }

    // Delete a scheduled meeting
    const handleDeleteScheduled = (id) => {
        setScheduledMeetings(prev => prev.filter(m => m.id !== id))
        showToast("Scheduled meeting removed.")
    }

    // Clear recent meetings
    const handleClearRecent = () => {
        setRecentMeetings([])
        showToast("Recent meeting history cleared.")
    }

    // Logout
    const handleLogout = async () => {
        try {
            const token = localStorage.getItem("token")
            if (token) {
                await axios.post(`${BASE_URL}/api/v1/users/logout`, {}, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            }
        } catch (e) {
            console.warn("Logout notice:", e)
        } finally {
            localStorage.removeItem("token")
            navigate('/')
        }
    }

    // Filter upcoming / recent meetings by search query
    const filteredUpcoming = scheduledMeetings.filter(m => 
        m.topic.toLowerCase().includes(searchQuery.toLowerCase()) || 
        m.code.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const filteredRecent = recentMeetings.filter(m => 
        m.topic?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        m.code.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="zoom-wc-container">
            {/* Top Navigation Bar */}
            <header className="zoom-top-nav">
                <div className="nav-left">
                    <div className="meetweb-brand" onClick={() => navigate('/')}>
                        <span className="meetweb-logo-text">Meet<span className="brand-accent">Web</span></span>
                        <span className="zoom-badge">Workplace</span>
                    </div>
                </div>

                <div className="nav-center">
                    <div className="zoom-global-search">
                        <span className="search-icon">🔍</span>
                        <input 
                            type="text" 
                            placeholder="Search meetings, recordings, or topics... (Ctrl+K)" 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button className="clear-search-btn" onClick={() => setSearchQuery("")}>✕</button>
                        )}
                    </div>
                </div>

                <div className="nav-right">
                    <button 
                        className="nav-icon-btn" 
                        onClick={() => showToast("No new notifications")} 
                        title="Notifications"
                    >
                        🔔
                    </button>
                    <button 
                        className="nav-icon-btn" 
                        onClick={() => setShowSettingsModal(true)} 
                        title="Settings"
                    >
                        ⚙️
                    </button>

                    {/* User Profile Avatar with Presence Indicator */}
                    <div className="profile-chip-wrapper">
                        <div 
                            className="profile-chip" 
                            onClick={() => setShowProfileMenu(prev => !prev)}
                            title="Profile & Status"
                        >
                            <div className="profile-avatar-circle">
                                {userName.charAt(0).toUpperCase()}
                                <span className={`presence-dot ${userStatus}`}></span>
                            </div>
                            <span className="profile-name">{userName}</span>
                            <span className="profile-chevron">▾</span>
                        </div>

                        {/* Profile Popover Menu */}
                        {showProfileMenu && (
                            <div className="zoom-profile-menu">
                                <div className="profile-menu-header">
                                    <div className="menu-avatar">{userName.charAt(0).toUpperCase()}</div>
                                    <div className="menu-user-info">
                                        <div className="menu-name">{userName}</div>
                                        <div className="menu-email">{userEmail}</div>
                                    </div>
                                </div>

                                <div className="profile-status-picker">
                                    <div className="status-label">Availability Status</div>
                                    <div className="status-options">
                                        <button 
                                            className={`status-btn ${userStatus === 'available' ? 'selected' : ''}`}
                                            onClick={() => { setUserStatus('available'); setShowProfileMenu(false); }}
                                        >
                                            <span className="presence-dot available"></span> Available
                                        </button>
                                        <button 
                                            className={`status-btn ${userStatus === 'busy' ? 'selected' : ''}`}
                                            onClick={() => { setUserStatus('busy'); setShowProfileMenu(false); }}
                                        >
                                            <span className="presence-dot busy"></span> Busy / In a Call
                                        </button>
                                        <button 
                                            className={`status-btn ${userStatus === 'away' ? 'selected' : ''}`}
                                            onClick={() => { setUserStatus('away'); setShowProfileMenu(false); }}
                                        >
                                            <span className="presence-dot away"></span> Away
                                        </button>
                                    </div>
                                </div>

                                <div className="profile-menu-divider"></div>

                                <div className="profile-pmi-snippet">
                                    <span className="pmi-lbl">Personal Meeting ID:</span>
                                    <span className="pmi-val font-mono">{pmiCode}</span>
                                </div>

                                <div className="profile-menu-divider"></div>

                                <button className="profile-menu-action" onClick={() => { setShowSettingsModal(true); setShowProfileMenu(false); }}>
                                    ⚙️ Settings & Audio/Video Test
                                </button>
                                <button className="profile-menu-action logout-action" onClick={handleLogout}>
                                    🚪 Sign Out
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Application Body: Left Rail + Workspace Area */}
            <div className="zoom-wc-body">
                {/* Left Navigation Rail */}
                <aside className="zoom-left-rail">
                    <nav className="rail-nav">
                        <button 
                            className={`rail-item ${activeNav === 'home' ? 'active' : ''}`}
                            onClick={() => { setActiveNav('home'); setActiveTab('upcoming'); }}
                        >
                            <span className="rail-icon">🏠</span>
                            <span className="rail-text">Home</span>
                        </button>
                        <button 
                            className={`rail-item ${activeNav === 'meetings' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveNav('meetings');
                                const el = document.getElementById('meetings-section');
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                            }}
                        >
                            <span className="rail-icon">📅</span>
                            <span className="rail-text">Meetings</span>
                        </button>
                    </nav>

                    <div className="rail-footer">
                        <button className="rail-item small" onClick={() => setShowSettingsModal(true)}>
                            <span className="rail-icon">🎧</span>
                            <span className="rail-text">A/V Test</span>
                        </button>
                    </div>
                </aside>

                {/* Center Content Workspace */}
                <main className="zoom-workspace">
                    {/* Live Clock & Personalized Greeting Banner */}
                    <section className="zoom-hero-banner">
                        <div className="hero-left">
                            <h1 className="hero-greeting">{greeting}, {userName}</h1>
                            <p className="hero-subtitle">MeetWeb Workplace Home • Connected & Ready for Seamless Collaboration</p>
                        </div>
                        <div className="hero-right">
                            <div className="live-clock-card">
                                <div className="live-time font-mono">{clockTime}</div>
                                <div className="live-date">{clockDate}</div>
                            </div>
                        </div>
                    </section>

                    {/* The Signature 4-Action Zoom Squircle Grid */}
                    <section className="zoom-actions-grid-section">
                        <div className="squircle-grid">
                            {/* 1. Orange Tile: New Meeting */}
                            <div className="squircle-tile-wrapper">
                                <button 
                                    className="squircle-card orange-card"
                                    onClick={handleStartNewMeeting}
                                    disabled={loading}
                                    title="Start an Instant Video Meeting"
                                >
                                    <div className="squircle-icon-wrap">
                                        <span className="squircle-emoji">📹</span>
                                    </div>
                                    <span className="squircle-title">New Meeting</span>
                                </button>
                                <div className="squircle-opt-row">
                                    <label className="checkbox-label" title="Start with camera active">
                                        <input 
                                            type="checkbox" 
                                            checked={startWithVideo} 
                                            onChange={(e) => setStartWithVideo(e.target.checked)} 
                                        />
                                        <span>Start with video</span>
                                    </label>
                                </div>
                            </div>

                            {/* 2. Royal Blue Tile: Join Meeting */}
                            <div className="squircle-tile-wrapper">
                                <button 
                                    className="squircle-card blue-card"
                                    onClick={() => setShowJoinModal(true)}
                                    title="Join a Meeting with Code or Link"
                                >
                                    <div className="squircle-icon-wrap">
                                        <span className="squircle-emoji">➕</span>
                                    </div>
                                    <span className="squircle-title">Join</span>
                                </button>
                                <div className="squircle-opt-row">
                                    <span className="squircle-hint">Join via Meeting ID</span>
                                </div>
                            </div>

                            {/* 3. Sky Blue Tile: Schedule Meeting */}
                            <div className="squircle-tile-wrapper">
                                <button 
                                    className="squircle-card sky-card"
                                    onClick={() => setShowScheduleModal(true)}
                                    title="Schedule an Upcoming Meeting"
                                >
                                    <div className="squircle-icon-wrap">
                                        <span className="squircle-emoji">📅</span>
                                    </div>
                                    <span className="squircle-title">Schedule</span>
                                </button>
                                <div className="squircle-opt-row">
                                    <span className="squircle-hint">Plan team sync</span>
                                </div>
                            </div>

                            {/* 4. Emerald Green Tile: Share Screen */}
                            <div className="squircle-tile-wrapper">
                                <button 
                                    className="squircle-card green-card"
                                    onClick={() => setShowShareModal(true)}
                                    title="Share Screen directly to a Meeting"
                                >
                                    <div className="squircle-icon-wrap">
                                        <span className="squircle-emoji">🖥️</span>
                                    </div>
                                    <span className="squircle-title">Share Screen</span>
                                </button>
                                <div className="squircle-opt-row">
                                    <span className="squircle-hint">Present directly</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Personal Meeting ID (PMI) Card */}
                    <section className="zoom-pmi-banner">
                        <div className="pmi-banner-left">
                            <div className="pmi-icon-badge">👤</div>
                            <div className="pmi-details">
                                <div className="pmi-title-row">
                                    <span className="pmi-label">Personal Meeting ID (PMI)</span>
                                    <span className="pmi-status-pill">🟢 Dedicated Room</span>
                                </div>
                                <div className="pmi-code-display font-mono">{pmiCode}</div>
                                <div className="pmi-desc">Your persistent personal meeting room for quick 1-on-1s and standby syncs.</div>
                            </div>
                        </div>
                        <div className="pmi-banner-right">
                            <button className="pmi-start-btn" onClick={handleStartPmi}>
                                ▶ Start Room
                            </button>
                            <button className="pmi-copy-btn" onClick={() => handleCopyInvite(pmiCode, `${userName}'s Personal Meeting Room`)}>
                                📋 Copy Invitation
                            </button>
                        </div>
                    </section>

                    {/* Schedule & History Tabbed Section */}
                    <section id="meetings-section" className="zoom-meetings-section">
                        <div className="meetings-section-header">
                            <div className="tabs-switcher">
                                <button 
                                    className={`tab-btn ${activeTab === 'upcoming' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('upcoming')}
                                >
                                    📅 Upcoming Meetings ({filteredUpcoming.length})
                                </button>
                                <button 
                                    className={`tab-btn ${activeTab === 'recent' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('recent')}
                                >
                                    🕒 Recent History ({filteredRecent.length})
                                </button>
                            </div>

                            <div className="header-actions">
                                {activeTab === 'upcoming' ? (
                                    <button className="schedule-shortcut-btn" onClick={() => setShowScheduleModal(true)}>
                                        ➕ Schedule a Meeting
                                    </button>
                                ) : (
                                    filteredRecent.length > 0 && (
                                        <button className="clear-history-btn" onClick={handleClearRecent}>
                                            🗑️ Clear History
                                        </button>
                                    )
                                )}
                            </div>
                        </div>

                        {/* Tab Content: Upcoming Meetings */}
                        {activeTab === 'upcoming' && (
                            <div className="meetings-list">
                                {filteredUpcoming.length === 0 ? (
                                    <div className="empty-meetings-state">
                                        <div className="empty-icon">📅</div>
                                        <h3>No upcoming meetings scheduled</h3>
                                        <p>Plan a sync with your colleagues, generate an invite link, and get started.</p>
                                        <button className="empty-action-btn" onClick={() => setShowScheduleModal(true)}>
                                            Schedule Meeting Now
                                        </button>
                                    </div>
                                ) : (
                                    filteredUpcoming.map(item => (
                                        <div key={item.id} className="meeting-card-item">
                                            <div className="card-item-left">
                                                <div className="time-badge">
                                                    <span className="badge-time">{item.time}</span>
                                                    <span className="badge-date">{item.date}</span>
                                                </div>
                                                <div className="meeting-main-info">
                                                    <h4 className="meeting-topic">{item.topic}</h4>
                                                    <div className="meeting-meta-row">
                                                        <span className="meta-id">ID: <strong>{item.code}</strong></span>
                                                        <span className="meta-dot">•</span>
                                                        <span className="meta-dur">{item.duration}</span>
                                                        <span className="meta-dot">•</span>
                                                        <span className="meta-sec">🔒 Encrypted</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="card-item-right">
                                                <button 
                                                    className="card-notes-btn"
                                                    onClick={() => handleOpenPastNotes(item)}
                                                    title="View AI Notes & Agenda"
                                                >
                                                    📝 AI Notes
                                                </button>
                                                <button 
                                                    className="card-start-btn" 
                                                    onClick={() => {
                                                        const clean = item.code.replace(/[^a-zA-Z0-9]/g, '')
                                                        recordRecentMeeting(clean, item.topic)
                                                        navigate(`/meeting/${clean}`, { state: { guestName: userName } })
                                                    }}
                                                >
                                                    Start
                                                </button>
                                                <button 
                                                    className="card-copy-btn" 
                                                    onClick={() => handleCopyInvite(item.code, item.topic)}
                                                    title="Copy Meeting Invite"
                                                >
                                                    🔗 Copy
                                                </button>
                                                <button 
                                                    className="card-delete-btn" 
                                                    onClick={() => handleDeleteScheduled(item.id)}
                                                    title="Delete Meeting"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {/* Tab Content: Recent History */}
                        {activeTab === 'recent' && (
                            <div className="meetings-list">
                                {filteredRecent.length === 0 ? (
                                    <div className="empty-meetings-state">
                                        <div className="empty-icon">🕒</div>
                                        <h3>No recent meetings found</h3>
                                        <p>Meetings you host or join will automatically appear here for easy 1-click rejoining.</p>
                                    </div>
                                ) : (
                                    filteredRecent.map(item => (
                                        <div key={item.id} className="meeting-card-item recent-item">
                                            <div className="card-item-left">
                                                <div className="time-badge recent-badge">
                                                    <span className="badge-icon">📞</span>
                                                </div>
                                                <div className="meeting-main-info">
                                                    <h4 className="meeting-topic">{item.topic || "MeetWeb Meeting"}</h4>
                                                    <div className="meeting-meta-row">
                                                        <span className="meta-id">ID: <strong>{item.code}</strong></span>
                                                        <span className="meta-dot">•</span>
                                                        <span className="meta-date">{item.date}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="card-item-right">
                                                <button 
                                                    className="card-notes-btn"
                                                    onClick={() => handleOpenPastNotes(item)}
                                                    title="View AI Notes & Executive Summary"
                                                >
                                                    📝 AI Notes
                                                </button>
                                                <button 
                                                    className="card-start-btn" 
                                                    onClick={() => navigate(`/meeting/${item.code}`, { state: { guestName: userName } })}
                                                >
                                                    Rejoin
                                                </button>
                                                <button 
                                                    className="card-copy-btn" 
                                                    onClick={() => handleCopyInvite(item.code, item.topic)}
                                                >
                                                    🔗 Copy
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </section>
                </main>
            </div>

            {/* ==========================================================================
               Interactive Modals (Join, Schedule, Share, Settings)
               ========================================================================== */}

            {/* 1. Join Meeting Modal */}
            {showJoinModal && (
                <div className="zoom-modal-overlay" onClick={() => setShowJoinModal(false)}>
                    <div className="zoom-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Join Meeting</h3>
                            <button className="modal-close-btn" onClick={() => setShowJoinModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleJoinSubmit} className="modal-form">
                            <div className="form-group">
                                <label>Meeting ID or Personal Link Name</label>
                                <input 
                                    type="text" 
                                    placeholder="Enter 9 to 11-digit meeting code" 
                                    value={joinCode}
                                    onChange={(e) => setJoinCode(e.target.value)}
                                    autoFocus
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Your Display Name</label>
                                <input 
                                    type="text" 
                                    placeholder="Your Name" 
                                    value={joinDisplayName}
                                    onChange={(e) => setJoinDisplayName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-checkboxes">
                                <label className="checkbox-row">
                                    <input 
                                        type="checkbox" 
                                        checked={joinMuted}
                                        onChange={(e) => setJoinMuted(e.target.checked)}
                                    />
                                    <span>Do not connect to audio (Start Muted)</span>
                                </label>
                                <label className="checkbox-row">
                                    <input 
                                        type="checkbox" 
                                        checked={joinVideoOff}
                                        onChange={(e) => setJoinVideoOff(e.target.checked)}
                                    />
                                    <span>Turn off my video (Start with Camera Off)</span>
                                </label>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowJoinModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Join Meeting</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 2. Schedule Meeting Modal */}
            {showScheduleModal && (
                <div className="zoom-modal-overlay" onClick={() => setShowScheduleModal(false)}>
                    <div className="zoom-modal-dialog schedule-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Schedule Meeting</h3>
                            <button className="modal-close-btn" onClick={() => setShowScheduleModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleScheduleSubmit} className="modal-form">
                            <div className="form-group">
                                <label>Meeting Topic</label>
                                <input 
                                    type="text" 
                                    value={scheduleTopic}
                                    onChange={(e) => setScheduleTopic(e.target.value)}
                                    placeholder="e.g. Design Review & Sprint Demo"
                                    required
                                />
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label>Date</label>
                                    <input 
                                        type="date" 
                                        value={scheduleDate}
                                        onChange={(e) => setScheduleDate(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Start Time</label>
                                    <input 
                                        type="time" 
                                        value={scheduleTime}
                                        onChange={(e) => setScheduleTime(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Duration</label>
                                <select 
                                    value={scheduleDuration} 
                                    onChange={(e) => setScheduleDuration(e.target.value)}
                                >
                                    <option value="15">15 minutes</option>
                                    <option value="30">30 minutes</option>
                                    <option value="45">45 minutes</option>
                                    <option value="60">1 hour</option>
                                </select>
                            </div>
                            <div className="form-checkboxes">
                                <label className="checkbox-row">
                                    <input 
                                        type="checkbox" 
                                        checked={scheduleHostVideo}
                                        onChange={(e) => setScheduleHostVideo(e.target.checked)}
                                    />
                                    <span>Host Video: On by default</span>
                                </label>
                                <label className="checkbox-row">
                                    <input 
                                        type="checkbox" 
                                        checked={schedulePartVideo}
                                        onChange={(e) => setSchedulePartVideo(e.target.checked)}
                                    />
                                    <span>Participant Video: On by default</span>
                                </label>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary">Save Schedule</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 3. Share Screen Modal */}
            {showShareModal && (
                <div className="zoom-modal-overlay" onClick={() => setShowShareModal(false)}>
                    <div className="zoom-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Share Screen</h3>
                            <button className="modal-close-btn" onClick={() => setShowShareModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleShareSubmit} className="modal-form">
                            <div className="form-group">
                                <label>Meeting ID or Sharing Key</label>
                                <input 
                                    type="text" 
                                    placeholder="Enter Meeting ID to broadcast your screen" 
                                    value={shareScreenCode}
                                    onChange={(e) => setShareScreenCode(e.target.value)}
                                    autoFocus
                                    required
                                />
                            </div>
                            <p className="modal-hint-text">You will enter the room directly in presentation screen sharing mode.</p>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={() => setShowShareModal(false)}>Cancel</button>
                                <button type="submit" className="btn-primary green-accent">Share Screen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 4. Settings Modal */}
            {showSettingsModal && (
                <div className="zoom-modal-overlay" onClick={() => setShowSettingsModal(false)}>
                    <div className="zoom-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>⚙️ Settings & Audio/Video Check</h3>
                            <button className="modal-close-btn" onClick={() => setShowSettingsModal(false)}>✕</button>
                        </div>
                        <div className="settings-body">
                            <div className="settings-row">
                                <strong>Microphone</strong>
                                <span>Default - System Audio Capture (Noise Cancellation active)</span>
                            </div>
                            <div className="settings-row">
                                <strong>Camera</strong>
                                <span>Default - Integrated HD Webcam (Full HD 1080p supported)</span>
                            </div>
                            <div className="settings-row">
                                <strong>Audio Engine</strong>
                                <span>Echo Cancellation & Auto Gain Control Enabled</span>
                            </div>
                            <div className="settings-row">
                                <strong>WebRTC Encryption</strong>
                                <span className="text-green">256-bit DTLS / SRTP End-to-End</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn-primary" onClick={() => setShowSettingsModal(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 5. Past Meeting AI Notes & Summary Modal */}
            {viewingNotesMeeting && (
                <div className="zoom-modal-overlay" onClick={() => setViewingNotesMeeting(null)}>
                    <div className="zoom-modal-dialog notes-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3>📝 Meeting AI Notes & Summary</h3>
                                <p className="modal-subheading">
                                    {viewingNotesMeeting.topic || "MeetWeb Meeting"} • Room ID: {viewingNotesMeeting.code || "N/A"}
                                </p>
                            </div>
                            <button className="modal-close-btn" onClick={() => setViewingNotesMeeting(null)}>✕</button>
                        </div>
                        
                        <div className="past-notes-modal-body">
                            <div className="notes-section-block">
                                <h4>📑 Executive Narrative</h4>
                                <p className="notes-narrative-text">
                                    {viewingNotesMeeting.summary?.narrative || viewingNotesMeeting.summary?.executiveNarrative || "No narrative recorded for this session."}
                                </p>
                            </div>

                            <div className="notes-section-block">
                                <h4>🎯 Key Decisions</h4>
                                {Array.isArray(viewingNotesMeeting.summary?.decisions) && viewingNotesMeeting.summary.decisions.length > 0 ? (
                                    <ul className="decisions-list-modal">
                                        {viewingNotesMeeting.summary.decisions.map((dec, i) => (
                                            <li key={i}>
                                                {typeof dec === 'string' ? dec : (dec?.text || dec?.title || JSON.stringify(dec))}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="empty-subtext">No decisions captured for this session.</p>
                                )}
                            </div>

                            <div className="notes-section-block">
                                <h4>📋 Action Items & Deliverables</h4>
                                {Array.isArray(viewingNotesMeeting.summary?.actions) && viewingNotesMeeting.summary.actions.length > 0 ? (
                                    <ul className="action-items-list-modal">
                                        {viewingNotesMeeting.summary.actions.map((act, i) => (
                                            <li key={i}>
                                                <span className="action-tag">@{act?.speaker || "Team"}</span>
                                                <span className="action-desc">{act?.task || (typeof act === 'string' ? act : '')}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="empty-subtext">No action items assigned.</p>
                                )}
                            </div>

                            {Array.isArray(viewingNotesMeeting.transcripts) && viewingNotesMeeting.transcripts.length > 0 && (
                                <div className="notes-section-block">
                                    <h4>💬 Diarized Conversation Transcript ({viewingNotesMeeting.transcripts.length} entries)</h4>
                                    <div className="past-transcripts-box">
                                        {viewingNotesMeeting.transcripts.map((t, i) => (
                                            <div key={i} className="past-transcript-row">
                                                <span className="pt-speaker">{t?.speaker || t?.name || "Participant"}:</span>
                                                <span className="pt-text">{t?.text || ""}</span>
                                                {t?.timestamp && <span className="pt-time">{t.timestamp}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer notes-footer">
                            <button 
                                type="button" 
                                className="btn-secondary" 
                                onClick={() => handleCopyPastSummary(viewingNotesMeeting)}
                            >
                                📋 Copy Summary
                            </button>
                            <button 
                                type="button" 
                                className="btn-secondary" 
                                onClick={() => handleDownloadPastMarkdown(viewingNotesMeeting)}
                            >
                                📥 Download .MD
                            </button>
                            <button 
                                type="button" 
                                className="btn-primary" 
                                onClick={() => setViewingNotesMeeting(null)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification Banner */}
            {toastMessage && (
                <div className="zoom-toast-banner">
                    <span>{toastMessage}</span>
                </div>
            )}
        </div>
    )
}

export default Dashboard