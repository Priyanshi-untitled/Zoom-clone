import httpStatus from "http-status";
import User from "../models/users.models.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "meetweb_jwt_super_secure_secret_key_2026";

const login = async(req,res)=>{
    const {username,password} = req.body;

    if(!username || !password){
        return res.status(400).json({message: "Please provide both username and password"});
    }
    try{
        const user = await User.findOne({username});
        if(!user){
            return res.status(httpStatus.NOT_FOUND).json({message: "User not found"});
        }

        if(await bcrypt.compare(password,user.password)){
            // Issue 3: Expirable, signed JWT token (7-day lifespan)
            const token = jwt.sign(
                { id: user._id, username: user.username, name: user.name },
                JWT_SECRET,
                { expiresIn: "7d" }
            );
            const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            user.token = token;
            user.tokenExpiresAt = tokenExpiresAt;
            await user.save();

            // Issue 4: Set HttpOnly, secure cookie
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            return res.status(httpStatus.OK).json({
                token: token,
                name: user.name,
                username: user.username,
                expiresAt: tokenExpiresAt
            });
        } else {
            return res.status(httpStatus.UNAUTHORIZED).json({message: "Invalid Username or Password"});
        }
    }catch(e){
        return res.status(500).json({message: `Something went wrong: ${e.message || e}`});
    }
}

const register = async(req,res) =>{
    const {name, username, password} = req.body;

    if (!name || !username || !password) {
        return res.status(400).json({ message: "Name, username, and password are required." });
    }

    // Issue 8: Strict password validation (min 8 chars, at least 1 number or special char)
    if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters long." });
    }
    const hasNumberOrSpecial = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;
    if (!hasNumberOrSpecial.test(password)) {
        return res.status(400).json({ message: "Password must contain at least one number or special character." });
    }

    try{
        const existingUser = await User.findOne({ username });
        if(existingUser) {
            return res.status(httpStatus.CONFLICT || 409).json({message: "User already exists"});
        }

        const hashedPassword = await bcrypt.hash(password,10);

        const newUser = new User({
            name: name.trim(),
            username: username.trim(),
            password: hashedPassword
        });

        await newUser.save();

        res.status(httpStatus.CREATED).json({message: "User Registered Successfully"});
    } catch(e){
        res.status(500).json({message: `Something went wrong: ${e.message || e}`});
    }
}

const logout = async (req, res) => {
    try {
        if (req.user) {
            req.user.token = null;
            req.user.tokenExpiresAt = null;
            await req.user.save();
        }
        res.clearCookie("token");
        return res.status(httpStatus.OK).json({ message: "Logged out successfully" });
    } catch (e) {
        return res.status(500).json({ message: `Logout failed: ${e.message || e}` });
    }
};

const getUserProfile = async (req, res) => {
    try {
        const user = req.user;
        return res.status(200).json({ name: user.name, username: user.username });
    } catch (e) {
        return res.status(500).json({ message: `Failed to fetch profile: ${e.message}` });
    }
}

export {login, register, logout, getUserProfile};