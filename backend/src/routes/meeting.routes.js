import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createMeeting } from "../controllers/meeting.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

// Issue 6: Rate Limiter on public meeting creation (Anti-abuse: 15 meetings per hour per IP in prod)
const publicMeetingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 15 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    message: { message: "Too many public meetings created from this IP. Please log in or try again later." }
});

router.route("/create").post(authMiddleware, createMeeting);
router.route("/create-public").post(publicMeetingLimiter, createMeeting);

export default router;