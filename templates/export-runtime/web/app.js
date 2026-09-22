const state = {
  sessionId: null,
  skill: null,
  controller: null,
  diagramFiles: [],
};

const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const input = $("#message-input");
const sendButton = $("#send-button");
const stopButton = $("#stop-button");
const viewer = $("#viewer");
const viewerTitle = $("#viewer-title");
const viewerBody = $("#viewer-body");
const viewerClose = $("#viewer-close");

const PREDICATES = new Set([
  "agent_main", "answer", "exec", "task", "prompt", "output", "log", "system",
  "user", "judge", "choose", "rate", "verify", "probability", "holds",
  "require_judgment", "with_judgment", "with_tools", "without_tools",
  "get_dict", "format", "string", "integer", "number", "boolean", "list",
  "object", "read_harness_file", "list_harness_files", "ask_user", "bash",
  "pi_bash", "length", "string_length", "push_context", "pop_context",
]);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightDml(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "%") {
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      out.push(`<span class="tok-comment">${escapeHtml(src.slice(i, j))}</span>`);
      i = j;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === '"') { j += 1; break; }
        j += 1;
      }
      out.push(`<span class="tok-string">${escapeHtml(src.slice(i, j))}</span>`);
      i = j;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      const cls = PREDICATES.has(word) ? "tok-pred" : (/^[A-Z_]/.test(word) ? "tok-var" : "");
      out.push(cls ? `<span class="${cls}">${escapeHtml(word)}</span>` : escapeHtml(word));
      i = j;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j += 1;
      out.push(`<span class="tok-num">${escapeHtml(src.slice(i, j))}</span>`);
      i = j;
    } else {
      out.push(escapeHtml(ch));
      i += 1;
    }
  }
  return out.join("");
}

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

function openViewer(title, body) {
  viewerTitle.textContent = title;
  viewerBody.innerHTML = "";
  viewerBody.appendChild(body);
  viewer.classList.remove("hidden");
}

function closeViewer() {
  viewer.classList.add("hidden");
  viewerBody.innerHTML = "";
}

function preBlock(content, className) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (className) code.className = className;
  code.innerHTML = content;
  pre.appendChild(code);
  return pre;
}

let mermaidPromise;
function ensureMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidPromise) {
    mermaidPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
      script.onload = () => {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });
        resolve(window.mermaid);
      };
      script.onerror = () => reject(new Error("Mermaid failed to load"));
      document.head.appendChild(script);
    });
  }
  return mermaidPromise;
}

async function renderMermaid(code) {
  const mermaid = await ensureMermaid();
  const id = `mmd-${Math.random().toString(36).slice(2)}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

async function loadDocs() {
  const res = await fetch("/api/docs");
  const data = await res.json();
  const list = $("#docs");
  list.innerHTML = "";
  for (const doc of data.docs) {
    const item = document.createElement("li");
    item.textContent = doc.name;
    item.title = doc.path;
    item.addEventListener("click", async () => {
      const content = await (await fetch(`/api/docs/${encodeURIComponent(doc.name)}`)).json();
      openViewer(doc.path, preBlock(escapeHtml(content.content)));
    });
    list.appendChild(item);
  }
}

async function loadDmlFiles() {
  const res = await fetch("/api/dml");
  const data = await res.json();
  const list = $("#dml-files");
  list.innerHTML = "";
  for (const file of data.files) {
    const item = document.createElement("li");
    item.textContent = file;
    item.title = file;
    item.addEventListener("click", () => openDmlViewer(file));
    list.appendChild(item);
  }
}

async function loadDiagrams() {
  const res = await fetch("/api/diagrams");
  const data = await res.json();
  state.diagramFiles = data.files;
  const list = $("#diagrams");
  list.innerHTML = "";
  for (const file of data.files.filter((name) => name.endsWith(".mmd") || name.endsWith(".html"))) {
    const item = document.createElement("li");
    item.textContent = file;
    item.title = file;
    item.addEventListener("click", async () => {
      const content = await (await fetch(`/api/diagrams/file?path=${encodeURIComponent(file)}`)).json();
      if (file.endsWith(".html")) {
        const iframe = document.createElement("iframe");
        iframe.srcdoc = content.content;
        openViewer(file, iframe);
      } else {
        openViewer(file, preBlock(escapeHtml(content.content)));
      }
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

async function openDmlViewer(file) {
  const dml = await (await fetch(`/api/dml/file?path=${encodeURIComponent(file)}`)).json();
  const base = file.replace(/^.*\//, "").replace(/\.dml$/, "");
  const grades = [
    { label: "Presentation", path: `diagrams/${base}.presentation.mmd` },
    { label: "Specification", path: `diagrams/${base}.specification.mmd` },
  ].filter((grade) => state.diagramFiles.includes(grade.path));

  const container = document.createElement("div");
  container.className = "dml-viewer";

  const codePane = document.createElement("div");
  codePane.className = "pane-code";
  codePane.appendChild(preBlock(highlightDml(dml.content), "dml"));

  const diagramPane = document.createElement("div");
  diagramPane.className = "pane-diagram";
  const tabs = document.createElement("div");
  tabs.className = "diagram-tabs";
  const stage = document.createElement("div");
  stage.className = "diagram-stage";
  diagramPane.appendChild(tabs);
  diagramPane.appendChild(stage);

  container.appendChild(codePane);
  container.appendChild(diagramPane);
  openViewer(file, container);

  if (grades.length === 0) {
    stage.innerHTML = '<div class="hint">No diagrams generated for this skill yet.</div>';
    return;
  }

  let activeIndex = 0;
  const buttons = grades.map((grade, index) => {
    const button = document.createElement("button");
    button.className = "diagram-tab";
    button.textContent = grade.label;
    button.addEventListener("click", () => activate(index));
    tabs.appendChild(button);
    return button;
  });

  async function activate(index) {
    activeIndex = index;
    buttons.forEach((button, i) => button.classList.toggle("active", i === index));
    const grade = grades[index];
    stage.innerHTML = '<div class="hint">Rendering…</div>';
    try {
      const content = await (await fetch(`/api/diagrams/file?path=${encodeURIComponent(grade.path)}`)).json();
      const svg = await renderMermaid(content.content);
      const zoom = document.createElement("div");
      zoom.className = "diagram-zoom";
      zoom.innerHTML = svg;
      stage.innerHTML = "";
      stage.appendChild(zoom);

      let scale = 1;
      const applyScale = () => { zoom.style.transform = `scale(${scale})`; };
      stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        scale = Math.min(4, Math.max(0.25, scale + (event.deltaY < 0 ? 0.1 : -0.1)));
        applyScale();
      }, { passive: false });
      stage.addEventListener("dblclick", () => { scale = 1; applyScale(); });
    } catch (error) {
      stage.innerHTML = `<div class="hint">Could not render diagram: ${escapeHtml(error.message)}</div>`;
    }
  }

  activate(0);
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});
stopButton.addEventListener("click", stop);
viewerClose.addEventListener("click", closeViewer);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) closeViewer();
});

loadHarness();
loadDocs();
loadDmlFiles();
loadDiagrams();
