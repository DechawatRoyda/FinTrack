import mongoose from "mongoose";

// สร้าง Schema สำหรับ User
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  max_limit_expense: {
    type: String,
    required: true,
  },
  avatar_url: {
    type: String,
    required: true,
  },
});

// สร้างโมเดล User
const User = mongoose.model("User", userSchema);

export default User; // ใช้ export default แทน module.exports
