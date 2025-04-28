import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // ตรวจสอบว่ามี admin อยู่แล้วหรือไม่
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log("Admin user already exists");
      return;
    }

    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!adminPassword) {
      throw new Error("ADMIN_INITIAL_PASSWORD not set in .env");
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const admin = new User({
      username: "admin.FinTrack",
      password: hashedPassword,
      name: "System Administrator",
      email: process.env.ADMIN_EMAIL,
      role: "admin",
      numberAccount: "ADMIN",
      phone: "-",
      max_limit_expense: "0",
      avatar_url: "default_admin.png"
    });

    await admin.save();
    console.log("Admin user created successfully");
    
  } catch (err) {
    console.error("Failed to create admin:", err);
  } finally {
    await mongoose.disconnect();
  }
};

createAdmin();
//createAdmin();
//cd backend
//node scripts/createAdmin.js