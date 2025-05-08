export const validateRequestItems = (req, res, next) => {
  let { amount, items } = req.body;

  // ถ้า items เป็น string (จาก form-data) ให้ parse ก่อน
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
      req.body.items = items; // อัปเดตกลับไปที่ req.body
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: "Items must be a valid JSON array"
      });
    }
  }

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
  // ถ้ามีไฟล์ หรือ มี requesterProof ใน body ให้ผ่าน
  if (req.file || req.body.requesterProof) {
    return next();
  }
  return res.status(400).json({
    success: false,
    message: "Requester proof is required"
  });
};


// เพิ่ม export default
export default {
  validateRequestItems,
  validateRequesterProof
};