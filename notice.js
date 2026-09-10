const scriptName = "notice";

// 운영자와 전체알림 대상 방은 신규 봇 운영 환경에 맞게 이곳에서 관리합니다.
const NOTICE_CONFIG = {
    operators: ["호이 남"],
    targetRooms: [
        "🐶30대 반말방💕친목🐩봇,보룸,수다,벙🎙️",
        "🐷20대 30대 반말방💕친목🐰봇,보룸,수다,벙",
        "💖신생💖20대 30대 반말방🎙️보이스룸 수다 벙",
        "호이월드 커뮤니티[티어 킹 이상 입장가능]",
        "💜3040대친목 반말방🐻 24시 보이스룸💜",
        "💜20대 30대 반말방💙친목.보룸.수다",
        "공성전",
        "🤩30대 월루 도파민 반말방❤️보룸,봇,친목",
        "🐤30대 40대 반말방💛신생/친목/보룸/수다/벙/봇",
        "🐹신생🐹 30대 반말방 보이스룸 수다 벙🍒",
        "🌷20대 30대 반말🌻친목/보룸/봇/벙🌻",
        "호이월드 GM 관리자방"
    ],
    errorRoom: "호이월드 GM 관리자방",
    intervalMs: 70 * 60 * 1000,
    dataDirectory: "/sdcard/호이랜드_notice/",
    dataPath: "/sdcard/호이랜드_notice/noticeData.json"
};

var noticeState = null;
var noticeTimerIds = [];

/**
 * (string) room
 * (string) sender
 * (boolean) isGroupChat
 * (void) replier.reply(message)
 * (boolean) replier.reply(room, message, hideErrorToast = false) // 전송 성공시 true, 실패시 false 반환
 * (string) imageDB.getProfileBase64()
 * (string) packageName
 */
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
    if (!isNoticeCommand(msg)) return;

    if (!isNoticeOperator(sender)) {
        replier.reply("❌ 알림 운영 권한이 없습니다.");
        return;
    }

    try {
        var state = getNoticeState();

        if (msg === "!알림내용" || msg.indexOf("!알림내용 ") === 0) {
            var content = getNoticeContentArgument(msg);
            if (!content || !content.replace(/[ \t\r\n]/g, "")) {
                replier.reply("사용 방법: !알림내용 내용\n줄바꿈을 포함해 한 메시지로 입력할 수 있습니다.");
                return;
            }

            state.content = content;
            saveNoticeState(state);
            replier.reply("✅ 전체알림 내용을 저장했습니다.\n실행 중인 알림은 다음 발송부터 새 내용을 사용합니다.");
            return;
        }

        if (msg === "!알림시작") {
            if (!state.content) {
                replier.reply("등록된 알림 내용이 없습니다.\n!알림내용 내용 으로 먼저 등록해주세요.");
                return;
            }

            var startResult = broadcastNotice(state.content, replier);
            noticeTimerIds.push(createNoticeInterval(replier));
            replier.reply(buildNoticeStartResultMessage(startResult));
            return;
        }

        if (msg === "!알림초기화") {
            if (noticeTimerIds.length === 0) {
                replier.reply("현재 실행 중인 알림이 없습니다.");
                return;
            }

            clearAllNoticeIntervals();
            noticeTimerIds.push(createNoticeInterval(replier));
            replier.reply("✅ 전체알림 발송 시간을 초기화했습니다.\n지금부터 70분 뒤에 발송하고 이후 70분마다 반복합니다.");
        }
    } catch (error) {
        replier.reply("❌ 전체알림 처리 중 오류가 발생했습니다.\n" + String(error));
    }
}

// 전체알림 명령어 형식인지 확인하는 함수
function isNoticeCommand(msg) {
    return msg === "!알림내용" ||
        msg.indexOf("!알림내용 ") === 0 ||
        msg === "!알림시작" ||
        msg === "!알림초기화";
}

// 설정된 전체알림 운영자인지 확인하는 함수
function isNoticeOperator(sender) {
    return NOTICE_CONFIG.operators.indexOf(sender) !== -1;
}

// 알림내용 명령어에서 줄바꿈을 보존한 본문을 추출하는 함수
function getNoticeContentArgument(msg) {
    return msg.substring("!알림내용".length).replace(/^[ \t]+/, "");
}

// 알림 데이터 폴더가 없으면 최초 저장 전에 생성하는 함수
function ensureNoticeDataDirectory() {
    var directory = new java.io.File(NOTICE_CONFIG.dataDirectory);
    if (!directory.exists() && !directory.mkdirs() && !directory.exists()) {
        throw new Error("알림 데이터 폴더를 만들 수 없습니다: " + NOTICE_CONFIG.dataDirectory);
    }
}

// 저장된 알림 내용을 최초 한 번 불러오는 함수
function getNoticeState() {
    if (noticeState !== null) return noticeState;

    var dataFile = new java.io.File(NOTICE_CONFIG.dataPath);
    if (!dataFile.exists()) {
        noticeState = { content: "" };
        saveNoticeState(noticeState);
        return noticeState;
    }

    var fileContent = FileStream.read(NOTICE_CONFIG.dataPath, "utf-8");
    var loadedState = JSON.parse(fileContent);
    if (!loadedState || typeof loadedState !== "object" || loadedState instanceof Array || typeof loadedState.content !== "string") {
        throw new Error("알림 데이터 형식이 올바르지 않습니다.");
    }

    noticeState = loadedState;
    return noticeState;
}

// 알림 내용을 독립 데이터 파일에 저장하는 함수
function saveNoticeState(state) {
    ensureNoticeDataDirectory();
    FileStream.write(NOTICE_CONFIG.dataPath, JSON.stringify(state), "utf-8");
    noticeState = state;
}

// 유저에게 표시할 고정 헤더와 알림 본문을 결합하는 함수
function buildNoticeMessage(content) {
    return "📢 잠깐! 호이월드 알림 왔어요 👀\n" +
        "━━━━━━━━━━━━\n" +
        content;
}

// 설정된 전체 대상 방에 알림을 한 번씩 발송하는 함수
function broadcastNotice(content, replier) {
    var message = buildNoticeMessage(content);
    var successCount = 0;
    var failedCount = 0;

    for (var i = 0; i < NOTICE_CONFIG.targetRooms.length; i++) {
        try {
            if (replier.reply(NOTICE_CONFIG.targetRooms[i], message, true) === false) {
                failedCount++;
            } else {
                successCount++;
            }
        } catch (error) {
            failedCount++;
        }
    }

    return { successCount: successCount, failedCount: failedCount };
}

// 현재 저장된 내용을 70분마다 전체 발송하는 반복 예약을 생성하는 함수
function createNoticeInterval(replier) {
    return setInterval(function () {
        try {
            var state = getNoticeState();
            if (state.content) {
                var result = broadcastNotice(state.content, replier);
                if (result.failedCount > 0) {
                    replier.reply(NOTICE_CONFIG.errorRoom, "❌ 반복 전체알림 발송 실패: " + result.failedCount + "개 방", true);
                }
            }
        } catch (error) {
            replier.reply(NOTICE_CONFIG.errorRoom, "❌ 반복 전체알림 처리 중 오류가 발생했습니다.\n" + String(error), true);
        }
    }, NOTICE_CONFIG.intervalMs);
}

// 실행 중인 모든 전체알림 반복 예약을 해제하는 함수
function clearAllNoticeIntervals() {
    for (var i = 0; i < noticeTimerIds.length; i++) clearInterval(noticeTimerIds[i]);
    noticeTimerIds = [];
}

// 즉시 발송과 반복 시작 결과를 운영자에게 안내하는 함수
function buildNoticeStartResultMessage(result) {
    var message = "✅ 전체알림을 즉시 발송하고 70분 반복을 시작했습니다.\n" +
        "발송 성공: " + result.successCount + "개 방";
    if (result.failedCount > 0) message += "\n발송 실패: " + result.failedCount + "개 방";
    if (noticeTimerIds.length > 1) message += "\n실행 중인 반복 예약: " + noticeTimerIds.length + "개";
    return message;
}

// 아래 4개의 메소드는 액티비티 화면을 수정할때 사용됩니다.
function onCreate(savedInstanceState, activity) {
    var textView = new android.widget.TextView(activity);
    textView.setText("Hello, World!");
    textView.setTextColor(android.graphics.Color.DKGRAY);
    activity.setContentView(textView);
}

function onStart(activity) {}

function onResume(activity) {}

function onPause(activity) {}

function onStop(activity) {}
