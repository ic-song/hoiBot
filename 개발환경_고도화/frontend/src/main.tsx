import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react";
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
  operationalDashboard: false,
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
  return <main className="auth-page page-shell"><section className="card account-card"><div className="account-avatar">{session.systemAccountName.slice(0, 1)}</div><span className="eyebrow">MY ACCOUNT</span><h1>{session.systemAccountName}</h1><p>시스템 계정</p><dl><div><dt>로그인 아이디</dt><dd>{session.loginId}</dd></div><div><dt>Player ID</dt><dd>{session.playerId}</dd></div><div><dt>연결 상태</dt><dd className="active-text">카카오톡 연결됨</dd></div></dl>{error && <p className="form-error" role="alert">{error}</p>}<button className="logout-button" disabled={loggingOut} onClick={async () => { setError(""); setLoggingOut(true); try { await onLogout(); } catch (caught) { setError(caught instanceof Error ? caught.message : "로그아웃하지 못했어요."); } finally { setLoggingOut(false); } }}>{loggingOut ? "로그아웃 중..." : "로그아웃"}</button></section></main>;
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

type AdminTab = "overview" | "players" | "identities" | "deletions" | "operators" | "audit";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AdminConsole({ session, csrfToken, onLogout }: { session: AdminSession; csrfToken: string; onLogout: () => Promise<void> }) {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [readiness, setReadiness] = useState<{ server: string; database: string }>({ server: "확인 중", database: "확인 중" });
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [overview, setOverview] = useState<JsonRecord>({});
  const [selectedPlayer, setSelectedPlayer] = useState<JsonRecord | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const can = (permission: string) => session.permissions.includes(permission);
  const menu: Array<{ key: AdminTab; label: string; permission: string }> = [
    { key: "overview", label: "대시보드", permission: "overview.read" },
    { key: "players", label: "회원 관리", permission: "player.read" },
    { key: "identities", label: "계정 연동", permission: "identity.read" },
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
    setLoading(true); setError(""); setSelectedPlayer(null);
    try {
      if (target === "overview") { const payload = await api("/api/v1/admin/overview"); setOverview(payload.overview as JsonRecord); setItems([]); }
      else {
        const paths: Record<Exclude<AdminTab, "overview">, string> = {
          players: `/api/v1/admin/players?search=${encodeURIComponent(query)}&page=1&limit=50`, identities: "/api/v1/admin/external-identities?status=candidate&page=1&limit=50",
          deletions: "/api/v1/admin/account-deletion-requests", operators: "/api/v1/admin/operators", audit: "/api/v1/admin/audit-entries?page=1&limit=100"
        };
        const payload = await api(paths[target]); setItems((payload.items as JsonRecord[]) ?? []);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "데이터를 불러오지 못했어요."); }
    finally { setLoading(false); }
  }

  async function mutate(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", values: JsonRecord, promptText: string) {
    const reason = window.prompt("변경 사유를 입력해 주세요.");
    if (!reason?.trim() || !window.confirm(promptText)) return;
    await api(path, { method, headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ ...values, reason: reason.trim(), confirmed: true }) });
    await load();
  }

  useEffect(() => {
    void fetch("/health/ready").then(async (response) => { const payload = await response.json(); setReadiness({ server: response.ok ? "정상" : "점검 필요", database: payload.database === "ready" ? "정상" : "점검 필요" }); }).catch(() => setReadiness({ server: "연결 실패", database: "확인 불가" }));
    void load("overview");
  }, []);

  async function selectPlayer(playerId: string) { setError(""); try { const payload = await api(`/api/v1/admin/players/${playerId}`); setSelectedPlayer(payload.player as JsonRecord); } catch (caught) { setError(caught instanceof Error ? caught.message : "회원을 불러오지 못했어요."); } }

  const overviewCards: Array<[string, unknown]> = [
    ["활성 회원", overview.activePlayers], ["활성 제재", overview.activeRestrictions], ["탈퇴 유예", overview.deletionGrace],
    ["연동 후보", overview.identityCandidates], ["Outbox 실패", overview.outboxFailures], ["운영자", overview.activeOperators]
  ];

  return <main className="console-page page-shell"><aside className="console-sidebar"><span className="admin-label">ADMIN CONSOLE</span><h2>운영 메뉴</h2>{menu.filter((item) => can(item.permission)).map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => { setTab(item.key); void load(item.key); }}>{item.label}</button>)}<div className="console-operator"><strong>{session.displayName}</strong><span>{session.roleCodes.join(", ") || "권한 없음"}</span><small>{session.loginId}</small></div><button className="console-logout" onClick={() => void onLogout()}>로그아웃</button></aside><section className="console-content"><div className="console-heading"><div><span className="eyebrow">{tab.toUpperCase()}</span><h1>{menu.find((item) => item.key === tab)?.label}</h1><p>권한이 있는 운영 기능만 표시돼요. 모든 변경은 사유와 재확인이 필요합니다.</p></div><span className="console-session"><i />관리자 로그인됨</span></div>{error && <p className="form-error" role="alert">{error}</p>}{loading && <p className="console-loading">불러오는 중...</p>}
    {tab === "overview" && <><div className="console-status-grid"><article className="card"><span>Node.js 서버</span><strong>{readiness.server}</strong><small>hoiBot Server</small></article><article className="card"><span>MariaDB</span><strong>{readiness.database}</strong><small>데이터베이스</small></article><article className="card"><span>현재 권한</span><strong>{session.permissions.length}개</strong><small>{session.roleCodes.join(", ")}</small></article></div><div className="console-metric-grid">{overviewCards.map(([label, value]) => <article className="card" key={String(label)}><span>{label}</span><strong>{valueText(value)}</strong></article>)}</div><section className="card permission-panel"><h2>현재 권한</h2><div className="permission-list">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div></section></>}
    {tab === "players" && <><form className="console-toolbar" onSubmit={(event) => { event.preventDefault(); void load("players", search); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="캐릭터 이름 또는 Player ID" /><button>검색</button></form><div className="console-split"><section className="card console-list"><h2>회원 목록</h2>{items.map((item) => <button key={valueText(item.playerId)} onClick={() => void selectPlayer(valueText(item.playerId))}><strong>{valueText(item.displayName)}</strong><span>#{valueText(item.playerId)} · {valueText((item.server as JsonRecord | null)?.displayName)}</span></button>)}</section>{selectedPlayer && <section className="card console-detail"><h2>{valueText(selectedPlayer.displayName)}</h2><p>Player #{valueText(selectedPlayer.playerId)} · 버전 {valueText(selectedPlayer.profileVersion)}</p><dl><div><dt>서버</dt><dd>{valueText((selectedPlayer.server as JsonRecord | null)?.displayName)}</dd></div><div><dt>프리패스</dt><dd>{valueText((selectedPlayer.passes as JsonRecord[] | undefined)?.map((pass) => pass.code))}</dd></div><div><dt>제재</dt><dd>{valueText((selectedPlayer.restrictions as JsonRecord[] | undefined)?.map((row) => row.status))}</dd></div></dl><div className="console-actions">{can("player.server.assign") && <button onClick={() => { const code = window.prompt("배정할 서버 코드를 입력해 주세요."); if (code) void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/server-assignment`, "PUT", { serverCode: code, expectedVersion: selectedPlayer.profileVersion }, "서버 배정을 변경할까요?"); }}>서버 배정</button>}{can("pass.grant") && <button onClick={() => { const code = window.prompt("프리패스 코드를 입력해 주세요.", "premium"); if (code) void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/passes/${code}`, "PUT", { permanent: true }, "영구 프리패스를 지급할까요?"); }}>프리패스 지급</button>}{can("account.restrict") && <button className="danger" onClick={() => void mutate(`/api/v1/admin/players/${valueText(selectedPlayer.playerId)}/restrictions`, "POST", { restrictionType: "permanent_suspension" }, "이 계정을 영구 정지할까요?")}>영구 정지</button>}</div></section>}</div></>}
    {tab === "identities" && <section className="card console-table"><h2>연동 후보</h2>{items.length === 0 ? <p>대기 중인 연동 후보가 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><span>{valueText(item.providerCode)}</span><strong>{valueText(item.displayName)}</strong><small>{valueText(item.externalUserId)}</small>{can("identity.assign") && <button onClick={() => { const playerId = window.prompt("연결할 Player ID를 입력해 주세요."); if (playerId) void mutate(`/api/v1/admin/external-identities/${valueText(item.id)}/player-assignment`, "PUT", { playerId }, "외부 계정을 연결할까요?"); }}>연결</button>}</div>)}</section>}
    {tab === "deletions" && <section className="card console-table"><h2>30일 탈퇴 유예</h2>{items.length === 0 ? <p>처리할 탈퇴 요청이 없어요.</p> : items.map((item) => <div key={valueText(item.id)}><strong>요청 #{valueText(item.id)}</strong><span>Player #{valueText(item.playerId)}</span><small>{valueText(item.scheduledDeleteAt)}</small><button onClick={() => void mutate(`/api/v1/admin/account-deletion-requests/${valueText(item.id)}`, "PATCH", { status: "recovered" }, "이 계정을 복구할까요?")}>복구</button></div>)}</section>}
    {tab === "operators" && <section className="card console-table"><h2>운영자와 권한</h2>{items.map((item) => <div key={valueText(item.id)}><strong>{valueText(item.displayName)}</strong><span>{valueText(item.loginId)}</span><small>{valueText(item.roleCodes)} · {valueText(item.status)}</small>{can("authorization.manage") && !((item.roleCodes as unknown[] | undefined)?.includes("super_admin")) && <button onClick={() => { const permissionCode = window.prompt("부여할 권한 코드를 입력해 주세요."); if (permissionCode) void mutate(`/api/v1/admin/operators/${valueText(item.id)}/permission-overrides/${permissionCode}`, "PUT", { effect: "allow" }, "이 권한을 부여할까요?"); }}>권한 부여</button>}</div>)}</section>}
    {tab === "audit" && <section className="card console-table"><h2>변경 감사 기록</h2>{items.map((item) => <div key={valueText(item.id)}><strong>{valueText(item.actionCode)}</strong><span>{valueText(item.targetType)} #{valueText(item.targetId)}</span><small>{valueText(item.reason)} · {valueText(item.createdAt)}</small></div>)}</section>}
  </section></main>;
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
        <ol><li><b>1</b><span>사이트 계정과 캐릭터 이름 만들기</span></li><li><b>2</b><span>카카오톡의 HOIBOT 프로필에 인증코드 입력하기</span></li><li><b>3</b><span>같은 캐릭터로 명령어 사용하기</span></li></ol>
      </div>
      <section className="card signup-card">
        {status === "verified" ? <div className="signup-success"><span>✓</span><h2>연동이 완료됐어요</h2><p>이제 카카오톡의 HOIBOT 프로필에서 <strong>{systemAccountName}</strong> 이름으로 명령어를 사용할 수 있어요.</p><button className="primary-action" onClick={onLogin}>로그인하기</button><button className="text-button" onClick={onHome}>홈으로 가기</button></div>
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
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">ACCOUNT</span><h1>계정을 만들고<br />카카오톡과 연결해요.</h1><p>사이트에서 계정을 만든 뒤 발급된 인증코드를<br />HOIBOT 프로필에 입력하면 가입이 완료돼요.</p></div>
      <div className="hero-orbit" aria-hidden="true"><span className="orb orb-a">✦</span><span className="orb orb-b">H</span><span className="orb orb-c">♢</span><div className="orbit-ring" /></div>
      {visibleFeatures.playerSearch ? <SearchBar onSearch={onSearch} /> : <button className="hero-signup" onClick={onSignup}>회원가입 시작하기</button>}
    </section>

    <main className="page-shell home-content">
      {visibleFeatures.operationalDashboard && <><div className="quick-grid">
        <article className="card status-card"><div className="card-title"><Icon>◉</Icon><span>서버 상태</span></div><strong><span className="live-dot" />모든 시스템 정상</strong><p>Iris · API · MariaDB 연결됨</p></article>
        <article className="card"><div className="card-title"><Icon>♙</Icon><span>등록 모험가</span></div><strong className="metric">610</strong><p>오늘 신규 가입 3명</p></article>
        <article className="card"><div className="card-title"><Icon>⌁</Icon><span>오늘의 명령</span></div><strong className="metric">12,482</strong><p>어제보다 8.4% 증가</p></article>
        <article className="card accent-card"><span className="eyebrow">LIVE EVENT</span><h3>별빛 미니펫 페스타</h3><p>이벤트 종료까지 2일 18시간</p><div className="progress"><span /></div></article>
      </div>

      <div className="home-layout">
        <section className="card notice-card"><div className="section-heading"><div><span className="eyebrow">NOTICE</span><h2>호이랜드 소식</h2></div><button className="text-button">전체보기 →</button></div>
          <ul className="notice-list"><li><span className="notice-tag important">중요</span><strong>신규 Iris 서버 전환 사전 안내</strong><time>08.05</time></li><li><span className="notice-tag update">업데이트</span><strong>거래소 수수료 원장과 길드 창고 개선</strong><time>08.04</time></li><li><span className="notice-tag event">이벤트</span><strong>여름 출석 이벤트 보상 안내</strong><time>08.03</time></li></ul>
        </section>
        <section className="card ranking-card"><div className="section-heading"><div><span className="eyebrow">RANKING</span><h2>레벨 TOP 4</h2></div><button className="text-button">더보기 →</button></div>
          <ol>{ranking.map((row) => <li key={row.rank}><span className={`rank ${row.accent ?? ""}`}>{row.rank}</span><span className="mini-avatar">{row.name.slice(0, 1)}</span><strong>{row.name}</strong><em>{row.value}</em></li>)}</ol>
        </section>
      </div></>}

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
