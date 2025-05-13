export const generateRequestBlobPath = (type, params) => {
  const timestamp = params.timestamp || Date.now();
  const extension = params.originalname
    ? `.${params.originalname.split(".").pop()}`
    : ".jpg";

  const paths = {
    "request-create": `requests/${params.workspaceId}/requester/${params.userId}/${timestamp}${extension}`,
    // ใช้ path เดียวสำหรับ requester proof แต่เพิ่ม timestamp
    "requester-proof": `requests/${params.workspaceId}/requester/${params.userId}/${params.requestId}_${timestamp}${extension}`,
    
    // path สำหรับ owner proof
    "owner-proof": `requests/${params.requestId}/owner/${params.userId}/${timestamp}${extension}`,
  };

  if (!paths[type]) {
    throw new Error(`Invalid request blob path type: ${type}`);
  }

  return paths[type];
};

export const getBlobPathFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    // แยกส่วน path และตัด container name (slip) ออก
    const fullPath = urlObj.pathname;
    const pathWithoutContainer = fullPath.split('/').slice(2).join('/');
    console.log('Extracted blob path:', pathWithoutContainer); // เพิ่ม logging
    return pathWithoutContainer;
  } catch (error) {
    console.error('Error parsing blob URL:', error);
    throw new Error(`Invalid blob URL format: ${url}`);
  }
};
