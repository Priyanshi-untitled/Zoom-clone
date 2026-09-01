import User from "../models/users.models.js";
import httpStatus from "http-status";

export const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized: Missing Token" });
        }

        const token = authHeader.split(" ")[1];
        const user = await User.findOne({ token });
        
        if (!user) {
            return res.status(httpStatus.UNAUTHORIZED).json({ message: "Unauthorized: Invalid Token" });
        }

        req.user = user;
        next();
    } catch (e) {
        return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ message: `Auth error: ${e.message}` });
    }
};
