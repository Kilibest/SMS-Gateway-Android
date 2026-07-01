const API = {
  // Use remote API domain - will work from any network
  PROXY_URL: 'http://localhost:3000/proxy',
  MESSAGES_URL: 'http://localhost:3000/messages',
  // Remote API URL (user must provide credentials)
  REMOTE_API_URL: 'https://api.sms-gate.app/3rdparty/v1/message',
  REMOTE_CREDENTIALS: { username: '', password: '' }, // Set by user
  useRemote: false, // Will be true if local not available
    
normalizeUrl(url) {
    let normalized = url.replace(/\/$/, '');
    
    // Handle http:// with port 443 - should be https:// without port
    if (normalized.startsWith('http://') && normalized.includes(':443')) {
      normalized = normalized.replace('http://', 'https://').replace(':443', '');
    }
    
    // Handle https:// with :443 port - remove the port
    if (normalized.startsWith('https://') && normalized.endsWith(':443')) {
      normalized = normalized.slice(0, -4);
    }
    
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      // Check if port 443 is specified - use https and remove the port
      if (normalized.endsWith(':443')) {
        normalized = 'https://' + normalized.slice(0, -4);
      } else {
        normalized = 'http://' + normalized;
      }
    }
    return normalized;
  },
    
    getAuthHeader(username, password) {
        return 'Basic ' + btoa(`${username}:${password}`);
    },
    
async testRemoteConnection() {
    try {
      const testData = JSON.stringify({ 
        textMessage: { text: "test" }, 
        phoneNumbers: ["+0000000000"] 
      });
      
      const response = await fetch(
        `${this.PROXY_URL}?url=${encodeURIComponent(this.REMOTE_API_URL)}`,
        {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Authorization': this.getAuthHeader(this.REMOTE_CREDENTIALS.username, this.REMOTE_CREDENTIALS.password),
            'Content-Type': 'application/json'
          },
          body: testData
        }
      );
      
      const responseText = await response.text();
      
      if (response.ok || (response.status === 400 && responseText.includes('country code'))) {
        this.useRemote = true;
        return { success: true, isRemote: true };
      }
      
      return { success: false, error: 'Remote API unreachable' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
    
  async testConnection(baseUrl, username, password) {
    try {
      const normalized = this.normalizeUrl(baseUrl);
      // Local API uses /messages, Cloud API uses /3rdparty/v1/message
      const endpoint = normalized.includes('api.sms-gate.app') 
        ? `${normalized}/3rdparty/v1/message`
        : `${normalized}/messages`;
      const testData = JSON.stringify({ 
        textMessage: { text: "test" }, 
        phoneNumbers: ["+0000000000"] 
      });
      
      const response = await fetch(
        `${this.PROXY_URL}?url=${encodeURIComponent(endpoint)}`,
        {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Authorization': this.getAuthHeader(username, password),
          'Content-Type': 'application/json'
        },
        body: testData
      }
    );
            const responseText = await response.text();
            
            if (response.ok) {
                return { success: true };
            } else if (response.status === 401) {
                return { success: false, error: 'Authentication Failed: Wrong username or password' };
            } else if (
                response.status === 400 &&
                ![
                    'Missing url parameter',
                    'Missing data parameter',
                    'Invalid URL'
                ].includes(responseText.trim())
            ) {
                // The gateway is reachable and authenticated, but the dummy test payload
                // can still be rejected as an invalid SMS request.
                return { success: true };
} else if (response.status === 403) {
      return { success: false, error: 'Connection blocked by the local proxy security rules.' };
    } else if (response.status === 504) {
      return { success: false, error: 'Cannot reach Android device. Check: 1) Same WiFi network, 2) App is running, 3) IP address is correct' };
    } else if (response.status === 404) {
      return { success: false, error: 'Android device not found (404). Check: 1) IP address is correct, 2) Port 8080 is open, 3) SMS Gateway app is running' };
    } else {
      return { success: false, error: `Gateway responded with HTTP ${response.status}` };
    }
} catch (error) {
    console.error('Connection error:', error.name, error.message);
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return { success: false, error: 'Cannot connect to proxy at localhost:3000. Is it running?' };
    }
    return { success: false, error: 'Unable to reach the local proxy or gateway: ' + error.message };
  }
    },
    
async sendMessage(phoneNumbers, text, customCredentials = null) {
    const creds = customCredentials || this.REMOTE_CREDENTIALS;
    // Remote uses cloud API, local uses /messages endpoint
    const normalizedUrl = this.useRemote ? this.REMOTE_API_URL : this.normalizeUrl(state.url);
    const endpoint = this.useRemote 
      ? normalizedUrl 
      : `${normalizedUrl}/messages`;
    const smsData = JSON.stringify({
      textMessage: { text: text },
      phoneNumbers: phoneNumbers
    });

    const targetUrl = `${this.PROXY_URL}?url=${encodeURIComponent(endpoint)}`;
    
    const response = await fetch(targetUrl, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Authorization': this.getAuthHeader(this.useRemote ? creds.username : state.username, this.useRemote ? creds.password : state.password),
        'Content-Type': 'application/json'
      },
      body: smsData
    });

    return response.ok;
  },
    
  // Legacy function for local Android gateway
  async sendMessageLocal(baseUrl, username, password, phoneNumbers, text) {
    const normalized = this.normalizeUrl(baseUrl);
    // Local API uses /messages, Cloud API uses /3rdparty/v1/message
    const endpoint = baseUrl.includes('api.sms-gate.app')
      ? `${normalized}/3rdparty/v1/message`
      : `${normalized}/messages`;
    const smsData = JSON.stringify({
      textMessage: { text: text },
      phoneNumbers: phoneNumbers
    });

    const response = await fetch(
      `${this.PROXY_URL}?url=${encodeURIComponent(endpoint)}`,
      {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Authorization': this.getAuthHeader(username, password),
          'Content-Type': 'application/json'
        },
        body: smsData
      }
    );

    return response.ok;
  },
    
    async fetchReceivedMessages() {
        try {
            const response = await fetch(this.MESSAGES_URL);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {}
        return [];
    }
};
