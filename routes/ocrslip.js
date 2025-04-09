import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import util from "util";
// import Transaction from "../models/Transaction.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// API สำหรับอัปโหลดหลายไฟล์และส่งไป FastAPI
router.post("/upload", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // ประมวลผลแต่ละไฟล์
    const results = await Promise.all(
      req.files.map(async (file) => {
        try {
          // สร้าง FormData สำหรับแต่ละไฟล์
          const formData = new FormData();
          formData.append("file", file.buffer, file.originalname);

          // ส่งไฟล์ไปที่ FastAPI OCR API
          const response = await axios.post(
            "http://localhost:8000/ocr",
            formData,
            {
              headers: {
                ...formData.getHeaders(),
              },
            }
          );

          // // // สร้าง Transaction จากข้อมูล OCR
          // const ocrData = response.data.details;
          // const amount = parseFloat(
          //   ocrData.amounts[0].replace(" บาท", "").replace(",", "")
          // );

          // const transactionData = {
          //   user: null, // จะอัพเดตเมื่อมีการ login
          //   workspace: null,
          //   type: "Transfer", // จะอัพเดตตามเงื่อนไขที่กำหนดเมื่อมี user
          //   amount: amount,
          //   category: "Transfer",
          //   description: `Transfer from ${ocrData.sender.bank} to ${ocrData.receiver.bank}`,
          //   slip_image: file.originalname, // ควรจะมีการจัดการไฟล์รูปภาพที่เหมาะสม
          //   ocr_data: {
          //     date: ocrData.date[0],
          //     time: ocrData.time[0],
          //     transaction_id: ocrData.transaction_id,
          //     sender: ocrData.sender,
          //     receiver: ocrData.receiver,
          //   },
          // };

          // const transaction = new Transaction(transactionData);
          // await transaction.save();

          return {
            filename: file.originalname,
            success: true,
            data: response.data,
            // saved_transaction: transaction
          };
        } catch (error) {
          return {
            filename: file.originalname,
            success: false,
            error: error.message,
          };
        }
      })
    );

    // console.log(
    //   "OCR Response for multiple files:",
    //   JSON.stringify(results, null, 2)
    // );


    console.log(
      "OCR Response for multiple files:",
      util.inspect(results, { showHidden: false, depth: null, colors: true })
    );
    res.json({
      totalFiles: req.files.length,
      results: results,
    });
  } catch (error) {
    console.error("OCR Error:", error);
    res.status(500).json({ error: "OCR processing failed" });
  }
});

// API สำหรับอัพเดต Transaction เมื่อ user login
// router.put("/update-transaction/:id", async (req, res) => {
//   try {
//     const { userId } = req.body;

//     // หา transaction และ user พร้อมกัน
//     const [transaction, user] = await Promise.all([
//       Transaction.findById(req.params.id),
//       User.findById(userId)
//     ]);

//     if (!transaction) {
//       return res.status(404).json({ error: "Transaction not found" });
//     }

//     if (!user) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     // เปรียบเทียบชื่อจริงของ user กับชื่อใน slip
//     if (user.name === transaction.ocr_data.sender.name) {
//       transaction.type = 'Expenses';
//     } else if (user.name === transaction.ocr_data.receiver.name) {
//       transaction.type = 'Income';
//     }

//     transaction.user = userId;
//     await transaction.save();

//     res.json({
//       message: "Transaction updated successfully",
//       transaction,
//       type: transaction.type
//     });

//   } catch (error) {
//     console.error("Error updating transaction:", error);
//     res.status(500).json({ error: "Error updating transaction" });
//   }
// });

export default router;
