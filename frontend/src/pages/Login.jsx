import { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { BASE_URL } from '../config'
import './Login.css'

function Login() {
    const navigate = useNavigate()
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError("")
        setLoading(true)
        try {
            const response = await axios.post(`${BASE_URL}/api/v1/users/login`, {
                username: username,
                password: password
            })
            localStorage.setItem("token", response.data.token)
            navigate('/dashboard')
        } catch (err) {
            console.error(err)
            if (err.response && err.response.data && err.response.data.message) {
                setError(err.response.data.message)
            } else {
                setError("Invalid username or password. Please try again.")
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-container">
            <div className="login-split-left">
                <div className="visual-content">
                    <div className="brand-logo" onClick={() => navigate('/')}>
                        Meet<span>Web</span>
                    </div>
                    <h1>Connect instantly with anyone, anywhere.</h1>
                    <p>Start high-quality video meetings, collaborate on screen sharing, and stay in touch in real time.</p>
                    <div className="decorative-avatars">
                        <div className="avatar-dot avatar-1"></div>
                        <div className="avatar-dot avatar-2"></div>
                        <div className="avatar-dot avatar-3"></div>
                    </div>
                </div>
            </div>
            <div className="login-split-right">
                <div className="login-card">
                    <div className="mobile-brand" onClick={() => navigate('/')}>
                        Meet<span>Web</span>
                    </div>
                    <h2>Welcome Back</h2>
                    <p className="subtitle">Log in to manage your meetings and start calls</p>
                    
                    {error && <div className="error-alert">{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="input-group">
                            <label htmlFor="username">Username</label>
                            <input 
                                id="username"
                                type="text" 
                                placeholder="Enter username" 
                                value={username} 
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                        <div className="input-group">
                            <label htmlFor="password">Password</label>
                            <div className="password-wrapper">
                                <input 
                                    id="password"
                                    type={showPassword ? "text" : "password"} 
                                    placeholder="Enter password" 
                                    value={password} 
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                                <button 
                                    type="button" 
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? "👁️" : "🙈"}
                                </button>
                            </div>
                        </div>
                        <button type="submit" className="submit-btn" disabled={loading}>
                            {loading ? "Logging in..." : "Login"}
                        </button>
                    </form>
                    <div className="auth-footer">
                        Don't have an account? <span onClick={() => navigate('/register')}>Register here</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Login