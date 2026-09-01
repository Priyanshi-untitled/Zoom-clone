import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LandingPage from "./pages/LandingPage"
import Login from "./pages/Login"
import Register from "./pages/Register"
import Dashboard from './pages/Dashboard'
import Meeting  from './pages/Meeting'
import GuestJoin from './pages/GuestJoin'


function App() {
  return (
     <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register/>} />
        <Route path="/dashboard" element={<Dashboard/>} />
        <Route path="/meeting/:code" element={<Meeting />} />
        <Route path="/guest-join" element={<GuestJoin />} />
      </Routes>
     </BrowserRouter>

  )
}

export default App