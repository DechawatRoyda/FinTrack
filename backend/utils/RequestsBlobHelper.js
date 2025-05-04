export const generateRequestBlobPath = (type, params) => {
    const timestamp = Date.now();
    const extension = params.originalname ? 
      `.${params.originalname.split('.').pop()}` : '.jpg';
  
    const paths = {
      // สร้างคำขอใหม่
      'request-create': `requests/${params.workspaceId}/requester/${params.userId}/${timestamp}${extension}`,
      
      // แก้ไขคำขอ
      'request-update': `requests/${params.requestId}/updates/${params.userId}/${timestamp}${extension}`,
      
      // หลักฐานการอนุมัติโดย owner
      'owner-proof': `requests/${params.requestId}/owner/${params.userId}/${timestamp}${extension}`,
    };
  
    if (!paths[type]) {
      throw new Error(`Invalid request blob path type: ${type}`);
    }
  
    return paths[type];
  };