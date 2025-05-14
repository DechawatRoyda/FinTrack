import os  # Add this import
from fastapi import FastAPI, File, UploadFile
import pytesseract
from PIL import Image
from io import BytesIO
import re
import cv2
import numpy as np
from processors.ttb import TTBProcessor
from processors.scb import SCBProcessor
from processors.gsb import GSBProcessor  # Add this import
from processors.ktb import KTBProcessor  # Add this import
from processors.kbtg import KBTGProcessor  # Add KBTG import
from processors.bbl import BBLProcessor  # Add this import


# Import other bank processors...

app = FastAPI()

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=[""],
#     allow_headers=[""],
# )
# Get Tesseract configuration from environment or use default Linux paths
tesseract_path = os.getenv('TESSERACT_PATH', '/usr/bin/tesseract')
tessdata_prefix = os.getenv('TESSDATA_PREFIX', '/usr/share/tesseract-ocr/tessdata')
tessdata_lang = os.getenv('TESSDATA_LANG', 'Thai')

print(f"Using Tesseract path: {tesseract_path}")
print(f"Using tessdata prefix: {tessdata_prefix}")
print(f"Using language model: {tessdata_lang}")

def preprocess_image(image, processor=None):
    """
    ปรับปรุงคุณภาพของรูปภาพก่อนทำ OCR โดยใช้ processor เฉพาะธนาคารถ้ามี

    Args:
        image: PIL Image object
        processor: BankProcessor object (optional)

    Returns:
        PIL Image object ที่ผ่านการปรับปรุงแล้ว
    """
    if processor and hasattr(processor, "preprocess_image"):
        return processor.preprocess_image(image)

    # Default preprocessing if no specific processor or processor doesn't have custom preprocessing
    img_np = np.array(image)

    # แปลงเป็นภาพ grayscale
    gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)

    # เพิ่มความคมชัดด้วย CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # ลดสัญญาณรบกวนด้วย bilateral filter (รักษาขอบของตัวอักษร)
    denoised = cv2.bilateralFilter(enhanced, 9, 75, 75)

    # Thresholding เพื่อแยกพื้นหลังและตัวอักษร
    _, binary = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # สร้าง kernel สำหรับ morphological operations
    kernel = np.ones((1, 1), np.uint8)

    # ใช้ morphology เพื่อปรับปรุงตัวอักษร
    processed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    return Image.fromarray(processed)


def merge_thai_chars(text: str) -> str:
    """รวมตัวอักษรไทยที่แยกกันและจัดการช่องว่างให้เหมาะสม"""
    # รวมตัวอักษรไทยที่อยู่ติดกัน
    thai_pattern = r"([ก-๛])\s+([ก-๛])"

    # ทำซ้ำจนกว่าจะไม่มีการเปลี่ยนแปลง
    prev_text = ""
    while prev_text != text:
        prev_text = text
        text = re.sub(thai_pattern, r"\1\2", text)

    # จัดการคำที่ควรมีช่องว่าง
    spacing_patterns = [
        (r"(จำนวนเงิน|รหัสอ้างอิง|ค่าธรรมเนียม|ธนาคาร)", r" \1 "),  # เพิ่มช่องว่างรอบคำสำคัญ
        (r"([0-9])\s*(\.\s*[0-9])", r"\1\2"),  # รวมตัวเลขทศนิยม
        (r"([0-9])\s+(?=บาท)", r"\1 "),  # จัดช่องว่างก่อนคำว่า "บาท"
        (r"\s*:\s*", r": "),  # จัดช่องว่างหลังเครื่องหมาย :
        (r"\s*\(\s*", r" ("),  # จัดช่องว่างรอบวงเล็บ
        (r"\s*\)\s*", r") "),
    ]

    for pattern, replacement in spacing_patterns:
        text = re.sub(pattern, replacement, text)

    # ลบช่องว่างซ้ำและช่องว่างต้น-ท้าย
    text = re.sub(r"\s+", " ", text).strip()

    return text


def clean_ocr_text(text: str) -> str:
    """ฟังก์ชันทำความสะอาดข้อความ OCR"""
    # จัดการการขึ้นบรรทัดใหม่
    text = re.sub(r"\n+", " ", text)
    # รวมตัวอักษรไทยและจัดช่องว่าง
    text = merge_thai_chars(text)
    return text


# Initialize bank processors
PROCESSORS = [
    TTBProcessor(),
    # Add other bank processors...
]


@app.post("/ocr")
async def process_ocr(file: UploadFile = File(...)):
    try:
        print(f"Processing file: {file.filename}")
        print(f"Tessdata prefix: {os.environ['TESSDATA_PREFIX']}")
        image_bytes = await file.read()
        image = Image.open(BytesIO(image_bytes))
        image.save("debug_original.png")

        # Initialize processors with KBTG first
        processors = [KBTGProcessor(), BBLProcessor(), SCBProcessor(), TTBProcessor(), GSBProcessor(), KTBProcessor()]
        
        # Do initial OCR
        processed_image = preprocess_image(image)
        processed_image.save("debug_processed.png")
        text = pytesseract.image_to_string(processed_image, lang="eng+Thai")
        formatted_data = clean_ocr_text(text)
        
        print(f"Initial OCR text: {formatted_data[:100]}...")

        for processor in processors:
            if processor.can_process(formatted_data):
                # If it's KBTG or BBL processor, let it do its own preprocessing and OCR
                if isinstance(processor, (KBTGProcessor, BBLProcessor)):
                    special_processed = processor.preprocess_image(image)
                    special_text = pytesseract.image_to_string(special_processed, 
                                                                 lang="eng+Thai")
                    formatted_data = processor.clean_text(special_text)
                    extracted_data = processor.extract_details(formatted_data)
                    special_processed.save("debug_special.png")
                else:
                    # Do the usual processing for other processors
                    extracted_data = processor.extract_details(formatted_data)
                    if (not extracted_data["amounts"] or not extracted_data["transaction_id"]) and \
                       hasattr(processor, 'preprocess_image'):
                        special_processed = processor.preprocess_image(image)
                        special_text = pytesseract.image_to_string(special_processed, 
                                                                 lang="eng+Thai")
                        special_formatted = clean_ocr_text(special_text)
                        extracted_data = processor.extract_details(special_formatted)
                        text = special_text  # ใช้ text จาก special processing
                        special_processed.save("debug_special.png")

                return {
                    "raw": text,
                    "text": formatted_data,
                    "details": extracted_data,
                    "processor_used": processor.__class__.__name__
                }

        return {
            "raw": text,
            "text": formatted_data,
            "details": None,
            "processor_used": None,
        }

    except Exception as e:
        return {
            "error": f"OCR processing failed: {str(e)}",
            "text": formatted_data if "formatted_data" in locals() else "",
            "processor_used": None,
        }
#  .\venv\Scripts\Activate      uvicorn main:app --reload      

        # # Test with each processor
        # for processor in processors:
        #     if processor.can_process(formatted_data):
        #         # If it's KBTG or BBL processor, let it do its own preprocessing and OCR
        #         if isinstance(processor, (KBTGProcessor, BBLProcessor)):
        #             special_processed = processor.preprocess_image(image)
        #             # Use processor's raw text
        #             text = processor.raw_text
        #             formatted_data = processor.clean_text(text)
        #             extracted_data = processor.extract_details(formatted_data)
        #             special_processed.save("debug_special.png")
        #         # Test with each processor