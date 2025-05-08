import express from "express";
import Transaction from "../models/Transaction.js";
import authenticateToken from "../middleware/auth.js";
import multer from "multer";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import { deleteFromAzureBlob } from "../utils/azureStorage.js";
import { checkTransactionOwner } from "../middleware/transactionAuth.js";

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
      console.log("Form-data body:", req.body);
      console.log("Uploaded file:", req.file);

      const { workspace, type, amount, category, description } = req.body;

      // Validate required fields
      if (!workspace || !type || !amount || !category || !req.file) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
          missing: {
            workspace: !workspace,
            type: !type,
            amount: !amount,
            category: !category,
            slip_image: !req.file,
          },
        });
      }

      // Validate amount
      const numAmount = parseFloat(amount);
      if (isNaN(numAmount)) {
        return res.status(400).json({
          success: false,
          message: "Amount must be a number",
        });
      }

      // Upload file to Azure Blob
      let blobUrl;
      try {
        const uniqueFilename = `transactions/${workspace}/${Date.now()}-${
          req.file.originalname
        }`;
        blobUrl = await uploadToAzureBlob(req.file.buffer, uniqueFilename, {
          userId: req.user.id,
          workspaceId: workspace,
          type: "transaction-slip",
          contentType: req.file.mimetype,
        });
      } catch (uploadError) {
        console.error("File upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload slip image",
          error: uploadError.message,
        });
      }

      // Create transaction
      const transaction = new Transaction({
        user: req.user.id,
        workspace,
        type,
        amount: numAmount,
        category,
        description: description || "",
        slip_image: blobUrl,
        transaction_date: new Date(),
        transaction_time: new Date().toLocaleTimeString(),
      });

      await transaction.save();

      res.status(201).json({
        success: true,
        message: "Transaction created successfully",
        data: transaction,
      });
    } catch (error) {
      console.error("Transaction creation error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create transaction",
        error: error.message,
      });
    }
  }
);

// 📌 ดึง Transaction ทั้งหมดของ User ที่ล็อกอิน
router.get("/CheckBills", authenticateToken, async (req, res) => {
  try {
    const { sort = "-createdAt", limit = 10, page = 1 } = req.query;

    // ดึงข้อมูล transactions พร้อม populate workspace
    const transactions = await Transaction.find({ user: req.user.id })
      .populate("workspace")
      .select(
        "type amount category description slip_image transaction_date transaction_time"
      )
      .sort(sort)
      .limit(parseInt(limit))
      .skip((page - 1) * limit);

    // แปลง transactions ให้มี image path ที่เหมาะสม
    const transformedTransactions = transactions.map((transaction) => {
      const {
        _id,
        type,
        amount,
        category,
        description,
        slip_image,
        transaction_date,
        transaction_time,
        workspace,
      } = transaction;
      return {
        _id,
        type,
        amount,
        category,
        description,
        transaction_date,
        transaction_time,
        workspace: workspace
          ? {
              _id: workspace._id,
              name: workspace.name,
            }
          : null,
        image: {
          url: slip_image,
          path: slip_image ? new URL(slip_image).pathname : null,
        },
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
          hasMore: page < Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error retrieving transactions:", error);
    res.status(500).json({
      success: false,
      error: "Error retrieving transactions",
      message: error.message,
    });
  }
});

router.get("/CheckBills/:id", [
  authenticateToken,
  checkTransactionOwner
], async (req, res) => {
  try {
    // ใช้ transaction ที่ได้จาก middleware
    const transaction = await req.transaction.populate("workspace");

    // แปลงข้อมูลให้มี image path
    const transformedTransaction = {
      _id: transaction._id,
      type: transaction.type,
      amount: transaction.amount,
      category: transaction.category,
      description: transaction.description,
      transaction_date: transaction.transaction_date,
      transaction_time: transaction.transaction_time,
      workspace: transaction.workspace ? {
        _id: transaction.workspace._id,
        name: transaction.workspace.name,
      } : null,
      image: {
        url: transaction.slip_image,
        path: transaction.slip_image ? new URL(transaction.slip_image).pathname : null,
      }
    };

    res.json({
      success: true,
      data: transformedTransaction
    });

  } catch (error) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
      error: error.message
    });
  }
});

// 📌 อัปเดต Transaction ตาม ID
router.put(
  "/CheckBills/:id",
  [
    authenticateToken,
    checkTransactionOwner,
    upload.single("slip_image")
  ],
  async (req, res) => {
    try {
      const transaction = req.transaction; // ใช้จาก middleware
      const { type, amount, category, description } = req.body;

      // If new image is uploaded
      if (req.file) {
        const uniqueFilename = `transactions/${transaction.workspace}/${Date.now()}-${req.file.originalname}`;
        const blobUrl = await uploadToAzureBlob(
          req.file.buffer,
          uniqueFilename,
          {
            userId: req.user.id,
            transactionId: transaction._id.toString(),
            type: "transaction-slip-update"
          }
        );
        transaction.slip_image = blobUrl;
      }

      // อัพเดทข้อมูล
      if (type) transaction.type = type;
      if (amount) transaction.amount = parseFloat(amount);
      if (category) transaction.category = category;
      if (description) transaction.description = description;

      await transaction.save();

      res.json({
        success: true,
        message: "Transaction updated successfully",
        data: transaction
      });
    } catch (error) {
      console.error("Error updating transaction:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update transaction",
        error: error.message
      });
    }
  }
);

// 📌 ลบ Transaction ตาม ID
router.delete(
  "/CheckBills/:id",
  [
    authenticateToken,
    checkTransactionOwner
  ],
  async (req, res) => {
    try {
      const transaction = req.transaction; // ใช้จาก middleware

      // ลบไฟล์จาก Azure Blob ก่อน
      if (transaction.slip_image?.includes('blob.core.windows.net')) {
        try {
          await deleteFromAzureBlob(transaction.slip_image);
        } catch (error) {
          console.error("Error deleting blob:", error);
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
        message: "Failed to delete transaction",
        error: error.message
      });
    }
  }
);

export default router;
