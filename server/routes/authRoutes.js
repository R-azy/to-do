import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_apple_glass_jwt_secret_2026';

// In-memory fallback user store in case Atlas IP whitelist is still syncing
const fallbackUsers = [];

// Helper to generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
};

// POST /api/auth/signup - Register new user (MongoDB Atlas with fallback)
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email address is required' });
    }
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if MongoDB Atlas is connected
    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ email: cleanEmail });
      if (existingUser) {
        return res.status(400).json({ message: 'This email is already registered. Please login instead.' });
      }

      const user = new User({
        name: name.trim(),
        email: cleanEmail,
        password
      });
      await user.save();

      const token = generateToken(user._id);
      return res.status(201).json({
        message: 'Account created successfully in MongoDB Atlas!',
        user: {
          id: user._id,
          name: user.name,
          email: user.email
        },
        token
      });
    }

    // Fallback if MongoDB Atlas IP connection is pending
    const existingFallback = fallbackUsers.find((u) => u.email === cleanEmail);
    if (existingFallback) {
      return res.status(400).json({ message: 'This email is already registered. Please login instead.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newFallbackUser = {
      id: 'usr_' + Date.now(),
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date()
    };
    fallbackUsers.push(newFallbackUser);

    const token = generateToken(newFallbackUser.id);
    return res.status(201).json({
      message: 'Account created successfully!',
      user: {
        id: newFallbackUser.id,
        name: newFallbackUser.name,
        email: newFallbackUser.email
      },
      token
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error during signup', error: err.message });
  }
});

// POST /api/auth/login - Authenticate user (MongoDB Atlas with fallback)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Please enter your email address' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Please enter your password' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if MongoDB Atlas is connected
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        return res.status(401).json({ message: 'No account found with this email address' });
      }

      const isMatch = await user.matchPassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Incorrect password. Please try again.' });
      }

      const token = generateToken(user._id);
      return res.json({
        message: 'Login successful!',
        user: {
          id: user._id,
          name: user.name,
          email: user.email
        },
        token
      });
    }

    // Fallback if Atlas is pending
    const fallbackUser = fallbackUsers.find((u) => u.email === cleanEmail);
    if (!fallbackUser) {
      return res.status(401).json({ message: 'No account found with this email address' });
    }

    const isMatch = await bcrypt.compare(password, fallbackUser.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password. Please try again.' });
    }

    const token = generateToken(fallbackUser.id);
    return res.json({
      message: 'Login successful!',
      user: {
        id: fallbackUser.id,
        name: fallbackUser.name,
        email: fallbackUser.email
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login', error: err.message });
  }
});

// GET /api/auth/me - Verify current token
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      return res.json({ user });
    }

    const fallbackUser = fallbackUsers.find((u) => u.id === decoded.id);
    if (!fallbackUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      user: {
        id: fallbackUser.id,
        name: fallbackUser.name,
        email: fallbackUser.email
      }
    });
  } catch (err) {
    res.status(401).json({ message: 'Token invalid or expired', error: err.message });
  }
});

export default router;
