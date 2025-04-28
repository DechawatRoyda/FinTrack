import User from '../models/User.js';

// Middleware ตรวจสอบ admin role
export const checkAdminRole = async (req, res, next) => {
  try {
    console.log("=== Admin Check Debug ===");
    console.log("1. Received userId:", req.userId);

    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: "No user ID provided"
      });
    }

    const user = await User.findById(req.userId);
    console.log("2. Found user:", user ? "Yes" : "No");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        debug: { userId: req.userId }
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required."
      });
    }

    req.adminUser = user;
    console.log("3. Admin check passed");
    next();
  } catch (err) {
    console.error("Admin Check Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to verify admin privileges",
      error: err.message
    });
  }
};

// Middleware ตรวจสอบการเข้าถึงข้อมูล user
export const checkUserAccess = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const requestingUser = await User.findById(req.userId);

    // อนุญาตให้ admin หรือเจ้าของข้อมูลเท่านั้น
    if (requestingUser.role !== 'admin' && req.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only access your own data."
      });
    }

    next();
  } catch (err) {
    console.error('User access check error:', err);
    res.status(500).json({
      success: false,
      message: "Failed to verify user access",
      error: err.message
    });
  }
};