import {Server} from "socket.io";
import { Meeting } from "../models/meeting.model.js";

let connections = {};
let socketNames = {};
let socketMutedStates = {};
let socketCameraStates = {};
let activePolls = {}; // { roomKey: { question, options, votes: { socketId: optionIndex } } }
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
                // Extract clean 8-char code
                const cleanCode = path.replace("/meeting/", "").split("/").pop();
                const meetingExists = await Meeting.findOne({ meetingCode: cleanCode });
                
                if (!meetingExists) {
                    socket.emit("join-error", "Invalid Meeting Room: Code does not exist.");
                    return;
                }

                if (connections[path] === undefined) {
                    connections[path] = [];
                }
                connections[path].push(socket.id);
                socketNames[socket.id] = name || "Participant";
                socketMutedStates[socket.id] = false;
                socketCameraStates[socket.id] = false;
                timeOnline[socket.id] = new Date();

                // Emit to all users in room including the new user
                const usersList = connections[path].map(id => ({
                    id,
                    name: socketNames[id] || "Participant",
                    isMuted: socketMutedStates[id] || false,
                    isCameraOff: socketCameraStates[id] || false
                }));

                const hostId = connections[path][0];
                connections[path].forEach((elem) => {
                    io.to(elem).emit("user-joined", socket.id, socketNames[socket.id], usersList, hostId);
                });

                // Replay chat messages
                if (messages[path] !== undefined) {
                    messages[path].forEach((msg) => {
                        io.to(socket.id).emit("chat-message", msg.data, msg.sender, msg['socket-id-sender']);
                    });
                }

                // Sync active poll if it exists
                if (activePolls[path] !== undefined) {
                    io.to(socket.id).emit("poll-update", activePolls[path]);
                }
            } catch (err) {
                console.error("Socket join error:", err);
                socket.emit("join-error", "Database validation failed.");
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

        // User Speech Transcription Relay
        socket.on("user-speech", (text, isFinal) => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("user-speech", {
                            senderId: socket.id,
                            name: socketNames[socket.id] || "Participant",
                            text,
                            isFinal
                        });
                    }
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

        socket.on("whiteboard-start", () => {
            const matchingRoom = findRoomOfSocket(socket.id);
            if (matchingRoom) {
                connections[matchingRoom].forEach((elem) => {
                    if (elem !== socket.id) {
                        io.to(elem).emit("whiteboard-start");
                    }
                });
            }
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
                    }
                });

                // If room is empty, clean it up
                if (connections[matchingRoom].length === 0) {
                    delete connections[matchingRoom];
                    delete activePolls[matchingRoom];
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