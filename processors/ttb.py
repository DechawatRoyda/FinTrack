from .base import BankProcessor
import re

class TTBProcessor(BankProcessor):
    
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
        # Check for other banks first - if found, return False
        other_banks = [
            r"กสิกร(?:ไทย)?",
            r"ธ\s*\.\s*กสิกร",
            r"XXX-X-X75\d{2}",  # KBANK pattern
            r"SCB",
            r"ไทยพาณิชย์",
            r"กรุงไทย",
            r"KTB",
        ]
        
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in other_banks):
            return False
                
        # Then check for TTB patterns
        ttb_patterns = [
            r"ttb",
            r"TTB",
            r"ธ\s*\.\s*ท\s*ห\s*า\s*ร\s*ไ\s*ท\s*ย\s*ธ\s*น\s*ช\s*า\s*ต"
        ]
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in ttb_patterns)

    def extract_details(self, text: str) -> dict:
        sender_info = {"name": None, "bank": "ทหารไทยธนชาต", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}

        # Check for English title first
        eng_name_match = re.search(r"(MR|MS|MRS|MISS)\s+([A-Z\s]+?)(?:\s+XXX|\s+\d)", text)
        if eng_name_match:
            sender_info["name"] = f"{eng_name_match.group(1)} {eng_name_match.group(2).strip()}"
            sender_info["raw_text"] = eng_name_match.group()
        else:
            # Try Thai name pattern as fallback
            thai_name_match = re.search(r"(?:นาย|นาง|น\.ส\.|นางสาว)\s*([ก-๛\s]+)", text)
            if thai_name_match:
                title = re.search(r"(นาย|นาง|น\.ส\.|นางสาว)", thai_name_match.group()).group(1)
                sender_name = thai_name_match.group(1).strip()
                sender_info["name"] = f"{title}{sender_name}"
                sender_info["raw_text"] = thai_name_match.group()

        # Extract receiver info
        receiver_match = re.search(r"(?:บ)?(?:นาย|นาง|น\.ส\.|นางสาว)\s*([ก-๛\s]+?)(?:\s+[A-Z]+|\s+XXX|\s*$)", text)
        if receiver_match and not ("เติมเงิน" in text or re.search(r"[วป]\s*-\s*ทู\s*-\s*คอล", text)):
            receiver_name = receiver_match.group(1).strip()
            # Look for bank identifier after receiver name
            bank_match = re.search(r"(?:BBL|SCB|KTB|BAY|GSB|KBANK)", text)
            receiver_info.update({
                "name": f"นาย{receiver_name}",
                "bank": self._map_bank_code(bank_match.group() if bank_match else None),
                "raw_text": receiver_match.group()
            })
        elif "เติมเงิน" in text or re.search(r"[วป]\s*-\s*ทู\s*-\s*คอล", text):
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

    def _extract_date(self, text: str) -> list:
        # Try English date format first
        eng_date_match = re.search(r"(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})", text)
        if eng_date_match:
            day = eng_date_match.group(1).zfill(2)
            month = self._convert_eng_month(eng_date_match.group(2))
            
            # Convert 2-digit CE year to BE year
            ce_year = int("20" + eng_date_match.group(3))  # Assume 20xx for 2-digit years
            be_year = ce_year + 543  # Convert to Buddhist Era
            
            return [f"{day}{month}{be_year}"]

        # Try Thai date format as fallback
        thai_date_match = re.search(r"(\d{1,2})\s*(ก\.?พ\.?|มี\.?ค\.?)\s*(\d{2})", text)
        if thai_date_match:
            day = thai_date_match.group(1).zfill(2)
            month = thai_date_match.group(2)
            if 'กพ' in month:
                month = 'ก.พ.'
            elif 'มีค' in month:
                month = 'มี.ค.'
            year = "25" + thai_date_match.group(3)
            return [f"{day}{month}{year}"]
        return []

    def _extract_time(self, text: str) -> list:
        # Try AM/PM format first
        am_pm_match = re.search(r"(\d{1,2})(?::)?(\d{2})\s*(AM|PM)", text, re.IGNORECASE)
        if am_pm_match:
            hour = int(am_pm_match.group(1))
            minute = am_pm_match.group(2)
            if am_pm_match.group(3).upper() == "PM" and hour < 12:
                hour += 12
            elif am_pm_match.group(3).upper() == "AM" and hour == 12:
                hour = 0
            return [f"{hour:02d}:{minute}"]

        # Try 24-hour format with น
        time_match = re.search(r"(\d{2})(\d{2})\s*น", text)
        if time_match:
            hours = time_match.group(1)
            minutes = time_match.group(2)
            return [f"{hours}:{minutes}"]
        return []

    def _extract_amount(self, text: str) -> list:
        # Look for amount after time
        amount_match = re.search(r"(?:AM|PM|น)\s*(\d+\.\d{2})", text)
        if amount_match:
            return [f"{amount_match.group(1)} บาท"]
        return []

    def _convert_eng_month(self, month: str) -> str:
        month_map = {
            'Jan': 'ม.ค.', 'Feb': 'ก.พ.', 'Mar': 'มี.ค.',
            'Apr': 'เม.ย.', 'May': 'พ.ค.', 'Jun': 'มิ.ย.',
            'Jul': 'ก.ค.', 'Aug': 'ส.ค.', 'Sep': 'ก.ย.',
            'Oct': 'ต.ค.', 'Nov': 'พ.ย.', 'Dec': 'ธ.ค.'
        }
        return month_map.get(month, '')

    def _map_bank_code(self, code: str) -> str:
        bank_map = {
            'BBL': 'กรุงเทพ',
            'SCB': 'ไทยพาณิชย์',
            'KTB': 'กรุงไทย',
            'BAY': 'กรุงศรี',
            'GSB': 'ออมสิน',
            'KBANK': 'กสิกรไทย'
        }
        return bank_map.get(code, None)

    def _extract_transaction_id(self, text: str) -> str:
        id_match = re.search(r"(?:Reference no\.*|รห[ัส]ส?อ้างอิง)\s*(\d+)", text)
        return id_match.group(1) if id_match else None
