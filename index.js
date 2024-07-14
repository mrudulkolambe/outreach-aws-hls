require("dotenv").config();
const express = require("express");
const cors = require("cors");
var bodyParser = require('body-parser')

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ limit:'500mb', extended: true, parameterLimit: 100000}));

const PORT = process.env.PORT || 8080;


const { s3Uploadv3SingleFile, s3Uploadv3MultipleFiles } = require("./aws/s3Services");
const multer = require("multer");

app.get("/", (req, res) => {
    res.send(`AWS app running on: http://localhost:${PORT}`)
})

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (file.originalname.includes('jpg') || file.originalname.includes('jpeg') || file.originalname.includes('png') || file.originalname.includes('mp4') || file.originalname.includes('mov') ) {
        cb(null, true);
    } else {
        console.log("errror")
        cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE"), false);
    }
};

const fileFilterVideo = (req, file, cb) => {
    if (file.mimetype.includes('video')) {
        cb(null, true);
    } else {
        cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE"), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
});

const uploadVideo = multer({
    storage: storage,
    fileFilter: fileFilter,
});

app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const media = await s3Uploadv3SingleFile(req.file, req.body.path);
        return res.json({ status: "success", media });
    } catch (err) {
        return res.json({ status: "error", media: null });
    }
});

app.post("/multi-upload", upload.array("file"), async (req, res) => {
    try {
        const media = await s3Uploadv3MultipleFiles(req.files, req.body.path);
        return res.json({ status: "success", media });
    } catch (err) {
        return res.json({ status: "error", media: [] });
    }
});

app.listen(PORT, () => {
    console.log(`AWS app running on: http://localhost:${PORT}` )
})