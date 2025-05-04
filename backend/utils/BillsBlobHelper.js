export const generateBillBlobPath = (type, params) => {
    const timestamp = Date.now();
    const extension = params.originalname ? 
      `.${params.originalname.split('.').pop()}` : '.jpg';
  
    const paths = {
      // สร้างบิลใหม่
      'bill-create': `bills/${params.workspaceId}/main/${params.userId}/${timestamp}${extension}`,
      
      // อัพเดตบิล
      'bill-update': `bills/${params.billId}/updates/${params.userId}/${timestamp}${extension}`,
      
      // ส่งหลักฐานการชำระเงิน
      'payment-submit': `bills/${params.billId}/payments/${params.userId}/${params.itemId}/${timestamp}${extension}`,
      
      // ยืนยันการชำระเงิน
      'payment-confirm': `bills/${params.billId}/confirmations/${params.itemId}/${params.userId}/${timestamp}${extension}`
    };
  
    if (!paths[type]) {
      throw new Error(`Invalid bill blob path type: ${type}`);
    }
  
    return paths[type];
  };