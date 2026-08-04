require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const streamifier = require("streamifier");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const app = express();
const PORT = process.env.PORT || 5000;
const cloudinary = require("./config/cloudinary");

app.use(
  cors({
    ORIGIN: [
      "https://sakurazaka-student-information-form.vercel.app",
      "https://sakurazaka-student-information-form.netlify.app",
      "http://localhost:5173",
    ],
  }),
);
app.use(express.json());

const requiredEnv = [
  "MONGODB_URI",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`${key} is missing in .env`);
  }
});

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Helper Function
function makeFileName(text) {
  return text
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");
}
let db;
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
      const dob = req.body.studentDob || "";

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

/* uploadToCloudinary */

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
app.get("/api/data", async (req, res) => {
  try {
    const students = await db
      .collection("students")
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      students,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.get("/api/data/:id", async (req, res) => {
  try {
    const student = await db.collection("students").findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.json({
      success: true,
      student,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.put("/api/data/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Student ID",
      });
    }

    const result = await db.collection("students").updateOne(
      {
        _id: new ObjectId(req.params.id),
      },
      {
        $set: {
          ...req.body,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.json({
      success: true,
      message: "Student updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.delete("/api/data/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Student ID",
      });
    }

    const result = await db.collection("students").deleteOne({
      _id: new ObjectId(req.params.id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    res.json({
      success: true,
      message: "Student deleted successfully",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// app.get("/api/students", async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 25;
//     const search = req.query.search || "";

//     const skip = (page - 1) * limit;

//     const filter = search
//       ? {
//           $or: [
//             {
//               "studentInformation.studentName": {
//                 $regex: search,
//                 $options: "i",
//               },
//             },
//             {
//               "sponsorInformation.sponsorName": {
//                 $regex: search,
//                 $options: "i",
//               },
//             },
//             {
//               applicationId: {
//                 $regex: search,
//                 $options: "i",
//               },
//             },
//           ],
//         }
//       : {};

//     const collection = db.collection("students");

//     const total = await collection.countDocuments(filter);

//     const students = await collection
//       .find(filter)
//       .sort({
//         createdAt: -1,
//       })
//       .skip(skip)
//       .limit(limit)
//       .toArray();

//     res.json({
//       success: true,
//       total,
//       page,
//       limit,
//       totalPages: Math.ceil(total / limit),
//       students,
//     });
//   } catch (err) {
//     console.error(err);

//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// });
app.get("/api/students", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 12;
    const q = req.query.q?.trim() || "";

    const skip = (page - 1) * limit;

    const collection = db.collection("students");

    const filter = q
      ? {
          $or: [
            {
              "studentInformation.studentName": {
                $regex: q,
                $options: "i",
              },
            },
            {
              "sponsorInformation.sponsorName": {
                $regex: q,
                $options: "i",
              },
            },
            {
              applicationId: {
                $regex: q,
                $options: "i",
              },
            },
          ],
        }
      : {};

    const total = await collection.countDocuments(filter);

    const students = await collection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      students,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.get("/api/statistics", async (req, res) => {
  try {
    const collection = db.collection("students");

    const total = await collection.countDocuments();

    const now = new Date();

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const thisMonth = await collection.countDocuments({
      createdAt: {
        $gte: monthStart,
      },
    });

    const today = await collection.countDocuments({
      createdAt: {
        $gte: todayStart,
      },
    });

    res.json({
      success: true,
      total,
      thisMonth,
      today,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/api/data", async (req, res) => {
  try {
    const collection = db.collection("students");

    const result = await collection.insertOne({
      ...req.body,
      applicationId: "SKZ-" + new Date().getFullYear() + "-" + Date.now(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({
      success: true,
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    db = client.db("student-form");

    await db.collection("students").createIndexes([
      {
        key: {
          "studentInformation.studentName": 1,
        },
        name: "studentName_index",
      },
      {
        key: {
          "sponsorInformation.sponsorName": 1,
        },
        name: "sponsorName_index",
      },
      {
        key: {
          applicationId: 1,
        },
        name: "applicationId_index",
        unique: true,
      },
      {
        key: {
          createdAt: -1,
        },
        name: "createdAt_index",
      },
    ]);

    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
}

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
  });
});

app.get("/", (req, res) => {
  res.send("API Running...");
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route Not Found",
  });
});
process.on("SIGINT", () => {
  client.close();
  process.exit();
});

process.on("SIGTERM", () => {
  client.close();
  process.exit();
});

let connected = false;

module.exports = async (req, res) => {
  if (!connected) {
    await connectDB();
    connected = true;
  }

  return app(req, res);
};
