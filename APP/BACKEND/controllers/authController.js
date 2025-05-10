//Core logic of our backend

const bcrypt = require("bcryptjs");
const { generateToken, requestHeader } = require("../utils/generateToken");
const { connectToMongoDB } = require("../config/db");

// put initial document in drive collection
async function initializeDriveCollectionDocument(userId, db) {
  const drive = db.collection("Drive");
  const driveDoc = { [userId]: [] };
  // console.log("Type of tokein inside initialize document" , typeof token);

  await drive.insertOne(driveDoc);
}

// put initial document in the post collection
async function initializePostsCollectionDocument(userId, db) {
  const drive = db.collection("Posts");
  const driveDoc = { [userId]: [] };
  // console.log("Type of tokein inside initialize document" , typeof token);

  await drive.insertOne(driveDoc);
}

exports.register = async (req, res) => {
  const { db, client } = await connectToMongoDB();
  const { userId, password, username } = req.body;

  if (!userId || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required" });
  }

  try {
    const users = db.collection("Users");

    // Check if a document with the same username key exists
    const existingUser = await users.findOne({ [userId]: { $exists: true } });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // const token = generateToken(username);

    // Construct the document in the desired format
    // const userDoc = { [username]: [hashedPassword, token] };
    const userDoc = {
      userId: userId,
      username: username,
      password: hashedPassword,
    };
    await users.insertOne(userDoc);
    await initializeDriveCollectionDocument(userId, db);
    await initializePostsCollectionDocument(userId, db);

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ message: "Internal server error" });
  } finally {
    await client.close();
  }
};

//Login

exports.login = async (req, res) => {
  const { db, client } = await connectToMongoDB();
  const { userId, password } = req.query;

  if (!userId || !password) {
    return res.status(400).json({ message: "Missing userId or password" });
  }

  try {
    const users = db.collection("Users");

    // Find user document where key is the username
    const userDoc = await users.findOne({ userId: userId });

    if (!userDoc) {
      return res.status(401).json({ message: "User not found" });
    }

    const hashedPassword = userDoc.password;

    const isMatch = await bcrypt.compare(password, hashedPassword);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }
    const jwtToken = generateToken(userId);

    return res.status(200).json({
      message: "Login successful",
      token: jwtToken,
      user: { userId: userDoc.userId, username: userDoc.username },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    await client.close();
  }
};

exports.detailsOfTeacher = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = await requestHeader(authHeader);

    const subjectName = req.body.subjectName;
    const classes = req.body.classes;

    const input = {
      teacherId: token,
      subjectName: subjectName,
      classes: classes,
    };
    const { db, client } = await connectToMongoDB();
    const collection = await db.collection("TeacherWithClass");

    await collection.insertOne(input);
    await client.close();

    res.json({ message: "data inserted successfully" });
  } catch (error) {
    res.json({ message: "error in inserting into database", error: error });
  }
};
