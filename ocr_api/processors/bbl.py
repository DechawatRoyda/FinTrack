from .base import BankProcessor
import re
import cv2
import numpy as np
from PIL import Image
import pytesseract  # Add this import

class BBLProcessor(BankProcessor):
    def __init__(self):
        self.raw_text = None  # เพิ่ม raw_text property

    def preprocess_image(self, image):
        # Convert PIL image to numpy array
        img_np = np.array(image)
        
        # Convert to grayscale if needed
        if len(img_np.shape) == 3:
            gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
        else:
            gray = img_np
            
        # เก็บภาพต้นฉบับไว้
        original = gray.copy()
            
        # Step 1: ปรับความสว่างและคอนทราสต์
        alpha = 1.2  # ค่าคอนทราสต์
        beta = 10    # ค่าความสว่าง
        adjusted = cv2.convertScaleAbs(gray, alpha=alpha, beta=beta)
        
        # Step 2: Denoise ด้วย fastNlMeansDenoising (ค่าที่เหมาะกับตัวอักษร)
        denoised = cv2.fastNlMeansDenoising(adjusted, h=10)
        
        # Step 3: เพิ่ม Contrast ด้วย CLAHE
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        contrasted = clahe.apply(denoised)
        
        # Step 4: Adaptive Thresholding แบบแยกส่วน
        # 4.1 สำหรับข้อความทั่วไป
        text_binary = cv2.adaptiveThreshold(
            contrasted, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 21, 12
        )
        
        # 4.2 สำหรับตัวเลขและจำนวนเงิน (ความคมชัดสูงกว่า)
        amount_binary = cv2.adaptiveThreshold(
            contrasted, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 15, 8
        )
        
        # Step 5: Morphological Operations
        # 5.1 สำหรับข้อความภาษาไทย
        kernel_thai = np.ones((1,2), np.uint8)  # kernel แนวนอนเพื่อเชื่อมตัวอักษรไทย
        text_morphed = cv2.morphologyEx(text_binary, cv2.MORPH_CLOSE, kernel_thai)
        
        # 5.2 สำหรับตัวเลข
        kernel_num = np.ones((2,1), np.uint8)  # kernel แนวตั้งเพื่อเชื่อมตัวเลข
        amount_morphed = cv2.morphologyEx(amount_binary, cv2.MORPH_CLOSE, kernel_num)
        
        # Step 6: รวมภาพทั้งสองส่วน
        combined = cv2.bitwise_or(text_morphed, amount_morphed)
        
        # Step 7: Clean up noise
        # 7.1 ลบจุดรบกวนขนาดเล็ก
        kernel_clean = np.ones((2,2), np.uint8)
        cleaned = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel_clean)
        
        # 7.2 เชื่อมส่วนที่ขาดหาย
        kernel_connect = np.ones((1,1), np.uint8)
        connected = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel_connect)
        
        # Step 8: Invert back
        final = cv2.bitwise_not(connected)
        
        # Step 9: Apply sharpening for better OCR
        kernel_sharpen = np.array([[-1,-1,-1],
                                 [-1, 9,-1],
                                 [-1,-1,-1]])
        sharpened = cv2.filter2D(final, -1, kernel_sharpen)
        
        # Step 10: Blend with original for better results
        result = cv2.addWeighted(sharpened, 0.7, original, 0.3, 0)
        
        # Extract text and store in raw_text
        processed_image = Image.fromarray(result)
        self.raw_text = pytesseract.image_to_string(processed_image, lang="eng+thai")
        
        return processed_image

    def clean_text(self, text: str = None) -> str:
        if text is None:
            text = self.raw_text if self.raw_text else ""

        # Step 1: Basic cleanup
        text = re.sub(r'[\'"`]', '', text)  # Remove quotes
        text = re.sub(r'\n+', ' ', text)    # Replace newlines with spaces
        
        # Step 2: Join Thai characters aggressively
        patterns = [
            (r'([ก-๛])\s+([ก-๛])', r'\1\2'),  # Join Thai chars
            (r'([ก-๛])\s+([่้๊๋์])', r'\1\2'),  # Join tone marks
            (r'(\d)\s+(\d)', r'\1\2'),         # Join numbers
        ]
        
        # Apply joining patterns repeatedly until no changes
        prev_text = ""
        while prev_text != text:
            prev_text = text
            for pattern, replacement in patterns:
                text = re.sub(pattern, replacement, text)

        # Step 3: Fix common OCR errors and format specific phrases
        ocr_fixes = [
            # Fix common words
            (r'ธ\s*ร\s*า\s*ย\s*ก\s*า\s*ร\s*สํ?\s*า\s*เ\s*ร\s*[็ิ]\s*จ', 'รายการสำเร็จ'),
            (r'จํ?\s*า\s*น\s*น\s*เ\s*[งฮ]\s*[ิc]\s*น', 'จำนวนเงิน'),
            (r'(?:tun|uri)\s*[@©]\s*', 'ไปที่'),
            (r'พ\s*ร\s*้\s*อ\s*ม\s*เ\s*พ\s*ย\s*์', 'พร้อมเพย์'),
            (r'ธ\s*น\s*า\s*ค\s*า\s*ร\s*ก\s*ร\s*[งุ]\s*ง\s*เ\s*ท\s*พ', 'ธนาคารกรุงเทพ'),
            
            # Fix name prefixes
            (r'น\s*\.\s*ส\s*\.', 'น.ส.'),
            (r'น\s*า\s*ง\s*ส\s*า\s*ว', 'นางสาว'),
            (r'น\s*า\s*ย', 'นาย'),
            (r'น\s*า\s*ง', 'นาง'),
            
            # Fix amounts and numbers
            (r'([0-9])\s*\.\s*([0-9])', r'\1.\2'),
            (r'([0-9])\s*,\s*([0-9])', r'\1,\2'),
            (r'([0-9])\s+THB', r'\1 THB'),
            
            # Fix reference numbers
            (r'เลข\s*ท[ีิ]\s*่\s*อ[้ิ]าง\s*อ[ิีฮ]ง', 'เลขที่อ้างอิง'),
            (r'หมาย\s*เลข\s*อ[้ิ]าง\s*อ[ิีฮ]ง', 'หมายเลขอ้างอิง'),
        ]

        for pattern, replacement in ocr_fixes:
            text = re.sub(pattern, replacement, text)

        # Step 4: Final cleanup
        text = re.sub(r'\s+', ' ', text)  # Normalize spaces
        text = text.strip()

        return text

    def can_process(self, text: str) -> bool:
        # Clean text for better matching
        text = re.sub(r'\s+', '', text)
        
        # Check if it's from GSB first - if yes, return False
        if re.search(r"จาก.*?ธนาคารออมสิน|ออมสิน.*?0201", text, re.IGNORECASE):
            return False
            
        bbl_indicators = [
            # Must be from BBL (not just sending to BBL)
            r"จาก.*?ธนาคารกรุงเทพ",
            r"จาก.*?BBL", 
            # Specific BBL account format
            r"037-?7-[xX]{3}435",
            r"\d{3}-\d-[xX]{3}\d{3}.*?กรุงเทพ",
            # BBL logo/header text
            r"^(?:BBL|Bangkok\s*Bank)",
        ]
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in bbl_indicators)

    def _extract_date(self, text: str) -> list:
        """Extract date with support for multiple month formats and integrated time"""
        # เพิ่ม pattern สำหรับ n.w. โดยเฉพาะ
        nw_pattern = r"(\d{1,2})\s*n\.?w\.?\s*(\d{4})"
        match = re.search(nw_pattern, text)
        if match:
            day = match.group(1).strip().zfill(2)
            year = match.group(2).strip()
            if year.startswith('256'):  # Handle year 2025-2069
                return [f"{day}ก.พ.{year}"]
        
        # Month mapping for Thai abbreviations
        month_map = {
            "มค": "ม.ค.", "กพ": "ก.พ.", "มีค": "มี.ค.", 
            "เมย": "เม.ย.", "พค": "พ.ค.", "มิย": "มิ.ย.",
            "กค": "ก.ค.", "สค": "ส.ค.", "กย": "ก.ย.", 
            "ตค": "ต.ค.", "พย": "พ.ย.", "ธค": "ธ.ค."
        }

        # Comprehensive date patterns with time integration
        date_patterns = [
            # BBL Specific patterns with time
            r"(\d{1,2})\s*(?:n\.?w|nw|Nn\.w)\s*\.?\s*(\d{4}),\s*(\d{1,2}):(\d{2})",
            r"(\d{1,2})\s*ก\s*\.\s*[พw]\s*\.\s*(\d{4}),\s*(\d{1,2}):(\d{2})",
            
            # General Thai month patterns with time
            r"(\d{1,2})\s*([มีเพสตนธก])[ีิ]?\.?\s*([คยพ])\.?\s*(\d{2,4}),\s*(\d{1,2}):(\d{2})",
            
            # Common month formats
            r"(\d{1,2})\s*(?:ม\.?ค|มกรา)\s*\.?\s*(\d{2,4})",     # มกราคม
            r"(\d{1,2})\s*(?:ก\.?พ|กุมภา)\s*\.?\s*(\d{2,4})",    # กุมภาพันธ์
            r"(\d{1,2})\s*(?:มี\.?ค|มีนา)\s*\.?\s*(\d{2,4})",    # มีนาคม
            r"(\d{1,2})\s*(?:เม\.?ย|เมษา)\s*\.?\s*(\d{2,4})",    # เมษายน
            r"(\d{1,2})\s*(?:พ\.?ค|พฤษภา)\s*\.?\s*(\d{2,4})",    # พฤษภาคม
            r"(\d{1,2})\s*(?:มิ\.?ย|มิถุนา)\s*\.?\s*(\d{2,4})",   # มิถุนายน
            r"(\d{1,2})\s*(?:ก\.?ค|กรกฎา)\s*\.?\s*(\d{2,4})",    # กรกฎาคม
            r"(\d{1,2})\s*(?:ส\.?ค|สิงหา)\s*\.?\s*(\d{2,4})",    # สิงหาคม
            r"(\d{1,2})\s*(?:ก\.?ย|กันยา)\s*\.?\s*(\d{2,4})",    # กันยายน
            r"(\d{1,2})\s*(?:ต\.?ค|ตุลา)\s*\.?\s*(\d{2,4})",     # ตุลาคม
            r"(\d{1,2})\s*(?:พ\.?ย|พฤศจิกา)\s*\.?\s*(\d{2,4})",  # พฤศจิกายน
            r"(\d{1,2})\s*(?:ธ\.?ค|ธันวา)\s*\.?\s*(\d{2,4})"     # ธันวาคม
        ]

        for pattern in date_patterns:
            match = re.search(pattern, text)
            if match:
                day = match.group(1).strip().zfill(2)
                groups = match.groups()
                
                # Handle patterns with time
                if len(groups) >= 4 and ":" in pattern:
                    year = groups[1]
                    # Don't include time in date
                    if len(year) == 2 or year.startswith('256'):
                        year = f"25{year[-1]}" if year.startswith('256') else f"25{year}"
                    
                    # For BBL n.w. pattern
                    if 'n.w' in text.lower() or 'ก.พ' in text:
                        return [f"{day}ก.พ.{year}"]  # Return only date part
                
                # Handle patterns without time
                else:
                    if len(groups) == 3:  # Pattern with month abbreviation
                        month_prefix = groups[1]
                        month_suffix = groups[2]
                        month_abbr = f"{month_prefix}{month_suffix}".lower()
                        month = month_map.get(month_abbr, "ก.พ.")  # Default to ก.พ. if not found
                        year = f"25{groups[3][-2:]}" if len(groups[3]) == 2 else groups[3]
                    else:
                        year = groups[1]
                        if len(year) == 2:
                            year = f"25{year}"
                        month = next((k for k, v in month_map.items() if k in text.lower()), "ก.พ.")
                        month = month_map.get(month, month)
                    
                    return [f"{day}{month}{year}"]
        
        return []

    def _extract_time(self, text: str) -> list:
        """Extract time using the date's time if available, otherwise find standalone time"""
        
        # First try to find time that's part of the date string
        date_time_pattern = r"\d{1,2}\s*(?:n\.?w|nw|Nn\.w|ก\s*\.\s*[พw])\s*\.?\s*\d{4},\s*(\d{1,2}):(\d{2})"
        time_match = re.search(date_time_pattern, text)
        
        if time_match:
            hour = time_match.group(1).zfill(2)
            minute = time_match.group(2)
            return [f"{hour}:{minute}"]
        
        # Fallback to standalone time pattern
        standalone_pattern = r"(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*\d{2})?"
        time_match = re.search(standalone_pattern, text)
        if time_match:
            hour = time_match.group(1).zfill(2)
            minute = time_match.group(2)
            return [f"{hour}:{minute}"]
        
        return []

    def _extract_amount(self, text: str) -> list:
        # Clean text for amount extraction
        text = re.sub(r'\s+', ' ', text)
        
        # Fix OCR variations
        text = re.sub(r'(?:ฑา|กํา|จํา)(?:น|แ)(?:วน|เว)(?:เง|เร)[ิี]น', 'จำนวนเงิน', text)
        text = re.sub(r'(?:THB|THE|tHe|tis|tre|te|tus|trp)', 'THB', text)
        
        # Try to find first decimal number that looks like money amount
        simple_amount_pattern = r"(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})"
        amount_match = re.search(simple_amount_pattern, text)
        if amount_match:
            try:
                whole_part = amount_match.group(1).replace(",", "").strip()
                decimal_part = amount_match.group(2)
                formatted_whole = "{:,}".format(int(whole_part))
                amount = f"{formatted_whole}.{decimal_part}"
                float_val = float(amount.replace(",", ""))
                if 0 < float_val < 10000000:
                    return [f"{amount} บาท"]
            except (ValueError, IndexError):
                pass

        # If no simple amount found, try the existing patterns
        # Amount patterns with more variations
        amount_patterns = [
            # Pattern 1: With จำนวนเงิน prefix
            r"(?:จำนวน)?(?:เงิน)?[:\s]*?(\d{1,3}(?:,\d{3})*|\d+)\.?(?:\s*)?(\d{2})\s*(?:THB|บาท)",
            
            # Pattern 2: Direct amount with comma and decimal
            r"(\d{1,3}(?:,\d{3})*|\d+)\.?(?:\s*)?(\d{2})\s*(?:THB|บาท)",
            
            # Pattern 3: Amount with space instead of decimal
            r"(?:จำนวน)?(?:เงิน)?[:\s]*?(\d{1,3}(?:,\d{3})*|\d+)\s+(\d{2})\s*(?:THB|บาท)",
            
            # Pattern 4: Single number amount (will add .00)
            r"(?:จำนวน)?(?:เงิน)?[:\s]*?(\d{1,3}(?:,\d{3})*|\d+)(?!\d)\s*(?:THB|บาท)",
        ]

        # Look for receiver section and limit search area
        receiver_start = text.find("ไปที่")
        if receiver_start != -1:
            text_after_receiver = text[receiver_start:]
            end_markers = ["ค่าธรรมเนียม", "หมายเลข", "เลขที่"]
            end_pos = len(text_after_receiver)
            
            for marker in end_markers:
                pos = text_after_receiver.find(marker)
                if pos != -1:
                    end_pos = min(end_pos, pos)
            
            amount_section = text_after_receiver[:end_pos]
            
            # Try to find amount in the limited section first
            amount_match = re.search(r"(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})", amount_section)
            if amount_match:
                try:
                    whole_part = amount_match.group(1).replace(",", "").strip()
                    decimal_part = amount_match.group(2)
                    formatted_whole = "{:,}".format(int(whole_part))
                    amount = f"{formatted_whole}.{decimal_part}"
                    float_val = float(amount.replace(",", ""))
                    if 0 < float_val < 10000000:
                        return [f"{amount} บาท"]
                except (ValueError, IndexError):
                    pass

        # If no amount found in limited section, try original patterns
        text_sections = text.split("ค่าธรรมเนียม")
        if len(text_sections) > 0:
            text_to_search = text_sections[0]  # ใช้เฉพาะส่วนก่อน "ค่าธรรมเนียม"
            
            for pattern in amount_patterns:
                match = re.search(pattern, text_to_search)
                if match:
                    try:
                        amount = ""
                        if len(match.groups()) == 2:  # Has decimal part
                            whole_part = match.group(1).replace(",", "").strip()
                            decimal_part = match.group(2)
                            
                            if len(whole_part) > 8:  # Probably a misread
                                whole_part = whole_part[:-2]
                                decimal_part = "00"
                                
                            formatted_whole = "{:,}".format(int(whole_part))
                            amount = f"{formatted_whole}.{decimal_part}"
                        else:  # Single number - add .00
                            whole_part = match.group(1).replace(",", "").strip()
                            formatted_whole = "{:,}".format(int(whole_part))
                            amount = f"{formatted_whole}.00"

                        float_val = float(amount.replace(",", ""))
                        if 0 < float_val < 10000000:
                            return [f"{amount} บาท"]
                    except (ValueError, IndexError):
                        continue
        return []

    def _extract_transaction_id(self, text: str) -> str:
        # Clean text and remove line breaks
        cleaned_text = re.sub(r'\s+', '', text)
        
        # Specific pattern for จ้างจึง format
        direct_pattern = r"(?:เลขที่|หมายเลข)?(?:จ้าง)?(?:จึง|อ้าง)[^\d]*(\d{25})"
        direct_match = re.search(direct_pattern, cleaned_text)
        if direct_match:
            transaction_id = direct_match.group(1)
            if transaction_id.startswith('20'):
                return transaction_id

        # Look for 25-digit number starting with 20 anywhere in text
        direct_numbers = re.findall(r'20\d{23}', cleaned_text)
        if direct_numbers:
            return direct_numbers[0]

        # Backup patterns for older formats
        ref_patterns = [
            r"เลขท[ีิ]่(?:จ้าง)?(?:จึง|อ้าง(?:อิง|ฮิง|อีง|อจิง))(?:\s*=)?\s*[:\s]*(\d{25})",
            r"หมายเลขอ้างอ[ิีจ]ง\s*(\d{25})",
        ]

        for pattern in ref_patterns:
            match = re.search(pattern, cleaned_text)
            if match:
                numbers = re.findall(r'\d+', match.group(0))
                if numbers:
                    for num in numbers:
                        if len(num) >= 25 and num.startswith('20'):
                            return num

        return None

    def _get_bank_type(self, text: str) -> str:
        """Determine bank type from raw text for BBL"""
        # First check for พร้อมเพย์/PromptPay
        if re.search(r"พร้อมเพย์|PromptPay", text, re.IGNORECASE):
            return "พร้อมเพย์"

        # Then check other e-wallet and bank patterns
        bank_patterns = {
            # E-Wallets (should return None for topup cases)
            r"K\s*Plus\s*Wallet": None,
            r"(?:True|ทรู)\s*(?:Money|มันนี่)\s*(?:Wallet|วอลเล็[ทต]?)": None,
            r"(?:e-wallet|wallet).*KPLUS": None,
            r"SHOPEEPAY": None,
            r"LINE\s*Pay": None,
            
            # Banks
            r"ธ(?:นาคาร)?\.?\s*ไทยพาณิชย์": "ไทยพาณิชย์",
            r"ธ(?:นาคาร)?\.?\s*กรุงไทย": "กรุงไทย",
            r"ธ(?:นาคาร)?\.?\s*กรุงเทพ": "กรุงเทพ",
            r"ธ(?:นาคาร)?\.?\s*ออมสิน": "ออมสิน",
            r"ธ(?:นาคาร)?\.?\s*กสิกรไทย": "กสิกรไทย",
            r"ธ(?:นาคาร)?\.?\s*กรุงศรี": "กรุงศรี",
            r"ธ(?:นาคาร)?\.?\s*ทหารไทย": "ทหารไทย",
            r"ธ(?:นาคาร)?\.?\s*ธนชาต": "ธนชาต",
            r"ธ(?:นาคาร)?\.?\s*ยูโอบี": "ยูโอบี",
            r"ธ(?:นาคาร)?\.?\s*ซีไอเอ็มบี": "ซีไอเอ็มบี",
        }

        for pattern, bank in bank_patterns.items():
            if re.search(pattern, text, re.IGNORECASE):
                return bank
        return None

    def _clean_name(self, name: str) -> str:
        """Clean name by removing known suffixes"""
        suffixes = [
            r"เต(?:ด)?[ิี]มเง[ิี]น",  # เตดิมเงิน, เติมเงิน variations
            r"ชาร์[ิี]?จเง[ิี]น",
            r"(?:top|เติม)\s*up",
            r"เพิ่มเง[ิี]น",
            r"โอนเง[ิี]น"
        ]
        
        cleaned_name = name.strip()
        for suffix in suffixes:
            cleaned_name = re.sub(suffix + r"$", "", cleaned_name, flags=re.IGNORECASE)
        return cleaned_name.strip()

    def extract_details(self, text: str) -> dict:
        text = self.clean_text(text)
        
        # Initialize info dictionaries
        sender_info = {"name": None, "bank": "กรุงเทพ", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}

        # Step 1: Process sender info first
        sender_pattern = r"จาก\s*(?:©\s*)?(?P<prefix>นาย|นางสาว|น\.ส\.|นาง)\s*(?P<name>[ก-๛์่้๊๋\s]+?)(?=\s*\d{3})"
        if "จาก" in text:
            # ปรับปรุงการหา sender_section โดยใช้ "จาก" เป็นจุดเริ่มต้น
            sender_start = text.index("จาก")
            sender_end = text.find("ไปที่", sender_start) if text.find("ไปที่", sender_start) != -1 else len(text)
            sender_section = text[sender_start:sender_end].strip()
            
            sender_match = re.search(sender_pattern, sender_section)
            if sender_match:
                prefix = sender_match.group('prefix')
                name = sender_match.group('name').strip()
                
                # หา raw_text โดยเริ่มจาก "จาก" และจบที่ "กรุงเทพ"
                start_pos = sender_start  # เริ่มจากตำแหน่ง "จาก"
                end_pos = text.find("กรุงเทพ", sender_match.end()) + 7 if "กรุงเทพ" in text[sender_match.end():] else sender_end
                raw_text = text[start_pos:end_pos].strip()
                
                sender_info.update({
                    "name": f"{prefix}{name}",
                    "bank": "กรุงเทพ",
                    "raw_text": raw_text
                })

        # Step 2: Process receiver info
        if "จาก" in text:  # ต้องมี "จาก" ก่อน
            text_after_sender = text[text.find(sender_info["raw_text"]) + len(sender_info["raw_text"]):]
            
            receiver_pattern = r"(?:ไปที่|จ่าย|โอน)?\s*(?:®|\(>|\(PB\)|\©)?\s*(?P<prefix>นาย|นางสาว|น\.ส\.|นาง)\s*(?P<name>[ก-๛์่้๊๋\s]+?)(?=\s*(?:\d{3}-\d-|\d|เติมเงิน|พร้อมเพย์|K\s*Plus|ธ\.|หมายเลข|\n))"
            receiver_match = re.search(receiver_pattern, text_after_sender)
            
            if receiver_match:
                prefix = receiver_match.group('prefix')
                name = receiver_match.group('name').strip()
                text_from_match = text_after_sender[receiver_match.start():]

                # ตรวจสอบธนาคาร - เพิ่มรูปแบบ OCR ที่ผิดพลาด
                bank_patterns = {
                    r"ธ(?:นาคาร)?\.?\s*(?:ไท|โท)ยพาณิชย์": "ไทยพาณิชย์",  # รวม โทย -> ไทย
                    r"ธ(?:นาคาร)?\.?\s*กรุงไทย": "กรุงไทย", 
                    r"ธ(?:นาคาร)?\.?\s*กรุงเทพ": "กรุงเทพ",
                    r"ธ(?:นาคาร)?\.?\s*ออมสิน": "ออมสิน",
                    r"ธ(?:นาคาร)?\.?\s*กสิกรไทย": "กสิกรไทย",
                    r"ธ(?:นาคาร)?\.?\s*กรุงศรี": "กรุงศรี",
                    r"ธ(?:นาคาร)?\.?\s*ทหารไทย": "ทหารไทย",
                    r"ธ(?:นาคาร)?\.?\s*ธนชาต": "ธนชาต",
                }

                # หา bank_type และ raw_text โดยใช้ชื่อธนาคารเป็นจุดสิ้นสุด
                bank_type = None
                end_pos = None

                for pattern, bank in bank_patterns.items():
                    bank_match = re.search(pattern, text_from_match)
                    if bank_match:
                        bank_type = bank
                        end_pos = receiver_match.start() + bank_match.end()
                        break

                # ถ้าไม่เจอธนาคาร ตรวจสอบ PromptPay
                if not bank_type and re.search(r"พร้อมเพย์|PromptPay", text_from_match):
                    bank_type = "พร้อมเพย์"
                    pp_match = re.search(r"พร้อมเพย์|PromptPay", text_from_match)
                    if pp_match:
                        end_pos = receiver_match.start() + pp_match.end()

                raw_text = text_after_sender[receiver_match.start():end_pos].strip() if end_pos else text_from_match.split("\n")[0].strip()
                
                receiver_info.update({
                    "name": f"{prefix}{name}",
                    "bank": bank_type,
                    "raw_text": raw_text
                })
                return self._build_response(text, sender_info, receiver_info)

            # Continue with merchant and topup checks if no person found
            # 2. ตรวจสอบร้านค้า
            merchant_patterns = [
                # Food delivery services
                r"LINE\s*MAN", r"GRAB\s*FOOD", r"FOOD\s*PANDA", r"ROBINHOOD",
                
                # Retail stores
                r"(?:7-ELEVEN|เซเว่น)", r"(?:LOTUSS|โลตัส)",
                r"(?:แม็คโคร|MAKRO)", r"(?:BIG-?C|บิ๊กซี)", r"(?:TOPS|ท็อปส์)",
                
                # Company formats
                r"(?:บริษัท|บจก\.|หจก\.)\s*[ก-๛A-Z\s]+",
                r"[ก-๛A-Z\s]+(?:จํากัด|จำกัด|มหาชน)",
                r"[A-Z\s]+(?:CO\.?,?\s*LTD\.?)",
                
                # E-Wallets and payment services
                r"(?:True|ทรู)\s*(?:Money|มันนี่)",
                r"(?:SHOPEE|ช้อปปี้)", r"SCB\s*EASY",
                
                # Service codes and merchant IDs
                r"(?:service|รหัส)\s*code",
                r"รหัสร้านค้า\s*\d+",
                r"Biller\s*ID\s*:\s*\d+"
            ]

            for pattern in merchant_patterns:
                match = re.search(pattern, text_after_sender)
                if match:
                    merchant_name = match.group(0).strip()
                    raw_text = merchant_name
                    receiver_info.update({
                        "name": "ร้านค้า",
                        "bank": None,
                        "raw_text": raw_text
                    })
                    return self._build_response(text, sender_info, receiver_info)

            # 3. ตรวจสอบการเติมเงิน
            topup_patterns = {
                r"TMNTOPUP": ("เติมเงิน", None),
                r"(?:จก|ทรู)ร?มันนี่(?:วอลเล็[ทต])?": ("เติมเงิน", None),
                r"RABBIT": ("เติมเงิน", None),
                r"SHOPEE\s*PAY": ("เติมเงิน", None),
                r"K\s*Plus\s*Wallet": ("เติมเงิน", None),
                r"LINE\s*PAY": ("เติมเงิน", None),
                r"GRAB\s*PAY": ("เติมเงิน", None),
                r"(?:AirPay|แอร์เพย์)": ("เติมเงิน", None),
                r"TRUE\s*SMART\s*CARD": ("เติมเงิน", None),
                r"(?:TOP|เติม)\s*UP": ("เติมเงิน", None)
            }

            for pattern, (name, bank) in topup_patterns.items():
                match = re.search(pattern, text_after_sender)
                if match:
                    matched_text = match.group(0).strip()
                    receiver_info.update({
                        "name": name,
                        "bank": bank,
                        "raw_text": matched_text
                    })
                    return self._build_response(text, sender_info, receiver_info)

        return self._build_response(text, sender_info, receiver_info)

    def _build_response(self, text, sender_info, receiver_info):
        return {
            "date": self._extract_date(text),
            "time": self._extract_time(text),
            "amounts": self._extract_amount(text),
            "transaction_id": self._extract_transaction_id(text),
            "sender": sender_info,
            "receiver": receiver_info
        }
