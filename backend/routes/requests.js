import express from "express";
import Request from "../models/Request.js";
import Workspace from "../models/Workspace.js";
import authenticateToken from "../middleware/auth.js";
import multer from "multer";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import { generateRequestBlobPath } from "../utils/RequestsBlobHelper.js";

import {
  checkWorkspaceAccessMiddleware,
  getUserId,
} from "../middleware/workspaceAuth.js";
import {
  checkProjectWorkspace,
  checkWorkspaceOwner,
  checkRequestStatus,
} from "../middleware/requestAuth.js";

import {
  validateRequestItems,
  validateRequesterProof,
} from "../middleware/requestValidation.js";

import Transaction from "../models/Transaction.js";

const router = express.Router();
// ตั้งค่า multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const AZURE_BLOB_DOMAIN = "https://fintrack101.blob.core.windows.net";

/**
 * @route POST /api/workspaces/:workspaceId/requests
 * @desc สร้างคำขอเบิกงบประมาณในเวิร์คสเปซที่ระบุ
 */
router.post(
  "/",
  [
    authenticateToken,
    checkWorkspaceAccessMiddleware,
    checkProjectWorkspace,
    validateRequestItems,
    validateRequesterProof,
    upload.single("requesterProof"),
  ],
  async (req, res) => {
    try {
      const workspace = req.workspaceId; // จาก middleware
      const userId = getUserId(req.user);
      const { amount, items, requesterProof } = req.body;

      // อัพโหลดไฟล์ไปยัง Azure Blob ถ้ามีไฟล์แนบมา
      let requesterProofUrl = null;
      if (req.file) {
        const blobPath = generateRequestBlobPath("request-create", {
          userId,
          workspaceId: workspace,
          originalname: req.file.originalname,
        });
        requesterProofUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: userId.toString(),
          workspaceId: workspace.toString(),
          type: "requester-proof",
          contentType: req.file.mimetype,
        });
      }

      const request = new Request({
        workspace,
        requester: userId,
        amount,
        items,
        requesterProof: requesterProofUrl || req.body.requesterProof,
        status: "pending",
      });

      await request.save();

      res.status(201).json({
        success: true,
        message: "Request created successfully",
        data: request,
      });
    } catch (err) {
      console.error(`Error in create request:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to create request",
        error: err.message,
      });
    }
  }
);

/**
 * @route GET /api/workspaces/:workspaceId/requests
 * @desc Get all requests in workspace
 */

// 2️⃣ ดึงรายการขอเบิกงบของ Workspace (GET /requests/:workspaceId)
router.get(
  "/",
  [authenticateToken, checkWorkspaceAccessMiddleware],
  async (req, res) => {
    const workspace = req.workspaceId; // ✅ ใช้จาก middleware

    try {
      const requests = await Request.find({ workspace })
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
 * @route GET /api/requests/detail/:requestId
 * @desc Get request details by ID
 */

// 2.1️⃣ ดึงรายละเอียดคำขอเบิกงบตาม ID
router.get(
  "/:id",
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

      // แปลงข้อมูลให้มี URL ของรูปภาพ
      const detailedRequest = {
        ...request.toObject(),
        requesterProof: request.requesterProof
          ? {
              url: request.requesterProof,
              path: request.requesterProof
                ? new URL(request.requesterProof).pathname
                : null,
            }
          : null,
        ownerProof: request.ownerProof
          ? {
              url: request.ownerProof,
              path: request.ownerProof
                ? new URL(request.ownerProof).pathname
                : null,
            }
          : null,
      };

      res.status(200).json({
        success: true,
        message: "Request details retrieved successfully",
        data: detailedRequest,
      });
    } catch (err) {
      console.error("Error fetching request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch request details",
        error: err.message,
        userId,
        requestId: req.params.id, // ✅ เพิ่ม requestId ในการ log
      });
    }
  }
);

/**
 * @route PUT /api/requests/:requestId/edit
 * @desc Edit request by requester (only when status is pending)
 */
router.put(
  "/:id",
  [
    authenticateToken,
    checkRequestStatus,
    validateRequestItems,
    upload.single("requesterProof"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    const request = req.request;
    const { amount, items } = req.body;
    const userId = getUserId(req.user);

    try {
      // ตรวจสอบว่าเป็น requester
      if (request.requester.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Only requester can edit this request",
        });
      }

      // อัพโหลดไฟล์ใหม่ถ้ามี
      if (req.file) {
        const blobPath = generateRequestBlobPath("request-update", {
          userId,
          requestId: request._id,
          originalname: req.file.originalname,
        });
        const newProofUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: userId.toString(),
          requestId: request._id.toString(),
          type: "requester-proof-update",
        });
        request.requesterProof = newProofUrl;
      }

      // อัพเดทข้อมูลอื่นๆ
      if (amount) request.amount = amount;
      if (items) request.items = items;
      request.updatedAt = new Date();
      request.updatedBy = userId;

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
        userId,
        requestId: req.params.id, // ✅ เพิ่ม requestId ในการ log
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
  "/:id/status",
  [
    authenticateToken,
    checkRequestStatus,
    checkProjectWorkspace,
    checkWorkspaceOwner,
    upload.single("ownerProof"),
  ],
  async (req, res) => {
    try {
      const request = req.request;
      const { status } = req.body;
      const userId = getUserId(req.user);

      // 1. Validate status
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      // 2. Check for existing transaction
      const existingTransaction = await Transaction.findOne({
        workspace: request.workspace._id,
        user: request.requester,
        category: "Budget Request",
        "reference.id": request._id,
      });

      if (existingTransaction) {
        return res.status(400).json({
          success: false,
          message: "Transaction for this request already exists",
        });
      }

      // 3. Handle approval with proof upload
      if (status === "approved") {
        // Check if file is uploaded
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: "Owner must provide payment proof for approval",
          });
        }

        try {
          // Upload proof to Azure Blob
          const blobPath = generateRequestBlobPath("owner-proof", {
            userId,
            requestId: request._id,
            workspaceId: request.workspace,
            originalname: req.file.originalname,
          });
          const ownerProofUrl = await uploadToAzureBlob(
            req.file.buffer,
            blobPath,
            {
              userId: userId.toString(),
              requestId: request._id.toString(),
              type: "owner-proof",
            }
          );

          // Update request with proof URL
          request.ownerProof = ownerProofUrl;
          request.status = "completed";

          // Create new transaction
          const transaction = new Transaction({
            user: request.requester,
            workspace: request.workspace._id,
            type: "Income",
            amount: request.amount,
            category: "Budget Request",
            description: `Budget request approved by workspace owner`,
            slip_image: ownerProofUrl,
            reference: {
              type: "Request",
              id: request._id,
            },
            transaction_date: new Date(),
            transaction_time: new Date().toLocaleTimeString(),
          });

          // Save transaction
          await transaction.save();
        } catch (uploadError) {
          console.error("Error uploading proof:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload payment proof",
            error: uploadError.message,
          });
        }
      } else {
        // Handle rejection
        request.status = status;
        request.rejectionReason = req.body.rejectionReason;

        // ลบรูป requesterProof เมื่อ reject
        if (request.requesterProof?.includes(AZURE_BLOB_DOMAIN)) {
          try {
            await deleteFromAzureBlob(request.requesterProof);
            request.requesterProof = null; // เคลียร์ URL หลังจากลบ
            console.log(
              `Deleted requester proof for rejected request ${request._id}`
            );
          } catch (error) {
            console.error("Error deleting requester proof:", error);
          }
        }
      }

      // 4. Update request metadata
      request.updatedAt = new Date();
      request.updatedBy = userId;
      request.statusHistory = [
        ...(request.statusHistory || []),
        {
          status: request.status,
          updatedAt: new Date(),
          updatedBy: userId,
          reason: status === "rejected" ? req.body.rejectionReason : undefined,
        },
      ];

      // 5. Save changes
      await request.save();

      // 6. Send response
      res.json({
        success: true,
        message: `Request ${
          status === "approved" ? "approved and completed" : "rejected"
        } successfully`,
        data: {
          request,
          transaction: status === "approved" ? transaction : undefined,
        },
      });
    } catch (err) {
      console.error("Error updating request status:", err);
      res.status(500).json({
        success: false,
        message: "Failed to update request status",
        error: err.message,
        userId,
        requestId: req.params.id, // ✅ เพิ่ม requestId ในการ log
      });
    }
  }
);

// 4️⃣ ลบคำขอเบิกงบ (DELETE /requests/:requestId)
router.delete(
  "/:id",
  [authenticateToken, checkRequestStatus, checkProjectWorkspace],
  async (req, res) => {
    const userId = getUserId(req.user);
    const request = req.request;

    try {
      // ตรวจสอบสิทธิ์
      const isRequester = request.requester.toString() === userId.toString();
      const isOwner = request.workspace.owner.toString() === userId.toString();

      if (!isRequester && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to delete this request",
        });
      }

      // ลบไฟล์จาก Azure Blob ถ้ามี
      if (
        request.requesterProof &&
        request.requesterProof.includes(AZURE_BLOB_DOMAIN)
      ) {
        try {
          // สร้างฟังก์ชัน deleteFromAzureBlob ใน azureStorage.js
          await deleteFromAzureBlob(request.requesterProof);
        } catch (error) {
          console.error("Error deleting proof file:", error);
        }
      }

      if (
        request.ownerProof &&
        request.ownerProof.includes(AZURE_BLOB_DOMAIN)
      ) {
        try {
          await deleteFromAzureBlob(request.ownerProof);
        } catch (error) {
          console.error("Error deleting owner proof file:", error);
        }
      }

      await request.deleteOne();
      res.json({
        success: true,
        message: "Request and associated files deleted successfully",
      });
    } catch (err) {
      console.error("Error deleting request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to delete request",
        error: err.message,
        requestId: req.params.id, // ✅ เพิ่ม requestId ในการ log
        workspace: req.workspaceId, // ✅ เพิ่ม workspace ในการ log
      });
    }
  }
);

export default router;
