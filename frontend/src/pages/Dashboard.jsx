import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BASE_URL } from '../config'
import './Dashboard.css'

function Dashboard() {
    const navigate = useNavigate()
    const [meetingCode, setMeetingCode] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    useEffect(() => {
        const token = localStorage.getItem("token")
        if (!token || token === "null" || token === "undefined") {
            localStorage.removeItem("token")
            navigate('/login')
            return
        }

        // Validate token on mount by calling profile API
        axios.get(`${BASE_URL}/api/v1/users/profile`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }).then(res => {
            if (res.data && res.data.name) {
                localStorage.setItem("guestName", res.data.name)
            }
        }).catch(err => {
            console.error("Token verification failed:", err)
            localStorage.removeItem("token")
            navigate('/login')
        })
    }, [navigate])

    const handleCreateMeeting = async () => {
        setError("")
        setLoading(true)
        try {
            const token = localStorage.getItem("token")
            const response = await axios.post(`${BASE_URL}/api/v1/meetings/create`, {
                user_id: "registered_user"
            }, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            })
            const code = response.data.meetingCode
            navigate(`/meeting/${code}`)
        } catch (err) {
            console.error(err)
            setError("Failed to create meeting. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    const handleJoinMeeting = (e) => {
        e.preventDefault()
        if (!meetingCode.trim()) {
            setError("Please enter a valid meeting code.")
            return
        }
        navigate(`/meeting/${meetingCode}`)
    }

    const handleLogout = () => {
        localStorage.removeItem("token")
        navigate('/')
    }

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div className="dashboard-logo" onClick={() => navigate('/')}>
                    Meet<span>Web</span>
                </div>
                <button className="logout-btn" onClick={handleLogout}>Log Out</button>
            </header>

            <main className="dashboard-main">
                <div className="dashboard-welcome">
                    <h2>Welcome to your Control Hub</h2>
                    <p>Start a new instance or join an active video call seamlessly.</p>
                </div>

                {error && <div className="error-alert">{error}</div>}

                <div className="dashboard-actions">
                    <div className="action-card create-card">
                        <div className="card-icon">🚀</div>
                        <h3>Create Instant Meeting</h3>
                        <p>Generate a unique meeting room and invite participants right away.</p>
                        <button 
                            className="create-btn" 
                            onClick={handleCreateMeeting}
                            disabled={loading}
                        >
                            {loading ? "Generating Code..." : "New Meeting"}
                        </button>
                    </div>

                    <div className="action-card join-card">
                        <div className="card-icon">🔑</div>
                        <h3>Join via Code</h3>
                        <p>Enter the meeting code shared by the host to connect directly.</p>
                        <form onSubmit={handleJoinMeeting}>
                            <input 
                                type="text" 
                                placeholder="Enter 8-character code"
                                value={meetingCode}
                                onChange={(e) => setMeetingCode(e.target.value)} 
                                required
                            />
                            <button type="submit" className="join-btn">Join Call</button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    )
}

export default Dashboard