const express = require("express");
const multer = require("multer");
const { createPost,editPost,deletePost,viewPost } = require("../controllers/socialMediaController");

const app = express.Router();

// const storage = multer.diskStorage({
//     destination: "./uploads",
//     filename: (req, file, cb) => {
//       const filename = Date.now() + path.extname(file.originalname);
//       cb(null, filename);
//     },
//   });
//   const upload = multer({ storage });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');  // Store in the 'uploads/' folder
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);  // Keep the original filename
  }
});

const upload = multer({ storage: storage });  

app.post("/createPost",upload.single("file"),createPost)
app.get("/viewPost",viewPost)
app.post("/editPost",upload.single("file"),editPost)
app.post("/deletePost",deletePost)

module.exports = app;