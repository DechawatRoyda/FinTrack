import express from "express";
import Transaction from "../models/Transaction.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

// 📌 สร้าง Transaction ใหม่
router.post("/keepBills", authenticateToken, async (req, res) => {
  const { workspace, type, amount, category, description, slip_image } = req.body;

  if (!workspace || !type || !amount || !category || !slip_image) {
    return res.status(400).json({ error: "All required fields must be provided" });
  }

  try {
    const transaction = new Transaction({
      user: req.user.id, // ได้มาจาก middleware authenticateToken
      workspace 
    //   : req.workspace.id
      ,
      type,
      amount,
      category,
      description,
      slip_image,
    });

    await transaction.save();
    res.status(201).json({ message: "Transaction created successfully", transaction });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creating transaction" });
  }
});

// 📌 ดึง Transaction ทั้งหมดของ User ที่ล็อกอิน
router.get("/CheckBills", authenticateToken, async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.id }).populate("workspace");
    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error retrieving transactions" });
  }
});

// 📌 อัปเดต Transaction ตาม ID
router.put("/CheckBills/:id", authenticateToken, async (req, res) => {
  const { type, amount, category, description, slip_image } = req.body;

  try {
    let transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized to update this transaction" });
    }

    transaction.type = type || transaction.type;
    transaction.amount = amount || transaction.amount;
    transaction.category = category || transaction.category;
    transaction.description = description || transaction.description;
    transaction.slip_image = slip_image || transaction.slip_image;

    await transaction.save();
    res.json({ message: "Transaction updated successfully", transaction });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating transaction" });
  }
});

// 📌 ลบ Transaction ตาม ID
router.delete("/CheckBills/:id", authenticateToken, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized to delete this transaction" });
    }

    await transaction.deleteOne();
    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error deleting transaction" });
  }
});

export default router;
