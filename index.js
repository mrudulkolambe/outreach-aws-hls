require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ffmpeg = require("fluent-ffmpeg");
const uuid = require("uuid").v4;
const { fromIni } = require('@aws-sdk/credential-provider-ini');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: fromIni({
    filepath: "./credentials.ini",
    profile: 'default',
  }),
});

const storage = multer.memoryStorage();
const upload = multer({storage});

app.get("/", (req, res) => {
  res.send(`Server is running on: ${PORT}`);
});

const uploadToS3 = async (buffer, key) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
  };
  await s3Client.send(new PutObjectCommand(params));
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
};

const s3Uploadv3SingleFile = async (file, path) => {
	try {
    const filename = `${path}/${uuid()}-${file.originalname.replace(/\s+/g, '')}`
  console.log(filename);
	const param = {
		Bucket: process.env.AWS_S3_BUCKET_NAME,
		Key: filename,
		Body: file.buffer,
	};
	let data = await s3Client.send(new PutObjectCommand(param))
  console.log(data);
	const location = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${param.Key}`;
	return { url: location, type: file.mimetype.split("/")[0] }
  } catch (error) {
    console.log(error);
  }
}

app.post("/upload", upload.array("files"), async (req, res) => {
  console.log(req.files[0], req.body.path)
  try {
      const media = await s3Uploadv3SingleFile(req.files[0], req.body.path);
      return res.json({ status: "success", media });
  } catch (err) {
      return res.json({ status: "error", media: null });
  }
});

app.post("/multi-upload", upload.array("files", 10), async (req, res) => {
  try {
    const files = req.files;
    const timestamp = Date.now();
    const uploadPromises = files.map(async (file) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const fileName = path.basename(file.originalname, ext);
      
      if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
        const imageUrl = await uploadToS3(file.buffer, `post/${timestamp}/images/${fileName}${ext}`);
        return { type: "image", url: imageUrl };
      } else if (ext === ".mp4" || ext === ".mov") {
        const videoId = uuid();
        const tempFilePath = path.join(__dirname, `${videoId}${ext}`);
        const outputDir = path.join(__dirname, "hls", videoId);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(tempFilePath, file.buffer);

        return new Promise((resolve, reject) => {
          ffmpeg(tempFilePath)
            .outputOptions([
              "-preset", "veryfast",
              "-threads", "4",
              "-hls_time", "10",
              "-hls_playlist_type", "vod",
              "-hls_segment_filename", `${outputDir}/%03d.ts`
            ])
            .output(`${outputDir}/index.m3u8`)
            .on("end", async () => {
              try {
                const files = fs.readdirSync(outputDir);
                const uploadPromises = files.map((file) => {
                  const filePath = path.join(outputDir, file);
                  const fileBuffer = fs.readFileSync(filePath);
                  const fileKey = `post/${timestamp}/videos/${videoId}/${file}`;
                  return uploadToS3(fileBuffer, fileKey);
                });

                await Promise.all(uploadPromises);

                fs.unlinkSync(tempFilePath);
                resolve({ type: "video", url: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/post/${timestamp}/videos/${videoId}/index.m3u8` });
              } catch (uploadErr) {
                console.error("Error uploading HLS files to S3:", uploadErr);
                reject({ status: "error", message: "Failed to upload HLS files" });
              }
            })
            .on("error", (err) => {
              console.error("Error processing video with ffmpeg:", err);
              reject({ status: "error", message: "Failed to process video" });
            })
            .run();
        }).finally(() => {
          fs.rmSync(outputDir, { recursive: true, force: true });
        });
      } else {
        return { type: "error", message: "Unsupported file type", fileName: file.originalname };
      }
    });

    const results = await Promise.all(uploadPromises);
    res.json({ status: "success", results });
  } catch (err) {
    console.error("Error processing upload:", err);
    res.status(500).json({ status: "error", message: "File upload failed" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on: ${PORT}`);
});
