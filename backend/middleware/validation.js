export const validateEmailFormat = (req, res, next) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email format",
      details: "Please enter a valid email address",
    });
  }
  next();
};

export const validatePasswordStrength = (req, res, next) => {
  const { password } = req.body;

  // เพิ่มรูปแบบที่ยอมรับได้และปรับปรุง regex
  const patterns = [
    // Pattern 1: ตัวอักษรพิมพ์ใหญ่/เล็ก + ตัวเลข (ไม่บังคับพิมพ์ใหญ่/เล็ก)
    /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/,

    // Pattern 2: ตัวอักษร + ตัวเลข + อักขระพิเศษ (ไม่บังคับครบทุกอย่าง)
    /^[A-Za-z\d@$!%*#?&]{8,}$/,

    // Pattern 3: มีตัวอักษร + ตัวเลขเท่านั้น
    /^[A-Za-z0-9]{8,}$/,

    // Pattern 4: ตัวอักษร + ตัวเลข + อักขระพิเศษ (อย่างน้อย 2 ประเภท)
    /^(?:(?=.*[A-Za-z])(?=.*[\d@$!%*#?&])|(?=.*\d)(?=.*[@$!%*#?&]))[A-Za-z\d@$!%*#?&]{8,}$/,
  ];

  const isValid = patterns.some((pattern) => pattern.test(password));

  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: "Weak password",
      details:
        "Password must be at least 8 characters long and contain:\n" +
        "- Letters or numbers\n" +
        "- Special characters (@$!%*#?&) are optional",
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
      details:
        "Username must be 3-20 characters long and can only contain letters, numbers, underscore and dash",
    });
  }
  next();
};
