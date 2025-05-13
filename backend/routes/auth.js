import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Session from "../models/Session.js"; // Add this import
import dotenv from "dotenv";
import { authenticateToken, validateUserId } from "../middleware/auth.js";
import { checkAdminRole, checkUserAccess } from "../middleware/adminAuth.js";
import otpService from "../services/OtpService.js";
import multer from "multer";  // Add this
import {
  validateEmailFormat,
  validatePasswordStrength,
  validateUsername,
} from "../middleware/validation.js";
import { uploadToAzureBlob, deleteFromAzureBlob } from "../utils/azureStorage.js"

// Multer config for file uploads
// import rateLimit from 'express-rate-limit'; เอาไว้ใช้จำกัดจำนวนการ login ในช่วงเวลาหนึ่ง

// export const loginLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 5, // 5 attempts
//   message: {
//     success: false,
//     message: "Too many login attempts, please try again later"
//   }
// });
// router.post("/login", [loginLimiter], async (req, res) => {...});

dotenv.config(); // โหลดค่าจาก .env

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });  // Add this
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware ตรวจสอบว่ามีค่าตัวแปร JWT_SECRET หรือไม่
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set in .env file");
  process.exit(1);
}

// 📌 Register Route
router.post(
  "/register",
  validatePasswordStrength,
  validateUsername,
  async (req, res) => {
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
        avatar_url,
      } = req.body;

      // ✅ ตรวจสอบเฉพาะฟิลด์ที่จำเป็น
      if (
        !username ||
        !password ||
        !confirmPassword ||
        !name ||
        !email ||
        !otp
      ) {
        return res.status(400).json({
          success: false,
          message: "Required fields are missing",
          requiredFields: [
            "username",
            "password",
            "confirmPassword",
            "name",
            "email",
            "otp",
          ],
        });
      }

      // ✅ ตรวจสอบ OTP
      const otpVerification = otpService.verifyOTP(email, otp);
      if (!otpVerification.success) {
        return res.status(400).json({
          success: false,
          message: otpVerification.message,
        });
      }

      // ✅ ตรวจสอบ password
      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }

      // ✅ ตรวจสอบค่าที่ซ้ำ (เฉพาะ required fields)
      const duplicateQuery = {
        $or: [{ username: username }, { email: email }],
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
          details: errors,
        });
      }

      // ✅ Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // ✅ สร้าง user object (เฉพาะฟิลด์ที่มีค่า)
      const userData = {
        username,
        password: hashedPassword,
        name,
        email,
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
        message: "User registered successfully",
      });
    } catch (err) {
      console.error("Registration error:", err);
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: "Duplicate value",
          details: [`${field} is already registered`],
        });
      }
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// 📌 Login Route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // ✅ ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // ✅ ค้นหา user และตรวจสอบสถานะ
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // ✅ ตรวจสอบว่าบัญชีถูกระงับหรือไม่
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account is suspended. Please contact administrator.",
      });
    }

    // ✅ ตรวจสอบรหัสผ่าน
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // ✅ สร้าง access token (อายุสั้น)
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        type: "access",
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // ✅ สร้าง refresh token (อายุยาว)
    const refreshToken = jwt.sign(
      {
        id: user._id,
        type: "refresh",
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // ✅ ยกเลิก sessions เก่าที่ไม่ได้ใช้งาน
    await Session.updateMany(
      {
        userId: user._id,
        lastActivity: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      { isValid: false }
    );

    // ✅ สร้าง session ใหม่
    const session = await Session.create({
      userId: user._id,
      token,
      refreshToken,
      lastActivity: new Date(),
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });

    // ✅ อัพเดทเวลาเข้าสู่ระบบล่าสุด
    user.lastLogin = new Date();
    await user.save();

    // ✅ ส่งข้อมูลตอบกลับ
    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        refreshToken,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role,
          email: user.email,
          avatar_url: user.avatar_url,
          numberAccount: user.numberAccount || null,
          hasNumberAccount: !!user.numberAccount,
          lastLogin: user.lastLogin,
        },
        session: {
          id: session._id,
          createdAt: session.createdAt,
        },
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: err.message,
    });
  }
});

// 📌 Refresh Token Route
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    // ✅ ตรวจสอบและถอดรหัส refresh token
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    // ✅ ค้นหา session ที่ตรงกับ refresh token
    const session = await Session.findOne({
      userId: decoded.id,
      refreshToken,
      isValid: true,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    // ✅ ค้นหาข้อมูล user
    const user = await User.findById(decoded.id);
    if (!user || user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "User not found or account is suspended",
      });
    }

    // ✅ สร้าง access token ใหม่
    const newToken = jwt.sign(
      {
        id: user._id,
        role: user.role,
        type: "access",
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // ✅ อัพเดท session
    session.token = newToken;
    session.lastActivity = new Date();
    await session.save();

    res.json({
      success: true,
      data: {
        token: newToken,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role,
        },
      },
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
      error: error.message,
    });
  }
});

// 📌 Logout Route
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    // หา token จาก header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "No token provided"
      });
    }

    // ยกเลิก session ที่ตรงกับ token นี้
    const result = await Session.findOneAndUpdate(
      { 
        userId: req.user.id,
        token: token,
        isValid: true 
      },
      { isValid: false },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Session not found"
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to logout",
      error: err.message
    });
  }
});

// Reset Password Route
router.post(
  "/reset-password",
  validatePasswordStrength,
  async (req, res) => {
    try {
      const { email, otp, newPassword, confirmPassword } = req.body;

      // ตรวจสอบข้อมูลที่จำเป็น
      if (!email || !otp || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "All fields are required",
          requiredFields: ["email", "otp", "newPassword", "confirmPassword"],
        });
      }

      // ตรวจสอบ password match
      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
        });
      }

      // ตรวจสอบ OTP
      const otpVerification = otpService.verifyOTP(email, otp);
      if (!otpVerification.success) {
        return res.status(400).json({
          success: false,
          message: otpVerification.message,
        });
      }

      // หา user จาก email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Hash password ใหม่
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await user.save();

      res.json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset password",
        error: error.message,
      });
    }
  }
);

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

// 📌 Get Current User Profile
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password")
      .select("-refreshTokens");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get active sessions
    const activeSessions = await Session.find({
      userId: user._id,
      isValid: true
    }).select("createdAt lastActivity userAgent ipAddress");

    res.json({
      success: true,
      data: {
        user: {
          _id: user._id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          numberAccount: user.numberAccount,
          max_limit_expense: user.max_limit_expense,
          avatar_url: user.avatar_url,
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        },
        activeSessions
      }
    });

  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user profile",
      error: err.message
    });
  }
});

// 📌 Get User by ID
router.get(
  "/users/:userId",
  authenticateToken,
  checkAdminRole,
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
router.put(
  "/profile",
  [
    authenticateToken,
    validateUserId,
    upload.single("avatar"),
  ],
  async (req, res) => {
    try {
      let {
        name,
        email,
        phone,
        numberAccount,
        max_limit_expense,
        currentPassword,
        newPassword,
      } = req.body;

      // Debug logging
      console.log("Profile update attempt:", {
        userId: req.user.id,
        hasFile: !!req.file,
        fields: Object.keys(req.body)
      });

      // Find user
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Handle numberAccount array issue
      if (Array.isArray(numberAccount)) {
        numberAccount = numberAccount[0];
      }

      // Check duplicates before any updates
      if (email !== user.email || numberAccount !== user.numberAccount) {
        const duplicateQuery = {
          _id: { $ne: req.user.id },
          $or: []
        };

        if (email !== user.email) duplicateQuery.$or.push({ email });
        if (numberAccount !== user.numberAccount) duplicateQuery.$or.push({ numberAccount });

        if (duplicateQuery.$or.length > 0) {
          const duplicate = await User.findOne(duplicateQuery);
          if (duplicate) {
            const errors = [];
            if (duplicate.email === email) errors.push("Email is already registered");
            if (duplicate.numberAccount === numberAccount) errors.push("Account number is already registered");
            
            return res.status(400).json({
              success: false,
              message: "Duplicate values found",
              details: errors
            });
          }
        }
      }

      // Handle avatar upload
      if (req.file) {
        try {
          // Extract original path or prepare for new one
          let blobPath;
          if (user.avatar_url?.includes("blob.core.windows.net")) {
            try {
              const oldUrl = new URL(user.avatar_url);
              const originalPath = oldUrl.pathname.split('/').slice(2).join('/');
              blobPath = originalPath;
              
              // Delete old avatar
              await deleteFromAzureBlob(user.avatar_url);
              console.log(`Deleted old avatar: ${user.avatar_url}`);
            } catch (error) {
              console.error("Error handling old avatar:", error);
            }
          }

          // Create new path if none exists
          if (!blobPath) {
            blobPath = `avatars/${user._id}/${Date.now()}-${req.file.originalname}`;
          }

          // Upload new avatar
          const avatarUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
            userId: user._id.toString(),
            type: "avatar",
            contentType: req.file.mimetype
          });

          user.avatar_url = avatarUrl;
        } catch (uploadError) {
          console.error("Avatar upload error:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload avatar",
            error: uploadError.message
          });
        }
      }

      // Handle password change
      if (currentPassword && newPassword) {
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
          return res.status(400).json({
            success: false,
            message: "Current password is incorrect"
          });
        }
        user.password = await bcrypt.hash(newPassword, 10);
      }

      // Update user fields
      if (name) user.name = name;
      if (email) user.email = email;
      if (phone) user.phone = phone;
      if (numberAccount) user.numberAccount = numberAccount;
      if (max_limit_expense) {
        const limit = Number(max_limit_expense);
        if (!isNaN(limit)) {
          user.max_limit_expense = limit;
        }
      }

      // Update timestamp
      user.updatedAt = new Date();

      // Save changes
      await user.save();

      // Get updated user without password
      const updatedUser = await User.findById(req.user.id)
        .select("-password")
        .lean();

      // Format response
      res.json({
        success: true,
        message: "Profile updated successfully",
        data: {
          user: {
            ...updatedUser,
            avatar_url: updatedUser.avatar_url ? {
              url: updatedUser.avatar_url,
              path: new URL(updatedUser.avatar_url).pathname
            } : null
          }
        }
      });

    } catch (err) {
      console.error("Profile update error:", {
        error: err.message,
        stack: err.stack,
        userId: req.user?.id,
        body: req.body
      });

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
        message: "Failed to update profile",
        error: err.message
      });
    }
  }
);

export default router;
