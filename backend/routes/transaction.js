import express from "express";
import Transaction from "../models/Transaction.js";
import authenticateToken from "../middleware/auth.js";
import multer from "multer";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import { deleteFromAzureBlob } from "../utils/azureStorage.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 📌 สร้าง Transaction ใหม่
router.post(
  "/keepBills",
  authenticateToken,
  upload.single("slip_image"),
  async (req, res) => {
    try {
      // Log request details
      console.log("Request body:", req.body);
      console.log("File:", req.file);

      const { workspace, type, amount, category, description } = req.body;

      // Validate input types
      if (!workspace || !type || !amount || !category || !req.file) {
        return res.status(400).json({ 
          error: "All required fields must be provided",
          missing: {
            workspace: !workspace,
            type: !type,
            amount: !amount,
            category: !category,
            file: !req.file
          }
        });
      }

      // Validate amount is a number
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount)) {
        return res.status(400).json({ error: "Amount must be a number" });
      }

      // Upload to Azure Blob with error handling
      let blobUrl;
      try {
        const uniqueFilename = `${req.user.id}-${workspace}-${Date.now()}-${req.file.originalname}`;
        blobUrl = await uploadToAzureBlob(req.file.buffer, uniqueFilename, {
          userId: req.user.id,
          workspaceId: workspace,
          type: "transaction",
          contentType: req.file.mimetype,
          uploadDate: new Date().toISOString()
        });
      } catch (uploadError) {
        console.error("Azure upload error:", uploadError);
        return res.status(500).json({ 
          error: "Failed to upload file",
          details: uploadError.message
        });
      }

      // Create transaction with validated data
      const transaction = new Transaction({
        user: req.user.id,
        workspace,
        type,
        amount: numAmount,
        category,
        description,
        slip_image: blobUrl,
        transaction_date: new Date(),
        transaction_time: new Date().toLocaleTimeString(),
      });

      await transaction.save();

      res.status(201).json({
        success: true,
        message: "Transaction created successfully",
        transaction
      });

    } catch (error) {
      console.error("Transaction creation error:", {
        message: error.message,
        stack: error.stack,
        body: req.body,
        userId: req.user?.id
      });

      res.status(500).json({
        error: "Error creating transaction",
        details: error.message
      });
    }
  }
);

// 📌 ดึง Transaction ทั้งหมดของ User ที่ล็อกอิน
router.get("/CheckBills", authenticateToken, async (req, res) => {
  try {
    const { sort = '-createdAt', limit = 10, page = 1 } = req.query;
    
    // ดึงข้อมูล transactions พร้อม populate workspace
    const transactions = await Transaction.find({ user: req.user.id })
      .populate("workspace")
      .select('type amount category description slip_image transaction_date transaction_time')
      .sort(sort)
      .limit(parseInt(limit))
      .skip((page - 1) * limit);

    // แปลง transactions ให้มี image path ที่เหมาะสม
    const transformedTransactions = transactions.map(transaction => {
      const { _id, type, amount, category, description, slip_image, transaction_date, transaction_time, workspace } = transaction;
      return {
        _id,
        type,
        amount,
        category,
        description,
        transaction_date,
        transaction_time,
        workspace: workspace ? {
          _id: workspace._id,
          name: workspace.name
        } : null,
        image: {
          url: slip_image,
          path: slip_image ? new URL(slip_image).pathname : null
        }
      };
    });

    // นับจำนวนทั้งหมด
    const total = await Transaction.countDocuments({ user: req.user.id });

    res.json({
      success: true,
      data: {
        transactions: transformedTransactions,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
          hasMore: page < Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error("Error retrieving transactions:", error);
    res.status(500).json({ 
      success: false, 
      error: "Error retrieving transactions",
      message: error.message 
    });
  }
});

// 📌 อัปเดต Transaction ตาม ID
router.put(
  "/CheckBills/:id",
  authenticateToken,
  upload.single("slip_image"),
  async (req, res) => {
    const { type, amount, category, description, slip_image } = req.body;

    try {
      let transaction = await Transaction.findById(req.params.id);

      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      if (transaction.user.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Unauthorized to update this transaction" });
      }

      // If new image is uploaded
      if (req.file) {
        // ใช้ format เดียวกันกับตอนสร้าง
        const uniqueFilename = `${req.user.id}-${workspace}-${Date.now()}-${
          req.file.originalname
        }`;
        const blobUrl = await uploadToAzureBlob(
          req.file.buffer,
          uniqueFilename
        );
        transaction.slip_image = blobUrl;
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
  }
);

// 📌 ลบ Transaction ตาม ID
router.delete("/CheckBills/:id", authenticateToken, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.user.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this transaction" });
    }

    // ลบไฟล์จาก Azure Blob ก่อน
    if (transaction.slip_image && transaction.slip_image.includes('blob.core.windows.net')) {
      try {
        await deleteFromAzureBlob(transaction.slip_image);
      } catch (error) {
        console.error("Error deleting blob:", error);
        // อาจจะ return error หรือทำการ handle ตามที่ต้องการ
      }
    }

    // ลบ transaction จาก MongoDB
    await transaction.deleteOne();
    
    res.json({ 
      success: true,
      message: "Transaction and associated files deleted successfully" 
    });
  } catch (error) {
    console.error("Delete transaction error:", error);
    res.status(500).json({ 
      success: false,
      error: "Error deleting transaction",
      message: error.message 
    });
  }
});

export default router;
