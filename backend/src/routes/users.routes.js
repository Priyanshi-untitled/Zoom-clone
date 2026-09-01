import {Router} from "express";
import { register, login, getUserProfile } from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/login").post(login);
router.route("/register").post(register);
router.route("/profile").get(authMiddleware, getUserProfile);
router.route("/add_to_activity");
router.route("/get_all_activity");

export default router;