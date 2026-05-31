// src/services/githubService.js
const axios                  = require('axios');
const { getCache, setCache } = require('../config/redis');
require('dotenv').config();

const GITHUB_TTL = parseInt(process.env.REDIS_TTL_GITHUB) || 3600;

// Axios instance with GitHub auth header
const githubAPI = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    Accept: 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN && {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    }),
  },
  timeout: 10000,
});

/**
 * Fetch a user's public profile from GitHub.
 * Cache key: github:profile:{username}  TTL: 1 hour
 * @param {string} username
 * @returns {Promise<object>} GitHub user object
 */
async function fetchUserProfile(username) {
  const cacheKey = `github:profile:${username.toLowerCase()}`;

  // Step 1: Check Redis cache first
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`🔴 Cache HIT  → ${cacheKey}`);
    return cached;
  }

  // Step 2: Cache miss — call GitHub API
  console.log(`⚪ Cache MISS → ${cacheKey} — fetching from GitHub API`);
  try {
    const { data } = await githubAPI.get(`/users/${username}`);

    // Step 3: Store in cache for next time
    await setCache(cacheKey, data, GITHUB_TTL);
    return data;

  } catch (error) {
    if (error.response?.status === 404)
      throw new Error(`GitHub user "${username}" not found`);
    if (error.response?.status === 403)
      throw new Error('GitHub API rate limit exceeded. Add GITHUB_TOKEN to .env');
    throw new Error(`GitHub API error: ${error.message}`);
  }
}

/**
 * Fetch all public repos for a user (auto-paginates).
 * Cache key: github:repos:{username}  TTL: 1 hour
 * @param {string} username
 * @returns {Promise<Array>} list of repo objects
 */
async function fetchUserRepos(username) {
  const cacheKey = `github:repos:${username.toLowerCase()}`;

  // Step 1: Check Redis cache first
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`🔴 Cache HIT  → ${cacheKey}`);
    return cached;
  }

  // Step 2: Cache miss — paginate through GitHub API
  console.log(`⚪ Cache MISS → ${cacheKey} — fetching from GitHub API`);
  try {
    const repos = [];
    let page = 1;

    while (true) {
      const { data } = await githubAPI.get(`/users/${username}/repos`, {
        params: { per_page: 100, page, sort: 'stars', direction: 'desc' },
      });
      repos.push(...data);
      if (data.length < 100) break; // last page reached
      page++;
    }

    // Step 3: Cache the full list
    await setCache(cacheKey, repos, GITHUB_TTL);
    return repos;

  } catch (error) {
    throw new Error(`Failed to fetch repos for "${username}": ${error.message}`);
  }
}

module.exports = { fetchUserProfile, fetchUserRepos };
