const port = process.env.PORT || "3002";
const token = process.env.IRIS_SHARED_TOKEN;

if (!token) {
  throw new Error("IRIS_SHARED_TOKEN is required. Copy .env.example to .env and set a token first.");
}

const endpoint = process.env.FAKE_IRIS_ENDPOINT
  || `http://127.0.0.1:${port}/api/v1/integrations/iris/events`;
const payload = {
  msg: "/핑",
  room: "hoiBot 개발 테스트방",
  sender: "개발 테스트 사용자",
  json: {
    _id: "fake-message-1",
    chat_id: "fake-chat-1",
    user_id: "fake-user-1",
    message: "/핑",
    attachment: "{}"
  }
};
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(payload)
});

console.log(JSON.stringify({ status: response.status, body: await response.json() }, null, 2));
process.exitCode = response.ok ? 0 : 1;
