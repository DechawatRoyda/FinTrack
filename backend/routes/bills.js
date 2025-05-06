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
    validateBillCreation,
    upload.single("eSlip"),
  ],
  async (req, res) => {
    const workspace = req.workspaceId; // จาก middleware
    const { items, note, eSlip, paymentType, roundDetails } = req.body;

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
          contentType: req.file.mimetype,
        });
      }

      // 1. ดึงข้อมูล creator จาก token
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

      // 3. สร้างบิล
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
                dueDate: roundDetails.dueDate,
                totalPeriod: roundDetails.totalPeriod,
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

              // สร้าง roundPayments ถ้าเป็นการผ่อนจ่าย
              const roundPayments =
                paymentType === "round"
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
                name: sharedUser.name,
                status: "pending",
                shareAmount: share.shareAmount,
                roundPayments,
              };
            }),
          },
        ],
        note,
        eSlip: slipUrl || eSlip,
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
        workspace: workspace,
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
  "/:id",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
    try {
      const bill = await Bill.findById(id)
        .populate("workspace")
        .populate("creator.userId", "name numberAccount")
        .populate("items.sharedWith.user", "name email");

      if (!bill) {
        return res.status(404).json({
          success: false,
          message: "Bill not found",
        });
      }

      // แปลงข้อมูลให้มี URL ของรูปภาพและข้อมูลเพิ่มเติม
      const detailedBill = {
        ...bill.toObject(),
        // รูปสลิปหลัก
        eSlip: bill.eSlip
          ? {
              url: bill.eSlip,
              path: bill.eSlip ? new URL(bill.eSlip).pathname : null,
            }
          : null,
        // ข้อมูลการจ่ายแบบรอบ
        roundInfo:
          bill.paymentType === "round"
            ? {
                currentRound: bill.roundDetails.currentRound,
                totalPeriod: bill.roundDetails.totalPeriod,
                dueDate: bill.roundDetails.dueDate,
                isLastRound:
                  bill.roundDetails.currentRound ===
                  bill.roundDetails.totalPeriod,
              }
            : null,
        // รายการในบิล
        items: bill.items.map((item) => ({
          ...item,
          sharedWith: item.sharedWith.map((share) => {
            // คำนวณยอดค้างชำระสะสม (สำหรับการจ่ายแบบรอบ)
            const accumulatedAmount =
              bill.paymentType === "round"
                ? bill.calculateAccumulatedAmount(share.user._id)
                : 0;

            // ข้อมูลการจ่ายรายงวด
            const roundPaymentInfo =
              bill.paymentType === "round"
                ? {
                    currentRoundPayment: share.roundPayments.find(
                      (p) => p.round === bill.roundDetails.currentRound
                    ),
                    paidRounds: share.roundPayments.filter(
                      (p) => p.status === "paid"
                    ).length,
                    remainingRounds: share.roundPayments.filter(
                      (p) => p.status === "pending"
                    ).length,
                    nextUnpaidRound: share.roundPayments.find(
                      (p) => p.status === "pending"
                    )?.round,
                    roundPayments: share.roundPayments.map((payment) => ({
                      ...payment,
                      eSlip: payment.eSlip
                        ? {
                            url: payment.eSlip,
                            path: payment.eSlip
                              ? new URL(payment.eSlip).pathname
                              : null,
                          }
                        : null,
                    })),
                  }
                : null;

            return {
              ...share,
              eSlip: share.eSlip
                ? {
                    url: share.eSlip,
                    path: share.eSlip ? new URL(share.eSlip).pathname : null,
                  }
                : null,
              accumulatedAmount,
              roundPaymentInfo,
            };
          }),
        })),
      };

      res.status(200).json({
        success: true,
        message: "Bill retrieved successfully",
        data: detailedBill,
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
    upload.single("eSlip"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
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
        billId: id,
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
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
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
        billId: id, // ✅
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    validatePayment,
    upload.single("eSlip"), // เพิ่ม multer middleware
  ],
  async (req, res) => {
    const bill = req.bill; // เพิ่มบรรทัดนี้ - ใช้ bill จาก middleware
    const { eslipUrl, itemId } = req.body;
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้

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
        billId: id,
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
  "/:id/confirm",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
    try {
      const bill = req.bill;
      const { itemId, userIdToConfirm, round } = req.body;

      // หารายการที่ต้องการอัพเดต
      const item = bill.items.find((item) => item._id.toString() === itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill",
        });
      }

      // หาผู้ใช้ในรายการที่ต้องการอัพเดต
      const userShare = item.sharedWith.find(
        (share) => share.user.toString() === userIdToConfirm
      );
      if (!userShare) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list",
        });
      }

      // ตรวจสอบว่ามีการแนบสลิปหรือไม่
      if (!userShare.eSlip) {
        return res.status(400).json({
          success: false,
          message: "Payment evidence not found",
        });
      }

      // จัดการตามประเภทการจ่ายเงิน
      if (bill.paymentType === "round") {
        // ตรวจสอบว่ามี Transaction สำหรับรอบนี้อยู่แล้วหรือไม่
        const existingTransaction = await Transaction.findOne({
          workspace: bill.workspace,
          user: bill.creator[0].userId,
          category: "Bill Payment",
          reference: {
            type: "Bill",
            id: bill._id,
            round: round,
          },
        });

        if (existingTransaction) {
          return res.status(400).json({
            success: false,
            message: `Transaction for round ${round} already exists`,
          });
        }

        // หา roundPayment ที่ต้องการอัพเดต
        const roundPayment = userShare.roundPayments.find(
          (p) => p.round === round
        );
        if (!roundPayment) {
          return res.status(404).json({
            success: false,
            message: `Round ${round} not found`,
          });
        }

        if (roundPayment.status === "paid") {
          return res.status(400).json({
            success: false,
            message: `Round ${round} is already paid`,
          });
        }

        // อัพเดตการจ่ายเงินสำหรับรอบนี้
        roundPayment.status = "paid";
        roundPayment.paidDate = new Date();
        roundPayment.eSlip = userShare.eSlip;

        // เช็คว่าจ่ายครบทุกรอบหรือยัง
        const allRoundsPaid = userShare.roundPayments.every(
          (p) => p.status === "paid"
        );
        if (allRoundsPaid) {
          userShare.status = "paid";
        }
      } else {
        // กรณีจ่ายแบบปกติ
        if (userShare.status !== "awaiting_confirmation") {
          return res.status(400).json({
            success: false,
            message: "Payment is not awaiting confirmation",
          });
        }

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

        userShare.status = "paid";
      }

      // อัพโหลดสลิปไปยัง Azure Blob ถ้าต้องการ
      if (userShare.eSlip && !userShare.eSlip.startsWith(AZURE_BLOB_DOMAIN)) {
        try {
          const blobPath = generateBillBlobPath("payment-confirm", {
            userId: userIdToConfirm,
            billId: bill._id,
            itemId: itemId,
            round: round,
          });

          const response = await fetch(userShare.eSlip);
          const buffer = await response.buffer();

          const slipUrl = await uploadToAzureBlob(buffer, blobPath, {
            billId: bill._id.toString(),
            itemId: itemId,
            userId: userIdToConfirm,
            type: "payment-confirm",
            round: round,
          });

          userShare.eSlip = slipUrl;
        } catch (error) {
          console.error("Error uploading to Azure:", error);
        }
      }

      // สร้าง Transaction
      const transaction = new Transaction({
        user: bill.creator[0].userId,
        workspace: bill.workspace,
        type: "Income",
        amount:
          bill.paymentType === "round"
            ? userShare.shareAmount
            : userShare.shareAmount,
        category: "Bill Payment",
        description:
          bill.paymentType === "round"
            ? `Round ${round} payment received from ${userShare.name}`
            : `Bill payment received from ${userShare.name}`,
        slip_image: userShare.eSlip,
        reference: {
          type: "Bill",
          id: bill._id,
          itemId: itemId,
          userId: userIdToConfirm,
          round: round,
        },
      });

      // เช็คว่าทุกคนจ่ายครบหรือยัง
      const allPaid = bill.items.every((item) =>
        item.sharedWith.every((share) =>
          bill.paymentType === "round"
            ? share.roundPayments.every((p) => p.status === "paid")
            : share.status === "paid"
        )
      );

      if (allPaid) {
        bill.status = "paid";
      }

      // บันทึกการเปลี่ยนแปลง
      await Promise.all([bill.save(), transaction.save()]);

      res.json({
        success: true,
        message: "Payment confirmed successfully",
        data: {
          bill,
          transaction,
          roundStatus:
            bill.paymentType === "round"
              ? {
                  currentRound: round,
                  isPaidAll: allPaid,
                  accumulatedAmount:
                    bill.calculateAccumulatedAmount(userIdToConfirm),
                }
              : undefined,
        },
      });
    } catch (err) {
      console.error(`Error in confirm payment:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id, // ✅
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
  "/:id/cancel",
  [
    authenticateToken,
    validateUserId,
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
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
        billId: id, // ✅
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
    checkWorkspaceAccessMiddleware,
    checkBillStatus,
    checkBillCreator,
  ],
  async (req, res) => {
    const { id } = req.params; // ✅ เพิ่มบรรทัดนี้
    try {
      const bill = req.bill;
      const { dueDate, totalPeriod, currentRound } = req.body;

      // ตรวจสอบว่าเป็นบิลแบบรอบหรือไม่
      if (bill.paymentType !== "round") {
        return res.status(400).json({
          success: false,
          message: "This bill is not a round payment type",
        });
      }

      // อัพเดตรายละเอียดการจ่ายแบบรอบ
      if (dueDate) {
        bill.roundDetails.dueDate = new Date(dueDate);
      }

      // ตรวจสอบการแก้ไขจำนวนงวด
      if (totalPeriod) {
        // ตรวจสอบว่าลดจำนวนงวดน้อยกว่างวดที่จ่ายไปแล้วหรือไม่
        const maxPaidRound = Math.max(
          ...bill.items.flatMap((item) =>
            item.sharedWith.flatMap((share) =>
              share.roundPayments
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

        // อัพเดตจำนวนงวดและปรับ roundPayments
        bill.roundDetails.totalPeriod = totalPeriod;

        // ปรับ roundPayments ของทุกคนตามจำนวนงวดใหม่
        bill.items.forEach((item) => {
          item.sharedWith.forEach((share) => {
            // เก็บ roundPayments เดิมที่มีการจ่ายแล้ว
            const paidPayments = share.roundPayments.filter(
              (p) => p.status === "paid"
            );

            // สร้าง roundPayments ใหม่
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

      // อัพเดตรอบปัจจุบัน
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

      res.json({
        success: true,
        message: "Round payment details updated successfully",
        data: {
          bill,
          roundInfo: {
            currentRound: bill.roundDetails.currentRound,
            totalPeriod: bill.roundDetails.totalPeriod,
            dueDate: bill.roundDetails.dueDate,
            isLastRound:
              bill.roundDetails.currentRound === bill.roundDetails.totalPeriod,
          },
        },
      });
    } catch (err) {
      console.error(`Error in update round payment:`, {
        error: err.message,
        stack: err.stack,
        userId: req.userId,
        billId: id, // ✅
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
