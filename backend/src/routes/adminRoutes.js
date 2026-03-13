const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const reportController = require('../controllers/reportController');
const { auth, roles } = require('../middleware/auth');

// Protected Routes (Admin Only)
router.use(auth, roles(['ADMIN']));

// User Management
router.get('/users', userController.getUsers);
router.post('/users', userController.createUser);
router.patch('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

// Reports
// router.get('/reports/sales', reportController.getSalesReport);

module.exports = router;
