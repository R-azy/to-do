import express from 'express';
import jwt from 'jsonwebtoken';
import Todo from '../models/Todo.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'taskflow_apple_glass_jwt_secret_2026';

// Optional auth helper: if token is present, attaches user id
const getUserId = (req) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded.id;
    }
  } catch {
    // Continue without user id
  }
  return null;
};

// GET all todos
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = userId ? { userId } : {};
    const todos = await Todo.find(query).sort({ createdAt: -1 });
    res.json(todos);
  } catch (error) {
    console.error('Error fetching todos:', error);
    res.status(500).json({ message: 'Server error fetching todos', error: error.message });
  }
});

// POST create a new todo
router.post('/', async (req, res) => {
  try {
    const { text, category, priority } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Task text is required' });
    }

    const userId = getUserId(req);

    const newTodo = new Todo({
      userId,
      text: text.trim(),
      category: category || 'General',
      priority: priority || 'medium',
      isDone: false
    });

    const savedTodo = await newTodo.save();
    res.status(201).json(savedTodo);
  } catch (error) {
    console.error('Error creating todo:', error);
    res.status(500).json({ message: 'Server error creating todo', error: error.message });
  }
});

// PUT update a specific todo (e.g. toggle Done/Not Done, edit text)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, isDone, category, priority } = req.body;

    const updateFields = {};
    if (typeof isDone === 'boolean') updateFields.isDone = isDone;
    if (typeof text === 'string' && text.trim()) updateFields.text = text.trim();
    if (typeof category === 'string') updateFields.category = category;
    if (typeof priority === 'string') updateFields.priority = priority;

    const updatedTodo = await Todo.findByIdAndUpdate(id, updateFields, {
      new: true,
      runValidators: true
    });

    if (!updatedTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }

    res.json(updatedTodo);
  } catch (error) {
    console.error('Error updating todo:', error);
    res.status(500).json({ message: 'Server error updating todo', error: error.message });
  }
});

// DELETE a particular todo
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedTodo = await Todo.findByIdAndDelete(id);

    if (!deletedTodo) {
      return res.status(404).json({ message: 'Todo not found' });
    }

    res.json({ message: 'Todo deleted successfully', id });
  } catch (error) {
    console.error('Error deleting todo:', error);
    res.status(500).json({ message: 'Server error deleting todo', error: error.message });
  }
});

// DELETE clear all completed todos
router.delete('/completed/all', async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = { isDone: true };
    if (userId) query.userId = userId;

    const result = await Todo.deleteMany(query);
    res.json({ message: 'Cleared completed todos', count: result.deletedCount });
  } catch (error) {
    console.error('Error clearing completed todos:', error);
    res.status(500).json({ message: 'Server error clearing completed', error: error.message });
  }
});

// DELETE clear all todos
router.delete('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = userId ? { userId } : {};

    const result = await Todo.deleteMany(query);
    res.json({ message: 'Cleared all todos', count: result.deletedCount });
  } catch (error) {
    console.error('Error clearing all todos:', error);
    res.status(500).json({ message: 'Server error clearing all todos', error: error.message });
  }
});

export default router;
