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
} from "../middleware/billValidation.js";

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
router.post(
  "/",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    validateBillCreation,
    upload.single("eSlip"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    // แก้ไขการรับ body
    const { items, note, eSlip } = req.body;
    const workspace = req.workspaceId;

    try {
      // Upload to Azure Blob if file exists
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
          contentType: req.file.mimetype // เพิ่มบรรทัดนี้
        });
      }
      // 1. ดึงข้อมูล creator จาก token แทน
      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Creator not found",
        });
      }

      // 2. ดึงข้อมูล users ที่แชร์บิล
      const sharedUserIds = items[0].sharedWith.map((share) => share.user);
      const sharedUsers = await User.find({ _id: { $in: sharedUserIds } });

      // 3. สร้างบิลโดยใช้ req.userId
      const bill = new Bill({
        workspace,
        creator: [
          {
            userId: req.userId, // ใช้ userId จาก token
            name: user.name,
            numberAccount: user.numberAccount,
          },
        ],
        items: [
          {
            ...items[0],
            sharedWith: items[0].sharedWith.map((share) => {
              const sharedUser = sharedUsers.find(
                (user) => user._id.toString() === share.user.toString()
              );
              return {
                user: share.user,
                name: sharedUser.name,
                status: "pending",
                shareAmount: share.shareAmount,
              };
            }),
          },
        ],
        note,
        eSlip: slipUrl || req.body.eSlip,
        status: "pending",
      });

      await bill.save();
      res.status(201).json({
        success: true,
        message: "Bill created successfully",
        data: bill,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        workspace: req.workspaceId,
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
  "/:workspaceId",
  [authenticateToken, validateUserId, checkWorkspaceAccessMiddleware],
  async (req, res) => {
    try {
      const bills = await Bill.find({ workspace: req.workspaceId })
        .populate("workspace")
        .populate("creator") // เลือกเฉพาะฟิลด์ที่ต้องการ
        .populate("items.sharedWith"); // เลือกเฉพาะฟิลด์ที่ต้องการ

      res.status(200).json({
        success: true,
        message: "Bills retrieved successfully",
        data: bills,
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

// 2.1️⃣ ดึงข้อมูลบิลตาม ID
router.get(
  "/detail/:billId",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
  ],
  async (req, res) => {
    try {
      const bill = await Bill.findById(req.params.billId)
        .populate("workspace")
        .populate("creator") // เลือกเฉพาะฟิลด์ที่ต้องการ
        .populate("items.sharedWith"); // เลือกเฉพาะฟิลด์ที่ต้องการ
      if (!bill)
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });

      // แปลงข้อมูลให้มี URL ของรูปภาพ
      const detailedBill = {
        ...bill.toObject(),
        // รูปสลิปหลัก
        eSlip: bill.eSlip
          ? {
              url: bill.eSlip,
              path: bill.eSlip ? new URL(bill.eSlip).pathname : null,
            }
          : null,
        // รูปสลิปการจ่ายเงินของแต่ละคน
        items: bill.items.map((item) => ({
          ...item,
          sharedWith: item.sharedWith.map((share) => ({
            ...share,
            eSlip: share.eSlip
              ? {
                  url: share.eSlip,
                  path: share.eSlip ? new URL(share.eSlip).pathname : null,
                }
              : null,
          })),
        })),
      };

      res.status(200).json({
        success: true,
        message: "Bills retrieved successfully",
        data: detailedBill,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to fetch bills",
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
  "/update/:billId",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
    upload.single("eSlip"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    const bill = req.bill;
    const { items, note, eSlip, status } = req.body;

    // Upload new slip if provided
    if (req.file) {
      const blobPath = generateBillBlobPath("bill-update", {
        userId: req.userId,
        billId: bill._id,
        originalname: req.file.originalname,
      });
      const newSlipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
        userId: req.userId.toString(),
        billId: bill._id.toString(),
        type: "bill-update",
      });
      bill.eSlip = newSlipUrl;
    }

    try {
      const bill = req.bill;
      // อัพเดตข้อมูลทั่วไปของบิล (ถ้ามี)
      if (note !== undefined) bill.note = note;
      if (eSlip !== undefined) bill.eSlip = eSlip;
      if (status !== undefined) bill.status = status;

      // อัพเดตรายการสินค้า (ถ้ามี)
      if (items && items.length > 0) {
        for (const updatedItem of items) {
          if (updatedItem._id) {
            // หา index ของ item ที่ต้องการอัพเดต
            const itemIndex = bill.items.findIndex(
              (item) => item._id.toString() === updatedItem._id.toString()
            );

            if (itemIndex !== -1) {
              // อัพเดตข้อมูลทั่วไปของ item
              if (updatedItem.description !== undefined) {
                bill.items[itemIndex].description = updatedItem.description;
              }

              if (updatedItem.amount !== undefined) {
                bill.items[itemIndex].amount = updatedItem.amount;
              }

              // อัพเดต sharedWith ถ้ามี
              if (updatedItem.sharedWith && updatedItem.sharedWith.length > 0) {
                for (const updatedShare of updatedItem.sharedWith) {
                  if (updatedShare.user) {
                    // หา index ของ user ที่ต้องการอัพเดต
                    const shareIndex = bill.items[
                      itemIndex
                    ].sharedWith.findIndex(
                      (share) =>
                        share.user.toString() === updatedShare.user.toString()
                    );

                    if (shareIndex !== -1) {
                      // อัพเดตข้อมูลของ user
                      if (updatedShare.status !== undefined) {
                        bill.items[itemIndex].sharedWith[shareIndex].status =
                          updatedShare.status;
                      }

                      if (updatedShare.shareAmount !== undefined) {
                        bill.items[itemIndex].sharedWith[
                          shareIndex
                        ].shareAmount = updatedShare.shareAmount;
                      }

                      if (updatedShare.eslip !== undefined) {
                        bill.items[itemIndex].sharedWith[shareIndex].eslip =
                          updatedShare.eslip;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // ตรวจสอบว่าทุกคนชำระเงินครบหรือยัง
      const allItemsPaid = bill.items.every((item) =>
        item.sharedWith.every((share) => share.status === "paid")
      );

      // ถ้าทุกคนจ่ายครบ อัพเดตสถานะบิลเป็น paid
      if (allItemsPaid && bill.status !== "canceled") {
        bill.status = "paid";
      }

      await bill.save();
      res.json({
        success: true,
        message: "Bill updated successfully",
        data: bill,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
        updates: req.body,
      });
      res.status(500).json({
        success: false,
        message: "Failed to update bill",
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
  "/:billId/payment",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    validatePayment,
    upload.single("eSlip"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    const bill = req.bill; // เพิ่มบรรทัดนี้ - ใช้ bill จาก middleware
    const { eslipUrl, itemId } = req.body;

    try {
      const item = bill.items.find((item) => item._id.toString() === itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill",
        });
      }

      const userShare = item.sharedWith.find(
        (share) => share.user.toString() === req.userId.toString()
      );
      if (!userShare) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list",
        });
      }

      // Upload payment slip to Azure Blob
      if (req.file) {
        const blobPath = generateBillBlobPath("payment-submit", {
          userId: req.userId,
          billId: bill._id,
          itemId: itemId,
          originalname: req.file.originalname,
        });
        const slipUrl = await uploadToAzureBlob(req.file.buffer, blobPath, {
          userId: req.userId.toString(),
          billId: bill._id.toString(),
          itemId: itemId,
          type: "payment-slip",
        });
        userShare.eSlip = slipUrl;
      }

      userShare.status = "awaiting_confirmation";
      await bill.save();

      res.json({
        success: true,
        message: "Payment evidence submitted successfully",
        data: bill,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
        itemId: req.body.itemId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to submit payment",
        error: err.message,
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
  "/:billId/confirm-payment",
  [
    authenticateToken,
    validateUserId, // เพิ่ม
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const bill = req.bill; // ใช้ bill จาก middleware
    const { itemId, userIdToConfirm } = req.body;

    try {
      // 2. ตรวจสอบว่ามี Transaction อยู่แล้วหรือไม่
      const existingTransaction = await Transaction.findOne({
        workspace: bill.workspace,
        user: bill.creator[0].userId,
        category: "Bill Payment",
        reference: {
          type: "Bill",
          id: bill._id,
        },
      });

      if (existingTransaction) {
        return res.status(400).json({
          success: false,
          message: "Transaction for this bill already exists",
        });
      }

      // หารายการที่ต้องการอัพเดต
      const itemIndex = bill.items.findIndex(
        (item) => item._id.toString() === itemId
      );
      if (itemIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill",
        });
      }

      // หาผู้ใช้ในรายการที่ต้องการอัพเดต
      const userShareIndex = bill.items[itemIndex].sharedWith.findIndex(
        (share) => share.user.toString() === userIdToConfirm
      );

      if (userShareIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list",
        });
      }

      // ตรวจสอบว่ามีการแนบสลิปหรือไม่
      if (!bill.items[itemIndex].sharedWith[userShareIndex].eSlip) {
        return res.status(400).json({
          success: false,
          message: "This user has not submitted payment evidence yet",
        });
      }

      // ตรวจสอบว่าสถานะเป็น awaiting_confirmation หรือไม่
      if (
        bill.items[itemIndex].sharedWith[userShareIndex].status !==
        "awaiting_confirmation"
      ) {
        return res.status(400).json({
          success: false,
          message: "This payment is not awaiting confirmation",
        });
      }

      // อัพเดตสถานะการชำระเงินเป็น paid
      bill.items[itemIndex].sharedWith[userShareIndex].status = "paid";

      // ตรวจสอบว่าทุกคนชำระเงินครบหรือยัง
      const allItemsPaid = bill.items.every((item) =>
        item.sharedWith.every((share) => share.status === "paid")
      );

      // ถ้าทุกคนจ่ายครบ อัพเดตสถานะบิลเป็น paid
      if (allItemsPaid && bill.status !== "canceled") {
        bill.status = "paid";

        // สร้าง Transaction สำหรับทุกคนที่จ่ายในบิล
        const transactions = await Promise.all(
          bill.items.map(async (item) => {
            return Promise.all(
              item.sharedWith.map(async (share) => {
                if (share.status === "paid") {
                  // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
                  const blobPath = generateBillBlobPath("payment-confirm", {
                    userId: share.user,
                    billId: bill._id,
                    itemId: item._id,
                  });
                  let slipUrl = share.eSlip;

                  // อัพโหลดสลิปไปยัง Azure Blob ถ้ายังไม่เคยอัพโหลด
                  if (
                    share.eSlip &&
                    !share.eSlip.startsWith(
                      AZURE_BLOB_DOMAIN
                    )
                  ) {
                    try {
                      const response = await fetch(share.eSlip);
                      const buffer = await response.buffer();

                      slipUrl = await uploadToAzureBlob(buffer, blobPath, {
                        billId: bill._id.toString(),
                        itemId: item._id.toString(),
                        userId: share.user.toString(),
                        type: "payment-confirm",
                      });

                      // อัพเดต eSlip ใน bill ด้วย URL ใหม่
                      share.eSlip = slipUrl;
                    } catch (error) {
                      console.error("Error uploading to Azure:", error);
                      // ใช้ URL เดิมถ้าอัพโหลดไม่สำเร็จ
                    }
                  }

                  return new Transaction({
                    user: bill.creator[0].userId,
                    workspace: bill.workspace,
                    type: "Income",
                    amount: share.shareAmount,
                    category: "Bill Payment",
                    description: `Bill payment received from ${share.name}`,
                    slip_image: slipUrl, // ใช้ URL จาก Azure Blob
                    reference: {
                      type: "Bill",
                      id: bill._id,
                      itemId: item._id,
                      userId: share.user,
                    },
                  });
                }
              })
            ).then((transactions) => transactions.filter((t) => t));
          })
        );

        // บันทึก transactions และ bill
        await Promise.all([
          ...transactions.flat().map((t) => t.save()),
          bill.save(),
        ]);
      }

      // แก้ไข response format
      res.json({
        success: true,
        message: "Payment confirmed successfully",
        data: {
          bill,
          status:
            bill.status === "paid"
              ? "All payments completed"
              : "Some payments pending",
        },
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
        itemId: req.body.itemId,
        userIdToConfirm: req.body.userIdToConfirm,
      });
      res.status(500).json({
        success: false,
        message: "Failed to confirm payment",
        error: err.message,
      });
    }
  }
);

/**
 * @route PATCH /api/bills/:billId/cancel
 * @desc Cancel a bill
 */
// 6️⃣ ยกเลิกบิล (เปลี่ยนสถานะเป็น canceled)
router.patch(
  "/:billId/cancel",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    try {
      const bill = req.bill;

      // 1. ลบรูปสลิปหลักของบิล
      if (bill.eSlip?.includes(AZURE_BLOB_DOMAIN)) {
        try {
          await deleteFromAzureBlob(bill.eSlip);
          bill.eSlip = null;
          console.log(`Deleted main bill slip for bill ${bill._id}`);
        } catch (error) {
          console.error("Error deleting main bill slip:", error);
        }
      }

      // 2. ลบรูปสลิปการจ่ายเงินของทุกคนที่ร่วมจ่าย
      for (const item of bill.items) {
        for (const share of item.sharedWith) {
          if (share.eSlip?.includes(AZURE_BLOB_DOMAIN)) {
            try {
              await deleteFromAzureBlob(share.eSlip);
              share.eSlip = null;
              console.log(
                `Deleted payment slip for user ${share.user} in bill ${bill._id}`
              );
            } catch (error) {
              console.error("Error deleting payment slip:", error);
            }
          }
          // รีเซ็ตสถานะการจ่ายเงิน
          share.status = "canceled";
        }
      }

      // 3. อัพเดตสถานะและบันทึกการเปลี่ยนแปลง
      bill.status = "canceled";
      bill.canceledAt = new Date();
      bill.canceledBy = req.userId;
      bill.updatedAt = new Date();

      await bill.save();

      res.json({
        success: true,
        message: "Bill canceled and all associated files deleted successfully",
        data: bill,
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
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
 * @route DELETE /api/bills/:billId
 * @desc Delete a bill
 */
// 7️⃣ ลบบิล
router.delete(
  "/:billId",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const { billId } = req.params;

    try {
      const bill = req.bill;

      // Delete main bill slip if exists
      if (bill.eSlip && bill.eSlip.includes(AZURE_BLOB_DOMAIN)) {
        try {
          await deleteFromAzureBlob(bill.eSlip);
        } catch (error) {
          console.error("Error deleting bill slip:", error);
        }
      }

      // Delete all payment slips
      for (const item of bill.items) {
        for (const share of item.sharedWith) {
          if (share.eSlip && share.eSlip.includes(AZURE_BLOB_DOMAIN)) {
            try {
              await deleteFromAzureBlob(share.eSlip);
            } catch (error) {
              console.error("Error deleting payment slip:", error);
            }
          }
        }
      }

      await bill.deleteOne();

      res.json({
        success: true,
        message: "Bill and associated files deleted successfully",
      });
    } catch (err) {
      console.error(`Error in ${req.method} ${req.originalUrl}:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: req.params.billId,
      });
      res.status(500).json({
        success: false,
        message: "Failed to delete bill",
        error: err.message,
      });
    }
  }
);

export default router;
