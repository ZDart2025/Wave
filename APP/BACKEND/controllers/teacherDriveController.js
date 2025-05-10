const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { connectToMongoDB } = require("../config/db");
const {
  decryptToken,
  findTheTokenFromJwt,
  requestHeader,
} = require("../utils/generateToken");

const multer = require("multer");
const { log } = require("console");
require("dotenv").config();

const KEYFILEPATH = "controllers/credentials.json";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata",
];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});
const driveService = google.drive({ version: "v3", auth });

const folderId = "1bmFALmb2ChoKIDDzvoVgnnx8UeGr4D2o";

// Function to get MIME type based on file extension
function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    ".pdf": "application/pdf",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

async function uploadToDrive(filePath) {
  // const fileName = generateFilename(filePath);

  const fileName = path.basename(filePath); // "Kite IIIYear Milestone 2 Assignment.pdf"

  // Extract filename without extension
  // const fileName = path.parse(fullFileName).name;
  const mimeType = getMimeType(filePath);

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
    supportsAllDrives: true,
  };

  const media = {
    mimeType: mimeType,
    body: fs.createReadStream(filePath),
  };

  const file = await driveService.files.create({
    resource: fileMetadata,
    media: media,
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = file.data.id;

  await driveService.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  const previewUrl = `https://drive.google.com/file/d/${fileId}/view`;
  return { url: previewUrl, fileId, fileName };
}

async function saveToMongoDB(input) {
  const { db, client } = await connectToMongoDB();
  const collection = db.collection("Drive");

  try {
    // console.log("Token in saveToMongoDB:", token);

    // Check if a document exists with the token as a key
    // token = token.uuid;
    // const tokenDoc = await collection.findOne({ [token]: { $exists: true } });

    // if (!tokenDoc) {
    //   console.log(" Token was not present");
    //   return { success: false, message: "Token was not present" };
    // }

    // //  If token exists, push input into the corresponding array
    // const update = {
    //   $push: {
    //     [token]: input,
    //   },
    // };

    // await collection.updateOne({ [token]: { $exists: true } }, update);

    await collection.insertOne(input);
    console.log(" Data inserted successfully");
    return { success: true, message: "Data inserted successfully" };
  } catch (error) {
    console.error(" Error saving to MongoDB:", error);
    return { success: false, message: "MongoDB error", error };
  } finally {
    await client.close();
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // Store in the 'uploads/' folder
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Keep the original filename
  },
});

const upload = multer({ storage: storage });

exports.uploadFileToDriveAndDB = [
  // First step: handle file upload with Multer middleware
  upload.single("file"),

  // Then process the uploaded file
  async (req, res) => {
    try {
      const { subjectName, classWithSection, unitNo } = req.body;
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      // Get the full path to the uploaded file
      const AbsolutefilePath = path.resolve(req.file.path);

      // const filePath = path.relative(__dirname, AbsolutefilePath);
      const filePath = path.relative(process.cwd(), AbsolutefilePath);

      console.log("filePath", filePath);

      // const { name, teacherId } = req.body;

      // Validate file extension
      const extension = path.extname(filePath).toLowerCase();
      if (![".pdf", ".docx", ".pptx", ".mp3"].includes(extension)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid file type. Only .pdf, .docx, .pptx, and .mp3 are allowed.",
        });
      }

      const authHeader = req.headers["authorization"];
      console.log("authHeader:", authHeader);

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Missing or invalid token" });
      }

      const json_token = authHeader.trim().split(" ")[1]; // remove accidental spaces
      // console.log("token:", token);
      // const json_token = findTheTokenFromJwt();
      const token = decryptToken(json_token);
      const new_token = token.uuid;
      console.log("token after decrypted => ", new_token);
      // Assuming uploadToDrive() and saveToMongoDB are defined elsewhere
      const { url, fileId, fileName } = await uploadToDrive(filePath);
      const fileType = extension.substring(1); // Remove the dot

      const input = {
        teacherId: new_token,
        subjectName: subjectName,
        classWithSection: classWithSection,
        unitNo: unitNo,
        file_url: url,
        file_id: fileId,
        file_name: fileName,
        file_type: fileType,
        timestamp: new Date(),
      };

      await saveToMongoDB(input);

      return res.status(200).json({
        success: true,
        message: "File Uploaded Successfully",
      });
    } catch (err) {
      console.error("Upload Error:", err);
      return res.status(500).json({
        success: false,
        message: "Upload failed.",
        error: err.message,
      });
    }
  },
];

// This will delte the file from the drive
exports.deleteFileFromDriveAndDB = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing or invalid token" });
    }

    const du_token = authHeader.split(" ")[1];
    const de_token = decryptToken(du_token);
    const token = de_token.uuid;
    const { fileId } = req.body;

    // Delete from Google Drive
    try {
      await driveService.files.delete({ fileId: fileId });
    } catch (err) {
      console.warn(`Drive file not found or already deleted: ${fileId}`);
    }

    // Delete from MongoDB
    const { db, client } = await connectToMongoDB();
    const collection = db.collection("Drive");

    const result = await collection.deleteOne({ file_id: fileId });
    await client.close();

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found in database for this token.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `File deleted Successfully.`,
    });
  } catch (err) {
    console.error("Delete Error:", err);
    return res.status(500).json({ success: false, message: "Delete failed." });
  }
};

// rename the file in the drive as well as in the mongodb
exports.renameFileOnDrive = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    console.log("authheader", authHeader);
    // Check if token exists in header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing or invalid token" });
    }

    const dummy_token = authHeader.split(" ")[1]; // Get the actual token part

    const decrypted_token = decryptToken(dummy_token);
    const token = decrypted_token.uuid;

    console.log("token", token);

    const { fileId, newName } = req.body;

    if (!fileId || !newName) {
      return res.status(400).json({
        success: false,
        message: "Both fileId and newName are required.",
      });
    }

    // Rename file in Google Drive
    await driveService.files.update({
      fileId,
      requestBody: {
        name: newName,
      },
    });

    // Connect to MongoDB
    const { db, client } = await connectToMongoDB();
    const collection = db.collection("Drive");

    const result = await collection.updateOne(
      { file_id: fileId }, // Filter condition
      { $set: { file_name: newName } } // Update operation
    );

    if (result.modifiedCount > 0) {
      console.log("✅ Filename Updated Successfully.");
      res.status(200).json({ message: "✅ Filename Updated Successfully." });
    } else {
      console.log("⚠️ No document found with the given fileid.");
      res.json({ message: "⚠️ No document found with the given file id" });
    }
  } catch (err) {
    console.error("Rename Error:", err);
    return res.status(500).json({
      success: false,
      message: "Rename failed.",
      error: err.message,
    });
  }
};

// This function will give all the files uploaded to the drive by individual teacher

exports.filesUploadedByTeacher = async (req, res) => {
  try {
    // Header is "authorization : Bearer 5243453423fds"
    const authHeader = req.headers["authorization"];
    console.log("authheader", authHeader);
    // Check if token exists in header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing or invalid token" });
    }
    const duu_token = authHeader.split(" ")[1]; // Get the actual token part
    const dee_token = decryptToken(duu_token);
    const token = dee_token.uuid;
    console.log("token", token);
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is missing in request headers.",
      });
    }

    const { db, client } = await connectToMongoDB();
    const collection = db.collection("Drive");

    const document = await collection.find({ teacherId: token }).toArray();

    if (!document) {
      return res
        .status(404)
        .json({ message: "No data found for the given ID" });
    }

    // Return the value (array) of the dynamic field
    res.json({ posts: document });

    await client.close();
  } catch (err) {
    console.error("Error fetching token data:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.teacherWithClass = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = requestHeader(authHeader);

    const { db, client } = await connectToMongoDB();
    const collection = db.collection("TeacherWithClass");

    const result = await collection.find({ teacherId: token }).toArray();

    await client.close();
    if (!result) {
      res.status(400).json({ message: "teacher was not found" });
    } else {
      res.status(200).json({
        teacherdetails: result,
        message: "teacher details fetch from database successfully.",
      });
    }
  } catch (error) {
    console.log("error", error);
    res.status(500).json({ message: "error in fetching data", error: error });
  }
};
