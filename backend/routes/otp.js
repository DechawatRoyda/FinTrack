import express from "express";
import otpService from "../services/otpService.js";
import { verifyOTP } from "../middleware/otpVerification.js";
import User from "../models/User.js";

const router = express.Router();

// Register OTP Request - ไม่ต้องใช้ authenticateToken เพราะยังไม่ได้ลงทะเบียน
router.post("/register-request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // เช็คว่ามีอีเมลในระบบแล้วหรือไม่
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // ส่ง OTP ใหม่ไปที่อีเมล (OTP เก่าจะถูกแทนที่)
    await otpService.sendOTP(email);

    res.json({
      success: true,
      message: "New OTP sent successfully",
      expiresIn: "5 minutes", // แจ้งเวลาหมดอายุให้ผู้ใช้ทราบ
    });
  } catch (error) {
    console.error("Registration OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send registration OTP",
    });
  }
});

// Verify OTP for Registration
router.post("/verify-register", verifyOTP, async (req, res) => {
  try {
    res.json({
      success: true,
      message: "Registration OTP verified successfully",
    });
  } catch (error) {
    console.error("Registration verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify registration OTP",
    });
  }
});


// Reset Password OTP Request
router.post("/reset-password-request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // เช็คว่ามีอีเมลในระบบหรือไม่
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not found"
      });
    }

    // ส่ง OTP สำหรับ reset password
    await otpService.sendOTP(email, 'reset-password');

    res.json({
      success: true,
      message: "Password reset OTP sent successfully",
      expiresIn: "5 minutes"
    });
  } catch (error) {
    console.error("Reset password OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send reset password OTP"
    });
  }
});

export default router;
