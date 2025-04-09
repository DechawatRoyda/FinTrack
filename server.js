import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import authenticateToken from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transaction.js"; // นำเข้า transactionRoutes
import workspaceRoutes from "./routes/workspace.js";  // นำเข้า workspaceRoutes
import ocrSlipRoutes from "./routes/ocrslip.js"; 


dotenv.config(); // โหลด environment variables

const app = express();
app.use(cors());
app.use(express.json());

// ใช้ environment variable สำหรับ MongoDB URI
const dbURI = process.env.MONGO_URI;

if (!dbURI) {
  console.error("MongoDB URI is not defined in .env");
  process.exit(1); // หยุดโปรแกรมหากไม่มี MongoDB URI
}

// เชื่อมต่อ MongoDB
mongoose.connect(dbURI, {})
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ใช้เส้นทาง auth
app.use("/api/auth", authRoutes);
// ใช้เส้นทาง transactions
app.use("/api/transactions", transactionRoutes);

app.use("/api/workspaces", workspaceRoutes); // เพิ่มเส้นทางนี้สำหรับ workspace

app.use("/api/ocrslip", ocrSlipRoutes);

// ตัวอย่างการใช้ middleware สำหรับการป้องกัน route ที่ต้องการ JWT
app.get("/api/protected", authenticateToken, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ error: "Something went wrong!" });
});

// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));