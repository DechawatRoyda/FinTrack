import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Session from "../models/Session.js"; // Add this import
import dotenv from "dotenv";
import { authenticateToken, validateUserId  } from "../middleware/auth.js";
import { checkAdminRole, checkUserAccess } from "../middleware/adminAuth.js";
import otpService from "../services/OtpService.js";

dotenv.config(); // โหลดค่าจาก .env

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware ตรวจสอบว่ามีค่าตัวแปร JWT_SECRET หรือไม่
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set in .env file");
  process.exit(1);
}

// 📌 Register Route
router.post("/register", async (req, res) => {
  try {
    const {
      username,
      password,
      confirmPassword,
      name,
      email,
      otp,
      // Optional fields
      phone,
      numberAccount,
      max_limit_expense,
      avatar_url
    } = req.body;

    // ✅ ตรวจสอบเฉพาะฟิลด์ที่จำเป็น
    if (!username || !password || !confirmPassword || !name || !email || !otp) {
      return res.status(400).json({ 
        success: false,
        message: "Required fields are missing",
        requiredFields: ['username', 'password', 'confirmPassword', 'name', 'email', 'otp']
      });
    }

    // ✅ ตรวจสอบ OTP
    const otpVerification = otpService.verifyOTP(email, otp);
    if (!otpVerification.success) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    // ✅ ตรวจสอบ password
    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false,
        message: "Passwords do not match" 
      });
    }

    // ✅ ตรวจสอบค่าที่ซ้ำ (เฉพาะ required fields)
    const duplicateQuery = {
      $or: [
        { username: username },
        { email: email }
      ]
    };

    const duplicateChecks = await User.findOne(duplicateQuery);

    if (duplicateChecks) {
      const errors = [];
      if (duplicateChecks.username === username) {
        errors.push("Username is already taken");
      }
      if (duplicateChecks.email === email) {
        errors.push("Email is already registered");
      }
      return res.status(400).json({
        success: false,
        message: "Duplicate values found",
        details: errors
      });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ สร้าง user object (เฉพาะฟิลด์ที่มีค่า)
    const userData = {
      username,
      password: hashedPassword,
      name,
      email
    };

    // เพิ่มฟิลด์เสริมถ้ามีค่า
    if (phone) userData.phone = phone;
    if (numberAccount) userData.numberAccount = numberAccount;
    if (max_limit_expense) userData.max_limit_expense = max_limit_expense;
    if (avatar_url) userData.avatar_url = avatar_url;

    const newUser = new User(userData);
    await newUser.save();

    res.status(201).json({
      success: true,
      message: "User registered successfully"
    });

  } catch (err) {
    console.error("Registration error:", err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: "Duplicate value",
        details: [`${field} is already registered`]
      });
    }
    res.status(500).json({ 
      success: false,
      message: "Internal server error" 
    });
  }
});

// 📌 Login Route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // ✅ ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
    if (!username || !password) {
      return res.status(400).json({ error: "Username, password are required" });
    }

    // 1. ค้นหา user จาก username ก่อน
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    // ✅ ตรวจสอบรหัสผ่าน
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    // ✅ สร้าง JWT token
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role, // เพิ่ม role ใน token
      },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    // Save session
    await Session.create({
      userId: user._id,
      token,
    });

    // เพิ่มข้อมูลที่ส่งกลับไปให้รวม numberAccount ด้วย
    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role,
          numberAccount: user.numberAccount || null, // เพิ่ม null fallback
          hasNumberAccount: !!user.numberAccount // เพิ่มฟิลด์แสดงสถานะว่ามีเลขบัญชีหรือไม่
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err); // Add detailed logging
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: err.message,
    });
  }
});

// 📌 Logout Route
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    // Invalidate the current session
    await Session.findOneAndUpdate(
      { userId: req.user.id, isValid: true },
      { isValid: false }
    );

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to logout",
    });
  }
});

// 📌 Check Session Route
router.get("/check-session", authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      userId: req.user.id,
      token: req.token,
      isValid: true,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    const user = await User.findById(req.user.id).select("-password");
    res.json({
      success: true,
      data: {
        user,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to check session",
    });
  }
});

// 📌 Get All Users
router.get("/users", authenticateToken, checkAdminRole, async (req, res) => {
  try {
    const users = await User.find(
      {},
      {
        password: 0, // 0 คือไม่แสดง
        phone: 0,
        max_limit_expense: 0,
        avatar_url: 0,
      }
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// 📌 Get User by ID
router.get(
  "/users/:userId",
  authenticateToken,
  checkUserAccess,
  async (req, res) => {
    try {
      const user = await User.findById(req.params.userId, "-password");
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  }
);

// 📌 Edit Profile Route
router.put("/profile", authenticateToken,validateUserId, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      numberAccount,
      max_limit_expense,
      avatar_url,
      currentPassword,
      newPassword
    } = req.body;

    // Find user by ID (from token)
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check for duplicate email or account number
    if (email !== user.email || numberAccount !== user.numberAccount) {
      const duplicateCheck = await User.findOne({
        $and: [
          { _id: { $ne: req.user.id } },
          {
            $or: [
              { email: email },
              { numberAccount: numberAccount }
            ]
          }
        ]
      });

      if (duplicateCheck) {
        const errors = [];
        if (duplicateCheck.email === email) {
          errors.push("Email is already registered");
        }
        if (duplicateCheck.numberAccount === numberAccount) {
          errors.push("Account number is already registered");
        }
        return res.status(400).json({
          error: "Duplicate values found",
          details: errors
        });
      }
    }

    // Validate max_limit_expense if provided
    if (max_limit_expense) {
      const max_limit = Number(max_limit_expense);
      if (isNaN(max_limit)) {
        return res.status(400).json({ error: "max_limit_expense must be a number" });
      }
    }

    // Handle password change if requested
    if (currentPassword && newPassword) {
      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
      // Hash new password
      user.password = await bcrypt.hash(newPassword, 10);
    }

    // Update user fields
    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.numberAccount = numberAccount || user.numberAccount;
    user.max_limit_expense = max_limit_expense || user.max_limit_expense;
    user.avatar_url = avatar_url || user.avatar_url;

    // Save updated user
    await user.save();

    // Return updated user data (excluding password)
    const updatedUser = await User.findById(req.user.id).select("-password");

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: updatedUser
      }
    });

  } catch (err) {
    console.error("Profile update error:", err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(400).json({
        error: "Duplicate value",
        details: [`${field} is already registered`]
      });
    }
    res.status(500).json({ error: "Failed to update profile" });
  }
});

export default router;
