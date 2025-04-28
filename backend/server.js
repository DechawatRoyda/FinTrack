import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import mdns from 'multicast-dns';
import ip from 'ip';
import authenticateToken from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import transactionRoutes from "./routes/transaction.js"; // นำเข้า transactionRoutes
import workspaceRoutes from "./routes/workspace.js";  // นำเข้า workspaceRoutes
import ocrSlipRoutes from "./routes/ocrslip.js"; 
import billRoutes from "./routes/bills.js"; // นำเข้า billRoutes
import requestRoutes from "./routes/requests.js"; // นำเข้า requestRoutes
import adminRoutes from "./routes/admins.js";
import { cleanupExpiredSessions } from './middleware/sessionCleanup.js';


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
  .then(() => {
    console.log("MongoDB connected");
    // ตั้งเวลาล้าง sessions ทุก 1 ชั่วโมง
    setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// ใช้เส้นทาง auth
app.use("/api/auth", authRoutes);
// ใช้เส้นทาง transactions
app.use("/api/transactions", transactionRoutes);

app.use("/api/workspaces", workspaceRoutes); // เพิ่มเส้นทางนี้สำหรับ workspace

app.use("/api/ocrslip", ocrSlipRoutes);

app.use("/api/bills", billRoutes); // เพิ่มเส้นทางนี้สำหรับ bills

app.use("/api/requests", requestRoutes); // เพิ่มเส้นทางนี้สำหรับ bills

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  next();
});

app.use("/api/admin", adminRoutes);

// ตัวอย่างการใช้ middleware สำหรับการป้องกัน route ที่ต้องการ JWT
app.get("/api/protected", authenticateToken, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send({ error: "Something went wrong!" });
});

// Enhanced mDNS Configuration
const serviceName = 'fin-track-api.local';
const serviceType = '_http._tcp.local';
const mdnsServer = mdns();

const serviceAd = {
  answers: [{
    name: serviceName,
    type: 'A',
    ttl: 300,
    data: ip.address()
  }, {
    name: serviceType,
    type: 'PTR',
    ttl: 300,
    data: serviceName
  }, {
    name: serviceName,
    type: 'SRV',
    ttl: 300,
    data: {
      port: process.env.PORT || 5000,
      weight: 0,
      priority: 0,
      target: serviceName
    }
  }]
};

mdnsServer.on('query', (query) => {
  const questions = query.questions || [];
  questions.forEach(question => {
    if (question.name === serviceName || question.name === serviceType) {
      mdnsServer.respond(serviceAd);
    }
  });
});

// Error handler for mDNS
mdnsServer.on('error', (err) => {
  console.error('mDNS error:', err);
});

// Cleanup handler
process.on('SIGINT', () => {
  mdnsServer.destroy(() => {
    console.log('mDNS server stopped');
    process.exit();
  });
});

// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('=== Server Information ===');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Local IP: ${ip.address()}`);
  console.log(`mDNS service name: ${serviceName}`);
  console.log(`mDNS service type: ${serviceType}`);
  console.log('=========================');
});