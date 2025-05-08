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

// Add getBlobPathFromUrl function
const getBlobPathFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    // Remove leading slash and container name from path
    const pathParts = urlObj.pathname.split('/');
    // Skip first empty string and container name
    const blobPath = pathParts.slice(2).join('/');
    return blobPath;
  } catch (error) {
    console.error('Error parsing blob URL:', error);
    throw new Error(`Invalid blob URL format: ${url}`);
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

    // ใช้ฟังก์ชัน getBlobPathFromUrl เพื่อแยก path
    const blobPath = getBlobPathFromUrl(blobUrl);
    console.log('Attempting to delete blob:', {
      url: blobUrl,
      extractedPath: blobPath,
      containerName: process.env.AZURE_STORAGE_CONTAINER_NAME
    });

    const blobClient = containerClient.getBlobClient(blobPath);
    const exists = await blobClient.exists();
    
    if (!exists) {
      console.log('Blob not found:', blobPath);
      return false;
    }

    const response = await blobClient.delete();
    console.log('Blob deleted successfully:', {
      path: blobPath,
      response: response._response.status
    });
    
    return true;
  } catch (error) {
    console.error('Azure Blob deletion error:', {
      error: error.message,
      blobUrl,
      stack: error.stack
    });
    throw error;
  }
};