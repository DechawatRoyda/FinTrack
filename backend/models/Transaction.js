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
    default: 'Transfer'
  },
  description: {
    type: String
  },
  slip_image: {
    type: String,
    required: true
  },
  transaction_date: {
    type: Date,
    required: true
  },
  transaction_time: String,
  transaction_id: String,
  sender_info: {
    name: String,
    bank: String
  },
  receiver_info: {
    name: String,
    bank: String
  },
  reference: {
    type: {
      type: String,
      enum: ['Request', 'Bill'],
      required: false
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: false  // เปลี่ยนเป็น false
    }
  }
}, {
  timestamps: true
});
// เพิ่ม export default
export default mongoose.model('Transaction', transactionSchema);