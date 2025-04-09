import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import dotenv from "dotenv";

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
    const { username, password, confirmPassword, name, email, phone, max_limit_expense, avatar_url } = req.body;

    // ✅ ตรวจสอบว่าข้อมูลครบถ้วน
    if (!username || !password || !confirmPassword || !name || !email || !phone || !max_limit_expense || !avatar_url) {
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
      return res.status(400).json({ error: "max_limit_expense must be a number" });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ สร้าง user ใหม่
    const newUser = new User({
      username,
      password: hashedPassword,
      name,
      email,
      phone,
      max_limit_expense : max_limit,
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
      return res.status(400).json({ error: "Username and password are required" });
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
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });

    res.json({ token, user: { id: user._id, username: user.username, name: user.name }, message: "Login successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
