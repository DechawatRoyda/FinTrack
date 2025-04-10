from .base import BankProcessor
import re

class SCBProcessor(BankProcessor):
    
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
        # Check it's not GSB first
        if "ธนาคารออมสิน" in text or "ออมสิน" in text:
            return False
            
        scb_patterns = [
            r"@?\s*[วจง][ง่]?\s*า?ย[งพ]?[ิง]น\s*สํา[เร]็จ",  # More flexible pattern for OCR variations
            r"@?\s*[วจ]่าย[งพ][ิง]น\s*สํา[เร]็จ",
            r"@?\s*วง่ายงิน\s*สํา[เร]็จ",  # Specific pattern for this case
            r"@?\s*โอน[แเ]งิน\s*สํา[เร]็จ",
            r"[xX]XX-XXX(?:359|3S9|530)-[0-9]",  # Account pattern with OCR variation
            r"\d{3}-\d{3}(?:359|3S9|530)-\d",  # Alternative account format
        ]
        
        # Try to match any pattern ignoring case
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in scb_patterns)

    def extract_details(self, text: str) -> dict:
        # Initialize result info
        sender_info = {"name": None, "bank": "ไทยพาณิชย์", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}
        
        # Improved sender pattern to handle more OCR variations
        from_match = re.search(r"จาก\s*@\s*(?:บ)?(?:ายา|าย|นาย|น\.ส\.|นาง|นางสาว)?\s*([^\nX]+?)(?:\s*[xX]+|XXX|\s*Biller|\s*\d{4})", text)
        if from_match:
            sender_name = from_match.group(1).strip()
            # Clean up sender name
            sender_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', sender_name)
            sender_name = re.sub(r'\s+', ' ', sender_name).strip()
            
            # Improved OCR variation handling
            if any(x in sender_name for x in ["บายา", "ายา"]):
                sender_name = re.sub(r'^บายา|^ายา', '', sender_name)
            elif "บาย" in sender_name:
                sender_name = "น" + sender_name[1:]
            elif "าย" in sender_name:
                sender_name = "น" + sender_name
            
            sender_name = sender_name.strip()
            if not sender_name.startswith("นาย"):
                sender_name = "นาย" + sender_name
            
            sender_info.update({
                "name": sender_name,
                "raw_text": from_match.group().strip()
            })

        # Enhanced merchant detection pattern with more variations and looser matching
        service_match = re.search(
            r"ไปยัง\s*@?\s*(?:" 
            r"(?:LINE MAN|TRUE MONEY|TRUE WALLET|LINE|SHOPEE|LAZADA|"
            r"CP(?:\s+[A-Z]+(?:\s+[A-Z]+)*)?|"  # Handle CP + multiple words
            r"123|"
            r"[A-Z][A-Z\s]+(?:\s*PUBLIC\s+COMPANY\s+LIMITED|\s*CO\.,?\s*LTD\.?|\s*LIMITED|\s*LTD\.?|\s*SERVICE))|"
            r"(?:.*?(?:Biller ID:|หมายเลขร้านค้า|HEAD|รหัสร้านค้า))"
            r".*?)",
            text,
            re.IGNORECASE  # Make case insensitive
        )

        # More comprehensive merchant detection with case-insensitive check
        if (service_match or 
            any(indicator.lower() in text.lower() for indicator in [
                "Biller ID:", "หมายเลขร้านค้า", "COMPANY LIMITED", 
                "PUBLIC COMPANY", "HEAD", "รหัสร้านค้า", "CP AXTRA"  # Added CP AXTRA
            ])):
            receiver_info.update({
                "name": "ร้านค้า",
                "raw_text": service_match.group() if service_match else "ร้านค้า"
            })
            return {
                "date": self._extract_date(text),
                "time": self._extract_time(text),
                "amounts": self._extract_amount(text),
                "transaction_id": self._extract_transaction_id(text),
                "sender": sender_info,
                "receiver": receiver_info
            }

        # Improved pattern for person-to-person transfers with more title variations
        to_match = re.search(
            r"ไปยัง\s*"
            r"(?:@|©|2)?\s*"
            r"(?:"  # Start group for title variations
                r"(?:บ)?(?:น\s*\.\s*ส\s*\.|"  # น.ส. with spaces
                r"บ\s*น\s*\.\ส*\.|"  # บน.ส. variation
                r"บาง\s*สาว|"  # บางสาว -> นางสาว
                r"นาง\s*สาว|"
                r"บาง|"  # บาง -> นาง
                r"นาย|"
                r"นาง)"
            r")\s*"
            r"([ก-๛\s]+)"  # Thai name
            r"(?:\s*XXX|\s*x-|\s*Biller|\s*จํานวน)",
            text
        )

        if to_match:
            receiver_name = to_match.group(1).strip()
            raw_match = to_match.group()

            # Clean up name
            receiver_name = re.sub(r'[^\u0E00-\u0E7F\s]', '', receiver_name)
            receiver_name = re.sub(r'\s+', ' ', receiver_name).strip()

            # Determine prefix from raw match with OCR variation handling
            if any(x in raw_match.lower() for x in ["น.ส.", "น . ส", "บน.ส", "บน . ส"]):
                prefix = "น.ส."
            elif "บางสาว" in raw_match or "นางสาว" in raw_match:
                prefix = "นางสาว"
            elif "บาง" in raw_match or "นาง" in raw_match:
                prefix = "นาง"
            else:
                prefix = "นาย"

            receiver_info.update({
                "name": f"{prefix}{receiver_name}",
                "raw_text": raw_match
            })

        # Extract other details
        return {
            "date": self._extract_date(text),
            "time": self._extract_time(text),
            "amounts": self._extract_amount(text),
            "transaction_id": self._extract_transaction_id(text),
            "sender": sender_info,
            "receiver": receiver_info
        }

    def _extract_date(self, text):
        # Helper function to clean month variations
        def clean_month_part(text_part):
            # Add new pattern for "ก . พ w." -> "ก.พ."
            text_part = re.sub(r'ก\s*\.\s*พ\s*w\.?', 'ก.พ.', text_part, flags=re.IGNORECASE)
            # Handle OCR variations for ก.พ. appearing as n.w, n.พ
            text_part = re.sub(r'n\s*\.\s*w', 'ก.พ', text_part, flags=re.IGNORECASE)
            text_part = re.sub(r'n\s*\.\s*พ', 'ก.พ', text_part, flags=re.IGNORECASE)
            # Remove duplicate month indicators
            text_part = re.sub(r'ม+[มี]+\s*\.\s*ค', 'มี.ค', text_part)
            text_part = re.sub(r'\s*\.\s*', '.', text_part)
            return text_part

        # Try to match date with month variations
        patterns = [
            # Pattern for ก.พ variations (including n.w, n.พ)
            r'(\d{1,2})\s*(?:n\.(?:w|พ)|ก\.?พ)\.?\s*\.?\s*(\d{4})',
            # Pattern for มี.ค and variations
            r'(\d{1,2})\s*(?:ม*มี\.?|เม\.?)\s*ค\.?\s*(\d{4})',
            # Original SCB pattern as fallback
            r'\d{1,2}\s*(?:มี\s*\.\s*ค|ก\s*\.\s*พ)\s*\.\s*\d{4}'
        ]

        # Clean text first
        cleaned_text = clean_month_part(text)

        for pattern in patterns:
            match = re.search(pattern, cleaned_text)
            if match:
                if len(match.groups()) == 2:
                    # Handle new pattern with groups
                    day = match.group(1).strip().zfill(2)
                    year = match.group(2).strip()
                    # Check if this was n.w/ก.พ pattern
                    if 'n.w' in match.group() or 'ก.พ' in match.group():
                        return [f"{day}ก.พ.{year}"]
                    return [f"{day}มี.ค.{year}"]
                else:
                    # Handle original pattern
                    date = match.group()
                    date = re.sub(r'\s+', '', date)
                    return [date]

        return []

    def _extract_time(self, text):
        time_match = re.search(r"\d{2}\s*:\s*\d{2}", text)
        if time_match:
            # Clean up any spaces in the time
            time = re.sub(r'\s+', '', time_match.group())
            return [time]
        return []

    def _extract_amount(self, text):
        amount_match = re.search(r"จํานวนเงิน\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)", text)
        return [f"{amount_match.group(1)} บาท"] if amount_match else []

    def _extract_transaction_id(self, text):
        id_match = re.search(r"รหัสอ้างอิง\s*:\s*([A-Za-z0-9๐-๙]+)", text)
        return id_match.group(1) if id_match else None
    