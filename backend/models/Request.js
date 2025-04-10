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
  proof: [
    {
      type: String, // URL ของ E-slip หรือใบเสร็จ
      required: true,
    },
  ],
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const Request = mongoose.model("Request", requestSchema);

export default Request;
