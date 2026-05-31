CREATE DATABASE IF NOT EXISTS github_analyzer;
USE github_analyzer;

CREATE TABLE IF NOT EXISTS profiles (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  username          VARCHAR(100)  UNIQUE NOT NULL,
  name              VARCHAR(200),
  bio               TEXT,
  avatar_url        VARCHAR(500),
  location          VARCHAR(200),
  company           VARCHAR(200),
  blog              VARCHAR(300),
  email             VARCHAR(200),
  twitter_username  VARCHAR(100),
  public_repos      INT           DEFAULT 0,
  public_gists      INT           DEFAULT 0,
  followers         INT           DEFAULT 0,
  following         INT           DEFAULT 0,
  total_stars       INT           DEFAULT 0,
  total_forks       INT           DEFAULT 0,
  account_age_days  INT           DEFAULT 0,
  top_languages     JSON,
  most_starred_repo VARCHAR(300),
  most_starred_count INT          DEFAULT 0,
  hireable          TINYINT(1)    DEFAULT 0,
  site_admin        TINYINT(1)    DEFAULT 0,
  github_created_at DATETIME,
  analyzed_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username),
  INDEX idx_followers (followers),
  INDEX idx_total_stars (total_stars)
);
