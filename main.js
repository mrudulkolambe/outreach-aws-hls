require("dotenv").config();
const express = require("express");
const cors = require("cors");
var bodyParser = require('body-parser')
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg")
const uuid = require('uuid').v4;


const { s3Uploadv3SingleFile, s3Uploadv3MultipleFiles } = require("./aws/s3Services");
const multer = require("multer");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ limit:'500mb', extended: true, parameterLimit: 100000}));



const storage = multer.memoryStorage();

const uploadToS3 = async (fileContent, bucketName, key) => {
    const params = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent,
        ACL: 'public-read'
    };
    await s3Client.send(new PutObjectCommand(params));
    return `https://${bucketName}.s3.amazonaws.com/${key}`;
};

const createHlsStream = (filePath, outputDir) => {
    return new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .outputOptions([
                '-profile:v baseline',
                '-level 3.0',
                '-s 640x360',
                '-start_number 0',
                '-hls_time 10',
                '-hls_list_size 0',
                '-f hls'
            ])
            .output(path.join(outputDir, 'playlist.m3u8'))
            .on('end', () => {
                resolve();
            })
            .on('error', (err) => {
                reject(err);
            })
            .run();
    });
};

const processVideo = async (fileBuffer, filename) => {
    const tempDir = path.join(__dirname, 'temp', uuid());
    fs.mkdirSync(tempDir, { recursive: true });

    const inputVideoPath = path.join(tempDir, filename);
    fs.writeFileSync(inputVideoPath, fileBuffer);

    await createHlsStream(inputVideoPath, tempDir);

    const files = fs.readdirSync(tempDir);
    const uploadPromises = files.map(async (file) => {
        const filePath = path.join(tempDir, file);
        const fileContent = fs.readFileSync(filePath);
        const key = `hls/${uuid()}-${file}`;
        return await uploadToS3(fileContent, process.env.AWS_S3_BUCKET_NAME, key);
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    const playlistUrl = uploadedFiles.find(url => url.endsWith('.m3u8'));
    fs.rmdirSync(tempDir, { recursive: true });

    return { playlistUrl, segmentUrls: uploadedFiles.filter(url => url.endsWith('.ts')) };
};

const fileFilter = (req, file, cb) => {
    if (file.originalname.includes('jpg') || file.originalname.includes('jpeg') || file.originalname.includes('png') || file.originalname.includes('mp4') || file.originalname.includes('mov') ) {
        cb(null, true);
    } else {
        console.log("errror")
        cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE"), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const media = await s3Uploadv3SingleFile(req.files[0], req.body.path);
        return res.json({ status: "success", media });
    } catch (err) {
        return res.json({ status: "error", media: null });
    }
});

app.post("/multi-upload", upload.array("file"), async (req, res) => {
    try {
        const uploadResults = await Promise.all(req.files.map(async (file) => {
            console.log(file)
            if (file.mimetype.startsWith('image')) {
                const key = `images/${uuid()}-${file.originalname.replace(/\s+/g, '')}`;
                const url = await uploadToS3(file.buffer, process.env.AWS_S3_BUCKET_NAME, key);
                return { type: 'image', url };
            } else if (file.mimetype.startsWith('video')) {
                console.log("VIDEO PICKED")
                const { playlistUrl, segmentUrls } = await processVideo(file.buffer, file.originalname);
                return { type: 'video', playlistUrl, segmentUrls };
            }
        }));

        return res.json({ status: "success", files: uploadResults });
    } catch (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ status: "error", message: err.message });
        } else {
            return res.status(500).json({ status: "error", message: err.message });
        }
    }
});

app.listen(process.env.PORT, () => console.log(`Server Listening at PORT:${process.env.PORT}`));