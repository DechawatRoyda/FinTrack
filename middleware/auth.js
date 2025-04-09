import jwt from "jsonwebtoken";  // ใช้ import สำหรับการใช้งาน ES Modules

const authenticateToken = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1]; // หามาจาก headers Authorization

  if (!token) {
    return res.status(401).json({ error: "Access denied, no token provided" });
  }

  // ตรวจสอบว่า JWT ถูกต้องหรือไม่
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    req.user = user; // เก็บข้อมูลของ user ไว้ใน request
    next(); // ถ้า JWT ถูกต้องให้ไปยัง route ถัดไป
  });
};

export default authenticateToken; // ใช้ export default
