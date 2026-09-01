import { useState } from "react"
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BASE_URL } from '../config'
import './Register.css'

function Register(){
    const navigate = useNavigate()
    const [name, setName] = useState("")
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [message, setMessage] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e)=>{
        e.preventDefault()
        setMessage("")
        setLoading(true)
        try {
            const response = await axios.post(`${BASE_URL}/api/v1/users/register`,{
                name: name,
                username: username,
                password: password
            })
            navigate('/login')
        } catch(error){
            console.error(error)
            if (error.response && error.response.data && error.response.data.message) {
                setMessage(error.response.data.message)
            } else {
                setMessage("Something went wrong. Please try again.")
            }
        } finally {
            setLoading(false)
        }
    }

    return(
        <div className="register-container">
            <div className="register-split-left">
                <div className="visual-content">
                    <div className="brand-logo" onClick={() => navigate('/')}>
                        Meet<span>Web</span>
                    </div>
                    <h1>Join MeetWeb Today.</h1>
                    <p>Create an account to host unlimited high-quality meetings, invite guests, and experience seamless real-time signaling.</p>
                    <div className="decorative-avatars">
                        <div className="avatar-dot avatar-1"></div>
                        <div className="avatar-dot avatar-2"></div>
                        <div className="avatar-dot avatar-3"></div>
                    </div>
                </div>
            </div>
            <div className="register-split-right">
                <div className="register-card">
                    <div className="mobile-brand" onClick={() => navigate('/')}>
                        Meet<span>Web</span>
                    </div>
                    <h2>Create Account</h2>
                    <p className="subtitle">Sign up to start scheduling and hosting calls</p>
                    
                    {message && <div className="error-alert">{message}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="input-group">
                            <label htmlFor="name">Full Name</label>
                            <input 
                                id="name"
                                type="text" 
                                placeholder="Enter your name" 
                                value={name} 
                                onChange={(e)=> setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="input-group">
                            <label htmlFor="username">Username</label>
                            <input 
                                id="username"
                                type="text" 
                                placeholder="Choose username" 
                                value={username} 
                                onChange={(e)=> setUsername(e.target.value)}
                                required
                            />
                        </div>
                        <div className="input-group">
                            <label htmlFor="password">Password</label>
                            <div className="password-wrapper">
                                <input 
                                    id="password"
                                    type={showPassword ? "text" : "password"} 
                                    placeholder="Create password" 
                                    value={password} 
                                    onChange={(e)=> setPassword(e.target.value)}
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
                            {loading ? "Registering..." : "Register"}
                        </button>
                    </form>
                    <div className="auth-footer">
                        Already have an account? <span onClick={() => navigate('/login')}>Login here</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Register