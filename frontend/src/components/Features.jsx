import { useEffect, useRef, useState } from 'react'
import './Features.css'

export default function Features() {
    const [activeIndex, setActiveIndex] = useState(0)
    const sectionRefs = useRef([])

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const index = parseInt(entry.target.getAttribute('data-index'), 10)
                        setActiveIndex(index)
                    }
                })
            },
            {
                threshold: 0.6,
                rootMargin: "-10% 0px -10% 0px"
            }
        )

        sectionRefs.current.forEach((ref) => {
            if (ref) observer.observe(ref)
        })

        return () => {
            sectionRefs.current.forEach((ref) => {
                if (ref) observer.unobserve(ref)
            })
        }
    }, [])

    return (
        <section className="features-section">
            <div className="features-container">
                {/* Left Side: Sticky Mockup Visuals */}
                <div className="features-sticky-left">
                    <div className="mockup-display">
                        {activeIndex === 0 && (
                            <div className="mockup-card active-mockup">
                                <div className="mockup-video-call">
                                    <div className="video-avatar avatar-large">PV</div>
                                    <div className="video-avatar avatar-small">JD</div>
                                    <div className="video-controls-row">
                                        <span className="control-dot mic">🎙️</span>
                                        <span className="control-dot video">📹</span>
                                        <span className="control-dot hangup">📞</span>
                                    </div>
                                    <span className="mockup-badge">HD Active</span>
                                </div>
                            </div>
                        )}
                        {activeIndex === 1 && (
                            <div className="mockup-card active-mockup">
                                <div className="mockup-chat">
                                    <div className="chat-bubble received">Hey everyone! 👋</div>
                                    <div className="chat-bubble sent">Hi, ready for the call?</div>
                                    <div className="chat-bubble received">Yes, let's share the screen.</div>
                                    <div className="typing-dots">
                                        <span></span><span></span><span></span>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeIndex === 2 && (
                            <div className="mockup-card active-mockup">
                                <div className="mockup-screenshare">
                                    <div className="screenshare-window">
                                        <div className="window-header">
                                            <span className="header-dot red"></span>
                                            <span className="header-dot yellow"></span>
                                            <span className="header-dot green"></span>
                                            <span className="window-title">My Screen Share</span>
                                        </div>
                                        <div className="window-body">
                                            <div className="body-bar"></div>
                                            <div className="body-bar short"></div>
                                            <div className="body-grid">
                                                <div className="grid-item"></div>
                                                <div className="grid-item"></div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mini-feed">You</div>
                                </div>
                            </div>
                        )}
                        {activeIndex === 3 && (
                            <div className="mockup-card active-mockup">
                                <div className="mockup-security">
                                    <div className="shield-icon">🔒</div>
                                    <h4>End-to-End Encrypted</h4>
                                    <p>Zero-Knowledge signaling tunnels protect call integrity.</p>
                                    <div className="encryption-bars">
                                        <span className="bar active"></span>
                                        <span className="bar active"></span>
                                        <span className="bar active"></span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Side: Scrolling Feature Description Cards */}
                <div className="features-scroll-right">
                    <div 
                        className={`feature-text-block ${activeIndex === 0 ? 'active' : ''}`}
                        ref={(el) => (sectionRefs.current[0] = el)}
                        data-index="0"
                    >
                        <span className="feature-number">01</span>
                        <h3>HD Video & Audio Calling</h3>
                        <p>
                            Experience crystal clear high-definition video calls with low latency. Connect with up to 10+ participants simultaneously with automatic quality adaptations for slower networks.
                        </p>
                    </div>

                    <div 
                        className={`feature-text-block ${activeIndex === 1 ? 'active' : ''}`}
                        ref={(el) => (sectionRefs.current[1] = el)}
                        data-index="1"
                    >
                        <span className="feature-number">02</span>
                        <h3>Real-Time Sidebar Chat</h3>
                        <p>
                            Interact during calls using the slide-out panel containing channels, emoji reactions, and text logs. Stay in sync with in-call float alerts so you never miss a message.
                        </p>
                    </div>

                    <div 
                        className={`feature-text-block ${activeIndex === 2 ? 'active' : ''}`}
                        ref={(el) => (sectionRefs.current[2] = el)}
                        data-index="2"
                    >
                        <span className="feature-number">03</span>
                        <h3>Seamless Screen Sharing</h3>
                        <p>
                            Share your windows or full desktop instantly. WebRTC tracks adjust on late joins to ensure new entrants see shared screen feeds instantly.
                        </p>
                    </div>

                    <div 
                        className={`feature-text-block ${activeIndex === 3 ? 'active' : ''}`}
                        ref={(el) => (sectionRefs.current[3] = el)}
                        data-index="3"
                    >
                        <span className="feature-number">04</span>
                        <h3>End-to-End Privacy Protection</h3>
                        <p>
                            Secure your meetings with database room validation keys. Prevent meeting hijacking, utilize authenticated route middleware, and share files privately with peer-to-peer data channels.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}
