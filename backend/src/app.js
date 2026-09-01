import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import 'dotenv/config';

import express from "express";
import {createServer} from "node:http";

import {Server} from "socket.io";
import mongoose from "mongoose";
import {connectToSocket} from "./controllers/socketManager.js";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";
import meetingRoutes from "./routes/meeting.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);

app.set("port",(process.env.PORT || 8000));

app.use(cors());
app.use(express.json({limit:"40kb"}));
app.use(express.urlencoded({limit:"40kb", extended:true}));

app.use("/api/v1/users", userRoutes);
app.use("/api/v1/meetings", meetingRoutes);

const start = async () => {
    try {
        const mongoUri = process.env.MONGODB_URL || process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error("MONGODB_URL or MONGO_URI is not defined in environment variables");
        }
        
        console.log("Connecting to MongoDB...");
        const connectionDb = await mongoose.connect(mongoUri);
        console.log(`MONGO Connected DB host: ${connectionDb.connection.host}`);
        
        const port = app.get("port");
        server.listen(port, () => {
            console.log(`Listening on Port ${port}`);
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);
        process.exit(1);
    }
}

start();