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
    
    // เพิ่มรูปแบบที่ยอมรับได้
    const patterns = [
      // Pattern 1: ต้องมีทั้งตัวพิมพ์เล็ก พิมพ์ใหญ่ และตัวเลข
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/,
      
      // Pattern 2: ต้องมีตัวอักษร(พิมพ์เล็กหรือพิมพ์ใหญ่) และตัวเลข
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/,
      
      // Pattern 3: ต้องมีตัวอักษร ตัวเลข และอักขระพิเศษ
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/,
      
      // Pattern 4: ต้องมีตัวอักษรและตัวเลข อนุญาตให้มีอักขระพิเศษได้
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/
    ];
  
    // ตรวจสอบว่าตรงกับ pattern ใดๆ หรือไม่
    const isValid = patterns.some(pattern => pattern.test(password));
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Weak password",
        details: "Password must be at least 8 characters long and contain:\n" +
                 "- Letters (uppercase or lowercase)\n" +
                 "- Numbers\n" +
                 "- Special characters are optional (@$!%*#?&)"
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