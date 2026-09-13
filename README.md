# MeetWeb — Full-Stack Real-Time Video Conferencing & Security Guide

MeetWeb is an enterprise-grade, high-performance web conferencing platform built with React, Node.js, Express, Socket.io, and WebRTC. It supports multi-participant peer-to-peer audio/video calling, screen sharing, collaborative whiteboards, live speech transcription with automated AI meeting minutes, real-time polling, and decentralized P2P file transfers.

---

## 🏛️ System Architecture

### 1. WebRTC Signaling & Mesh Topology
```
                    [ Signaling Server (Socket.io) ]
                     /              |             \
            (SDP Offer/Answer) (ICE Candidates) (Room State)
                   /                |               \
            +------------+    +------------+    +------------+
            |  Peer A    |<-->|   Peer B   |<-->|   Peer C   |
            +------------+    +------------+    +------------+
                   ^                                ^
                   +--------------------------------+
                        (Direct P2P Encrypted Media)
```

- **Mesh (Full-Mesh Peer-to-Peer)**:
  - Each participant establishes direct `RTCPeerConnection` links to every other participant in the room.
  - Media streams (audio and video) flow directly between client browsers with end-to-end DTLS-SRTP encryption without passing through the media server.
  - **Bandwidth Profile**: $N \times (N - 1)$ connections. Ideal for small-to-medium meetings (up to 8–10 participants) with zero media relay latency and minimum server compute costs.
  - **Bitrate Optimizer**: Custom SDP munging (`boostSdpBitrate`) injects `b=AS:3500`, `b=TIAS:3500000`, and `x-google-min-bitrate=1500` to prevent resolution degradation and pixelation during high-motion feeds.

- **Signaling Layer**:
  - Express + Socket.io handle room discovery, SDP offers/answers exchange, ICE candidate routing, and host authorization state.

---

## 🔒 Security Hardening & Audit Resolution

The platform was hardened against 10 critical security and scalability vulnerabilities:

### 1. Host Impersonation Protection (CRITICAL)
- **Problem**: Previously, any socket client could emit `make-host`, `host-mute-all`, `host-disable-video`, or `host-mute-user` without verification, allowing rogue participants to seize room ownership or silence the conference.
- **Fix**: The backend validates caller authority against the host record (`connections[matchingRoom][0]`) before executing any host privilege. If a non-host attempts a host action, the request is immediately dropped and an `action-denied` security alert is emitted to the caller.

### 2. Room Access Control, Database Validation & Waiting Room
- **Problem**: Sockets could invent arbitrary room codes and auto-create unauthorized meetings in memory. Non-existent, locked, or private rooms lacked admission control.
- **Fix**:
  - `join-call` queries MongoDB (`Meeting.findOne({ meetingCode: cleanCode })`). Unregistered or inactive meeting codes are rejected with `join-error`.
  - Added support for meeting passwords via `bcrypt.compare`.
  - Added **Room Locking** (`toggle-lock-meeting`): Prevents any new participants from joining once locked.
  - Added **Waiting Room** (`waiting-for-host`): Unadmitted participants wait in a designated lobby until the host issues an `admit-user` or `reject-user` command.

### 3. Expirable Cryptographically Signed JWTs
- **Problem**: Tokens were arbitrary random hexadecimal strings without expiration, valid indefinitely in the database.
- **Fix**:
  - Switched to signed JSON Web Tokens (`jsonwebtoken`) with a 7-day expiration lifespan (`expiresIn: "7d"`).
  - Stored `tokenExpiresAt` timestamp in MongoDB `User` model.
  - Enforced expiry checks in `auth.middleware.js` using both `jwt.verify` and DB TTL check (`user.tokenExpiresAt < new Date()`).
  - Implemented `/api/v1/users/logout` route that revokes the token in DB and clears client-side cookies.

### 4. Auth Token Storage Architecture: localStorage vs HttpOnly Cookies
- **Implementation**:
  - Backend now issues an **HttpOnly, SameSite=Lax, Secure** cookie upon login.
  - It also returns `{ token }` in the JSON response to maintain compatibility with single-page applications (SPA) across cross-origin deployments.
- **Enterprise Trade-off Deep-Dive**:
  | Strategy | Pros | Cons / Vulnerabilities | Mitigation |
  | :--- | :--- | :--- | :--- |
  | **`localStorage`** | Simple SPA integration, works across subdomains/ports without complex CORS cookie policies. | Vulnerable to **XSS (Cross-Site Scripting)**. Any injected script can read `localStorage.getItem("token")` and exfiltrate it. | Strict Content Security Policy (CSP), input sanitization, and output encoding. |
  | **`HttpOnly Cookies`** | **Immune to JavaScript XSS exfiltration**. The browser attaches the cookie automatically with requests. | Vulnerable to **CSRF (Cross-Site Request Forgery)** if SameSite and CORS are misconfigured. | Use `SameSite: "Strict"` or `"Lax"`, custom CSRF tokens (`X-CSRF-Token` header), and explicit origin whitelists. |
  | **Recommended Enterprise Hybrid** | Short-lived JWT (15 min) in memory + Refresh Token stored in an HttpOnly cookie with token rotation. | Requires token refresh endpoint and interceptors. | Maximum defense-in-depth against both XSS and CSRF. |

### 5. CORS Hardening
- **Problem**: Using `origin: "*"` with `credentials: true` violated CORS specifications and exposed endpoints to unauthorized cross-origin requests.
- **Fix**:
  - Express CORS and Socket.io CORS use explicit origin validation matching `process.env.FRONTEND_URL` and trusted local development ports (`localhost:5173`, `localhost:3000`, `127.0.0.1`).
  - Dynamic origin reflection safely enables `credentials: true` for cookie transmission.

### 6. Public Meeting Route Abuse Mitigation
- **Problem**: `/api/v1/meetings/create-public` was unprotected, allowing attackers to spam meeting creation and exhaust MongoDB storage.
- **Fix**: Applied `publicMeetingLimiter` using `express-rate-limit` restricting IPs to a maximum of 15 meeting creations per hour.

### 7. Brute-Force & DDoS Rate Limiting
- **Problem**: `/login` and `/register` endpoints were vulnerable to credential stuffing and brute-force password cracking.
- **Fix**:
  - Applied `authLimiter`: Max 10 attempts per 15-minute window per IP for `/login` and `/register`.
  - Applied `generalLimiter`: Max 300 requests per 15-minute window across all `/api` routes.

### 8. Password Strength Enforcement
- **Problem**: Users could register with weak single-character passwords.
- **Fix**:
  - Backend validation in `user.controller.js`: Minimum 8 characters, requiring at least one number or special character (`/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/`).
  - Frontend validation in `Register.jsx`: `minLength={8}`, regex validation, real-time error messages, and UI helper guidelines.

### 9. Elimination of Dead & Incomplete Routes
- **Problem**: `users.routes.js` exposed empty stubs `/add_to_activity` and `/get_all_activity` that threw runtime unhandled exceptions.
- **Fix**: Removed dead routes and standardized on authenticated `/api/v1/meetings/history` for meeting record retrieval.

### 10. In-Memory State & Multi-Instance Horizontal Scaling Architecture
- **Problem**: Room participant lists (`connections`), muted states, whiteboard paths, and waiting room lists are stored in Node.js process memory. In a multi-instance or Kubernetes cluster behind a load balancer, users connecting to Instance A cannot discover users on Instance B.
- **Fix & Production Scaling Architecture**: See detailed section below.

---

## 🚀 Horizontal Scaling with Redis Pub/Sub & Socket.io Redis Adapter

To scale MeetWeb horizontally across multiple backend instances:

```
                          [ Client Traffic ]
                                  |
                        [ NGINX / Cloud LB ]
                         (Sticky Sessions)
                        /         |        \
            [ Backend Node 1 ] [ Backend Node 2 ] [ Backend Node 3 ]
                        \         |        /
                   [ Redis Adapter (Pub/Sub) ]
                   [ Redis Cluster (State/TTL) ]
```

### 1. The Socket.io Redis Adapter
When Node.js instances are clustered, events emitted to `io.to(room).emit(...)` only reach clients connected to that specific process.
- Install `@socket.io/redis-adapter` and `redis`:
  ```bash
  npm install @socket.io/redis-adapter redis
  ```
- Configure in `socketManager.js`:
  ```javascript
  import { createClient } from "redis";
  import { createAdapter } from "@socket.io/redis-adapter";

  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  ```
- **Result**: When Instance 1 emits `"user-joined"` to room `xyz`, the adapter publishes the message to Redis. Redis broadcasts it to Instance 2 and Instance 3, delivering the signaling message to all peers regardless of which server holds their WebSocket connection.

### 2. Distributed State with Redis Hashes & Sets
Replace local in-memory dictionaries with Redis data structures:
- **Room Participants**: `SADD room:<meetingCode>:participants <socketId>`
- **Host ID**: `HSET room:<meetingCode> host <socketId>`
- **Participant Metadata**: `HSET socket:<socketId> name "Alex" isMuted "false" isCameraOff "false"`
- **Waiting Room Queue**: `RPUSH room:<meetingCode>:waiting <socketId>`
- **TTL / Cleanup**: Set key expiry on room termination (`EXPIRE room:<meetingCode> 86400`).

### 3. Load Balancer Sticky Sessions
WebRTC signaling starts with an HTTP long-polling handshake before upgrading to WebSocket. The load balancer (e.g. AWS ALB, NGINX, Cloudflare) must be configured with **Sticky Sessions** (Cookie-based session affinity) so that polling and upgrade packets from the same client hit the same server during handshake initialization.

---

## 💻 Tech Stack

- **Frontend**: React 18, Vite, React Router v6, Socket.io Client, WebRTC Native API, Canvas API, Web Speech Recognition API.
- **Backend**: Node.js, Express.js, Socket.io, MongoDB / Mongoose, JSON Web Tokens (JWT), bcrypt.js, express-rate-limit.
- **Styling**: Modern dark-themed CSS with glassmorphism, responsive grid layout, and accessibility features.

---

## 🛠️ Environment Configuration

### Backend (`backend/.env`)
```env
PORT=8000
MONGO_URL=mongodb+srv://<username>:<password>@cluster.mongodb.net/meetweb
JWT_SECRET=your_super_secret_cryptographic_key_at_least_32_characters_long
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### Frontend (`frontend/.env` or `frontend/src/config.js`)
```env
VITE_BACKEND_URL=http://localhost:8000
```

---

## ⚡ Getting Started Locally

### 1. Clone & Install Dependencies
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Start Development Servers
```bash
# Run backend (Terminal 1)
cd backend
npm run dev

# Run frontend (Terminal 2)
cd frontend
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

