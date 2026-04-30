const miniGameDataFilePath = "/sdcard/호이랜드/miniGameBotData.json";

// 관리자 리스트 (딜러 권한자)
let adminList = ["호이 남", "닝모 남", "티모 여", "하리 여"];
var allsee = "​".repeat(500);
// 악어게임 상태 객체
let crocGame = {
    isReady: false,     // 준비 여부
    isStarted: false,   // 시작 여부
    dealer: null,       // 딜러(관리자)
    players: [],        // 참여자 리스트
    order: [],          // 랜덤 순서
    turnIndex: 0,       // 현재 차례 인덱스
    usedNumbers: [],    // 이미 사용된 번호들
    eliminated: []      // 탈락자 리스트
};

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
    // 준비
    try {
        // if (!isGroupChat && room != "광산") { return };

        if (msg === "/악어준비") {
            if (!isAdmin(sender)) {
                replier.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                return;
            }
            crocGame = {
                isReady: true,
                isStarted: false,
                dealer: sender,
                players: [],
                order: [],
                turnIndex: 0,
                usedNumbers: [],
                eliminated: []
            };
            replier.reply("🐊 악어게임 준비 완료!\n/ㄹㄷ 입력으로 참여하세요!");
            return;
        }
        // 중간 종료 (관리자 전용)
        if (msg === "/악어강제종료") {
            if (!isAdmin(sender)) {
                replier.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                return;
            }
            if (!crocGame.isStarted && !crocGame.isReady) {
                replier.reply("❌ 진행 중인 악어게임이 없습니다.");
                return;
            }

            // 게임 강제 종료
            let survivors = (crocGame.order && crocGame.order.length > 0) ? crocGame.order.join(", ") : "없음";
            replier.reply("🛑 악어게임이 관리자에 의해 강제중단되었습니다.\n👥 남은 생존자: " + survivors);

            // 상태 초기화
            crocGame = {
                isReady: false,
                isStarted: false,
                dealer: null,
                players: [],
                order: [],
                turnIndex: 0,
                usedNumbers: [],
                eliminated: []
            };
            return;
        }
        // 강제 탈락 (관리자 전용)
        if (msg.startsWith("/악어탈락 ")) {
            if (!isAdmin(sender)) {
                replier.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                return;
            }

            let targetName = msg.replace("/악어탈락", "").trim();
            if (!targetName) {
                replier.reply("❌ 사용법: /돌멩탈락 [유저명]");
                return;
            }

            // 현재 게임 중인지 확인
            if (!crocGame.isStarted) {
                replier.reply("❌ 진행 중인 악어게임이 없습니다.");
                return;
            }

            // 해당 유저가 참가자 명단에 있는지 확인
            let idx = crocGame.order.indexOf(targetName);
            if (idx === -1) {
                replier.reply("❌ [" + targetName + "] 님은 현재 게임에 참여 중이 아닙니다.");
                return;
            }

            // 강제 탈락 처리
            crocGame.eliminated.push(targetName);
            crocGame.order.splice(idx, 1);

            // 턴 인덱스 조정
            if (crocGame.turnIndex >= crocGame.order.length) crocGame.turnIndex = 0;

            let msgOut = "💀 [" + targetName + "] 님이 관리자에 의해 강제 탈락되었습니다!";
            if (crocGame.order.length > 0) {
                msgOut += "\n➡️ 다음 차례: " + crocGame.order[crocGame.turnIndex];
                msgOut += "\n👥 현재 생존자: " + crocGame.order.length + "명";
            }

            replier.reply(msgOut);

            // 🔹 종료 조건 확인
            if (crocGame.order.length === 1) {
                replier.reply("🎉 최종 승자: " + crocGame.order[0]);
                crocGame.isStarted = false;
            } else if (crocGame.usedNumbers.length >= 30) {
                replier.reply("🎉 모든 숫자가 사용되었습니다!\n승자: " + crocGame.order.join(", "));
                crocGame.isStarted = false;
            }
        }

        // 참가자 등록
        if (msg === "/ㄹㄷ" && crocGame.isReady && !crocGame.isStarted) {
            if (crocGame.players.indexOf(sender) === -1) {
                crocGame.players.push(sender);
            }
            replier.reply("✅ 현재 참여자(" + crocGame.players.length + "명) \n- " + crocGame.players.join("\n- "));
            return;
        }

        // 게임 시작 (관리자 전용)
        if (msg === "/악어시작") {
            if (!isAdmin(sender)) {
                replier.reply("❌ 관리자만 사용할 수 있는 명령어입니다.");
                return;
            }
            if (!crocGame.isReady || crocGame.isStarted) return;

            if (crocGame.players.length < 2) {
                replier.reply("❌ 최소 2명 이상 참여해야 합니다.");
                return;
            }

            // 랜덤 순서 정하기
            crocGame.isStarted = true;
            crocGame.order = shuffleArray(crocGame.players.slice());
            crocGame.turnIndex = 0;

            replier.reply("🐊 게임 시작!\n순서: \n" +
                "➤ " + crocGame.order.join("\n ➤ ") +
                "\n\n첫 턴: " + crocGame.order[0]);
            return;
        }

        // 🔹 턴 진행 (/악어 숫자)
        if (crocGame.isStarted && msg.startsWith("/악어")) {
            let parts = msg.trim().split(" ");
            if (parts.length < 2) {
                replier.reply("❌ 사용법: /악어 [1~30 숫자]");
                return;
            }

            let num = parseInt(parts[1], 10);
            let currentPlayer = crocGame.order[crocGame.turnIndex];

            // 자기 차례 확인
            if (sender !== currentPlayer) {
                replier.reply("❌ 지금은 [" + currentPlayer + "]님의 차례입니다!");
                return;
            }

            // 숫자 범위 확인
            if (isNaN(num) || num < 1 || num > 30) {
                replier.reply("❌ 1~30 사이의 숫자를 입력해주세요.");
                return;
            }

            // 이미 선택된 번호 → 탈락 처리
            if (crocGame.usedNumbers.indexOf(num) !== -1) {
                crocGame.eliminated.push(currentPlayer);
                crocGame.order.splice(crocGame.turnIndex, 1);

                if (crocGame.order.length > 0) {
                    if (crocGame.turnIndex >= crocGame.order.length) crocGame.turnIndex = 0;
                    let nextPlayer = crocGame.order[crocGame.turnIndex];
                    replier.reply("💀 [" + currentPlayer + "] 님이\n이미 고른 번호 [" + num + "]을(를) 선택했습니다!\n\n🐊 악어에게 물려 탈락ㅋㅋㅋㅋㅋㅋ\n\n➡️ 다음 차례: " + nextPlayer + "\n" +
                        "👥 현재 생존자: " + crocGame.order.length + "명");
                }
            } else {
                // 번호 사용 처리
                crocGame.usedNumbers.push(num);

                // 악어 발동 (15% 확률)
                if (Math.random() < 0.15) {
                    crocGame.eliminated.push(currentPlayer);
                    crocGame.order.splice(crocGame.turnIndex, 1);

                    if (crocGame.order.length > 0) {
                        if (crocGame.turnIndex >= crocGame.order.length) crocGame.turnIndex = 0;
                        let nextPlayer = crocGame.order[crocGame.turnIndex];
                        replier.reply("💀 [" + currentPlayer + "] 님이 [" + num + "]번째\n이빨을 고르다 🐊악어가 깨어났습니다!\n\n탈락ㅋㅋㅋㅋㅋ\n\n➡️ 다음 차례: " + nextPlayer + "\n" +
                            "👥 현재 생존자: " + crocGame.order.length + "명");
                    }
                } else {
                    // 안전 → 다음 차례로 이동
                    crocGame.turnIndex = (crocGame.turnIndex + 1) % crocGame.order.length;
                    let nextPlayer = crocGame.order[crocGame.turnIndex];
                    replier.reply("✅ [" + currentPlayer + "]님 악어🐊의\n\n[" + num + "]번째 이빨을\n\n슈킹 합니다 슉슉!🦷🦷🦷🦷\n\n➡️ 다음 차례: " + nextPlayer + "\n" +
                        "👥 현재 생존자: " + crocGame.order.length + "명");
                }
            }

            // 종료 조건 체크
            if (crocGame.order.length === 1) {
                let winner = crocGame.order[0];
                replier.reply("🎉 최종 승자: " + winner);
                // 승리 횟수 기록
                addCrocWin(winner, replier);

                crocGame = {
                    isReady: false,
                    isStarted: false,
                    dealer: null,
                    players: [],
                    order: [],
                    turnIndex: 0,
                    usedNumbers: [],
                    eliminated: []
                };
            } else if (crocGame.usedNumbers.length >= 30) {
                let winners = crocGame.order; // 남아 있는 전체
                replier.reply("🎉 모든 숫자가 사용되었습니다!\n승자: " + winners.join(", "));

                // 여러 명이면 모두 승리 기록
                for (let w of winners) {
                    addCrocWin(w, replier);
                }

                // 상태 초기화
                crocGame = {
                    isReady: false,
                    isStarted: false,
                    dealer: null,
                    players: [],
                    order: [],
                    turnIndex: 0,
                    usedNumbers: [],
                    eliminated: []
                };
            }

        }
    } catch (e) {
        let errorObj = {
            system: 'miniGameBot',
            error: e,
            msg: msg,
            room: "광산",
            sender: sender
        };
        debuggerLog("[ERROR : 돌멩봇 error]" + allsee + JSON.stringify(errorObj));
    }
}
// 랜덤 순서 섞기 함수
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function isAdmin(user) {
    return adminList.indexOf(user) !== -1;
}
function debuggerLog(msg) {
    let room = '팻 테스트방';

    if (msg) {
        if (typeof msg == "Object") {
            msg = JSON.stringify(msg);
        }
        Api.replyRoom(room, msg);
    }
}

// JSON 불러오기 (없으면 기본값 생성)
function loadGameData() {
    let data = loadJsonFile(miniGameDataFilePath);
    if (!data) data = { crocStats: {} };
    if (!data.crocStats) data.crocStats = {};
    return data;
}

// JSON 저장
function saveGameData(data) {
    saveJsonFile(data, miniGameDataFilePath);
}

function saveJsonFile(data, path) {
    if (!(data instanceof Object)) {
        debuggerLog('[Error] miniGameBot 데이터 저장 에러발생' + allsee + JSON.stringify(data));
    } else {
        FileStream.write(path, JSON.stringify(data), "utf-8");    // 명시적으로 UTF-8 인코딩 사용
    }
}
// 승리 기록 추가
function addCrocWin(user, replier) {
    let data = loadGameData();
    if (!data.crocStats[user]) data.crocStats[user] = 0;
    data.crocStats[user] += 1;
    saveGameData(data);
}