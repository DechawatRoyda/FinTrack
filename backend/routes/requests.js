import express from "express";
import Request from "../models/Request.js";
import Workspace from "../models/Workspace.js";
import authenticateToken from "../middleware/auth.js";
import multer from "multer";
import {
  uploadToAzureBlob,
  deleteFromAzureBlob,
} from "../utils/azureStorage.js";
import {
  generateRequestBlobPath,
  getBlobPathFromUrl,
} from "../utils/RequestsBlobHelper.js";
import {
  checkWorkspaceAccessMiddleware,
  validateWorkspaceOperation,
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
    validateWorkspaceOperation,
    checkWorkspaceAccessMiddleware,
    checkProjectWorkspace,
    upload.single("requesterProof"),
    validateRequestItems,
    validateRequesterProof,
  ],
  async (req, res) => {
    try {
      const workspace = req.workspace; // จาก middleware
      const userId = getUserId(req.user);
      const { amount, items, requesterProof } = req.body;

      // เช็คว่า user นี้เป็น owner หรือไม่
      if (workspace.owner.toString() === userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Workspace owner cannot create a request",
        });
      }

      // อัพโหลดไฟล์ไปยัง Azure Blob ถ้ามีไฟล์แนบมา
      let requesterProofUrl = null;
      if (req.file) {
        const blobPath = generateRequestBlobPath("request-create", {
          userId,
          workspaceId: workspace._id,
          originalname: req.file.originalname,
        });
        requesterProofUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: userId.toString(),
          workspaceId: workspace._id.toString(),
          type: "requester-proof",
          contentType: req.file.mimetype,
        });
      }

      const request = new Request({
        workspace: workspace._id,
        requester: userId,
        amount,
        items,
        requesterProof: requesterProofUrl,
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
  [
    authenticateToken,
    validateWorkspaceOperation,
    checkWorkspaceAccessMiddleware,
  ],
  async (req, res) => {
    const workspace = req.workspace;
    console.log("Debug - GET requests:", {
      workspaceId: workspace._id,
      userId: getUserId(req.user),
    });

    try {
      const requests = await Request.find({ workspace: workspace._id })
        .populate("requester", "name email")
        .populate("workspace", "name type")
        .sort({ createdAt: -1 }); // เพิ่ม sorting

      res.status(200).json({
        success: true,
        message: "Requests retrieved successfully",
        data: requests,
        count: requests.length,
        workspace: {
          _id: workspace._id,
          name: workspace.name,
          type: workspace.type,
        },
      });
    } catch (err) {
      console.error("Error fetching requests:", {
        error: err.message,
        workspace: req.params.workspaceId,
        userId: req.user?.id,
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch requests",
        error: err.message,
      });
    }
  }
);
// ได้ใช้ตอนเอาข้อมูลมาทำกราฟ
/**
 * @route GET /api/workspaces/:workspaceId/requests/my-requests
 * @desc Get user's requests in workspace
 */

router.get(
  "/my-requests",
  [
    authenticateToken,
    validateWorkspaceOperation,
    checkWorkspaceAccessMiddleware,
  ],
  async (req, res) => {
    try {
      const workspace = req.workspace;
      const userId = getUserId(req.user);

      console.log("Debug - GET my-requests:", {
        workspaceId: workspace._id,
        userId: userId,
      });

      const requests = await Request.find({
        workspace: workspace._id,
        requester: userId,
      })
        .populate("requester", "name email")
        .populate("workspace", "name type")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        message: "User requests retrieved successfully",
        data: requests,
        count: requests.length,
        workspace: {
          _id: workspace._id,
          name: workspace.name,
          type: workspace.type,
        },
      });
    } catch (err) {
      console.error("Error fetching user requests:", {
        error: err.message,
        userId: req.user?.id,
        workspace: req.params.workspaceId,
      });

      res.status(500).json({
        success: false,
        message: "Failed to fetch user requests",
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
    upload.single("requesterProof"),
    checkRequestStatus,
    validateRequestItems,
  ],
  async (req, res) => {
    const request = req.request;
    const { amount, items } = req.body;
    const userId = getUserId(req.user);

    try {
      // ตรวจสอบว่าเป็น requester
      const requesterId = request.requester._id
        ? request.requester._id.toString()
        : request.requester.toString();
      if (requesterId !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Only requester can edit this request",
        });
      }

      // อัพเดทไฟล์ถ้ามีการอัพโหลดใหม่
      if (req.file) {
        try {
          // 1. ลบไฟล์เก่าก่อน
          if (request.requesterProof?.includes(AZURE_BLOB_DOMAIN)) {
            await deleteFromAzureBlob(request.requesterProof);
            console.log(
              `Deleted old requester proof for request ${request._id}`
            );
          }

          // 2. ใช้ path เดียวกับตอนสร้าง
          const blobPath = generateRequestBlobPath("request-create", {
            userId,
            workspaceId: request.workspace._id,
            originalname: req.file.originalname,
          });

          // 3. อัพโหลดไฟล์ใหม่
          const newProofUrl = await uploadToAzureBlob(
            req.file.buffer,
            blobPath,
            {
              userId: userId.toString(),
              workspaceId: request.workspace._id.toString(),
              type: "requester-proof",
              contentType: req.file.mimetype,
            }
          );

          request.requesterProof = newProofUrl;
        } catch (uploadError) {
          console.error("Error handling file update:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to update proof file",
            error: uploadError.message,
          });
        }
      }

      // อัพเดทข้อมูลอื่นๆ
      if (amount) request.amount = amount;
      if (items) request.items = items;
      request.updatedAt = new Date();
      request.updatedBy = userId;

      await request.save();

      // ส่งข้อมูลกลับในรูปแบบเดียวกับ GET
      const updatedRequest = {
        ...request.toObject(),
        requesterProof: request.requesterProof
          ? {
              url: request.requesterProof,
              path: new URL(request.requesterProof).pathname,
            }
          : null,
      };

      res.json({
        success: true,
        message: "Request updated successfully",
        data: updatedRequest,
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
      let transaction; // ประกาศตัวแปรไว้ใช้ทั้ง scope

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

      // 3. Handle approval/rejection
      if (status === "approved") {
        // ตรวจสอบไฟล์แนบเมื่อ approve
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: "Owner must provide payment proof for approval",
          });
        }

        // สร้าง transaction ก่อน
        transaction = new Transaction({
          user: request.requester,
          workspace: request.workspace._id,
          type: "Income",
          amount: request.amount,
          category: "Budget Request",
          description: `Budget request approved by workspace owner`,
          transaction_date: new Date(),
          transaction_time: new Date().toLocaleTimeString(),
          reference: {
            type: "Request",
            id: request._id,
          },
        });

        // Upload proof to Azure Blob
        const blobPath = generateRequestBlobPath("owner-proof", {
          userId,
          requestId: request._id,
          workspaceId: request.workspace._id,
          originalname: req.file.originalname,
        });

        const ownerProofUrl = await uploadToAzureBlob(
          req.file.buffer,
          blobPath,
          {
            userId: userId.toString(),
            requestId: request._id.toString(),
            type: "owner-proof",
            contentType: req.file.mimetype,
          }
        );

        // อัพเดต request และ transaction
        request.ownerProof = ownerProofUrl;
        request.status = "completed";
        transaction.slip_image = ownerProofUrl;

        // บันทึก transaction
        await transaction.save();
      } else {
        // Handle rejection
        if (!req.body.rejectionReason) {
          return res.status(400).json({
            success: false,
            message: "Rejection reason is required",
          });
        }

        request.status = "rejected";
        request.rejectionReason = req.body.rejectionReason;

        // ลบไฟล์ requester proof ถ้ามี
        if (request.requesterProof?.includes(AZURE_BLOB_DOMAIN)) {
          try {
            await deleteFromAzureBlob(request.requesterProof);
            console.log(
              `Deleted requester proof for rejected request ${request._id}`
            );
            request.requesterProof = null;
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

      // 5. Save request changes
      await request.save();

      // 6. Send response
      res.json({
        success: true,
        message: `Request ${
          status === "approved" ? "approved and completed" : "rejected"
        } successfully`,
        data: {
          request: {
            ...request.toObject(),
            ownerProof: request.ownerProof
              ? {
                  url: request.ownerProof,
                  path: new URL(request.ownerProof).pathname,
                }
              : null,
            requesterProof: request.requesterProof
              ? {
                  url: request.requesterProof,
                  path: new URL(request.requesterProof).pathname,
                }
              : null,
          },
          transaction: transaction
            ? {
                ...transaction.toObject(),
                slip_image: transaction.slip_image
                  ? {
                      url: transaction.slip_image,
                      path: new URL(transaction.slip_image).pathname,
                    }
                  : null,
              }
            : undefined,
        },
      });
    } catch (err) {
      console.error("Error updating request status:", {
        error: err.message,
        stack: err.stack,
        requestId: req.params.id,
        userId: req.user?.id,
      });

      res.status(500).json({
        success: false,
        message: "Failed to update request status",
        error: err.message,
        requestId: req.params.id,
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
      const isRequester =
        (request.requester._id
          ? request.requester._id.toString()
          : request.requester.toString()) === userId.toString();

      const isOwner =
        (request.workspace.owner._id
          ? request.workspace.owner._id.toString()
          : request.workspace.owner.toString()) === userId.toString();

      if (!isRequester && !isOwner) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to delete this request",
        });
      }

      // ลบไฟล์จาก Azure Blob
      let deletedFiles = [];

      if (
        request.requesterProof &&
        request.requesterProof.includes(AZURE_BLOB_DOMAIN)
      ) {
        try {
          const success = await deleteFromAzureBlob(request.requesterProof);
          if (success) {
            deletedFiles.push("requesterProof");
          }
        } catch (error) {
          console.error("Error deleting requester proof:", error);
        }
      }

      if (
        request.ownerProof &&
        request.ownerProof.includes(AZURE_BLOB_DOMAIN)
      ) {
        try {
          const success = await deleteFromAzureBlob(request.ownerProof);
          if (success) {
            deletedFiles.push("ownerProof");
          }
        } catch (error) {
          console.error("Error deleting owner proof:", error);
        }
      }

      // ลบ request จาก database
      await request.deleteOne();

      res.json({
        success: true,
        message: "Request and associated files deleted successfully",
        deletedFiles, // เพิ่มข้อมูลไฟล์ที่ถูกลบ
      });
    } catch (err) {
      console.error("Error deleting request:", err);
      res.status(500).json({
        success: false,
        message: "Failed to delete request",
        error: err.message,
        requestId: req.params.id,
        workspace: req.workspaceId,
      });
    }
  }
);

export default router;
