const sessionId = 'amma_bangalore_' + Math.floor(1000 + Math.random() * 9000);

const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const liveStatusText = document.getElementById('liveStatusText');
const bannerStatusText = document.getElementById('bannerStatusText');

// Cart DOM elements
const cartCountBadge = document.getElementById('cartCountBadge');
const cartItemsList = document.getElementById('cartItemsList');
const cartSubtotal = document.getElementById('cartSubtotal');
const cartDiscount = document.getElementById('cartDiscount');
const discountRow = document.getElementById('discountRow');
const cartDeliveryFee = document.getElementById('cartDeliveryFee');
const cartHandlingFee = document.getElementById('cartHandlingFee');
const cartGrandTotal = document.getElementById('cartGrandTotal');
const deliveryAddressText = document.getElementById('deliveryAddressText');

// MCP Tool DOM elements
const toolLogsContainer = document.getElementById('toolLogsContainer');

// Meta Modal DOM elements
const metaSetupBtn = document.getElementById('metaSetupBtn');
const metaSetupModal = document.getElementById('metaSetupModal');
const closeMetaModalBtn = document.getElementById('closeMetaModalBtn');
const testRecipientPhone = document.getElementById('testRecipientPhone');
const sendTestMsgBtn = document.getElementById('sendTestMsgBtn');
const testSendStatus = document.getElementById('testSendStatus');

// MCP Modal DOM elements
const mcpConfigBtn = document.getElementById('mcpConfigBtn');
const mcpConfigModal = document.getElementById('mcpConfigModal');
const closeMcpModalBtn = document.getElementById('closeMcpModalBtn');

// Payment Modal DOM elements
const qrModal = document.getElementById('qrModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const qrImage = document.getElementById('qrImage');
const modalAmountText = document.getElementById('modalAmountText');
const gpayDirectBtn = document.getElementById('gpayDirectBtn');
const phonepeDirectBtn = document.getElementById('phonepeDirectBtn');
const whatsappPayDirectBtn = document.getElementById('whatsappPayDirectBtn');

// Quick prompt pills
document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    const text = pill.getAttribute('data-msg');
    messageInput.value = text;
    chatForm.dispatchEvent(new Event('submit'));
  });
});

// Format timestamp
function getCurrentTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Convert markdown bold and lines to HTML
function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Append message bubble to chat
function appendMessage(sender, text, orderDetails = null) {
  const row = document.createElement('div');
  row.className = `message-row ${sender === 'user' ? 'outgoing' : 'incoming'}`;

  let paymentWidgetHtml = '';
  if (orderDetails) {
    if (orderDetails.paymentMode === 'CASH_ON_DELIVERY') {
      paymentWidgetHtml = `
        <div class="wappay-card" style="border-color: #f59e0b; background: #fffbeb;">
          <div class="wappay-header" style="color: #b45309;">
            <span>💵 Cash on Delivery (COD) Selected</span>
            <strong>₹${orderDetails.cartSnapshot.grandTotal}</strong>
          </div>
          <p style="font-size:12px; color:#78350f;">
            No online payment needed now. Please keep <strong>₹${orderDetails.cartSnapshot.grandTotal}</strong> cash ready for rider <strong>${orderDetails.riderName}</strong>!
          </p>
        </div>
      `;
    } else if (orderDetails.upiDeepLink || orderDetails.paymentLinks) {
      const upiLink = orderDetails.upiDeepLink || orderDetails.paymentLinks?.upiUri;
      paymentWidgetHtml = `
        <div class="wappay-card">
          <div class="wappay-header">
            <span>🟢 WhatsApp Pay / UPI Request</span>
            <strong>₹${orderDetails.cartSnapshot.grandTotal}</strong>
          </div>
          <p style="font-size:12px; color:#475569;">
            Tap below to trigger WhatsApp Pay / UPI Intent on mobile:
          </p>
          <a href="${upiLink}" class="wappay-btn" target="_blank" style="display:block; text-align:center; text-decoration:none;">
            💳 Pay ₹${orderDetails.cartSnapshot.grandTotal} via WhatsApp Pay / UPI
          </a>
        </div>
      `;
    }
  }

  row.innerHTML = `
    <div class="message-bubble">
      <div class="message-content">
        ${formatMarkdown(text)}
        ${paymentWidgetHtml}
      </div>
      <div class="message-meta">
        <span class="timestamp">${getCurrentTime()}</span>
        ${
          sender === 'user'
            ? '<span class="status-ticks">✓✓</span>'
            : ''
        }
      </div>
    </div>
  `;

  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show typing indicator
function showTypingIndicator() {
  const existing = document.getElementById('typingIndicator');
  if (existing) existing.remove();

  const typing = document.createElement('div');
  typing.id = 'typingIndicator';
  typing.className = 'message-row incoming';
  typing.innerHTML = `
    <div class="message-bubble typing-bubble">
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(typing);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  const existing = document.getElementById('typingIndicator');
  if (existing) existing.remove();
}

// Update Cart View in Sidebar
function updateCartView(cart) {
  if (!cart) return;

  const count = cart.items ? cart.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  cartCountBadge.textContent = `${count} items`;

  if (!cart.items || cart.items.length === 0) {
    cartItemsList.innerHTML = `
      <div class="empty-cart-state">
        <p>Cart is currently empty.</p>
        <span>Ask Amma's assistant to add groceries!</span>
      </div>
    `;
    cartSubtotal.textContent = '₹0';
    if (discountRow) discountRow.style.display = 'none';
    cartDeliveryFee.textContent = 'FREE';
    cartHandlingFee.textContent = '₹0';
    cartGrandTotal.textContent = '₹0';
    return;
  }

  cartItemsList.innerHTML = cart.items
    .map(
      (item) => `
      <div class="cart-item-card">
        <img src="${item.product.imageUrl}" alt="${item.product.name}" class="item-img" />
        <div class="item-details">
          <div class="item-title">${item.product.name}</div>
          <div class="item-unit">${item.product.unit} • ₹${item.product.price}</div>
          <div class="item-subtotal">₹${item.product.price * item.quantity}</div>
        </div>
        <div class="item-qty-tag">Qty: ${item.quantity}</div>
      </div>
    `
    )
    .join('');

  cartSubtotal.textContent = `₹${cart.itemTotal}`;
  if (cart.discount && cart.discount > 0) {
    discountRow.style.display = 'flex';
    cartDiscount.textContent = `-₹${cart.discount}`;
  } else {
    discountRow.style.display = 'none';
  }

  cartDeliveryFee.textContent = cart.deliveryFee === 0 ? 'FREE' : `₹${cart.deliveryFee}`;
  cartHandlingFee.textContent = `₹${cart.handlingFee}`;
  cartGrandTotal.textContent = `₹${cart.grandTotal}`;
  if (cart.deliveryAddress) {
    deliveryAddressText.textContent = cart.deliveryAddress;
  }
}

// Add Tool Execution Trace
function addToolLog(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return;

  const noTools = toolLogsContainer.querySelector('.no-tools-state');
  if (noTools) noTools.remove();

  toolCalls.forEach((call) => {
    const card = document.createElement('div');
    card.className = 'tool-log-card';
    card.innerHTML = `
      <div class="tool-name">
        <span>⚡ ${call.toolName}</span>
        <span class="tool-time">${call.timestamp || getCurrentTime()}</span>
      </div>
      <div class="tool-args">args: ${JSON.stringify(call.args)}</div>
      <div class="tool-result">result: ${JSON.stringify(call.result).slice(0, 140)}...</div>
    `;
    toolLogsContainer.insertBefore(card, toolLogsContainer.firstChild);
  });
}

// Meta Modal Handlers
if (metaSetupBtn) {
  metaSetupBtn.addEventListener('click', () => {
    metaSetupModal.classList.remove('hidden');
  });
}
if (closeMetaModalBtn) {
  closeMetaModalBtn.addEventListener('click', () => {
    metaSetupModal.classList.add('hidden');
  });
}

// MCP Modal Handlers
if (mcpConfigBtn) {
  mcpConfigBtn.addEventListener('click', () => {
    mcpConfigModal.classList.remove('hidden');
  });
}
if (closeMcpModalBtn) {
  closeMcpModalBtn.addEventListener('click', () => {
    mcpConfigModal.classList.add('hidden');
  });
}

// Send Direct Test WhatsApp Message
if (sendTestMsgBtn) {
  sendTestMsgBtn.addEventListener('click', async () => {
    const phone = testRecipientPhone.value.trim();
    if (!phone) {
      testSendStatus.textContent = 'Please enter a valid phone number (e.g. 919876543210)';
      testSendStatus.style.color = '#ef4444';
      return;
    }

    testSendStatus.textContent = 'Sending test WhatsApp message...';
    testSendStatus.style.color = '#008069';

    try {
      const res = await fetch('/api/whatsapp/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          text: 'Namaskara Amma! 🙏 This is a test message from your Zepto Grocery Agent powered by Meta WhatsApp Cloud API & Gemini MCP.'
        })
      });
      const data = await res.json();
      if (data.status === 'SUCCESS') {
        testSendStatus.textContent = `✅ Message sent successfully to +${phone}!`;
        testSendStatus.style.color = '#16a34a';
      } else {
        testSendStatus.textContent = `⚠️ Error: ${JSON.stringify(data.error)}`;
        testSendStatus.style.color = '#ef4444';
      }
    } catch (e) {
      testSendStatus.textContent = `⚠️ Network error: ${e.message}`;
      testSendStatus.style.color = '#ef4444';
    }
  });
}

// Submit Chat Message
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  appendMessage('user', text);
  messageInput.value = '';
  messageInput.focus();

  showTypingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: text })
    });

    const data = await response.json();
    removeTypingIndicator();

    if (data.error) {
      appendMessage('agent', `⚠️ Error: ${data.error}`);
    } else {
      appendMessage('agent', data.reply, data.orderDetails);
      updateCartView(data.cart);
      addToolLog(data.toolCalls);
    }
  } catch (error) {
    removeTypingIndicator();
    appendMessage('agent', '⚠️ Network error communicating with Gemini Agent.');
  }
});

// Clear Chat & Reset Cart
clearChatBtn.addEventListener('click', async () => {
  if (confirm('Do you want to reset the cart and start fresh?')) {
    await fetch(`/api/cart/${sessionId}/clear`, { method: 'POST' });
    chatMessages.innerHTML = '';
    toolLogsContainer.innerHTML =
      '<div class="no-tools-state">Tool calls will appear here in real time.</div>';
    appendMessage(
      'agent',
      'ನಮಸ್ಕಾರ ಅಮ್ಮ! (Namaskara Amma!) 🙏\n\nCart reset. What would you like to order today from Zepto?'
    );
    updateCartView({ items: [], itemTotal: 0, deliveryFee: 0, handlingFee: 0, grandTotal: 0 });
  }
});

// Initial Cart Fetch
fetch(`/api/cart/${sessionId}`)
  .then((res) => res.json())
  .then((data) => updateCartView(data.cart))
  .catch(() => {});
