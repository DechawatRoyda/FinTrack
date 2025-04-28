import express from "express";
import Request from "../models/Request.js";
import Workspace from "../models/Workspace.js";
import authenticateToken from "../middleware/auth.js";
import {
  checkWorkspaceAccessMiddleware,
  getUserId,
} from "../middleware/workspaceAuth.js";
import {
  checkProjectWorkspace,
  checkWorkspaceOwner,
  checkRequestStatus,
} from "../middleware/requestAuth.js";

import { validateRequestItems , validateRequesterProof } from "../middleware/requestValidation.js";

import Transaction from "../models/Transaction.js";

const router = express.Router();

// 1️⃣ ขอเบิกงบประมาณ
router.post(
  "/",
  [
    authenticateToken,
    checkWorkspaceAccessMiddleware,
    checkProjectWorkspace,
    validateRequestItems,
    validateRequesterProof
  ],
  async (req, res) => {
    const { amount, items, requesterProof } = req.body;
    const workspace = req.workspaceId; // จาก middleware
    const userId = getUserId(req.user); // ใช้ userId จาก token

    try {
      const request = new Request({
        workspace,
        requester: userId, // ใช้ userId จาก token
        amount,
        items,
        requesterProof,
        status: "pending",
      });

      await request.save();

      res.status(201).json({
        success: true,
        message: "Request created successfully",
        data: request,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: "Failed to create request",
        error: err.message,
      });
    }
  }
);

/**
 * @route GET /api/requests/detail/:requestId
 * @desc Get request details by ID
 */

// 2.1️⃣ ดึงรายละเอียดคำขอเบิกงบตาม ID
router.get(
  "/detail/:requestId",
  [authenticateToken, checkRequestStatus],
  async (req, res) => {
    const userId = getUserId(req.user);
    const request = req.request; // ใช้จาก middleware

    try {
      // ตรวจสอบสิทธิ์ (ต้องเป็น requester หรือ owner ของ workspace)
      const isRequester =
        request.requester._id.toString() === userId.toString();
      const isOwner =
        request.workspace.owner._id.toString() === userId.toString();

      if (!isRequester && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this request",
        });
      }

      res.status(200).json({
        success: true,
        message: "Request details retrieved successfully",
        data: request,
      });
    } catch (err) {
      console.error("Error fetching request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch request details",
        error: err.message,
      });
    }
  }
);

/**
 * @route GET /api/requests/:workspaceId
 * @desc Get all requests in workspace
 */

// 2️⃣ ดึงรายการขอเบิกงบของ Workspace (GET /requests/:workspaceId)
router.get(
  "/:workspaceId",
  [authenticateToken, checkWorkspaceAccessMiddleware],
  async (req, res) => {
    const { workspaceId } = req.params;

    try {
      const requests = await Request.find({ workspace: workspaceId })
        .populate("requester", "name email")
        .populate("workspace", "name type")
        .sort({ createdAt: -1 }); // เพิ่ม sorting

      if (!requests.length) {
        return res.status(404).json({
          success: false,
          message: "No requests found for this workspace",
        });
      }

      res.status(200).json({
        success: true,
        message: "Requests retrieved successfully",
        data: requests,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch requests",
        error: err.message,
      });
    }
  }
);

/**
 * @route PUT /api/requests/:requestId/edit
 * @desc Edit request by requester (only when status is pending)
 */
router.put(
  "/:requestId/edit",
  [authenticateToken, checkRequestStatus, validateRequestItems],
  async (req, res) => {
    const request = req.request; // ใช้จาก middleware
    const { amount, items, requesterProof } = req.body;
    const userId = getUserId(req.user);

    try {
      // เพิ่มการตรวจสอบ requesterProof เมื่อมีการส่งมาแก้ไข
      if (requesterProof !== undefined && !requesterProof) {
        return res.status(400).json({
          success: false,
          message: "Requester proof is required",
        });
      }
      // ตรวจสอบว่าเป็น requester
      if (request.requester.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Only requester can edit this request",
        });
      }
      if (requesterProof !== undefined) request.requesterProof = requesterProof;

      request.updatedAt = new Date();
      await request.save();

      res.json({
        success: true,
        message: "Request updated successfully",
        data: request,
      });
    } catch (err) {
      console.error("Error updating request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to update request",
        error: err.message,
      });
    }
  }
);

/**
 * @route PUT /api/requests/:requestId/status
 * @desc Approve or reject request by owner
 */
// 3️⃣ อนุมัติ/ปฏิเสธคำขอ และแนบสลิป (PUT /requests/:requestId/status)
router.put(
  "/:requestId/status",
  [
    authenticateToken,
    checkRequestStatus,
    checkProjectWorkspace,
    checkWorkspaceOwner,
  ],
  async (req, res) => {
    const request = req.request; // ใช้จาก middleware แทน
    const { status, ownerProof } = req.body;
    const userId = getUserId(req.user);

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    try {
      // 2. ตรวจสอบว่ามี Transaction อยู่แล้วหรือไม่
      const existingTransaction = await Transaction.findOne({
        workspace: request.workspace._id,
        user: request.requester,
        category: "Budget Request",
        // เพิ่มเงื่อนไขเฉพาะเจาะจง
        description: `Budget request approved by workspace owner`,
        amount: request.amount,
      });

      if (existingTransaction) {
        return res.status(400).json({
          success: false,
          message: "Transaction for this request already exists",
        });
      }

      // ถ้าอนุมัติต้องแนบสลิป
      if (status === "approved") {
        if (!ownerProof) {
          return res.status(400).json({
            success: false,
            message: "Owner must provide payment proof for approval",
          });
        }
        request.ownerProof = ownerProof;
        request.status = "completed";

        // สร้าง Transaction ใหม่
        const transaction = new Transaction({
          user: request.requester,
          workspace: request.workspace._id,
          type: "Income",
          amount: request.amount,
          category: "Budget Request",
          description: `Budget request approved by workspace owner`,
          slip_image: ownerProof,
          // เพิ่ม reference ถึง request
          reference: {
            type: "Request",
            id: request._id,
          },
        });

        await transaction.save();
      } else {
        request.status = status;
      }

      request.updatedAt = new Date();
      await request.save();

      res.json({
        success: true,
        message: `Request ${
          status === "approved" ? "approved and completed" : "rejected"
        } successfully`,
        data: request,
      });
    } catch (err) {
      console.error("Error updating request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to update request status",
        error: err.message,
      });
    }
  }
);

// 4️⃣ ลบคำขอเบิกงบ (DELETE /requests/:requestId)
router.delete(
  "/:requestId",
  [authenticateToken, checkRequestStatus, checkProjectWorkspace],
  async (req, res) => {
    const userId = getUserId(req.user);
    const request = req.request; // ใช้จาก middleware แทน
    try {
      // ตรวจสอบสิทธิ์ (เป็นผู้ขอเบิกหรือ owner)
      const isRequester = request.requester.toString() === userId.toString();
      const isOwner = request.workspace.owner.toString() === userId.toString();

      if (!isRequester && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to delete this request",
        });
      }

      await request.deleteOne();
      res.json({
        success: true,
        message: "Request deleted successfully",
      });
    } catch (err) {
      console.error("Error deleting request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to delete request",
        error: err.message,
      });
    }
  }
);

export default router;
