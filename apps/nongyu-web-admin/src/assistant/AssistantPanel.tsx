import { CloseOutlined, HistoryOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { useAgentChat, type Agent, type ChatMessage } from "nongyu-agent-sdk";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ResizeHandle } from "../components/ResizeHandle";
import {
  ASSISTANT_WIDTH_DEFAULT,
  ASSISTANT_WIDTH_MAX,
  ASSISTANT_WIDTH_MIN,
} from "../lib/constants";
import { useIsLg } from "../lib/responsive";
import { clampAssistantWidth, readShellLayout, writeShellLayout } from "../lib/shellLayoutPrefs";
import { useAuthStore } from "../stores/authStore";
import { getOrCreateAdminAgent, invalidateAdminAgent } from "./agent";
import { AgentSettingsForm } from "./ui/AgentSettingsForm";
import { ChatComposer } from "./ui/ChatComposer";
import { ChatEmptyState } from "./ui/ChatEmptyState";
import { MessageList } from "./ui/MessageList";
import { SessionList } from "./ui/SessionList";
import "./ui/register";
import {
  clearSessions,
  deleteSession,
  getActiveSessionId,
  getSession,
  listSessions,
  patchSessionLlmContext,
  setActiveSessionId,
  upsertSession,
} from "./storage/sessionRepository";
import type { AgentChatSession } from "./storage/sessionTypes";

const SUGGESTIONS = ["今天日活有多少", "近 7 日新增用户趋势", "用户按学院分布"];

type PanelTab = "chat" | "sessions" | "settings";

function ChatSessionView({
  agent,
  adminUserId,
  adminName,
  session,
  onSessionId,
}: {
  agent: Agent;
  adminUserId: number;
  adminName: string;
  session: AgentChatSession | null;
  onSessionId: (id: string) => void;
}) {
  const chat = useAgentChat({
    agent,
    initialMessages: session?.messages ?? [],
    llmSummary: session?.llmSummary,
    llmCompactedUntilId: session?.llmCompactedUntilId,
    textUpdateThrottleMs: 40,
    onContextCompact: (payload) => {
      const id = session?.id;
      if (!id) return;
      patchSessionLlmContext(adminUserId, id, payload);
    },
  });

  useEffect(() => {
    if (chat.isLoading) return;
    const saved = upsertSession(adminUserId, {
      sessionId: session?.id,
      messages: chat.messages,
    });
    if (saved && saved.id !== session?.id) onSessionId(saved.id);
  }, [adminUserId, chat.isLoading, chat.messages, onSessionId, session?.id]);

  const hasUserMessage = chat.messages.some((m) => m.role === "user");

  function sendMessage() {
    const text = chat.input.trim();
    if (!text || chat.isLoading) return;
    chat.setInput("");
    void chat.append({ role: "user", content: text });
  }

  function sendSuggestion(text: string) {
    if (chat.isLoading) return;
    void chat.append({ role: "user", content: text });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {hasUserMessage ? (
        <MessageList
          messages={chat.messages as ChatMessage[]}
          isLoading={chat.isLoading}
          onRegenerate={() => void chat.reload()}
        />
      ) : (
        <ChatEmptyState
          adminName={adminName}
          suggestions={SUGGESTIONS}
          onSuggestion={sendSuggestion}
        />
      )}
      <ChatComposer
        value={chat.input}
        onChange={(value) => chat.setInput(value)}
        onSend={sendMessage}
        onStop={() => chat.stop()}
        isLoading={chat.isLoading}
      />
    </div>
  );
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isLg = useIsLg();
  const [assistantWidth, setAssistantWidth] = useState(() => readShellLayout().assistantWidth);
  const drawerWidth = isLg ? clampAssistantWidth(assistantWidth) : "100%";
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const adminName = user?.name ?? "管理员";
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshAgent = useEffectEvent(() => {
    setAgent(getOrCreateAdminAgent());
  });

  function refreshSessions() {
    if (!userId) return;
    setSessions(listSessions(userId));
  }

  function persistAssistantWidth(next: number) {
    const width = clampAssistantWidth(next);
    setAssistantWidth(width);
    const prefs = readShellLayout();
    writeShellLayout({ ...prefs, assistantWidth: width });
  }

  useEffect(() => {
    if (!open || !userId) return;
    refreshAgent();
    const active = getActiveSessionId(userId);
    setSessionId(active);
    refreshSessions();
  }, [open, userId]);

  const session = userId && sessionId ? getSession(userId, sessionId) : null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className={`absolute inset-0 bg-ink/30 backdrop-blur-sm ${
          resizing ? "pointer-events-none" : ""
        }`}
        aria-label="关闭智慧助手"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="ny-glass ny-glass-chrome relative z-10 flex h-full max-h-[100dvh] flex-col overscroll-contain rounded-none"
        style={{
          width: typeof drawerWidth === "number" ? `${drawerWidth}px` : drawerWidth,
        }}
      >
        {isLg ? (
          <ResizeHandle
            edge="left"
            value={clampAssistantWidth(assistantWidth)}
            min={ASSISTANT_WIDTH_MIN}
            max={ASSISTANT_WIDTH_MAX}
            defaultValue={ASSISTANT_WIDTH_DEFAULT}
            onChange={persistAssistantWidth}
            onDraggingChange={setResizing}
          />
        ) : null}

        <header className="flex min-h-14 shrink-0 items-center gap-0.5 border-b border-black/[0.06] px-1.5 pt-[env(safe-area-inset-top)] sm:gap-1 sm:px-2">
          <button
            type="button"
            className="ny-hit inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-elev"
            aria-label="关闭"
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[17px] font-semibold tracking-wide text-ink">农小屿</p>
            <p className="truncate text-[11px] text-muted">管理台问数助手</p>
          </div>
          <button
            type="button"
            className={`ny-hit inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-elev ${
              tab === "sessions" ? "text-brand" : "text-ink"
            }`}
            aria-label="会话"
            onClick={() => setTab((prev) => (prev === "sessions" ? "chat" : "sessions"))}
          >
            <HistoryOutlined />
          </button>
          <button
            type="button"
            className={`ny-hit inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-elev ${
              tab === "settings" ? "text-brand" : "text-ink"
            }`}
            aria-label="模型设置"
            onClick={() => setTab((prev) => (prev === "settings" ? "chat" : "settings"))}
          >
            <SettingOutlined />
          </button>
          <button
            type="button"
            className="ny-hit inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-elev"
            aria-label="新对话"
            onClick={() => {
              if (!userId) return;
              setActiveSessionId(userId, null);
              setSessionId(null);
              setTab("chat");
            }}
          >
            <PlusOutlined />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {!userId ? (
            <p className="p-6 text-sm text-muted">请先登录</p>
          ) : !agent ? (
            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <p className="text-sm text-muted">
                未配置模型。可填写自有 Key，或确认已登录以使用平台调度。
              </p>
              <AgentSettingsForm onSaved={refreshAgent} />
            </div>
          ) : tab === "sessions" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <SessionList
                sessions={sessions}
                activeId={sessionId}
                onNew={() => {
                  setActiveSessionId(userId, null);
                  setSessionId(null);
                  setTab("chat");
                }}
                onSelect={(id) => {
                  setActiveSessionId(userId, id);
                  setSessionId(id);
                  setTab("chat");
                }}
                onDelete={(id) => {
                  deleteSession(userId, id);
                  if (sessionId === id) setSessionId(null);
                  refreshSessions();
                }}
                onClearAll={() => {
                  clearSessions(userId);
                  setSessionId(null);
                  refreshSessions();
                }}
              />
            </div>
          ) : tab === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <AgentSettingsForm
                onSaved={() => {
                  invalidateAdminAgent();
                  refreshAgent();
                }}
              />
            </div>
          ) : (
            <ChatSessionView
              key={sessionId ?? "draft"}
              agent={agent}
              adminUserId={userId}
              adminName={adminName}
              session={session}
              onSessionId={(id) => {
                setSessionId(id);
                refreshSessions();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
