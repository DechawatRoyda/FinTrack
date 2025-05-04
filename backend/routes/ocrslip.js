import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import util from "util";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import Transaction from "../models/Transaction.js"; // Uncomment this
import { authenticateToken, validateUserId } from "../middleware/auth.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// API สำหรับอัปโหลดหลายไฟล์และส่งไป FastAPI
router.post(
  "/upload",
  authenticateToken,
  validateUserId,
  upload.array("images", 10),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      // ประมวลผลแต่ละไฟล์
      const results = await Promise.all(
        req.files.map(async (file) => {
          try {
            // Upload to Azure Blob first
            const uniqueFilename = `ocr-${Date.now()}-${file.originalname}`;
            const blobUrl = await uploadToAzureBlob(file.buffer, uniqueFilename, {
              userId: req.userId,  // แก้ req.user.id เป็น req.userId
              type: "ocr-slip",
              contentType: file.mimetype
            });
            // สร้าง FormData สำหรับแต่ละไฟล์
            const formData = new FormData();
            formData.append("file", file.buffer, file.originalname);

            // ส่งไฟล์ไปที่ FastAPI OCR API
            const response = await axios.post(
              `${process.env.FASTAPI_URL}`,
              formData,
              {
                headers: {
                  ...formData.getHeaders(),
                },
              }
            );
            // Transform OCR data to Transaction format
            const ocrData = response.data.details;
            const amount = parseFloat(
              ocrData.amounts[0].replace(" บาท", "").replace(",", "")
            );

            // Parse date from Thai format
            const dateStr = ocrData.date[0];
            const [day, month, year] = dateStr
              .match(/(\d+).*?(\d+).*?(\d+)/)
              .slice(1);
            const transaction_date = new Date(
              parseInt(`25${year}`),
              parseInt(month) - 1,
              parseInt(day)
            );

            // Create Transaction in MongoDB
            const transactionData = {
              user: req.userId,
              workspace: null,
              type: "Expenses",
              amount: amount,
              category: "Transfer",
              description: `Transfer from ${ocrData.sender.bank} to ${ocrData.receiver.bank}`,
              slip_image: blobUrl,
              transaction_date: transaction_date,
              transaction_time: ocrData.time[0],
              transaction_id: ocrData.transaction_id,
              sender_info: {
                name: ocrData.sender.name,
                bank: ocrData.sender.bank,
              },
              receiver_info: {
                name: ocrData.receiver.name,
                bank: ocrData.receiver.bank,
              },
              reference: {
                type: "Bill",
                id: req.userId  // ใช้ userId แทน เพื่อให้มีค่าที่ valid
              },
            };

            // Save to MongoDB
            const transaction = new Transaction(transactionData);
            await transaction.save();

            return {
              filename: file.originalname,
              blobUrl: blobUrl, // Add blob URL to response
              success: true,
              data: transactionData, // Return transformed data instead of raw OCR data
            };
          } catch (error) {
            console.error("File processing error:", error);
            return {
              filename: file.originalname,
              success: false,
              error: error.message,
            };
          }
        })
      );

      res.json({
        totalFiles: req.files.length,
        results: results,
      });
    } catch (error) {
      console.error("OCR Error:", error);
      res.status(500).json({ error: "OCR processing failed" });
    }
  }
);

export default router;
