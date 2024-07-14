const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const uuid = require('uuid').v4;

function getFileExtension(filename) {
	const lastDotIndex = filename.lastIndexOf('.');
	if (lastDotIndex !== -1 && lastDotIndex !== 0 && lastDotIndex !== filename.length - 1) {
		return filename.substring(lastDotIndex + 1);
	} else {
		return '';
	}
}

exports.s3Uploadv3SingleFile = async (file, path) => {
	const s3Client = new S3Client({
		region: process.env.AWS_REGION,
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_KEY,
		}
	});
	const filename = `${path}/${uuid()}-${file.originalname.replace(/\s+/g, '')}`
	const param = {
		Bucket: process.env.AWS_S3_BUCKET_NAME,
		Key: filename,
		Body: file.buffer,
	};
	await s3Client.send(new PutObjectCommand(param))
	const location = `https://${param.Bucket}.s3.amazonaws.com/${param.Key}`;
	return { url: location, type: getFileExtension(file.originalname) }
}

exports.s3Uploadv3MultipleFiles = async (files, path) => {
	const s3Client = new S3Client({
		region: process.env.AWS_REGION,
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_KEY
		}
	});
	let media = [];
	const params = files.map((file) => {
		const filename = `${path}/${uuid()}-${file.originalname.replace(/\s+/g, '')}`
		return {
			Bucket: process.env.AWS_S3_BUCKET_NAME,
			Key: filename,
			Body: file.buffer,
		};
	});

	await Promise.all(
		params.map((param) => {
			media.push({ url: `https://${param.Bucket}.s3.amazonaws.com/${param.Key}`, type: getFileExtension(param.Key) })
			s3Client.send(new PutObjectCommand(param))
		})
	);
	return media;
}