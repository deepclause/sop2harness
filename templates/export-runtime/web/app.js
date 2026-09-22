const state = {
  sessionId: null,
  skill: null,
  controller: null,
  reader: null,
};

const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const input = $("#message-input");
const sendButton = $("#send-button");
const stopButton = $("#stop-button");

function addMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function addActivity(text) {
  const line = document.createElement("div");
  line.className = "activity";
  line.textContent = text;
  messages.appendChild(line);
  messages.scrollTop = messages.scrollHeight;
  return line;
}

function setRunning(running) {
  sendButton.disabled = running;
  stopButton.disabled = !running;
}

function stop() {
  if (state.controller) state.controller.abort();
  if (state.sessionId) {
    fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/cancel`, { method: "POST" }).catch(() => {});
  }
  setRunning(false);
}

async function loadSkills() {
  const res = await fetch("/api/skills");
  const data = await res.json();
  const list = $("#skills");
  list.innerHTML = "";
  for (const skill of data.skills) {
    const item = document.createElement("li");
    item.textContent = skill.title;
    item.title = skill.triggers.join(", ");
    item.addEventListener("click", () => {
      state.skill = skill.id;
      input.value = skill.triggers[0] || skill.title;
      send();
    });
    list.appendChild(item);
  }
}

async function loadDocs() {
  const res = await fetch("/api/docs");
  const data = await res.json();
  const list = $("#docs");
  list.innerHTML = "";
  for (const doc of data.docs) {
    const item = document.createElement("li");
    item.textContent = doc.name;
    item.addEventListener("click", async () => {
      const content = await (await fetch(`/api/docs/${encodeURIComponent(doc.name)}`)).json();
      addMessage("assistant", `# ${doc.name}\n\n${content.content}`);
    });
    list.appendChild(item);
  }
}

async function loadHarness() {
  const res = await fetch("/api/harness");
  const data = await res.json();
  $("#harness-name").textContent = data.title || data.name;
  $("#harness-meta").textContent = `v${data.version} · ${data.skills.length} skills`;
}

async function parseSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      let event = "message";
      const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  }
}

async function send() {
  const message = input.value.trim();
  if (!message || sendButton.disabled) return;
  input.value = "";

  addMessage("user", message);
  const assistant = addMessage("assistant", "");
  setRunning(true);

  state.controller = new AbortController();
  const body = { message };
  if (state.skill) body.skill = state.skill;
  if (state.sessionId) body.sessionId = state.sessionId;

  let finalText = "";
  const append = (text) => {
    finalText += text;
    assistant.textContent = finalText;
    messages.scrollTop = messages.scrollHeight;
  };

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: state.controller.signal,
    });

    await parseSse(response, (event, data) => {
      switch (event) {
        case "session":
          state.sessionId = data.sessionId;
          break;
        case "route":
          addActivity(`→ ${data.skill} (${data.reason})`);
          break;
        case "stream":
          append(data.delta || "");
          break;
        case "answer":
          append(data.content || "");
          break;
        case "tool_call":
          addActivity(`· ${data.name} ${data.state || ""}`);
          break;
        case "task_activity":
          if (data.description) addActivity(data.description);
          break;
        case "input_required": {
          const value = prompt(data.prompt || "Input required:");
          if (state.sessionId && value !== null) {
            fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/input`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ value }),
            }).catch(() => {});
          }
          break;
        }
        case "usage":
          addActivity(`tokens ${data.inputTokens ?? 0} → ${data.outputTokens ?? 0}`);
          break;
        case "error":
          assistant.textContent = finalText + `\n\n⚠ ${data.message || "error"}`;
          assistant.classList.add("error");
          break;
        case "done":
          break;
      }
    });

    if (!assistant.textContent && !finalText) append("(no answer)");
  } catch (error) {
    if (error.name !== "AbortError") {
      assistant.textContent = `⚠ ${error.message}`;
      assistant.classList.add("error");
    }
  } finally {
    setRunning(false);
    state.controller = null;
  }
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});
stopButton.addEventListener("click", stop);

loadHarness();
loadSkills();
loadDocs();
