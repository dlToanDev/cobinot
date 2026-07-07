import { AiErrorReason } from '../ai.types';

/**
 * Chuẩn hóa mọi lỗi từ provider (HTTP status, timeout, network) về một mã ngắn
 * gọn để log/telemetry. KHÔNG bao giờ dùng chuỗi lỗi thô này để hiện cho user.
 */
export function normalizeAiError(error: unknown): AiErrorReason {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? error ?? '',
  );

  if (/\b401\b/.test(message) || /invalid.?api.?key|unauthorized/i.test(message))
    return 'INVALID_API_KEY';
  if (/\b403\b/.test(message) || /forbidden|no credit|insufficient/i.test(message))
    return 'NO_CREDIT_OR_FORBIDDEN';
  if (
    /\b429\b/.test(message) ||
    /rate.?limit|quota|resource_exhausted|too many requests/i.test(message)
  )
    return 'RATE_LIMIT_OR_QUOTA';
  if (/\b404\b/.test(message) || /model.*not.*found|no such model/i.test(message))
    return 'MODEL_NOT_FOUND';
  if (/\b50[023]\b/.test(message) || /bad gateway|unavailable/i.test(message))
    return 'PROVIDER_DOWN';
  if (/timeout|timed out|aborted| etimedout|econnreset/i.test(message))
    return 'TIMEOUT';

  return 'UNKNOWN_AI_ERROR';
}

/** true nếu lỗi có thể tạm thời -> đáng để retry. */
export function isRetryableAiError(reason: AiErrorReason): boolean {
  return (
    reason === 'RATE_LIMIT_OR_QUOTA' ||
    reason === 'PROVIDER_DOWN' ||
    reason === 'TIMEOUT'
  );
}

/**
 * Câu trả lời thân thiện cho người dùng cuối khi AI lỗi. KHÔNG lộ chi tiết kỹ
 * thuật. Hệ thống sẽ tiếp tục xử lý bằng rule/database sau câu này.
 */
export function friendlyAiErrorMessage(): string {
  return 'AI đang tạm lỗi hoặc hết quota, mình sẽ xử lý bằng tìm kiếm trực tiếp trong hệ thống.';
}
