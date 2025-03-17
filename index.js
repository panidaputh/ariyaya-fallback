require("dotenv").config();
const express = require("express");
const { WebhookClient } = require("dialogflow-fulfillment");
const admin = require("firebase-admin");

// ตรวจสอบ environment variables ที่จำเป็น
const requiredEnvVars = [
  "FIREBASE_TYPE",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_DATABASE_URL",
];

requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName} [STATUS: 500]`);
    process.exit(1);
  }
});

// กำหนดค่า Firebase Service Account
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

// เริ่มการเชื่อมต่อ Firebase
console.log("🔄 Attempting to connect to Firebase... [STATUS: PENDING]");
console.log("📝 Firebase config:", {
  projectId: serviceAccount.project_id,
  clientEmail: serviceAccount.client_email,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

let db;
try {
  // เริ่มต้นการเชื่อมต่อ Firebase
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  db = admin.database();

  // ทดสอบการเชื่อมต่อและการเขียนข้อมูล
  db.ref(".info/connected").on("value", async (snapshot) => {
    if (snapshot.val() === true) {
      console.log("✅ Connected to Firebase Realtime Database [STATUS: 200]");

      try {
        // ทดสอบเขียนข้อมูล
        await db.ref("system_status").set({
          last_connection: new Date().toISOString(),
          status: "online",
        });
        console.log("✅ Firebase write test successful [STATUS: 200]");
      } catch (writeError) {
        console.error(`❌ Firebase write test failed: ${writeError} [STATUS: 500]`);
      }
    } else {
      console.log("❌ Disconnected from Firebase Realtime Database [STATUS: 503]");
    }
  });

  // ทดสอบการอ่านข้อมูล
  db.ref("system_status")
    .once("value")
    .then(() => console.log("✅ Firebase read test successful [STATUS: 200]"))
    .catch((error) => console.error(`❌ Firebase read test failed: ${error} [STATUS: 500]`));
} catch (initError) {
  console.error(`❌ Firebase initialization error: ${initError} [STATUS: 500]`);
  process.exit(1);
}

// ฟังก์ชันสำหรับแปลงเวลาเป็นเวลาประเทศไทย
function getThaiTime() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
}

// เพิ่มฟังก์ชันตรวจสอบเวลาทำการ (เวลาไทย)
function isWithinBusinessHours() {
  const thaiTime = getThaiTime();
  const day = thaiTime.getDay(); // 0 = อาทิตย์, 1-6 = จันทร์-เสาร์
  const hour = thaiTime.getHours();
  const minutes = thaiTime.getMinutes();
  const currentTime = hour + minutes / 60;

  console.log(
    `🕒 Current Thai time: ${thaiTime.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
    })}`
  );
  console.log(`📅 Day: ${day}, Hour: ${hour}, Minutes: ${minutes}`);

  // วันอาทิตย์ (9:00-18:00)
  if (day === 0) {
    return currentTime >= 9 && currentTime < 18;
  }
  // วันจันทร์-เสาร์ (9:00-24:00)
  else if (day >= 1 && day <= 6) {
    return currentTime >= 9 && currentTime < 18;
  }
  return false;
}

// ตั้งค่า Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware สำหรับ logging HTTP requests
app.use((req, res, next) => {
  const start = Date.now();
  const thaiTime = getThaiTime();
  
  // Original response methods
  const originalSend = res.send;
  const originalJson = res.json;
  const originalStatus = res.status;
  
  // Override status method
  res.status = function(code) {
    res.statusCode = code;
    return originalStatus.apply(res, arguments);
  };
  
  // Override send method
  res.send = function(body) {
    const duration = Date.now() - start;
    console.log(`🌐 ${req.method} ${req.originalUrl} [STATUS: ${res.statusCode}] - ${duration}ms`);
    return originalSend.apply(res, arguments);
  };
  
  // Override json method
  res.json = function(body) {
    const duration = Date.now() - start;
    console.log(`🌐 ${req.method} ${req.originalUrl} [STATUS: ${res.statusCode}] - ${duration}ms`);
    return originalJson.apply(res, arguments);
  };
  
  console.log(`📥 Incoming request: ${req.method} ${req.originalUrl} [STATUS: PENDING]`);
  next();
});

// Route สำหรับตรวจสอบสถานะเซิร์ฟเวอร์
app.get("/", (req, res) => {
  const thaiTime = getThaiTime();
  res.status(200).send({
    status: "online",
    timestamp: thaiTime.toISOString(),
    thai_time: thaiTime.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
    service: "Dialogflow Webhook",
    firebase_status: db ? "initialized" : "not_initialized",
  });
});

// Webhook endpoint สำหรับ Dialogflow
app.post("/webhook", async (req, res) => {
  const thaiTime = getThaiTime();
  console.log("🔗 Received webhook request:", {
    timestamp: thaiTime.toISOString(),
    thai_time: thaiTime.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
    headers: req.headers,
    body_size: JSON.stringify(req.body).length,
  });

  const agent = new WebhookClient({ request: req, response: res });

  // ฟังก์ชันจัดการ Fallback Intent
  async function handleFallback(agent) {
    try {
      const userId =
        agent.originalRequest?.payload?.data?.source?.userId || "unknown";
      console.log(`👤 Processing fallback for user: ${userId}`);

      const userRef = db.ref(`users/${userId}`);
      const snapshot = await userRef.once("value");
      const userData = snapshot.val() || {};
      const lastFallbackTime = userData.lastFallbackTime || 0;
      const currentTime = Date.now();
      const COOLDOWN_PERIOD = 18000000;

      if (currentTime - lastFallbackTime >= COOLDOWN_PERIOD) {
        try {
          await userRef.update({
            lastFallbackTime: currentTime,
            lastUpdated: getThaiTime().toISOString(),
            userId: userId,
          });
          console.log(`✅ Updated fallback time for user: ${userId} [STATUS: 200]`);
          
          // ตรวจสอบเวลาทำการและส่งข้อความตามเงื่อนไข
          const businessHours = isWithinBusinessHours();
          console.log(`⏰ Business hours check: ${businessHours ? 'In hours' : 'After hours'} [STATUS: 200]`);
          
          if (businessHours) {
            agent.add("รบกวนคุณลูกค้ารอเจ้าหน้าที่ฝ่ายบริการตอบกลับอีกครั้งนะคะ คุณลูกค้าสามารถพิมพ์คำถามไว้ได้เลยค่ะ");
          } else {
            agent.add(
              "รบกวนคุณลูกค้ารอเจ้าหน้าที่ฝ่ายบริการตอบกลับอีกครั้งนะคะ ทั้งนี้เจ้าหน้าที่ฝ่ายบริการทำการจันทร์-เสาร์ เวลา 09.00-00.00 น. และวันอาทิตย์ทำการเวลา 09.00-18.00 น. ค่ะ คุณลูกค้าสามารถพิมพ์คำถามไว้ได้เลยนะคะ เจ้าหน้าที่จะทำการตอบกลับอีกครั้งในวเลาทำการค่ะ"
            );
          }
        } catch (dbError) {
          console.error(`❌ Database update error for user ${userId}: ${dbError} [STATUS: 500]`);
          throw dbError;
        }
      } else {
        agent.add("");
        console.log(`ℹ️ User ${userId} is in cooldown period [STATUS: 200]`);
      }
    } catch (error) {
      console.error(`❌ Error in handleFallback: ${error} [STATUS: 500]`);
      agent.add("ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    }
  }

  const intentMap = new Map();
  intentMap.set("Default Fallback Intent", handleFallback);

  try {
    await agent.handleRequest(intentMap);
    console.log(`✅ Successfully processed webhook request [STATUS: 200]`);
  } catch (error) {
    console.error(`❌ Error handling webhook request: ${error} [STATUS: 500]`);
    res.status(500).send({ error: "Internal server error" });
  }
});

// เริ่มต้น server
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  const thaiTime = getThaiTime();
  console.log(`
🚀 Server is running [STATUS: 200]
📋 Details:
- Port: ${port}
- Environment: ${process.env.NODE_ENV || "development"}
- Firebase Project: ${process.env.FIREBASE_PROJECT_ID}
- Database URL: ${process.env.FIREBASE_DATABASE_URL}
- Server Time: ${new Date().toISOString()}
- Thai Time: ${thaiTime.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
  `);
});

// Monitor server events
server.on('error', (error) => {
  console.error(`💥 Server error: ${error} [STATUS: 500]`);
});

// จัดการ uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error(`💥 Uncaught Exception: ${error} [STATUS: 500]`);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error(`💥 Unhandled Rejection: ${error} [STATUS: 500]`);
  process.exit(1);
});