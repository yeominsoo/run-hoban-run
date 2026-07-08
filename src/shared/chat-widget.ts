import './chat-widget.css';

/** 모든 게임 공용: 화면 구석의 동그란 아이콘을 눌러 여는 채팅 다이얼로그.
 *  채널을 1개만 주면 탭 없이 단일 채팅으로, 여러 개 주면 상단 탭으로 전환한다
 *  (예: 전략윷놀이의 "전체"/"팀", 마피아의 "전체"/"마피아"). */

export interface ChatWidgetChannel {
  id: string;
  label: string;
}

export interface ChatMessageEntry {
  name: string;
  text: string;
  mine?: boolean;
  system?: boolean;
}

export interface ChatWidgetOptions {
  channels: ChatWidgetChannel[];
  position?: 'left' | 'right';
  placeholder?: string;
  onSend: (channelId: string, text: string) => void;
}

export interface ChatWidgetHandle {
  addMessage(channelId: string, entry: ChatMessageEntry): void;
  setChannelEnabled(channelId: string, enabled: boolean): void;
  clearAll(): void;
  destroy(): void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]!);
}

export function createChatWidget(opts: ChatWidgetOptions): ChatWidgetHandle {
  const position = opts.position ?? 'right';
  const multiChannel = opts.channels.length > 1;
  const logs = new Map<string, ChatMessageEntry[]>(opts.channels.map((c) => [c.id, []]));
  const unread = new Map<string, number>(opts.channels.map((c) => [c.id, 0]));
  const enabled = new Map<string, boolean>(opts.channels.map((c) => [c.id, true]));
  let activeChannel = opts.channels[0].id;
  let isOpen = false;

  const root = document.createElement('div');
  root.className = `cw-root cw-${position}`;

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'cw-fab';
  fab.setAttribute('aria-label', '채팅 열기');
  fab.innerHTML = '<span class="cw-fab-icon">💬</span><span class="cw-badge hidden">0</span>';
  root.appendChild(fab);

  const dialog = document.createElement('div');
  dialog.className = 'cw-dialog hidden';
  dialog.innerHTML = `
    <div class="cw-header">
      <div class="cw-tabs" id="cw-tabs"></div>
      <button type="button" class="cw-close" aria-label="채팅 닫기">✕</button>
    </div>
    <div class="cw-log" id="cw-log"></div>
    <div class="cw-form">
      <input type="text" class="cw-input" maxlength="150" autocomplete="off" placeholder="${escapeHtml(opts.placeholder ?? '메시지 입력')}" />
      <button type="button" class="cw-send">전송</button>
    </div>
  `;
  root.appendChild(dialog);
  document.body.appendChild(root);

  const tabsEl = dialog.querySelector('#cw-tabs') as HTMLElement;
  const logEl = dialog.querySelector('#cw-log') as HTMLElement;
  const inputEl = dialog.querySelector('.cw-input') as HTMLInputElement;
  const sendBtn = dialog.querySelector('.cw-send') as HTMLButtonElement;
  const closeBtn = dialog.querySelector('.cw-close') as HTMLButtonElement;

  function renderTabs() {
    if (!multiChannel) { tabsEl.classList.add('hidden'); return; }
    tabsEl.classList.remove('hidden');
    tabsEl.innerHTML = opts.channels
      .filter((c) => enabled.get(c.id))
      .map((c) => {
        const count = unread.get(c.id) ?? 0;
        const badge = count > 0 && c.id !== activeChannel ? `<span class="cw-tab-badge">${count}</span>` : '';
        return `<button type="button" class="cw-tab${c.id === activeChannel ? ' active' : ''}" data-channel="${c.id}">${escapeHtml(c.label)}${badge}</button>`;
      }).join('');
  }

  function renderLog() {
    const entries = logs.get(activeChannel) ?? [];
    if (entries.length === 0) {
      logEl.innerHTML = '<div class="cw-empty">아직 메시지가 없습니다.</div>';
      return;
    }
    logEl.innerHTML = entries.map((m) => {
      if (m.system) return `<div class="cw-msg system">${escapeHtml(m.text)}</div>`;
      return `<div class="cw-msg${m.mine ? ' mine' : ''}">
        <span class="cw-msg-name">${escapeHtml(m.name)}</span>
        <span class="cw-msg-text">${escapeHtml(m.text)}</span>
      </div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderBadgeTotal() {
    const total = [...unread.values()].reduce((a, b) => a + b, 0);
    const badgeEl = fab.querySelector('.cw-badge')!;
    badgeEl.textContent = total > 9 ? '9+' : String(total);
    badgeEl.classList.toggle('hidden', total === 0);
  }

  function switchChannel(id: string) {
    activeChannel = id;
    unread.set(id, 0);
    renderTabs();
    renderLog();
    renderBadgeTotal();
  }

  function setOpen(next: boolean) {
    isOpen = next;
    dialog.classList.toggle('hidden', !isOpen);
    fab.classList.toggle('cw-fab-open', isOpen);
    if (isOpen) {
      unread.set(activeChannel, 0);
      renderTabs();
      renderLog();
      renderBadgeTotal();
      inputEl.focus();
    }
  }

  fab.addEventListener('click', () => setOpen(!isOpen));
  closeBtn.addEventListener('click', () => setOpen(false));
  tabsEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-channel]');
    if (btn?.dataset.channel) switchChannel(btn.dataset.channel);
  });

  function submit() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    opts.onSend(activeChannel, text);
  }
  sendBtn.addEventListener('click', submit);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  renderTabs();
  renderLog();

  return {
    addMessage(channelId, entry) {
      const arr = logs.get(channelId);
      if (!arr) return;
      arr.push(entry);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      if (channelId === activeChannel && isOpen) {
        renderLog();
      } else {
        unread.set(channelId, (unread.get(channelId) ?? 0) + 1);
        renderTabs();
        renderBadgeTotal();
      }
    },
    setChannelEnabled(channelId, isEnabled) {
      enabled.set(channelId, isEnabled);
      if (!isEnabled && activeChannel === channelId) {
        const fallback = opts.channels.find((c) => enabled.get(c.id));
        if (fallback) activeChannel = fallback.id;
      }
      renderTabs();
      renderLog();
    },
    clearAll() {
      logs.forEach((_, id) => logs.set(id, []));
      unread.forEach((_, id) => unread.set(id, 0));
      renderLog();
      renderTabs();
      renderBadgeTotal();
    },
    destroy() {
      root.remove();
    },
  };
}
