import mongoose, {Schema} from "mongoose";

const meetingSchema = new Schema(
    {
        user_id: {type:String},
        meetingCode: {type:String, required:true, unique:true},
        topic: {type:String, default: "MeetWeb Meeting"},
        password: {type:String},
        isLocked: {type:Boolean, default:false},
        isWaitingRoomEnabled: {type:Boolean, default:false},
        date: {type:Date, default: Date.now, required:true}
    }
)

const Meeting = mongoose.model("Meeting", meetingSchema);

export {Meeting};