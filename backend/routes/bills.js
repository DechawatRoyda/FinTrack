import express from "express";
import Bill from "../models/Bills.js";
import Workspace from "../models/Workspace.js";
import { authenticateToken, validateUserId } from "../middleware/auth.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import multer from "multer";
import {
  uploadToAzureBlob,
  deleteFromAzureBlob,
} from "../utils/azureStorage.js"; // เพิ่ม import

import { generateBillBlobPath } from "../utils/BillsBlobHelper.js";

import {
  checkWorkspaceBillAccess,
  getUserId,
} from "../middleware/workspaceAuth.js";
import { checkBillCreator, checkBillStatus } from "../middleware/billAuth.js";
import {
  validateBillCreation,
  validatePayment,
  validateConfirmPayment,
} from "../middleware/billValidation.js";

async function deleteFileFromAzure(fileUrl, metadata = {}) {
  if (!fileUrl?.includes(AZURE_BLOB_DOMAIN)) return null;

  try {
    const url = new URL(fileUrl);
    const blobPath = url.pathname.split("/").slice(2).join("/");
    await deleteFromAzureBlob(fileUrl);
    return {
      success: true,
      path: blobPath,
      ...metadata,
    };
  } catch (error) {
    console.error("Error deleting file:", {
      error: error.message,
      url: fileUrl,
      ...metadata,
    });
    return {
      success: false,
      url: fileUrl,
      error: error.message,
      ...metadata,
    };
  }
}

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// เพิ่ม constant นี้
const AZURE_BLOB_DOMAIN = "https://fintrack101.blob.core.windows.net";
/**
 * @route POST /api/bills
 * @desc Create a new bill
 */
// 1️⃣ สร้างบิลใหม่
/**
 * @route POST /api/bills/:workspaceId
 * @desc Create a new bill in specific workspace
 */
router.post(
  "/",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    upload.single("eSlip"),
  ],
  async (req, res) => {
    try {
      const workspace = req.workspaceId;
      let items = [];
      let note, paymentType, roundDetails;

      // Parse form data
      const isMultipart = req.headers["content-type"]?.includes("multipart/form-data");

      if (isMultipart) {
        // Handle array of items
        if (req.body.items) {
          try {
            // Try parsing if items is JSON string
            items = typeof req.body.items === 'string' 
              ? JSON.parse(req.body.items)
              : req.body.items;

            items = items.map(item => ({
              description: item.description,
              amount: parseFloat(item.amount),
              sharedWith: Array.isArray(item.sharedWith)
                ? item.sharedWith.map(share => ({
                    user: share.user,
                    shareAmount: parseFloat(share.shareAmount)
                  }))
                : []
            }));
          } catch (error) {
            console.error("Error parsing items:", error);
            return res.status(400).json({
              success: false,
              message: "Invalid items format",
              error: error.message
            });
          }
        } else {
          // Handle form-data fields format
          const formItems = [];
          let itemIndex = 0;

          while (req.body[`items[${itemIndex}][description]`]) {
            const item = {
              description: req.body[`items[${itemIndex}][description]`],
              amount: parseFloat(req.body[`items[${itemIndex}][amount]`]),
              sharedWith: []
            };

            let shareIndex = 0;
            while (req.body[`items[${itemIndex}][sharedWith][${shareIndex}][user]`]) {
              item.sharedWith.push({
                user: req.body[`items[${itemIndex}][sharedWith][${shareIndex}][user]`],
                shareAmount: parseFloat(
                  req.body[`items[${itemIndex}][sharedWith][${shareIndex}][shareAmount]`]
                )
              });
              shareIndex++;
            }

            formItems.push(item);
            itemIndex++;
          }

          items = formItems;
        }

        note = req.body.note;
        paymentType = req.body.paymentType;
        
        if (req.body.roundDetails) {
          try {
            roundDetails = JSON.parse(req.body.roundDetails);
          } catch {
            roundDetails = req.body.roundDetails;
          }
        }
      } else {
        // Handle JSON format
        items = req.body.items;
        note = req.body.note;
        paymentType = req.body.paymentType;
        roundDetails = req.body.roundDetails;
      }

      // Validate items
      if (!items?.length || !Array.isArray(items)) {
        return res.status(400).json({
          success: false,
          message: "Items array is required",
          debug: { items, body: req.body }
        });
      }

      // Validate each item
      for (const item of items) {
        if (!item.description || !item.amount || !item.sharedWith?.length) {
          return res.status(400).json({
            success: false,
            message: "Invalid item format",
            debug: { item }
          });
        }

        for (const share of item.sharedWith) {
          if (!share.user || !share.shareAmount) {
            return res.status(400).json({
              success: false,
              message: "Invalid share format",
              debug: { share }
            });
          }
        }
      }

      // Get workspace data and validate
      const workspaceData = await Workspace.findById(workspace);
      if (!workspaceData) {
        return res.status(404).json({
          success: false,
          message: "Workspace not found"
        });
      }

      // Create array of all valid member IDs in workspace
      const workspaceMembers = [
        workspaceData.owner.toString(),
        ...workspaceData.members.map(member => member.user.toString())
      ];

      // Get creator info
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Creator not found"
        });
      }

      // Get shared users info and validate workspace membership
      const sharedUserIds = [...new Set(
        items.flatMap(item => item.sharedWith.map(share => share.user))
      )];

      // Validate all users are workspace members
      const invalidUsers = sharedUserIds.filter(userId => 
        !workspaceMembers.includes(userId.toString())
      );

      if (invalidUsers.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Some users are not members of this workspace",
          data: {
            invalidUsers,
            workspace: workspaceData._id
          }
        });
      }

      // Get users info for valid members
      const sharedUsers = await User.find({ _id: { $in: sharedUserIds } });

      // Handle file upload
      let slipUrl = null;
      if (req.file) {
        const blobPath = generateBillBlobPath("bill-create", {
          userId: req.userId,
          workspaceId: workspace,
          originalname: req.file.originalname
        });

        slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          workspaceId: workspace.toString(),
          type: "bill-creation",
          contentType: req.file.mimetype
        });
      }

      // Create bill
      const bill = new Bill({
        workspace,
        creator: [{
          userId: req.userId,
          name: user.name,
          numberAccount: user.numberAccount
        }],
        paymentType: paymentType || "normal",
        roundDetails: paymentType === "round" ? {
          dueDate: roundDetails?.dueDate,
          totalPeriod: roundDetails?.totalPeriod,
          currentRound: 1
        } : undefined,
        items: items.map(item => ({
          description: item.description,
          amount: item.amount,
          sharedWith: item.sharedWith.map(share => {
            const sharedUser = sharedUsers.find(
              u => u._id.toString() === share.user.toString()
            );

            // Check if this share belongs to creator
            const isCreator = share.user.toString() === req.userId.toString();

            // Create round payments with auto-paid for creator
            const roundPayments = paymentType === "round" && roundDetails?.totalPeriod
              ? Array.from({ length: roundDetails.totalPeriod }, 
                  (_, i) => ({
                    round: i + 1,
                    amount: share.shareAmount,
                    status: isCreator ? "paid" : "pending", // Auto-paid for creator
                    eSlip: null // เพิ่ม eSlip เป็น null สำหรับแต่ละ round
                  })
                )
              : [];

            return {
              user: share.user,
              name: sharedUser?.name,
              status: isCreator ? "paid" : "pending", // Auto-paid for creator
              shareAmount: share.shareAmount,
              roundPayments,
              eSlip: null, // เพิ่ม eSlip เป็น null สำหรับแต่ละ round
            };
          })
        })),
        note,
        eSlip: slipUrl,
        status: "pending"
      });

      await bill.save();

      res.status(201).json({
        success: true,
        message: "Bill created successfully",
        data: bill
      });

    } catch (err) {
      console.error("Error creating bill:", {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId,
        body: req.body
      });

      res.status(500).json({
        success: false,
        message: "Failed to create bill",
        error: err.message
      });
    }
  }
);

// 2️⃣ ดึงข้อมูลบิลทั้งหมดใน workspace
router.get("/", [authenticateToken, validateUserId, checkWorkspaceBillAccess],
  async (req, res) => {
    try {
      const bills = await Bill.find({ workspace: req.workspaceId })
        .populate("workspace")
        .populate("creator")
        .populate("items.sharedWith.user", "name email");

      const now = new Date();
      const billsWithRound = bills.map((bill) => {
        let roundDueDates = [];
        let roundStatus = [];

        // Calculate round payment dates if needed
        if (
          bill.paymentType === "round" &&
          bill.roundDetails?.dueDate &&
          bill.roundDetails?.totalPeriod
        ) {
          const dueDate = new Date(bill.roundDetails.dueDate);
          for (let i = 0; i < bill.roundDetails.totalPeriod; i++) {
            const roundDue = new Date(dueDate);
            roundDue.setMonth(roundDue.getMonth() + i);
            roundDueDates.push(roundDue.toISOString().slice(0, 10));
            roundStatus.push({
              round: i + 1,
              dueDate: roundDue,
              isDue: now >= roundDue,
            });
          }
        }

        const currentRound = bill.roundDetails?.currentRound || 1;

        return {
          _id: bill._id,
          workspace: bill.workspace,
          creator: bill.creator,
          paymentType: bill.paymentType,
          roundDetails: bill.roundDetails,
          items: bill.items.map((item) => ({
            _id: item._id,
            description: item.description,
            amount: item.amount,
            sharedWith: item.sharedWith.map((share) => ({
              user: share.user && typeof share.user === "object"
                ? {
                    _id: share.user._id,
                    name: share.user.name,
                    email: share.user.email,
                  }
                : share.user,
              name: share.name,
              status: share.status,
              shareAmount: share.shareAmount,
              roundPayments: (share.roundPayments || [])
                .filter((p) => p.round <= currentRound)
                .map(payment => ({
                  ...payment,
                  eSlip: payment.eSlip ? {
                    url: payment.eSlip,
                    path: new URL(payment.eSlip).pathname
                  } : null
                })),
              eSlip: share.eSlip ? {
                url: share.eSlip,
                path: new URL(share.eSlip).pathname,
              } : null,
            })),
          })),
          note: bill.note,
          status: bill.status,
          eSlip: bill.eSlip ? {
            url: bill.eSlip,
            path: new URL(bill.eSlip).pathname,
          } : null,
          createdAt: bill.createdAt,
          updatedAt: bill.updatedAt,
          statusInfo: {
            status: bill.status,
            isModifiable: !["canceled", "paid"].includes(bill.status),
            canceledAt: bill.canceledAt,
            canceledBy: bill.canceledBy,
            paidAt: bill.status === "paid" ? bill.updatedAt : null,
          },
          roundInfo: bill.paymentType === "round" ? {
            currentRound: bill.roundDetails?.currentRound,
            totalPeriod: bill.roundDetails?.totalPeriod,
            dueDate: bill.roundDetails?.dueDate,
            isLastRound: bill.roundDetails?.currentRound === bill.roundDetails?.totalPeriod,
          } : null,
          roundDueDates,
          roundStatus,
        };
      });

      res.status(200).json({
        success: true,
        message: "Bills retrieved successfully",
        data: billsWithRound,
        count: billsWithRound.length,
      });

    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspaceId: req.params.workspaceId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch bills",
        error: err.message,
      });
    }
  }
);

/**
 * @route GET /api/bills/my-bills
 * @desc Get bills where user is creator or shared with
 */
router.get("/my-bills", [authenticateToken, validateUserId, checkWorkspaceBillAccess],
  async (req, res) => {
    try {
      const userId = getUserId(req.user);

      const bills = await Bill.find({
        workspace: req.workspaceId,
        $or: [
          { "creator.userId": userId },
          { "items.sharedWith.user": userId },
        ],
      })
        .populate("workspace")
        .populate("creator.userId", "name email")
        .populate("items.sharedWith.user", "name email");

      const now = new Date();
      const myBills = bills.map((bill) => {
        let roundDueDates = [];
        let roundStatus = [];

        if (
          bill.paymentType === "round" &&
          bill.roundDetails?.dueDate &&
          bill.roundDetails?.totalPeriod
        ) {
          const dueDate = new Date(bill.roundDetails.dueDate);
          for (let i = 0; i < bill.roundDetails.totalPeriod; i++) {
            const roundDue = new Date(dueDate);
            roundDue.setMonth(roundDue.getMonth() + i);
            roundDueDates.push(roundDue.toISOString().slice(0, 10));
            roundStatus.push({
              round: i + 1,
              dueDate: roundDue,
              isDue: now >= roundDue,
            });
          }
        }

        const currentRound = bill.roundDetails?.currentRound || 1;

        return {
          _id: bill._id,
          workspace: bill.workspace,
          creator: bill.creator,
          paymentType: bill.paymentType,
          roundDetails: bill.roundDetails,
          items: bill.items.map((item) => ({
            _id: item._id,
            description: item.description,
            amount: item.amount,
            sharedWith: item.sharedWith.map((share) => ({
              user: share.user,
              name: share.name,
              status: share.status,
              shareAmount: share.shareAmount,
              roundPayments: (share.roundPayments || [])
                .filter((p) => p.round <= currentRound)
                .map(payment => ({
                  ...payment,
                  eSlip: payment.eSlip ? {
                    url: payment.eSlip,
                    path: new URL(payment.eSlip).pathname
                  } : null
                })),
              eSlip: share.eSlip ? {
                url: share.eSlip,
                path: new URL(share.eSlip).pathname,
              } : null,
            })),
          })),
          note: bill.note,
          status: bill.status,
          eSlip: bill.eSlip ? {
            url: bill.eSlip,
            path: new URL(bill.eSlip).pathname,
          } : null,
          createdAt: bill.createdAt,
          updatedAt: bill.updatedAt,
          roundDueDates,
          roundStatus,
          statusInfo: {
            status: bill.status,
            isModifiable: !["canceled", "paid"].includes(bill.status),
            canceledAt: bill.canceledAt,
            canceledBy: bill.canceledBy,
            paidAt: bill.status === "paid" ? bill.updatedAt : null,
          },
        };
      });

      res.status(200).json({
        success: true,
        message: "My bills retrieved successfully",
        data: myBills,
        count: myBills.length,
      });

    } catch (err) {
      console.error(`Error in get my bills:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch my bills",
        error: err.message,
      });
    }
  }
);

// 2.1️⃣ ดึงข้อมูลบิลตาม ID
router.get("/:id", [authenticateToken, validateUserId, checkWorkspaceBillAccess],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = await Bill.findOne({
        _id: id,
        workspace: req.workspaceId,
      })
        .populate("workspace", "name type owner budget")
        .populate("creator.userId", "name numberAccount")
        .populate("items.sharedWith.user", "name email")
        .lean();

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      let roundDueDates = [];
      let roundStatus = [];
      if (
        bill.paymentType === "round" &&
        bill.roundDetails?.dueDate &&
        bill.roundDetails?.totalPeriod
      ) {
        const dueDate = new Date(bill.roundDetails.dueDate);
        const now = new Date();
        for (let i = 0; i < bill.roundDetails.totalPeriod; i++) {
          const roundDue = new Date(dueDate);
          roundDue.setMonth(roundDue.getMonth() + i);
          roundDueDates.push(roundDue.toISOString().slice(0, 10));
          roundStatus.push({
            round: i + 1,
            dueDate: roundDue,
            isDue: now >= roundDue,
          });
        }
      }

      const currentRound = bill.roundDetails?.currentRound || 1;

      const billDetails = {
        _id: bill._id,
        workspace: bill.workspace,
        creator: bill.creator.map((c) => ({
          userId: c.userId._id,
          name: c.userId.name,
          numberAccount: c.userId.numberAccount,
        })),
        paymentType: bill.paymentType,
        roundDetails: bill.roundDetails,
        items: bill.items.map((item) => ({
          _id: item._id,
          description: item.description,
          amount: item.amount,
          sharedWith: item.sharedWith.map((share) => ({
            user: {
              _id: share.user._id,
              name: share.user.name,
              email: share.user.email,
            },
            name: share.name,
            status: share.status,
            shareAmount: share.shareAmount,
            roundPayments: (share.roundPayments || [])
              .filter((p) => p.round <= currentRound)
              .map(payment => ({
                ...payment,
                eSlip: payment.eSlip ? {
                  url: payment.eSlip,
                  path: new URL(payment.eSlip).pathname
                } : null
              })),
            eSlip: share.eSlip ? {
              url: share.eSlip,
              path: new URL(share.eSlip).pathname,
            } : null,
          })),
        })),
        note: bill.note,
        status: bill.status,
        eSlip: bill.eSlip ? {
          url: bill.eSlip,
          path: new URL(bill.eSlip).pathname,
        } : null,
        createdAt: bill.createdAt,
        updatedAt: bill.updatedAt,
        statusInfo: {
          status: bill.status,
          isModifiable: !["canceled", "paid"].includes(bill.status),
          canceledAt: bill.canceledAt,
          canceledBy: bill.canceledBy,
          paidAt: bill.status === "paid" ? bill.updatedAt : null,
        },
        roundInfo: bill.paymentType === "round" ? {
          currentRound: bill.roundDetails?.currentRound,
          totalPeriod: bill.roundDetails?.totalPeriod,
          dueDate: bill.roundDetails?.dueDate,
          isLastRound: bill.roundDetails?.currentRound === bill.roundDetails?.totalPeriod,
        } : null,
        roundDueDates,
        roundStatus,
      };

      res.status(200).json({
        success: true,
        message: "Bill retrieved successfully",
        data: billDetails,
      });

    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id,
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch bill details",
        error: err.message,
      });
    }
  }
);

// 3️⃣ อัพเดตข้อมูลบิล (แก้ไขรายการหรือสถานะ)
/**
 * @route PUT /api/bills/update/:billId
 * @desc Update bill details
 */
router.put(
  "/:id",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess, 
    checkBillStatus,
    checkBillCreator,
    upload.single("eSlip"),
  ],
  async (req, res) => {
    try {
      const userId = getUserId(req.user);
      const bill = req.bill;
      const oldSlipUrl = bill.eSlip;

      console.log("Debug - Updating bill:", {
        billId: bill._id,
        userId,
        workspace: bill.workspace,
        hasFile: !!req.file,
        oldSlipUrl
      });

      // Handle file upload if provided
      if (req.file) {
        try {
          // Extract original path from old URL if exists
          let originalPath = null;
          if (oldSlipUrl) {
            const oldUrl = new URL(oldSlipUrl);
            originalPath = oldUrl.pathname.split('/').slice(2).join('/');
          }

          // Use original path or create new path
          const blobPath = originalPath || generateBillBlobPath("bill-create", {
            userId,
            workspaceId: bill.workspace,
            originalname: req.file.originalname
          });

          // Delete old file first
          if (oldSlipUrl?.includes(AZURE_BLOB_DOMAIN)) {
            await deleteFromAzureBlob(oldSlipUrl);
            console.log(`Deleted old bill slip: ${oldSlipUrl}`);
          }

          // Upload new file with same path
          const newSlipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
            userId: userId.toString(),
            workspaceId: bill.workspace.toString(),
            type: "bill-update",
            contentType: req.file.mimetype
          });

          bill.eSlip = newSlipUrl;
          console.log("File updated with same path:", {
            oldPath: originalPath,
            newPath: blobPath
          });
        } catch (uploadError) {
          console.error("Error handling file update:", uploadError);
          return res.status(500).json({
            success: false,
            message: "Failed to update bill slip",
            error: uploadError.message
          });
        }
      }

      // Update basic bill info
      if (req.body.note !== undefined) bill.note = req.body.note;
      if (req.body.paymentType !== undefined) bill.paymentType = req.body.paymentType;

      // Update items if provided
      if (req.body.items && Array.isArray(req.body.items)) {
        for (const updatedItem of req.body.items) {
          // Make sure item has an _id
          if (!updatedItem._id) {
            console.warn("Item without _id found:", updatedItem);
            continue;
          }

          const itemIndex = bill.items.findIndex(
            item => item._id.toString() === updatedItem._id.toString()
          );

          if (itemIndex !== -1) {
            // Update item fields
            if (updatedItem.description) {
              bill.items[itemIndex].description = updatedItem.description;
            }
            if (updatedItem.amount) {
              bill.items[itemIndex].amount = parseFloat(updatedItem.amount);
            }

            // Update shared users if provided
            if (Array.isArray(updatedItem.sharedWith)) {
              for (const updatedShare of updatedItem.sharedWith) {
                // Make sure share has user id
                if (!updatedShare.user) {
                  console.warn("Share without user found:", updatedShare);
                  continue;
                }

                const shareIndex = bill.items[itemIndex].sharedWith.findIndex(
                  share => share.user && 
                  share.user.toString() === updatedShare.user.toString()
                );

                if (shareIndex !== -1) {
                  if (updatedShare.shareAmount) {
                    bill.items[itemIndex].sharedWith[shareIndex].shareAmount = 
                      parseFloat(updatedShare.shareAmount);
                  }
                }
              }
            }
          }
        }
      }

      // Update timestamps
      bill.updatedAt = new Date();
      await bill.save();

      // Send response with formatted data
      res.json({
        success: true,
        message: "Bill updated successfully",
        data: {
          ...bill.toObject(),
          eSlip: bill.eSlip ? {
            url: bill.eSlip,
            path: new URL(bill.eSlip).pathname
          } : null,
          items: bill.items.map(item => ({
            ...item.toObject(),
            sharedWith: item.sharedWith.map(share => ({
              ...share.toObject(),
              eSlip: share.eSlip ? {
                url: share.eSlip,
                path: new URL(share.eSlip).pathname
              } : null
            }))
          }))
        }
      });

    } catch (err) {
      console.error("Error updating bill:", {
        error: err.message,
        stack: err.stack,
        billId: req.params.id,
        userId: getUserId(req.user),
        body: req.body
      });
      
      res.status(500).json({
        success: false,
        message: "Failed to update bill",
        error: err.message
      });
    }
  }
);

/**
 * @route DELETE /api/bills/:billId
 * @desc Delete a bill
 */
// 7️⃣ ลบบิล
router.delete(
  "/:id",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = await Bill.findOne({
        _id: id,
        workspace: req.workspaceId,
        "creator.userId": req.userId,
      });

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found or you don't have permission to delete it",
        });
      }

      // Track deleted files
      const deletedFiles = [];
      const failedFiles = [];

      // Delete main bill slip using deleteFileFromAzure
      const mainFileResult = await deleteFileFromAzure(bill.eSlip, {
        type: "main",
        billId: bill._id,
      });
      if (mainFileResult) {
        if (mainFileResult.success) {
          deletedFiles.push(mainFileResult);
        } else {
          failedFiles.push(mainFileResult);
        }
      }

      // Delete all payment slips using deleteFileFromAzure
      for (const item of bill.items) {
        for (const share of item.sharedWith) {
          const paymentFileResult = await deleteFileFromAzure(share.eSlip, {
            type: "payment",
            userId: share.user,
            itemId: item._id,
          });
          if (paymentFileResult) {
            if (paymentFileResult.success) {
              deletedFiles.push(paymentFileResult);
            } else {
              failedFiles.push(paymentFileResult);
            }
          }
        }
      }

      // Delete bill document
      await bill.deleteOne();

      res.json({
        success: true,
        message: "Bill and associated files deleted successfully",
        data: {
          billId: id,
          workspace: bill.workspace,
          deletedAt: new Date(),
          filesDeleted: {
            success: deletedFiles,
            failed: failedFiles,
            totalDeleted: deletedFiles.length,
            totalFailed: failedFiles.length,
          },
        },
      });
    } catch (err) {
      console.error(`Error in delete bill:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id,
      });
      res.status(500).json({
        success: false,
        message: "Failed to delete bill",
        error: err.message,
      });
    }
  }
);

/**
 * @route POST /api/bills/:billId/payment
 * @desc Submit payment evidence
 */
// 4️⃣ ผู้ใช้แนบสลิป และขอชำระเงิน
router.post(
  "/:id/pay",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    checkBillStatus,
    upload.single("eSlip"),
    validatePayment,
  ],
  async (req, res) => {
    const { id } = req.params;

    // Parse itemIds correctly
    let itemIds;
    try {
      // Handle JSON string array
      if (typeof req.body.itemId === 'string' && req.body.itemId.startsWith('[')) {
        itemIds = JSON.parse(req.body.itemId);
      } else {
        // Handle direct array or single value
        itemIds = Array.isArray(req.body.itemId) 
          ? req.body.itemId 
          : [req.body.itemId];
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid itemId format",
        error: error.message
      });
    }

    try {
      const bill = await Bill.findById(id).populate('workspace');

      // Validate bill exists
      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found"
        });
      }

      // Check for required file
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Payment slip is required"
        });
      }

      // Check if user is workspace owner
      const isWorkspaceOwner = bill.workspace.owner.toString() === req.userId.toString();

      // Upload file once for all items
      const blobPath = generateBillBlobPath("payment-submit", {
        userId: req.userId,
        billId: bill._id,
        timestamp: Date.now(),
        originalname: req.file.originalname
      });

      const slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
        userId: req.userId.toString(),
        billId: bill._id.toString(),
        type: "payment-slip",
        contentType: req.file.mimetype
      });

      // Track updates
      const results = {
        successful: [],
        failed: []
      };

      // Process each item
      for (const itemId of itemIds) {
        try {
          // Find item
          const item = bill.items.find(item => 
            item._id.toString() === itemId.toString()
          );

          if (!item) {
            results.failed.push({
              itemId,
              reason: "Item not found in bill"
            });
            continue;
          }

          // Find user's share
          const userShare = item.sharedWith.find(share => 
            share.user.toString() === req.userId.toString()
          );

          if (!userShare) {
            results.failed.push({
              itemId,
              reason: "User not found in shared list"
            });
            continue;
          }

          // Handle round payment
          if (bill.paymentType === "round") {
            const currentRound = bill.roundDetails.currentRound;
            const roundPayment = userShare.roundPayments.find(p => 
              p.round === currentRound
            );

            if (!roundPayment) {
              results.failed.push({
                itemId,
                reason: `Round payment #${currentRound} not found`
              });
              continue;
            }

            if (roundPayment.status === "paid") {
              results.failed.push({
                itemId,
                reason: `Round #${currentRound} is already paid`
              });
              continue;
            }

            // Set status based on whether user is owner
            roundPayment.status = isWorkspaceOwner ? "paid" : "awaiting_confirmation";
            roundPayment.eSlip = slipUrl;

          } else {
            // Handle normal payment
            if (userShare.status === "paid") {
              results.failed.push({
                itemId,
                reason: "This share is already paid"
              });
              continue;
            }

            // Set status based on whether user is owner
            userShare.status = isWorkspaceOwner ? "paid" : "awaiting_confirmation";
            userShare.eSlip = slipUrl;
          }

          // Create transaction immediately if owner
          if (isWorkspaceOwner) {
            const transaction = new Transaction({
              user: bill.creator[0].userId,
              workspace: bill.workspace._id,
              type: "Income",
              amount: userShare.shareAmount,
              category: "Bill Payment",
              description: bill.paymentType === "round" 
                ? `Bill payment from ${userShare.name} (Round ${bill.roundDetails.currentRound}/${bill.roundDetails.totalPeriod})`
                : `Bill payment from ${userShare.name}`,
              slip_image: slipUrl,
              reference: {
                type: "Bill",
                id: bill._id,
                itemId: itemId,
                userId: req.userId
              }
            });

            await transaction.save();
          }

          results.successful.push({
            itemId,
            amount: userShare.shareAmount,
            status: isWorkspaceOwner ? "paid" : "awaiting_confirmation"
          });

        } catch (itemError) {
          results.failed.push({
            itemId,
            reason: itemError.message
          });
        }
      }

      // Save if any successful updates
      if (results.successful.length > 0) {
        await bill.save();
      }

      // Send response
      res.json({
        success: true,
        message: "Payment evidence submitted",
        data: {
          bill,
          summary: {
            totalItems: itemIds.length,
            successful: results.successful,
            failed: results.failed,
            slipUrl: slipUrl,
            isWorkspaceOwner
          }
        }
      });

    } catch (err) {
      console.error("Error in bulk payment submission:", {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id,
        itemIds: itemIds
      });

      res.status(500).json({
        success: false,
        message: "Failed to process payment",
        error: err.message
      });
    }
  }
);

/**
 * @route PATCH /api/bills/:billId/confirm-payment
 * @desc Confirm user's payment
 */
// 5️⃣ ผู้สร้างบิลยืนยันการชำระเงินของผู้ใช้
router.patch(
  "/:id/confirm",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    checkBillStatus,
    checkBillCreator,
    upload.none(),
    validateConfirmPayment,
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = req.bill;
      
      // Parse itemIds correctly
      let itemsToConfirm = [];
      
      if (typeof req.body.items === 'string') {
        // Parse JSON string
        try {
          itemsToConfirm = JSON.parse(req.body.items);
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: "Invalid items format",
            error: e.message
          });
        }
      } else if (Array.isArray(req.body.items)) {
        // Already an array
        itemsToConfirm = req.body.items;
      } else {
        // Single item
        itemsToConfirm = [{
          itemId: req.body.itemId,
          userIdToConfirm: req.body.userIdToConfirm
        }];
      }

      // Parse itemIds if they are JSON strings
      itemsToConfirm = itemsToConfirm.map(item => {
        if (typeof item.itemId === 'string' && item.itemId.startsWith('[')) {
          try {
            return {
              ...item,
              itemId: JSON.parse(item.itemId)
            };
          } catch (e) {
            console.warn("Failed to parse itemId:", item.itemId);
            return item;
          }
        }
        return item;
      });

      // Flatten array items
      itemsToConfirm = itemsToConfirm.flatMap(item => {
        if (Array.isArray(item.itemId)) {
          return item.itemId.map(id => ({
            itemId: id,
            userIdToConfirm: item.userIdToConfirm
          }));
        }
        return item;
      });

      // Track results
      const results = {
        successful: [],
        failed: []
      };

      // Process each confirmation
      for (const { itemId, userIdToConfirm } of itemsToConfirm) {
        try {
          // Find item
          const item = bill.items.find(item => 
            item._id.toString() === itemId.toString()
          );

          if (!item) {
            results.failed.push({
              itemId,
              userIdToConfirm,
              reason: "Item not found in bill"
            });
            continue;
          }

          // Find user's share
          const userShare = item.sharedWith.find(share => 
            share.user.toString() === userIdToConfirm
          );

          if (!userShare) {
            results.failed.push({
              itemId,
              userIdToConfirm,
              reason: "User not found in shared list"
            });
            continue;
          }

          // Handle round payment
          if (bill.paymentType === "round") {
            const currentRound = bill.roundDetails.currentRound;
            const roundPayment = userShare.roundPayments.find(p => 
              p.round === currentRound
            );

            if (!roundPayment || roundPayment.status !== "awaiting_confirmation") {
              results.failed.push({
                itemId,
                userIdToConfirm,
                reason: "Payment is not awaiting confirmation for current round"
              });
              continue;
            }

            roundPayment.status = "paid";

          } else {
            // Handle normal payment
            if (userShare.status !== "awaiting_confirmation") {
              results.failed.push({
                itemId,
                userIdToConfirm,
                reason: "Payment is not awaiting confirmation"
              });
              continue;
            }

            userShare.status = "paid";
          }

          // Create transaction
          const transaction = new Transaction({
            user: bill.creator[0].userId,
            workspace: bill.workspace,
            type: "Income",
            amount: userShare.shareAmount,
            category: "Bill Payment",
            description: bill.paymentType === "round" 
              ? `Bill payment from ${userShare.name} (Round ${bill.roundDetails.currentRound}/${bill.roundDetails.totalPeriod})`
              : `Bill payment from ${userShare.name}`,
            slip_image: bill.paymentType === "round" 
              ? roundPayment.eSlip 
              : userShare.eSlip,
            reference: {
              type: "Bill",
              id: bill._id,
              itemId,
              userId: userIdToConfirm,
              ...(bill.paymentType === "round" && { round: bill.roundDetails.currentRound })
            }
          });

          await transaction.save();

          results.successful.push({
            itemId,
            userIdToConfirm,
            amount: userShare.shareAmount,
            status: "paid"
          });

        } catch (error) {
          results.failed.push({
            itemId,
            userIdToConfirm,
            reason: error.message
          });
        }
      }

      // Update bill status if needed
      if (bill.paymentType === "round") {
        const allPaidCurrentRound = bill.items.every(item =>
          item.sharedWith.every(share =>
            share.roundPayments.find(p => 
              p.round === bill.roundDetails.currentRound
            )?.status === "paid"
          )
        );

        if (allPaidCurrentRound) {
          if (bill.roundDetails.currentRound === bill.roundDetails.totalPeriod) {
            bill.status = "paid";
          } else {
            bill.roundDetails.currentRound++;
          }
        }
      } else {
        const allPaid = bill.items.every(item =>
          item.sharedWith.every(share => 
            share.status === "paid"
          )
        );

        if (allPaid) {
          bill.status = "paid";
        }
      }

      // Save changes if any successful updates
      if (results.successful.length > 0) {
        await bill.save();
      }

      res.json({
        success: true,
        message: "Payments confirmed successfully",
        data: {
          bill,
          summary: {
            totalConfirmations: itemsToConfirm.length,
            successful: results.successful,
            failed: results.failed
          }
        }
      });

    } catch (err) {
      console.error("Error in bulk confirm payment:", {
        error: err.message,
        stack: err.stack,
        billId: id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        message: "Failed to confirm payments",
        error: err.message
      });
    }
  }
);

/**
 * @route PATCH /api/bills/:billId/cancel
 * @desc Cancel a bill
 */
// 2. แก้ไข router cancel
router.patch(
  "/:id/cancel",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    checkBillStatus,
    checkBillCreator,
    upload.none(),
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = req.bill;

      console.log("Processing bill cancellation:", {
        billId: id,
        currentStatus: bill.status,
      });

      if (bill.status === "canceled") {
        return res.status(400).json({
          success: false,
          message: "Bill is already canceled",
        });
      }

      // เก็บข้อมูลการลบไฟล์
      const deletedFiles = [];
      const failedFiles = [];

      // ลบไฟล์หลักของบิล
      const mainFileResult = await deleteFileFromAzure(bill.eSlip, {
        type: "main",
        billId: bill._id,
      });
      if (mainFileResult) {
        if (mainFileResult.success) {
          deletedFiles.push(mainFileResult);
        } else {
          failedFiles.push(mainFileResult);
        }
      }

      // ลบไฟล์การชำระเงินทั้งหมด
      for (const item of bill.items) {
        for (const share of item.sharedWith) {
          const paymentFileResult = await deleteFileFromAzure(share.eSlip, {
            type: "payment",
            userId: share.user,
            itemId: item._id,
          });
          if (paymentFileResult) {
            if (paymentFileResult.success) {
              deletedFiles.push(paymentFileResult);
            } else {
              failedFiles.push(paymentFileResult);
            }
          }
        }
      }

      // อัพเดตข้อมูลแบบ atomic operation
      const updatedBill = await Bill.findByIdAndUpdate(
        id,
        {
          $set: {
            status: "canceled",
            "items.$[].sharedWith.$[].status": "canceled",
            canceledAt: new Date(),
            canceledBy: req.userId,
            updatedAt: new Date(),
            eSlip: null, // เพิ่มการ set null หลังจากลบไฟล์
            "items.$[].sharedWith.$[].eSlip": null,
          },
        },
        { new: true, runValidators: true }
      );

      if (!updatedBill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      res.json({
        success: true,
        message: "Bill canceled successfully",
        data: {
          bill: updatedBill,
          canceledAt: updatedBill.canceledAt,
          canceledBy: updatedBill.canceledBy,
          filesDeleted: {
            success: deletedFiles,
            failed: failedFiles,
            totalDeleted: deletedFiles.length,
            totalFailed: failedFiles.length,
          },
        },
      });
    } catch (err) {
      console.error("Error in cancel bill:", {
        error: err.message,
        stack: err.stack,
        billId: id,
      });
      res.status(500).json({
        success: false,
        message: "Failed to cancel bill",
        error: err.message,
      });
    }
  }
);

/**
 * @route PATCH /api/bills/:billId/update-round
 * @desc Update round payment details
 */
router.patch(
  "/:id/round",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceBillAccess,
    checkBillStatus,
    checkBillCreator,
    upload.none(), // <<== เพิ่มบรรทัดนี้
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = req.bill;

      // DEBUG: log body
      console.log("PATCH /:id/round req.body:", req.body);
      // แปลงค่าจาก form-data ให้เป็นตัวเลข
      const dueDate = req.body.dueDate;
      const totalPeriod = req.body.totalPeriod
        ? Number(req.body.totalPeriod)
        : undefined;
      const currentRound = req.body.currentRound
        ? Number(req.body.currentRound)
        : undefined;

      if (bill.paymentType !== "round") {
        return res.status(400).json({
          success: false,
          message: "This bill is not a round payment type",
        });
      }

      // DEBUG: log ก่อนแก้ไข
      console.log("ก่อน:", bill.roundDetails);

      if (dueDate) {
        bill.roundDetails.dueDate = new Date(dueDate);
      }

      if (totalPeriod) {
        const maxPaidRound = Math.max(
          0,
          ...bill.items.flatMap((item) =>
            item.sharedWith.flatMap((share) =>
              (share.roundPayments || [])
                .filter((p) => p.status === "paid")
                .map((p) => p.round)
            )
          )
        );

        if (totalPeriod < maxPaidRound) {
          return res.status(400).json({
            success: false,
            message: `Cannot reduce total periods below the maximum paid round (${maxPaidRound})`,
          });
        }

        bill.roundDetails.totalPeriod = totalPeriod;

        bill.items.forEach((item) => {
          item.sharedWith.forEach((share) => {
            const paidPayments = (share.roundPayments || []).filter(
              (p) => p.status === "paid"
            );
            share.roundPayments = Array.from(
              { length: totalPeriod },
              (_, i) => {
                const round = i + 1;
                const existingPayment = paidPayments.find(
                  (p) => p.round === round
                );
                if (existingPayment) {
                  return existingPayment;
                }
                return {
                  round,
                  amount: share.shareAmount,
                  status: "pending",
                };
              }
            );
          });
        });
      }

      if (currentRound !== undefined) {
        if (currentRound > bill.roundDetails.totalPeriod) {
          return res.status(400).json({
            success: false,
            message: "Current round cannot exceed total periods",
          });
        }
        bill.roundDetails.currentRound = currentRound;
      }

      await bill.save();

      // DEBUG: log หลัง save
      console.log("หลัง:", bill.roundDetails);

      // โหลดข้อมูลใหม่หลัง save
      const updatedBill = await Bill.findById(id);

      res.json({
        success: true,
        message: "Round payment details updated successfully",
        data: {
          bill: updatedBill,
          roundInfo: {
            currentRound: updatedBill.roundDetails.currentRound,
            totalPeriod: updatedBill.roundDetails.totalPeriod,
            dueDate: updatedBill.roundDetails.dueDate,
            isLastRound:
              updatedBill.roundDetails.currentRound ===
              updatedBill.roundDetails.totalPeriod,
          },
        },
      });
    } catch (err) {
      console.error(`Error in update round payment:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id,
      });
      res.status(500).json({
        success: false,
        message: "Failed to update round payment details",
        error: err.message,
      });
    }
  }
);

export default router;
