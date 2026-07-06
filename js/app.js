let state = {
  url: '',
  username: '',
  password: '',
  activeChat: null,
  activeGroup: null,
  pendingChatType: null,
  history: [],
  lastMsgId: 0,
  focusTrap: null,
  connected: false,
  messagePollingInterval: null
};

// Unread message counts per conversation (phone -> count)
let unreadCounts = {};
let totalUnread = 0;

let stats = { sent: 0, delivered: 0, failed: 0, received: 0 };
let templates = [];
let csvData = [];
let tempRecipients = [];
let editingGroup = null;
let currentChatType = 'single';
let lastSendTime = 0;
let scheduleSendAt = null; // ISO string or null for immediate send

// Message sending configuration
const MESSAGE_THROTTLE_MS = 500; // Delay between messages to avoid rate limiting
const MAX_HISTORY_ITEMS = 500;

// Reconnect configuration
const RECONNECT_BASE_DELAY = 5000;  // Start reconnecting after 5s
const RECONNECT_MAX_DELAY = 30000; // Cap at 30s between attempts
let reconnectTimeout = null;
let reconnectAttempts = 0;

// Focus trap for modals
function trapFocus(element) {
  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  function handleTab(e) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        lastFocusable.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        firstFocusable.focus();
        e.preventDefault();
      }
    }
  }

  element.addEventListener('keydown', handleTab);
  firstFocusable?.focus();

  return () => element.removeEventListener('keydown', handleTab);
}

// ── Reconnect Logic ──────────────────────────────────────────────────

/** Called when the connection to the Android device is lost. */
function onConnectionLost() {
  if (!state.connected) return; // Already disconnected

  state.connected = false;
  updateConnectionStatus();
  Toast.warning('Connection Lost', 'Device unreachable. Reconnecting...');
  startReconnectLoop();
}

/** Start the reconnect loop with exponential backoff. */
function startReconnectLoop() {
  // Clear any existing reconnect timeout
  stopReconnectLoop();

  if (!state.url) return; // No credentials to reconnect with

  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  reconnectAttempts++;

  updateConnectionStatus();

  reconnectTimeout = setTimeout(async () => {
    if (state.connected) return; // Already reconnected
    if (!state.url) return; // Disconnected manually

    console.log(`[Reconnect] Attempt ${reconnectAttempts} (delay: ${delay}ms)...`);

    try {
      let result;
      if (API.useRemote) {
        API.REMOTE_CREDENTIALS = { username: state.username, password: state.password };
        result = await API.testRemoteConnection();
      } else {
        result = await API.testConnection(state.url, state.username, state.password);
      }

      if (result.success) {
        // Reconnected!
        state.connected = true;
        reconnectAttempts = 0;
        stopReconnectLoop();
        startMessagePolling();
        updateConnectionStatus();
        Toast.success('Reconnected', 'Connection to SMS Gateway restored');
      } else {
        // Try again
        startReconnectLoop();
      }
    } catch (e) {
      console.error('[Reconnect] Error:', e.message);
      startReconnectLoop();
    }
  }, delay);
}

/** Stop the reconnect loop. */
function stopReconnectLoop() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

// Connection handling
async function saveSettings() {
  // Stop any reconnect loop — user is manually connecting
  stopReconnectLoop();
  reconnectAttempts = 0;

  const urlInput = document.getElementById('url').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('connectBtn');
  const statusDiv = document.getElementById('conn-status');

  if (!urlInput || !username || !password) {
    Toast.warning('Missing Fields', 'Please fill in all required fields');
    return;
  }

  // Save original button content
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="animate-spin">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
    </svg>
    <span>Connecting...</span>
  `;

  let connectionSuccess = false;

  try {
    // Detect if remote API based on URL
    const isRemote = urlInput.includes('api.sms-gate.app') || urlInput.includes('cloud');
    
    if (isRemote) {
      // Remote/cloud connection
      statusDiv.innerHTML = '<span>Connecting to remote SMS Gateway...</span>';
      
      // Set remote credentials
      API.REMOTE_CREDENTIALS = { username, password };
      
      const result = await API.testRemoteConnection();
      
      if (result.success && result.isRemote) {
        API.useRemote = true;
        state.url = urlInput;
        state.username = username;
        state.password = password;
        state.connected = true;

        if (document.getElementById('saveCreds').checked) {
          Storage.saveConfig({
            url: state.url,
            user: state.username,
            pass: state.password
          });
        } else {
          Storage.clearConfig();
        }
        
        updateConnectionStatus();
        Toast.success('Connected', 'Connected to remote SMS Gateway (Cloud)');
        
        document.getElementById('connectionPage').classList.add('hidden');
        document.getElementById('chatWindow').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        
        startMessagePolling();
        updateChatList();
        connectionSuccess = true;
      } else {
        statusDiv.innerHTML = '<span style="color: var(--error-600);">Could not connect to remote API. Check URL and credentials.</span>';
        Toast.error('Connection Failed', result.error || 'Cannot connect to remote gateway');
      }
    } else {
      // Local connection attempt
      const result = await API.testConnection(urlInput, username, password);

      if (result.success) {
        state.url = API.normalizeUrl(urlInput);
        state.username = username;
        state.password = password;
        state.connected = true;

        if (document.getElementById('saveCreds').checked) {
          Storage.saveConfig({
            url: state.url,
            user: state.username,
            pass: state.password
          });
        } else {
          Storage.clearConfig();
        }

        updateConnectionStatus();
        Toast.success('Connected', 'Successfully connected to SMS Gateway');

        // Request notification permission from a user gesture context
        requestNotificationPermission();

        // Hide connection page, show empty state (which is the main interface)
      document.getElementById('connectionPage').classList.add('hidden');
      document.getElementById('chatWindow').classList.add('hidden');
      document.getElementById('emptyState').classList.remove('hidden');

      // Start polling for received messages
      startMessagePolling();

      // Update sidebar if there are chats
      updateChatList();
      document.getElementById('connectionPage').classList.add('hidden');
        document.getElementById('chatWindow').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');

        startMessagePolling();
        updateChatList();
        connectionSuccess = true;
      } else if (result.error && result.error.includes('Authentication')) {
        statusDiv.innerHTML = '<span style="color: var(--error-600);">Authentication failed. Check your credentials.</span>';
        Toast.error('Authentication Failed', 'Wrong username or password');
      } else {
        statusDiv.innerHTML = '<span style="color: var(--error-600);">Could not connect. Check the device IP address.</span>';
        Toast.error('Connection Failed', result.error || 'Cannot connect to gateway');
      }
    }
  } catch (error) {
    console.error('Connection error:', error);
    statusDiv.innerHTML = '<span style="color: var(--error-600);">Connection error. Please try again.</span>';
    Toast.error('Connection Failed', 'Unexpected error while connecting');
  }

  // Only reset button if connection failed
  if (!connectionSuccess) {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function disconnect() {
  state.url = '';
  state.username = '';
  state.password = '';
  state.connected = false;
  state.activeChat = null;
  state.activeGroup = null;

  // Stop any reconnect loop
  stopReconnectLoop();
  reconnectAttempts = 0;

  // Clear polling interval to prevent memory leak
  if (state.messagePollingInterval) {
    clearInterval(state.messagePollingInterval);
    state.messagePollingInterval = null;
  }
  
  // Reset to local mode (not remote)
  if (API.useRemote) {
    API.useRemote = false;
  }

  Storage.clearConfig();

  document.getElementById('connectionPage').classList.remove('hidden');
  document.getElementById('chatWindow').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');

  closeSettings();
  updateConnectionStatus();
  Toast.info('Disconnected', 'Connection cleared');
}

function updatePageTitle() {
  const base = 'Android SMS Gateway';
  if (totalUnread > 0) {
    document.title = `(${totalUnread}) ${base}`;
  } else {
    document.title = base;
  }
}

// ── Desktop Notifications ────────────────────────────────────────────

/** Request browser notification permission (must be called from user gesture). */
function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
  Notification.requestPermission();
}

/** Show a desktop notification for an incoming message. */
function showDesktopNotification(phone, text, displayName) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // Don't spam if user is already looking

  try {
    const title = displayName || phone || 'New Message';
    const body = text ? (text.length > 120 ? text.slice(0, 120) + '…' : text) : '(no content)';
    const notif = new Notification(title, {
      body,
      tag: phone || 'sms',
      silent: false,
    });

    // Focus the app window when clicked
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch (e) {
    console.debug('Notification error:', e.message);
  }
}

function updateConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  const dot = statusEl.querySelector('.status__dot');
  const text = statusEl.querySelector('.status__text');

  if (state.connected) {
    statusEl.className = 'status status--online';
    const connType = API.useRemote ? 'Cloud' : 'Local';
    text.textContent = `${connType} Connected`;
  } else if (reconnectTimeout || reconnectAttempts > 0) {
    // Reconnecting state
    statusEl.className = 'status status--connecting';
    text.textContent = 'Reconnecting...';
  } else {
    statusEl.className = 'status status--offline';
    text.textContent = 'Not Connected';
  }
}

function loadStats() {
  const savedStats = Storage.loadStats();
  if (savedStats) {
    stats = { ...stats, ...savedStats };
  }
}

function loadSaved() {
  const cfg = Storage.loadConfig();
  if (cfg) {
    document.getElementById('url').value = cfg.url.replace('http://', '').replace('https://', '');
    document.getElementById('username').value = cfg.user;
    document.getElementById('password').value = cfg.pass;
    document.getElementById('saveCreds').checked = true;
  }

  state.history = Storage.loadHistory();
  updateChatList();
}

function getInitials(phone) {
  if (!phone) return '??';
  if (phone.startsWith('GROUP_')) return 'G';
  const num = phone.replace(/\D/g, '');
  return num.slice(-2) || '??';
}

function getGroupMeta(groupId) {
  // First check persistent storage for group metadata
  const groups = Storage.loadGroups();
  if (groups[groupId]) {
    return groups[groupId];
  }
  
  // Fallback to deriving from history if not in storage
  const groupMessages = state.history.filter(m => m.phone === groupId && m.isGroup);
  let groupName = '';
  let recipients = [];

  groupMessages.forEach(message => {
    if (message.groupName) groupName = message.groupName;
    if (Array.isArray(message.recipients) && message.recipients.length > 0) {
      recipients = [...message.recipients];
    }
  });

  const meta = { groupName, recipients };
  
  // Save to persistent storage
  groups[groupId] = meta;
  Storage.saveGroups(groups);
  
  return meta;
}

function saveGroupMeta(groupId, groupName, recipients) {
  const groups = Storage.loadGroups();
  groups[groupId] = { groupName, recipients };
  Storage.saveGroups(groups);
}

function updateChatList() {
  const list = document.getElementById('chatList');
  const chats = {};
  const archived = Storage.loadArchived();

  state.history.forEach(m => {
    if (!chats[m.phone] || new Date(m.rawTime) > new Date(chats[m.phone].rawTime)) {
      chats[m.phone] = m;
    }
  });

  const allSorted = Object.values(chats).sort((a, b) => new Date(b.rawTime) - new Date(a.rawTime));
  const activeChats = allSorted.filter(m => !archived.includes(m.phone));
  const archivedChats = allSorted.filter(m => archived.includes(m.phone));

  if (allSorted.length === 0) {
    list.innerHTML = '';
    return;
  }

  function renderChatItem(m) {
    const isActive = state.activeChat === m.phone;
    const isGroup = m.phone && m.phone.startsWith('GROUP_');
    const groupMeta = isGroup ? getGroupMeta(m.phone) : null;
    const recipientCount = isGroup ? (groupMeta.recipients.length || m.recipients?.length || 0) : 0;
    const displayName = isGroup ? (groupMeta.groupName || `Group (${recipientCount})`) : m.phone;
    const escapedPhone = escapeHtml(m.phone).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const unread = unreadCounts[m.phone] || 0;

    return `
    <div class="chat-item ${isActive ? 'chat-item--active' : ''}" onclick="selectChatFromList('${escapedPhone}')" data-phone="${escapedPhone}">
        <div class="chat-item__avatar ${isGroup ? 'chat-item__avatar--group' : ''}">${isGroup ? recipientCount : getInitials(m.phone)}</div>
        <div class="chat-item__content">
          <div class="chat-item__header">
            <span class="chat-item__name">${escapeHtml(displayName)}</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${unread > 0 ? `<span class="chat-item__badge">${unread > 99 ? '99+' : unread}</span>` : ''}
              <span class="chat-item__time">${m.time}</span>
            </div>
          </div>
          <div class="chat-item__preview">${escapeHtml(m.text)}</div>
        </div>
      </div>
    `;
  }

  let html = activeChats.map(m => renderChatItem(m)).join('');

  // Archived section
  if (archivedChats.length > 0) {
    html += `
      <div class="archived-section">
        <div class="archived-section__header" onclick="this.classList.toggle('archived-section--collapsed')">
          <div class="archived-section__header-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/>
            </svg>
            <span>Archived (${archivedChats.length})</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="archived-section__chevron">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </div>
        <div class="archived-section__content">
          ${archivedChats.map(m => renderChatItem(m)).join('')}
          <button class="archived-section__restore-all" onclick="unarchiveAllConversations()">Restore all</button>
        </div>
      </div>
    `;
  }

  list.innerHTML = html;
}

function selectChatFromList(phone) {
  state.activeChat = phone;
  state.activeGroup = phone.startsWith('GROUP_') ? { id: phone, phones: [] } : null;

  // Reset unread count for this conversation
  if (unreadCounts[phone]) {
    totalUnread -= unreadCounts[phone];
    delete unreadCounts[phone];
    updatePageTitle();
  }

  updateChatList();

  document.getElementById('connectionPage').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('chatWindow').classList.remove('hidden');

  const isGroup = phone.startsWith('GROUP_');
  const groupMeta = isGroup ? getGroupMeta(phone) : null;
  const displayName = isGroup ? (groupMeta.groupName || `Group (${groupMeta.recipients.length})`) : phone;
  const recipientCount = isGroup ? (groupMeta.recipients.length || 0) : 0;

  document.getElementById('headerAvatar').textContent = isGroup ? recipientCount : getInitials(phone);
  document.getElementById('headerName').textContent = displayName;
  document.getElementById('editGroupBtn').style.display = isGroup ? 'flex' : 'none';

  renderMessages();
}

function renderMessages() {
  const win = document.getElementById('msgWindow');
  const msgs = state.history.filter(m => m.phone === state.activeChat);

  if (msgs.length === 0) {
    // Check if the conversation still exists in history
    const conversationExists = state.history.some(m => m.phone === state.activeChat);
    if (!conversationExists && state.activeChat) {
      // Conversation was fully deleted — go back to empty state
      state.activeChat = null;
      state.activeGroup = null;
      document.getElementById('chatWindow').classList.add('hidden');
      document.getElementById('emptyState').classList.remove('hidden');
      updateChatList();
      return;
    }
    win.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center;">
        <div style="width: 80px; height: 80px; background: var(--color-bg-surface-lowered); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: var(--space-4); color: var(--color-text-tertiary);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </div>
        <p style="font-weight: var(--font-medium); color: var(--color-text-secondary); margin-bottom: var(--space-2);">No messages yet</p>
        <p style="font-size: var(--text-sm); color: var(--color-text-tertiary);">Start the conversation by sending a message</p>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDate = '';

  msgs.forEach(m => {
    const msgDate = new Date(m.rawTime).toLocaleDateString();
    if (msgDate !== lastDate) {
      html += `<div class="message-group__date">${msgDate}</div>`;
      lastDate = msgDate;
    }

const isSent = m.type === 'sent';
  let statusClass = 'message__status--sending';
  let statusIcon = '<span class="message__status-icon">⏳</span>';
  
  if (m.status === 'success') {
    statusClass = 'message__status--delivered';
    statusIcon = '<span class="message__status-icon message__status-icon--double">✓✓</span>';
  } else if (m.status === 'sent') {
    statusClass = 'message__status--sent';
    statusIcon = '<span class="message__status-icon">✓</span>';
  } else if (m.status === 'failed') {
    statusClass = 'message__status--failed';
    statusIcon = '<span class="message__status-icon">✗</span>';
  }

  const escapedMsgId = escapeHtml(m.id).replace(/'/g, "\\'");

  html += `
  <div class="message ${isSent ? 'message--sent' : 'message--received'}" data-status="${m.status}">
    <div class="message__avatar">${isSent ? 'Me' : getInitials(m.phone)}</div>
    <div class="message__content">
      <div class="message__bubble">
        <button class="message__delete-btn" onclick="deleteMessage('${escapedMsgId}')" title="Delete message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
        <div class="message__text">${escapeHtml(m.text)}</div>
      </div>
      <div class="message__meta">
        <span class="message__time">${m.time}</span>
        ${isSent ? `<span class="message__status ${statusClass}">${statusIcon}</span>` : ''}
      </div>
    </div>
  </div>
  `;
  });

  win.innerHTML = html;
  win.scrollTop = win.scrollHeight;
}

// ── Message Deletion ────────────────────────────────────────────────────

/** Delete a single message by ID. */
function deleteMessage(msgId) {
  const msg = state.history.find(m => m.id === msgId);
  if (!msg) return;
  if (!confirm('Delete this message?')) return;

  state.history = state.history.filter(m => m.id !== msgId);
  Storage.saveHistory(state.history);
  renderMessages();
  updateChatList();
  Toast.success('Message Deleted', 'Message removed');
}

/** Delete an entire conversation by phone number. */
function deleteConversation(phone) {
  if (!phone) return;
  const displayName = phone.startsWith('GROUP_')
    ? (getGroupMeta(phone).groupName || 'this group')
    : phone;
  if (!confirm(`Delete entire conversation with ${displayName}?`)) return;

  state.history = state.history.filter(m => m.phone !== phone);
  Storage.saveHistory(state.history);

  // If we're currently viewing this conversation, go back to empty state
  if (state.activeChat === phone) {
    state.activeChat = null;
    state.activeGroup = null;
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
  }

  updateChatList();
  Toast.success('Conversation Deleted', `Chat with ${displayName} removed`);
}

// ── Conversation Archiving ────────────────────────────────────────────────

/** Check if a conversation is archived. */
function isArchived(phone) {
  if (!phone) return false;
  const archived = Storage.loadArchived();
  return archived.includes(phone);
}

/** Archive a conversation — hide it from the main chat list. */
function archiveConversation(phone) {
  if (!phone) return;
  const archived = Storage.loadArchived();
  if (archived.includes(phone)) return;

  archived.push(phone);
  Storage.saveArchived(archived);

  // If we're currently viewing this conversation, go back to empty state
  if (state.activeChat === phone) {
    state.activeChat = null;
    state.activeGroup = null;
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
  }

  updateChatList();
  Toast.success('Conversation Archived', 'Conversation moved to archive');
}

/** Unarchive a conversation — restore it to the main chat list. */
function unarchiveConversation(phone) {
  if (!phone) return;
  let archived = Storage.loadArchived();
  if (!archived.includes(phone)) return;

  archived = archived.filter(p => p !== phone);
  Storage.saveArchived(archived);
  updateChatList();
  Toast.success('Conversation Restored', 'Conversation moved back to main list');
}

/** Unarchive all conversations. */
function unarchiveAllConversations() {
  let archived = Storage.loadArchived();
  if (archived.length === 0) return;
  if (!confirm('Restore all archived conversations?')) return;
  Storage.saveArchived([]);
  updateChatList();
  Toast.success('All Restored', 'All conversations moved back to main list');
}

// Helper to manage history size
function trimHistory() {
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history.slice(-MAX_HISTORY_ITEMS);
  }
}

async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  const phone = state.activeChat;

  if (!text || !phone) return;
  if (!state.url) {
    Toast.error('Not Connected', 'Please configure connection first');
    return;
  }

  const isGroup = phone.startsWith('GROUP_');
  const groupMeta = isGroup ? getGroupMeta(phone) : null;
  const phoneNumbers = isGroup ? (groupMeta.recipients.length > 0 ? groupMeta.recipients : []) : [phone];

  if (isGroup && phoneNumbers.length === 0) {
    Toast.error('No Recipients', 'This group has no recipients');
    return;
  }

  // ── Scheduled message ───────────────────────────────────────────────
  if (scheduleSendAt) {
    const scheduleId = generateMessageId();
    const now = new Date();
    const sendDate = new Date(scheduleSendAt);
    const formattedDate = sendDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const formattedTime = sendDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add a placeholder message to history
    state.history.push({
      phone,
      text,
      type: 'sent',
      time: `${formattedDate} ${formattedTime}`,
      rawTime: now.toISOString(),
      status: 'scheduled',
      id: scheduleId,
      isGroup,
      recipients: phoneNumbers,
      groupName: groupMeta?.groupName || null,
      scheduleId
    });

    input.value = '';
    autoResize(input);
    cancelSchedule();
    renderMessages();
    Storage.saveHistory(state.history);

    // Send to server schedule API
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: scheduleId,
          phone,
          text,
          recipients: isGroup ? phoneNumbers : undefined,
          groupName: groupMeta?.groupName || null,
          isGroup,
          gatewayUrl: API.useRemote ? null : state.url,
          authUser: state.username,
          authPass: state.password,
          isRemote: API.useRemote,
          sendAt: scheduleSendAt,
        }),
      });

      if (res.ok) {
        Toast.success('Message Scheduled', `Will send ${formattedDate} at ${formattedTime}`);
      } else {
        Toast.error('Schedule Failed', 'Could not schedule message');
      }
    } catch (e) {
      Toast.error('Schedule Failed', 'Server unreachable');
    }

    updateChatList();
    return;
  }

  // ── Immediate send ──────────────────────────────────────────────────
  // Check throttle - prevent sending too fast
  const currentTime = Date.now();
  const timeSinceLastSend = currentTime - lastSendTime;
  if (timeSinceLastSend < MESSAGE_THROTTLE_MS) {
    await new Promise(resolve => setTimeout(resolve, MESSAGE_THROTTLE_MS - timeSinceLastSend));
  }
  lastSendTime = Date.now();

  const msgId = generateMessageId();
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msg = {
    phone,
    text,
    type: 'sent',
    time: timeStr,
    rawTime: now.toISOString(),
    status: 'sending',
    id: msgId,
    isGroup,
    recipients: phoneNumbers,
    groupName: groupMeta?.groupName || null
  };

  state.history.push(msg);
  input.value = '';
  autoResize(input);
  renderMessages();

  // Send with retry logic (3 attempts with delay)
  let success = false;
  let attempts = 0;
  const MAX_RETRIES = 3;
  
  // Determine if using local or remote API
  const useLocalAPI = state.url && !API.useRemote;
  
  while (!success && attempts < MAX_RETRIES) {
    attempts++;
    if (useLocalAPI) {
      success = await API.sendMessageLocal(state.url, state.username, state.password, phoneNumbers, text);
    } else {
      success = await API.sendMessage(phoneNumbers, text);
    }
    
    if (!success && attempts < MAX_RETRIES) {
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, attempts * 1000));
    }
  }

  const found = state.history.find(m => m.id === msgId);
  if (found) {
    found.status = success ? 'success' : 'error';
  }

  if (success) {
    phoneNumbers.forEach(() => {
      incrementStat('sent');
    });
    Toast.success('Message Sent', `Sent to ${phoneNumbers.length} recipient(s)`);
  } else {
    phoneNumbers.forEach(() => incrementStat('failed'));
    Toast.error('Send Failed', `Could not send message after ${MAX_RETRIES} attempts`);
    // Connection might be down — trigger reconnect
    onConnectionLost();
  }

  renderMessages();
  updateChatList();
  Storage.saveHistory(state.history);
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function updateCharCount(textarea) {
  const len = textarea.value.length;
  const charCountEl = document.getElementById('charCount');
  if (!charCountEl) return;
  
  if (len === 0) {
    charCountEl.textContent = '';
    return;
  }
  
  const smsCount = Math.ceil(len / 160);
  charCountEl.textContent = `${len} chars (${smsCount} SMS)`;
  
  // Color coding
  charCountEl.classList.remove('warning', 'danger');
  if (len > 480) {
    charCountEl.classList.add('danger');
  } else if (len > 160) {
    charCountEl.classList.add('warning');
  }
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function togglePasswordVisibility() {
  const passwordInput = document.getElementById('password');
  const icon = document.getElementById('passwordIcon');
  
  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    icon.innerHTML = '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l1.42 1.42C17.99 17.01 19 15.65 19 14c0-2.76-2.24-5-5-5-2.76 0-5 2.24-5 5 0 1.65 1.01 3.01 2.34 3.25l1.42 1.42c-.24.7-.36 1.18-.36 1.83 0 2.76 2.24 5 5 5s5-2.24 5-5c0-.65-.13-1.26-.36-1.83l1.42-1.42C17.99 9.99 17 11.35 17 14c0 2.76-2.24 5-5 5zM12 4c4.41 0 8 3.59 8 8 0 1.57-.46 3.03-1.25 4.26l-1.42-1.42C17.32 14.57 17 13.32 17 12c0-4.41-3.59-8-8-8-4.41 0-8 3.59-8 8 0 1.32.32 2.57.93 3.66l-1.42 1.42C4.46 15.03 4 13.57 4 12c0-4.41 3.59-8 8-8z"/><circle cx="12" cy="12" r="3"/>';
  } else {
    passwordInput.type = 'password';
    icon.innerHTML = '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>';
  }
}

function openNewChatMenu() {
  const modal = document.getElementById('newChatModal');
  modal.classList.add('modal-backdrop--open');
  currentChatType = 'single';
  tempRecipients = [];
  editingGroup = null;
  updateChatTypeUI();
  renderRecipientsList();
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function setChatType(type) {
  currentChatType = type;
  updateChatTypeUI();
}

function updateChatTypeUI() {
  const singleBtn = document.getElementById('singleChatBtn');
  const groupBtn = document.getElementById('groupChatBtn');
  const csvBtn = document.getElementById('csvChatBtn');
  const singleSection = document.getElementById('singleChatSection');
  const groupSection = document.getElementById('groupChatSection');

  // Reset all buttons
  singleBtn.className = 'btn btn--ghost';
  groupBtn.className = 'btn btn--ghost';
  csvBtn.className = 'btn btn--ghost';
  singleSection.style.display = 'none';
  groupSection.style.display = 'none';

  if (currentChatType === 'single') {
    singleBtn.className = 'btn';
    singleSection.style.display = 'block';
    setTimeout(() => document.getElementById('singlePhoneInput').focus(), 100);
  } else if (currentChatType === 'group') {
    groupBtn.className = 'btn';
    groupSection.style.display = 'block';
    setTimeout(() => document.getElementById('groupNameInput').focus(), 100);
  } else if (currentChatType === 'csv') {
    csvBtn.className = 'btn';
    closeModal();
    setTimeout(() => openCSVSender(), 100);
  }
}

function addRecipient() {
  const input = document.getElementById('newRecipientInput');
  const phone = input.value.trim();

  if (!phone) return;
  if (phone.length < 8) {
    Toast.warning('Invalid Number', 'Please enter a valid phone number');
    return;
  }
  if (tempRecipients.includes(phone)) {
    Toast.info('Already Added', 'This number is already in the list');
    input.value = '';
    return;
  }

  tempRecipients.push(phone);
  renderRecipientsList();
  input.value = '';
}

function removeRecipient(index) {
  tempRecipients.splice(index, 1);
  renderRecipientsList();
}

function renderRecipientsList() {
  const container = document.getElementById('recipientsList');
  if (tempRecipients.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = tempRecipients.map((phone, index) => `
    <span class="badge badge--primary" style="display: inline-flex; align-items: center; gap: var(--space-1);">
      ${escapeHtml(phone)}
      <button onclick="removeRecipient(${index})" style="background: none; border: none; cursor: pointer; padding: 0; color: inherit;">&times;</button>
    </span>
  `).join('');
}

function handleRecipientKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addRecipient();
  } else if (e.key === 'Backspace' && e.target.value === '' && tempRecipients.length > 0) {
    removeRecipient(tempRecipients.length - 1);
  }
}

function confirmNewChat() {
  if (currentChatType === 'single') {
    const phone = document.getElementById('singlePhoneInput').value.trim();
    if (!phone) {
      Toast.warning('Missing Number', 'Please enter a phone number');
      return;
    }

    const msgId = generateMessageId();
    state.history.push({
      phone,
      text: 'Chat started',
      type: 'sent',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawTime: new Date().toISOString(),
      status: 'success',
      id: msgId,
      isGroup: false
    });

    Storage.saveHistory(state.history);
    selectChatFromList(phone);
    closeModal();
  } else {
    if (tempRecipients.length === 0) {
      Toast.warning('No Recipients', 'Please add at least one recipient');
      return;
    }

    const groupId = 'GROUP_' + Date.now();
    const groupName = document.getElementById('groupNameInput').value.trim();
    const msgId = generateMessageId();

    // Save group metadata FIRST before using it
    saveGroupMeta(groupId, groupName, [...tempRecipients]);

    state.history.push({
      phone: groupId,
      text: 'Group created',
      type: 'sent',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawTime: new Date().toISOString(),
      status: 'success',
      id: msgId,
      isGroup: true,
      recipients: [...tempRecipients],
      groupName
    });

    Storage.saveHistory(state.history);
    selectChatFromList(groupId);
    closeModal();
  }
}

function openEditGroup() {
  if (!state.activeChat || !state.activeChat.startsWith('GROUP_')) return;

  const groupMeta = getGroupMeta(state.activeChat);
  editingGroup = state.activeChat;
  tempRecipients = [...groupMeta.recipients];
  currentChatType = 'group';

  document.getElementById('groupNameInput').value = groupMeta.groupName || '';
  renderRecipientsList();

  const modal = document.getElementById('newChatModal');
  modal.classList.add('modal-backdrop--open');
  updateChatTypeUI();

  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function closeModal() {
  const modal = document.getElementById('newChatModal');
  modal.classList.remove('modal-backdrop--open');
  state.focusTrap?.();
}

function closeModalOnBackdrop(e, modalId) {
  if (e.target === e.currentTarget) {
    if (modalId === 'newChatModal') closeModal();
    else if (modalId === 'csvSenderModal') closeCSVSender();
    else if (modalId === 'statsModal') closeStats();
    else if (modalId === 'templatesModal') closeTemplates();
    else if (modalId === 'settingsModal') closeSettings();
    else if (modalId === 'contactsModal') closeContacts();
  }
}

function openCSVSender() {
  const modal = document.getElementById('csvSenderModal');
  modal.classList.add('modal-backdrop--open');
  csvData = [];
  document.getElementById('csvSendFile').value = '';
  document.getElementById('csvPreview').style.display = 'none';
  document.getElementById('csvMessageInput').style.display = 'none';
  document.getElementById('csvSendBtn').disabled = true;
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function closeCSVSender() {
  document.getElementById('csvSenderModal').classList.remove('modal-backdrop--open');
  state.focusTrap?.();
}

function handleCSVSendFile(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split('\n').filter(l => l.trim());

    csvData = [];
    lines.forEach(line => {
      // Proper CSV parsing that handles quoted fields and commas in messages
      const parsed = parseCSVLine(line);
      const phone = parsed[0]?.trim() || '';
      const message = parsed[1]?.trim() || '';
      if (phone && phone.length > 3) {
        csvData.push({ phone, message });
      }
    });

    if (csvData.length > 0) {
      const tbody = document.getElementById('csvPreviewRows');
      tbody.innerHTML = csvData.slice(0, 10).map(row => `
        <tr style="border-bottom: 1px solid var(--color-border);">
          <td style="padding: var(--space-3); font-size: var(--text-sm);">${escapeHtml(row.phone)}</td>
          <td style="padding: var(--space-3); font-size: var(--text-sm); color: var(--color-text-secondary);">${escapeHtml(row.message) || '(no message)'}</td>
        </tr>
      `).join('');

      document.getElementById('csvRecipientCount').textContent = `${csvData.length} message${csvData.length !== 1 ? 's' : ''} to send`;
      document.getElementById('csvPreview').style.display = 'block';

      const hasAllMessages = csvData.every(d => d.message);
      document.getElementById('csvMessageInput').style.display = hasAllMessages ? 'none' : 'block';
      document.getElementById('csvSendBtn').disabled = false;
    }
  };
  reader.readAsText(file);
}

async function sendCSVMessages() {
  if (!state.url) {
    Toast.error('Not Connected', 'Please configure connection first');
    return;
  }
  if (csvData.length === 0) return;

  const btn = document.getElementById('csvSendBtn');
  const defaultMessage = document.getElementById('csvMessageText').value.trim();

  btn.disabled = true;
  btn.innerHTML = 'Sending...';

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < csvData.length; i++) {
    const item = csvData[i];
    const message = item.message || defaultMessage;
    if (!message) {
      failCount++;
      continue;
    }

    // Update button text to show progress
    btn.innerHTML = `Sending ${i + 1}/${csvData.length}...`;

    // Use local or remote API
    let success;
    if (API.useRemote) {
      success = await API.sendMessage([item.phone], message);
    } else {
      success = await API.sendMessageLocal(state.url, state.username, state.password, [item.phone], message);
    }

    if (success) {
      successCount++;
      incrementStat('sent');
      state.history.push({
        phone: item.phone,
        text: message,
        type: 'sent',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        rawTime: new Date().toISOString(),
        status: 'success',
        id: generateMessageId()
      });
    } else {
      failCount++;
      incrementStat('failed');
      // Connection might be down — trigger reconnect and stop sending
      onConnectionLost();
      break;
    }

    // Add delay between messages (except after the last one)
    if (i < csvData.length - 1) {
      await new Promise(resolve => setTimeout(resolve, MESSAGE_THROTTLE_MS));
    }
  }

  btn.innerHTML = 'Send All';
  btn.disabled = false;

  if (failCount === 0) {
    Toast.success('Messages Sent', `${successCount} message${successCount !== 1 ? 's' : ''} sent`);
  } else {
    Toast.warning('Partial Success', `${successCount} sent, ${failCount} failed`);
  }

  closeCSVSender();
  updateChatList();
  Storage.saveHistory(state.history);
}

function openStats() {
  updateStatsDisplay();
  loadScheduledSection();
  const modal = document.getElementById('statsModal');
  modal.classList.add('modal-backdrop--open');
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function closeStats() {
  document.getElementById('statsModal').classList.remove('modal-backdrop--open');
  state.focusTrap?.();
}

function updateStatsDisplay() {
  document.getElementById('statSent').textContent = stats.sent;
  document.getElementById('statDelivered').textContent = stats.delivered;
  document.getElementById('statReceived').textContent = stats.received;
  document.getElementById('statFailed').textContent = stats.failed;

  const groupChats = new Set(state.history.filter(m => m.isGroup).map(m => m.phone)).size;
  const contacts = new Set(state.history.map(m => m.phone)).size;

  document.getElementById('statGroups').textContent = groupChats;
  document.getElementById('statContacts').textContent = contacts;
}

function incrementStat(type) {
  if (stats[type] !== undefined) {
    stats[type]++;
    Storage.saveStats(stats);
  }
}

function clearStats() {
  stats = { sent: 0, delivered: 0, failed: 0, received: 0 };
  Storage.saveStats(stats);
  updateStatsDisplay();
  Toast.info('Statistics Reset', 'All statistics cleared');
}

function openTemplates() {
  loadTemplates();
  const modal = document.getElementById('templatesModal');
  modal.classList.add('modal-backdrop--open');
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function closeTemplates() {
  document.getElementById('templatesModal').classList.remove('modal-backdrop--open');
  state.focusTrap?.();
}

function loadTemplates() {
  templates = Storage.loadTemplates();
  renderTemplates();
}

function renderTemplates() {
  const list = document.getElementById('templatesList');
  if (templates.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: var(--space-8); color: var(--color-text-tertiary);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="margin-bottom: var(--space-4); opacity: 0.5;">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
        </svg>
        <p>No templates saved yet</p>
        <p style="font-size: var(--text-sm); margin-top: var(--space-2);">Create your first template below</p>
      </div>
    `;
    return;
  }

  list.innerHTML = templates.map((t, idx) => `
    <div style="display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); background: var(--color-bg-surface-lowered); border-radius: var(--radius-lg); margin-bottom: var(--space-3);">
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: var(--font-medium); color: var(--color-text-primary); margin-bottom: var(--space-1);">${escapeHtml(t.title)}</div>
        <div style="font-size: var(--text-sm); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.text)}</div>
      </div>
      <div style="display: flex; gap: var(--space-2);">
        <button class="btn btn--secondary" onclick="useTemplate(${idx})">Use</button>
        <button class="btn btn--ghost" onclick="deleteTemplate(${idx})" style="color: var(--error-600);">Delete</button>
      </div>
    </div>
  `).join('');
}

function saveTemplate() {
  const title = document.getElementById('templateTitle').value.trim();
  const text = document.getElementById('templateText').value.trim();

  if (!title || !text) {
    Toast.warning('Missing Information', 'Please enter both title and message');
    return;
  }

  templates.push({ title, text });
  Storage.saveTemplates(templates);
  renderTemplates();
  clearTemplateForm();
  Toast.success('Template Saved', `"${title}" has been saved`);
}

function useTemplate(idx) {
  const template = templates[idx];
  const input = document.getElementById('msgInput');
  input.value = template.text;
  autoResize(input);
  Toast.info('Template Applied', `"${template.title}" inserted`);
  closeTemplates();
}

function deleteTemplate(idx) {
  const template = templates[idx];
  templates.splice(idx, 1);
  Storage.saveTemplates(templates);
  renderTemplates();
  Toast.success('Template Deleted', `"${template.title}" removed`);
}

function clearTemplateForm() {
  document.getElementById('templateTitle').value = '';
  document.getElementById('templateText').value = '';
}

function toggleTemplateDropdown(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('templateDropdown');
  const isVisible = dropdown.classList.contains('dropdown--open');

  if (isVisible) {
    dropdown.classList.remove('dropdown--open');
    dropdown.style.display = 'none';
  } else {
    renderTemplateDropdownList();
    dropdown.classList.add('dropdown--open');
    dropdown.style.display = 'block';
  }
}

function renderTemplateDropdownList() {
  const list = document.getElementById('templateDropdownList');
  if (templates.length === 0) {
    list.innerHTML = '<div style="padding: var(--space-4); text-align: center; color: var(--color-text-tertiary); font-size: var(--text-sm);">No templates saved</div>';
    return;
  }

  list.innerHTML = templates.map((t, i) => `
    <div class="dropdown__item" onclick="insertTemplate(${i})">
      <div>
        <div style="font-weight: var(--font-medium); color: var(--color-text-primary);">${escapeHtml(t.title)}</div>
        <div style="font-size: var(--text-xs); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${escapeHtml(t.text)}</div>
      </div>
    </div>
  `).join('');
}

function insertTemplate(idx) {
  const template = templates[idx];
  const input = document.getElementById('msgInput');
  input.value = template.text;
  autoResize(input);
  document.getElementById('templateDropdown').style.display = 'none';
  Toast.info('Template Applied', `"${template.title}" inserted`);
}

function openSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.add('modal-backdrop--open');
  updateActiveThemeUI();
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('modal-backdrop--open');
  state.focusTrap?.();
}

function clearAllData() {
  if (confirm('Are you sure? This will delete all messages, chats, templates, and statistics.')) {
    Storage.clearAll();
    state.history = [];
    stats = { sent: 0, delivered: 0, failed: 0, received: 0 };
    templates = [];
    state.activeChat = null;
    state.activeGroup = null;

    // Reset unread counts
    unreadCounts = {};
    totalUnread = 0;
    updatePageTitle();

    updateChatList();
    updateStatsDisplay();
    renderTemplates();

    document.getElementById('connectionPage').classList.remove('hidden');
    document.getElementById('chatWindow').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');

    closeSettings();
    Toast.success('Data Cleared', 'All data has been deleted');
  }
}

function toggleThemeMenu(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('themeDropdown');
  dropdown.classList.toggle('dropdown--open');
}

function updateActiveThemeUI() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === current);
  });
}

function setTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('sms_gateway_theme', themeName);
  updateActiveThemeUI();
  Toast.info('Theme Changed', `${themeName.charAt(0).toUpperCase() + themeName.slice(1)} theme applied`);
}

function loadTheme() {
  const savedTheme = localStorage.getItem('sms_gateway_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
}

// ── Message Search ────────────────────────────────────────────────────

let searchTimeout = null;

/**
 * Debounced handler for the search input.
 * When the user types, show loading, then call the search API.
 */
function onSearchInput(value) {
  clearTimeout(searchTimeout);

  const resultsEl = document.getElementById('searchResults');
  const sidebarContent = document.getElementById('sidebarContent');
  const inner = document.getElementById('searchResultsInner');

  const q = value.trim();

  if (!q) {
    // Clear search: hide results, show chat list
    resultsEl.classList.add('hidden');
    resultsEl.classList.remove('sidebar__search-results--visible');
    sidebarContent.classList.remove('hidden');
    filterChats('');
    return;
  }

  // Show search results section, hide chat list
  resultsEl.classList.remove('hidden');
  resultsEl.classList.add('sidebar__search-results--visible');
  sidebarContent.classList.add('hidden');

  // Show loading state
  inner.innerHTML = `
    <div class="search-results__empty">
      <div class="spinner" style="width:24px;height:24px;border-width:2px;"></div>
      <p>Searching...</p>
    </div>
  `;

  // Debounce: wait 300ms after last keystroke
  searchTimeout = setTimeout(() => performSearch(q), 300);
}

/**
 * Execute the search via the API and render results.
 */
async function performSearch(query) {
  const inner = document.getElementById('searchResultsInner');

  try {
    const res = await fetch(`/api/messages/search?q=${encodeURIComponent(query)}&limit=5`);
    if (!res.ok) {
      inner.innerHTML = `
        <div class="search-results__empty">
          <p>Search failed</p>
        </div>
      `;
      return;
    }

    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      inner.innerHTML = `
        <div class="search-results__empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <p>No messages match "${escapeHtml(query)}"</p>
        </div>
      `;
      return;
    }

    // Build group metadata lookup from history for group names
    const groups = Storage.loadGroups();

    inner.innerHTML = results.map(group => {
      const isGroup = group.isGroup || (group.phone && group.phone.startsWith('GROUP_'));
      const groupMeta = isGroup ? groups[group.phone] : null;
      const displayName = isGroup
        ? (groupMeta?.groupName || group.groupName || `Group (${group.messages.length})`)
        : group.phone;
      const avatarContent = isGroup ? (group.messages.length || 'G') : getInitials(group.phone);

      const escapedPhone = escapeHtml(group.phone).replace(/'/g, "\\'").replace(/"/g, '&quot;');

      return `
        <div class="search-result-item" onclick="selectChatFromList('${escapedPhone}'); document.getElementById('chatSearch').value = ''; onSearchInput('');">
          <div class="search-result-item__avatar ${isGroup ? 'search-result-item__avatar--group' : ''}">${avatarContent}</div>
          <div class="search-result-item__content">
            <div class="search-result-item__header">
              <span class="search-result-item__name">${escapeHtml(displayName)}</span>
              <span class="search-result-item__count">${group.messages.length} match${group.messages.length !== 1 ? 'es' : ''}</span>
            </div>
            <div class="search-result-item__matches">
              ${group.messages.map(m => `
                <div class="search-result-item__match">${highlightMatch(escapeHtml(m.text), query)}</div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    inner.innerHTML = `
      <div class="search-results__empty">
        <p>Search failed. Server unreachable.</p>
      </div>
    `;
  }
}

/** Highlight search query matches in text. */
function highlightMatch(text, query) {
  if (!query) return text;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<em>$1</em>');
}

function filterChats(query) {
  const items = document.querySelectorAll('.chat-item');
  const lowerQuery = query.toLowerCase();

  items.forEach(item => {
    const name = item.querySelector('.chat-item__name').textContent.toLowerCase();
    const preview = item.querySelector('.chat-item__preview').textContent.toLowerCase();
    const match = name.includes(lowerQuery) || preview.includes(lowerQuery);
    item.style.display = match ? 'flex' : 'none';
  });
}

function handleCSVImport(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const phones = text.split('\n')
      .map(p => p.split(',')[0].trim())
      .filter(p => p && p.length > 3);

    phones.forEach(phone => {
      if (!tempRecipients.includes(phone)) {
        tempRecipients.push(phone);
      }
    });

    renderRecipientsList();
    Toast.success('CSV Imported', `${phones.length} phone number(s) imported`);
  };
  reader.readAsText(file);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function generateMessageId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Parse a single CSV line respecting quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  
  // Don't forget the last field
  result.push(current.trim());
  return result;
}

// ── Scheduling ──────────────────────────────────────────────────────────

/** Toggle the schedule date/time picker visibility. */
function toggleSchedulePicker() {
  const picker = document.getElementById('schedulePicker');
  const btn = document.getElementById('scheduleBtn');
  const isVisible = picker.classList.contains('visible');

  if (isVisible) {
    picker.classList.remove('visible');
    btn.classList.remove('btn--primary');
    if (!scheduleSendAt) {
      document.getElementById('scheduleInfo').classList.remove('active');
      document.getElementById('scheduleInfo').textContent = '';
    }
  } else {
    picker.classList.add('visible');
    btn.classList.add('btn--primary');
    picker.focus();
    // Set minimum to current time
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    picker.min = now.toISOString().slice(0, 16);
  }
}

/** Called when the picker value changes. */
function onSchedulePickerChange() {
  const picker = document.getElementById('schedulePicker');
  const info = document.getElementById('scheduleInfo');
  const val = picker.value;

  if (val) {
    scheduleSendAt = new Date(val).toISOString();
    const d = new Date(val);
    const dateStr = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    info.innerHTML = `⏰ Scheduled for ${dateStr} at ${timeStr} <button class="cancel-schedule" onclick="cancelSchedule()">Cancel</button>`;
    info.classList.add('active');
  } else {
    cancelSchedule();
  }
}

/** Clear the scheduled time. */
function cancelSchedule() {
  scheduleSendAt = null;
  const picker = document.getElementById('schedulePicker');
  const btn = document.getElementById('scheduleBtn');
  const info = document.getElementById('scheduleInfo');
  picker.value = '';
  picker.classList.remove('visible');
  btn.classList.remove('btn--primary');
  info.classList.remove('active');
  info.textContent = '';
}

/** Fetch scheduled messages and render in the stats modal. */
async function loadScheduledSection() {
  const container = document.getElementById('scheduledList');
  if (!container) return;

  try {
    const res = await fetch('/api/schedule');
    if (!res.ok) {
      container.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);">Could not load scheduled messages</p>';
      return;
    }
    const msgs = await res.json();

    if (msgs.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-4);">No scheduled messages</p>';
      return;
    }

    container.innerHTML = msgs.map(m => {
      const sendDate = new Date(m.sendAt);
      const dateStr = sendDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const timeStr = sendDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const displayPhone = m.isGroup && m.groupName ? m.groupName : m.phone;
      const statusClass = `scheduled-item__status--${m.status}`;
      const isCancellable = m.status === 'pending';

      return `
        <div class="scheduled-item ${m.status === 'sent' ? 'scheduled-item--sent' : ''} ${m.status === 'failed' ? 'scheduled-item--failed' : ''}">
          <div class="scheduled-item__info">
            <div class="scheduled-item__phone">${escapeHtml(displayPhone)}</div>
            <div class="scheduled-item__preview">${escapeHtml(m.text)}</div>
          </div>
          <div class="scheduled-item__time">${dateStr} ${timeStr}</div>
          <div class="scheduled-item__status ${statusClass}">${m.status}</div>
          ${isCancellable ? `<button class="scheduled-item__cancel" onclick="cancelScheduledMessage('${m.id}')" title="Cancel">&times;</button>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);">Server unreachable</p>';
  }
}

/** Cancel a scheduled message by ID. */
async function cancelScheduledMessage(id) {
  try {
    const res = await fetch(`/api/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.info('Cancelled', 'Scheduled message cancelled');
      loadScheduledSection();
    }
  } catch (e) {
    Toast.error('Error', 'Could not cancel message');
  }
}

// ── Contact Book ────────────────────────────────────────────────────────

let contactsData = [];
let editingContactId = null;
let contactGroupTags = [];

/** Setup drag-and-drop handlers for the contacts modal body. */
function setupContactsDragDrop() {
  const body = document.getElementById('contactsModalBody');
  const dropzone = document.getElementById('contactsDropzone');
  if (!body || !dropzone) return;

  let dragCounter = 0;

  body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) {
      dropzone.classList.add('drag-active');
      body.classList.add('drag-over');
    }
  });

  body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzone.classList.remove('drag-active');
      body.classList.remove('drag-over');
    }
  });

  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-active');
    body.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'text/plain') {
      Toast.error('Invalid File', 'Please drop a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = async function(ev) {
      const csv = ev.target.result;

      try {
        const res = await fetch('/api/contacts/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv }),
        });

        if (!res.ok) {
          const err = await res.json();
          Toast.error('Import Failed', err.error || 'Could not import contacts');
          return;
        }

        const result = await res.json();
        Toast.success('Imported', `${result.imported} contact(s) imported${result.skipped ? `, ${result.skipped} skipped` : ''}`);
        loadContacts();
      } catch (err) {
        Toast.error('Import Failed', 'Server unreachable');
      }
    };
    reader.readAsText(file);
  });
}

/** Open the contacts modal. */
let contactsDragDropSetup = false;
function openContacts() {
  const modal = document.getElementById('contactsModal');
  if (!contactsDragDropSetup) {
    setupContactsDragDrop();
    contactsDragDropSetup = true;
  }
  modal.classList.add('modal-backdrop--open');
  state.focusTrap?.();
  state.focusTrap = trapFocus(modal.querySelector('.modal'));
  loadContacts();
}

/** Close the contacts modal. */
function closeContacts() {
  document.getElementById('contactsModal').classList.remove('modal-backdrop--open');
  state.focusTrap?.();
  cancelContactForm();
}

/** Fetch and render contacts from the server. */
async function loadContacts() {
  const list = document.getElementById('contactsList');
  try {
    const res = await fetch('/api/contacts');
    if (!res.ok) {
      list.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-8);">Could not load contacts</p>';
      return;
    }
    contactsData = await res.json();
    renderContacts(contactsData);
  } catch (e) {
    list.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-8);">Server unreachable</p>';
  }
}

/** Render contacts list with optional filter. */
function renderContacts(filtered) {
  const list = document.getElementById('contactsList');
  const items = filtered || contactsData;

  if (items.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;color:var(--color-text-tertiary);padding:var(--space-8);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="margin-bottom:var(--space-4);opacity:0.5;">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
        <p>No contacts yet</p>
        <p style="font-size:var(--text-sm);margin-top:var(--space-2);">Add your first contact to get started</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map(c => {
    const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || c.phone.slice(-2);
    const groupsHtml = (c.groups || []).map(g => `<span class="contact-item__group-tag">${escapeHtml(g)}</span>`).join('');
    return `
      <div class="contact-item">
        <div class="contact-item__avatar">${initials}</div>            <div class="contact-item__info" onclick="quickSelectContact('${escapeHtml(c.phone).replace(/'/g, "\\'")}')">
          <div class="contact-item__name">${escapeHtml(c.name)}</div>
          <div class="contact-item__phone">${escapeHtml(c.phone)}</div>
          ${groupsHtml ? `<div class="contact-item__groups">${groupsHtml}</div>` : ''}
        </div>
        <div class="contact-item__actions">
          <button class="contact-item__action-btn contact-item__action-btn--chat" onclick="quickSelectContact('${escapeHtml(c.phone).replace(/'/g, "\\'")}')" title="Start Chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </button>
          <button class="contact-item__action-btn" onclick="openEditContact('${escapeHtml(c.id)}')" title="Edit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="contact-item__action-btn contact-item__action-btn--delete" onclick="deleteContact('${escapeHtml(c.id)}')" title="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/** Filter contacts by search query. */
function filterContacts(query) {
  const lower = query.toLowerCase();
  if (!lower) {
    renderContacts(contactsData);
    return;
  }
  const filtered = contactsData.filter(c =>
    c.name.toLowerCase().includes(lower) ||
    c.phone.includes(lower) ||
    (c.groups || []).some(g => g.toLowerCase().includes(lower))
  );
  renderContacts(filtered);
}

/** Open the contact form to add a new contact. */
function openAddContact() {
  editingContactId = null;
  contactGroupTags = [];
  document.getElementById('contactFormTitle').textContent = 'Add Contact';
  document.getElementById('contactNameInput').value = '';
  document.getElementById('contactPhoneInput').value = '';
  document.getElementById('contactGroupInput').value = '';
  renderContactGroupTags();
  document.getElementById('contactForm').classList.remove('hidden');
  document.getElementById('contactNameInput').focus();
}

/** Open the contact form to edit an existing contact. */
function openEditContact(id) {
  const contact = contactsData.find(c => c.id === id);
  if (!contact) return;
  editingContactId = id;
  contactGroupTags = [...(contact.groups || [])];
  document.getElementById('contactFormTitle').textContent = 'Edit Contact';
  document.getElementById('contactNameInput').value = contact.name;
  document.getElementById('contactPhoneInput').value = contact.phone;
  document.getElementById('contactGroupInput').value = '';
  renderContactGroupTags();
  document.getElementById('contactForm').classList.remove('hidden');
  document.getElementById('contactNameInput').focus();
}

/** Cancel and hide the contact form. */
function cancelContactForm() {
  editingContactId = null;
  contactGroupTags = [];
  document.getElementById('contactForm').classList.add('hidden');
}

/** Save the contact from the form (create or update). */
async function saveContactForm() {
  const name = document.getElementById('contactNameInput').value.trim();
  const phone = document.getElementById('contactPhoneInput').value.trim();

  if (!name || !phone) {
    Toast.warning('Missing Fields', 'Please enter both name and phone number');
    return;
  }

  const id = editingContactId || generateMessageId();
  const method = editingContactId ? 'PUT' : 'POST';

  try {
    const res = await fetch('/api/contacts', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, phone, groups: contactGroupTags }),
    });

    if (res.ok) {
      Toast.success(editingContactId ? 'Contact Updated' : 'Contact Added', `${name} saved`);
      cancelContactForm();
      loadContacts();
    } else {
      Toast.error('Error', 'Could not save contact');
    }
  } catch (e) {
    Toast.error('Error', 'Server unreachable');
  }
}

/** Delete a contact by ID. */
async function deleteContact(id) {
  const contact = contactsData.find(c => c.id === id);
  if (!contact) return;
  if (!confirm(`Delete contact "${contact.name}"?`)) return;

  try {
    const res = await fetch(`/api/contacts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      Toast.success('Contact Deleted', `${contact.name} removed`);
      loadContacts();
    }
  } catch (e) {
    Toast.error('Error', 'Could not delete contact');
  }
}

/** Add a group tag to the new contact form. */
function addContactGroupTag() {
  const input = document.getElementById('contactGroupInput');
  const tag = input.value.trim();
  if (!tag) return;
  if (contactGroupTags.includes(tag)) {
    Toast.info('Already Added', 'This tag already exists');
    input.value = '';
    return;
  }
  contactGroupTags.push(tag);
  renderContactGroupTags();
  input.value = '';
  input.focus();
}

/** Remove a group tag from the form. */
function removeContactGroupTag(index) {
  contactGroupTags.splice(index, 1);
  renderContactGroupTags();
}

/** Render group tags in the contact form. */
function renderContactGroupTags() {
  const container = document.getElementById('contactGroupsList');
  if (contactGroupTags.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = contactGroupTags.map((tag, i) => `
    <span class="contact-form__group-tag">
      ${escapeHtml(tag)}
      <button onclick="removeContactGroupTag(${i})">&times;</button>
    </span>
  `).join('');
}

/** Handle Enter key in group tag input. */
function handleContactGroupKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addContactGroupTag();
  }
}

/** Export all contacts as a CSV file download. */
async function exportContacts() {
  try {
    const res = await fetch('/api/contacts/export');
    if (!res.ok) {
      Toast.error('Export Failed', 'Could not fetch contacts');
      return;
    }
    const csv = await res.text();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.success('Exported', 'Contacts exported as CSV');
  } catch (e) {
    Toast.error('Export Failed', 'Server unreachable');
  }
}

/** Export all contacts as a vCard (.vcf) file download. */
async function exportContactsVCF() {
  try {
    const res = await fetch('/api/contacts/export/vcf');
    if (!res.ok) {
      Toast.error('Export Failed', 'Could not fetch contacts');
      return;
    }
    const vcf = await res.text();
    const blob = new Blob([vcf], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.vcf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.success('Exported', 'Contacts exported as vCard');
  } catch (e) {
    Toast.error('Export Failed', 'Server unreachable');
  }
}

/** Import contacts from a CSV file. */
async function importContacts(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const csv = e.target.result;

    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });

      if (!res.ok) {
        const err = await res.json();
        Toast.error('Import Failed', err.error || 'Could not import contacts');
        return;
      }

      const result = await res.json();
      Toast.success('Imported', `${result.imported} contact(s) imported${result.skipped ? `, ${result.skipped} skipped` : ''}`);
      input.value = '';
      loadContacts();
    } catch (e) {
      Toast.error('Import Failed', 'Server unreachable');
    }
  };
  reader.readAsText(file);
}

/** Quick-select a contact: start a chat with them immediately. */
function quickSelectContact(phone) {
  closeContacts();

  // Check if chat already exists
  const existing = state.history.find(m => m.phone === phone);
  if (existing) {
    selectChatFromList(phone);
    return;
  }

  // Create a new chat entry
  const msgId = generateMessageId();
  state.history.push({
    phone,
    text: 'Chat started',
    type: 'sent',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    rawTime: new Date().toISOString(),
    status: 'success',
    id: msgId,
    isGroup: false,
  });

  Storage.saveHistory(state.history);
  selectChatFromList(phone);
}

// Message polling function - defined at top level
function startMessagePolling() {
  if (state.messagePollingInterval) {
    clearInterval(state.messagePollingInterval);
  }
  state.messagePollingInterval = setInterval(async () => {
    if (!state.url || !state.connected) return;
    try {
      const msgs = await API.fetchReceivedMessages();
      if (msgs.length > 0) {
        const existingIds = new Set(state.history.map(h => h.id));
        const newMsgs = msgs.filter(m => !existingIds.has(m.id));
        if (newMsgs.length > 0) {
          const newHistory = [...state.history, ...newMsgs].slice(-MAX_HISTORY_ITEMS);
          state.history = newHistory;
          newMsgs.forEach(() => incrementStat('received'));

          // Track unread counts: increment for conversations not currently active
          newMsgs.forEach(m => {
            if (m.phone !== state.activeChat) {
              if (!unreadCounts[m.phone]) unreadCounts[m.phone] = 0;
              unreadCounts[m.phone]++;
              totalUnread++;
              // Desktop notification for background messages
              const isGroup = m.phone && m.phone.startsWith('GROUP_');
              const groupMeta = isGroup ? getGroupMeta(m.phone) : null;
              const displayName = isGroup ? (groupMeta?.groupName || m.groupName || m.phone) : m.phone;
              showDesktopNotification(m.phone, m.text, displayName);
            }
          });
          if (totalUnread > 0) updatePageTitle();

          Storage.saveHistory(newHistory);
          updateChatList();
          if (state.activeChat) renderMessages();
        }
      }
    } catch (e) {
      console.debug('Message polling error:', e.message);
      // Polling failure may indicate connection lost — trigger reconnect
      if (state.connected) {
        onConnectionLost();
      }
    }
  }, 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
  const hideLoading = () => {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('loading-overlay--hidden');
    }
  };

  try {
    Toast.init();

    // Hydrate cache from server-side SQLite (falls back to localStorage)
    await Storage.init();

    loadSaved();
    loadStats();
    loadTemplates();
    loadTheme();

    // Request notification permission (will be stored by browser)
    requestNotificationPermission();

    // Auto-connect: Try local first, then fallback to remote
    if (state.url && state.url !== 'remote-api') {
      // Try local connection
      const localResult = await API.testConnection(state.url, state.username, state.password);
      if (localResult.success) {
        state.connected = true;
        startMessagePolling();
        updateConnectionStatus();
      } else {
        // Local failed, try remote API
        console.log('Local gateway unreachable, trying remote API...');
        const remoteResult = await API.testRemoteConnection();
        if (remoteResult.success && remoteResult.isRemote) {
          API.useRemote = true;
          state.url = 'remote-api';
          state.connected = true;
          startMessagePolling();
          updateConnectionStatus();
          Toast.info('Using Remote API', 'Local gateway unavailable, connected to remote');
        } else {
          // Both failed — start reconnect loop
          console.log('Auto-connect failed, starting reconnect loop...');
          updateConnectionStatus();
          startReconnectLoop();
        }
      }
    } else if (state.url === 'remote-api') {
      // Previously connected to remote
      const remoteResult = await API.testRemoteConnection();
      if (remoteResult.success && remoteResult.isRemote) {
        API.useRemote = true;
        state.connected = true;
        startMessagePolling();
        updateConnectionStatus();
      } else {
        // Remote failed — start reconnect loop
        console.log('Remote auto-connect failed, starting reconnect loop...');
        updateConnectionStatus();
        startReconnectLoop();
      }
    }
  } catch (error) {
    console.error('Initialization error:', error);
    Toast.error('Error', 'Failed to initialize app');
  } finally {
    // Always hide loading overlay
    setTimeout(hideLoading, 300);
  }

  document.addEventListener('click', (e) => {
    // Close regular dropdowns
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown--open').forEach(d => d.classList.remove('dropdown--open'));
    }
    // Close template dropdown specifically
    const templateDropdown = document.getElementById('templateDropdown');
    if (templateDropdown && !e.target.closest('#templateDropdown') && !e.target.closest('[onclick*="toggleTemplateDropdown"]')) {
      templateDropdown.classList.remove('dropdown--open');
      templateDropdown.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop--open').forEach(modal => {
        modal.classList.remove('modal-backdrop--open');
      });
      state.focusTrap?.();
    }
  });
});
