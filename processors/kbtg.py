from .base import BankProcessor
import re
import cv2
import numpy as np
from PIL import Image
import pytesseract

class KBTGProcessor(BankProcessor):
    def __init__(self):
        self.raw_text = None  # Add this line to store raw text

    def merge_thai_chars(self, text: str) -> str:
        """รวมตัวอักษรไทยที่แยกกันและจัดช่องว่างเฉพาะ KBTG"""
        # รวมตัวอักษรไทยที่อยู่ติดกัน
        prev_text = ""
        while prev_text != text:
            prev_text = text
            # รวมตัวอักษรไทย
            text = re.sub(r"([ก-๛])\s+([ก-๛])", r"\1\2", text)
            # รวมวรรณยุกต์
            text = re.sub(r"([ก-๛])\s+([่้๊๋์])", r"\1\2", text)
            # รวมตัวเลข
            text = re.sub(r"(\d)\s+(\d)", r"\1\2", text)
            # รวมคำสำคัญ
            text = re.sub(r"([กธนมสบ])\s+([..])\s+([กคทพมสร])", r"\1\2\3", text)

        # จัดการคำเฉพาะของ KBTG
        spacing_patterns = [
            (r"K\s*\+", "K+"),  # Fix K+ format
            (r"(\d{3})\s*-\s*(\d{1})\s*-\s*(\d{1})\s*(\d{4})", r"\1-\2-\3\4"),  # Fix account number
            (r"(\d+)\s*:\s*(\d+)", r"\1:\2"),  # Fix time format
            (r"ไล\s*น์\s*แม\s*น", "ไลน์แมน"),  # Fix Line Man
            (r"บ\s*า\s*ท", "บาท"),  # Fix baht
            (r"ส\s*แก\s*น", "สแกน"),  # Fix scan
        ]

        for pattern, replacement in spacing_patterns:
            text = re.sub(pattern, replacement, text)

        return text.strip()
        
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
        
        # ======== ขั้นตอนการปรับปรุงสำหรับข้อความภาษาไทย ========
        
        # ปรับความสว่างและคอนทราสต์ - ค่าที่ปรับนุ่มนวลกว่าเพื่อรักษาตัวอักษรไทย
        alpha_text = 1.3  # คอนทราสต์
        beta_text = 5     # ความสว่าง
        text_enhanced = cv2.convertScaleAbs(gray, alpha=alpha_text, beta=beta_text)
        
        # ลดสัญญาณรบกวนด้วย Gaussian blur (นุ่มนวล)
        text_blurred = cv2.GaussianBlur(text_enhanced, (3, 3), 0)
        
        # ทำ Adaptive Thresholding แบบนุ่มนวลเพื่อรักษาตัวอักษรไทย
        text_binary = cv2.adaptiveThreshold(
            text_blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
            cv2.THRESH_BINARY, 15, 8
        )
        
        # ใช้ morphological operations เพื่อปรับปรุงตัวอักษรไทย
        kernel_text = np.ones((1, 1), np.uint8)
        text_morphed = cv2.morphologyEx(text_binary, cv2.MORPH_CLOSE, kernel_text)
        
        # ======== ขั้นตอนการปรับปรุงสำหรับตัวเลขจำนวนเงิน ========
        
        # ปรับความสว่างและคอนทราสต์ - ค่าที่สูงกว่าเพื่อให้ตัวเลขชัดเจน
        alpha_num = 1.7   # คอนทราสต์สูงกว่า
        beta_num = 15     # ความสว่างสูงกว่า
        num_enhanced = cv2.convertScaleAbs(gray, alpha=alpha_num, beta=beta_num)
        
        # ทำ Otsu's thresholding สำหรับตัวเลข
        _, num_binary = cv2.threshold(num_enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # ใช้ Bilateral Filter เพื่อรักษาขอบของตัวเลขแต่ลบสัญญาณรบกวน
        num_filtered = cv2.bilateralFilter(num_enhanced, 5, 75, 75)
        
        # ทำ Adaptive Thresholding อีกครั้งสำหรับตัวเลข
        num_binary_adaptive = cv2.adaptiveThreshold(
            num_filtered, 255, cv2.ADAPTIVE_THRESH_MEAN_C, 
            cv2.THRESH_BINARY, 11, 5
        )
        
        # ======== ผสมผลลัพธ์ทั้งสองส่วน ========
        
        # ลองใช้วิธีการผสมแบบใหม่โดยใช้ Canny edge detection
        edges = cv2.Canny(original_gray, 100, 200)
        
        # ใช้ edges เพื่อเน้นข้อความและตัวเลข
        edges_dilated = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
        
        # ผสมผลลัพธ์ทั้งหมด
        combined = cv2.bitwise_and(text_morphed, num_binary_adaptive)
        
        # ปรับปรุงโดยใช้ histogram equalization
        combined_eq = cv2.equalizeHist(combined)
        
        # กำหนดพื้นที่ที่สนใจ (ROI)
        # สร้าง mask สำหรับพื้นที่ที่น่าจะมีข้อความสำคัญ
        mask = np.ones_like(combined_eq) * 255
        
        # ตรวจจับแถวที่น่าจะมีข้อความ
        rows_sum = np.sum(combined_eq, axis=1)
        text_rows = np.where(rows_sum > np.mean(rows_sum))[0]
        
        # เน้นแถวที่มีข้อความ
        for row in text_rows:
            if row < mask.shape[0]:
                mask[row, :] = 128  # บริเวณที่มีข้อความให้ค่าความสำคัญปานกลาง
        
        # เน้นบริเวณที่น่าจะมีจำนวนเงิน (ประมาณ 2/3 ของความสูงลงมา)
        money_region_start = int(combined_eq.shape[0] * 0.6)
        money_region_end = int(combined_eq.shape[0] * 0.8)
        mask[money_region_start:money_region_end, int(combined_eq.shape[1] * 0.5):] = 64  # บริเวณที่น่าจะมีจำนวนเงินให้ค่าความสำคัญสูง
        
        # ใช้ mask ในการรวมภาพต้นฉบับกับภาพที่ผ่านการประมวลผล
        weighted_text = cv2.addWeighted(combined_eq, 0.7, original_gray, 0.3, 0)
        
        # สร้างภาพผลลัพธ์สุดท้าย
        final = np.where(mask == 255, weighted_text, weighted_text)
        
        # เพิ่มความคมชัดอีกครั้ง
        kernel_sharpen = np.array([[-1, -1, -1],
                                [-1, 9, -1],
                                [-1, -1, -1]])
        sharpened = cv2.filter2D(final, -1, kernel_sharpen)
        
        # ทำ binarization อีกครั้งเพื่อให้ตัวอักษรชัดเจน
        _, final_binary = cv2.threshold(sharpened, 128, 255, cv2.THRESH_BINARY)
        
        # สำหรับภาษาไทยโดยเฉพาะ: ปรับปรุงการเชื่อมต่อของตัวอักษรที่มีวรรณยุกต์
        kernel_thai = np.ones((1, 2), np.uint8)
        final_thai = cv2.morphologyEx(final_binary, cv2.MORPH_CLOSE, kernel_thai)
        
        # Extract text after preprocessing
        processed_image = Image.fromarray(final_thai)
        self.raw_text = pytesseract.image_to_string(processed_image, lang="eng+thai")
        
        return processed_image

    def clean_text(self, text: str = None) -> str:
        """ทำความสะอาดข้อความเฉพาะสำหรับ KBTG"""
        if text is None:
            text = self.raw_text if self.raw_text else ""
        
        # จัดการกับช่องว่างและการขึ้นบรรทัดใหม่
        text = re.sub(r"\n+", " ", text)
        
        # Fix common OCR issues for KBTG
        fixes = [
            (r"ชํา\s*ร\s*ะ\s*เฉ\s*ิ*น", "ชำระเงิน"),
            (r"ส\s*ํ*า\s*เร\s*็*จ", "สำเร็จ"),
            (r"จํา\s*แวน", "จำนวน"),
            (r"เล\s*ข\s*ท\s*ี*่*\s*ร\s*า\s*ย\s*ก*\s*า*\s*ร", "เลขที่รายการ"),
            (r"บ\s*ม\s*เบี\s*ยม", "บาท"),  # Fix OCR error for บาท
            (r"ค\s*ํ*า\s*ธ", "ค่าธรรมเนียม"),  # Fix fee text
        ]
        
        for pattern, replacement in fixes:
            text = re.sub(pattern, replacement, text)

        # ใช้ merge_thai_chars เพื่อจัดการตัวอักษรไทย
        text = self.merge_thai_chars(text)
        
        # Clean up remaining spaces
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"\s*:\s*", ": ", text)
        
        return text.strip()

    def can_process(self, text: str) -> bool:
        kbank_patterns = [
            r"กสิกรไทย",
            r"ธ\s*\.\s*กสิกร",
            r"XXX-X-X75\d{2}-[xX]",  # KBANK account pattern
        ]
        return any(
            re.search(pattern, text, re.IGNORECASE) for pattern in kbank_patterns
        )

    def _get_bank_type(self, raw_text: str) -> str:
        """Determine bank type from raw text"""
        # First try exact bank patterns with ธ. prefix
        bank_exact_patterns = {
            r"ธ\s*\.\s*ทหารไทยธนชาต": "ทหารไทยธนชาต",
            r"ธ\s*\.\s*กสิกรไทย": "กสิกรไทย",
            r"ธ\s*\.\s*ไทยพาณิชย์": "ไทยพาณิชย์",
            r"ธ\s*\.\s*กรุงไทย": "กรุงไทย",
            r"ธ\s*\.\s*กรุงเทพ": "กรุงเทพ",
            r"ธ\s*\.\s*ทหารไทย": "ทหารไทยธนชาต",
            r"ธ\s*\.\s*กรุงศรี": "กรุงศรี",
            r"ธ\s*\.\s*ออมสิน": "ออมสิน",
        }

        for pattern, bank in bank_exact_patterns.items():
            if re.search(pattern, raw_text, re.IGNORECASE):
                return bank

        # Then try partial matches
        bank_partial_patterns = {
            r"ทหารไทยธนชาต": "ทหารไทยธนชาต",
            r"กสิกรไทย": "กสิกรไทย",
            r"ไทยพาณิชย์": "ไทยพาณิชย์",
            r"กรุงไทย": "กรุงไทย",
            r"กรุงเทพ": "กรุงเทพ",
            r"ทหารไทย": "ทหารไทยธนชาต",
            r"กรุงศรี": "กรุงศรี",
            r"ออมสิน": "ออมสิน",
        }

        for pattern, bank in bank_partial_patterns.items():
            if re.search(pattern, raw_text, re.IGNORECASE):
                return bank

        # PromptPay indicators
        if any(pp in raw_text for pp in ["Prompt Pay", "พร้อมเพย์", "รหัสพร้อมเพย์"]):
            return "พร้อมเพย์"
        
        return None

    def extract_details(self, text: str) -> dict:
        text = self.clean_text(text)
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"([ก-๛])\s+([ก-๛])", r"\1\2", text)
        text = re.sub(r"(\S)\s+([้่๊๋])", r"\1\2", text)

        # Initialize info dictionaries
        sender_info = {"name": None, "bank": "กสิกรไทย", "raw_text": ""}
        receiver_info = {"name": None, "bank": None, "raw_text": ""}

        # Process sender first with standard pattern
        sender_pattern = (
            r"(?:น\s*\.\ส\s*\.|นาย\s*|นาง\s*|นางสาว\s*)"
            r"([ก-๛\s]+?[์่้๊๋]?)"
            r"(?:\s*[A-Za-z0-9!@#$%^&*\(\)\[\]]+)?"
            r"(?:\s*!?\s*ธร?\s*\.\s*กสิกรไทย)"
        )

        # Check for merchant/Line Man first
        merchant_patterns = [
            # E-Wallet and payment service patterns - must come first
            r"(?:True\s*Money|ทรูมันนี่)\s*(?:Wallet|วอลเล็[ทต])",
            r"Rabbit\s*LINE\s*Pay",
            r"(?:AirPay|แอร์เพย์)",
            # Juristic person patterns
            r"นิติบุคคล[ก-๛\s]+",  # Generic juristic person
            r"(?:อาคาร|คอนโด)[ก-๛\s]+",  # Buildings/Condos
            # E-Wallet and payment service patterns
            r"(?:True\s*Money|ทรูมันนี่)\s*(?:Wallet|วอลเล็[ทต])",
            r"Rabbit\s*LINE\s*Pay",
            r"(?:AirPay|แอร์เพย์)",
            r"(?:Shopee|ช้อปปี้)\s*(?:Pay)?",
            # Bank shop patterns
            r"(?:SCB|KTB|TTB|BAY)\s*[ก-๛A-Z\s]+(?:SHOP)?",
            r"[ก-๛A-Z\s]+(?:SHOP|MART|MINI)",
            # Restaurant and food shop patterns
            r"(?:A\s*)?ครัว[ก-๛\s์่้๊๋0-9]+",
            r"ร้าน[ก-๛\s์่้๊๋0-9]+",
            r"(?:are|niase)\s*[ก-๛\s์่้๊๋0-9]+",
            # Basic retail patterns
            r"ไลน์\s*แมน",
            r"LINE\s*MAN",
            r"GRAB",
            r"Food\s*Panda|ฟู้ด\s*แพนด้า",
            r"(?:7-ELEVEN|เซเว่น)",
            r"(?:LOTUSS|โลตัส)",
            r"(?:แม็คโคร|MAKRO)",
            r"(?:BIG-?C|บิ๊กซี)",
            r"(?:TOPS|ท็อปส์)",
            # Corporate patterns
            r"CP\s+[A-Z\s]+(?:PUBLIC\s+COMPANY\s+LIMITED|CO\.?,?\s*LTD\.?)",
            r"(?:CP|PTT|SCG|TQM)\s+[A-Z\s]+",
            r"[A-Z\s]+(?:PUBLIC\s+COMPANY\s+LIMITED)",
            r"(?:บริษัท|บจก\.|หจก\.)\s*[ก-๛A-Z\s]+",
        ]

        # Try to find actual merchant text first
        for pattern in merchant_patterns:
            merchant_match = re.search(pattern, text, re.IGNORECASE)
            if merchant_match:
                # Get merchant text up to bank info
                matched_text = merchant_match.group(0).strip()
                end_pos = merchant_match.end()
                
                # Look for bank info after merchant name
                text_after = text[end_pos:end_pos + 100]
                bank_match = re.search(r"(?:WD\s*)?ธ\s*\.\s*[ก-๛\s]+", text_after)
                if bank_match:
                    matched_text = f"{matched_text} {bank_match.group(0)}".strip()
                
                # Clean up OCR artifacts
                clean_name = matched_text.split("ธ.")[0].strip()  # Split at ธ.
                clean_name = re.sub(r"\s*WD\s*$", "", clean_name)  # Remove WD at the end
                clean_name = re.sub(r"(?:\d|[A-Z])+$", "", clean_name).strip()  # Remove trailing numbers/letters
                clean_name = re.sub(r"Nake\s+REAL\s+Change", "", clean_name).strip()  # Remove extra text

                # Determine type of receiver
                is_wallet = re.search(r"(?:True\s*Money|ทรูมันนี่|Rabbit\s*LINE\s*Pay|AirPay|แอร์เพย์)", matched_text, re.IGNORECASE)
                is_juristic = re.search(r"(?:นิติบุคคล|อาคารชุด|บริษัท|บจก\.|หจก\.)", matched_text, re.IGNORECASE)
                
                sender_match = re.search(sender_pattern, text)
                if sender_match:
                    raw_text = text[sender_match.start():sender_match.end()].strip()
                    # ...existing sender processing code...
                    name = sender_match.group(1).strip()
                    name = re.sub(r"[^\u0E00-\u0E7F\s์่้๊๋]", "", name)
                    name = re.sub(r"\s+", " ", name).strip()

                    # Get prefix from raw text
                    prefix = ""
                    if re.search(r"น\s*\.\ส\s*\.", raw_text):
                        prefix = "น.ส."
                    elif "นางสาว" in raw_text:
                        prefix = "นางสาว"
                    elif "นาง" in raw_text:
                        prefix = "นาง"
                    elif "นาย" in raw_text:
                        prefix = "นาย"

                    sender_info.update({
                        "name": f"{prefix}{name}",
                        "raw_text": raw_text
                    })

                receiver_info.update({
                    "name": "เติมเงิน" if is_wallet else (clean_name if is_juristic else "ร้านค้า"),
                    "bank": self._get_bank_type(matched_text),  # Get bank for all cases except wallets
                    "raw_text": matched_text
                })

                return {
                    "date": self._extract_date(text),
                    "time": self._extract_time(text),
                    "amounts": self._extract_amount(text),
                    "transaction_id": self._extract_transaction_id(text),
                    "sender": sender_info,
                    "receiver": receiver_info,
                }

        # Continue with regular person-to-person transfer processing...
        sender_match = re.search(sender_pattern, text)
        if sender_match:
            raw_match = sender_match.group(0)
            name = sender_match.group(1).strip()
            name = re.sub(r"[^\u0E00-\u0E7F\s์่้๊๋]", "", name)
            name = re.sub(r"\s+", " ", name).strip()

            # Get prefix from raw match
            prefix = ""
            if re.search(r"น\s*\.\ส\s*\.", raw_match):
                prefix = "น.ส."
            elif "นางสาว" in raw_match:
                prefix = "นางสาว"
            elif "นาง" in raw_match:
                prefix = "นาง"
            elif "นาย" in raw_match:
                prefix = "นาย"

            sender_info.update({
                "name": f"{prefix}{name}",
                "raw_text": raw_match.strip()
            })

        # Universal pattern for receiver - แยก prefix และชื่อก่อน
        name_with_prefix_pattern = (
            r"(?:จ\s*)?"  # Optional จ prefix
            r"(?:uw\s*)?"  # Optional uw prefix
            r"(?:น\s*\.\s*ส\s*\.|นาย\s*|นาง\s*(?:สาว)?\s*|)?"  # Optional title
            r"([ก-๛\s]+?[์่้๊๋]?(?:\s*[ก-๛]\s*)+?)"  # Thai name with tone marks (non-greedy)
            r"(?=\s*(?:ธ\s*\.|Prompt|vee\s*\+|พร้อม|$))"  # Lookahead for bank/payment indicators
        )

        # ค้นหา prefix และชื่อก่อน
        receiver_match = re.search(name_with_prefix_pattern, text)
        if receiver_match and sender_info["raw_text"]:
            # ใช้ตำแหน่งหลัง sender_info เพื่อหา receiver
            text_after_sender = text[text.find(sender_info["raw_text"]) + len(sender_info["raw_text"]):]
            receiver_match = re.search(name_with_prefix_pattern, text_after_sender)
            
            if receiver_match:
                raw_name = receiver_match.group(1).strip()
                text_from_match = text_after_sender[receiver_match.start():]

                # ตรวจสอบว่ามีการระบุธนาคารหรือไม่
                bank_patterns = {
                    r"ธ\s*\.\s*กสิกรไทย": "กสิกรไทย",
                    r"ธ\s*\.\s*ไทยพาณิชย์": "ไทยพาณิชย์",
                    r"ธ\s*\.\s*กรุงไทย": "กรุงไทย",
                    r"ธ\s*\.\s*กรุงเทพ": "กรุงเทพ",
                    r"ธ\s*\.\s*ทหารไทย": "ทหารไทยธนชาต",
                    r"ธ\s*\.\s*ทหารไทยธนชาต": "ทหารไทยธนชาต",
                    r"ธ\s*\.\s*กรุงศรี": "กรุงศรี",
                    r"ธ\s*\.\s*ออมสิน": "ออมสิน",
                }

                bank_type = None
                end_pos = receiver_match.end()

                # Check for bank first
                for pattern, bank in bank_patterns.items():
                    if re.search(pattern, text_from_match):
                        bank_type = bank
                        end_pos = text_after_sender.find("XXX", receiver_match.start())
                        break

                # If no bank found, check for PromptPay
                if not bank_type and re.search(r"Prompt\s*(?:NN|NS|vee\s*\+)?\s*\.\s*Pay|พร้อม\s*เพย์", text_from_match):
                    bank_type = "พร้อมเพย์"
                    end_pos = min(x for x in [
                        text_after_sender.find("XXX", receiver_match.start()),
                        text_after_sender.find("\n", receiver_match.start()),
                        len(text_after_sender)
                    ] if x > 0)

                raw_text = text_after_sender[receiver_match.start():end_pos].strip()

                # Clean name and update receiver info
                name = re.sub(r"[^\u0E00-\u0E7F\s์่้๊๋]", "", raw_name)
                name = re.sub(r"\s+", " ", name).strip()
                name = re.sub(r"^จ", "", name).strip()  # Remove จ from start
                name = re.sub(r"ธ$", "", name).strip()  # Remove ธ from end

                # Get prefix from clean name
                prefix = ""
                if "นาย" in name:
                    prefix = "นาย"
                    name = name.replace("นาย", "").strip()
                elif "นางสาว" in name:
                    prefix = "นางสาว"
                    name = name.replace("นางสาว", "").strip()
                elif "น.ส." in name:
                    prefix = "น.ส."
                    name = name.replace("น.ส.", "").strip()
                elif "นาง" in name:
                    prefix = "นาง" 
                    name = name.replace("นาง", "").strip()

                # Reconstruct full name with prefix
                full_name = f"{prefix}{name}" if prefix else name

                if sender_info["name"] != full_name:  # Make sure receiver is different from sender
                    receiver_info = {
                        "name": full_name,
                        "bank": bank_type,
                        "raw_text": raw_text
                    }

        return {
            "date": self._extract_date(text),
            "time": self._extract_time(text),
            "amounts": self._extract_amount(text),
            "transaction_id": self._extract_transaction_id(text),
            "sender": sender_info,
            "receiver": receiver_info,
        }

    def _extract_date(self, text: str) -> list:
        def clean_month_part(text_part):
            # Clean up common OCR variations and spacing
            text_part = re.sub(
                r"ก\s*\.\พ\s*w\.?", "ก.พ.", text_part, flags=re.IGNORECASE
            )
            text_part = re.sub(
                r"ก\s*\.\[พw]\s*\.?", "ก.พ.", text_part, flags=re.IGNORECASE
            )
            text_part = re.sub(r"\s*\.\s*", ".", text_part)
            return text_part

        

        # First try to match the specific "17 ก . พ w. 68" format
        date_patterns = [
            r"(\d{1,2})\s*ก\s*\.\พ\s*w\s*\.\s*(\d{2})",  # 17 ก . พ w. 68
            r"(\d{1,2})\s*ก\s*\.\[พw]\s*\.?\s*(\d{2})",  # variations
            
        ]

        cleaned_text = clean_month_part(text)

        for pattern in date_patterns:
            match = re.search(
                pattern, text
            )  # Use original text for first match attempt
            if match:
                day = match.group(1).strip().zfill(2)
                year = f"25{match.group(2)}"
                return [f"{day}ก.พ.{year}"]

        patterns = [
            
            r"(\d{1,2})\s*(?:n\.(?:w|พ)|ก\.?พ)\.?\s*\.?\s*(\d{d,4})",                        
            r"(\d{1,2})\s*(?:มี\.?|เม\.?)\s*ค\.?\s*(\d{2,4})",
            r"(\d{1,2})\s*ธ\s*\.\ค\s*\.\s*(\d{2,4})",
            r"(\d{1,2})\s*([มีเพสตนธก])[ีิ]?\.?\s*([คยพ])\.?\s*(\d{2,4})",
        ]

        

        # Clean text before matching
        cleaned_text = clean_month_part(text)

        for pattern in patterns:
            match = re.search(pattern, cleaned_text)
            if match:
                day = match.group(1).strip().zfill(2)

                if len(match.groups()) == 2:  # Special case patterns
                    year = match.group(2).strip() 
                    year = f"25{year}" if len(year) == 2 else year
                    # Handle ก.พ. special case
                    if "n.w" in text.lower() or "ก.พ" in text:
                        return [f"{day}ก.พ.{year}"] 
                    # Handle มี.ค. special case
                    elif "มี" in text:
                        return [f"{day}มี.ค.{year}"]        
                    # Handle ธ.ค. special case
                    elif "ธ" in text:
                        return [f"{day}ธ.ค.{year}"]
                else:                
                    # Handle other month formats
                    month_prefix = match.group(2)
                    month_suffix = match.group(3)
                    year = match.group(4)
                    year = f"25{year}" if len(year) == 2 else year

                    month_map = {
                        "มค": "ม.ค.",
                        "กพ": "ก.พ.",
                        "มีค": "มี.ค.",
                        "เมย": "เม.ย.",
                        "พค": "พ.ค.",
                        "มิย": "มิ.ย.",
                        "กค": "ก.ค.",
                        "สค": "ส.ค.",
                        "กย": "ก.ย.",
                        "ตค": "ต.ค.",
                        "พย": "พ.ย.",
                        "ธค": "ธ.ค.",
                    }

                    month_abbr = f"{month_prefix}{month_suffix}".lower()
                    month = month_map.get(month_abbr)
                    if month:
                        return [f"{day}{month}{year}"]

        return []

    def _extract_time(self, text: str) -> list:
        
        # Handle time format with optional u. suffix
        time_match = re.search(r"(\d{2})\s*:\s*(\d{2})(?:\s*u\.)?", text)
        if time_match:
            hour = time_match.group(1)
            minute = time_match.group(2)
            return [f"{hour}:{minute}"]
        return []

    def _extract_amount(self, text: str) -> list:
        """Extract amount with improved pattern matching for KBTG slips"""
        
        # print("\n=== Amount Extraction Debug ===")
        # print("Input text:", text)
        
        
        # Normalize text variations
        text = re.sub(r"[''`\"\\]", "", text)  # Remove quotes and backslashes
        text = re.sub(r"\.{2,}", ".", text)  # Fix multiple dots
        text = re.sub(r"un|บาท|บม|บีม|เบียม", "บาท", text)  # Fix unit variations
        text = re.sub(r"จํานวนะ|จานวนะ|จำนวนะ|จํานวน:", "จำนวน:", text)  # Fix จำนวน variations
        
        # print("After normalization:", text)
        
        
        # Multiple patterns to catch different amount formats
        amount_patterns = [
            
            # Standard format with จำนวน followed by amount
            r"จำนวน\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            
            # OCR variation จํsนวนd
            r"จํานdน\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            
            # Direct amount with unit
            r"(\d{1,3}(?:,\d{3})*\.\d{2})\s*บาท",
            
            # Amount with quotes/dots prefix
            r"[\'\"\.]\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            
            # Bare amount between spaces or at line start/end
            r"(?:^|\s)(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s|$)",
            
            # Fallback: any valid amount format
            r"[^\d](\d{1,3}(?:,\d {3})*\.\d{2})[^\d]"
        ]

        for i, pattern in enumerate(amount_patterns):
            
            # print(f"\nTrying pattern {i + 1}:", pattern)
            amount_match = re.search(pattern, text)
            if amount_match:
                
                # print("Match found:", amount_match.group(0))
                amount = amount_match.group(1).strip()
                
                # print("Extracted amount:", amount)
                float_amount = float(amount.replace(",", ""))
                if 0 < float_amount < 1000000:  # Basic sanity check
                    result = f"{amount} บาท"
                    
                    # print("Valid amount found:", result)
                    return [result]

        return []

    def _extract_transaction_id(self, text: str) -> str:
        
        # Fix OCR text issues first
        text = re.sub(r"ภาร", "การ", text)  # Fix common OCR error รายกภาร -> รายการ
        
        
        # Handle KBANK transaction ID patterns with variations
        ref_patterns = [
            
            r"เลขท[ีิ]\s*่?\s*ร[าพ]ยก(?:ภ|า)?ร\s*:?\s*(\d{15}[A-Z0-9]+)",  # Standard format
            
            r"เลขที่(?:รายการ|ร[าพ]ยการ|รายกภาร|อ้างอิง)\s*:?\\s*([0-9]{15}[A-Z0-9]+)",  # With variations
            
            r"(?:เลขที่|หมายเลข)(?:รายการ|อ้างอิง)\s*:?\s*(\d+[A-Z0-9]+)",  # Generic format
            
            r"015\d{12}[A-Z0-9]+",  # Direct KBTG transaction ID pattern
        ]
        
        for pattern in ref_patterns:
            ref_match = re.search(pattern, text)
            if ref_match:
                transaction_id = ref_match.group(1) if len(ref_match.groups()) > 0 else ref_match.group(0)
                
                # Clean up any remaining spaces or special characters
                transaction_id = re.sub(r'\s+', '', transaction_id)
                return transaction_id
                
        return None
