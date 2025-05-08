import Workspace from "../models/Workspace.js";
import { getUserId } from "./workspaceAuth.js";
import Request from "../models/Request.js";

// ตรวจสอบว่าเป็น Project Workspace
export const checkProjectWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.workspaceId);
    if (!workspace || workspace.type !== "project") {
      return res.status(400).json({
        success: false,
        message: "Invalid workspace or not a project workspace"
      });
    }
    req.workspace = workspace; // เก็บไว้ใช้ต่อ
    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to check workspace type",
      error: err.message
    });
  }
};

// ตรวจสอบสิทธิ์ Owner
export const checkWorkspaceOwner = async (req, res, next) => {
  try {
    const userId = getUserId(req.user);
    const workspace = req.workspace || await Workspace.findById(req.workspaceId);
    
    if (workspace.owner.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can perform this action"
      });
    }
    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to check workspace owner",
      error: err.message
    });
  }
};

// ตรวจสอบสถานะ Request
export const checkRequestStatus = async (req, res, next) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate({
        path: 'workspace',
        populate: { path: 'owner', select: 'name email' }
      })
      .populate('requester', 'name email');
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found"
      });
    }

    // เพิ่มการตรวจสอบสถานะ pending สำหรับ route edit
    if (req.path.includes('/edit') && request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Can only edit pending requests"
      });
    }

    // ตรวจสอบสถานะ completed สำหรับ route อื่นๆ
    if (request.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "This request is already completed and cannot be modified"
      });
    }

    req.request = request;
    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to check request status",
      error: err.message
    });
  }
};