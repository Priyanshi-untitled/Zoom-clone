import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import {createServer} from "node:http";

import {Server} from "socket.io";
import mongoose from "mongoose";
import {connectToSocket} from "./controllers/socketManager.js";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";


const app = express();
const server = createServer(app);
const io = connectToSocket(server);

app.set("port",(process.env.PORT || 8000));

app.use(cors());
app.use(express.json({limit:"40kb"}));
app.use(express.urlencoded({limit:"40kb", extended:true}));

app.use("/api/v1/users", userRoutes);

const start = async () => {
    try {
        app.set("mongo_user"); // Note: You can also fix or remove this line as it has no value/parameter
        
        console.log("Connecting to MongoDB...");
        const connectionDb = await mongoose.connect("mongodb+srv://priyanshiZoom:Priyanshi.23@cluster0.4qj44ji.mongodb.net/");
        console.log(`MONGO Connected DB host: ${connectionDb.connection.host}`);
        
        server.listen(app.get("port"), () => {
            console.log("Listening to Port 8000");
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);
        process.exit(1); // Exits the process safely with failure code
    }
}

start();