import mongoose from "mongoose";

const billSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true,
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  payer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  items: [
    {
      description: String, // รายละเอียด เช่น ข้าว, น้ำ, ขนม
      amount: {
        type: Number,
        required: true,
      },
      sharedWith: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          shareAmount: Number, // จำนวนเงินที่แต่ละคนต้องจ่าย
        },
      ],
    },
  ],
  status: {
    type: String,
    enum: ["pending", "paid"], // pending = ยังไม่ได้จ่าย, paid = จ่ายแล้ว
    default: "pending",
  },
  eSlip: {
    type: String, // URL ของสลิปที่อัปโหลด
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Bill = mongoose.model("Bill", billSchema);

export default Bill;
