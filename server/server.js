import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import todoRoutes from './routes/todoRoutes.js';
import authRoutes from './routes/authRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

// Handle unexpected errors gracefully without crashing server
process.on('uncaughtException', (err) => {
  console.error('Caught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'] }));
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Request logger for dev
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Database Connection Status Variable
let isDbConnected = false;

// Connect to MongoDB Atlas with auto-retry
const connectWithRetry = () => {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in .env file!');
    return;
  }
  console.log('⏳ Connecting to MongoDB Atlas...');
  mongoose
    .connect(MONGODB_URI, {
      dbName: 'todo_app',
      serverSelectionTimeoutMS: 5000
    })
    .then(() => {
      isDbConnected = true;
      console.log('✅ Connected to MongoDB Atlas successfully!');
    })
    .catch((err) => {
      isDbConnected = false;
      console.error('❌ MongoDB Connection Error:', err.message);
      console.log('ℹ️ Retrying connection in 15 seconds...');
      setTimeout(connectWithRetry, 15000);
    });
};

connectWithRetry();

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: isDbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Auth API Routes
app.use('/api/auth', authRoutes);

// Todo API Routes
app.use('/api/todos', todoRoutes);

// Root fallback
app.get('/', (req, res) => {
  res.send('TaskFlow Todo API Server with Express & MongoDB is running!');
});

// Global Error Handler
app.use((err, req, res, _next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
  console.log(`📡 API Endpoints available at http://localhost:${PORT}/api/todos`);
});
