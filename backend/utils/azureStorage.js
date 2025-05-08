import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

// เพิ่มฟังก์ชันนี้ตรงนี้
const getMimeType = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'jfif': 'image/jpeg',
      'webp': 'image/webp',
      'heic': 'image/heic'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  };

export const uploadToAzureBlob = async (fileBuffer, filename, metadata = {}) => {
    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(
        process.env.AZURE_STORAGE_CONNECTION_STRING
      );
  
      const containerClient = blobServiceClient.getContainerClient(
        process.env.AZURE_STORAGE_CONTAINER_NAME
      );
  
      const blobClient = containerClient.getBlockBlobClient(filename);
  
      // กำหนด Content-Type และ Content-Disposition
      const options = {
        blobHTTPHeaders: {
          blobContentType: metadata.contentType || getMimeType(filename),
          blobContentDisposition: 'inline',
          blobCacheControl: 'public, max-age=31536000'
        },
        metadata: {
          ...metadata,
          uploadDate: new Date().toISOString()
        }
      };
  
      // อัพโหลดด้วย options ที่กำหนด
      await blobClient.upload(fileBuffer, fileBuffer.length, options);
  
      return `${process.env.AZURE_BLOB_URL}/${filename}`;
    } catch (error) {
      console.error("Azure Blob upload error:", error);
      throw error;
    }
  };

export const getUserBlobs = async (userId) => {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );

    const containerClient = blobServiceClient.getContainerClient(
      process.env.AZURE_STORAGE_CONTAINER_NAME
    );

    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.name.startsWith(`${userId}-`)) {
        blobs.push({
          name: blob.name,
          url: `${process.env.AZURE_BLOB_URL}/${blob.name}`,
          metadata: blob.metadata
        });
      }
    }
    return blobs;
  } catch (error) {
    console.error("Error listing blobs:", error);
    throw error;
  }
  
};

export const deleteFromAzureBlob = async (blobUrl) => {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
    
    const containerClient = blobServiceClient.getContainerClient(
      process.env.AZURE_STORAGE_CONTAINER_NAME
    );

    // แก้ไขการแยก blobName จาก URL
    const url = new URL(blobUrl);
    const blobName = url.pathname.split('/').slice(2).join('/'); // ✅ ได้ path เต็ม
    
    const blobClient = containerClient.getBlobClient(blobName);
    
    await blobClient.delete();
    console.log(`Successfully deleted blob: ${blobName}`);
    return true;
  } catch (error) {
    console.error("Azure Blob deletion error:", {
      error: error.message,
      blobUrl
    });
    throw error;
  }
};