import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import crypto from "crypto";
import path from "path";
import { uploadToAzureBlob } from "../utils/azureStorage.js";
import Transaction from "../models/Transaction.js";
import { authenticateToken, validateUserId } from "../middleware/auth.js";

const router = express.Router();

// Helper Functions
const generateFileHash = (buffer) => {
  return crypto.createHash("md5").update(buffer).digest("hex");
};

const parseAmount = (amountStr) => {
  if (!amountStr) return 0;
  const cleanAmount = amountStr.replace(/[^\d.-]/g, '');
  return parseFloat(cleanAmount) || 0;
};

const parseDate = (dateStr) => {
  if (!dateStr) return new Date();
  try {
    // Support DD/MM/YY and DD/MM/YYYY formats
    const match = dateStr.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
    if (!match) {
      console.warn('Invalid date format:', dateStr);
      return new Date();
    }

    let [_, day, month, year] = match;
    if (year.length === 2) {
      year = `25${year}`; // Assumes years 2500-2599 in Thai calendar
    }
    
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return isNaN(date.getTime()) ? new Date() : date;

  } catch (error) {
    console.warn('Date parsing error:', error);
    return new Date();
  }
};

// Check for duplicates in DB using transaction_id
const checkDuplicateInDB = async (userId, hash) => {
  try {
    const existingTransaction = await Transaction.findOne({
      user: userId,
      transaction_id: hash // Using hash as transaction_id
    });

    if (existingTransaction) {
      console.log('Duplicate found:', {
        filename: existingTransaction.description,
        uploadDate: existingTransaction.createdAt
      });
    }

    return !!existingTransaction;
  } catch (error) {
    console.error('DB check error:', error);
    return false;
  }
};

// Create transaction data
const createTransactionData = (ocrData, userId, blobUrl, fileHash) => {
  try {
    return {
      user: userId,
      workspace: null,
      type: "Expenses",
      amount: parseAmount(ocrData.details.amounts?.[0]),
      category: "Transfer",
      description: `Transfer from ${ocrData.details.sender?.bank || 'Unknown'} to ${ocrData.details.receiver?.bank || 'Unknown'}`,
      slip_image: blobUrl,
      transaction_date: parseDate(ocrData.details.date),
      transaction_time: ocrData.details.time?.[0] || new Date().toTimeString().split(' ')[0],
      transaction_id: fileHash, // Using hash as transaction_id
      sender_info: {
        name: ocrData.details.sender?.name || 'Unknown',
        bank: ocrData.details.sender?.bank || 'Unknown'
      },
      receiver_info: {
        name: ocrData.details.receiver?.name || 'Unknown',
        bank: ocrData.details.receiver?.bank || 'Unknown'
      },
      reference: {
        type: "Bill",
        id: userId
      }
    };
  } catch (error) {
    console.error('Transaction data creation error:', error);
    throw error;
  }
};

// Multer Configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    console.log('Upload file:', { 
      name: file.originalname, 
      type: file.mimetype, 
      ext 
    });

    const acceptedTypes = {
      '.jpg': ['image/jpeg', 'image/jpg'],
      '.jpeg': ['image/jpeg', 'image/jpg'],
      '.png': ['image/png'],
      '.jfif': ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/jfif', 'application/octet-stream'],
      '.gif': ['image/gif'],
      '.bmp': ['image/bmp'],
      '.webp': ['image/webp'],
      '.heic': ['image/heic'],
      '.heif': ['image/heif']
    };

    if (!acceptedTypes[ext]) {
      return cb(new Error(
        `Unsupported file type. Accepted: ${Object.keys(acceptedTypes).join(', ')}`
      ));
    }

    if (acceptedTypes[ext].includes(file.mimetype)) {
      return cb(null, true);
    }

    cb(new Error(`Invalid MIME type: ${file.mimetype}`));
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 20
  }
});

// Upload Route
router.post("/upload", [authenticateToken, validateUserId], 
async (req, res) => {
  try {
    // Handle file upload
    await new Promise((resolve, reject) => {
      upload.array("images")(req, res, (err) => {
        if (err) reject(err);
        resolve();
      });
    });

    if (!req.files?.length) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded"
      });
    }

    // Process files
    const newFiles = [];
    const duplicates = [];
    
    // Check for duplicates
    for (const file of req.files) {
      const hash = generateFileHash(file.buffer);
      const isDuplicate = await checkDuplicateInDB(req.userId, hash);

      if (!isDuplicate) {
        newFiles.push({
          file,
          hash
        });
      } else {
        duplicates.push(file.originalname);
      }
    }

    // Process new files
    const results = await Promise.all(
      newFiles.map(async ({file, hash}) => {
        try {
          const uniqueFilename = `ocr-${Date.now()}-${file.originalname}`;
          
          // Upload to Azure
          const blobUrl = await uploadToAzureBlob(file.buffer, uniqueFilename, {
            userId: req.userId,
            type: "ocr-slip",
            contentType: file.mimetype,
            fileHash: hash
          });

          // Send to OCR Service
          const formData = new FormData();
          formData.append("file", file.buffer, file.originalname);

          const response = await axios.post(
            process.env.FASTAPI_URL,
            formData,
            {
              headers: formData.getHeaders(),
              timeout: 30000
            }
          );

          // Log OCR response
          console.log('OCR Response:', {
            filename: file.originalname,
            raw: response.data.raw?.substring(0, 100),
            text: response.data.text?.substring(0, 100),
            details: response.data.details
          });

          if (!response.data.details) {
            return {
              filename: file.originalname,
              success: false,
              error: "OCR processing incomplete",
              raw_text: response.data.raw,
              formatted_text: response.data.text
            };
          }

          // Create and save transaction
          const transactionData = createTransactionData(
            response.data, 
            req.userId, 
            blobUrl,
            hash
          );

          const transaction = new Transaction(transactionData);
          await transaction.save();

          return {
            filename: file.originalname,
            blobUrl,
            success: true,
            data: {
              ...transactionData,
              original_ocr: {
                raw: response.data.raw,
                text: response.data.text
              }
            }
          };

        } catch (error) {
          console.error('File processing error:', {
            file: file.originalname,
            error: error.message,
            stack: error.stack
          });
          
          return {
            filename: file.originalname,
            success: false,
            error: error.message,
            raw_text: error.response?.data?.raw || error.response?.data?.text
          };
        }
      })
    );

    res.json({
      success: true,
      totalFiles: newFiles.length,
      duplicates: duplicates.length > 0 ? duplicates : undefined,
      results
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message
    });
  }
});

export default router;