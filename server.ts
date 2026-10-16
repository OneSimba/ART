// Ministry of Health and Child Care (MOHCC)
// Automated Africa's Talking Telecommunications SMS Gateway Server
// Full-Stack Express Server with Vite Middleware in Development
// Direct SMS Dispatch to Econet, NetOne, and Telecel Mobile Subscribers

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CONFIG_FILE = path.resolve(__dirname, 'africastalking-config.json');

interface AfricaTalkingConfig {
  apiKey: string;
  username: string;
  senderId: string;
  environment: 'production' | 'sandbox';
  updatedAt?: string;
}

const DEFAULT_AT_USERNAME = 'simbamike';
const DEFAULT_AT_API_KEY = 'atsk_0d247d0472d1037042a55e0ef6c2bb75cc8aa3f9ed8f8c572c14c7485c5aa67314e6c7f9';
const DEFAULT_AT_SENDER_ID = 'AIART';

/**
 * Reads stored Africa's Talking configuration with fallback to environment variables
 */
function getStoredConfig(): AfricaTalkingConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (data && typeof data === 'object') {
        const username = (data.username || process.env.AFRICASTALKING_USERNAME || DEFAULT_AT_USERNAME).trim();
        const apiKey = (data.apiKey || process.env.AFRICASTALKING_API_KEY || DEFAULT_AT_API_KEY).trim();
        const senderId = (data.senderId !== undefined ? data.senderId : (process.env.AFRICASTALKING_SENDER_ID || DEFAULT_AT_SENDER_ID)).trim();
        return {
          apiKey,
          username,
          senderId,
          environment: data.environment || (username === 'sandbox' ? 'sandbox' : 'production'),
          updatedAt: data.updatedAt,
        };
      }
    }
  } catch (err) {
    console.error('Error reading africastalking-config.json:', err);
  }

  const envUsername = (process.env.AFRICASTALKING_USERNAME || DEFAULT_AT_USERNAME).trim();
  return {
    apiKey: (process.env.AFRICASTALKING_API_KEY || DEFAULT_AT_API_KEY).trim(),
    username: envUsername,
    senderId: (process.env.AFRICASTALKING_SENDER_ID || DEFAULT_AT_SENDER_ID).trim(),
    environment: envUsername.toLowerCase() === 'sandbox' ? 'sandbox' : 'production',
  };
}

/**
 * Saves Africa's Talking configuration persistently to disk
 */
function saveStoredConfig(config: Partial<AfricaTalkingConfig>): AfricaTalkingConfig {
  const current = getStoredConfig();
  const updated: AfricaTalkingConfig = {
    apiKey: config.apiKey !== undefined ? config.apiKey.trim() : current.apiKey,
    username: config.username !== undefined ? config.username.trim() : current.username,
    senderId: config.senderId !== undefined ? config.senderId.trim() : current.senderId,
    environment: config.environment || (config.username?.toLowerCase() === 'sandbox' ? 'sandbox' : 'production'),
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    console.log('[Africa\'s Talking] Configuration updated persistently.');
  } catch (err) {
    console.error('Error saving africastalking-config.json:', err);
  }

  return updated;
}

/**
 * Normalizes phone number into E.164 Zimbabwe format and identifies the Telco Operator
 */
export function parseZimbabweCarrier(phoneInput: string): {
  network: 'Econet' | 'NetOne' | 'Telecel' | 'International';
  operatorName: string;
  formattedNumber: string;
  isValid: boolean;
} {
  let cleaned = (phoneInput || '').replace(/[\s\-\(\)\.]/g, '');

  // Handle local formats e.g. 0771234567, 078..., 071..., 073...
  if (cleaned.startsWith('07')) {
    cleaned = '+263' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') && cleaned.length === 9) {
    cleaned = '+263' + cleaned;
  } else if (cleaned.startsWith('263')) {
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length > 5) {
    cleaned = '+263' + cleaned;
  }

  // Detect Zimbabwe telecom provider by national mobile prefix
  if (cleaned.startsWith('+26377') || cleaned.startsWith('+26378')) {
    return {
      network: 'Econet',
      operatorName: 'Econet Wireless Zimbabwe (65% Market Share)',
      formattedNumber: cleaned,
      isValid: cleaned.length === 13,
    };
  } else if (cleaned.startsWith('+26371')) {
    return {
      network: 'NetOne',
      operatorName: 'NetOne Cellular Zimbabwe (28% Market Share)',
      formattedNumber: cleaned,
      isValid: cleaned.length === 13,
    };
  } else if (cleaned.startsWith('+26373')) {
    return {
      network: 'Telecel',
      operatorName: 'Telecel Zimbabwe (7% Market Share)',
      formattedNumber: cleaned,
      isValid: cleaned.length === 13,
    };
  }

  return {
    network: 'International',
    operatorName: 'International / Other GSM Network',
    formattedNumber: cleaned,
    isValid: cleaned.length >= 10,
  };
}

/**
 * GET /api/sms/config
 * Retrieves the current gateway configuration with masked API key for security
 */
app.get('/api/sms/config', (req, res) => {
  const config = getStoredConfig();
  const hasApiKey = Boolean(config.apiKey && config.apiKey.length > 0);
  const maskedApiKey = hasApiKey
    ? `${config.apiKey.substring(0, 4)}••••••••${config.apiKey.substring(Math.max(0, config.apiKey.length - 4))}`
    : '';

  res.json({
    success: true,
    username: config.username,
    senderId: config.senderId,
    environment: config.environment,
    hasApiKey,
    maskedApiKey,
    isConfigured: hasApiKey && config.username !== '',
    updatedAt: config.updatedAt,
  });
});

/**
 * POST /api/sms/config
 * Saves administrator Africa's Talking API key, username, and sender ID
 */
app.post('/api/sms/config', (req, res) => {
  try {
    const { apiKey, username, senderId, environment } = req.body;

    if (username === undefined && apiKey === undefined && senderId === undefined) {
      return res.status(400).json({
        success: false,
        error: 'No configuration parameters provided to update.',
      });
    }

    const updated = saveStoredConfig({
      apiKey,
      username,
      senderId,
      environment,
    });

    const hasApiKey = Boolean(updated.apiKey && updated.apiKey.length > 0);
    const maskedApiKey = hasApiKey
      ? `${updated.apiKey.substring(0, 4)}••••••••${updated.apiKey.substring(Math.max(0, updated.apiKey.length - 4))}`
      : '';

    res.json({
      success: true,
      message: "Africa's Talking gateway configuration saved successfully.",
      config: {
        username: updated.username,
        senderId: updated.senderId,
        environment: updated.environment,
        hasApiKey,
        maskedApiKey,
        isConfigured: hasApiKey && updated.username !== '',
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to persist configuration.',
    });
  }
});

/**
 * POST /api/sms/validate-config
 * Tests credentials against Africa's Talking API by querying live account data/balance
 */
app.post('/api/sms/validate-config', async (req, res) => {
  try {
    const stored = getStoredConfig();
    const apiKey = (req.body.apiKey || stored.apiKey || '').trim();
    const username = (req.body.username || stored.username || 'sandbox').trim();
    const environment = req.body.environment || (username.toLowerCase() === 'sandbox' ? 'sandbox' : 'production');

    if (!apiKey) {
      return res.status(400).json({
        valid: false,
        error: 'API Key is required to validate Africa\'s Talking account.',
      });
    }

    if (!username) {
      return res.status(400).json({
        valid: false,
        error: 'Username is required to validate Africa\'s Talking account.',
      });
    }

    const isSandbox = environment === 'sandbox' || username.toLowerCase() === 'sandbox';
    const userEndpoint = isSandbox
      ? 'https://api.sandbox.africastalking.com/version1/user?username=sandbox'
      : `https://api.africastalking.com/version1/user?username=${encodeURIComponent(username)}`;

    console.log(`[Africa's Talking] Validating account credentials on ${userEndpoint}...`);

    const response = await fetch(userEndpoint, {
      method: 'GET',
      headers: {
        'apiKey': apiKey,
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    let responseData: any = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    if (!response.ok) {
      // If production returned 401, check if this API Key was issued in Sandbox environment
      if (!isSandbox && response.status === 401) {
        const sandboxEndpoint = 'https://api.sandbox.africastalking.com/version1/user?username=sandbox';
        console.log(`[Africa's Talking] Production auth failed. Checking Sandbox environment at ${sandboxEndpoint}...`);
        const sbResponse = await fetch(sandboxEndpoint, {
          method: 'GET',
          headers: {
            'apiKey': apiKey,
            'Accept': 'application/json',
          },
        });

        if (sbResponse.ok) {
          const sbData = await sbResponse.json();
          const balance = sbData?.UserData?.balance || 'Active Account';
          return res.json({
            valid: true,
            balance,
            username: 'sandbox',
            environment: 'sandbox',
            message: `Credentials verified successfully on Africa's Talking. Account balance: ${balance}`,
            rawData: sbData,
          });
        }
      }

      const errMsg = responseData.errorMessage || responseData.message || `HTTP ${response.status}: Authentication failed. Please check your Africa's Talking API Key and Username.`;
      return res.json({
        valid: false,
        statusCode: response.status,
        error: errMsg,
        isSandbox,
        username,
      });
    }

    const balance = responseData?.UserData?.balance || 'Active Account';

    return res.json({
      valid: true,
      balance,
      username,
      environment: isSandbox ? 'sandbox' : 'production',
      message: `Credentials verified successfully. Live balance: ${balance}`,
      rawData: responseData,
    });
  } catch (error: any) {
    console.error('[Africa\'s Talking] Validation error:', error);
    return res.status(500).json({
      valid: false,
      error: error.message || 'Network error communicating with Africa\'s Talking API.',
    });
  }
});

/**
 * POST /api/sms/send-live
 * Live SMS dispatch through Africa's Talking Telecom API to Econet, NetOne, and Telecel
 */
app.post('/api/sms/send-live', async (req, res) => {
  try {
    const {
      recipientPhone,
      messageBody,
      patientName = 'ART Patient',
      patientArt = 'SAK/MOHCC/GEN',
      reminderType = 'Defaulter-Urgent',
      apiKey: customApiKey,
      username: customUsername,
      senderId: customSenderId,
    } = req.body;

    if (!recipientPhone || !messageBody) {
      return res.status(400).json({
        success: false,
        error: 'Both recipientPhone and messageBody are mandatory.',
      });
    }

    const carrierInfo = parseZimbabweCarrier(recipientPhone);
    const storedConfig = getStoredConfig();

    const apiKey = (customApiKey || storedConfig.apiKey || process.env.AFRICASTALKING_API_KEY || '').trim();
    const username = (customUsername || storedConfig.username || process.env.AFRICASTALKING_USERNAME || 'sandbox').trim();
    const senderId = (customSenderId !== undefined ? customSenderId : (storedConfig.senderId || process.env.AFRICASTALKING_SENDER_ID || '')).trim();
    const envChoice = req.body.environment || storedConfig.environment || (username.toLowerCase() === 'sandbox' ? 'sandbox' : 'production');

    // If an API Key is available, dispatch live to the Africa's Talking Gateway
    if (apiKey && apiKey !== '') {
      const isSandbox = envChoice === 'sandbox' || username.toLowerCase() === 'sandbox';
      let effectiveEnvironment = isSandbox ? 'sandbox' : 'production';
      const endpoint = isSandbox
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';

      const postParams = new URLSearchParams();
      postParams.append('username', username);
      postParams.append('to', carrierInfo.formattedNumber);
      postParams.append('message', messageBody);

      if (senderId && !isSandbox) {
        postParams.append('from', senderId);
      }

      console.log(`[Africa's Talking] Dispatching to ${carrierInfo.formattedNumber} (${carrierInfo.network}) via ${endpoint}`);

      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'apiKey': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: postParams.toString(),
      });

      const responseText = await response.text();
      let responseData: any = {};
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText, errorMessage: responseText };
      }

      console.log(`[Africa's Talking] Response:`, JSON.stringify(responseData));

      // Check if authentication failed (e.g. sandbox API key used against production endpoint)
      const isAuthError =
        response.status === 401 ||
        (responseData.raw && typeof responseData.raw === 'string' && responseData.raw.toLowerCase().includes('authentication is invalid')) ||
        (responseData.errorMessage && typeof responseData.errorMessage === 'string' && responseData.errorMessage.toLowerCase().includes('authentication is invalid'));

      if (isAuthError && !isSandbox) {
        effectiveEnvironment = 'sandbox';
        console.warn(`[Africa's Talking] Production authentication failed. Retrying on Sandbox gateway with username "sandbox"...`);
        const sbEndpoint = 'https://api.sandbox.africastalking.com/version1/messaging';
        const sbParams = new URLSearchParams();
        sbParams.append('username', 'sandbox');
        sbParams.append('to', carrierInfo.formattedNumber);
        sbParams.append('message', messageBody);

        const sbResponse = await fetch(sbEndpoint, {
          method: 'POST',
          headers: {
            'apiKey': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: sbParams.toString(),
        });

        const sbText = await sbResponse.text();
        try {
          responseData = JSON.parse(sbText);
          console.log(`[Africa's Talking] Sandbox retry Response:`, JSON.stringify(responseData));
        } catch {
          responseData = { raw: sbText, errorMessage: sbText };
        }
      }

      // Check if dispatch failed because of an unregistered Sender ID (Status Code 402 or error message)
      const initialRecipients = responseData?.SMSMessageData?.Recipients || [];
      const hasSenderIdError =
        (initialRecipients[0] && initialRecipients[0].statusCode === 402) ||
        (responseData.errorMessage && responseData.errorMessage.toLowerCase().includes('sender')) ||
        (responseData?.SMSMessageData?.Message && responseData.SMSMessageData.Message.toLowerCase().includes('sender'));

      // If senderId was rejected by carrier, retry automatically without senderId (default shared route)
      if (hasSenderIdError && senderId) {
        console.warn(`[Africa's Talking] Sender ID "${senderId}" rejected or not whitelisted. Retrying with default shared route...`);
        const fallbackParams = new URLSearchParams();
        fallbackParams.append('username', username);
        fallbackParams.append('to', carrierInfo.formattedNumber);
        fallbackParams.append('message', messageBody);

        const retryResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'apiKey': apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: fallbackParams.toString(),
        });

        const retryText = await retryResponse.text();
        try {
          responseData = JSON.parse(retryText);
          console.log(`[Africa's Talking] Retry without senderId Response:`, JSON.stringify(responseData));
        } catch {
          responseData = { raw: retryText, errorMessage: retryText };
        }
      }

      const recipients = responseData?.SMSMessageData?.Recipients || [];
      const recipientResult = recipients[0] || {};
      const statusCode = recipientResult.statusCode;
      const statusText = recipientResult.status || (statusCode === 101 ? 'Success' : 'Submitted');
      const messageId = recipientResult.messageId || `ATXid_${Math.random().toString(36).substring(2, 12)}`;
      const cost = recipientResult.cost || 'USD 0.0150';

      const isDelivered = statusCode === 101 || statusText.toLowerCase() === 'success';
      const isSuccess = isDelivered || statusCode === 100 || statusCode === 102;

      let failureReason: string | undefined;
      const generalMessage = responseData?.SMSMessageData?.Message || responseData?.errorMessage || responseData?.message;

      if (!isSuccess) {
        if (statusCode === 404 || (generalMessage && generalMessage.toLowerCase().includes('balance'))) {
          failureReason = 'Insufficient balance on your Africa\'s Talking account. Please top up your account at africastalking.com.';
        } else if (statusCode === 402 || (generalMessage && generalMessage.toLowerCase().includes('sender'))) {
          failureReason = `Sender ID "${senderId}" is not whitelisted by Zimbabwe telecom operators. Please leave Sender ID blank to use Africa\'s Talking default route.`;
        } else if (statusCode === 403 || statusCode === 406) {
          failureReason = `Telecommunications routing error (${recipientResult.status || statusCode}). Please ensure destination phone ${carrierInfo.formattedNumber} is reachable on ${carrierInfo.network}.`;
        } else if (generalMessage) {
          failureReason = generalMessage;
        } else {
          failureReason = `Dispatch status: ${statusText} (code ${statusCode || 'unknown'}).`;
        }
      }

      return res.json({
        success: isSuccess,
        error: failureReason,
        mode: effectiveEnvironment === 'sandbox' ? 'AfricaTalking-Sandbox' : 'AfricaTalking-Production',
        isSandbox: effectiveEnvironment === 'sandbox',
        network: carrierInfo.network,
        operatorName: carrierInfo.operatorName,
        recipientPhone: carrierInfo.formattedNumber,
        patientName,
        patientArt,
        reminderType,
        messageBody,
        status: statusText,
        statusCode: statusCode || (isSuccess ? 101 : 400),
        atMessageId: messageId,
        cost,
        telcoGateway: `${carrierInfo.network} BTS SMS-Center (Zimbabwe Gateway)`,
        rawResponse: responseData,
        dispatchedAt: new Date().toISOString(),
        deliveryNotice: effectiveEnvironment === 'sandbox'
          ? "Africa's Talking Sandbox Environment Active: Your API key was verified under Africa's Talking Sandbox. Sandbox SMS messages are simulated in the Africa's Talking developer console and are NOT delivered to physical phone numbers. To receive real text messages on your actual phone (Econet, NetOne, or Telecel), create a Live App in your Africa's Talking dashboard, generate a Live API Key, and fund your account."
          : 'Transmitted to Zimbabwe cellular infrastructure. Delivery report registered.',
      });
    }

    // If API Key is not set, provide simulated telecommunications gateway delivery with instructions
    const mockMessageId = `ATXid_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
    return res.json({
      success: true,
      mode: 'AfricaTalking-Telecom-Simulation',
      network: carrierInfo.network,
      operatorName: carrierInfo.operatorName,
      recipientPhone: carrierInfo.formattedNumber,
      patientName,
      patientArt,
      reminderType,
      messageBody,
      status: 'Delivered',
      statusCode: 101,
      atMessageId: mockMessageId,
      cost: 'USD 0.0150',
      telcoGateway: `${carrierInfo.network} Short Message Service Center (SMSC Harare)`,
      dispatchedAt: new Date().toISOString(),
      notice:
        'To receive real-time SMS on your personal cellphone over Econet/NetOne/Telecel towers, enter your Africa\'s Talking API Key in the dedicated Settings module.',
    });
  } catch (error: any) {
    console.error(`[Africa's Talking] Dispatch failure:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal telecommunications gateway error',
    });
  }
});

/**
 * GET /api/sms/gateway-status
 * Inspects live status of Africa's Talking integration and carrier routing
 */
app.get('/api/sms/gateway-status', (req, res) => {
  const config = getStoredConfig();
  const hasApiKey = Boolean(config.apiKey && config.apiKey.trim() !== '');

  res.json({
    status: hasApiKey ? 'ACTIVE_CONFIGURED' : 'UNCONFIGURED',
    provider: "Africa's Talking Telecommunications Gateway",
    endpoint: config.environment === 'sandbox' || config.username.toLowerCase() === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging',
    hasApiKey,
    username: config.username,
    senderId: config.senderId || 'MOHCC (or default shared)',
    environment: config.environment,
    supportedNetworks: [
      { name: 'Econet Wireless Zimbabwe', prefixes: ['+26377', '+26378', '077', '078'], share: '65%' },
      { name: 'NetOne Cellular Zimbabwe', prefixes: ['+26371', '071'], share: '28%' },
      { name: 'Telecel Zimbabwe', prefixes: ['+26373', '073'], share: '7%' },
    ],
  });
});

/**
 * Initialize HTTP Application & Mount Vite Middleware in Development
 */
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MOHCC Server] ART Healthcare Gateway running on http://0.0.0.0:${PORT}`);
    console.log(`[Africa's Talking] Telecom SMS Gateway enabled on /api/sms/send-live`);
  });
}

startServer();
