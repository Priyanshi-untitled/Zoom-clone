import { Meeting } from "../models/meeting.model.js";
import crypto from "crypto";

const createMeeting = async(req,res)=>{
    try{
        const meetingCode = crypto.randomBytes(4).toString("hex");
        const newMeeting = new Meeting({
            user_id: req.body.user_id,
            meetingCode: meetingCode
        })
        await newMeeting.save();

        res.status(201).json({meetingCode: meetingCode});
    }catch(e){
        res.status(500).json({ message: `Something went wrong ${e}` });
    }
}

export {createMeeting};