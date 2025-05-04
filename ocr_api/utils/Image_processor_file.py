from PIL import Image
import cv2
import numpy as np

def preprocess_image(image: Image.Image) -> Image.Image:
    """
    Preprocess image for better OCR results
    
    Args:
        image (PIL.Image): Input image
    
    Returns:
        PIL.Image: Processed image
    """
    # Convert PIL Image to cv2 format
    cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    
    # Convert to grayscale
    gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
    
    # Apply adaptive thresholding
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY, 11, 2
    )
    
    # Noise removal using median blur
    denoised = cv2.medianBlur(thresh, 3)
    
    # Convert back to PIL Image
    processed_image = Image.fromarray(denoised)
    
    return processed_image