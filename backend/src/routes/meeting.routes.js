import { Router } from "express";
import { createMeeting } from "../controllers/meeting.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/create").post(authMiddleware, createMeeting);
router.route("/create-public").post(createMeeting);

export default router;