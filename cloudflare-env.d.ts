declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    DEEPSEEK_API_KEY?: string;
    HKB_AI_REVIEW_MODEL?: string;
    HKB_AI_REVIEW_TIMEOUT_MS?: string;
    HKB_AI_REVIEW_RETRIES?: string;
    HKB_AI_REVIEW_CONDITIONAL_READY?: string;
    BUCKET?: R2Bucket;
    HKB_SITE_SCOPE?: string;
    HKB_OWNER_SETUP_CODE_HASH?: string;
    HKB_LOCAL_AUTH_MODE?: string;
    HKB_MCP_TOKEN?: string;
    HKB_MCP_OWNER_SUBJECT?: string;
    HKB_MCP_SITE_ORIGIN?: string;
    HKB_REVIEW_INDEPENDENT_DAYS?: string;
    HKB_REVIEW_ASSISTED_DAYS?: string;
    HKB_REVIEW_PRACTICE_DAYS?: string;
  }
}
