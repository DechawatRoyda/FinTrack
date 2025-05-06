import mongoose from "mongoose";

const billSchema = new mongoose.Schema({
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workspace",
    required: true,
  },

  // ข้อมูลผู้สร้างบิล
  creator: [{
    _id: false,
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
  }],

  // ประเภทการจ่ายเงิน
  paymentType: {
    type: String,
    enum: ['normal', 'round'],
    default: 'normal'
  },

  // ข้อมูลการจ่ายแบบรอบ (ใช้เมื่อ paymentType เป็น 'round')
  roundDetails: {
    dueDate: Date,         // วันครบกำหนด
    totalPeriod: Number,   // จำนวนงวดทั้งหมด
    currentRound: {        // งวดปัจจุบัน
      type: Number,
      default: 1
    }
  },

  // รายการในบิล
  items: [{
    description: String,
    amount: {
      type: Number,
      required: true,
    },
    sharedWith: [{
      _id: false,
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      name: String,
      status: {
        type: String,
        enum: ["pending", "awaiting_confirmation", "paid"],
        default: "pending"
      },
      eSlip: String,
      shareAmount: Number,
      // ข้อมูลการจ่ายรายงวด (สำหรับ paymentType: 'round')
      roundPayments: [{
        round: Number,
        amount: Number,
        status: {
          type: String,
          enum: ["pending", "paid"],
          default: "pending"
        },
        paidDate: Date,
        eSlip: String
      }]
    }]
  }],

  note: {
    type: String,
    default: ""
  },

  status: {
    type: String,
    enum: ["pending", "paid", "canceled"],
    default: "pending",
  },

  eSlip: {
    type: String,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  }
});

// คำนวณยอดค้างชำระอัตโนมัติสำหรับการจ่ายแบบรอบ
billSchema.methods.calculateAccumulatedAmount = function(userId) {
  if (this.paymentType !== 'round') return 0;

  let total = 0;
  this.items.forEach(item => {
    const userShare = item.sharedWith.find(share => 
      share.user.toString() === userId.toString()
    );
    if (userShare) {
      userShare.roundPayments.forEach(payment => {
        if (payment.status === 'pending') {
          total += payment.amount;
        }
      });
    }
  });
  return total;
};

const Bill = mongoose.model("Bill", billSchema);

export default Bill;