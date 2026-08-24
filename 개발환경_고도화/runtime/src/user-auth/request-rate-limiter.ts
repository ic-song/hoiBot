import { createHmac } from "node:crypto";
import { ApplicationError } from "../shared/application-error.js";

interface RateLimitBucket {
  attempts: number;
  windowEndsAt: number;
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

// 개인정보 원문을 보관하지 않고 단일 서버 프로세스의 인증 요청 빈도를 제한합니다.
export class RequestRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now
  ) {}

  consume(action: string, scope: string, policy: RateLimitPolicy): void {
    const currentTime = this.now();
    const key = createHmac("sha256", this.secret).update(`${action}:${scope}`).digest("hex");
    const current = this.#buckets.get(key);
    if (current === undefined || current.windowEndsAt <= currentTime) {
      this.#buckets.set(key, { attempts: 1, windowEndsAt: currentTime + policy.windowMs });
      this.#sweep(currentTime);
      return;
    }
    if (current.attempts >= policy.limit) {
      throw new ApplicationError(
        "AUTH_RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { retryAfterSeconds: Math.max(1, Math.ceil((current.windowEndsAt - currentTime) / 1000)) }
      );
    }
    current.attempts += 1;
  }

  #sweep(currentTime: number): void {
    if (this.#buckets.size < 1_000) return;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.windowEndsAt <= currentTime) this.#buckets.delete(key);
    }
  }
}
