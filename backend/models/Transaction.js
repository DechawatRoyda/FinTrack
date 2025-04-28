import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    default: null
  },
  type: {
    type: String,
    enum: ['Income', 'Expenses'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    default: 'Transfer' // default category for bank transfers
  },
  description: {
    type: String
  },
  slip_image: {
    type: String,
    required: true
  },
  reference: {
    type: {
      type: String,
      enum: ['Request', 'Bill'],
      required: true
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    }
  },
  // เพิ่มฟิลด์สำหรับเก็บข้อมูลจาก OCR
  ocr_data: {
    date: String,
    time: String,
    transaction_id: String,
    sender: {
      name: String,
      bank: String,
      raw_text: String
    },
    receiver: {
      name: String,
      bank: String,
      raw_text: String
    }
  }
}, {
  timestamps: true
});

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;