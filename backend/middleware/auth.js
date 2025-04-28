import jwt from "jsonwebtoken";
import { getUserId } from "./workspaceAuth.js";
import Session from "../models/Session.js";

// Middleware ตรวจสอบ JWT token
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    console.log("=== Auth Debug ===");
    console.log("1. Full Headers:", req.headers);
    console.log("2. Auth Header:", authHeader);

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No bearer token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    console.log("3. Token:", token);

    const verified = jwt.verify(token, process.env.JWT_SECRET);
    console.log("4. Verified token payload:", verified);

    // ตรวจสอบ session
    const session = await Session.findOne({
      userId: verified.id,
      token,
      isValid: true,
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    // Set both user object and userId
    req.user = verified;
    req.userId = verified.id;
    req.token = token; // เพิ่ม token เข้าไปใน request
    console.log("5. Set userId:", req.userId);

    next();
  } catch (err) {
    console.error("Auth Error:", err);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired",
      });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Authentication error",
      error: err.message,
    });
  }
};

export const validateUserId = (req, res, next) => {
  console.log("Validating user from token:", req.user); // Debug log

  const userId = getUserId(req.user);
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "User authentication failed",
      details: "No user ID found in token",
      userInfo: req.user,
    });
  }

  req.userId = userId;
  next();
};

export const adminMiddleware = [authenticateToken, validateUserId];

export default authenticateToken;
