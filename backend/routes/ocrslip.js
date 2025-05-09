import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import util from "util";
import crypto from "crypto";
import path from "path";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import Transaction from "../models/Transaction.js";
import { authenticateToken, validateUserId } from "../middleware/auth.js";

const router = express.Router();

// สร้างฟังก์ชันสำหรับสร้าง hash จากไฟล์
const generateFileHash = (buffer) => {
  return crypto.createHash('md5').update(buffer).digest('hex');
};

// Cache สำหรับเก็บ hash ของรูปที่เคยอัพโหลด
const processedImages = new Map();

// กำหนดการตั้งค่า multer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // ตรวจสอบ file type
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpg, jpeg, png) are allowed'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 20 // จำนวนไฟล์สูงสุด
  }
});

// Route สำหรับเช็คไฟล์ซ้ำ
router.post("/check-duplicates", 
  authenticateToken, 
  validateUserId, 
  async (req, res) => {
    try {
      const { hashes } = req.body;
      const userId = req.userId;

      if (!Array.isArray(hashes)) {
        return res.status(400).json({
          success: false,
          message: "hashes must be an array"
        });
      }

      const duplicates = hashes.filter(hash => 
        processedImages.has(`${userId}_${hash}`)
      );

      res.json({
        success: true,
        duplicates: duplicates
      });

    } catch (error) {
      console.error("Check duplicates error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check duplicates",
        error: error.message
      });
    }
});

// Route หลักสำหรับ OCR
router.post(
  "/upload",
  authenticateToken,
  validateUserId,
  async (req, res) => {
    try {
      // ใช้ Promise เพื่อจัดการ upload middleware
      await new Promise((resolve, reject) => {
        upload.array('images')(req, res, (err) => {
          if (err instanceof multer.MulterError) {
            reject(new Error(`Upload error: ${err.message}`));
          } else if (err) {
            reject(err);
          }
          resolve();
        });
      });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded"
        });
      }

      // กรองไฟล์ซ้ำ
      const newFiles = [];
      const duplicates = [];
      
      for (const file of req.files) {
        const hash = generateFileHash(file.buffer);
        const userId = req.userId;
        const key = `${userId}_${hash}`;

        if (!processedImages.has(key)) {
          processedImages.set(key, {
            timestamp: Date.now(),
            filename: file.originalname
          });
          newFiles.push(file);
        } else {
          duplicates.push(file.originalname);
        }
      }

      // ประมวลผลเฉพาะไฟล์ใหม่
      const results = await Promise.all(
        newFiles.map(async (file) => {
          try {
            // Upload to Azure Blob
            const uniqueFilename = `ocr-${Date.now()}-${file.originalname}`;
            const blobUrl = await uploadToAzureBlob(file.buffer, uniqueFilename, {
              userId: req.userId,
              type: "ocr-slip",
              contentType: file.mimetype,
              fileHash: generateFileHash(file.buffer)
            });

            // ส่งไปประมวลผล OCR ที่ FastAPI
            const formData = new FormData();
            formData.append("file", file.buffer, file.originalname);

            const response = await axios.post(
              `${process.env.FASTAPI_URL}`,
              formData,
              {
                headers: {
                  ...formData.getHeaders(),
                },
              }
            );

            // แปลงข้อมูล OCR เป็น Transaction
            const ocrData = response.data.details;
            const amount = parseFloat(
              ocrData.amounts[0].replace(" บาท", "").replace(",", "")
            );

            // แปลงวันที่จากรูปแบบไทย
            const dateStr = ocrData.date[0];
            const [day, month, year] = dateStr
              .match(/(\d+).*?(\d+).*?(\d+)/)
              .slice(1);
            const transaction_date = new Date(
              parseInt(`25${year}`),
              parseInt(month) - 1,
              parseInt(day)
            );

            // สร้าง Transaction
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
                type: "OCR",
                id: req.userId
              },
            };

            // บันทึกลง MongoDB
            const transaction = new Transaction(transactionData);
            await transaction.save();

            return {
              filename: file.originalname,
              blobUrl: blobUrl,
              success: true,
              data: transactionData
            };

          } catch (error) {
            console.error("File processing error:", error);
            return {
              filename: file.originalname,
              success: false,
              error: error.message
            };
          }
        })
      );

      res.json({
        success: true,
        totalFiles: newFiles.length,
        duplicates: duplicates.length > 0 ? duplicates : undefined,
        results: results
      });

    } catch (error) {
      console.error("OCR Upload Error:", error);
      res.status(500).json({
        success: false,
        message: "OCR processing failed",
        error: error.message
      });
    }
  }
);

export default router;

// ใช้กับ Flutter นะจ้ะ
// class ImageUploader {
//   Future<List<File>> filterDuplicateImages(List<File> images) async {
//     // คำนวณ hash ของไฟล์ทั้งหมด
//     final hashes = await Future.wait(
//       images.map((file) => computeFileHash(file))
//     );

//     // เช็คกับเซิร์ฟเวอร์ว่ามีไฟล์ซ้ำไหม
//     final response = await dio.post(
//       '/api/ocr/check-duplicates',
//       data: {'hashes': hashes}
//     );

//     final duplicateHashes = response.data['duplicates'] as List;
    
//     // กรองเอาเฉพาะไฟล์ที่ไม่ซ้ำ
//     final newImages = images.where((file) {
//       final hash = computeFileHash(file);
//       return !duplicateHashes.contains(hash);
//     }).toList();

//     return newImages;
//   }

//   Future<void> uploadImages(List<File> images) async {
//     // กรองไฟล์ซ้ำก่อน
//     final uniqueImages = await filterDuplicateImages(images);
    
//     if (uniqueImages.isEmpty) {
//       print('No new images to upload');
//       return;
//     }

//     // อัพโหลดเฉพาะไฟล์ที่ไม่ซ้ำ
//     await dio.post('/api/ocr/upload', 
//       data: FormData.fromMap({
//         'images': uniqueImages.map((f) => 
//           MultipartFile.fromFileSync(f.path)
//         ).toList()
//       })
//     );
//   }
// }