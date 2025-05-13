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
      (member) => member.user.toString() === userId.toString()
    );

    return isOwner || isMember;
  } catch (err) {
    console.error("Error checking workspace access:", err);
    return false;
  }
};

export const checkWorkspaceAccessMiddleware = async (req, res, next) => {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found"
      });
    }

    // ใช้ workspaceId จาก params แทน
    const workspaceId = req.params.workspaceId;
    
    // workspace ควรมาจาก validateWorkspaceOperation แล้ว
    const workspace = req.workspace;
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }

    // เช็คสิทธิ์การเข้าถึง
    const isOwner = workspace.owner.toString() === userId.toString();
    const isMember = workspace.members.some(
      member => member.user.toString() === userId.toString()
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this workspace"
      });
    }

    next();
  } catch (err) {
    console.error("Error in workspace access middleware:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  }
};

// 1. Middleware สำหรับ bills
export const checkWorkspaceBillAccess = async (req, res, next) => {
  try {
    const userId = getUserId(req.user);
    console.log("Debug - Checking bill workspace access:", {
      workspaceId: req.workspaceId,
      userId
    });

    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }

    // เช็คสิทธิ์การเข้าถึง
    const isOwner = workspace.owner.toString() === userId.toString();
    const isMember = workspace.members.some(
      member => member.user.toString() === userId.toString()
    );

    if (!isOwner && !isMember) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this workspace"
      });
    }

    req.workspace = workspace;
    next();
  } catch (err) {
    console.error("Workspace bill access check error:", err);
    res.status(500).json({
      success: false,
      message: "Error checking workspace access",
      error: err.message
    });
  }
};

export const validateWorkspaceOperation = async (req, res, next) => {
  try {
    const workspaceId = req.workspaceId || req.params.workspaceId;
    console.log("Debug - Validating workspace:", { workspaceId });

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required"
      });
    }

    const workspace = await Workspace.findById(workspaceId);
    
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }

    req.workspace = workspace;
    next();
  } catch (error) {
    console.error("Workspace validation error:", error);
    res.status(500).json({
      success: false,
      message: "Error validating workspace",
      error: error.message
    });
  }
};

export default {
  getUserId,
  checkWorkspaceAccess,
  checkWorkspaceAccessMiddleware,
  validateWorkspaceOperation,
};
