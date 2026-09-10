import { Meeting } from "../models/meeting.model.js";
import crypto from "crypto";
import bcrypt from "bcrypt";

const createMeeting = async(req,res)=>{
    try{
        let meetingCode = req.body.meetingCode 
            ? req.body.meetingCode.toString().replace(/[^a-zA-Z0-9]/g, '').trim()
            : crypto.randomBytes(4).toString("hex");

        if (!meetingCode) {
            meetingCode = crypto.randomBytes(4).toString("hex");
        }

        // Check if meeting already exists (e.g. PMI room or repeated schedule)
        let existing = await Meeting.findOne({ meetingCode });
        if (existing) {
            return res.status(200).json({ 
                meetingCode: existing.meetingCode, 
                topic: existing.topic,
                isWaitingRoomEnabled: existing.isWaitingRoomEnabled,
                isLocked: existing.isLocked
            });
        }

        let hashedPassword = null;
        if (req.body.password && typeof req.body.password === "string" && req.body.password.trim()) {
            hashedPassword = await bcrypt.hash(req.body.password.trim(), 10);
        }

        const newMeeting = new Meeting({
            user_id: req.body.user_id || req.user?.username || "authenticated_user",
            meetingCode: meetingCode,
            topic: req.body.topic || "MeetWeb Meeting",
            password: hashedPassword,
            isLocked: Boolean(req.body.isLocked),
            isWaitingRoomEnabled: Boolean(req.body.isWaitingRoomEnabled)
        });
        await newMeeting.save();

        res.status(201).json({
            meetingCode: meetingCode,
            topic: newMeeting.topic,
            isWaitingRoomEnabled: newMeeting.isWaitingRoomEnabled,
            isLocked: newMeeting.isLocked
        });
    }catch(e){
        res.status(500).json({ message: `Something went wrong: ${e.message || e}` });
    }
}

export {createMeeting};