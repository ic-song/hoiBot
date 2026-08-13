export type IrisEventCategory = "message" | "media" | "content" | "moderation" | "membership" | "candidate" | "unknown";
export type IrisClassificationStatus = "live_confirmed" | "upstream_confirmed" | "db_confirmed" | "candidate" | "unknown";
export type IrisMonitoringGroup = "text" | "media" | "moderation" | "membership" | "event";

export interface IrisEventClassificationInput {
  rawType: string;
  origin?: string;
  attachment?: Record<string, unknown>;
  system?: Record<string, unknown>;
}

export interface IrisEventClassification {
  eventCode: string;
  eventCategory: IrisEventCategory;
  monitoringGroup: IrisMonitoringGroup;
  status: IrisClassificationStatus;
  ruleId: string;
  metadata: Record<string, string | number | boolean | null>;
}

// 정규화 이벤트 코드를 관리자 모니터링의 영속 분류로 변환합니다.
export function classifyMonitoringGroup(eventCode: string): IrisMonitoringGroup {
  if (eventCode === "message.created.text") return "text";
  if ([
    "media.image", "media.image_candidate",
    "media.multi_image", "media.multi_image_candidate",
    "media.video", "media.video_candidate"
  ].includes(eventCode)) return "media";
  if (["message.deleted", "message.hidden_by_host", "message.edited", "message.rewritten"].includes(eventCode)) {
    return "moderation";
  }
  if (eventCode === "member.joined" || eventCode === "member.departed") return "membership";
  return "event";
}

interface IrisEventRule {
  id: string;
  eventCode: string;
  eventCategory: IrisEventCategory;
  status: IrisClassificationStatus;
  matches: (input: IrisEventClassificationInput) => boolean;
  metadata?: (input: IrisEventClassificationInput) => Record<string, string | number | boolean | null>;
}

// JSON 객체가 아닌 값은 분류 조건에서 제외합니다.
function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// 필드 값의 존재 여부만 확인하고 메시지·URL 같은 원문 값은 복사하지 않습니다.
function hasValue(record: Record<string, unknown> | undefined, key: string): boolean {
  const value = record?.[key];
  return value !== undefined && value !== null && value !== "";
}

// 일반 수신·발신 메시지 origin만 확정 콘텐츠 규칙에 허용합니다.
function isMessageOrigin(origin: string | undefined): boolean {
  return origin === "MSG" || origin === "WRITE";
}

// 후보·미분류 진단에 사용할 필드명만 정렬해 제한된 문자열로 만듭니다.
function summarizeKeys(record: Record<string, unknown> | undefined): string | undefined {
  if (record === undefined) return undefined;
  const summary = Object.keys(record).sort().slice(0, 20).join(",");
  return summary === "" ? undefined : summary;
}

// 분류 상태와 규칙 ID를 모든 이벤트에 동일한 메타데이터로 부여합니다.
function decorate(rule: IrisEventRule, input: IrisEventClassificationInput): IrisEventClassification {
  return {
    eventCode: rule.eventCode,
    eventCategory: rule.eventCategory,
    monitoringGroup: classifyMonitoringGroup(rule.eventCode),
    status: rule.status,
    ruleId: rule.id,
    metadata: {
      classificationStatus: rule.status,
      classificationRule: rule.id,
      ...(rule.metadata?.(input) ?? {})
    }
  };
}

const EVENT_RULES: readonly IrisEventRule[] = [
  {
    id: "moderation.message_edited",
    eventCode: "message.edited",
    eventCategory: "moderation",
    status: "live_confirmed",
    matches: ({ rawType, origin }) => rawType === "0" && origin === "SYNCMODMSG"
  },
  {
    id: "moderation.message_deleted",
    eventCode: "message.deleted",
    eventCategory: "moderation",
    status: "live_confirmed",
    matches: ({ rawType, origin }) => rawType === "0" && origin === "SYNCDLMSG"
  },
  {
    id: "moderation.host_hide",
    eventCode: "message.hidden_by_host",
    eventCategory: "moderation",
    status: "live_confirmed",
    matches: ({ rawType, origin, system }) => rawType === "0" && origin === "SYNCREWR"
      && String(system?.feedType) === "26" && system?.coverType === "openchat_blind"
  },
  {
    id: "moderation.rewrite_candidate",
    eventCode: "message.rewritten",
    eventCategory: "candidate",
    status: "db_confirmed",
    matches: ({ rawType, origin }) => rawType === "0" && origin === "SYNCREWR"
  },
  {
    id: "membership.joined",
    eventCode: "member.joined",
    eventCategory: "membership",
    status: "upstream_confirmed",
    matches: ({ rawType, origin }) => rawType === "0" && origin === "NEWMEM"
  },
  {
    id: "membership.departed",
    eventCode: "member.departed",
    eventCategory: "membership",
    status: "upstream_confirmed",
    matches: ({ rawType, origin }) => rawType === "0" && origin === "DELMEM"
  },
  {
    id: "message.thread_reply",
    eventCode: "message.created.thread_reply",
    eventCategory: "message",
    status: "upstream_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "26" && isMessageOrigin(origin)
      && attachment?.src_isThread === true && hasValue(attachment, "src_logId"),
    metadata: () => ({ isThread: true })
  },
  {
    id: "message.reply",
    eventCode: "message.created.reply",
    eventCategory: "message",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "26" && isMessageOrigin(origin)
      && hasValue(attachment, "src_logId")
  },
  {
    id: "message.reply_candidate",
    eventCode: "message.created.reply_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "26"
  },
  {
    id: "message.mention",
    eventCode: "message.created.mention",
    eventCategory: "message",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "1" && isMessageOrigin(origin)
      && ((Array.isArray(attachment?.mentions) && attachment.mentions.length > 0)
        || attachment?.bot_command !== undefined),
    metadata: ({ attachment }) => ({
      mentionCount: Array.isArray(attachment?.mentions) ? attachment.mentions.length : 0,
      hasBotCommand: attachment?.bot_command !== undefined
    })
  },
  {
    id: "message.text",
    eventCode: "message.created.text",
    eventCategory: "message",
    status: "live_confirmed",
    matches: ({ rawType, origin }) => rawType === "1" && (origin === "MSG" || origin === "WRITE")
  },
  {
    id: "media.single_image",
    eventCode: "media.image",
    eventCategory: "media",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "2" && isMessageOrigin(origin)
      && hasValue(attachment, "url")
  },
  {
    id: "media.single_image_candidate",
    eventCode: "media.image_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "2"
  },
  {
    id: "media.video",
    eventCode: "media.video",
    eventCategory: "media",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "3" && isMessageOrigin(origin)
      && hasValue(attachment, "url") && hasValue(attachment, "d")
  },
  {
    id: "media.video_candidate",
    eventCode: "media.video_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "3"
  },
  {
    id: "media.static_sticker_candidate",
    eventCode: "media.sticker_candidate",
    eventCategory: "candidate",
    status: "db_confirmed",
    matches: ({ rawType }) => rawType === "12"
  },
  {
    id: "media.animated_sticker",
    eventCode: "media.animated_sticker",
    eventCategory: "media",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "20" && isMessageOrigin(origin)
      && attachment?.type === "animated-sticker/digital-item"
  },
  {
    id: "media.animated_sticker_candidate",
    eventCode: "media.animated_sticker_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "20"
  },
  {
    id: "media.multiple_images",
    eventCode: "media.multi_image",
    eventCategory: "media",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "27" && isMessageOrigin(origin)
      && Array.isArray(attachment?.imageUrls)
  },
  {
    id: "media.multiple_images_candidate",
    eventCode: "media.multi_image_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "27"
  },
  {
    id: "content.rich_card",
    eventCode: "content.rich_card",
    eventCategory: "content",
    status: "live_confirmed",
    matches: ({ rawType, origin, attachment }) => rawType === "71" && isMessageOrigin(origin)
      && readRecord(attachment?.P) !== undefined && attachment?.C !== undefined
  },
  {
    id: "content.rich_card_candidate",
    eventCode: "content.rich_card_candidate",
    eventCategory: "candidate",
    status: "candidate",
    matches: ({ rawType }) => rawType === "71"
  }
];

// 검증 우선순위가 고정된 규칙 목록으로 Iris 이벤트를 분류합니다.
export function classifyIrisEvent(input: IrisEventClassificationInput): IrisEventClassification {
  const rule = EVENT_RULES.find((candidate) => candidate.matches(input));
  if (rule !== undefined) return decorate(rule, input);

  return {
    eventCode: "iris.unknown",
    eventCategory: "unknown",
    monitoringGroup: "event",
    status: "unknown",
    ruleId: "fallback.unknown",
    metadata: {
      classificationStatus: "unknown",
      classificationRule: "fallback.unknown",
      attachmentKeys: summarizeKeys(input.attachment) ?? null,
      systemKeys: summarizeKeys(input.system) ?? null
    }
  };
}
