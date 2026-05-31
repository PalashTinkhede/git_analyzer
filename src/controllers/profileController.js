// src/controllers/profileController.js
const pool                              = require('../config/db');
const { fetchUserProfile,
        fetchUserRepos }                = require('../services/githubService');
const { extractInsights }               = require('../services/insightsService');
const { getCache, setCache, deleteCache,
        deleteCachePattern, getCacheStats } = require('../config/redis');

// TTL constants (fall back to safe defaults if env is missing)
const TTL_SINGLE = parseInt(process.env.REDIS_TTL_DB_SINGLE) || 600;
const TTL_LIST   = parseInt(process.env.REDIS_TTL_DB_LIST)   || 300;

// ── HELPER: build consistent cache keys ──────────────────────────────────────
const KEYS = {
  githubProfile: (u)          => `github:profile:${u.toLowerCase()}`,
  githubRepos:   (u)          => `github:repos:${u.toLowerCase()}`,
  dbProfile:     (u)          => `db:profile:${u.toLowerCase()}`,
  dbList:        (p, l, s, o) => `db:profiles:page:${p}:limit:${l}:sort:${s}:${o}`,
};

// ── HELPER: invalidate all cache for a username ───────────────────────────────
async function invalidateUserCache(username) {
  await deleteCache(
    KEYS.githubProfile(username),
    KEYS.githubRepos(username),
    KEYS.dbProfile(username)
  );
  await deleteCachePattern('db:profiles:*'); // clear all paginated list caches
  console.log(`🗑️  Cache invalidated for user: ${username}`);
}

// ── HELPER: safely extract top_languages as an array ─────────────────────────
function getLanguagesArray(profile) {
  if (!profile.top_languages) return [];
  if (Array.isArray(profile.top_languages)) return profile.top_languages;
  try {
    const parsed = typeof profile.top_languages === 'string'
      ? JSON.parse(profile.top_languages)
      : profile.top_languages;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── HELPER: assigns a developer archetype based on profile stats ──────────────
function assignArchetype(profile) {
  const stars     = profile.total_stars   || 0;
  const followers = profile.followers     || 0;
  const repos     = profile.public_repos  || 0;

  if (stars > 500 && followers > 1000) {
    return 'Open Source Rockstar';
  } else if (stars > 100 && repos < 15) {
    return 'High-Impact Specialist (Few repos, high stars)';
  } else if (repos > 40 && stars < 30) {
    return 'Prolific Builder (High repository output, low visibility)';
  } else if (followers > 300 && stars < 15) {
    return 'Social Networker (High followers, low code stars)';
  } else {
    return 'Pragmatic Developer';
  }
}

// ── HELPER: calculates a weighted developer power score ───────────────────────
function calculatePowerScore(profile) {
  const followers = profile.followers    || 0;
  const stars     = profile.total_stars  || 0;
  const repos     = profile.public_repos || 0;
  const age       = profile.account_age_days || 0;

  return Math.round(
    (followers * 5) +
    (stars     * 10) +
    (repos     * 2) +
    (age       * 0.1)
  );
}


// ────────────────────────────────────────────────────────────────────────────
// POST /api/analyze/:username
// ────────────────────────────────────────────────────────────────────────────
async function analyzeProfile(req, res) {
  const { username } = req.params;

  if (!username || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // 1. Invalidate stale cache before fetching fresh data
    //    (githubService will then fetch from GitHub and re-cache automatically)
    await invalidateUserCache(username);

    // 2. Fetch fresh data from GitHub (githubService handles its own caching)
    const [userData, reposData] = await Promise.all([
      fetchUserProfile(username),
      fetchUserRepos(username),
    ]);

    // 3. Extract insights from raw data
    const insights = extractInsights(userData, reposData);

    // 4. Upsert into MySQL
    const sql = `
      INSERT INTO profiles
        (username, name, bio, avatar_url, location, company, blog, email,
         twitter_username, public_repos, public_gists, followers, following,
         total_stars, total_forks, account_age_days, top_languages,
         most_starred_repo, most_starred_count, hireable, site_admin,
         github_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name               = VALUES(name),
        bio                = VALUES(bio),
        avatar_url         = VALUES(avatar_url),
        location           = VALUES(location),
        company            = VALUES(company),
        blog               = VALUES(blog),
        email              = VALUES(email),
        twitter_username   = VALUES(twitter_username),
        public_repos       = VALUES(public_repos),
        public_gists       = VALUES(public_gists),
        followers          = VALUES(followers),
        following          = VALUES(following),
        total_stars        = VALUES(total_stars),
        total_forks        = VALUES(total_forks),
        account_age_days   = VALUES(account_age_days),
        top_languages      = VALUES(top_languages),
        most_starred_repo  = VALUES(most_starred_repo),
        most_starred_count = VALUES(most_starred_count),
        hireable           = VALUES(hireable),
        site_admin         = VALUES(site_admin),
        github_created_at  = VALUES(github_created_at),
        updated_at         = CURRENT_TIMESTAMP
    `;

    const values = [
      insights.username, insights.name, insights.bio, insights.avatar_url,
      insights.location, insights.company, insights.blog, insights.email,
      insights.twitter_username, insights.public_repos, insights.public_gists,
      insights.followers, insights.following, insights.total_stars,
      insights.total_forks, insights.account_age_days, insights.top_languages,
      insights.most_starred_repo, insights.most_starred_count,
      insights.hireable, insights.site_admin, insights.github_created_at,
    ];

    await pool.execute(sql, values);

    // 5. Fetch the freshly saved record from MySQL
    const [rows] = await pool.execute(
      'SELECT * FROM profiles WHERE username = ?',
      [username]
    );

    // 6. Cache the fresh result in Redis for fast GETs
    await setCache(KEYS.dbProfile(username), rows[0], TTL_SINGLE);

    return res.status(200).json({
      success: true,
      cached:  false,
      message: `Profile for "${username}" analyzed and stored`,
      data:    rows[0],
    });

  } catch (error) {
    if (error.message.includes('not found'))
      return res.status(404).json({ error: error.message });
    if (error.message.includes('rate limit'))
      return res.status(429).json({ error: error.message });
    console.error('analyzeProfile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// GET /api/profiles
// ────────────────────────────────────────────────────────────────────────────
async function getAllProfiles(req, res) {
  try {
    const page   = parseInt(req.query.page,  10) || 1;
    const limit  = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const sortBy = ['followers', 'total_stars', 'public_repos', 'analyzed_at']
                     .includes(req.query.sort) ? req.query.sort : 'analyzed_at';
    const order  = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const cacheKey = KEYS.dbList(page, limit, sortBy, order);

    // Step 1: Try Redis cache
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`🔴 Cache HIT  → ${cacheKey}`);
      return res.status(200).json({ ...cached, cached: true });
    }

    // Step 2: Query MySQL
    console.log(`⚪ Cache MISS → ${cacheKey} — querying MySQL`);
    const [rows] = await pool.query(
      `SELECT * FROM profiles ORDER BY ${sortBy} ${order} LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) as total FROM profiles'
    );

    const payload = {
      success: true,
      data:    rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };

    // Step 3: Cache the result
    await setCache(cacheKey, payload, TTL_LIST);

    return res.status(200).json({ ...payload, cached: false });

  } catch (error) {
    console.error('getAllProfiles error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// GET /api/profiles/:username
// ────────────────────────────────────────────────────────────────────────────
async function getProfile(req, res) {
  const { username } = req.params;

  try {
    const cacheKey = KEYS.dbProfile(username);

    // Step 1: Try Redis cache
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`🔴 Cache HIT  → ${cacheKey}`);
      return res.status(200).json({ success: true, cached: true, data: cached });
    }

    // Step 2: Query MySQL
    console.log(`⚪ Cache MISS → ${cacheKey} — querying MySQL`);
    const [rows] = await pool.execute(
      'SELECT * FROM profiles WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: `Profile "${username}" not found. Call POST /api/analyze/${username} first.`,
      });
    }

    // Step 3: Cache and return
    await setCache(cacheKey, rows[0], TTL_SINGLE);
    return res.status(200).json({ success: true, cached: false, data: rows[0] });

  } catch (error) {
    console.error('getProfile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/profiles/:username
// ────────────────────────────────────────────────────────────────────────────
async function deleteProfile(req, res) {
  const { username } = req.params;

  try {
    const [result] = await pool.execute(
      'DELETE FROM profiles WHERE username = ?',
      [username]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `Profile "${username}" not found` });
    }

    // Clean up all cache entries for this user
    await invalidateUserCache(username);

    return res.status(200).json({
      success: true,
      message: `Profile "${username}" deleted from DB and cache`,
    });

  } catch (error) {
    console.error('deleteProfile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// GET /api/compare?a=user1&b=user2
// ────────────────────────────────────────────────────────────────────────────
async function compareProfiles(req, res) {
  const { a, b } = req.query;

  if (!a || !b) {
    return res.status(400).json({ error: 'Provide ?a=username1&b=username2' });
  }

  try {
    // Try to get both from cache in parallel
    const [cachedA, cachedB] = await Promise.all([
      getCache(KEYS.dbProfile(a)),
      getCache(KEYS.dbProfile(b)),
    ]);

    let p1 = cachedA;
    let p2 = cachedB;

    // For any not in cache, fetch from MySQL
    if (!p1 || !p2) {
      const missing = [!p1 && a, !p2 && b].filter(Boolean);
      const [rows]  = await pool.execute(
        `SELECT * FROM profiles WHERE username IN (${missing.map(() => '?').join(',')})`,
        missing
      );

      for (const row of rows) {
        if (row.username.toLowerCase() === a.toLowerCase()) {
          p1 = row;
          await setCache(KEYS.dbProfile(a), row, TTL_SINGLE);
        }
        if (row.username.toLowerCase() === b.toLowerCase()) {
          p2 = row;
          await setCache(KEYS.dbProfile(b), row, TTL_SINGLE);
        }
      }
    }

    // Check both profiles were found
    const notFound = [!p1 && a, !p2 && b].filter(Boolean);
    if (notFound.length > 0) {
      return res.status(404).json({
        error: `Profile(s) not found: ${notFound.join(', ')}. Analyze them first.`,
      });
    }

    // Language insights
    const langs1          = getLanguagesArray(p1);
    const langs2          = getLanguagesArray(p2);
    const commonLanguages = langs1.filter(lang =>
      langs2.some(l => l.toLowerCase() === lang.toLowerCase())
    );
    const uniqueToP1 = langs1.filter(lang =>
      !langs2.some(l => l.toLowerCase() === lang.toLowerCase())
    );
    const uniqueToP2 = langs2.filter(lang =>
      !langs1.some(l => l.toLowerCase() === lang.toLowerCase())
    );

    // Power scores & efficiency metrics
    const scoreP1    = calculatePowerScore(p1);
    const scoreP2    = calculatePowerScore(p2);
    const avgStarsP1 = p1.public_repos > 0 ? parseFloat((p1.total_stars / p1.public_repos).toFixed(2)) : 0;
    const avgStarsP2 = p2.public_repos > 0 ? parseFloat((p2.total_stars / p2.public_repos).toFixed(2)) : 0;
    const avgForksP1 = p1.public_repos > 0 ? parseFloat((p1.total_forks / p1.public_repos).toFixed(2)) : 0;
    const avgForksP2 = p2.public_repos > 0 ? parseFloat((p2.total_forks / p2.public_repos).toFixed(2)) : 0;

    const comparison = {
      profiles: {
        [p1.username]: {
          ...p1,
          archetype:               assignArchetype(p1),
          power_score:             scoreP1,
          average_stars_per_repo:  avgStarsP1,
          average_forks_per_repo:  avgForksP1,
        },
        [p2.username]: {
          ...p2,
          archetype:               assignArchetype(p2),
          power_score:             scoreP2,
          average_stars_per_repo:  avgStarsP2,
          average_forks_per_repo:  avgForksP2,
        },
      },
      head_to_head: {
        most_followers:       p1.followers        >= p2.followers        ? p1.username : p2.username,
        most_stars:           p1.total_stars      >= p2.total_stars      ? p1.username : p2.username,
        most_repos:           p1.public_repos     >= p2.public_repos     ? p1.username : p2.username,
        older_account:        p1.account_age_days >= p2.account_age_days ? p1.username : p2.username,
        higher_average_stars: avgStarsP1          >= avgStarsP2          ? p1.username : p2.username,
        higher_power_score:   scoreP1             >= scoreP2             ? p1.username : p2.username,
      },
      language_insights: {
        common_languages: commonLanguages,
        unique_to: {
          [p1.username]: uniqueToP1,
          [p2.username]: uniqueToP2,
        },
      },
      ultimate_winner: scoreP1 > scoreP2
        ? p1.username
        : scoreP2 > scoreP1 ? p2.username : "It's a tie!",
    };

    return res.status(200).json({
      success: true,
      cached:  !!(cachedA && cachedB),
      data:    comparison,
    });

  } catch (error) {
    console.error('compareProfiles error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/cache/:username  — manual cache clear for one user
// ────────────────────────────────────────────────────────────────────────────
async function clearUserCache(req, res) {
  const { username } = req.params;
  try {
    await invalidateUserCache(username);
    return res.status(200).json({
      success: true,
      message: `All cache cleared for "${username}". Next request will fetch fresh data.`,
    });
  } catch (error) {
    console.error('clearUserCache error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


// ────────────────────────────────────────────────────────────────────────────
// GET /api/cache/stats  — monitoring endpoint
// ────────────────────────────────────────────────────────────────────────────
async function cacheStats(req, res) {
  try {
    const stats = await getCacheStats();
    return res.status(200).json({ success: true, redis: stats });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get cache stats' });
  }
}


module.exports = {
  analyzeProfile,
  getAllProfiles,
  getProfile,
  deleteProfile,
  compareProfiles,
  clearUserCache,
  cacheStats,
};
