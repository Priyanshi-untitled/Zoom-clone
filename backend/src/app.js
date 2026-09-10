import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import 'dotenv/config';

import express from "express";
import {createServer} from "node:http";

import {Server} from "socket.io";
import mongoose from "mongoose";
import {connectToSocket} from "./controllers/socketManager.js";
import cors from "cors";
import rateLimit from "express-rate-limit";
import userRoutes from "./routes/users.routes.js";
import meetingRoutes from "./routes/meeting.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);

app.set("port",(process.env.PORT || 8000));

// Issue 5: Secure CORS with credentials and specific origin matching
const allowedOrigins = process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(",").map(o => o.trim())
    : ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000", "http://localhost:8000"];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
            process.env.NODE_ENV !== "production" ||
            origin.startsWith("http://localhost:") ||
            origin.startsWith("http://127.0.0.1:") ||
            allowedOrigins.includes(origin) ||
            allowedOrigins.includes("*")
        ) {
            return callback(null, origin);
        }
        return callback(null, allowedOrigins[0] || false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Issue 7: General API rate limiter (300 requests per 15 minutes per IP in prod)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 300 : 10000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    message: { message: "Too many requests from this IP, please try again later." }
});
app.use("/api", generalLimiter);

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