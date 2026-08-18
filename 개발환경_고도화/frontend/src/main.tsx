import { StrictMode, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Page = "home" | "profile" | "signup" | "resume-signup" | "login" | "account" | "admin-login" | "admin";

type UserSession = {
  accountId: string;
  playerId: string;
  loginId: string;
  systemAccountName: string;
};

type AdminSession = { operatorId: string; loginId: string; displayName: string; roleCodes: string[]; permissions: string[] };
type JsonRecord = Record<string, unknown>;
type PublicOverview = {
  service: { api: string; database: string };
  metrics: { activePlayers: string; activeChannels: string; eventsLast24Hours: string; lastEventAt: string | null } | null;
};

type SignupResult = {
  challengeId: string;
  systemAccountName: string;
  verificationCode: string;
  codeExpiresAt: string;
  pendingExpiresAt: string;
};

// 실제 API 연결과 검증이 끝난 기능만 사용자 화면에 노출합니다.
const visibleFeatures = {
  playerSearch: false,
  rankings: false,
  market: false,
  guild: false,
  collection: false,
  adminConsole: false,
  futureOverview: false
} as const;

const ranking = [
  { rank: 1, name: "호이대장", value: "Lv. 1,284", accent: "gold" },
  { rank: 2, name: "별빛냥", value: "Lv. 1,201", accent: "silver" },
  { rank: 3, name: "정현", value: "Lv. 1,176", accent: "bronze" },
  { rank: 4, name: "마법토끼", value: "Lv. 1,092" }
];

const activities = [
  ["포인트 지급", "+25,000 P", "2분 전"],
  ["길드 역할 변경", "운영진", "38분 전"],
  ["미니펫 장착", "별구름 래빗", "오늘 10:42"],
  ["서버 이동", "호이 2서버", "어제 21:18"]
];

function Icon({ children }: { children: ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function Header({ page, session, onHome, onLogin, onAccount }: {
  page: Page;
  session: UserSession | null;
  onHome: () => void;
  onLogin: () => void;
  onAccount: () => void;
}) {
  return <header className="topbar">
    <button className="brand" onClick={onHome} aria-label="호이월드 홈">
      <span className="brand-mark">H</span><span>호이<span>월드</span></span>
    </button>
    <nav aria-label="주요 메뉴">
      <button className={page === "home" ? "active" : ""} onClick={onHome}>홈</button>
      {visibleFeatures.rankings && <button>랭킹</button>}
      {visibleFeatures.market && <button>거래소</button>}
      {visibleFeatures.guild && <button>길드</button>}
      {visibleFeatures.collection && <button>도감</button>}
    </nav>
    <div className="header-actions"><button className="signup-button" onClick={session ? onAccount : onLogin}>{session ? "내정보" : "로그인"}</button>{visibleFeatures.adminConsole && <button className="admin-button">운영 콘솔</button>}</div>
  </header>;
}

function Login({ onSignup, onResumeSignup, onLoggedIn }: {
  onSignup: () => void;
  onResumeSignup: () => void;
  onLoggedIn: (session: UserSession, csrfToken: string) => void;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ loginId, password })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "로그인 정보를 확인해 주세요.");
      onLoggedIn(payload.session, payload.csrfToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인 요청을 처리하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page page-shell"><section className="card auth-card"><span className="eyebrow">WELCOME BACK</span><h1>로그인</h1><p>사이트에서 만든 계정으로 로그인해 주세요.</p><form onSubmit={submit} className="signup-form"><label>로그인 아이디<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" /></label><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-action" disabled={submitting}>{submitting ? "로그인 중..." : "로그인"}</button></form><div className="auth-secondary"><span>아직 계정이 없나요?</span><button onClick={onSignup}>회원가입</button></div><div className="auth-secondary"><span>카카오톡 인증이 남았나요?</span><button onClick={onResumeSignup}>인증 계속하기</button></div></section></main>;
}

function Account({ session, onLogout }: { session: UserSession; onLogout: () => Promise<void> }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<JsonRecord | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  useEffect(() => {
    void fetch("/api/v1/player-profiles/current", { credentials: "include" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "캐릭터 정보를 불러오지 못했어요.");
      setProfile(payload.profile as JsonRecord);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "캐릭터 정보를 불러오지 못했어요."))
      .finally(() => setProfileLoading(false));
  }, []);
  const server = profile?.server as JsonRecord | null | undefined;
  const currencies = profile?.currencies as JsonRecord | undefined;
  const guild = profile?.guild as JsonRecord | null | undefined;
  const pet = profile?.pet as JsonRecord | null | undefined;
  const home = profile?.home as JsonRecord | null | undefined;
  const passes = (profile?.passes as JsonRecord[] | undefined)?.filter((pass) => pass.enabled === true) ?? [];
  return <main className="auth-page page-shell"><section className="card account-card account-profile"><div className="account-avatar">{session.systemAccountName.slice(0, 1)}</div><span className="eyebrow">MY ACCOUNT</span><h1>{session.systemAccountName}</h1><p>MariaDB에 저장된 현재 캐릭터 정보예요.</p>{profileLoading ? <p className="account-loading">캐릭터 정보를 불러오는 중...</p> : profile && <><dl><div><dt>로그인 아이디</dt><dd>{session.loginId}</dd></div><div><dt>Player ID</dt><dd>{session.playerId}</dd></div><div><dt>서버</dt><dd>{valueText(server?.displayName)}</dd></div><div><dt>레벨</dt><dd>{numberText(profile.level)}</dd></div><div><dt>누적 레벨</dt><dd>{numberText(profile.accumulatedLevel)}</dd></div><div><dt>환생</dt><dd>{numberText(profile.rebirthCount)}회</dd></div><div><dt>포인트</dt><dd>{numberText(currencies?.point)} P</dd></div><div><dt>다이아</dt><dd>{numberText(currencies?.diamond)}</dd></div><div><dt>활성 타이틀</dt><dd>{valueText(profile.activeTitle)}</dd></div><div><dt>길드</dt><dd>{valueText(guild?.name)}</dd></div><div><dt>펫</dt><dd>{valueText(pet?.name)}</dd></div><div><dt>홈</dt><dd>{valueText(home?.name)}</dd></div><div><dt>활성 패스</dt><dd>{passes.length === 0 ? "없음" : passes.map((pass) => valueText(pass.code)).join(", ")}</dd></div></dl></>}{error && <p className="form-error" role="alert">{error}</p>}<button className="logout-button" disabled={loggingOut} onClick={async () => { setError(""); setLoggingOut(true); try { await onLogout(); } catch (caught) { setError(caught instanceof Error ? caught.message : "로그아웃하지 못했어요."); } finally { setLoggingOut(false); } }}>{loggingOut ? "로그아웃 중..." : "로그아웃"}</button></section></main>;
}

function AdminLogin({ onLoggedIn }: { onLoggedIn: (session: AdminSession, csrfToken: string) => void }) {
  const [loginId, setLoginId] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); setSubmitting(true); try {
    const response = await fetch("/api/v1/admin/sessions", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ loginId, password }) });
    const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "관리자 로그인 정보를 확인해 주세요."); onLoggedIn(payload.session, payload.csrfToken);
  } catch (caught) { setError(caught instanceof Error ? caught.message : "관리자 로그인을 처리하지 못했어요."); } finally { setSubmitting(false); } }
  return <main className="auth-page page-shell"><section className="card auth-card"><span className="admin-label">ADMIN</span><h1>관리자 로그인</h1><p>호이월드 운영자 계정으로 로그인해 주세요.</p><form onSubmit={submit} className="signup-form"><label>관리자 ID<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" /></label><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-action" disabled={submitting}>{submitting ? "확인 중..." : "관리자 로그인"}</button></form></section></main>;
}

type AdminTab = "overview" | "players" | "identities" | "monitoring" | "activity" | "incidents" | "deletions" | "operators" | "audit";
type MonitoringSection = "summary" | "deletions" | "edits" | "patterns" | "memberships" | "media" | "failures";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// 문자열로 전달되는 큰 정수도 정밀도 손실 없이 보기 좋게 표시합니다.
function numberText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "-";
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const [integer, decimal] = text.split(".");
  const formatted = BigInt(integer).toLocaleString("ko-KR");
  return decimal === undefined || /^0+$/.test(decimal) ? formatted : `${formatted}.${decimal.replace(/0+$/, "")}`;
}

const monitoringEventLabels: Record<string, string> = {
  "message.edited": "메시지 수정",
  "message.deleted": "메시지 삭제",
  "message.hidden_by_host": "방장 가리기",
  "message.rewritten": "메시지 변경",
  "member.joined": "입장",
  "member.departed": "퇴장",
  "message.created.thread_reply": "스레드 답글",
  "message.created.reply": "답글",
  "message.created.reply_candidate": "답글 추정",
  "message.created.mention": "멘션",
  "media.image": "이미지",
  "media.image_candidate": "이미지 추정",
  "media.video": "동영상",
  "media.video_candidate": "동영상 추정",
  "media.sticker_candidate": "이모티콘 추정",
  "media.animated_sticker": "움직이는 이모티콘",
  "media.animated_sticker_candidate": "움직이는 이모티콘 추정",
  "media.multi_image": "여러 이미지",
  "media.multi_image_candidate": "여러 이미지 추정",
  "content.rich_card": "검색·링크 카드",
  "content.rich_card_candidate": "검색·링크 카드 추정",
  "iris.unknown": "분류되지 않은 이벤트"
};

// 운영 화면에는 내부 코드 대신 이해하기 쉬운 이벤트 이름을 표시합니다.
function monitoringEventLabel(value: unknown): string {
  return monitoringEventLabels[String(value ?? "")] ?? "기타 이벤트";
}

// 모니터링 발생 시각을 한국 시간의 동일한 형식으로 표시합니다.
function monitoringDate(value: unknown): string {
  if (typeof value !== "string") return "시간 미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 미확인";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
}

// 내부 식별자 대신 검증된 표시 이름 또는 명확한 미확인 상태만 보여줍니다.
// redroid 실시간 조회 결과를 운영자가 이해할 수 있는 본문 상태로 표시합니다.
function monitoringMessageText(message: JsonRecord | undefined): string {
  if (message?.status === "recovered") return valueText(message.content);
  if (message?.status === "failed") return "redroid 연결 문제로 원문을 조회하지 못했어요.";
  return "KakaoTalk DB에 원문이 남아 있지 않아요.";
}

function monitoringName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function AdminConsole({ session, csrfToken, onLogout }: { session: AdminSession; csrfToken: string; onLogout: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [readiness, setReadiness] = useState<{ server: string; database: string }>({ server: "확인 중", database: "확인 중" });
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<JsonRecord>({});
  const [monitoring, setMonitoring] = useState<{ media: JsonRecord[]; deletedIncidents: JsonRecord[]; editedIncidents: JsonRecord[]; memberships: JsonRecord[]; patterns: JsonRecord[]; contents: JsonRecord[]; failures: JsonRecord[] }>({ media: [], deletedIncidents: [], editedIncidents: [], memberships: [], patterns: [], contents: [], failures: [] });
  const [monitoringTotals, setMonitoringTotals] = useState({ media: 0, deletedIncidents: 0, editedIncidents: 0, memberships: 0, patterns: 0, contents: 0, failures: 0 });
  const [monitoringSection, setMonitoringSection] = useState<MonitoringSection>("summary");
  const [incidentContents, setIncidentContents] = useState<Record<string, JsonRecord>>({});
  const [incidentContentLoading, setIncidentContentLoading] = useState("");
  const [retainedContentDetails, setRetainedContentDetails] = useState<Record<string, JsonRecord>>({});
  const [retainedContentLoading, setRetainedContentLoading] = useState("");
  const [membershipDetail, setMembershipDetail] = useState<{ subject: JsonRecord; items: JsonRecord[]; total: number } | null>(null);
  const [membershipDetailLoading, setMembershipDetailLoading] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<JsonRecord | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadRequestId = useRef(0);
  const can = (permission: string) => session.permissions.includes(permission);
  const menu: Array<{ key: AdminTab; label: string; permission: string }> = [
    { key: "overview", label: "대시보드", permission: "overview.read" },
    { key: "players", label: "회원 관리", permission: "player.read" },
    { key: "identities", label: "계정 연동", permission: "identity.read" },
    { key: "monitoring", label: "로그·모니터링", permission: "monitoring.read" },
    { key: "deletions", label: "탈퇴 관리", permission: "account.deletion.manage" },
    { key: "operators", label: "운영자·권한", permission: "operator.read" },
    { key: "audit", label: "감사 기록", permission: "audit.read" }
  ];

  async function api(path: string, init?: RequestInit): Promise<JsonRecord> {
    const response = await fetch(path, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}), ...(init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}) } });
    const payload = response.status === 204 ? { ok: true } : await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "요청을 처리하지 못했어요.");
    return payload;
  }

  async function load(target = tab, query = search) {
    const requestId = ++loadRequestId.current;
    setLoading(true); setError(""); setSelectedPlayer(null);
    try {
      if (target === "overview") { const payload = await api("/api/v1/admin/overview"); setOverview(payload.overview as JsonRecord); if (requestId !== loadRequestId.current) return; setItems([]); setTotal(0); }
      else if (target === "monitoring") {
        const [media, deletedIncidents, editedIncidents, memberships, patterns, contents, failures] = await Promise.all([
          api("/api/v1/admin/monitoring-events?group=media&page=1&limit=100"),
          api("/api/v1/admin/moderation-incidents?type=deleted&page=1&limit=100"),
          api("/api/v1/admin/moderation-incidents?type=edited&page=1&limit=100"),
          api("/api/v1/admin/channel-membership-events?page=1&limit=100"),
          api("/api/v1/admin/channel-membership-patterns?page=1&limit=100"),
          api("/api/v1/admin/retained-event-contents?page=1&limit=100"),
          api("/api/v1/admin/delivery-failures?page=1&limit=100")
        ]);
        if (requestId !== loadRequestId.current) return;
        setMonitoring({
          media: (media.items as JsonRecord[]) ?? [],
          deletedIncidents: (deletedIncidents.items as JsonRecord[]) ?? [],
          editedIncidents: (editedIncidents.items as JsonRecord[]) ?? [],
          memberships: (memberships.items as JsonRecord[]) ?? [],
          patterns: (patterns.items as JsonRecord[]) ?? [],
          contents: (contents.items as JsonRecord[]) ?? [],
          failures: (failures.items as JsonRecord[]) ?? []
        });
        setMonitoringTotals({
          media: Number(media.total ?? 0), deletedIncidents: Number(deletedIncidents.total ?? 0), editedIncidents: Number(editedIncidents.total ?? 0),
          memberships: Number(memberships.total ?? 0), patterns: Number(patterns.total ?? 0),
          contents: Number(contents.total ?? 0),
          failures: Number(failures.total ?? 0)
        });
        setItems([]);
        setTotal(0);
      }
      else {
        const paths: Record<Exclude<AdminTab, "overview">, string> = {
          players: `/api/v1/admin/players?search=${encodeURIComponent(query)}&page=1&limit=50`, identities: "/api/v1/admin/external-identities?status=candidate&page=1&limit=50",
          activity: "/api/v1/admin/channel-activity?page=1&limit=100", incidents: "/api/v1/admin/moderation-incidents?page=1&limit=100",
          monitoring: "/api/v1/admin/monitoring-events?page=1&limit=100",
          deletions: "/api/v1/admin/account-deletion-requests", operators: "/api/v1/admin/operators", audit: "/api/v1/admin/audit-entries?page=1&limit=100"
        };
        const payload = await api(paths[target]); if (requestId !== loadRequestId.current) return; setItems((payload.items as JsonRecord[]) ?? []); setTotal(Number(payload.total ?? 0));
      }
    } catch (caught) { if (requestId === loadRequestId.current) setError(caught instanceof Error ? caught.message : "데이터를 불러오지 못했어요."); }
    finally { if (requestId === loadRequestId.current) setLoading(false); }
  }

  async function mutate(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", values: JsonRecord, promptText: string) {
    const reason = window.prompt("변경 사유를 입력해 주세요.");
    if (!reason?.trim() || !window.confirm(promptText)) return;
    setError("");
    try {
      await api(path, { method, headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ ...values, reason: reason.trim(), confirmed: true }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "변경 요청을 처리하지 못했어요.");
    }
  }

  useEffect(() => {
    void fetch("/health/ready").then(async (response) => { const payload = await response.json(); setReadiness({ server: response.ok ? "정상" : "점검 필요", database: payload.database === "ready" ? "정상" : "점검 필요" }); }).catch(() => setReadiness({ server: "연결 실패", database: "확인 불가" }));
    void load("overview");
  }, []);

  async function selectPlayer(playerId: string) { setError(""); try { const payload = await api(`/api/v1/admin/players/${playerId}`); setSelectedPlayer(payload.player as JsonRecord); } catch (caught) { setError(caught instanceof Error ? caught.message : "회원을 불러오지 못했어요."); } }

  async function loadIncidentContent(incidentId: string) {
    setError(""); setIncidentContentLoading(incidentId);
    try {
      const payload = await api(`/api/v1/admin/moderation-incidents/${incidentId}/content`);
      setIncidentContents((current) => ({ ...current, [incidentId]: payload.incident as JsonRecord }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "원문을 조회하지 못했어요.");
    } finally { setIncidentContentLoading(""); }
  }

  async function loadRetainedContent(contentId: string) {
    setError(""); setRetainedContentLoading(contentId);
    try {
      const payload = await api(`/api/v1/admin/retained-event-contents/${contentId}`);
      setRetainedContentDetails((current) => ({ ...current, [contentId]: payload.content as JsonRecord }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "보관된 내용을 조회하지 못했어요.");
    } finally { setRetainedContentLoading(""); }
  }

  async function loadMembershipDetail(subject: JsonRecord) {
    setError(""); setMembershipDetailLoading(true);
    try {
      const query = new URLSearchParams({
        channelId: valueText(subject.channelId),
        externalIdentityId: valueText(subject.externalIdentityId),
        page: "1",
        limit: "200"
      });
      const payload = await api(`/api/v1/admin/channel-membership-events?${query.toString()}`);
      setMembershipDetail({ subject, items: (payload.items as JsonRecord[]) ?? [], total: Number(payload.total ?? 0) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "입장·퇴장 상세 기록을 불러오지 못했어요.");
    } finally { setMembershipDetailLoading(false); }
  }

  function renderRetainedContents(eventItem: JsonRecord) {
    const related = monitoring.contents.filter((content) => content.eventId === eventItem.eventId);
    if (related.length === 0) {
      return <small className="retained-content-status">{String(eventItem.eventCode).startsWith("media.video") ? "영상 파일 보관은 아직 적용되지 않았어요." : "보관된 내용이 없어요."}</small>;
    }
    return <div className="retained-content-group">{related.map((content, index) => {
      const contentId = valueText(content.id);
      const detail = retainedContentDetails[contentId];
      return <div className="retained-content-item" key={contentId}><button disabled={retainedContentLoading === contentId} onClick={() => void loadRetainedContent(contentId)}>{retainedContentLoading === contentId ? "조회 중" : related.length > 1 ? `내용 ${index + 1} 보기` : "내용 보기"}</button>{detail !== undefined && <div className="retained-content-preview">{typeof detail.messageText === "string" && detail.messageText !== "" && <p><b>답글</b><br />{detail.messageText}</p>}{typeof detail.replySourceText === "string" && detail.replySourceText !== "" && <p><b>답글 대상</b><br />{detail.replySourceText}</p>}{detail.mediaAvailable === true && <img src={`/api/v1/admin/retained-event-contents/${contentId}/media`} alt={monitoringEventLabel(eventItem.eventCode)} />}{detail.mediaAvailable !== true && content.contentKind !== "reply" && <p>미디어 파일을 보관하지 못했거나 보관 기간이 끝났어요.</p>}</div>}</div>;
    })}</div>;
  }

  const overviewCards: Array<[string, unknown]> = [
    ["활성 회원", overview.activePlayers], ["활성 제재", overview.activeRestrictions], ["탈퇴 유예", overview.deletionGrace],
    ["연동 후보", overview.identityCandidates], ["Outbox 실패", overview.outboxFailures], ["운영자", overview.activeOperators]
  ];
  const hasAssignablePlayer = Number(overview.activePlayers ?? 0) > 0;

  return <main className="console-page page-shell"><aside className="console-sidebar"><span className="admin-label">ADMIN CONSOLE</span><h2>운영 메뉴</h2>{menu.filter((item) => can(item.permission)).map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => { setTab(item.key); void load(item.key); }}>{item.label}</button>)}<div className="console-operator"><strong>{session.displayName}</strong><span>{session.roleCodes.join(", ") || "권한 없음"}</span><small>{session.loginId}</small></div><button className="console-logout" onClick={() => void onLogout()}>로그아웃</button></aside><section className="console-content"><div className="console-heading"><div><span className="eyebrow">{tab.toUpperCase()}</span><h1>{menu.find((item) => item.key === tab)?.label}</h1><p>권한이 있는 운영 기능만 표시돼요. 모든 변경은 사유와 재확인이 필요합니다.</p></div><span className="console-session"><i />관리자 로그인됨</span></div>{error && <p className="form-error" role="alert">{error}</p>}{loading && <p className="console-loading">불러오는 중...</p>}
    {tab === "overview" && <><div className="console-status-grid"><article className="card"><span>Node.js 서버</span><strong>{readiness.server}</strong><small>hoiBot Server</small></article><article className="card"><span>MariaDB</span><strong>{readiness.database}</strong><small>데이터베이스</small></article><article className="card"><span>현재 권한</span><strong>{session.permissions.length}개</strong><small>{session.roleCodes.join(", ")}</small></article></div><div className="console-metric-grid">{overviewCards.map(([label, value]) => <article className="card" key={String(label)}><span>{label}</span><strong>{valueText(value)}</strong></article>)}</div><section className="card permission-panel"><h2>현재 권한</h2><div className="permission-list">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div></section></>}
    {tab === "players" && <><form className="console-toolbar" onSubmit={(event) => { event.preventDefault(); void load("players", search); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="캐릭터 이름 또는 Player ID" /><button>검색</button></form><div className="console-split"><section className="card console-list"><h2>회원 목록 <small>전체 {numberText(total)}명</small></h2>{items.length === 0 ? <p>조건에 맞는 실제 회원이 없어요.</p> : items.map((item) => <button key={valueText(item.playerId)} onClick={() => void selectPlayer(valueText(item.playerId))}><strong>{valueText(item.displayName)}</strong><span>#{valueText(item.playerId)} · {valueText((item.server as JsonRecord | null)?.displayName)}</span></button>)}</section>{selectedPlayer && <section className="card console-detail"><h2>{valueText(selectedPlayer.displayName)}</h2><p>Player #{valueText(selectedPlayer.playerId)} · 버전 {valueText(selectedPlayer.profileVersion)}</p><dl><div><dt>서버</dt><dd>{valueText((selectedPlayer.server as JsonRecord | null)?.displayName)}</dd></div><div><dt>프리패스</dt><dd>{valueText((selectedPlayer.passes as JsonRecord[] | undefined)?.map((pass) => pass.code))}</dd></div><div><dt>제재</dt><dd>{valueText((selectedPlayer.restrictions as JsonRecord[] | undefined)?.map((row) => row.status))}</dd></div></dl><div className="console-actions">{can("player.server.assign") && <button onClick={() => { const code = window.prompt("배정할 서버 코드를 입력해 주세요."); if (code) void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/server-assignment`, "PUT", { serverCode: code, expectedVersion: selectedPlayer.profileVersion }, "서버 배정을 변경할까요?"); }}>서버 배정</button>}{can("pass.grant") && <button onClick={() => { const code = window.prompt("프리패스 코드를 입력해 주세요.", "premium"); if (code) void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/passes/${code}`, "PUT", { permanent: true }, "영구 프리패스를 지급할까요?"); }}>프리패스 지급</button>}{can("account.restrict") && <button className="danger" onClick={() => void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/restrictions`, "POST", { restrictionType: "permanent_suspension" }, "이 계정을 영구 정지할까요?")}>영구 정지</button>}</div></section>}</div></>}
    {tab === "identities" && <section className="card console-table"><h2>연동 후보 <small>전체 {numberText(total)}건 · 최대 {numberText(items.length)}건 표시</small></h2>{!hasAssignablePlayer && total > 0 && <p className="monitoring-note">연결할 활성 캐릭터가 없어 연결 기능을 숨겼어요. 회원가입과 카카오톡 인증이 완료된 캐릭터가 생기면 사용할 수 있어요.</p>}{items.length === 0 ? <p>대기 중인 연동 후보가 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><span>{valueText(item.providerCode)}</span><strong>{item.displayName ? valueText(item.displayName) : "검증된 이름 없음"}</strong><small>미검증 관측명 {valueText(item.observedDisplayName)} · 신뢰 상태 {valueText(item.observedNameTrust)} · 계정 키 {valueText(item.externalUserId)}</small>{can("identity.assign") && hasAssignablePlayer && <button onClick={() => { const playerId = window.prompt("연결할 Player ID를 입력해 주세요."); if (playerId) void mutate(`/api/v1/admin/external-identities/${valueText(item.id)}/player-assignment`, "PUT", { playerId }, "외부 계정을 연결할까요?"); }}>연결</button>}</div>)}</section>}
    {tab === "monitoring" && <div className="monitoring-grid">
      <nav className="monitoring-subnav" aria-label="모니터링 메뉴">{([
        ["summary", "종합 현황"], ["deletions", "삭제·가리기"], ["edits", "메시지 수정"], ["patterns", "들낙"],
        ["memberships", "입장·퇴장"], ["media", "미디어 (이미지·영상)"], ["failures", "처리 이상"]
      ] as Array<[MonitoringSection, string]>).map(([key, label]) => <button key={key} className={monitoringSection === key ? "active" : ""} onClick={() => setMonitoringSection(key)}>{label}</button>)}</nav>
      {monitoringSection === "summary" && <><div className="console-metric-grid monitoring-summary"><article className="card"><span>삭제·가리기</span><strong>{numberText(monitoringTotals.deletedIncidents)}</strong></article><article className="card"><span>메시지 수정</span><strong>{numberText(monitoringTotals.editedIncidents)}</strong></article><article className="card"><span>들낙</span><strong>{numberText(monitoringTotals.patterns)}</strong></article><article className="card"><span>입장·퇴장</span><strong>{numberText(monitoringTotals.memberships)}</strong></article><article className="card"><span>미디어 (이미지·영상)</span><strong>{numberText(monitoringTotals.media)}</strong></article><article className="card"><span>처리 이상</span><strong>{numberText(monitoringTotals.failures)}</strong></article></div><section className="card console-table"><h2>모니터링 안내</h2><p className="monitoring-note">위 수치는 MariaDB 전체 건수예요. 삭제·가리기와 메시지 수정은 각각 분리해 표시해요. 검색·링크는 내용을 확인할 수 없어 제외했고, 답글과 이모지도 별도 메뉴에 표시하지 않아요.</p></section></>}
      {monitoringSection === "deletions" && <section className="card console-table"><h2>삭제·가리기 기록 <small>전체 {numberText(monitoringTotals.deletedIncidents)}건</small></h2>{monitoring.deletedIncidents.length === 0 ? <p>감지된 삭제·가리기가 없어요.</p> : monitoring.deletedIncidents.map((item) => { const incidentId = valueText(item.id); const content = incidentContents[incidentId]; const original = content?.originalMessage as JsonRecord | undefined; return <div key={incidentId}><strong>{item.incidentType === "message_hidden_by_host" ? "방장 가리기" : "메시지 삭제"} · #{incidentId}</strong><span><b>방</b> {monitoringName(item.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(item.verifiedDisplayName, "이름 미확인")}</span><small>{monitoringDate(item.occurredAt)}</small><button disabled={incidentContentLoading === incidentId} onClick={() => void loadIncidentContent(incidentId)}>{incidentContentLoading === incidentId ? "조회 중" : content === undefined ? "원문 보기" : "다시 조회"}</button>{content !== undefined && <p className="incident-content">{monitoringMessageText(original)}</p>}</div>; })}</section>}
      {monitoringSection === "edits" && <section className="card console-table"><h2>메시지 수정 기록 <small>전체 {numberText(monitoringTotals.editedIncidents)}건</small></h2><p className="monitoring-note">원문 보기를 누르면 redroid의 현재 기록에서 수정 전과 수정 후를 함께 조회해요.</p>{monitoring.editedIncidents.length === 0 ? <p>감지된 메시지 수정이 없어요.</p> : monitoring.editedIncidents.map((item) => { const incidentId = valueText(item.id); const content = incidentContents[incidentId]; const edited = content?.editedMessage as JsonRecord | undefined; const before = edited?.before as JsonRecord | undefined; const after = edited?.after as JsonRecord | undefined; return <div key={incidentId}><strong>메시지 수정 · #{incidentId}</strong><span><b>방</b> {monitoringName(item.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(item.verifiedDisplayName, "이름 미확인")}</span><small>{monitoringDate(item.occurredAt)}</small><button disabled={incidentContentLoading === incidentId} onClick={() => void loadIncidentContent(incidentId)}>{incidentContentLoading === incidentId ? "조회 중" : content === undefined ? "수정 전·후 보기" : "다시 조회"}</button>{content !== undefined && <div className="incident-edit-content"><p><b>수정 전</b><br />{monitoringMessageText(before)}</p><p><b>수정 후</b><br />{monitoringMessageText(after)}</p></div>}</div>; })}</section>}
      {monitoringSection === "patterns" && <section className="card console-table"><h2>들낙 감지</h2><p className="monitoring-note">기간 제한 없이 같은 방에 2회 이상 입장하거나 2회 이상 퇴장한 사용자를 보여줘요.</p>{monitoring.patterns.length === 0 ? <p>반복 입장·퇴장이 감지된 사용자가 없어요.</p> : monitoring.patterns.map((item) => <div key={`${valueText(item.channelId)}-${valueText(item.externalIdentityId)}`}><strong>반복 {valueText(item.repeatCount)}회</strong><span><b>방</b> {monitoringName(item.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(item.verifiedDisplayName, "이름 미확인")}</span><small>입장 {valueText(item.joinedCount)}회 · 퇴장 {valueText(item.departedCount)}회 · 최근 {monitoringDate(item.lastOccurredAt)}</small><button disabled={membershipDetailLoading} onClick={() => void loadMembershipDetail(item)}>{membershipDetailLoading ? "불러오는 중" : "상세 보기"}</button></div>)}</section>}
      {monitoringSection === "memberships" && <section className="card console-table"><h2>입장·퇴장 기록</h2>{monitoring.memberships.length === 0 ? <p>감지된 입장·퇴장이 없어요.</p> : monitoring.memberships.map((item) => <div key={valueText(item.id)}><strong>{item.membershipEventCode === "joined" ? "입장" : "퇴장"}</strong><span><b>방</b> {monitoringName(item.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(item.verifiedDisplayName, "이름 미확인")}</span><small>{monitoringDate(item.occurredAt)}</small></div>)}</section>}
      {monitoringSection === "media" && <section className="card console-table"><h2>미디어 (이미지·영상) <small>전체 {numberText(monitoringTotals.media)}건</small></h2><p className="monitoring-note">이미지, 다중 이미지와 영상 감지만 모아 보여줘요. 영상 파일 저장은 아직 적용되지 않았어요.</p>{monitoring.media.length === 0 ? <p>감지된 이미지·영상이 없어요.</p> : monitoring.media.map((item) => <div key={valueText(item.id)}><strong>{monitoringEventLabel(item.eventCode)}</strong><span><b>방</b> {monitoringName(item.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(item.verifiedDisplayName, "이름 미확인")}</span><small>{monitoringDate(item.occurredAt)}</small>{can("event.content.read") && renderRetainedContents(item)}</div>)}</section>}
      {monitoringSection === "failures" && <section className="card console-table"><h2>처리 이상</h2>{monitoring.failures.length === 0 ? <p>현재 확인이 필요한 전송 실패가 없어요.</p> : monitoring.failures.map((item) => <div key={valueText(item.id)}><strong>{item.status === "dead_letter" ? "반복 전송 실패" : "전송 재시도 중"}</strong><span>시도 {valueText(item.attemptCount)}회</span><small>{monitoringDate(item.createdAt)}</small></div>)}</section>}
    </div>}
    {tab === "activity" && <section className="card console-table"><h2>본문을 저장하지 않는 일별 활동량</h2>{items.length === 0 ? <p>집계된 활동이 없어요.</p> : items.map((item, index) => <div key={`${valueText(item.channelId)}-${valueText(item.externalIdentityId)}-${valueText(item.activityDate)}-${index}`}><strong>{item.verifiedDisplayName ? valueText(item.verifiedDisplayName) : "미연결 사용자"}</strong><span>메시지 {valueText(item.messageCount)} · 미디어 {valueText(item.mediaCount)} · 답글 {valueText(item.replyCount)} · 멘션 {valueText(item.mentionCount)}</span><small>{valueText(item.activityDate)} · Iris 관측명(미신뢰) {valueText(item.observedDisplayName)}</small></div>)}</section>}
    {tab === "incidents" && <section className="card console-table"><h2>수정·삭제 감지 사건</h2>{items.length === 0 ? <p>감지된 사건이 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><strong>{valueText(item.incidentType)}</strong><span>상태 {valueText(item.status)} · 대상 이벤트 {valueText(item.targetProviderEventId)}</span><small>{valueText(item.occurredAt)} · 원문 메시지는 저장하지 않아요.</small></div>)}</section>}
    {tab === "deletions" && <section className="card console-table"><h2>30일 탈퇴 유예 <small>전체 {numberText(total)}건</small></h2>{items.length === 0 ? <p>처리할 탈퇴 요청이 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><strong>요청 #{valueText(item.id)}</strong><span>Player #{valueText(item.playerId)}</span><small>{monitoringDate(item.scheduledDeleteAt)}</small><button onClick={() => void mutate(`/api/v1/admin/account-deletion-requests/${valueText(item.id)}`, "PATCH", { status: "recovered" }, "이 계정을 복구할까요?")}>복구</button></div>)}</section>}
    {tab === "operators" && <section className="card console-table"><h2>운영자와 권한 <small>전체 {numberText(total)}명</small></h2>{items.length === 0 ? <p>등록된 운영자가 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><strong>{valueText(item.displayName)}</strong><span>{valueText(item.loginId)}</span><small>{valueText(item.roleCodes)} · {valueText(item.status)}</small>{can("authorization.manage") && !((item.roleCodes as unknown[] | undefined)?.includes("super_admin")) && <button onClick={() => { const permissionCode = window.prompt("부여할 권한 코드를 입력해 주세요."); if (permissionCode) void mutate(`/api/v1/admin/operators/${valueText(item.id)}/permission-overrides/${permissionCode}`, "PUT", { effect: "allow" }, "이 권한을 부여할까요?"); }}>권한 부여</button>}</div>)}</section>}
    {tab === "audit" && <section className="card console-table"><h2>변경 감사 기록 <small>전체 {numberText(total)}건 · 최신 {numberText(items.length)}건 표시</small></h2>{items.length === 0 ? <p>기록된 관리자 변경이 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><strong>{valueText(item.actionCode)}</strong><span>{valueText(item.targetType)} #{valueText(item.targetId)}</span><small>{valueText(item.reason)} · {monitoringDate(item.createdAt)}</small></div>)}</section>}
  </section>{membershipDetail !== null && <div className="console-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMembershipDetail(null); }}><section className="card console-modal" role="dialog" aria-modal="true" aria-labelledby="membership-detail-title"><div className="console-modal-heading"><div><span className="eyebrow">MEMBERSHIP HISTORY</span><h2 id="membership-detail-title">입장·퇴장 상세</h2><p><b>방</b> {monitoringName(membershipDetail.subject.channelName, "이름 미확인")} · <b>사용자</b> {monitoringName(membershipDetail.subject.verifiedDisplayName, "이름 미확인")}</p></div><button aria-label="닫기" onClick={() => setMembershipDetail(null)}>닫기</button></div><div className="membership-history-summary"><span>입장 {valueText(membershipDetail.subject.joinedCount)}회</span><span>퇴장 {valueText(membershipDetail.subject.departedCount)}회</span><span>전체 {numberText(membershipDetail.total)}건</span></div><div className="membership-history-list">{membershipDetail.items.length === 0 ? <p>확인할 입장·퇴장 기록이 없어요.</p> : membershipDetail.items.map((item) => <div key={valueText(item.id)}><strong>{item.membershipEventCode === "joined" ? "입장" : "퇴장"}</strong><span>{monitoringDate(item.occurredAt)}</span></div>)}</div>{membershipDetail.total > membershipDetail.items.length && <small>최신 {numberText(membershipDetail.items.length)}건까지 표시해요.</small>}</section></div>}</main>;
}

function Signup({ onHome, onLogin, mode = "new" }: {
  onHome: () => void;
  onLogin: () => void;
  mode?: "new" | "resume";
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [systemAccountName, setSystemAccountName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [result, setResult] = useState<SignupResult | null>(null);
  const [status, setStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!result || status === "verified") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/v1/verification-challenges/${result.challengeId}`);
        const payload = await response.json();
        if (response.ok && payload.ok) setStatus(payload.verification.status);
      } catch { /* 다음 주기에 다시 확인한다. */ }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [result, status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== passwordConfirm) { setError("비밀번호가 서로 달라요."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/user-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId, password, systemAccountName, acceptTerms: termsAccepted })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "회원가입 요청을 처리하지 못했어요.");
      setResult(payload.signup);
      setStatus("PENDING");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회원가입 요청을 처리하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reissue() {
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/verification-challenges", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId, password })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "인증코드를 다시 발급하지 못했어요.");
      setResult(payload.signup);
      setSystemAccountName(payload.signup.systemAccountName);
      setStatus("PENDING");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "인증코드를 다시 발급하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="signup-page page-shell">
    <div className="breadcrumb"><button onClick={onHome}>홈</button><span>›</span><span>회원가입</span></div>
    <section className="signup-layout">
      <div className="signup-intro">
        <h1>카카오톡에서 시작하고,<br />어디서든 이어서 플레이해요.</h1>
        <p>사이트 계정을 먼저 만든 뒤 카카오톡에서 한 번만 인증하면 돼요. 이메일과 전화번호는 받지 않아요.</p>
        <ol><li><b>1</b><span>사이트 계정과 캐릭터 이름 만들기</span></li><li><b>2</b><span>카카오톡의 호월봇 프로필에 인증코드 입력하기</span></li><li><b>3</b><span>같은 캐릭터로 명령어 사용하기</span></li></ol>
      </div>
      <section className="card signup-card">
        {status === "verified" ? <div className="signup-success"><span>✓</span><h2>연동이 완료됐어요</h2><p>이제 카카오톡의 호월봇 프로필에서 <strong>{systemAccountName}</strong> 이름으로 명령어를 사용할 수 있어요.</p><button className="primary-action" onClick={onLogin}>로그인하기</button><button className="text-button" onClick={onHome}>홈으로 가기</button></div>
          : result ? <div className="verification-panel"><span className="eyebrow">KAKAOTALK VERIFICATION</span><h2>카카오톡에서 인증해 주세요</h2><p>현재 닉네임을 <strong>{systemAccountName}</strong>(으)로 맞춘 뒤 봇이 있는 방에 아래 명령어를 보내세요.</p><div className="verification-code">/인증 {result.verificationCode}</div><small>인증코드는 {new Date(result.codeExpiresAt).toLocaleString("ko-KR")}까지 한 번만 사용할 수 있어요.</small>{status === "pending" || status === "PENDING" ? <div className="waiting"><span className="live-dot" />카카오톡 인증을 기다리는 중이에요</div> : <div className="verification-reissue"><p>인증코드가 더 이상 유효하지 않아요.</p><button className="primary-action" disabled={submitting} onClick={reissue}>{submitting ? "다시 발급 중..." : "새 인증코드 발급"}</button>{error && <p className="form-error" role="alert">{error}</p>}</div>}</div>
          : mode === "resume" ? <form onSubmit={(event) => { event.preventDefault(); void reissue(); }} className="signup-form">
            <h2>카카오톡 인증 계속하기</h2><p className="form-description">가입할 때 만든 아이디와 비밀번호를 확인한 뒤 새 인증코드를 발급해요.</p>
            <label>로그인 아이디<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" /></label>
            <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-action" disabled={submitting}>{submitting ? "확인 중..." : "새 인증코드 발급"}</button>
          </form>
          : <form onSubmit={submit} className="signup-form">
            <h2>회원가입</h2><p className="form-description">가입 완료 후 카카오톡 인증코드를 발급해 드려요.</p>
            <label>로그인 아이디<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" placeholder="영문 소문자·숫자 6~20자" /></label>
            <label>캐릭터 이름<input value={systemAccountName} onChange={(event) => setSystemAccountName(event.target.value)} placeholder="예: 호이 남" /><small>한글 2글자 + 공백 + 남 또는 여</small></label>
            <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="영문·숫자 포함 8~64자" /></label>
            <label>비밀번호 확인<input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
            <div className="agreements"><label><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />이용약관에 동의해요. (필수)</label></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-action" disabled={submitting}>{submitting ? "계정을 만드는 중..." : "인증코드 발급"}</button>
            <p className="privacy-note">이메일·전화번호·IP·기기정보를 계정 정보로 저장하지 않아요.</p>
          </form>}
      </section>
    </section>
  </main>;
}

function SearchBar({ initial = "", onSearch, compact = false }: { initial?: string; onSearch: (name: string) => void; compact?: boolean }) {
  const [name, setName] = useState(initial);
  function submit(event: FormEvent) { event.preventDefault(); if (name.trim()) onSearch(name.trim()); }
  return <form className={`search-bar ${compact ? "compact" : ""}`} onSubmit={submit} data-testid="player-search">
    <Icon>⌕</Icon><input value={name} onChange={(event) => setName(event.target.value)} placeholder="카카오톡 닉네임 또는 Player ID를 입력하세요" aria-label="회원 검색" />
    <button type="submit">검색</button>
  </form>;
}

function Home({ onSearch, onSignup }: { onSearch: (name: string) => void; onSignup: () => void }) {
  const [overview, setOverview] = useState<PublicOverview | null>(null);
  const [overviewUnavailable, setOverviewUnavailable] = useState(false);
  useEffect(() => {
    void fetch("/api/v1/public/overview").then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("overview unavailable");
      setOverview(payload as PublicOverview);
    }).catch(() => setOverviewUnavailable(true));
  }, []);
  const metrics = overview?.metrics;
  const databaseReady = overview?.service.database === "ready";
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">ACCOUNT</span><h1>계정을 만들고<br />카카오톡과 연결해요.</h1><p>사이트에서 계정을 만든 뒤 발급된 인증코드를<br />호월봇 프로필에 입력하면 가입이 완료돼요.</p></div>
      <div className="hero-orbit" aria-hidden="true"><span className="orb orb-a">✦</span><span className="orb orb-b">H</span><span className="orb orb-c">♢</span><div className="orbit-ring" /></div>
      {visibleFeatures.playerSearch ? <SearchBar onSearch={onSearch} /> : <button className="hero-signup" onClick={onSignup}>회원가입 시작하기</button>}
    </section>

    <main className="page-shell home-content">
      <div className="quick-grid live-overview" aria-live="polite">
        <article className="card status-card"><div className="card-title"><Icon>◉</Icon><span>서버 상태</span></div><strong>{overviewUnavailable ? "연결 확인 필요" : overview === null ? "확인 중" : databaseReady ? <><span className="live-dot" />정상</> : "DB 점검 필요"}</strong><p>hoiBot API · MariaDB 실시간 확인</p></article>
        <article className="card"><div className="card-title"><Icon>♙</Icon><span>활성 캐릭터</span></div><strong className="metric">{metrics ? numberText(metrics.activePlayers) : "-"}</strong><p>현재 MariaDB 기준</p></article>
        <article className="card"><div className="card-title"><Icon>⌁</Icon><span>관찰 채널</span></div><strong className="metric">{metrics ? numberText(metrics.activeChannels) : "-"}</strong><p>활성 Iris 채널</p></article>
        <article className="card"><div className="card-title"><Icon>↗</Icon><span>최근 24시간 이벤트</span></div><strong className="metric">{metrics ? numberText(metrics.eventsLast24Hours) : "-"}</strong><p>{metrics?.lastEventAt ? `최근 수신 ${monitoringDate(metrics.lastEventAt)}` : "수신 기록 없음"}</p></article>
      </div>

      {visibleFeatures.futureOverview && <section className="feature-banner"><div><span className="eyebrow">NEW FEATURE</span><h2>내 캐릭터의 모든 기록이<br />하나의 이야기로 이어져요.</h2><p>재화 원장부터 길드와 홈 활동까지 안전하게 기록하고 보여드립니다.</p></div><div className="banner-cards"><span>💎<b>다이아</b></span><span>🐾<b>펫 성장</b></span><span>🏡<b>마이 홈</b></span></div></section>}
    </main>
  </>;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return <article className={`stat-card ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function Profile({ name, onSearch, onHome }: { name: string; onSearch: (name: string) => void; onHome: () => void }) {
  const [tab, setTab] = useState("요약");
  return <main className="profile-page page-shell">
    <div className="breadcrumb"><button onClick={onHome}>홈</button><span>›</span><span>캐릭터 정보</span></div>
    <SearchBar initial={name} compact onSearch={onSearch} />

    <section className="profile-hero card">
      <div className="avatar-large">{name.slice(0, 1)}</div>
      <div className="identity"><span className="server-label">호이 2서버</span><h1>{name}</h1><p>Player #000184 · 가입 842일째</p><div className="badges"><span>🏰 성주 길드</span><span>✨ 미니펫 랭커</span><span>PREMIUM</span></div></div>
      <div className="level-panel"><span>현재 레벨</span><strong>1,176</strong><div className="level-progress"><span /></div><small>다음 레벨까지 68%</small></div>
      <button className="favorite" aria-label="즐겨찾기">☆</button>
    </section>

    <section className="stats-grid"><Stat label="보유 포인트" value="13,989,627,223 P" hint="누적 +10.1%" tone="violet" /><Stat label="다이아" value="24,850" hint="이번 달 +2,400" tone="blue" /><Stat label="환생 횟수" value="42회" hint="전체 상위 3.2%" tone="orange" /><Stat label="홈 매력" value="18,640" hint="서버 12위" tone="green" /></section>

    <div className="profile-layout">
      <section className="main-column">
        <div className="tabs" role="tablist">{["요약", "인벤토리", "펫·스킬", "길드", "홈", "활동 기록"].map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
        <section className="card summary-panel">
          <div className="section-heading"><div><span className="eyebrow">CHARACTER</span><h2>{tab === "요약" ? "성장 요약" : tab}</h2></div><span className="sync-label">방금 동기화됨</span></div>
          <div className="growth-grid"><div className="growth-chart"><div className="chart-ring"><span>상위<br /><strong>3.2%</strong></span></div><p>전체 성장 지수</p></div><div className="growth-bars">{[["레벨",92],["펫 성장",78],["홈 매력",66],["길드 기여",84]].map(([label,value]) => <div key={String(label)}><span>{label}</span><div><i style={{width:`${value}%`}} /></div><b>{value}</b></div>)}</div></div>
        </section>
        <div className="detail-grid">
          <section className="card pet-card"><div className="section-heading"><h2>대표 펫</h2><button className="text-button">상세보기 →</button></div><div className="pet-content"><div className="pet-visual">☁️<span>🐇</span></div><div><span className="grade">LEGENDARY</span><h3>별구름 래빗</h3><p>강화 +18 · 친밀도 982</p><div className="skill-chips"><span>⚔ 별빛 베기</span><span>✦ 행운 증폭</span></div></div></div></section>
          <section className="card guild-card"><div className="section-heading"><h2>길드</h2><button className="text-button">길드 홈 →</button></div><div className="guild-emblem">H</div><h3>성주 길드</h3><p>운영진 · 기여도 182,450</p><div className="guild-stats"><span><b>15</b>길드 순위</span><span><b>42명</b>길드원</span></div></section>
        </div>
        <section className="card activity-card"><div className="section-heading"><h2>최근 활동</h2><button className="text-button">전체 기록 →</button></div><ul>{activities.map(([action,value,time]) => <li key={action}><span className="activity-icon">↗</span><div><strong>{action}</strong><p>{value}</p></div><time>{time}</time></li>)}</ul></section>
      </section>

      <aside>
        <section className="card operator-card"><span className="eyebrow">OPERATOR TOOLS</span><h2>빠른 운영</h2><p>모든 변경은 감사 기록과 원장에 남습니다.</p><label>서버 배정<select defaultValue="server-2"><option value="server-1">호이 1서버</option><option value="server-2">호이 2서버</option><option value="server-3">호이 3서버</option></select></label><label>변경 사유<input placeholder="사유를 입력하세요" /></label><button className="primary-action">서버 변경</button><div className="operator-links"><button>재화 지급</button><button>아이템 지급</button><button>Identity 관리</button></div></section>
        <section className="card info-list"><h2>계정 정보</h2><dl><div><dt>활성 타이틀</dt><dd>별을 품은 모험가</dd></div><div><dt>패스</dt><dd><span className="active-text">Premium 활성</span></dd></div><div><dt>길드 역할</dt><dd>운영진</dd></div><div><dt>마지막 접속</dt><dd>3분 전</dd></div></dl></section>
      </aside>
    </div>
  </main>;
}

function App() {
  const [page, setPage] = useState<Page>(() => window.location.pathname.startsWith("/admin") ? "admin-login" : "home");
  const [selectedName, setSelectedName] = useState("정현");
  const [session, setSession] = useState<UserSession | null>(null);
  const [csrfToken, setCsrfToken] = useState(() => window.sessionStorage.getItem("hoibot-csrf") ?? "");
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [adminCsrfToken, setAdminCsrfToken] = useState(() => window.sessionStorage.getItem("hoiworld-admin-csrf") ?? "");
  useEffect(() => {
    void fetch("/api/v1/sessions/current", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.ok) {
        setSession(payload.session);
        setCsrfToken(payload.csrfToken);
        window.sessionStorage.setItem("hoibot-csrf", payload.csrfToken);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!window.location.pathname.startsWith("/admin")) return;
    void fetch("/api/v1/admin/sessions/current", { credentials: "include" }).then(async (response) => {
      if (!response.ok) return; const payload = await response.json();
      if (payload.ok) { setAdminSession(payload.session); setPage("admin"); if (window.location.pathname !== "/admin/console") window.history.replaceState({}, "", "/admin/console"); }
    }).catch(() => undefined);
  }, []);
  function search(name: string) { setSelectedName(name); setPage("profile"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function home() { setPage("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function signup() { setPage("signup"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function resumeSignup() { setPage("resume-signup"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function login() { setPage("login"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function account() { setPage(session ? "account" : "login"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function loggedIn(nextSession: UserSession, nextCsrfToken: string) { setSession(nextSession); setCsrfToken(nextCsrfToken); window.sessionStorage.setItem("hoibot-csrf", nextCsrfToken); setPage("account"); }
  async function logout() {
    const response = await fetch("/api/v1/sessions/current", { method: "DELETE", credentials: "include", headers: { "x-csrf-token": csrfToken } });
    if (!response.ok) throw new Error("로그아웃하지 못했어요.");
    setSession(null); setCsrfToken(""); window.sessionStorage.removeItem("hoibot-csrf"); setPage("home");
  }
  function adminLoggedIn(nextSession: AdminSession, nextCsrfToken: string) { setAdminSession(nextSession); setAdminCsrfToken(nextCsrfToken); window.sessionStorage.setItem("hoiworld-admin-csrf", nextCsrfToken); window.history.replaceState({}, "", "/admin/console"); setPage("admin"); }
  async function adminLogout() { const response = await fetch("/api/v1/admin/sessions/current", { method: "DELETE", credentials: "include", headers: { "x-csrf-token": adminCsrfToken } }); if (!response.ok) throw new Error("관리자 로그아웃에 실패했어요."); setAdminSession(null); setAdminCsrfToken(""); window.sessionStorage.removeItem("hoiworld-admin-csrf"); window.history.replaceState({}, "", "/admin"); setPage("admin-login"); }
  let content: ReactNode;
  if (page === "home") content = <Home onSearch={search} onSignup={signup} />;
  else if (page === "profile") content = <Profile name={selectedName} onSearch={search} onHome={home} />;
  else if (page === "signup") content = <Signup onHome={home} onLogin={login} />;
  else if (page === "resume-signup") content = <Signup onHome={home} onLogin={login} mode="resume" />;
  else if (page === "login") content = <Login onSignup={signup} onResumeSignup={resumeSignup} onLoggedIn={loggedIn} />;
  else if (page === "account") content = session ? <Account session={session} onLogout={logout} /> : <Login onSignup={signup} onResumeSignup={resumeSignup} onLoggedIn={loggedIn} />;
  else if (page === "admin-login") content = <AdminLogin onLoggedIn={adminLoggedIn} />;
  else content = adminSession ? <AdminConsole session={adminSession} csrfToken={adminCsrfToken} onLogout={adminLogout} /> : <AdminLogin onLoggedIn={adminLoggedIn} />;
  const adminPage = page === "admin" || page === "admin-login";
  return <div className="app">{adminPage ? <header className="topbar"><button className="brand" onClick={() => { window.location.href = "/"; }}><span className="brand-mark">H</span><span>호이<span>월드</span></span></button><span className="admin-context">관리자</span></header> : <Header page={page} session={session} onHome={home} onLogin={login} onAccount={account} />}{content}<footer className="site-footer"><span>© 2026 호이월드</span></footer></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
