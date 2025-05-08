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

export const checkWorkspaceAccessMiddleware = async (req, res, next) => {
  try {
    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found"
      });
    }

    // ใช้ workspaceId ที่ถูกส่งมาจาก server.js
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: "Workspace ID is required"
      });
    }

    const hasAccess = await checkWorkspaceAccess(workspaceId, userId);
    if (!hasAccess) {
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

export const validateWorkspaceOperation = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found"
      });
    }
    req.workspace = workspace;
    next();
  } catch (err) {
    console.error(`Error validating workspace:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId
    });
    res.status(500).json({
      success: false,
      message: "Failed to validate workspace",
      error: err.message
    });
  }
};

export default {
  getUserId,
  checkWorkspaceAccess,
  checkWorkspaceAccessMiddleware,
  validateWorkspaceOperation
};