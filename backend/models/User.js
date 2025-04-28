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
  numberAccount: {
    type: String,
    required: true, // หมายเลขบัญชีที่ใช้จ่าย
  },
  phone: {
    type: String,
  },
  max_limit_expense: {
    type: String,
  },
  avatar_url: {
    type: String,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  }
});

// สร้างโมเดล User
const User = mongoose.model("User", userSchema);

export default User; // ใช้ export default แทน module.exports
