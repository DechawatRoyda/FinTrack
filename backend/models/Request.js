import mongoose from "mongoose";

const requestSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true,
  },
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  items: [
    {
      description: String,
      price: Number,
      quantity: Number,
    },
  ],
  // สลิปของ requester
  requesterProof: {
    type: String,
    required: function() {
      return this.status === 'pending' || this.status === 'completed';
    }
  },
  // สลิปของ owner
  ownerProof: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "completed"], // เพิ่ม completed สำหรับเมื่อ owner แนบสลิป
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  }
});

const Request = mongoose.model("Request", requestSchema);

export default Request;
