import { StrictMode, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Page = "home" | "profile";

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

function Header({ page, onHome }: { page: Page; onHome: () => void }) {
  return <header className="topbar">
    <button className="brand" onClick={onHome} aria-label="hoiBot 홈">
      <span className="brand-mark">H</span><span>hoi<span>land</span></span>
    </button>
    <nav aria-label="주요 메뉴">
      <button className={page === "home" ? "active" : ""} onClick={onHome}>홈</button>
      <button>랭킹</button><button>거래소</button><button>길드</button><button>도감</button>
    </nav>
    <div className="header-actions"><span className="live-dot" />서버 정상 <button className="admin-button">운영 콘솔</button></div>
  </header>;
}

function SearchBar({ initial = "", onSearch, compact = false }: { initial?: string; onSearch: (name: string) => void; compact?: boolean }) {
  const [name, setName] = useState(initial);
  function submit(event: FormEvent) { event.preventDefault(); if (name.trim()) onSearch(name.trim()); }
  return <form className={`search-bar ${compact ? "compact" : ""}`} onSubmit={submit} data-testid="player-search">
    <Icon>⌕</Icon><input value={name} onChange={(event) => setName(event.target.value)} placeholder="카카오톡 닉네임 또는 Player ID를 입력하세요" aria-label="회원 검색" />
    <button type="submit">검색</button>
  </form>;
}

function Home({ onSearch }: { onSearch: (name: string) => void }) {
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow">HOILAND GAME DATA</span><h1>우리의 모험을<br />한눈에 만나보세요.</h1><p>캐릭터 성장, 펫, 길드, 홈과 거래 기록까지<br />hoiBot의 모든 플레이 데이터를 한곳에서 확인해요.</p></div>
      <div className="hero-orbit" aria-hidden="true"><span className="orb orb-a">✦</span><span className="orb orb-b">H</span><span className="orb orb-c">♢</span><div className="orbit-ring" /></div>
      <SearchBar onSearch={onSearch} />
    </section>

    <main className="page-shell home-content">
      <div className="quick-grid">
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
      </div>

      <section className="feature-banner"><div><span className="eyebrow">NEW FEATURE</span><h2>내 캐릭터의 모든 기록이<br />하나의 이야기로 이어져요.</h2><p>재화 원장부터 길드와 홈 활동까지 안전하게 기록하고 보여드립니다.</p></div><div className="banner-cards"><span>💎<b>다이아</b></span><span>🐾<b>펫 성장</b></span><span>🏡<b>마이 홈</b></span></div></section>
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
  const [page, setPage] = useState<Page>("home");
  const [selectedName, setSelectedName] = useState("정현");
  function search(name: string) { setSelectedName(name); setPage("profile"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function home() { setPage("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <div className="app"><Header page={page} onHome={home} />{page === "home" ? <Home onSearch={search} /> : <Profile name={selectedName} onSearch={search} onHome={home} />}<footer className="site-footer"><span>© 2026 hoiBot · Modernization UI Mockup</span><span>서비스 상태 · 개인정보 처리방침 · 운영 가이드</span></footer></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
