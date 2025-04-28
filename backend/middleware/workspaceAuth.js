import Workspace from "../models/Workspace.js";
import Bill from "../models/Bills.js";

// Helper function to get userId from req.user
export const getUserId = (user) => {
  return user?._id || user?.id || user?.userId || user;
};

// Helper function to check workspace access
export const checkWorkspaceAccess = async (workspaceId, userId) => {
  try {
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return false;
    }

    // ตรวจสอบว่าเป็น owner หรือ member
    const isOwner = workspace.owner.toString() === userId.toString();
    const isMember = workspace.members.some(
      member => member.user.toString() === userId.toString()
    );

    return isOwner || isMember;
  } catch (err) {
    console.error("Error checking workspace access:", err);
    return false;
  }
};

// Middleware to check workspace access
export const checkWorkspaceAccessMiddleware = async (req, res, next) => {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ error: "User authentication failed" });
    }

    // ดึง workspaceId จากหลายที่ที่เป็นไปได้
    let workspaceId = req.body.workspace || req.params.workspaceId;
    
    // ถ้าไม่มี workspaceId ในทั้ง body และ params ให้ลองดึงจาก bill
    if (!workspaceId && req.params.billId) {
      const bill = await Bill.findById(req.params.billId);
      if (!bill) {
        return res.status(404).json({ error: "Bill not found" });
      }
      workspaceId = bill.workspace;
    }

    if (!workspaceId) {
      return res.status(400).json({ error: "Workspace ID is required" });
    }

    const hasAccess = await checkWorkspaceAccess(workspaceId, userId);
    if (!hasAccess) {
      return res.status(403).json({ 
        error: "You don't have permission to access this workspace" 
      });
    }

    // เก็บ workspaceId ไว้ใช้ต่อใน route
    req.workspaceId = workspaceId;
    next();
  } catch (err) {
    res.status(500).json({ 
      error: "Failed to check workspace access", 
      message: err.message 
    });
  }
};

export default {
  getUserId,
  checkWorkspaceAccess,
  checkWorkspaceAccessMiddleware
};