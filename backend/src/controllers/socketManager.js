import {Server} from "socket.io";
import { Meeting } from "../models/meeting.model.js";
import bcrypt from "bcrypt";

let connections = {};
let socketNames = {};
let socketMutedStates = {};
let socketCameraStates = {};
let activePolls = {}; // { roomKey: { question, options, votes: { socketId: optionIndex } } }
let roomTranscripts = {}; // { roomKey: [ { id, senderId, name, text, timestamp, createdAt, isManual } ] }
let messages = {};
let timeOnline = {};
let waitingUsers = {}; // { roomKey: [ { socketId, name, joinedAt } ] }
let roomLocks = {}; // { roomKey: boolean }
let roomWaitingEnabled = {}; // { roomKey: boolean }

const icebreakers = [
    "If you could have any superpower, what would it be?",
    "What is the most adventurous thing you've ever done?",
    "If you could travel back in time, which era would you visit?",
    "What is your absolute favorite comfort food?",
    "If you could only use 3 apps on your phone, what would they be?",
    "Would you rather live in space or under the sea?",
    "What's the best book you've read or movie you've watched recently?",
    "If you could have dinner with any historical figure, who would it be?",
    "What's your go-to productivity hack?"
];

const findRoomOfSocket = (socketId) => {
    for (const [room, ids] of Object.entries(connections)) {
        if (ids.includes(socketId)) return room;
    }
    return null;
};

export const connectToSocket = (server) => {
    // Issue 5: Secure CORS with explicit origin matching & credentials support
    const allowedOrigins = process.env.FRONTEND_URL 
        ? process.env.FRONTEND_URL.split(",").map(o => o.trim())
        : ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"];

    const io = new Server(server, {
        cors: {
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (allowedOrigins.includes(origin) || allowedOrigins.includes("*") || process.env.NODE_ENV !== "production") {
                    return callback(null, origin);
                }
                return callback(null, allowedOrigins[0] || true);
            },
            methods: ["GET", "POST"],
            allowedHeaders: ["Content-Type", "Authorization"],
            credentials: true
        }
    });

    const admitUserToRoom = (cleanCode, socket, name) => {
        if (connections[cleanCode] === undefined) {
            connections[cleanCode] = [];
        }

        if (!connections[cleanCode].includes(socket.id)) {
            connections[cleanCode].push(socket.id);
        }

        socketNames[socket.id] = name || "Participant";
        socketMutedStates[socket.id] = false;
        socketCameraStates[socket.id] = false;
        timeOnline[socket.id] = new Date();

        const usersList = connections[cleanCode].map(id => ({
            id,
            name: socketNames[id] || "Participant",
            isMuted: socketMutedStates[id] || false,
            isCameraOff: socketCameraStates[id] || false
        }));

        const hostId = connections[cleanCode][0];
        connections[cleanCode].forEach((elem) => {
            io.to(elem).emit("user-joined", socket.id, socketNames[socket.id], usersList, hostId);
        });

        // Replay chat messages
        if (messages[cleanCode] !== undefined) {
            messages[cleanCode].forEach((msg) => {
                io.to(socket.id).emit("chat-message", msg.data, msg.sender, msg['socket-id-sender']);
            });
        }

        // Sync active poll if it exists
        if (activePolls[cleanCode] !== undefined) {
            io.to(socket.id).emit("poll-update", activePolls[cleanCode]);
        }

        // Sync room transcripts to newly joined participant
        if (roomTranscripts[cleanCode] && roomTranscripts[cleanCode].length > 0) {
            io.to(socket.id).emit("room-transcript-sync", roomTranscripts[cleanCode]);
        }
    };

    io.on("connection", (socket) => {

        socket.on("join-call", async (path, name, password) => {
            try {
                // Extract clean room code
                const cleanCode = (path || "").toString().replace(/^\/meeting\//, "").split("/").pop().trim();
                if (!cleanCode) {
                    socket.emit("join-error", "Invalid room code.");
                    return;
                }

                // Issue 2: Verify meeting code in DB or check if already active
                let meeting = null;
                try {
                    meeting = await Meeting.findOne({ meetingCode: cleanCode });
                } catch (dbErr) {
                    console.warn("DB check warning:", dbErr.message);
                }

                const isRoomActive = connections[cleanCode] && connections[cleanCode].length > 0;

                // Reject if neither registered in database nor an active room
                if (!meeting && !isRoomActive) {
                    socket.emit("join-error", "Meeting does not exist or has expired. Please verify the code or schedule a meeting.");
                    return;
                }

                // Check meeting lock status
                if (roomLocks[cleanCode] || (meeting && meeting.isLocked)) {
                    socket.emit("join-error", "This meeting has been locked by the host.");
                    return;
                }

                // Check password if set on meeting
                if (meeting && meeting.password) {
                    const passwordProvided = (password || "").toString().trim();
                    const isMatch = await bcrypt.compare(passwordProvided, meeting.password);
                    if (!isMatch) {
                        socket.emit("join-error", "Incorrect meeting password.");
                        return;
                    }
                }

                // Check Waiting Room feature
                const isWaitingOn = roomWaitingEnabled[cleanCode] ?? (meeting ? meeting.isWaitingRoomEnabled : false);
                const hasHost = connections[cleanCode] && connections[cleanCode].length > 0;

                if (isWaitingOn && hasHost) {
                    if (!waitingUsers[cleanCode]) waitingUsers[cleanCode] = [];
                    waitingUsers[cleanCode] = waitingUsers[cleanCode].filter(u => u.socketId !== socket.id);
                    waitingUsers[cleanCode].push({
                        socketId: socket.id,
                        name: name || "Participant",
                        joinedAt: Date.now()
                    });

                    socket.emit("waiting-for-host", {
                        meetingCode: cleanCode,
                        message: "Please wait, the meeting host will let you in soon."
                    });

                    // Notify host of the pending join request
                    const hostId = connections[cleanCode][0];
                    io.to(hostId).emit("join-request", {
                        socketId: socket.id,
                        name: name || "Participant"
                    });
                    return;
                }

                admitUserToRoom(cleanCode, socket, name);
            } catch (err) {
                console.error("Socket join error:", err);
                socket.emit("join-error", "Could not join meeting room.");
            }
        });

        socket.on("signal", (toId, message) => {
            io.to(toId).emit("signal", socket.id, message);
        });

        socket.on("chat-message", (data, sender) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = [];
                }
                messages[matchingRoom].push({
                    'sender': sender, 
                    "data": data, 
                    "socket-id-sender": socket.id
                });
                console.log("message", matchingRoom, ":", sender, data);

                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("chat-message", data, sender, socket.id);
                    }
                });
            }
        });

        // Toggle mute status
        socket.on("toggle-mute", (isMuted) => {
            socketMutedStates[socket.id] = isMuted;
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach(elem => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("user-toggle-mute", socket.id, isMuted);
                    }
                });
            }
        });

        // Toggle camera status
        socket.on("toggle-camera", (isCameraOff) => {
            socketCameraStates[socket.id] = isCameraOff;
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach(elem => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("user-toggle-camera", socket.id, isCameraOff);
                    }
                });
            }
        });

        // Create Poll
        socket.on("create-poll", (question, options) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                activePolls[matchingRoom] = {
                    question,
                    options,
                    votes: {}, // socketId: optionIndex
                    creatorId: socket.id
                };
                connections[matchingRoom].forEach(elem => {
                    io.to(elem).emit("poll-update", activePolls[matchingRoom]);
                });
            }
        });

        // Cast Vote
        socket.on("cast-vote", (optionIndex) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom && activePolls[matchingRoom]) {
                activePolls[matchingRoom].votes[socket.id] = optionIndex;
                connections[matchingRoom].forEach(elem => {
                    io.to(elem).emit("poll-update", activePolls[matchingRoom]);
                });
            }
        });

        // End Poll
        socket.on("end-poll", () => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom && activePolls[matchingRoom]) {
                // Ensure only creator can end/delete the poll
                if (activePolls[matchingRoom].creatorId === socket.id) {
                    delete activePolls[matchingRoom];
                    connections[matchingRoom].forEach(elem => {
                        io.to(elem).emit("poll-update", null);
                    });
                }
            }
        });

        // User Speech Transcription Relay & Centralized Transcript Store
        socket.on("user-speech", (text, isFinal) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !text || text.trim().length < 2) return;
            const senderName = socketNames[socket.id] || "Participant";

            // Relay live interim speech to other participants for real-time live subtitles
            connections[matchingRoom].forEach((elem) => {
                if (elem !== socket.id) {
                    io.to(elem).emit("user-speech", {
                        senderId: socket.id,
                        name: senderName,
                        text: text.trim(),
                        isFinal
                    });
                }
            });

            // If finalized speech, persist to room transcript history and broadcast new-transcript-entry to ALL participants
            if (isFinal) {
                if (!roomTranscripts[matchingRoom]) {
                    roomTranscripts[matchingRoom] = [];
                }
                const newEntry = {
                    id: `ts_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                    senderId: socket.id,
                    name: senderName,
                    text: text.trim(),
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    createdAt: Date.now()
                };

                // Prevent duplicate commit if identical to last entry
                const roomLogs = roomTranscripts[matchingRoom];
                const lastEntry = roomLogs[roomLogs.length - 1];
                if (!lastEntry || lastEntry.senderId !== socket.id || lastEntry.text !== newEntry.text) {
                    roomLogs.push(newEntry);
                    // Broadcast confirmed entry to EVERY user in the room (including speaker, ensuring 100% two-way sync)
                    connections[matchingRoom].forEach((elem) => {
                        io.to(elem).emit("new-transcript-entry", newEntry);
                    });
                }
            }
        });

        // Add manual key point / note (accessible from any device/browser without speech recognition)
        socket.on("add-manual-note", (text) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !text || !text.trim()) return;
            if (!roomTranscripts[matchingRoom]) {
                roomTranscripts[matchingRoom] = [];
            }
            const senderName = socketNames[socket.id] || "Participant";
            const newEntry = {
                id: `ts_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
                senderId: socket.id,
                name: senderName,
                text: text.trim(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                createdAt: Date.now(),
                isManual: true
            };
            roomTranscripts[matchingRoom].push(newEntry);
            connections[matchingRoom].forEach((elem) => {
                io.to(elem).emit("new-transcript-entry", newEntry);
            });
        });

        // Clear all room transcripts
        socket.on("clear-transcripts", () => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                roomTranscripts[matchingRoom] = [];
                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("transcripts-cleared");
                });
            }
        });

        // Collaborative Whiteboard drawing sync
        socket.on("draw", (data) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("draw", data);
                    }
                });
            }
        });

        socket.on("clear-canvas", () => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("clear-canvas");
                    }
                });
            }
        });

        socket.on("whiteboard-start", (sharerName) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                const name = sharerName || socketNames[socket.id] || "Participant";
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("whiteboard-start", socket.id, name);
                    }
                });
            }
        });

        socket.on("whiteboard-stop", () => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("whiteboard-stop", socket.id);
                    }
                });
            }
        });

        // Issue 1: Host-Only Individual participant mute
        socket.on("host-mute-user", (targetUserId, shouldMute) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;
            if (socket.id !== connections[matchingRoom][0]) {
                socket.emit("action-denied", "Only the meeting host can mute participants.");
                return;
            }
            io.to(targetUserId).emit("host-mute-all", shouldMute);
        });

        // Issue 1: Host-Only Mute All command signal
        socket.on("host-mute-all", (shouldMute) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;
            if (socket.id !== connections[matchingRoom][0]) {
                socket.emit("action-denied", "Only the meeting host can mute all participants.");
                return;
            }
            connections[matchingRoom].forEach((elem) => {
                if (elem !== socket.id) {
                    io.to(elem).emit("host-mute-all", shouldMute);
                }
            });
        });

        // Issue 1: Host-Only Disable Cameras signal
        socket.on("host-disable-video", (shouldDisable) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;
            if (socket.id !== connections[matchingRoom][0]) {
                socket.emit("action-denied", "Only the meeting host can disable participant cameras.");
                return;
            }
            connections[matchingRoom].forEach((elem) => {
                if (elem !== socket.id) {
                    io.to(elem).emit("host-disable-video", shouldDisable);
                }
            });
        });

        // Issue 1: Host-Only Transfer Capability (Prevents Host Impersonation)
        socket.on("make-host", (targetUserId) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;

            const currentHostId = connections[matchingRoom][0];
            if (socket.id !== currentHostId) {
                socket.emit("action-denied", "Only the current host can transfer host privileges.");
                return;
            }

            const targetIndex = connections[matchingRoom].indexOf(targetUserId);
            if (targetIndex !== -1) {
                // Place new host at index 0
                connections[matchingRoom].splice(targetIndex, 1);
                connections[matchingRoom].unshift(targetUserId);
                const newHostName = socketNames[targetUserId] || "Participant";
                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("host-changed", targetUserId, newHostName);
                });
            }
        });

        // Issue 2: Waiting Room Host Actions (Admit / Reject)
        socket.on("admit-user", (targetSocketId) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;

            const currentHostId = connections[matchingRoom][0];
            if (socket.id !== currentHostId) {
                socket.emit("action-denied", "Only the host can admit participants from the waiting room.");
                return;
            }

            if (waitingUsers[matchingRoom]) {
                const userIdx = waitingUsers[matchingRoom].findIndex(u => u.socketId === targetSocketId);
                if (userIdx !== -1) {
                    const waitingUser = waitingUsers[matchingRoom][userIdx];
                    waitingUsers[matchingRoom].splice(userIdx, 1);
                    const targetSocket = io.sockets.sockets.get(targetSocketId);
                    if (targetSocket) {
                        targetSocket.emit("admitted-by-host");
                        admitUserToRoom(matchingRoom, targetSocket, waitingUser.name);
                    }
                }
            }
        });

        socket.on("reject-user", (targetSocketId) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;

            const currentHostId = connections[matchingRoom][0];
            if (socket.id !== currentHostId) {
                socket.emit("action-denied", "Only the host can reject participants.");
                return;
            }

            if (waitingUsers[matchingRoom]) {
                waitingUsers[matchingRoom] = waitingUsers[matchingRoom].filter(u => u.socketId !== targetSocketId);
                io.to(targetSocketId).emit("join-error", "The host has declined your request to join the meeting.");
            }
        });

        // Issue 2: Host Room Lock & Waiting Room Controls
        socket.on("toggle-lock-meeting", (isLocked) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;
            if (socket.id !== connections[matchingRoom][0]) {
                socket.emit("action-denied", "Only the host can lock or unlock the meeting.");
                return;
            }
            roomLocks[matchingRoom] = Boolean(isLocked);
            connections[matchingRoom].forEach(elem => {
                io.to(elem).emit("meeting-locked-status", Boolean(isLocked));
            });
        });

        socket.on("toggle-waiting-room", (isEnabled) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (!matchingRoom || !connections[matchingRoom]) return;
            if (socket.id !== connections[matchingRoom][0]) {
                socket.emit("action-denied", "Only the host can configure the waiting room.");
                return;
            }
            roomWaitingEnabled[matchingRoom] = Boolean(isEnabled);
            connections[matchingRoom].forEach(elem => {
                io.to(elem).emit("waiting-room-status", Boolean(isEnabled));
            });
        });

        // Mid-meeting name change
        socket.on("change-name", (newName) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            const trimmed = (newName || "").trim();
            if (matchingRoom && trimmed) {
                const oldName = socketNames[socket.id] || "Participant";
                socketNames[socket.id] = trimmed;

                // Retroactively update past transcript sender names for this user
                if (roomTranscripts[matchingRoom]) {
                    roomTranscripts[matchingRoom].forEach(entry => {
                        if (entry.senderId === socket.id) {
                            entry.name = trimmed;
                        }
                    });
                }

                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("user-name-changed", socket.id, trimmed, oldName);
                });
            }
        });

        socket.on("disconnect", () => {
            // Clean up if user was waiting in the lobby
            for (const [rCode, waiters] of Object.entries(waitingUsers)) {
                waitingUsers[rCode] = waiters.filter(w => w.socketId !== socket.id);
            }

            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                // Remove user from room array first
                const index = connections[matchingRoom].indexOf(socket.id);
                if (index !== -1) {
                    connections[matchingRoom].splice(index, 1);
                }

                // Determine new host connection
                const hostId = connections[matchingRoom][0] || null;

                // Broadcast user-left and the updated hostId to others in room
                connections[matchingRoom].forEach(elem => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("user-left", socket.id, hostId);
                        io.to(elem).emit("whiteboard-stop", socket.id);
                    }
                });

                // If room is empty, clean it up
                if (connections[matchingRoom].length === 0) {
                    delete connections[matchingRoom];
                    delete activePolls[matchingRoom];
                    delete roomTranscripts[matchingRoom];
                    delete waitingUsers[matchingRoom];
                    delete roomLocks[matchingRoom];
                    delete roomWaitingEnabled[matchingRoom];
                }
            }

            // Cleanup socket states
            delete socketNames[socket.id];
            delete socketMutedStates[socket.id];
            delete socketCameraStates[socket.id];
            delete timeOnline[socket.id];
        });
    });

    return io;
};