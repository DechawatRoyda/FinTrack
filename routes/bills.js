import express from "express";
import Bill from "../models/Bill.js";
import Workspace from "../models/Workspace.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

// 1️⃣ สร้างบิลใหม่
router.post("/", authenticateToken, async (req, res) => {
  const { workspace, items } = req.body;
  const payer = req.user._id; // คนจ่าย

  if (!workspace || !items || items.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // ตรวจสอบว่า workspace เป็นประเภท expense หรือไม่
    const workspaceData = await Workspace.findById(workspace);
    if (!workspaceData || workspaceData.type !== "expense") {
      return res.status(400).json({ error: "Invalid workspace or not an expense workspace" });
    }

    const bill = new Bill({
      workspace,
      creator: payer,
      payer,
      items,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await bill.save();
    res.status(201).json(bill);
  } catch (err) {
    res.status(500).json({ error: "Failed to create bill", message: err.message });
  }
});

// 2️⃣ ดึงข้อมูลบิลทั้งหมดใน workspace
router.get("/:workspaceId", authenticateToken, async (req, res) => {
  const { workspaceId } = req.params;

  try {
    const bills = await Bill.find({ workspace: workspaceId }).populate("payer").populate("items.sharedWith.user");
    res.json(bills);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch bills", message: err.message });
  }
});

// 3️⃣ อัพเดตข้อมูลบิล (แก้ไขรายการที่ต้องหาร)
router.put("/:billId", authenticateToken, async (req, res) => {
  const { billId } = req.params;
  const { items, status } = req.body;

  try {
    const bill = await Bill.findById(billId);
    if (!bill) return res.status(404).json({ error: "Bill not found" });

    // ตรวจสอบว่าเป็นเจ้าของบิลหรือไม่
    if (bill.payer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You are not authorized to update this bill" });
    }

    bill.items = items || bill.items;
    bill.status = status || bill.status;
    bill.updatedAt = new Date();

    await bill.save();
    res.json(bill);
  } catch (err) {
    res.status(500).json({ error: "Failed to update bill", message: err.message });
  }
});

// 4️⃣ ลบบิล
router.delete("/:billId", authenticateToken, async (req, res) => {
  const { billId } = req.params;

  try {
    const bill = await Bill.findById(billId);
    if (!bill) return res.status(404).json({ error: "Bill not found" });

    // ตรวจสอบว่าเป็นเจ้าของบิลหรือไม่
    if (bill.payer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You are not authorized to delete this bill" });
    }

    await bill.deleteOne();
    res.json({ message: "Bill deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete bill", message: err.message });
  }
});

export default router;
