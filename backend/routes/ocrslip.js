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

// Cache Configuration
const CACHE_EXPIRY_MINUTES = 30;
const processedImages = new Map();

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
    // Support multiple date formats
    const patterns = [
      // DD/MM/YY
      {
        regex: /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2})/,
        parse: (m) => new Date(2000 + parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
      },
      // DD/MM/YYYY
      {
        regex: /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/,
        parse: (m) => new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
      }
    ];

    for (const pattern of patterns) {
      const match = dateStr.match(pattern.regex);
      if (match) {
        const parsed = pattern.parse(match);
        if (isNaN(parsed.getTime())) continue;
        return parsed;
      }
    }
    console.warn('No matching date pattern for:', dateStr);
    return new Date();
  } catch (error) {
    console.warn('Date parsing error:', error);
    return new Date();
  }
};

const clearImageCache = (userId, minutes = CACHE_EXPIRY_MINUTES) => {
  const now = Date.now();
  const expiryTime = minutes * 60 * 1000;

  for (const [key, value] of processedImages.entries()) {
    if (now - value.timestamp > expiryTime || key.startsWith(`${userId}_`)) {
      processedImages.delete(key);
    }
  }
};

// Multer Configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    console.log('Upload file:', { name: file.originalname, type: file.mimetype, ext });

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
      return cb(new Error(`Unsupported file type. Accepted: ${Object.keys(acceptedTypes).join(', ')}`));
    }

    if (acceptedTypes[ext].includes(file.mimetype)) {
      return cb(null, true);
    }

    cb(new Error(`Invalid MIME type: ${file.mimetype}`));
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 20
  }
});

// Create Transaction Data
const createTransactionData = (ocrData, userId, blobUrl) => {
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
      transaction_id: ocrData.details.transaction_id || 'N/A',
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
      },
      metadata: {
        raw_text: ocrData.raw,
        formatted_text: ocrData.text,
        processor_used: ocrData.processor_used,
        original_amount: ocrData.details.amounts?.[0],
        original_date: ocrData.details.date,
        confidence: ocrData.details.confidence
      }
    };
  } catch (error) {
    console.error('Transaction data creation error:', error);
    throw error;
  }
};

// Routes
router.post("/clear-cache", [authenticateToken, validateUserId], 
async (req, res) => {
  try {
    clearImageCache(req.userId);
    res.json({ 
      success: true, 
      message: "Cache cleared" 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.post("/check-duplicates", [authenticateToken, validateUserId], 
async (req, res) => {
  try {
    const { hashes } = req.body;
    if (!Array.isArray(hashes)) {
      return res.status(400).json({
        success: false,
        message: "hashes must be an array"
      });
    }

    const duplicates = hashes.filter(hash => 
      processedImages.has(`${req.userId}_${hash}`)
    );

    res.json({ success: true, duplicates });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/upload", [authenticateToken, validateUserId], 
async (req, res) => {
  try {
    // Clear old cache
    clearImageCache(req.userId);

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
      const key = `${req.userId}_${hash}`;

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

    // Process new files
    const results = await Promise.all(
      newFiles.map(async (file) => {
        try {
          // Upload to Azure
          const uniqueFilename = `ocr-${Date.now()}-${file.originalname}`;
          const blobUrl = await uploadToAzureBlob(file.buffer, uniqueFilename, {
            userId: req.userId,
            type: "ocr-slip",
            contentType: file.mimetype,
            fileHash: generateFileHash(file.buffer)
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
          const transactionData = createTransactionData(response.data, req.userId, blobUrl);
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
            error: error.message
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