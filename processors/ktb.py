from .base import BankProcessor
import re

class KTBProcessor(BankProcessor):
    
    def merge_thai_chars(self, text: str) -> str:
        """รวมตัวอักษรไทยที่แยกกันและจัดการช่องว่างให้เหมาะสมสำหรับ KBTG"""
        # รวมตัวอักษรไทยที่อยู่ติดกัน
        thai_pattern = r"([ก-๛])\s+([ก-๛])"
        
        # แก้ไขปัญหาการแยกคำเฉพาะของ KBTG
        kbtg_patterns = [
            (r"ชํา\s*ร\s*ะ\s*เ[ฉจ]\s*ิ?น", "ชำระเงิน"),
            (r"ส\s*ํา\s*เ\s*ร\s*็\s*จ", "สำเร็จ"),
            (r"ไพ\s*บ\s*ู\s*ล\s*ย\s*้\s*อ", "ไพบูลย์"),
            (r"ก\s*ส\s*ิ\s*ก\s*ร\s*ไท\s*ย", "กสิกรไทย"),
            (r"เล\s*ข\s*ท\s*ี\s*่\s*ร\s*า\s*ย\s*ก\s*า\s*ร", "เลขที่รายการ"),
            (r"จ\s*ํา\s*น\s*ว\s*น", "จำนวน"),
        ]

        # ทำซ้ำจนกว่าจะไม่มีการเปลี่ยนแปลง
        prev_text = ""
        while prev_text != text:
            prev_text = text
            text = re.sub(thai_pattern, r"\1\2", text)
            
            # แก้ไขคำเฉพาะของ KBTG
            for pattern, replacement in kbtg_patterns:
                text = re.sub(pattern, replacement, text)

        # จัดการช่องว่างรอบเครื่องหมายและตัวเลข
        text = re.sub(r"([0-9])\s*:\s*([0-9])", r"\1:\2", text)  # เวลา
        text = re.sub(r"([0-9])\s*\.\s*([0-9])", r"\1.\2", text)  # จำนวนเงิน
        text = re.sub(r"\s*บ\s*า\s*ท", " บาท", text)  # คำว่า "บาท"
        
        # ลบช่องว่างซ้ำและช่องว่างต้น-ท้าย
        text = re.sub(r"\s+", " ", text).strip()
        
        return text
    
    def can_process(self, text: str) -> bool:
        ktb_patterns = [
            r"krungthai",
            r"Krungthai",
            r"กรุงไทย",
            r"กรงุไทย",  # OCR variation
            r"กรุงโทย",   # OCR variation
            r"ทรุงไทย",   # OCR variation
            # r"XXX-X-XX036-\d",  # KTB account pattern
        ]
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in ktb_patterns)

    def extract_details(self, text: str) -> dict:
        sender_info = {"name": None, "bank": "กรุงไทย", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}

        # Improved sender pattern to handle จาก/วาก/อาก/vin variations
        sender_match = re.search(
            r"(?:"  # Start of prefix options
                r"(?:จาก|วาก|อาก|vin)?\s*"  # Optional prefix with OCR variations
                r"(?:[แน]\s*\.\s*ส\s*\.|"  # แน. ส . pattern
                r"น\s*\.\ส\s*\.|"  # น . ส . pattern
                r"นาย|"
                r"นาง|"
                r"นางสาว)"
            r")\s*"  # End of prefix group
            r"([ก-๛\s]+?)"  # Thai name
            r"(?:\s*(?:XXX|[xXwanv]|-|n|ร|5|\d))",  # End patterns with more variations
            text
        )

        if sender_match:
            raw_match = sender_match.group()
            sender_name = sender_match.group(1).strip()
            
            # Clean up name and handle OCR issues
            sender_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', sender_name)
            sender_name = re.sub(r'\s+', ' ', sender_name).strip()
            
            # Always normalize prefix to น.ส. for these variations
            if re.search(r'[แน]\s*\.\ส\s*\.', raw_match):
                prefix = "น.ส."
            elif "นาย" in raw_match:
                prefix = "นาย"
            elif "นาง" in raw_match and "สาว" not in raw_match:
                prefix = "นาง"
            elif "นางสาว" in raw_match:
                prefix = "นางสาว"
            else:
                prefix = "น.ส."
            
            sender_info.update({
                "name": f"{prefix}{sender_name}",
                "raw_text": raw_match.strip()
            })

        # Improved receiver pattern for personal transfers with better name and bank separation
        receiver_match = re.search(
            r"(?:"  # Start of prefix group
                r"(?:ไป|โป)ยัง|"  # Original patterns
                r"ไปย้ง|"     # New OCR variation
                r"Tudo"       # OCR variation for ไปยัง
            r")\s*"
            r"(?:น\s*\.\s*ส\s*\.|"  # น.ส. with flexible spacing
            r"นาย|"
            r"นาง|"
            r"นางสาว)"
            r"\s*"  # Space after title
            r"(?:vac\s*)?"  # Optional vac text
            r"([ก-๛\s]+?)"  # Thai name (capturing group 1)
            r"(?:"  # Start bank group
                r"(?:โทย|ไทย)พาณิชย์|"
                r"พร้อม(?:เพย์|เฟย์)|"
                r"(?:ทรุง|กรุง)(?:โทย|ไทย)|"  # Add variation for กรุงไทย
                r"(?:XXX[-\s]*(?:XXXXXXXX)?[-\s]*\d+)"
            r")",  # End bank group
            text,
            re.IGNORECASE
        )

        if receiver_match:
            raw_match = receiver_match.group()
            receiver_name = receiver_match.group(1).strip()
            
            # Clean up receiver name
            receiver_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', receiver_name)
            receiver_name = re.sub(r'\s+', ' ', receiver_name).strip()
            receiver_name = re.sub(r'vac\s*', '', receiver_name)
            
            # Determine prefix with more accurate pattern matching
            if re.search(r'(?:น|[แน])\s*\.\s*ส\s*\.', raw_match, re.IGNORECASE):  # Improved น.ส. detection
                prefix = "น.ส."
            elif "นาย" in raw_match:
                prefix = "นาย"
            elif "นาง" in raw_match and "สาว" not in raw_match:
                prefix = "นาง"
            elif "นางสาว" in raw_match:
                prefix = "นางสาว"
            else:
                prefix = ""  # Default to น.ส. instead of นาย
            
            # Determine bank name based on bank_identifier
            bank_name = None
            if re.search(r'(?:โทย|ไทย)พาณิชย์', raw_match, re.IGNORECASE):
                bank_name = "ไทยพาณิชย์"  # Always normalize to correct spelling
            elif re.search(r'พร้อม(?:เพย์|เฟย์)', raw_match, re.IGNORECASE):
                bank_name = "พร้อมเพย์"
            elif re.search(r'(?:ทรุง|กรุง)(?:โทย|ไทย)', raw_match, re.IGNORECASE):
                bank_name = "กรุงไทย"
            
            receiver_info.update({
                "name": f"{prefix}{receiver_name}",
                "bank": bank_name,
                "raw_text": raw_match.strip()
            })

        # If no personal receiver found, try bill payment patterns
        if not receiver_info["name"]:
            # Try to match การไฟฟ้านครหลวง with OCR variations
            mea_match = re.search(
                r"(?:การ(?:โฟ|ไฟ)ฟ้านครหลวง)\s*"
                r"\((\d{15})\)",  # Capture bill reference number
                text
            )
            if mea_match:
                receiver_info.update({
                    "name": "ชำระบิล",
                    "raw_text": mea_match.group().strip()
                })
            # Continue with existing shop pattern if MEA not found
            elif shop_match := re.search(r"รหัสร้านค้า\s*([A-Z0-9]+)", text):
                receiver_info.update({
                    "name": "ร้านค้า",
                    "raw_text": shop_match.group().strip()
                })

        return {
            "date": self._extract_date(text),
            "time": self._extract_time(text),
            "amounts": self._extract_amount(text),
            "transaction_id": self._extract_transaction_id(text),
            "sender": sender_info,
            "receiver": receiver_info
        }

    def _extract_date(self, text: str) -> list:
        # Helper function to clean month variations
        def clean_month_part(text_part):
            # Add new pattern for "ก . พ w." -> "ก.พ."
            text_part = re.sub(r'ก\s*\.\s*พ\s*w\.?', 'ก.พ.', text_part, flags=re.IGNORECASE)
            # Handle OCR variations for ก.พ. appearing as n.w, n.พ
            text_part = re.sub(r'n\s*\.\s*w', 'ก.พ', text_part, flags=re.IGNORECASE)
            text_part = re.sub(r'n\s*\.\s*พ', 'ก.พ', text_part, flags=re.IGNORECASE)
            # Clean up spaces around dots
            text_part = re.sub(r'\s*\.\s*', '.', text_part)
            return text_part

        # Date patterns with variations
        patterns = [
            # Pattern for ก.พ. variations (including n.w, n.พ)
            r'(\d{1,2})\s*(?:n\.(?:w|พ)|ก\.?พ)\.?\s*\.?\s*(\d{4})',
            # Pattern for มี.ค. variations
            r'(\d{1,2})\s*(?:มี\.?|เม\.?)\s*ค\.?\s*(\d{4})',
            # Pattern for ธ.ค. variations
            r'(\d{1,2})\s*ธ\s*\.\s*ค\s*\.\s*(\d{4})',
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
                    # Handle ก.พ. special case
                    if 'n.w' in text.lower() or 'ก.พ' in text:
                        return [f"{day}ก.พ.{year}"]
                    # Handle มี.ค. special case
                    elif 'มี' in text:
                        return [f"{day}มี.ค.{year}"]
                    # Handle ธ.ค. special case
                    elif 'ธ' in text:
                        return [f"{day}ธ.ค.{year}"]
                else:
                    # Handle other month formats if needed
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

    def _extract_time(self, text: str) -> list:
        # Handle time format: "14: 06"
        time_match = re.search(r"(\d{2})\s*:\s*(\d{2})", text)
        if time_match:
            hour = time_match.group(1)
            minute = time_match.group(2)
            return [f"{hour}:{minute}"]
        return []

    def _extract_amount(self, text: str) -> list:
        # Handle amount with OCR variations
        amount_patterns = [
            r"จํานวน(?:เงิน|เจงิน)\s*(\d{1,3}(?:,\d{3})*\.\d{2})",  # Handle thousands separator
            r"(?:จํานวน|เงิน)\s*(\d{1,3}(?:,\d{3})*\.\d{2})",        # Handle thousands separator
            r"(\d{1,3}(?:,\d{3})*\.\d{2})\s*บาท"                     # Direct amount with บาท
        ]

        for pattern in amount_patterns:
            amount_match = re.search(pattern, text)
            if amount_match:
                return [f"{amount_match.group(1)} บาท"]
        return []

    def _extract_transaction_id(self, text: str) -> str:
        # Handle reference number formats with OCR variations and special characters
        ref_patterns = [
            r"(?:รหัส|หัส)อ้าง(?:อิง|อฮิง|อีง)\s*([A-Za-z0-9¢c]+)",  # Handle missing first character
            r"รห[ัส์]?ส?[จอ]้าง(?:อิง|อฮิง|อีง)\s*([A-Za-z0-9¢c]+)",
            r"รห[ัส์]?ส?[จอ]้าง[อฮ]ิง\s*([A-Za-z0-9][A-Za-z0-9¢c]+)"
        ]
        
        for pattern in ref_patterns:
            ref_match = re.search(pattern, text)
            if ref_match:
                transaction_id = ref_match.group(1)
                return transaction_id.replace('¢', 'c')
        return None
    