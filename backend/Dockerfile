FROM node:18-slim

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# ไม่ต้องกำหนด MONGO_URI ตรงนี้เพราะจะรับค่าจาก docker-compose
EXPOSE 5000

# เพิ่ม script รัน init.js ก่อน start server
CMD ["sh", "-c", "node scripts/createAdmin.js && npm start"]