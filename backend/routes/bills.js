import express from "express";
import Bill from "../models/Bills.js";
import Workspace from "../models/Workspace.js";
import { authenticateToken, validateUserId } from "../middleware/auth.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";

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
  ],
  async (req, res) => {
    // แก้ไขการรับ body
    const { items, note, eSlip } = req.body;
    const workspace = req.workspaceId;

    try {
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
        eSlip,
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

      res.status(200).json({
        success: true,
        message: "Bills retrieved successfully",
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
  ],
  async (req, res) => {
    const { billId } = req.params;
    const { items, note, eSlip, status } = req.body;

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
  ],
  async (req, res) => {
    const bill = req.bill; // เพิ่มบรรทัดนี้ - ใช้ bill จาก middleware
    const { eslipUrl, itemId } = req.body;

    try {
      // ค้นหา item และ userShare
      const item = bill.items.find(
        (item) => item._id.toString() === itemId.toString()
      );
      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this bill",
        });
      }

      const itemIndex = bill.items.indexOf(item);

      // ค้นหา userShare โดยใช้ toString() ทั้งสองฝั่ง
      const userShare = item.sharedWith.find(
        (share) => share.user._id.toString() === req.userId.toString()
      );
      if (!userShare) {
        return res.status(404).json({
          success: false,
          message: "User not found in shared list",
          details: {
            userId: req.userId,
            itemId: itemId,
          },
        });
      }

      const userShareIndex = item.sharedWith.indexOf(userShare);

      // อัพเดตสลิปและเปลี่ยนสถานะเป็น awaiting_confirmation (รอการยืนยัน)
      userShare.eSlip = eslipUrl;
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
        const transactions = bill.items
          .map((item) => {
            return item.sharedWith
              .map((share) => {
                if (share.status === "paid") {
                  return new Transaction({
                    user: bill.creator[0].userId,
                    workspace: bill.workspace,
                    type: "Income",
                    amount: share.shareAmount,
                    category: "Bill Payment",
                    description: `Bill payment received from ${share.name}`,
                    slip_image: share.eSlip,
                    reference: {
                      type: "Bill",
                      id: bill._id,
                      itemId: item._id,
                      userId: share.user,
                    },
                  });
                }
              })
              .filter((t) => t); // กรองเอาแค่ transaction ที่ไม่เป็น undefined
          })
          .flat(); // แปลง array 2 มิติให้เป็น 1 มิติ

        // บันทึก transactions ทั้งหมด
        await Promise.all(transactions.map((t) => t.save()));
      }
      await bill.save();

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
    const { billId } = req.params;

    try {
      const bill = req.bill;
      bill.status = "canceled";
      await bill.save();

      res.json({
        success: true,
        message: "Bill canceled successfully",
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
      const bill = req.bill; // ใช้ bill จาก middleware
      await bill.deleteOne();
      res.json({
        success: true,
        message: "Bill deleted successfully",
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
