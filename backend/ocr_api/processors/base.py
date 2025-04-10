from abc import ABC, abstractmethod
from typing import Dict, Any

class BankProcessor(ABC):
    @abstractmethod
    def can_process(self, text: str) -> bool:
        """Check if this processor can handle the given text"""
        pass

    @abstractmethod
    def extract_details(self, text: str) -> Dict[str, Any]:
        """Extract transaction details from the text"""
        pass

    def clean_text(self, text: str) -> str:
        """Common text cleaning method"""
        return text.strip()

    def _extract_date(self, text: str) -> list:
        raise NotImplementedError
        
    def _extract_time(self, text: str) -> list:
        raise NotImplementedError
        
    def _extract_amount(self, text: str) -> list:
        raise NotImplementedError
        
    def _extract_transaction_id(self, text: str) -> str:
        raise NotImplementedError
        
    def _extract_sender(self, text: str) -> dict:
        raise NotImplementedError
        
    def _extract_receiver(self, text: str) -> dict:
        raise NotImplementedError
