import User from "../models/users.models.js";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "meetweb_jwt_super_secure_secret_key_2026";

export const authMiddleware = async (req, res, next) => {
    try {
        let token = null;

        // 1. Extract token from Authorization header or cookie
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        } else if (req.headers.cookie) {
            // Parse token from raw cookie header if cookie-parser is not active
            const match = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
            if (match) token = decodeURIComponent(match[1]);
        }

        if (!token) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized: Missing authentication token" });
        }

        // 2. Cryptographic signature and expiration check
        let decoded = null;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (jwtErr) {
            return res.status(httpStatus.UNAUTHORIZED).json({ 
                message: jwtErr.name === "TokenExpiredError" 
                    ? "Unauthorized: Token has expired. Please log in again." 
                    : "Unauthorized: Invalid token signature." 
            });
        }

        // 3. Database session and revocation check
        const user = await User.findOne({ token });
        if (!user) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized: Token revoked or invalid" });
        }

        // 4. Token expiration date check in DB
        if (user.tokenExpiresAt && new Date(user.tokenExpiresAt) < new Date()) {
            user.token = null;
            user.tokenExpiresAt = null;
            await user.save();
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized: Session expired. Please log in again." });
        }

        req.user = user;
        next();
    } catch (e) {
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ message: `Auth error: ${e.message || e}` });
    }
};
