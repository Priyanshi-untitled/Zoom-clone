import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Navbar.css'

function Navbar(){
    const navigate = useNavigate()
    const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light")

    useEffect(() => {
        if (theme === "dark") {
            document.body.classList.add("dark-theme")
        } else {
            document.body.classList.remove("dark-theme")
        }
        localStorage.setItem("theme", theme)
    }, [theme])

    const toggleTheme = () => {
        setTheme(prev => prev === "light" ? "dark" : "light")
    }

    return(
        <nav className="navbar">
            <div className="navbar-container">
                <div className="left" onClick={() => navigate('/')}>
                    <h2 className="logo">Meet<span>Web</span></h2>
                </div>
                <div className="right">
                    <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Theme">
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                    <button className="btn-guest" onClick={() => navigate('/guest-join')}>Join as Guest</button>
                    <button className="btn-register" onClick={() => navigate('/register')}>Register</button>
                    <button className="btn-login" onClick={() => navigate('/login')}>Login</button>
                </div>
            </div>
        </nav>
    )
}

export default Navbar