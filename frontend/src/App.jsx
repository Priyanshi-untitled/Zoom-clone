import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LandingPage from "./pages/LandingPage"
import Login from "./pages/Login"
import Register from "./pages/Register"
import Dashboard from './pages/Dashboard'
import Meeting from './pages/Meeting'
import GuestJoin from './pages/GuestJoin'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error("MeetWeb Application Error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#FFFFFF',
          color: '#1E293B',
          fontFamily: "'Outfit', sans-serif",
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ color: '#64748B', maxWidth: '480px', marginBottom: '24px', lineHeight: '1.6' }}>
            A temporary display error occurred. You can return to the dashboard or reload.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.href = '/dashboard'; }}
              style={{
                padding: '10px 22px',
                background: '#0B5CFF',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Go to Dashboard
            </button>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              style={{
                padding: '10px 22px',
                background: '#F1F5F9',
                color: '#334155',
                border: '1px solid #CBD5E1',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/meeting/:code" element={<Meeting />} />
          <Route path="/guest-join" element={<GuestJoin />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App