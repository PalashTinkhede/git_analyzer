/**
 * Extract useful insights from raw GitHub API data
 * @param {object} user   - response from GET /users/:username
 * @param {Array}  repos  - response from GET /users/:username/repos
 * @returns {object}      - clean insights object ready to store in DB
 */
function extractInsights(user, repos) {
  // --- Language stats ---
  const languageCount = {};
  for (const repo of repos) {
    if (repo.language) {
      languageCount[repo.language] = (languageCount[repo.language] || 0) + 1;
    }
  }
  
  // Sort languages by frequency, take top 5
  const topLanguages = Object.entries(languageCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang]) => lang);

  // --- Star and Fork stats ---
  const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);

  // --- Most starred repo ---
  const sortedRepos = [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
  const mostStarred = sortedRepos[0];

  // --- Account age ---
  const createdAt = new Date(user.created_at);
  const now = new Date();
  const accountAgeDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  return {
    username:          user.login,
    name:              user.name || null,
    bio:               user.bio || null,
    avatar_url:        user.avatar_url,
    location:          user.location || null,
    company:           user.company || null,
    blog:              user.blog || null,
    email:             user.email || null,
    twitter_username:  user.twitter_username || null,
    public_repos:      user.public_repos,
    public_gists:      user.public_gists,
    followers:         user.followers,
    following:         user.following,
    total_stars:       totalStars,
    total_forks:       totalForks,
    account_age_days:  accountAgeDays,
    top_languages:     JSON.stringify(topLanguages),
    most_starred_repo: mostStarred ? mostStarred.full_name : null,
    most_starred_count: mostStarred ? mostStarred.stargazers_count : 0,
    hireable:          user.hireable ? 1 : 0,
    site_admin:        user.site_admin ? 1 : 0,
    github_created_at: new Date(user.created_at),
  };
}

module.exports = { extractInsights };
