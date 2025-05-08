// ตรวจสอบข้อมูลการสร้างบิล
export const validateBillCreation = (req, res, next) => {
  const { items, note } = req.body;
  const workspace = req.workspaceId; // ใช้จาก middleware

  // 1. ตรวจสอบ workspace
  if (!workspace) {
    return res.status(400).json({
      success: false,
      message: "Workspace ID is required"
    });
  }

  // 2. ตรวจสอบ items array
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Items array is required"
    });
  }

  // 3. ตรวจสอบรายละเอียดของ item แรก
  const item = items[0];
  if (!item.description || !item.amount || item.amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Each item must have description and valid amount"
    });
  }

  // 4. ตรวจสอบ sharedWith
  if (!item.sharedWith || !Array.isArray(item.sharedWith) || item.sharedWith.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Must share with at least one user"
    });
  }

  // 5. ตรวจสอบข้อมูลการแชร์
  const totalShared = item.sharedWith.reduce((sum, share) => {
    if (!share.user || !share.shareAmount || share.shareAmount <= 0) {
      return -1; // Invalid share data
    }
    return sum + share.shareAmount;
  }, 0);

  if (totalShared === -1) {
    return res.status(400).json({
      success: false,
      message: "Invalid share data. Each share must have user and valid shareAmount"
    });
  }

  if (totalShared !== item.amount) {
    return res.status(400).json({
      success: false,
      message: "Total shared amount must equal item amount"
    });
  }

  next();
};

// ตรวจสอบข้อมูลการชำระเงิน
export const validatePayment = (req, res, next) => {
  // เช็คว่ามี itemId และไฟล์แนบ
  const itemId = req.body.itemId;

  // เช็คว่ามีไฟล์แนบหรือไม่ (form-data)
  const hasFile = !!req.file;

  if (!itemId) {
    return res.status(400).json({
      success: false,
      message: "Item ID is required",
    });
  }

  // กรณี form-data ต้องมีไฟล์แนบ
  if (!hasFile) {
    return res.status(400).json({
      success: false,
      message: "Payment evidence (eSlip) is required",
    });
  }

  next();
};

export const validateConfirmPayment = async (req, res, next) => {
  try {
    // Log ข้อมูลที่ได้รับ
    console.log('Validating confirm payment:', {
      body: req.body,
      contentType: req.headers['content-type']
    });

    const { itemId, userIdToConfirm } = req.body;

    if (!itemId || !userIdToConfirm) {
      return res.status(400).json({
        success: false,
        message: "itemId and userIdToConfirm are required",
        debug: {
          receivedBody: req.body,
          contentType: req.headers['content-type']
        }
      });
    }

    next();
  } catch (err) {
    console.error('Validation error:', err);
    return res.status(400).json({
      success: false,
      message: "Invalid request data",
      error: err.message
    });
  }
};