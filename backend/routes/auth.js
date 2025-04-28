import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Session from "../models/Session.js";  // Add this import
import dotenv from "dotenv";
import { authenticateToken } from "../middleware/auth.js";
import { checkAdminRole } from "../middleware/adminAuth.js";

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
      phone,
      numberAccount, // เพิ่มฟิลด์ numberAccount
      max_limit_expense,
      avatar_url,
    } = req.body;

    // ✅ ตรวจสอบว่าข้อมูลครบถ้วน (เพิ่ม numberAccount เข้าไปในการตรวจสอบ)
    if (
      !username ||
      !password ||
      !confirmPassword ||
      !name ||
      !email ||
      !numberAccount ||
      !phone ||
      !max_limit_expense ||
      !avatar_url
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // ✅ ตรวจสอบ password ว่าตรงกันหรือไม่
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // ✅ ตรวจสอบว่าผู้ใช้มีอยู่แล้วหรือไม่
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const max_limit = Number(max_limit_expense);
    if (isNaN(max_limit)) {
      return res
        .status(400)
        .json({ error: "max_limit_expense must be a number" });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ สร้าง user ใหม่ (เพิ่ม numberAccount เข้าไป)
    const newUser = new User({
      username,
      password: hashedPassword,
      name,
      email,
      numberAccount, // เพิ่มฟิลด์ numberAccount
      phone,
      max_limit_expense: max_limit,
      avatar_url,
    });

    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 📌 Login Route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // ✅ ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    // ✅ ค้นหา user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: "Invalid username or password" });
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
          numberAccount: user.numberAccount,
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
router.get("/users/:userId", authenticateToken, async (req, res) => {
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
});

export default router;
