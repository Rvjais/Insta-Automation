// All 'require' statements are now 'import'
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import exifParser from 'exif-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import cors from 'cors';

// Initialize dotenv to load environment variables
dotenv.config();

const app = express();
const port = 4000;

// Use memory storage for multer to handle the file in-memory
const upload = multer({ storage: multer.memoryStorage() });

// Get API keys from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Middleware
app.use(cors()); // Allow requests from your React frontend

app.post('/generate-post', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded.' });
  }

  try {
    // 1. Extract Metadata
    let metadataText = "No EXIF data found.";
    try {
      const parser = exifParser.create(req.file.buffer);
      const result = parser.parse();
      metadataText = `Date: ${new Date(result.tags.DateTimeOriginal * 1000).toLocaleString()}, Camera: ${result.tags.Model || 'N/A'}`;
    } catch (err) {
      console.log("Could not parse EXIF data.");
    }
    
    // 2. Generate Caption with Gemini 🧠
    const prompt = `Generate an engaging Instagram caption for this image. Use a friendly and slightly informal tone. Include relevant emojis and 3-5 relevant hashtags. Use the following metadata for context if it helps: ${metadataText}`;

    const imagePart = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };
    
    const result = await model.generateContent([prompt, imagePart]);
    const generatedCaption = result.response.text();

    // 3. Trigger Make.com Webhook 🚀
    await axios.post(MAKE_WEBHOOK_URL, {
        caption: generatedCaption,
        imageBase64: req.file.buffer.toString("base64"), 
        mimeType: req.file.mimetype,
        fileName: req.file.originalname // Sending fileName as recommended
    });

    res.json({ 
        message: 'Successfully generated caption and triggered Make.com workflow.',
        caption: generatedCaption 
    });

  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Failed to process the image.' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});