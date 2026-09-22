const state = {
  sessionId: null,
  skill: null,
  controller: null,
  diagramFiles: [],
  pendingInput: null,
  history: [],
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
  return String(value)
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

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdown(text) {
  const lines = text.split("\n");
  let html = "";
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  let listBuf = [];

  const flushList = () => {
    if (listBuf.length) {
      html += `<ul>${listBuf.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`;
      listBuf = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html += `<pre><code${codeLang ? ` class="lang-${codeLang}"` : ""}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
        inCode = false;
        codeBuf = [];
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flushList();
    if (line.trim() === "") continue;
    if (/^###\s+/.test(line)) html += `<h3>${inlineMarkdown(line.slice(4))}</h3>`;
    else if (/^##\s+/.test(line)) html += `<h2>${inlineMarkdown(line.slice(3))}</h2>`;
    else if (/^#\s+/.test(line)) html += `<h1>${inlineMarkdown(line.slice(2))}</h1>`;
    else html += `<p>${inlineMarkdown(line)}</p>`;
  }
  if (inCode) html += `<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
  flushList();
  return html;
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  const parts = entries.slice(0, 3).map(([key, value]) => {
    if (typeof value === "string" && value.length > 70) return `${key}=<${value.length} chars>`;
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${rendered.length > 40 ? `${rendered.slice(0, 40)}…` : rendered}`;
  });
  if (entries.length > 3) parts.push("…");
  return parts.join("  ");
}

function toolCard(data) {
  const card = document.createElement("div");
  card.className = "tool-card";
  const head = document.createElement("div");
  head.className = "tool-card-head";
  const kind = document.createElement("span");
  kind.className = "tool-card-kind";
  kind.textContent = data.name || "tool";
  const subject = document.createElement("span");
  subject.className = "tool-card-subject";
  subject.textContent = summarizeArgs(data.args) || "";
  const status = document.createElement("span");
  status.className = "tool-card-status";
  const chevron = document.createElement("span");
  chevron.className = "tool-card-chevron";
  chevron.textContent = "▸";
  head.append(kind, subject, status, chevron);
  const body = document.createElement("div");
  body.className = "tool-card-body";
  body.hidden = true;
  card.append(head, body);
  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    chevron.textContent = body.hidden ? "▸" : "▾";
  });
  return { card, status, body, chevron };
}

function appendToolResult(entry, text) {
  entry.body.innerHTML = "";
  const lines = text.split("\n");
  const truncated = lines.length > 6;
  const preview = truncated ? `${lines.slice(0, 6).join("\n")}\n…` : text;
  const pre = document.createElement("pre");
  pre.className = "tool-card-output";
  pre.textContent = preview;
  entry.body.appendChild(pre);
  if (truncated) {
    const toggle = document.createElement("button");
    toggle.className = "tool-card-toggle";
    toggle.textContent = `Show all ${lines.length} lines`;
    toggle.addEventListener("click", () => {
      const expanded = pre.textContent === text;
      pre.textContent = expanded ? preview : text;
      toggle.textContent = expanded ? `Show all ${lines.length} lines` : "Show less";
    });
    entry.body.appendChild(toggle);
  }
}

function setToolStatus(entry, state, isError) {
  entry.status.className = "tool-card-status";
  if (state === "starting" || state === "running") {
    entry.status.classList.add("running");
    entry.status.textContent = "running";
  } else if (isError || state === "failed") {
    entry.status.classList.add("error");
    entry.status.textContent = "error";
  } else {
    entry.status.classList.add("done");
    entry.status.textContent = "done";
  }
}

function addMessage(role) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  wrapper.appendChild(bubble);
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function addUserMessage(text) {
  const bubble = addMessage("user");
  bubble.textContent = text;
}

function addAssistantMessage() {
  const bubble = addMessage("assistant");
  const content = document.createElement("div");
  content.className = "assistant-content";
  const routeChip = document.createElement("div");
  routeChip.className = "route-chip";
  const thinkingBlock = document.createElement("details");
  thinkingBlock.className = "thinking-block";
  const thinkingSummary = document.createElement("summary");
  thinkingSummary.innerHTML = '<span class="thinking-spinner"></span> Thinking';
  const thinkingPre = document.createElement("pre");
  thinkingPre.textContent = "";
  thinkingBlock.append(thinkingSummary, thinkingPre);
  const toolList = document.createElement("div");
  toolList.className = "tool-list";
  const promptBlock = document.createElement("div");
  promptBlock.className = "prompt-block";
  const textBlock = document.createElement("div");
  textBlock.className = "markdown";
  const footer = document.createElement("div");
  footer.className = "usage-footer";
  content.append(routeChip, thinkingBlock, toolList, promptBlock, textBlock, footer);
  bubble.appendChild(content);
  return { bubble, content, routeChip, thinkingBlock, thinkingSummary, thinkingPre, toolList, promptBlock, textBlock, footer };
}

function addActivity(text) {
  const line = document.createElement("div");
  line.className = "activity";
  line.textContent = text;
  messages.appendChild(line);
  messages.scrollTop = messages.scrollHeight;
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

  // Answering a pending clarification in the normal input box.
  if (state.pendingInput) {
    const sessionId = state.pendingInput.sessionId;
    addUserMessage(message);
    state.pendingInput = null;
    input.placeholder = "Ask the harness…";
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: message }),
    }).catch(() => {});
    return;
  }

  addUserMessage(message);
  const assistant = addAssistantMessage();
  setRunning(true);

  state.controller = new AbortController();
  const body = { message };
  if (state.skill) body.skill = state.skill;
  if (state.sessionId) body.sessionId = state.sessionId;

  let finalText = "";
  let answered = false;
  const runningTools = [];

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
        case "stream": {
          const delta = data.delta || "";
          if (data.kind === "thinking") {
            assistant.thinkingBlock.open = true;
            assistant.thinkingSummary.classList.add("active");
            assistant.thinkingPre.textContent += delta;
          } else {
            finalText += delta;
            if (!answered) assistant.textBlock.textContent = finalText;
          }
          break;
        }
        case "answer":
          finalText = data.content || finalText;
          answered = true;
          assistant.thinkingBlock.open = false;
          assistant.thinkingSummary.classList.remove("active");
          assistant.textBlock.innerHTML = renderMarkdown(finalText);
          break;
        case "tool_call": {
          if (data.state === "starting" || data.state === "running") {
            const entry = toolCard(data);
            setToolStatus(entry, "running", false);
            assistant.toolList.appendChild(entry.card);
            runningTools.push({ name: data.name, ...entry });
          } else {
            const index = runningTools.findLastIndex((entry) => entry.name === data.name);
            if (index >= 0) {
              const entry = runningTools[index];
              setToolStatus(entry, data.state, Boolean(data.isError));
              if (data.result !== undefined && data.result !== null) {
                const text = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2);
                appendToolResult(entry, text);
              }
            }
          }
          break;
        }
        case "task_activity":
          if (data.description) addActivity(data.description);
          break;
        case "input_required": {
          state.pendingInput = { sessionId: state.sessionId };
          addActivity(`❓ ${data.prompt || "Input required"}`);
          input.placeholder = data.prompt || "Answer…";
          setRunning(false);
          break;
        }
        case "usage":
          addActivity(`tokens ${data.inputTokens ?? 0} → ${data.outputTokens ?? 0}`);
          break;
        case "error":
          assistant.thinkingBlock.open = false;
          assistant.thinkingSummary.classList.remove("active");
          assistant.textBlock.innerHTML = renderMarkdown(`${finalText}\n\n⚠ ${data.message || "error"}`);
          assistant.textBlock.classList.add("error");
          break;
        case "done":
          break;
      }
    });

    if (!answered) {
      assistant.textBlock.innerHTML = finalText ? renderMarkdown(finalText) : renderMarkdown("(no answer)");
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      assistant.textBlock.innerHTML = renderMarkdown(`⚠ ${error.message}`);
      assistant.textBlock.classList.add("error");
    }
  } finally {
    assistant.thinkingBlock.open = false;
    assistant.thinkingSummary.classList.remove("active");
    setRunning(false);
    state.controller = null;
    input.placeholder = "Ask the harness…";
    state.pendingInput = null;
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
