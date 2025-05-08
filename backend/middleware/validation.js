export const validateEmailFormat = (req, res, next) => {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
        details: "Please enter a valid email address"
      });
    }
    next();
  };
  
  export const validatePasswordStrength = (req, res, next) => {
    const { password } = req.body;
    // อย่างน้อย 8 ตัว, มีตัวพิมพ์ใหญ่, พิมพ์เล็ก, ตัวเลข
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
    
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Weak password",
        details: "Password must be at least 8 characters long and contain uppercase, lowercase, and numbers"
      });
    }
    next();
  };
  
  export const validateUsername = (req, res, next) => {
    const { username } = req.body;
    // อนุญาตตัวอักษร, ตัวเลข, _ และ - เท่านั้น, 3-20 ตัวอักษร
    const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
    
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        message: "Invalid username format",
        details: "Username must be 3-20 characters long and can only contain letters, numbers, underscore and dash"
      });
    }
    next();
  };