import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String,
    required: true
  },
  isValid: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  userAgent: String,
  ipAddress: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ดึง sessions ที่ active ของ user
sessionSchema.statics.getActiveSessions = function(userId) {
  return this.find({
    userId,
    isValid: true
  }).sort('-lastActivity');
};

export default mongoose.model('Session', sessionSchema);