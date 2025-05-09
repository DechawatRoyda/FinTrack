import express from "express";
import Workspace from "../models/Workspace.js";
import User from "../models/User.js";
import authenticateToken from "../middleware/auth.js";
import { validateUserId } from "../middleware/auth.js";
import { 
  checkWorkspaceAccessMiddleware,
  validateWorkspaceOperation 
} from "../middleware/workspaceAuth.js";

const router = express.Router();

/**
 * @route POST /api/workspaces
 * @desc Create new workspace
 */
router.post("/", [
  authenticateToken,
  validateUserId
], async (req, res) => {
  try {
    const { name, type, budget, members } = req.body;
    const owner = req.user.id;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // เพิ่มการค้นหา User จาก Email
    let memberUsers = [];
    if (members?.length) {
      try {
        memberUsers = await Promise.all(
          members.map(async (member) => {
            const user = await User.findOne({ email: member.email });
            if (!user) {
              throw new Error(`User with email ${member.email} not found`);
            }
            return {
              user: user._id,
              join_at: new Date()
            };
          })
        );
      } catch (error) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
    }

    const workspace = new Workspace({
      name,
      owner,
      type,
      budget: budget || 0,
      members: memberUsers.length ? memberUsers : [{ user: owner, join_at: new Date() }],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await workspace.save();
    const populatedWorkspace = await workspace.populate("members.user", "username name email");

    res.status(201).json({
      success: true,
      message: "Workspace created successfully",
      data: populatedWorkspace
    });
  } catch (err) {
    console.error(`Error creating workspace:`, {
      error: err.message,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      message: "Failed to create workspace",
      error: err.message
    });
  }
});

/**
 * @route GET /api/workspaces
 * @desc Get all workspaces for user
 */
router.get("/", [
  authenticateToken,
  validateUserId
], async (req, res) => {
  try {
    const workspaces = await Workspace.find({
      $or: [
        { owner: req.user.id },
        { "members.user": req.user.id }
      ]
    });

    res.status(200).json({
      success: true,
      message: "Workspaces retrieved successfully",
      data: workspaces
    });
  } catch (err) {
    console.error(`Error fetching workspaces:`, {
      error: err.message,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch workspaces",
      error: err.message
    });
  }
});

/**
 * @route GET /api/workspaces/:workspaceId
 * @desc Get workspace by ID
 */
router.get("/:workspaceId", [
  authenticateToken,
  validateUserId,
  validateWorkspaceOperation,
  checkWorkspaceAccessMiddleware
], async (req, res) => {
  try {
    const workspace = req.workspace;
        // Populate เฉพาะฟิลด์ที่จำเป็นของ members.user
    const populated = await workspace.populate({
      path: 'members.user',
      select: 'name email numberAccount avatar_url' // เลือกเฉพาะฟิลด์ที่ต้องการ
    });
        // สร้าง response object ที่มีเฉพาะข้อมูลที่จำเป็น
    const responseData = {
      _id: populated._id,
      name: populated.name,
      owner: populated.owner,
      type: populated.type,
      budget: populated.budget,
      members: populated.members.map(member => ({
        user: {
          _id: member.user._id,
          name: member.user.name,
          email: member.user.email,
          numberAccount: member.user.numberAccount,
          avatar_url: member.user.avatar_url
        },
        join_at: member.join_at
      })),
      createdAt: populated.createdAt,
      updatedAt: populated.updatedAt
    };

    res.status(200).json({
      success: true,
      message: "Workspace retrieved successfully",
      data: responseData
    });
  } catch (err) {
    console.error(`Error fetching workspace:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId
    });
    res.status(500).json({
      success: false,
      message: "Failed to fetch workspace",
      error: err.message
    });
  }
});

/**
 * @route PUT /api/workspaces/:workspaceId
 * @desc Update workspace information
 * @access Private - Owner only
 */
router.put("/:workspaceId", [
  authenticateToken,
  validateUserId,
  validateWorkspaceOperation,
  checkWorkspaceAccessMiddleware
], async (req, res) => {
  try {
    const workspace = req.workspace;
    const { name, type, budget } = req.body;

    // Validate owner
    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can update workspace"
      });
    }

    // Update fields
    if (name) workspace.name = name;
    if (type) workspace.type = type;
    if (budget) workspace.budget = Number(budget);
    workspace.updatedAt = new Date();

    await workspace.save();
    const updated = await workspace.populate("members.user");

    res.status(200).json({
      success: true,
      message: "Workspace updated successfully",
      data: updated
    });
  } catch (err) {
    console.error(`Error updating workspace:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId
    });
    res.status(500).json({
      success: false,
      message: "Failed to update workspace",
      error: err.message
    });
  }
});

/**
 * @route POST /api/workspaces/:workspaceId/member
 * @desc Add new member to workspace
 * @access Private - Owner only
 */
router.post("/:workspaceId/member", [
  authenticateToken,
  validateUserId,
  validateWorkspaceOperation,
  checkWorkspaceAccessMiddleware
], async (req, res) => {
  try {
    const workspace = req.workspace;
    const { email } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Validate owner
    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can add members"
      });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if already member
    const isAlreadyMember = workspace.members.some(
      member => member.user.toString() === user._id.toString()
    );
    if (isAlreadyMember) {
      return res.status(400).json({
        success: false,
        message: "User is already a member"
      });
    }

    // Add member
    workspace.members.push({
      user: user._id,
      join_at: new Date()
    });
    await workspace.save();

    // Populate และเลือกเฉพาะข้อมูลที่จำเป็น
    const populated = await workspace.populate({
      path: 'members.user',
      select: 'name email numberAccount avatar_url'
    });

    // สร้าง response object
    const responseData = {
      _id: populated._id,
      name: populated.name,
      owner: populated.owner,
      type: populated.type,
      budget: populated.budget,
      members: populated.members.map(member => ({
        user: {
          _id: member.user._id,
          name: member.user.name,
          email: member.user.email,
          numberAccount: member.user.numberAccount,
          avatar_url: member.user.avatar_url
        },
        join_at: member.join_at
      }))
    };

    res.status(200).json({
      success: true,
      message: "Member added successfully",
      data: responseData
    });

  } catch (err) {
    console.error(`Error adding member:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId,
      email: req.body.email
    });
    res.status(500).json({
      success: false,
      message: "Failed to add member",
      error: err.message
    });
  }
});

/**
 * @route DELETE /api/workspaces/:workspaceId/member/:userId
 * @desc Remove member from workspace
 * @access Private - Owner only
 */
router.delete("/:workspaceId/member/:userId", [
  authenticateToken,
  validateUserId,
  validateWorkspaceOperation,
  checkWorkspaceAccessMiddleware
], async (req, res) => {
  try {
    const workspace = req.workspace;
    const memberIdToRemove = req.params.userId;

    // Validate owner
    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can remove members"
      });
    }

    // Prevent owner removal
    if (memberIdToRemove === workspace.owner.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot remove workspace owner"
      });
    }

    // Find and remove member
    const memberIndex = workspace.members.findIndex(
      member => member.user.toString() === memberIdToRemove
    );

    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Member not found in workspace"
      });
    }

    workspace.members.splice(memberIndex, 1);
    await workspace.save();

    res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: workspace
    });
  } catch (err) {
    console.error(`Error removing member:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId,
      memberToRemove: req.params.userId
    });
    res.status(500).json({
      success: false,
      message: "Failed to remove member",
      error: err.message
    });
  }
});

/**
 * @route DELETE /api/workspaces/:workspaceId
 * @desc Delete workspace
 * @access Private - Owner only
 */
router.delete("/:workspaceId", [
  authenticateToken, 
  validateUserId,
  validateWorkspaceOperation,
  checkWorkspaceAccessMiddleware
], async (req, res) => {
  try {
    const workspace = req.workspace;

    // Validate owner
    if (workspace.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Only workspace owner can delete workspace"
      });
    }

    await workspace.deleteOne();

    res.status(200).json({
      success: true,
      message: "Workspace deleted successfully",
      data: null
    });
  } catch (err) {
    console.error(`Error deleting workspace:`, {
      error: err.message,
      userId: req.user?.id,
      workspaceId: req.params.workspaceId
    });
    res.status(500).json({
      success: false,
      message: "Failed to delete workspace",
      error: err.message
    });
  }
});

export default router;