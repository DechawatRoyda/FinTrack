export const generateBillBlobPath = (type, params) => {
  const timestamp = Date.now();
  const extension = params.originalname ? 
    `.${params.originalname.split('.').pop()}` : '.jpg';

  const paths = {
    // สำหรับบิลใหม่และอัพเดต path เดียวกัน
    'bill-create': `bills/${params.workspaceId}/main/${params.userId}/${timestamp}${extension}`,
    
    // สำหรับบิลที่มี ID แล้ว
    'bill-main': `bills/${params.workspaceId}/main/${params.userId}/${params.billId}${extension}`,
    
    // สำหรับการชำระเงิน
    'payment-submit': `bills/${params.billId}/payments/${params.userId}/${params.round || 1}/${timestamp}${extension}`,
  };

  if (!paths[type]) {
    console.error('Available path types:', Object.keys(paths));
    throw new Error(`Invalid bill blob path type: ${type}`);
  }

  return paths[type];
};