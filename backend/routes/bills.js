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
  checkWorkspaceAccessMiddleware,
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
    const blobPath = url.pathname.split('/').slice(2).join('/');
    await deleteFromAzureBlob(fileUrl);
    return {
      success: true,
      path: blobPath,
      ...metadata
    };
  } catch (error) {
    console.error("Error deleting file:", {
      error: error.message,
      url: fileUrl,
      ...metadata
    });
    return {
      success: false,
      url: fileUrl,
      error: error.message,
      ...metadata
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
    checkWorkspaceAccessMiddleware,
    // ถ้า validateBillCreation เช็ค items จาก req.body.items เท่านั้น ให้ย้ายไปเช็คเองใน handler
    upload.single("eSlip"),
  ],
  async (req, res) => {
    try {
      const workspace = req.workspaceId;
      let items = null;
      let note, paymentType, roundDetails;

      // รองรับทั้ง form-data และ JSON
      const isMultipart =
        req.headers["content-type"] &&
        req.headers["content-type"].includes("multipart/form-data");

      if (isMultipart) {
        // กรณี items เป็น array object (เช่น front ส่ง JSON.stringify(items) หรือ Postman ส่งเป็น array object)
        if (Array.isArray(req.body.items)) {
          items = req.body.items.map((item) => ({
            description: item.description,
            amount: parseFloat(item.amount),
            sharedWith: Array.isArray(item.sharedWith)
              ? item.sharedWith.map((share) => ({
                  user: share.user,
                  shareAmount: parseFloat(share.shareAmount),
                }))
              : [],
          }));
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
          // กรณี items[0][description] แบบดั้งเดิม
          let item = {
            description: req.body["items[0][description]"],
            amount: parseFloat(req.body["items[0][amount]"]),
            sharedWith: [],
          };
          let i = 0;
          while (req.body[`items[0][sharedWith][${i}][user]`]) {
            item.sharedWith.push({
              user: req.body[`items[0][sharedWith][${i}][user]`],
              shareAmount: parseFloat(
                req.body[`items[0][sharedWith][${i}][shareAmount]`]
              ),
            });
            i++;
          }
          items = [item];
          note = req.body.note;
          paymentType = req.body.paymentType;
          if (req.body.roundDetails) {
            try {
              roundDetails = JSON.parse(req.body.roundDetails);
            } catch {
              roundDetails = req.body.roundDetails;
            }
          }
        }
      } else {
        // รับแบบ JSON ปกติ
        items = req.body.items;
        note = req.body.note;
        paymentType = req.body.paymentType;
        roundDetails = req.body.roundDetails;
      }

      // ตรวจสอบ items (validation)
      if (
        !items ||
        !Array.isArray(items) ||
        !items.length ||
        !items[0].description ||
        !items[0].amount ||
        !items[0].sharedWith ||
        !Array.isArray(items[0].sharedWith) ||
        !items[0].sharedWith.length
      ) {
        return res.status(400).json({
          success: false,
          message: "Items array is required",
          debug: { items, body: req.body },
        });
      }

      // Upload eSlip ถ้ามี
      let slipUrl = null;
      if (req.file) {
        const blobPath = generateBillBlobPath("bill-create", {
          userId: req.userId,
          workspaceId: workspace,
          originalname: req.file.originalname,
        });
        slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          workspaceId: workspace.toString(),
          type: "bill-creation",
          contentType: req.file.mimetype,
        });
      }

      // Get creator info
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Creator not found",
        });
      }

      // Get shared users info
      const sharedUserIds = items[0].sharedWith.map((share) => share.user);
      const sharedUsers = await User.find({ _id: { $in: sharedUserIds } });

      // Create bill
      const bill = new Bill({
        workspace,
        creator: [
          {
            userId: req.userId,
            name: user.name,
            numberAccount: user.numberAccount,
          },
        ],
        paymentType: paymentType || "normal",
        roundDetails:
          paymentType === "round"
            ? {
                dueDate: roundDetails?.dueDate,
                totalPeriod: roundDetails?.totalPeriod,
                currentRound: 1,
              }
            : undefined,
        items: [
          {
            ...items[0],
            sharedWith: items[0].sharedWith.map((share) => {
              const sharedUser = sharedUsers.find(
                (user) => user._id.toString() === share.user.toString()
              );

              const roundPayments =
                paymentType === "round" && roundDetails?.totalPeriod
                  ? Array.from(
                      { length: roundDetails.totalPeriod },
                      (_, i) => ({
                        round: i + 1,
                        amount: share.shareAmount,
                        status: "pending",
                      })
                    )
                  : undefined;

              return {
                user: share.user,
                name: sharedUser?.name,
                status: "pending",
                shareAmount: share.shareAmount,
                roundPayments,
              };
            }),
          },
        ],
        note,
        eSlip: slipUrl,
        status: "pending",
      });

      await bill.save();

      res.status(201).json({
        success: true,
        message: "Bill created successfully",
        data: bill,
      });
    } catch (err) {
      console.error(`Error in create bill:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId,
        body: req.body,
      });
      res.status(500).json({
        success: false,
        message: "Failed to create bill",
        error: err.message,
      });
    }
  }
);

// 2️⃣ ดึงข้อมูลบิลทั้งหมดใน workspace
router.get(
  "/",
  [authenticateToken, validateUserId, checkWorkspaceAccessMiddleware],
  async (req, res) => {
    try {
      const bills = await Bill.find({ workspace: req.workspaceId })
        .populate("workspace")
        .populate("creator")
        .populate("items.sharedWith.user", "name email");

      const now = new Date();
      const billsWithRound = bills.map(bill => {
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
              isDue: now >= roundDue
            });
          }
        }

        // ดึง currentRound
        const currentRound = bill.roundDetails?.currentRound || 1;

        // สร้าง response object ที่มีแต่ข้อมูลที่จำเป็น
        return {
          _id: bill._id,
          workspace: bill.workspace,
          creator: bill.creator,
          paymentType: bill.paymentType,
          roundDetails: bill.roundDetails,
          items: bill.items.map(item => ({
            _id: item._id,
            description: item.description,
            amount: item.amount,
            sharedWith: item.sharedWith.map(share => ({
              user: share.user && typeof share.user === "object"
                ? {
                    _id: share.user._id,
                    name: share.user.name,
                    email: share.user.email
                  }
                : share.user,
              name: share.name,
              status: share.status,
              shareAmount: share.shareAmount,
              // filter เฉพาะรอบที่ <= currentRound เท่านั้น
              roundPayments: (share.roundPayments || []).filter(
                p => p.round <= currentRound
              ),
              eSlip: share.eSlip ? {
                url: share.eSlip,
                path: new URL(share.eSlip).pathname
              } : null
            }))
          })),
          note: bill.note,
          status: bill.status,
          eSlip: bill.eSlip ? {
            url: bill.eSlip,
            path: new URL(bill.eSlip).pathname
          } : null,
          createdAt: bill.createdAt,
          updatedAt: bill.updatedAt,
          statusInfo: {
            status: bill.status,
            isModifiable: !['canceled', 'paid'].includes(bill.status),
            canceledAt: bill.canceledAt,
            canceledBy: bill.canceledBy,
            paidAt: bill.status === 'paid' ? bill.updatedAt : null
          },
          roundInfo: bill.paymentType === 'round' ? {
            currentRound: bill.roundDetails?.currentRound,
            totalPeriod: bill.roundDetails?.totalPeriod,
            dueDate: bill.roundDetails?.dueDate,
            isLastRound: bill.roundDetails?.currentRound === bill.roundDetails?.totalPeriod
          } : null,
          roundDueDates,
          roundStatus
        };
      });

      res.status(200).json({
        success: true,
        message: "Bills retrieved successfully",
        data: billsWithRound,
        count: billsWithRound.length
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
router.get(
  "/my-bills",
  [authenticateToken, validateUserId, checkWorkspaceAccessMiddleware],
  async (req, res) => {
    try {
      const userId = getUserId(req.user);

      // ค้นหาบิลที่:
      // 1. เป็นคนสร้างบิล หรือ
      // 2. เป็นคนที่ต้องจ่ายเงินในบิล
      const bills = await Bill.find({
        workspace: req.workspaceId,
        $or: [
          { "creator.userId": userId },
          { "items.sharedWith.user": userId }
        ]
      })
      .populate("workspace")
      .populate("creator.userId", "name email")
      .populate("items.sharedWith.user", "name email");

      const now = new Date();
      const myBills = bills.map(bill => {
        let roundDueDates = [];
        let roundStatus = [];

        // คำนวณข้อมูลสำหรับการผ่อนชำระ
        if (bill.paymentType === "round" && 
            bill.roundDetails?.dueDate && 
            bill.roundDetails?.totalPeriod) {
          const dueDate = new Date(bill.roundDetails.dueDate);
          for (let i = 0; i < bill.roundDetails.totalPeriod; i++) {
            const roundDue = new Date(dueDate);
            roundDue.setMonth(roundDue.getMonth() + i);
            roundDueDates.push(roundDue.toISOString().slice(0, 10));
            roundStatus.push({
              round: i + 1,
              dueDate: roundDue,
              isDue: now >= roundDue
            });
          }
        }

        // ดึง currentRound
        const currentRound = bill.roundDetails?.currentRound || 1;

        return {
          _id: bill._id,
          workspace: bill.workspace,
          creator: bill.creator,
          paymentType: bill.paymentType,
          roundDetails: bill.roundDetails,
          items: bill.items.map(item => ({
            _id: item._id,
            description: item.description,
            amount: item.amount,
            sharedWith: item.sharedWith.map(share => ({
              user: share.user,
              name: share.name,
              status: share.status,
              shareAmount: share.shareAmount,
              roundPayments: (share.roundPayments || [])
                .filter(p => p.round <= currentRound),
              eSlip: share.eSlip ? {
                url: share.eSlip,
                path: new URL(share.eSlip).pathname
              } : null
            }))
          })),
          note: bill.note,
          status: bill.status,
          eSlip: bill.eSlip ? {
            url: bill.eSlip,
            path: new URL(bill.eSlip).pathname
          } : null,
          createdAt: bill.createdAt,
          updatedAt: bill.updatedAt,
          roundDueDates,
          roundStatus,
          statusInfo: {
            status: bill.status,
            isModifiable: !['canceled', 'paid'].includes(bill.status),
            canceledAt: bill.canceledAt,
            canceledBy: bill.canceledBy,
            paidAt: bill.status === 'paid' ? bill.updatedAt : null
          }
        };
      });

      res.status(200).json({
        success: true,
        message: "My bills retrieved successfully",
        data: myBills,
        count: myBills.length
      });

    } catch (err) {
      console.error(`Error in get my bills:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch my bills",
        error: err.message
      });
    }
  }
);

// 2.1️⃣ ดึงข้อมูลบิลตาม ID
router.get(
  "/:id",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = await Bill.findOne({ 
        _id: id,
        workspace: req.workspaceId 
      })
        .populate('workspace', 'name type owner budget')
        .populate('creator.userId', 'name numberAccount')
        .populate('items.sharedWith.user', 'name email')
        .lean();

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      // เพิ่มฟิลด์ roundDueDates และ roundStatus
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
            isDue: now >= roundDue
          });
        }
      }

      // ดึง currentRound
      const currentRound = bill.roundDetails?.currentRound || 1;

      // สร้าง response object ที่มีแต่ข้อมูลที่จำเป็น
      const billDetails = {
        _id: bill._id,
        workspace: bill.workspace,
        creator: bill.creator.map(c => ({
          userId: c.userId._id,
          name: c.userId.name,
          numberAccount: c.userId.numberAccount
        })),
        paymentType: bill.paymentType,
        roundDetails: bill.roundDetails,
        items: bill.items.map(item => ({
          _id: item._id,
          description: item.description,
          amount: item.amount,
          sharedWith: item.sharedWith.map(share => ({
            user: {
              _id: share.user._id,
              name: share.user.name,
              email: share.user.email
            },
            name: share.name,
            status: share.status,
            shareAmount: share.shareAmount,
            // filter เฉพาะรอบที่ <= currentRound หรือยังไม่จ่าย
            roundPayments: (share.roundPayments || []).filter(
              p => p.round <= currentRound || (p.status !== "paid" && p.round < currentRound)
            ),
            eSlip: share.eSlip ? {
              url: share.eSlip,
              path: new URL(share.eSlip).pathname
            } : null
          }))
        })),
        note: bill.note,
        status: bill.status,
        eSlip: bill.eSlip ? {
          url: bill.eSlip,
          path: new URL(bill.eSlip).pathname
        } : null,
        createdAt: bill.createdAt,
        updatedAt: bill.updatedAt,
        statusInfo: {
          status: bill.status,
          isModifiable: !['canceled', 'paid'].includes(bill.status),
          canceledAt: bill.canceledAt,
          canceledBy: bill.canceledBy,
          paidAt: bill.status === 'paid' ? bill.updatedAt : null
        },
        roundInfo: bill.paymentType === 'round' ? {
          currentRound: bill.roundDetails?.currentRound,
          totalPeriod: bill.roundDetails?.totalPeriod,
          dueDate: bill.roundDetails?.dueDate,
          isLastRound: bill.roundDetails?.currentRound === bill.roundDetails?.totalPeriod
        } : null,
        roundDueDates,
        roundStatus
      };

      res.status(200).json({
        success: true,
        message: "Bill retrieved successfully",
        data: billDetails
      });

    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch bill details",
        error: err.message
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
    upload.single("eSlip"),
  ],
  async (req, res) => {
    try {
      const bill = req.bill;
      const oldSlipUrl = bill.eSlip;

      // Upload new slip if provided
      if (req.file) {
        // ลบไฟล์เก่าถ้ามี
        if (oldSlipUrl?.includes(AZURE_BLOB_DOMAIN)) {
          try {
            await deleteFromAzureBlob(oldSlipUrl);
            console.log(`Deleted old bill slip: ${oldSlipUrl}`);
          } catch (error) {
            console.error("Error deleting old slip:", error);
          }
        }

        // อัพโหลดไฟล์ใหม่ใน path เดิม
        const blobPath = generateBillBlobPath("bill-main", {
          userId: req.userId,
          workspaceId: bill.workspace,
          billId: bill._id,
          originalname: req.file.originalname,
        });

        const newSlipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          billId: bill._id.toString(),
          type: "bill-main",
        });

        bill.eSlip = newSlipUrl;
      }

      // อัพเดทข้อมูลอื่นๆ ของบิล
      if (req.body.note !== undefined) bill.note = req.body.note;
      if (req.body.status !== undefined) bill.status = req.body.status;

      // อัพเดทรายการ items ถ้ามี
      if (req.body.items?.length > 0) {
        for (const updatedItem of req.body.items) {
          const itemIndex = bill.items.findIndex(
            item => item._id.toString() === updatedItem._id.toString()
          );

          if (itemIndex !== -1) {
            // อัพเดทข้อมูล item
            if (updatedItem.description) {
              bill.items[itemIndex].description = updatedItem.description;
            }
            if (updatedItem.amount) {
              bill.items[itemIndex].amount = parseFloat(updatedItem.amount);
            }

            // อัพเดท sharedWith ถ้ามี
            if (updatedItem.sharedWith?.length > 0) {
              for (const updatedShare of updatedItem.sharedWith) {
                const shareIndex = bill.items[itemIndex].sharedWith.findIndex(
                  share => share.user.toString() === updatedShare.user.toString()
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

      bill.updatedAt = new Date();
      await bill.save();

      res.json({
        success: true,
        message: "Bill updated successfully",
        data: bill
      });

    } catch (err) {
      console.error("Error updating bill:", {
        error: err.message,
        stack: err.stack,
        billId: req.params.id
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
    checkWorkspaceAccessMiddleware,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = await Bill.findOne({ 
        _id: id,
        workspace: req.workspaceId,
        'creator.userId': req.userId
      });

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found or you don't have permission to delete it"
        });
      }

      // Track deleted files
      const deletedFiles = [];
      const failedFiles = [];

      // Delete main bill slip using deleteFileFromAzure
      const mainFileResult = await deleteFileFromAzure(bill.eSlip, {
        type: 'main',
        billId: bill._id
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
            type: 'payment',
            userId: share.user,
            itemId: item._id
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
            totalFailed: failedFiles.length
          }
        }
      });

    } catch (err) {
      console.error(`Error in delete bill:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id
      });
      res.status(500).json({
        success: false,
        message: "Failed to delete bill",
        error: err.message
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    upload.single("eSlip"),
    validatePayment,
  ],
  async (req, res) => {
    const { id } = req.params;
    const itemId = req.body.itemId;

    try {
      const bill = req.bill;

      // ตรวจสอบว่ามีไฟล์แนบมาไหม
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Payment slip is required"
        });
      }

      // หา item ในบิล
      const item = bill.items.find(item => item._id.toString() === itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill"
        });
      }

      // หาข้อมูลการแชร์ของผู้ใช้
      const userShare = item.sharedWith.find(
        share => share.user.toString() === req.userId.toString()
      );
      if (!userShare) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list"
        });
      }

      // เช็คว่าเป็นบิลแบบ round หรือไม่
      if (bill.paymentType === "round") {
        const currentRound = bill.roundDetails.currentRound;
        
        // หา roundPayment ของรอบปัจจุบัน
        const currentRoundPayment = userShare.roundPayments.find(
          p => p.round === currentRound
        );

        if (!currentRoundPayment) {
          return res.status(400).json({
            success: false,
            message: `Round payment #${currentRound} not found`
          });
        }

        // เช็คสถานะการจ่ายเงินรอบปัจจุบัน
        if (currentRoundPayment.status === "paid") {
          return res.status(400).json({
            success: false,
            message: `Round #${currentRound} is already paid`
          });
        }

        // สร้าง path สำหรับเก็บไฟล์แต่ละรอบ
        const blobPath = generateBillBlobPath("payment-submit", {
          userId: req.userId,
          billId: bill._id,
          itemId: itemId,
          round: currentRound,
          originalname: req.file.originalname
        });

        // อัพโหลดสลิป
        const slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          billId: bill._id.toString(),
          itemId: itemId,
          round: currentRound,
          type: "round-payment-slip"
        });

        // อัพเดตสถานะและ URL สลิปของรอบปัจจุบัน
        currentRoundPayment.status = "awaiting_confirmation";
        currentRoundPayment.eSlip = slipUrl;

      } else {
        // กรณีบิลปกติ
        // เช็คสถานะการจ่ายเงิน
        if (userShare.status === "paid") {
          return res.status(400).json({
            success: false,
            message: "This share is already paid"
          });
        }

        // สร้าง path สำหรับเก็บไฟล์
        const blobPath = generateBillBlobPath("payment-submit", {
          userId: req.userId,
          billId: bill._id,
          itemId: itemId,
          originalname: req.file.originalname
        });

        // อัพโหลดสลิป
        const slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          billId: bill._id.toString(),
          itemId: itemId,
          type: "payment-slip"
        });

        // อัพเดตสถานะและ URL สลิป
        userShare.status = "awaiting_confirmation";
        userShare.eSlip = slipUrl;
      }

      await bill.save();

      res.json({
        success: true,
        message: "Payment evidence submitted successfully",
        data: bill
      });

    } catch (err) {
      console.error(`Error in payment submission:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id,
        itemId: itemId,
        file: req.file
      });
      res.status(500).json({
        success: false,
        message: "Failed to submit payment",
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
    upload.none(),
    validateConfirmPayment,
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = req.bill;
      const { itemId, userIdToConfirm } = req.body;

      // Find item and user share
      const item = bill.items.find(item => item._id.toString() === itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill"
        });
      }

      const userShare = item.sharedWith.find(
        share => share.user.toString() === userIdToConfirm
      );
      if (!userShare) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list"
        });
      }

      // เช็คว่าเป็นบิลแบบ round หรือไม่
      if (bill.paymentType === "round") {
        const currentRound = bill.roundDetails.currentRound;
        
        // หา roundPayment ของรอบปัจจุบัน
        const currentRoundPayment = userShare.roundPayments.find(
          p => p.round === currentRound
        );

        if (!currentRoundPayment || currentRoundPayment.status !== "awaiting_confirmation") {
          return res.status(400).json({
            success: false,
            message: "Payment is not awaiting confirmation for current round"
          });
        }

        // อัพเดตสถานะของรอบปัจจุบัน
        currentRoundPayment.status = "paid";

        // เช็คว่าทุกคนจ่ายรอบปัจจุบันครบหรือยัง
        const allPaidCurrentRound = bill.items.every(item =>
          item.sharedWith.every(share =>
            share.roundPayments.find(p => p.round === currentRound)?.status === "paid"
          )
        );

        if (allPaidCurrentRound) {
          // ถ้าเป็นรอบสุดท้าย
          if (currentRound === bill.roundDetails.totalPeriod) {
            bill.status = "paid";
          } else {
            // เลื่อนไปรอบถัดไป
            bill.roundDetails.currentRound++;
            
            // เตรียมรอบถัดไปสำหรับทุกคน
            bill.items.forEach(item => {
              item.sharedWith.forEach(share => {
                const nextRoundPayment = share.roundPayments.find(
                  p => p.round === currentRound + 1
                );
                if (nextRoundPayment) {
                  nextRoundPayment.status = "pending";
                }
              });
            });
          }
        }

        // Create transaction for round payment
        const transaction = new Transaction({
          user: bill.creator[0].userId,
          workspace: bill.workspace,
          type: "Income",
          amount: userShare.shareAmount,
          category: "Bill Payment",
          description: `Bill payment received from ${userShare.name} (Round ${currentRound}/${bill.roundDetails.totalPeriod})`,
          slip_image: currentRoundPayment.eSlip,
          reference: {
            type: "Bill",
            id: bill._id,
            itemId: itemId,
            userId: userIdToConfirm,
            round: currentRound
          }
        });

        await Promise.all([bill.save(), transaction.save()]);

      } else {
        // สำหรับบิลปกติ
        if (userShare.status !== "awaiting_confirmation") {
          return res.status(400).json({
            success: false,
            message: "Payment is not awaiting confirmation"
          });
        }

        userShare.status = "paid";

        // เช็คว่าทุกคนจ่ายครบหรือยัง
        const allPaid = bill.items.every(item =>
          item.sharedWith.every(share => share.status === "paid")
        );

        if (allPaid) {
          bill.status = "paid";
        }

        // Create transaction for normal payment
        const transaction = new Transaction({
          user: bill.creator[0].userId,
          workspace: bill.workspace,
          type: "Income",
          amount: userShare.shareAmount,
          category: "Bill Payment",
          description: `Bill payment received from ${userShare.name}`,
          slip_image: userShare.eSlip,
          reference: {
            type: "Bill",
            id: bill._id,
            itemId: itemId,
            userId: userIdToConfirm
          }
        });

        await Promise.all([bill.save(), transaction.save()]);
      }

      res.json({
        success: true,
        message: "Payment confirmed successfully",
        data: bill
      });

    } catch (err) {
      console.error("Error in confirm payment:", {
        error: err.message,
        stack: err.stack,
        billId: id,
        body: req.body,
      });
      res.status(500).json({
        success: false,
        message: "Failed to confirm payment",
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
    checkWorkspaceAccessMiddleware,
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
          message: "Bill is already canceled"
        });
      }

      // เก็บข้อมูลการลบไฟล์
      const deletedFiles = [];
      const failedFiles = [];

      // ลบไฟล์หลักของบิล
      const mainFileResult = await deleteFileFromAzure(bill.eSlip, {
        type: 'main',
        billId: bill._id
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
            type: 'payment',
            userId: share.user,
            itemId: item._id
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
            "items.$[].sharedWith.$[].eSlip": null
          },
        },
        { new: true, runValidators: true }
      );

      if (!updatedBill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found"
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
            totalFailed: failedFiles.length
          }
        }
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
        error: err.message
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
    upload.none(), // <<== เพิ่มบรรทัดนี้
  ],
  async (req, res) => {
    const { id } = req.params;
    try {
      const bill = req.bill;

      // DEBUG: log body
      console.log('PATCH /:id/round req.body:', req.body);
      // แปลงค่าจาก form-data ให้เป็นตัวเลข
      const dueDate = req.body.dueDate;
      const totalPeriod = req.body.totalPeriod ? Number(req.body.totalPeriod) : undefined;
      const currentRound = req.body.currentRound ? Number(req.body.currentRound) : undefined;

      if (bill.paymentType !== "round") {
        return res.status(400).json({
          success: false,
          message: "This bill is not a round payment type",
        });
      }

      // DEBUG: log ก่อนแก้ไข
      console.log('ก่อน:', bill.roundDetails);

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
      console.log('หลัง:', bill.roundDetails);

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
              updatedBill.roundDetails.currentRound === updatedBill.roundDetails.totalPeriod,
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
