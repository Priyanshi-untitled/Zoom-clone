import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BASE_URL } from '../config'
import './GuestJoin.css'

function GuestJoin(){
    const navigate = useNavigate()
    const [name, setName] = useState("")
    const [meetingCode, setMeetingCode] = useState("")
    const [mode, setMode] = useState("join") // "join" or "create"
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    const handleAction = async (e) => {
        e.preventDefault()
        setError("")
        if (!name.trim()) {
            setError("Please enter your name.")
            return
        }

        if (mode === "join") {
            if (!meetingCode.trim()) {
                setError("Please enter a meeting code.")
                return
            }
            navigate(`/meeting/${meetingCode.trim()}`, {state: {guestName: name}})
        } else {
            // Create meeting mode as guest
            setLoading(true)
            try {
                const response = await axios.post(`${BASE_URL}/api/v1/meetings/create-public`, {
                    user_id: "guest_user"
                })
                const code = response.data.meetingCode
                navigate(`/meeting/${code}`, {state: {guestName: name}})
            } catch (err) {
                console.error(err)
                setError("Failed to create a meeting. Please try again.")
            } finally {
                setLoading(false)
            }
        }
    }

    return(
        <div className="guest-page">
            <div className="guest-back-btn" onClick={() => navigate('/')}>
                &larr; Back to Home
            </div>
            <div className="guest-card">
                <div className="guest-logo" onClick={() => navigate('/')}>
                    Meet<span>Web</span>
                </div>
                
                <div className="guest-mode-selector">
                    <button 
                        type="button"
                        className={`mode-tab-btn ${mode === 'join' ? 'active' : ''}`}
                        onClick={() => { setMode('join'); setError(""); }}
                    >
                        Join Call
                    </button>
                    <button 
                        type="button"
                        className={`mode-tab-btn ${mode === 'create' ? 'active' : ''}`}
                        onClick={() => { setMode('create'); setError(""); }}
                    >
                        Create Call
                    </button>
                </div>

                <h2>{mode === 'join' ? "Join as Guest" : "Start as Guest"}</h2>
                <p className="guest-subtitle">
                    {mode === 'join' 
                        ? "No account needed. Just enter your name and the meeting code."
                        : "No account needed. Enter your name to spin up a new meeting room instantly."
                    }
                </p>

                {error && <div className="guest-error-alert">{error}</div>}
                
                <form onSubmit={handleAction}>
                    <div className="input-group">
                        <label htmlFor="guest-name">Your Name</label>
                        <input 
                            id="guest-name"
                            type='text' 
                            placeholder='e.g. John Doe' 
                            value={name} 
                            onChange={(e) => setName(e.target.value)} 
                            required
                        />
                    </div>
                    {mode === 'join' && (
                        <div className="input-group">
                            <label htmlFor="guest-code">Meeting Code</label>
                            <input 
                                id="guest-code"
                                type="text" 
                                placeholder="e.g. ab12cd34" 
                                value={meetingCode} 
                                onChange={(e) => setMeetingCode(e.target.value)} 
                                required 
                            />
                        </div>
                    )}
                    <button type="submit" className="guest-submit-btn" disabled={loading}>
                        {loading 
                            ? "Creating..." 
                            : (mode === 'join' ? "Join Meeting" : "Create & Start Meeting")
                        }
                    </button>
                </form>
            </div>
        </div>
    )
}

export default GuestJoin