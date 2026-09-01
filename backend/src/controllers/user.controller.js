import httpStatus from "http-status";
import User from "../models/users.models.js";

import bcrypt, {hash} from "bcrypt";
import crypto from "crypto";

const login = async(req,res)=>{
    const {username,password} = req.body;

    if(!username || !password){
        return res.status(400).json({message: "Please Provide"});
    }
    try{
        const user = await User.findOne({username});
        if(!user){
            return res.status(httpStatus.NOT_FOUND).json({message: "User not found"});
        }

        if(await bcrypt.compare(password,user.password)){
            let token = crypto.randomBytes(20).toString("hex");

            user.token = token;
            await user.save();
            return res.status(httpStatus.OK).json({token: token});
        } else {
            return res.status(httpStatus.UNAUTHORIZED).json({message: "Invalid Username or Password"});
        }
    }catch(e){
        return res.status(500).json({message: `Something went wrong: ${e.message || e}`});
    }
}


const register = async(req,res) =>{
    const {name, username, password} = req.body;

    try{
        const existingUser = await User.findOne({ username });
        if(existingUser) {
            return res.status(httpStatus.FOUND).json({message: "User already exists"});
        }

        const hashedPassword = await bcrypt.hash(password,10);

        const newUser = new User({
            name: name,
            username: username,
            password: hashedPassword
        });

        await newUser.save();

        res.status(httpStatus.CREATED).json({message: "User Register"});
    } catch(e){
        res.status(500).json({message: `Something went wrong: ${e.message || e}`});
    }
}

const getUserProfile = async (req, res) => {
    try {
        const user = req.user;
        return res.status(200).json({ name: user.name, username: user.username });
    } catch (e) {
        return res.status(500).json({ message: `Failed to fetch profile: ${e.message}` });
    }
}

export {login, register, getUserProfile};