import { useNavigate } from 'react-router-dom'
import heroImg from '../assests/hero.png'
import './Hero.css'

function Hero() {
    const navigate = useNavigate()

    const handleStartMeeting = () => {
        navigate('/guest-join')
    }

    return (
        <section className="hero">
            <div className="hero-container">
                <div className="left">
                    <span className="badge">✨ Next-Gen Video Conferencing</span>
                    <h3>MeetWeb <br></br>One stop conferencing Platform</h3>
                    <h4>Enjoy, talk, chill with ultra low-latency connection. Fast, secure, and beautiful.</h4>
                    <button className="cta-btn" onClick={handleStartMeeting}>Start a Meeting</button>
                </div>
                <div className="right">
                    <svg width="0" height="0">
                        <defs>
                            <clipPath id="blobShape" clipPathUnits="objectBoundingBox">
                                <path d="M0.6,0.05 C0.8,0.02 0.98,0.15 0.95,0.35 C1.0,0.55 0.9,0.7 0.85,0.85 C0.75,1.0 0.5,1.0 0.35,0.92 C0.15,0.95 0.0,0.8 0.05,0.6 C0.0,0.4 0.1,0.2 0.25,0.1 C0.35,0.0 0.5,0.05 0.6,0.05 Z" />
                            </clipPath>
                        </defs>
                    </svg>
                    <div className="image-wrapper">
                        <img src={heroImg} className="hero-img" alt="Video conferencing" />
                    </div>
                </div>
            </div>
        </section>
    )
}

export default Hero