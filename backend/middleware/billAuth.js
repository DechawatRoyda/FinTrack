import Bill from "../models/Bills.js";
import { getUserId } from "./workspaceAuth.js";

// ตรวจสอบว่าเป็นผู้สร้างบิล
export const checkBillCreator = async (req, res, next) => {
  const userId = getUserId(req.user);
  const billId = req.params.id; // แก้ตรงนี้

  try {
    // filter ด้วย workspace ด้วย (ถ้ามี req.workspaceId)
    const bill = await Bill.findOne({ _id: billId, workspace: req.workspaceId });
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found"
      });
    }

    const isCreator = bill.creator.some(
      creator => creator.userId.toString() === userId.toString()
    );

    if (!isCreator) {
      return res.status(403).json({
        success: false,
        message: "Only bill creator can perform this action"
      });
    }

    req.bill = bill; // เก็บ bill ไว้ใช้ต่อ
    next();
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to check bill creator",
      error: err.message
    });
  }
};

// ตรวจสอบสถานะบิล
export const checkBillStatus = async (req, res, next) => {
  const billId = req.params.id; // แก้ตรงนี้
  try {
    // filter ด้วย workspace ด้วย (ถ้ามี req.workspaceId)
    const bill = await Bill.findOne({ _id: billId, workspace: req.workspaceId })
      .populate({
        path: 'workspace',
        select: 'name type owner members'
      })
      .populate({
        path: 'creator.userId',
        select: 'name email'
      });

    if (!bill) {
      return res.status(404).json({
        success: false,
        message: "Bill not found"
      });
    }

    // เพิ่มการตรวจสอบสถานะ paid ด้วย
    if (bill.status === "canceled" || bill.status === "paid") {
      return res.status(400).json({
        success: false,
        message: `This bill is ${bill.status} and cannot be modified`
      });
    }

    req.bill = bill;
    next();
  } catch (err) {
    console.error('Error in checkBillStatus:', err);
    res.status(500).json({
      success: false,
      message: "Failed to check bill status",
      error: err.message
    });
  }
};