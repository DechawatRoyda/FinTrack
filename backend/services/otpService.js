import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Gmail Configuration
const gmailConfig = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
};

class OTPService {
  constructor() {
    this.otpStore = new Map();
    this.transporter = null;
    this.setupTransporter();
    this.startCleanupInterval();
  }

  setupTransporter() {
    this.transporter = nodemailer.createTransport({
      ...gmailConfig,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 3
    });
  }

  startCleanupInterval() {
    // ทำความสะอาด OTP ที่หมดอายุทุก 5 นาที
    setInterval(() => {
      this.cleanupExpiredOTPs();
    }, 5 * 60 * 1000);
  }

  cleanupExpiredOTPs() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [email, data] of this.otpStore.entries()) {
      if (now > data.expiryTime || data.attempts >= 3) {
        this.otpStore.delete(email);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired OTPs`);
    }
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      console.error('SMTP Connection Error:', error);
      this.setupTransporter();
      try {
        await this.transporter.verify();
        console.log('SMTP reconnected successfully');
        return true;
      } catch (retryError) {
        console.error('SMTP Reconnection Failed:', retryError);
        return false;
      }
    }
  }

  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  createEmailTemplate(otp) {
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; border-radius: 10px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #2c3e50; margin: 0;">FinTrack Authentication</h2>
          <p style="color: #7f8c8d; margin-top: 5px;">Your verification code is below</p>
        </div>
        
        <div style="background-color: #ffffff; padding: 20px; text-align: center; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <strong style="font-size: 32px; letter-spacing: 8px; color: #2c3e50; display: block;">${otp}</strong>
          <p style="color: #e74c3c; margin: 10px 0 0;">Expires in 5 minutes</p>
        </div>

        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #7f8c8d; font-size: 12px;">
          <p>If you didn't request this code, please ignore this email.</p>
          <p>For security reasons, never share this code with anyone.</p>
        </div>
      </div>
    `;
  }

  async sendOTP(email) {
    try {
      if (!await this.verifyConnection()) {
        throw new Error('Email service is not configured correctly');
      }

      const otp = this.generateOTP();
      const expiryTime = Date.now() + 5 * 60 * 1000; // 5 minutes

      // ลบ OTP เก่าถ้ามี
      if (this.otpStore.has(email)) {
        this.otpStore.delete(email);
      }

      // บันทึก OTP ใหม่
      this.otpStore.set(email, {
        otp,
        expiryTime,
        attempts: 0,
        lastRequestTime: Date.now()
      });

      const mailOptions = {
        from: {
          name: 'FinTrack Authentication',
          address: process.env.EMAIL_USER
        },
        to: email,
        subject: 'FinTrack - Your Verification Code',
        html: this.createEmailTemplate(otp),
        headers: {
          'X-Priority': '1',
          'X-MSMail-Priority': 'High',
          'Importance': 'high'
        }
      };

      // ส่งอีเมลพร้อม retry mechanism
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.transporter.sendMail(mailOptions);
          console.log(`OTP sent successfully to ${email}`);
          return true;
        } catch (error) {
          console.error(`Attempt ${attempt} failed:`, error);
          if (attempt === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    } catch (error) {
      console.error('Failed to send OTP:', error);
      throw new Error('Failed to send OTP email');
    }
  }

  verifyOTP(email, userOTP) {
    const storedData = this.otpStore.get(email);
    
    if (!storedData) {
      return {
        success: false,
        message: 'No OTP found. Please request a new one.'
      };
    }

    const { otp, expiryTime, attempts } = storedData;

    // ตรวจสอบการหมดอายุ
    if (Date.now() > expiryTime) {
      this.otpStore.delete(email);
      return {
        success: false,
        message: 'OTP has expired. Please request a new one.'
      };
    }

    // ตรวจสอบจำนวนครั้งที่ผิด
    if (attempts >= 3) {
      this.otpStore.delete(email);
      return {
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      };
    }

    // ตรวจสอบความถูกต้องของ OTP
    if (otp !== userOTP) {
      this.otpStore.set(email, {
        ...storedData,
        attempts: attempts + 1
      });

      // ลบทันทีถ้าครบ 3 ครั้ง
      if (attempts + 1 >= 3) {
        this.otpStore.delete(email);
      }

      return {
        success: false,
        message: `Invalid OTP. ${2 - attempts} attempts remaining.`
      };
    }

    // ลบ OTP เมื่อยืนยันสำเร็จ
    this.otpStore.delete(email);
    return {
      success: true,
      message: 'OTP verified successfully'
    };
  }
}

export default new OTPService();