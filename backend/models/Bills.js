import mongoose from "mongoose";

const billSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true,
  },
  creator: [
    {
      _id: false, // ปิดการสร้าง _id อัตโนมัติ
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      numberAccount: {
        type: String,
        required: true,
      }
    },
  ],
  items: [
    {
      description: String, // รายละเอียด เช่น ข้าว, น้ำ, ขนม
      amount: {
        type: Number,
        required: true,
      },
      sharedWith: [
        {
          _id: false, // ปิดการสร้าง _id อัตโนมัติ
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          name: String, // ชื่อผู้ใช้ที่แชร์
          status: {
            type: String,
            enum: ["pending","awaiting_confirmation","paid"],
            default: "pending"
          },
          eSlip: {
            type: String, // URL ของสลิปที่อัปโหลด
          },
          shareAmount: Number, // จำนวนเงินที่แต่ละคนต้องจ่าย
        },
      ],
    },
  ],
  note: {
    type: String,
    default: "", // หมายเหตุเพิ่มเติม
  },
  status: {
    type: String,
    enum: ["pending", "paid","canceled"], // pending = ยังไม่ได้จ่าย, paid = จ่ายแล้ว
    default: "pending",
  },
  eSlip: {
    type: String, // URL ของสลิปที่อัปโหลด (สำหรับผู้สร้างบิล)
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Bill = mongoose.model("Bill", billSchema);

export default Bill;
