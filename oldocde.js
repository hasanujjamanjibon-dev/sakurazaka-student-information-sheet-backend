const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const sharp = require("sharp");
const streamifier = require("streamifier");
require("dotenv").config();
const cloudinary = require("./config/cloudinary");
const mongoose = require("mongoose");
// =====================================
// Environment Variable Check
// =====================================

const requiredEnv = [
  "APP_SCRIPT_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`${key} is missing in .env`);
  }
});
const app = express();
const PORT = process.env.PORT || 5000;

// =====================================
// Middleware
// =====================================
app.use(cors());
app.use(express.json());

const scriptUrl = process.env.APP_SCRIPT_URL;

// =====================================
// Helper Functions
// =====================================

function makeFileName(text) {
  return text
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");
}

async function uploadToCloudinary(file, fileName, folder) {
  if (!file) return "";

  console.log({
    fileName,
    originalName: file.originalname,
    mimeType: file.mimetype,
    originalSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
  });

  // Compress Image
  const compressedBuffer = await sharp(file.buffer)
    .resize({
      width: 800,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 80,
      mozjpeg: true,
    })
    .toBuffer();

  console.log(
    "Compressed Size:",
    `${(compressedBuffer.length / 1024).toFixed(0)} KB`,
  );

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `student-form/${folder}`,
        public_id: fileName,
        overwrite: true,
        resource_type: "image",

        transformation: [
          {
            quality: "auto",
            fetch_format: "auto",
          },
        ],
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary Error:", error);
          return reject(error);
        }

        console.log("Uploaded:", result.secure_url);

        resolve(result.secure_url);
      },
    );

    streamifier.createReadStream(compressedBuffer).pipe(uploadStream);
  });
}

// =====================================
// Multer
// =====================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 15 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG files are allowed."));
    }
  },
});

// =====================================
// Upload Images
// =====================================

app.post(
  "/api/upload-images",
  upload.fields([
    { name: "studentPhoto", maxCount: 1 },
    { name: "sponsorPhoto", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const studentName = req.body.studentName || "";
      const sponsorName = req.body.sponsorName || "";
      const dob = req.body.dob || "";

      const studentFileName = makeFileName(`${studentName}_${dob}`);
      const sponsorFileName = makeFileName(`${studentName}_${sponsorName}`);

      const studentPhoto = await uploadToCloudinary(
        req.files?.studentPhoto?.[0],
        studentFileName,
        "students",
      );

      const sponsorPhoto = await uploadToCloudinary(
        req.files?.sponsorPhoto?.[0],
        sponsorFileName,
        "sponsors",
      );

      res.json({
        success: true,
        studentPhoto,
        sponsorPhoto,
      });
    } catch (error) {
      console.error(error.response?.data || error.message);

      // File Size Error
      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          success: false,
          message: "Image size must be less than 15 MB.",
        });
      }

      // Invalid File Type
      if (error.message === "Only JPG and PNG files are allowed.") {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      // Other Error
      return res.status(500).json({
        success: false,
        message: error.message || "Something went wrong.",
      });
    }
  },
);

// =====================================
// Save Data
// =====================================

app.post("/api/data", async (req, res) => {
  try {
    const response = await axios.post(scriptUrl, req.body, {
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: error.response?.data || error.message,
    });
  }
});

// =====================================
// Get Single Student
// =====================================

app.get("/api/data/:id", async (req, res) => {
  try {
    const response = await axios.get(scriptUrl, {
      params: {
        id: req.params.id,
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});

// =====================================
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "OK",
    uptime: process.uptime(),
  });
});
app.get("/", (req, res) => {
  res.send("API Running...");
});
process.on("SIGINT", () => {
  console.log("Server shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Server shutting down...");
  process.exit(0);
});
// =====================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
