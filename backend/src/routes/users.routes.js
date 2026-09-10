import {Router} from "express";
import rateLimit from "express-rate-limit";
import { register, login, logout, getUserProfile } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

// Issue 7: Auth Rate Limiter (Brute-force protection: 10 attempts per 15 minutes)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many authentication attempts. Please try again after 15 minutes." }
});

router.route("/login").post(authLimiter, login);
router.route("/register").post(authLimiter, register);
router.route("/logout").post(authMiddleware, logout);
router.route("/profile").get(authMiddleware, getUserProfile);

export default router;