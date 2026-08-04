import { StrictMode, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

interface PlayerSummary { playerId: string; displayName: string; profileVersion: string; server: { displayName: string } | null }
interface IdentityCandidate { id: string; providerCode: string; externalUserId: string; displayName: string | null; playerId: string | null }
interface GameServer { code: string; displayName: string; active: boolean }
interface AuditEntry { id: string; actionCode: string; resultCode: string; reason: string | null; createdAt: string }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include" });
  const body = await response.json() as T & { ok?: boolean; error?: { message: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "요청을 처리하지 못했습니다.");
  return body;
}

function App() {
  const [csrfToken, setCsrfToken] = useState("");
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState("관리자 로그인이 필요합니다.");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = await api<{ csrfToken: string }>("/api/v1/admin/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loginId: form.get("loginId"), password: form.get("password") }) });
      setCsrfToken(body.csrfToken);
      setMessage("로그인했습니다.");
      await loadOperations();
    } catch (error) { setMessage((error as Error).message); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(new FormData(event.currentTarget).get("search") ?? "");
    try {
      const body = await api<{ players: PlayerSummary[] }>(`/api/v1/admin/players?search=${encodeURIComponent(search)}`);
      setPlayers(body.players);
    } catch (error) { setMessage((error as Error).message); }
  }

  async function loadOperations() {
    try {
      const [serverBody, candidateBody, auditBody] = await Promise.all([
        api<{ servers: GameServer[] }>("/api/v1/admin/game-servers"),
        api<{ candidates: IdentityCandidate[] }>("/api/v1/admin/identity-candidates"),
        api<{ entries: AuditEntry[] }>("/api/v1/admin/audit?limit=20")
      ]);
      setServers(serverBody.servers); setCandidates(candidateBody.candidates); setAudit(auditBody.entries);
    } catch (error) { setMessage((error as Error).message); }
  }

  async function changeServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const playerId = String(form.get("playerId"));
    try {
      await api(`/api/v1/admin/players/${encodeURIComponent(playerId)}/server`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ serverCode: form.get("serverCode"), expectedVersion: form.get("expectedVersion"), reason: form.get("reason") })
      });
      setMessage("서버 배정을 변경했습니다."); await loadOperations();
    } catch (error) { setMessage((error as Error).message); }
  }

  async function approveIdentity(candidate: IdentityCandidate, playerId: string) {
    try {
      await api(`/api/v1/admin/identity-candidates/${candidate.id}/approve`, {
        method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ playerId, reason: "관리 화면 identity 승인" })
      });
      setMessage("identity 연결을 승인했습니다."); await loadOperations();
    } catch (error) { setMessage((error as Error).message); }
  }

  return <main>
    <header><p>hoiBot Server</p><h1>운영 관리</h1><span>{message}</span></header>
    <section><h2>로그인</h2><form onSubmit={login}><input name="loginId" autoComplete="username" placeholder="운영자 ID" required /><input name="password" type="password" autoComplete="current-password" placeholder="비밀번호" required /><button>로그인</button></form></section>
    <section><h2>회원 조회</h2><form onSubmit={search}><input name="search" placeholder="이름 또는 player ID" /><button>검색</button></form><ul>{players.map((player) => <li key={player.playerId}><strong>{player.displayName}</strong><span>#{player.playerId} · {player.server?.displayName ?? "미배정"} · v{player.profileVersion}</span></li>)}</ul></section>
    <section><h2>서버 배정 변경</h2><form onSubmit={changeServer}><input name="playerId" placeholder="player ID" required /><input name="expectedVersion" placeholder="현재 version" required /><select name="serverCode" required><option value="">서버 선택</option>{servers.filter((server) => server.active).map((server) => <option key={server.code} value={server.code}>{server.displayName}</option>)}</select><input name="reason" placeholder="변경 사유" required /><button>변경</button></form></section>
    <section><h2>Identity 후보</h2><ul>{candidates.map((candidate) => <li key={candidate.id}><span>{candidate.providerCode} · {candidate.displayName ?? "이름 없음"}</span><button onClick={() => { const playerId = window.prompt("연결할 player ID"); if (playerId) void approveIdentity(candidate, playerId); }}>승인</button></li>)}</ul></section>
    <section><h2>최근 감사 기록</h2><ul>{audit.map((entry) => <li key={entry.id}><strong>{entry.actionCode}</strong><span>{entry.resultCode} · {entry.reason ?? "사유 없음"} · {new Date(entry.createdAt).toLocaleString("ko-KR")}</span></li>)}</ul></section>
    <footer>변경 API는 HttpOnly 세션 쿠키, CSRF 토큰, Idempotency-Key를 함께 사용합니다.</footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
