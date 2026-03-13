const express = require('express');
const router = express.Router();
const mrpController = require('../controllers/mrpController');

router.get('/requirements', mrpController.getGlobalRequirements);
router.get('/recommendations', mrpController.getPurchaseRecommendations);

module.exports = router;
