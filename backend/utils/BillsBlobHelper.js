export const generateBillBlobPath = (type, params) => {
  const timestamp = Date.now();
  const extension = params.originalname ? 
    `.${params.originalname.split('.').pop()}` : '.jpg';

  const paths = {
    // สำหรับบิลหลัก (ใช้ path เดียวกันสำหรับสร้างและอัพเดต)
    'bill-main': `bills/${params.workspaceId}/main/${params.userId}/${params.billId}${extension}`,
    
    // สำหรับการชำระเงินแต่ละรอบ
    'payment-submit': `bills/${params.billId}/payments/${params.userId}/${params.round || 1}/${timestamp}${extension}`,
  };

  if (!paths[type]) {
    throw new Error(`Invalid bill blob path type: ${type}`);
  }

  return paths[type];
};