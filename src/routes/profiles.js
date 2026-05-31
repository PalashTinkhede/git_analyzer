// src/routes/profiles.js
const express = require('express');
const { param, query, validationResult } = require('express-validator');
const router  = express.Router();
const {
  analyzeProfile,
  getAllProfiles,
  getProfile,
  deleteProfile,
  compareProfiles,
  clearUserCache,
  cacheStats,
} = require('../controllers/profileController');

// Validation error responder middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ── Core routes ───────────────────────────────────────────────────────────────

// Analyze a GitHub user and store/cache results
router.post('/analyze/:username', [
  param('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i)
    .withMessage('Invalid GitHub username format'),
  validate,
], analyzeProfile);

// Get all stored profiles (paginated + sorted, with caching)
router.get('/profiles', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sort').optional().isIn(['followers', 'total_stars', 'public_repos', 'analyzed_at']).withMessage('Invalid sort field'),
  query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
  validate,
], getAllProfiles);

// Compare two stored profiles side-by-side
router.get('/compare', [
  query('a')
    .trim()
    .notEmpty().withMessage('Username a is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i).withMessage('Invalid format for username a'),
  query('b')
    .trim()
    .notEmpty().withMessage('Username b is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i).withMessage('Invalid format for username b'),
  validate,
], compareProfiles);

// Get a single stored profile (with caching)
router.get('/profiles/:username', [
  param('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i).withMessage('Invalid GitHub username format'),
  validate,
], getProfile);

// Delete a stored profile (clears cache too)
router.delete('/profiles/:username', [
  param('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i).withMessage('Invalid GitHub username format'),
  validate,
], deleteProfile);

// ── Cache management routes ───────────────────────────────────────────────────

// Manually clear all cache for one user (forces fresh fetch next time)
router.delete('/cache/:username', [
  param('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .matches(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i).withMessage('Invalid GitHub username format'),
  validate,
], clearUserCache);

// View Redis cache hit/miss stats
router.get('/cache/stats', cacheStats);

module.exports = router;
