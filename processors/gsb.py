from .base import BankProcessor
import re
import cv2
import numpy as np
from PIL import Image

class GSBProcessor(BankProcessor):
    def preprocess_image(self, image):
        # แปลง PIL image เป็น numpy array
        img_np = np.array(image)
        
        # แปลงเป็นภาพ grayscale
        if len(img_np.shape) == 3:
            gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
        else:
            gray = img_np
        
        # เก็บภาพต้นฉบับไว้
        original_gray = gray.copy()
        
        # ปรับ parameters ให้เหมาะกับสลิปออมสิน
        alpha_text = 1.4  # เพิ่มคอนทราสต์มากกว่า KBTG
        beta_text = 10    # เพิ่มความสว่างมากกว่า KBTG
        text_enhanced = cv2.convertScaleAbs(gray, alpha=alpha_text, beta=beta_text)
        
        # ใช้ CLAHE เพื่อปรับปรุงคอนทราสต์เฉพาะพื้นที่
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        text_enhanced = clahe.apply(text_enhanced)
        
        # ลดสัญญาณรบกวนด้วย bilateral filter
        text_filtered = cv2.bilateralFilter(text_enhanced, 11, 17, 17)
        
        # ทำ Adaptive Thresholding แบบ Gaussian
        text_binary = cv2.adaptiveThreshold(
            text_filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
            cv2.THRESH_BINARY, 13, 7  # ปรับ block size และ C
        )
        
        # morphological operations สำหรับปรับปรุงตัวอักษร
        kernel_text = np.ones((2, 2), np.uint8)  # เพิ่มขนาด kernel
        text_morphed = cv2.morphologyEx(text_binary, cv2.MORPH_CLOSE, kernel_text)
        
        # เพิ่มความคมชัด
        kernel_sharpen = np.array([[-1,-1,-1],
                                 [-1, 9,-1],
                                 [-1,-1,-1]])
        sharpened = cv2.filter2D(text_morphed, -1, kernel_sharpen)
        
        # ทำ binarization อีกครั้งเพื่อให้ตัวอักษรชัดเจน
        _, final_binary = cv2.threshold(sharpened, 127, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # เชื่อมตัวอักษรและวรรณยุกต์
        kernel_thai = np.ones((1, 2), np.uint8)
        final_thai = cv2.morphologyEx(final_binary, cv2.MORPH_CLOSE, kernel_thai)
        
        # ลดสัญญาณรบกวนขนาดเล็ก
        kernel_clean = np.ones((2,2), np.uint8)
        final_clean = cv2.morphologyEx(final_thai, cv2.MORPH_OPEN, kernel_clean)
        
        return Image.fromarray(final_clean)

    def can_process(self, text: str) -> bool:
        # Clean text for matching
        text = re.sub(r'\s+', '', text)
        
        gsb_patterns = [
            # Strong indicators for GSB slips
            r"จาก.*?ธนาคารออมสิน",  # From GSB
            r"0201xxxx3996",        # Specific GSB account pattern
            r"จาก.*?ออมสิน.*?0201", # GSB account prefix
            # Additional context patterns
            r"ธนาคารออมสิน.*?สาขา",
            r"GSB.*?Mobile",
            r"MyMo.*?ออมสิน"
        ]
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in gsb_patterns)

    def extract_details(self, text: str) -> dict:
# Add debug printing
        # print("GSBProcessor - Raw text input:")
        # print("-" * 50)
        # print(text)
        # print("-" * 50)

        # Initialize result info
        sender_info = {"name": None, "bank": "ออมสิน", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}
        
        # Extract sender name
        from_match = re.search(r"จาก\s*¢?\s*@?\s*(?:นาย|น\.ส\.|นาง|นางสาว)?\s*([^\n]+?)(?:\s*ธนาคาร|\s*\d{4}xxxx\d{4})", text)
        if from_match:
            sender_name = from_match.group(1).strip()
            # Clean up sender name
            sender_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', sender_name)  # Keep only Thai chars and spaces
            sender_name = re.sub(r'\s+', ' ', sender_name).strip()
            
            if not sender_name.startswith("นาย"):
                sender_name = "นาย" + sender_name
            
            sender_info.update({
                "name": sender_name,
                "raw_text": from_match.group().strip()
            })

        # Add new merchant detection patterns that don't rely on "ถึง"
        merchant_indicators = [
            r"LOTUSS",
            r"หมายเลขร้านค้า\s*\d*\s*:\s*(\d+)",
            r"เลขที(?:่|่|ี)อ้างอิง\s*\d*\s*:\s*([A-Z0-9]+)",
            r"รหัสร้านค้า",
            r"รหัสธุรกรรม"
        ]
        
        # Check for merchant transaction first
        for pattern in merchant_indicators:
            match = re.search(pattern, text)
            if match:
                merchant_raw = match.group()
                # If LOTUSS found, use it as raw_text
                if "LOTUSS" in merchant_raw:
                    merchant_raw = "LOTUSS"
                receiver_info.update({
                    "name": "ร้านค้า",
                    "raw_text": merchant_raw
                })
                return {
                    "date": self._extract_date(text),
                    "time": self._extract_time(text),
                    "amounts": self._extract_amount(text),
                    "transaction_id": self._extract_transaction_id(text),
                    "sender": sender_info,
                    "receiver": receiver_info
                }

        # First check for mobile/wallet indicators
        mobile_wallet_indicators = [
            ("ทรมนน วอลเลท", "ทรูมันนี่วอลเลท"),
            ("ทรูมันนี", "ทรูมันนี่วอลเลท"),
            ("TRUE MONEY", "ทรูมันนี่วอลเลท"),
            ("True Money", "ทรูมันนี่วอลเลท"),
        ]
        
        # Define promptpay indicators
        promptpay_indicators = ["พร้อมเพย์", "PromptPay", "Prompt Pay", "เติมเงินพร้อมเพย์"]

        # Enhanced receiver pattern with OCR variations and optional ถึง
        receiver_match = re.search(
            r"(?:"  # Start of non-capturing group for all possible starts
                r"ถึง|"  # Standard ถึง
                r"fia|"  # OCR variation of ถึง
                r"(?<=\d{4})\s+"  # Look for space after account number
            r")"
            r"\s*[©@,\s]*"  # Optional symbols and spaces
            r"(?:จ\s+)?"  # Optional จ
            r"(?:\d*\s*)?"  # Optional numbers
            r"(?:น\s*\.\s*ส\s*\.|นาย|นาง|นางสาว)?\s*"  # Optional title with flexible spacing
            r"([ก-๛\s]+?)"  # Thai name
            r"(?:"  # Start group for all possible endings
                r"\s*ธนาคาร\s*([ก-๛\s]+)|"  # Bank name capture
                r"\s*เติมเงินพร้อมเพย์|"
                r"\s*พร้อมเพย์|"
                r"\s*XXXXXX|"
                r"\s*QR|"
                r"\s*$"
            r")",
            text
        )

        # Alternative pattern for cases without clear separator
        if not receiver_match:
            receiver_match = re.search(
                r"(?<=\d{4})\s+"  # Look for space after account number
                r"[^\n]+?"  # Any characters (non-greedy)
                r"(?:น\s*\.\s*ส\s*\.|นาย|นาง|นางสาว)\s*"  # Title
                r"([ก-๛\s]+?)"  # Thai name
                r"(?:\s*พร้อมเพย์|\s*XXXXXX|\s*QR|\s*$)",  # Endings
                text
            )

        if receiver_match:
            receiver_name = receiver_match.group(1).strip()
            bank_name = receiver_match.group(2).strip() if len(receiver_match.groups()) > 1 and receiver_match.group(2) else None
            
            # Clean receiver name - improved to handle unwanted prefixes
            receiver_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', receiver_name)  # Keep only Thai chars and spaces
            receiver_name = re.sub(r'\s+', ' ', receiver_name).strip()
            
            # Remove unwanted prefixes like "ถึง" and duplicate titles
            receiver_name = re.sub(r'^ถึง', '', receiver_name)
            receiver_name = re.sub(r'^นาย\s*นาย', 'นาย', receiver_name)
            receiver_name = re.sub(r'^นาย\s*ถึง\s*นาย', 'นาย', receiver_name)
            receiver_name = re.sub(r'^ถึง\s*นาย', 'นาย', receiver_name)
            
            # Handle title prefix
            has_title = any(prefix in receiver_name for prefix in ["นาย", "น.ส.", "นาง", "นางสาว"])
            
            # Only add prefix if no title exists and it's not a PromptPay direct name transfer
            if not has_title and not any(i in text for i in promptpay_indicators):
                if re.search(r'น\s*\.\s*ส\s*\.', receiver_match.group()):
                    receiver_name = "น.ส." + receiver_name
                elif "นาย" in receiver_match.group():
                    receiver_name = "นาย" + receiver_name
                elif "นางสาว" in receiver_match.group():
                    receiver_name = "นางสาว" + receiver_name
                elif "นาง" in receiver_match.group():
                    receiver_name = "นาง" + receiver_name

            # Update receiver info
            receiver_info.update({
                "name": receiver_name.strip(),
                "bank": bank_name if bank_name else ("พร้อมเพย์" if any(i in text for i in promptpay_indicators) else None),
                "raw_text": receiver_match.group()
            })
            
            return {
                "date": self._extract_date(text),
                "time": self._extract_time(text),
                "amounts": self._extract_amount(text),
                "transaction_id": self._extract_transaction_id(text),
                "sender": sender_info,
                "receiver": receiver_info
            }

        # Check for top-up transaction first
        is_topup = "รายการเติมเงิน" in text or "เติมเงิน" in text
        has_mobile = "หมายเลขโทรศัพท์" in text or "เบอร์โทร" in text
        
        if is_topup or has_mobile:
            # Look for wallet name or mobile number
            for wallet_text, wallet_name in mobile_wallet_indicators:
                if wallet_text in text:
                    receiver_info.update({
                        "name": "เติมเงิน",
                        "raw_text": f"ถึง {wallet_name}"
                    })
                    break
            else:
                # If no specific wallet found but has mobile number
                receiver_info.update({
                    "name": "เติมเงิน",
                    "raw_text": "เติมเงินมือถือ"
                })
            return {
                "date": self._extract_date(text),
                "time": self._extract_time(text),
                "amounts": self._extract_amount(text),
                "transaction_id": self._extract_transaction_id(text),
                "sender": sender_info,
                "receiver": receiver_info
            }

        # First check for shop/merchant indicators
        shop_indicators = ["รหัสร้านค้า", "หมายเลขร้านค้า", "รหัสธุรกรรม"]
        
        # Check if this is a shop/merchant transaction
        if any(indicator in text for indicator in shop_indicators):
            shop_match = re.search(r"ถึง\s*(?:\(=a\)|\(2\))?\s*(?:ร้าน)?([^\n]+?)(?:\s*รหัสร้านค้า|\s*หมายเลขร้านค้า|\s*รหัสธุรกรรม|\s*เลขที)", text)
            if shop_match:
                receiver_info.update({
                    "name": "ร้านค้า",
                    "raw_text": shop_match.group()
                })
        else:
            # If not a shop, look for personal receiver
            receiver_match = re.search(r"ถึง\s*(?:hi|[^\n]+?)?\s*(?:\d+\s*)?(?:น\.ส\.|นาย|นาง|นางสาว)\s*([ก-๛\s]+?)(?:\s*พร้อมเพย์|\s*XXXXXX|\s*QR|\s*$)", text)
            if receiver_match:
                receiver_name = receiver_match.group(1).strip()
                # Clean receiver name
                receiver_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', receiver_name)
                receiver_name = re.sub(r'\s+', ' ', receiver_name).strip()
                
                # Add appropriate prefix from original match
                prefix = ""
                if "น.ส." in receiver_match.group():
                    prefix = "น.ส."
                elif "นาย" in receiver_match.group():
                    prefix = "นาย"
                elif "นางสาว" in receiver_match.group():
                    prefix = "นางสาว"
                elif "นาง" in receiver_match.group():
                    prefix = "นาง"
                
                # Check if this is a PromptPay transfer
                if any(indicator in text for indicator in promptpay_indicators):
                    receiver_info.update({
                        "name": prefix + receiver_name,
                        "bank": "พร้อมเพย์",
                        "raw_text": receiver_match.group()
                    })
                else:
                    receiver_info.update({
                        "name": prefix + receiver_name,
                        "raw_text": receiver_match.group()
                    })

        return {
            "date": self._extract_date(text),
            "time": self._extract_time(text),
            "amounts": self._extract_amount(text),
            "transaction_id": self._extract_transaction_id(text),
            "sender": sender_info,
            "receiver": receiver_info
        }

    def _extract_date(self, text):
        # Pre-process text to handle duplicate month indicators
        def clean_month_part(text_part):
            # Add new pattern for "ก . พ w." -> "ก.พ."
            text_part = re.sub(r'ก\s*\.\s*พ\s*w\.?', 'ก.พ.', text_part, flags=re.IGNORECASE)
            # Remove duplicate month indicators
            text_part = re.sub(r'([นก])\s*\.\s*([นก])\s*\.\s*([คค])', r'\1.\3', text_part)
            # Clean up spaces around dots
            text_part = re.sub(r'\s*\.\s*', '.', text_part)
            return text_part

        # Date patterns with variations
        patterns = [
            # Pattern for "22n ก . ค .2567" and similar
            r'(\d{1,2})\s*(?:n\.?|ก\.?)?\s*(?:ก\.?)?\s*ค\.?\s*(\d{4})',
            # Pattern for "5 มี . ค .2568" and similar
            r'(\d{1,2})\s*(?:มี\.?|เม\.?)\s*ค\.?\s*(\d{4})',
            # General pattern for other months
            r'(\d{1,2})\s*([มีเพสตนธก])[ีิ]?\.?\s*([คยพ])\.?\s*(\d{4})'
        ]

        # Clean text before matching
        cleaned_text = clean_month_part(text)

        for pattern in patterns:
            match = re.search(pattern, cleaned_text)
            if match:
                day = match.group(1).strip().zfill(2)
                
                if len(match.groups()) == 2:  # Special case patterns
                    year = match.group(2).strip()
                    # Handle ก.ค. special case
                    if 'n' in cleaned_text or 'ก' in cleaned_text:
                        return [f"{day}ก.ค.{year}"]
                    # Handle มี.ค. special case
                    elif 'มี' in cleaned_text:
                        return [f"{day}มี.ค.{year}"]
                else:
                    # Handle standard month format
                    month_prefix = match.group(2)
                    month_suffix = match.group(3)
                    year = match.group(4)
                    
                    month_map = {
                        'มค': 'ม.ค.',
                        'กพ': 'ก.พ.',
                        'มีค': 'มี.ค.',
                        'เมย': 'เม.ย.',
                        'พค': 'พ.ค.',
                        'มิย': 'มิ.ย.',
                        'กค': 'ก.ค.',
                        'สค': 'ส.ค.',
                        'กย': 'ก.ย.',
                        'ตค': 'ต.ค.',
                        'พย': 'พ.ย.',
                        'ธค': 'ธ.ค.',
                    }
                    
                    month_abbr = f"{month_prefix}{month_suffix}".lower()
                    month = month_map.get(month_abbr)
                    if month:
                        return [f"{day}{month}{year}"]

        return []

    def _extract_time(self, text):
        # Updated time pattern with flexible spacing
        time_match = re.search(r"(\d{1,2})\s*:\s*(\d{2})", text)
        if time_match:
            # Format time with proper spacing
            time = f"{time_match.group(1)}:{time_match.group(2)}"
            return [time]
        return []

    def _extract_amount(self, text):
        """Extract amounts with better handling of complex OCR errors in amount strings"""
        # print("GSB Amount Extraction - Input text:", text)
        
        # First, look for the specific pattern with "จํานวนเงิน" followed by amount and fee
        amount_fee_pattern = r"จํานวนเงิน\s*([\d,./\s]+)\s+(\d+\.\d{2})\s+ค่าธรรมเนียม"
        match = re.search(amount_fee_pattern, text)
        if match:
            # We've found a pattern with main amount followed by fee
            amount = match.group(1).strip()
            # Clean up the amount - remove spaces and replace slashes
            amount = re.sub(r'\s+', '', amount)
            amount = re.sub(r'/', '', amount)
            return [f"{amount} บาท"]
        
        # General patterns if the specific pattern above doesn't match
        amount_patterns = [
            # Main pattern trying to capture the whole amount with possible formatting issues
            r"จํานวนเงิน\s*([\d,./\s]+?)(?:\s+\d+\.\d{2}\s+ค่าธรรมเนียม|\s+บาท|\s+ค่าธรรมเนียม|$)",
            
            # Backup patterns
            r"เงิน\s*([\d,./\s]+?)(?:\s+บาท|\s+\d+\.\d{2}|\s+ค่า|$)",
            r"(?:จํานวน|เงิน).*?([\d,./]+\.\d{2})",
            r"จํานวนเงิน\s*([\d,\s./]+)"
        ]

        for pattern in amount_patterns:
            match = re.search(pattern, text)
            if match:
                # Extract and clean the amount
                amount = match.group(1).strip()
                
                # If amount has weird formatting, try to fix it
                amount = re.sub(r'\s+', '', amount)  # Remove all spaces
                amount = re.sub(r'/', '', amount)    # Remove forward slashes
                
                # Check if it looks like a valid amount
                if re.match(r'^\d+(?:,\d{3})*(?:\.\d{2})?$', amount):
                    return [f"{amount} บาท"]
        
        # Last resort: look for any number followed by decimal point and 2 digits
        decimal_amount = re.search(r'(\d[\d,\s]*\.\d{2})', text)
        if decimal_amount:
            amount = decimal_amount.group(1)
            amount = re.sub(r'\s+', '', amount)
            return [f"{amount} บาท"]
                
        # Special case for GSB pattern: 3,/750.00 0.00 ค่าธรรมเนียม
        special_case = re.search(r'([\d,\s/]+\.\d{2})\s+(?:0*\.\d{2})\s+ค่าธรรมเนียม', text)
        if special_case:
            amount = special_case.group(1)
            amount = re.sub(r'\s+', '', amount)
            amount = re.sub(r'/', '', amount)
            return [f"{amount} บาท"]

        # If all else fails, try to match any number-like pattern before "ค่าธรรมเนียม"
        last_attempt = re.search(r'([\d,\s./]+)(?=\s+(?:0*\.\d{2})?\s+ค่าธรรมเนียม)', text)
        if last_attempt:
            amount = last_attempt.group(1)
            amount = re.sub(r'\s+', '', amount)
            amount = re.sub(r'/', '', amount)
            if len(amount) > 1:  # Ensure we're not just capturing a single digit
                return [f"{amount} บาท"]
        
        # print("No amount found")
        return []

    def _extract_transaction_id(self, text):
        id_match = re.search(r"รหัสอ้าง(?:ยอิง|อิง)\s*:\s*([A-Za-z0-9๐-๙]+)", text)
        return id_match.group(1) if id_match else None

