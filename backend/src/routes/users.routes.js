import {Router} from "express";
import rateLimit from "express-rate-limit";
import { register, login, logout, getUserProfile } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

// Issue 7: Auth Rate Limiter (Brute-force protection: 15 attempts per 15 minutes in prod, relaxed in dev)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 15 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    message: { message: "Too many authentication attempts. Please try again after 15 minutes." }
});

router.route("/login").post(authLimiter, login);
router.route("/register").post(authLimiter, register);
router.route("/logout").post(authMiddleware, logout);
router.route("/profile").get(authMiddleware, getUserProfile);

export default router;