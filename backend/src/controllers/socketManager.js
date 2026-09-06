import {Server} from "socket.io";
import { Meeting } from "../models/meeting.model.js";

let connections = {};
let socketNames = {};
let socketMutedStates = {};
let socketCameraStates = {};
let activePolls = {}; // { roomKey: { question, options, votes: { socketId: optionIndex } } }
let roomTranscripts = {}; // { roomKey: [ { id, senderId, name, text, timestamp, createdAt, isManual } ] }
let messages = {};
let timeOnline = {};

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
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET","POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });

    io.on("connection", (socket) => {

        socket.on("join-call", async (path, name) => {
            try {
                // Extract clean room code
                const cleanCode = (path || "").toString().replace(/^\/meeting\//, "").split("/").pop().trim();
                if (!cleanCode) {
                    socket.emit("join-error", "Invalid room code.");
                    return;
                }

                // Ensure meeting exists or auto-register it
                try {
                    let meetingExists = await Meeting.findOne({ meetingCode: cleanCode });
                    if (!meetingExists) {
                        meetingExists = new Meeting({ user_id: "guest_or_direct", meetingCode: cleanCode });
                        await meetingExists.save();
                    }
                } catch (dbErr) {
                    console.warn("DB check warning:", dbErr.message);
                }

                if (connections[cleanCode] === undefined) {
                    connections[cleanCode] = [];
                }

                // Avoid duplicate socket ID in room
                if (!connections[cleanCode].includes(socket.id)) {
                    connections[cleanCode].push(socket.id);
                }

                socketNames[socket.id] = name || "Participant";
                socketMutedStates[socket.id] = false;
                socketCameraStates[socket.id] = false;
                timeOnline[socket.id] = new Date();

                // Emit to all users in room including the new user
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

        // Host individual participant mute
        socket.on("host-mute-user", (targetUserId, shouldMute) => {
            io.to(targetUserId).emit("host-mute-all", shouldMute);
        });

        // Host security command signals
        socket.on("host-mute-all", (shouldMute) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("host-mute-all", shouldMute);
                    }
                });
            }
        });

        socket.on("host-disable-video", (shouldDisable) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("host-disable-video", shouldDisable);
                    }
                });
            }
        });

        // Host transfer capability
        socket.on("make-host", (targetUserId) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom && connections[matchingRoom]) {
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
            }
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