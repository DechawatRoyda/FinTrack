import express from "express";
import { authenticateToken, adminMiddleware } from "../middleware/auth.js";
import { checkAdminRole } from "../middleware/adminAuth.js";
import User from "../models/User.js";
import Bill from "../models/Bills.js";
import Workspace from "../models/Workspace.js";
const router = express.Router();

// Simplify middleware chain first for testing
router.get("/users", authenticateToken, checkAdminRole, async (req, res) => {
  try {
    // Add debug logging
    console.log("Admin user from token:", req.user);
    
    const users = await User.find({}, {
      password: 0,
      __v: 0
    });
    
    res.json({
      success: true,
      data: users
    });
  } catch (err) {
    console.error("Error in /users route:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: err.message
    });
  }
});

//อัพเดต role ของผู้ใช้
router.patch("/users/:userId/role", authenticateToken, checkAdminRole, async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ป้องกันการเปลี่ยน role ของตัวเอง
    if (user._id.toString() === req.adminUser._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot modify your own role"
      });
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: "User role updated successfully",
      data: user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to update user role",
      error: err.message
    });
  }
});

// อัพเดตสถานะการใช้งานของผู้ใช้ (active/inactive)
router.patch("/users/:userId/status", adminMiddleware, async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isActive },
      { new: true, select: '-password' }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      message: "User status updated successfully",
      data: user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
      error: err.message
    });
  }
});

// Get system statistics GET "/stats" - ดูสถิติระบบ
router.get("/stats", adminMiddleware, async (req, res) => {
  try {
    const stats = {
      users: await User.countDocuments(),
      activeUsers: await User.countDocuments({ isActive: true }),
      bills: await Bill.countDocuments(),
      workspaces: await Workspace.countDocuments(),
      paidBills: await Bill.countDocuments({ status: 'paid' }),
      pendingBills: await Bill.countDocuments({ status: 'pending' })
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error: err.message
    });
  }
});

// ลบผู้ใช้
router.delete("/users/:userId", adminMiddleware, async (req, res) => {
  try {
    // ป้องกันการลบตัวเอง
    if (req.params.userId === req.adminUser._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account"
      });
    }

    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // เช็คว่าเป็น admin คนสุดท้ายหรือไม่
    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the last admin account"
        });
      }
    }

    await user.remove();
    res.json({
      success: true,
      message: "User deleted successfully"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: err.message
    });
  }
});

// สร้างผู้ใช้ใหม่โดย admin
router.post("/users", adminMiddleware, async (req, res) => {
  try {
    const { username, password, name, email, role, numberAccount } = req.body;

    // ตรวจสอบว่ามี username ซ้ำหรือไม่
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Username already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      password: hashedPassword,
      name,
      email,
      role: role || 'user',
      numberAccount,
      isActive: true
    });

    await user.save();
    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        ...user.toObject(),
        password: undefined
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to create user",
      error: err.message
    });
  }
});

// อัพเดตข้อมูลผู้ใช้
router.put("/users/:userId", adminMiddleware, async (req, res) => {
  try {
    const { name, email, numberAccount, phone, max_limit_expense } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      {
        name,
        email,
        numberAccount,
        phone,
        max_limit_expense
      },
      { new: true, select: '-password' }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      data: user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: err.message
    });
  }
});

export default router;