import Transaction from "../models/Transaction.js";

export const checkTransactionOwner = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    // เช็คว่าเป็นเจ้าของ transaction หรือไม่
    if (transaction.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: Only transaction owner can perform this action"
      });
    }

    // เก็บ transaction ไว้ใช้ใน route
    req.transaction = transaction;
    next();
  } catch (error) {
    console.error("Transaction authorization error:", error);
    res.status(500).json({
      success: false,
      message: "Error checking transaction authorization",
      error: error.message
    });
  }
};