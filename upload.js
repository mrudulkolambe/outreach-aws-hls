require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ffmpeg = require("fluent-ffmpeg");
const uuid = require("uuid").v4;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.get("/", (req, res) => {
  res.send(`Server is running on: http://localhost:${PORT}`);
});

// Helper functions
const uploadToS3 = async (buffer, key, contentType) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  };

  await s3Client.send(new PutObjectCommand(params));
  return `https://${params.Bucket}.s3.amazonaws.com/${params.Key}`;
};

// Endpoint to handle file uploads
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
      // Directly upload images
      const imageUrl = await uploadToS3(file.buffer, `images/${uuid()}${ext}`, file.mimetype);
      return res.json({ status: "success", url: imageUrl });
    } else if (ext === ".mp4" || ext === ".mov") {
      // Process and upload videos
      const videoId = uuid();
      const tempFilePath = path.join(__dirname, `${videoId}${ext}`);
      const outputDir = path.join(__dirname, "hls", videoId);

      // Create directory for HLS output
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save the video temporarily
      fs.writeFileSync(tempFilePath, file.buffer);

      // Convert video to HLS
      ffmpeg(tempFilePath)
        .outputOptions([
          "-hls_time 10",
          "-hls_playlist_type vod",
          `-hls_segment_filename ${outputDir}/%03d.ts`
        ])
        .output(`${outputDir}/output.m3u8`)
        .on("end", async () => {
            console.log("end");
          // Upload all HLS segments and playlist to S3
          const files = fs.readdirSync(outputDir);
          const uploadPromises = files.map((file) => {
            const filePath = path.join(outputDir, file);
            const fileBuffer = fs.readFileSync(filePath);
            const fileKey = `videos/${videoId}/${file}`;
            return uploadToS3(fileBuffer, fileKey, "video/MP2T");
          });

          await Promise.all(uploadPromises);

          // Clean up temporary files
          fs.unlinkSync(tempFilePath);
          fs.rmdirSync(outputDir, { recursive: true });

          const playlistUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/videos/${videoId}/output.m3u8`;
          res.json({ status: "success", url: playlistUrl });
        })
        .run();
    } else {
      return res.status(400).json({ status: "error", message: "Unsupported file type" });
    }
  } catch (err) {
    console.log(":line 101")
    console.error(err);
    res.status(500).json({ status: "error", message: "File upload failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on: http://localhost:${PORT}`);
});
