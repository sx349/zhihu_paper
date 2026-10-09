-- Zhihu-side paper index — the tables part 2 would add.
--
-- The extension's pseudo-DB (data/seed.json) is a flat mirror of exactly these
-- rows, so this file is the spec, not a sketch after the fact. Only two of
-- these tables are genuinely new capability: user_paper_link (an answerer
-- binding their account to a paper they authored) and paper_card (a DOI
-- attached to a question, answer or article, making it searchable by paper).

-- Canonical paper identity. Keyed on a namespaced id so DOIs and arXiv IDs
-- share one space: "doi:10.1287/mnsc.2022.4522", "arxiv:2503.01800".
CREATE TABLE paper (
  id            VARCHAR(128) PRIMARY KEY,
  doi           VARCHAR(128),
  arxiv_id      VARCHAR(32),
  title         TEXT,
  authors_json  JSON,
  venue         VARCHAR(255),
  year          CHAR(4),
  INDEX idx_paper_doi (doi),
  INDEX idx_paper_arxiv (arxiv_id)
);

-- Preprint <-> published version clustering. arXiv:2503.01800 and the eventual
-- journal DOI are the same work; discussion of either should surface on both.
CREATE TABLE paper_alias (
  paper_id      VARCHAR(128) NOT NULL,
  alias_id      VARCHAR(128) NOT NULL,
  PRIMARY KEY (paper_id, alias_id),
  FOREIGN KEY (paper_id) REFERENCES paper(id)
);

-- Existing Zhihu user, plus the ORCID binding that does not exist today.
-- The display label follows Zhihu's own rule, already computed server-side
-- as badge_v2.title: 认证 if the account has one, else headline (个性签名).
-- label_source records which, so a fallback is never read as a credential.
-- The paper author's real name is deliberately NOT stored here — the
-- user_paper_link row is what asserts authorship.
CREATE TABLE zhihu_user (
  url_token     VARCHAR(64) PRIMARY KEY,
  nickname      VARCHAR(128) NOT NULL,          -- members.name
  label         VARCHAR(255),                   -- badge_v2.title, else headline
  label_source  ENUM('认证','签名','placeholder') NOT NULL DEFAULT 'placeholder',
  orcid         CHAR(19),
  INDEX idx_user_orcid (orcid)
);

-- NEW: an answerer declares "I am an author of this paper".
-- relation: 'author' (self-declared, ORCID-verifiable) | 'expert' (topic claim)
--
-- Self-declaration is the MECHANISM. ORCID is only an onboarding shortcut,
-- and a partial one — measured Crossref coverage, 2022+ journal articles:
--
--   American Economic Review    0% have any ORCID
--   Econometrica                0%
--   J Political Economy         0%
--   Nature                      2%
--   Cell                       54% any /  0% all authors
--   PNAS                       96% any / 17% all authors
--   PLOS ONE                   98% any / 13% all authors
--   Management Science         98% any / 70% all authors
--
-- Coverage tracks the publisher's submission system, not the field, and
-- "has an ORCID" usually means only the corresponding author. So this table
-- cannot be derived from ORCID in general; it has to be filled by the author
-- saying "this is mine". Where an ORCID does exist, use it to SUGGEST papers
-- for the user to claim rather than to establish authorship.
CREATE TABLE user_paper_link (
  url_token     VARCHAR(64)  NOT NULL,
  paper_id      VARCHAR(128) NOT NULL,
  relation      ENUM('author','expert') NOT NULL DEFAULT 'author',
  verified_at   DATETIME,
  PRIMARY KEY (url_token, paper_id),
  FOREIGN KEY (url_token) REFERENCES zhihu_user(url_token),
  FOREIGN KEY (paper_id)  REFERENCES paper(id)
);

-- NEW: a paper card embedded in a question, answer or article. This is the
-- table that turns "search Zhihu for a title and hope" into a primary-key
-- lookup, and it can be backfilled from existing content by mining DOI and
-- arXiv-ID strings already present in the corpus.
CREATE TABLE paper_card (
  card_id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  paper_id      VARCHAR(128) NOT NULL,
  attached_type ENUM('question','answer','article') NOT NULL,
  attached_id   BIGINT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_card (paper_id, attached_type, attached_id),
  INDEX idx_card_paper (paper_id),
  INDEX idx_card_target (attached_type, attached_id),
  FOREIGN KEY (paper_id) REFERENCES paper(id)
);

-- Reader corrections. Local-only in the prototype; server-side this turns every
-- extension user into a labeller of paper<->content pairs.
CREATE TABLE paper_match_feedback (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  paper_id      VARCHAR(128) NOT NULL,
  url_token     VARCHAR(64),
  layer         ENUM('linked','fuzzy','empty') NOT NULL,
  verdict       ENUM('up','down','note') NOT NULL,
  target_url    VARCHAR(512),
  note          TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fb_paper (paper_id)
);

-- The lookup the extension makes, once per paper page:
--
--   SELECT c.attached_type, c.attached_id
--     FROM paper_card c
--     JOIN paper p ON p.id = c.paper_id
--    WHERE p.doi = ? OR p.arxiv_id = ?;
--
--   SELECT u.url_token, u.name, u.headline
--     FROM user_paper_link l
--     JOIN zhihu_user u ON u.url_token = l.url_token
--    WHERE l.paper_id = ? AND l.relation = 'author';
