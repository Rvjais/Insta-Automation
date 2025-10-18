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
// Allow overriding the model from env; default to a supported model from ListModels output
const GEMINI_MODEL = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";
// Normalize so SDK receives the full resource name (models/...) — user can provide either form
const NORMALIZED_GEMINI_MODEL = GEMINI_MODEL.startsWith('models/') ? GEMINI_MODEL : `models/${GEMINI_MODEL}`;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

if (!GEMINI_API_KEY) {
  console.warn('Warning: GEMINI_API_KEY is not set. Requests to the Generative AI API will fail.');
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
let model;
try {
  model = genAI.getGenerativeModel({ model: NORMALIZED_GEMINI_MODEL });
} catch (err) {
  // Defensive: if SDK throws during model creation, log the error and rethrow so startup fails fast
  console.error(`Failed to initialize generative model '${NORMALIZED_GEMINI_MODEL}':`, err);
  throw err;
}

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
    
    let result;
    try {
      result = await model.generateContent([prompt, imagePart]);
    } catch (err) {
      console.error('GenerateContent error:', err);
      // Helpful handling for the specific 404 case where a model doesn't support generateContent
      if (err && err.status === 404) {
        console.error(`Model '${GEMINI_MODEL}' returned 404 for generateContent.`);
        // As a fallback, call the public ListModels REST endpoint directly using the API key
        try {
          const restEndpoints = [
            `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`,
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
          ];
          const restResults = [];
          for (const url of restEndpoints) {
            try {
              const r = await axios.get(url, { timeout: 5000 });
              restResults.push({ url, status: r.status, data: r.data });
            } catch (restErr) {
              restResults.push({ url, error: restErr.toString() });
            }
          }

          console.error('REST ListModels results for debugging:', JSON.stringify(restResults, null, 2));

          return res.status(500).json({
            error: `Model '${GEMINI_MODEL}' is not available for generateContent. Server logged ListModels output; check server logs.`,
            listModelsDebug: restResults
          });
        } catch (listErr) {
          console.error('Attempt to call REST ListModels failed:', listErr);
          return res.status(500).json({
            error: `Model '${GEMINI_MODEL}' is not available, and listing models via REST failed. Check server logs.`
          });
        }
      }

      // Unknown error; rethrow to be caught by outer catch
      throw err;
    }

    // Extract caption text safely
    let generatedCaption = '';
    try {
      if (result?.response && typeof result.response.text === 'function') {
        generatedCaption = result.response.text();
      } else if (result?.output && Array.isArray(result.output)) {
        // SDKs sometimes return structured output arrays
        generatedCaption = result.output.map(o => o.content || '').join('\n').trim();
      } else if (typeof result === 'string') {
        generatedCaption = result;
      } else {
        generatedCaption = JSON.stringify(result);
      }
    } catch (err) {
      console.error('Failed to extract text from model result:', err);
      generatedCaption = '';
    }

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