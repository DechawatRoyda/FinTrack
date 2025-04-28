export const validateRequestItems = (req, res, next) => {
  const { amount, items } = req.body;

  // ตรวจสอบเฉพาะเมื่อมีการส่งค่ามา
  if (amount !== undefined && amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Amount must be greater than 0"
    });
  }

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required"
      });
    }

    const invalidItem = items.find(
      item => !item.description || !item.price || !item.quantity
    );
    if (invalidItem) {
      return res.status(400).json({
        success: false,
        message: "Each item must have description, price and quantity"
      });
    }
  }

  next();
};

// เพิ่ม middleware ใหม่
export const validateRequesterProof = (req, res, next) => {
  const { requesterProof } = req.body;
  
  if (!requesterProof) {
    return res.status(400).json({
      success: false,
      message: "Requester proof is required"
    });
  }
  
  next();
};


// เพิ่ม export default
export default {
  validateRequestItems,
  validateRequesterProof
};