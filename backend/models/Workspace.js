import mongoose from "mongoose";

const workspaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // เชื่อมโยงไปยังโมเดล User
    required: true, // ทำให้ต้องมีข้อมูลเจ้าของ
  },
  type: {
    type: String,
    required: true,
    enum: {
      values: ["expense", "project"],
      message: "Type must be either expense or project",
    },
    default: "expense",
  },
  budget: {
    type: Number,
  },
  members: [
    {
      _id: false, // ปิดการสร้าง _id อัตโนมัติ
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // อ้างอิงไปยังโมเดล User
        required: true,
      },
      join_at: {
        type: Date,
        default: Date.now, // วันที่เข้าร่วม
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Workspace = mongoose.model("Workspace", workspaceSchema);

export default Workspace;
