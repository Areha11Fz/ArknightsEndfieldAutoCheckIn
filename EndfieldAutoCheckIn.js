/**
 * ARKNIGHTS: ENDFIELD DAILY ATTENDANCE (Google Apps Script)
 * With Discord Notification & Auto-Scheduler
 */

// ==========================================
// 1. SETUP & CONFIGURATION
// ==========================================

// Get this from: DevTools > Application > Cookies > .skport.com > ACCOUNT_TOKEN
const ACCOUNT_TOKEN = decodeURIComponent("YOUR_ACCOUNT_TOKEN_HERE");

// (Optional) Paste Discord Webhook URL. Leave empty "" to disable.
const DISCORD_WEBHOOK_URL = "";


// ==========================================
// 2. TRIGGER SETUP (Run this function once)
// ==========================================

/**
 * Run this function ONCE to set up the daily automated schedule.
 * It sets the script to run at 3 AM UTC+7 (Asia/Jakarta).
 */
function setupDailyTrigger() {
    const functionName = "main";

    // 1. Delete existing triggers for 'main' to avoid duplicates
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(triggers[i]);
        }
    }

    // 2. Create a new trigger for 3:00 AM Asia/Jakarta (UTC+7)
    ScriptApp.newTrigger(functionName)
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .inTimezone("Asia/Jakarta")
        .create();

    Logger.log(`✅ Trigger set! The '${functionName}' function will run daily between 3 AM and 4 AM (UTC+7).`);
}


// ==========================================
// 3. MAIN LOGIC
// ==========================================

const CONSTANTS = {
    APP_CODE: "6eb76d4e13aa36e6",
    PLATFORM: "3",
    VNAME: "1.0.0",
    ENDFIELD_GAME_ID: "3",
    URLS: {
        GRANT: "https://as.gryphline.com/user/oauth2/v2/grant",
        GENERATE_CRED: "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code",
        REFRESH_TOKEN: "https://zonai.skport.com/web/v1/auth/refresh",
        BINDING: "https://zonai.skport.com/api/v1/game/player/binding",
        ATTENDANCE: "https://zonai.skport.com/web/v1/game/endfield/attendance"
    }
};

function main() {
    try {
        performCheckIn();
    } catch (e) {
        Logger.log("CRITICAL ERROR: " + e.toString());
        sendDiscordWebhook("Script Error", e.toString(), 15548997); // Red color
    }
}

function performCheckIn() {
    Logger.log("Starting Endfield Check-in...");

    // 1. Auth Flow
    const oauthCode = getOAuthCode(ACCOUNT_TOKEN);
    if (!oauthCode) throw new Error("Failed to get OAuth Code (Check ACCOUNT_TOKEN)");

    const cred = getCred(oauthCode);
    if (!cred) throw new Error("Failed to get Credential");

    const signToken = getSignToken(cred);
    if (!signToken) throw new Error("Failed to get Sign Token");

    const gameRole = getPlayerBinding(cred, signToken);

    // 2. Attendance Request
    const response = sendAttendanceRequest(cred, signToken, gameRole);
    Logger.log("API Response: " + JSON.stringify(response));

    // 3. Process Result & Notify
    handleResponse(response);
}

// --- RESULT HANDLER ---

function handleResponse(json) {
    const code = json.code;
    const msg = json.message || "";

    // Success (Code 0)
    if (code === 0) {
        const rewards = parseRewards(json.data);
        const dayCount = json.data.signInCount || "?";

        const desc = `**Status:** Signed in successfully!\n**Days Signed:** ${dayCount}\n**Rewards:** ${rewards}`;
        Logger.log("Success: " + rewards);
        sendDiscordWebhook("Endfield Attendance Success", desc, 5763719); // Green
    }
    // Already Signed In
    else if (code === 1001 || code === 10001 || msg.toLowerCase().includes("already")) {
        Logger.log("Already signed in today.");
        sendDiscordWebhook("Endfield Attendance Info", "You have already signed in today.", 16776960); // Yellow
    }
    // Token Expired / Error
    else if (code === 10002) {
        Logger.log("Token Expired.");
        sendDiscordWebhook("Endfield Login Failed", "Account Token is expired. Please update the script.", 15548997); // Red
    }
    // Unknown Error
    else {
        Logger.log("Unknown API Error: " + msg);
        sendDiscordWebhook("Endfield Attendance Error", `API Code: ${code}\nMessage: ${msg}`, 15548997); // Red
    }
}

// --- DISCORD WEBHOOK ---

function sendDiscordWebhook(title, description, color) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.trim() === "") return;

    const payload = {
        username: "Endfield Assistant",
        avatar_url: "https://web.hycdn.cn/endfield/official/icon/logo.png",
        embeds: [{
            title: title,
            description: description,
            color: color,
            timestamp: new Date().toISOString(),
            footer: { text: "Google Apps Script Automation" }
        }]
    };

    const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    try {
        UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
    } catch (e) {
        Logger.log("Failed to send Discord webhook: " + e.toString());
    }
}

// --- HELPERS ---

function parseRewards(data) {
    if (!data) return "Unknown";
    if (data.reward) return `${data.reward.name} x${data.reward.count}`;
    if (data.awardIds && data.resourceInfoMap) {
        let list = [];
        for (let i = 0; i < data.awardIds.length; i++) {
            const id = data.awardIds[i].id;
            if (data.resourceInfoMap[id]) {
                const item = data.resourceInfoMap[id];
                list.push(`${item.name} x${item.count}`);
            }
        }
        return list.join(", ");
    }
    return "No rewards data found";
}

// --- API STEPS ---

function getOAuthCode(token) {
    const payload = { token: token, appCode: CONSTANTS.APP_CODE, type: 0 };
    const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(CONSTANTS.URLS.GRANT, options);
    const json = JSON.parse(response.getContentText());
    return (json.status === 0 && json.data && json.data.code) ? json.data.code : null;
}

function getCred(oauthCode) {
    const payload = { kind: 1, code: oauthCode };
    const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(CONSTANTS.URLS.GENERATE_CRED, options);
    const json = JSON.parse(response.getContentText());
    return (json.code === 0 && json.data && json.data.cred) ? json.data.cred : null;
}

function getSignToken(cred) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = { "cred": cred, "platform": CONSTANTS.PLATFORM, "vname": CONSTANTS.VNAME, "timestamp": timestamp, "sk-language": "en" };
    const options = { method: 'get', headers: headers, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(CONSTANTS.URLS.REFRESH_TOKEN, options);
    const json = JSON.parse(response.getContentText());
    return (json.code === 0 && json.data && json.data.token) ? json.data.token : null;
}

function getPlayerBinding(cred, signToken) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/api/v1/game/player/binding";
    const signature = computeSign(path, "", timestamp, signToken);
    const headers = { "cred": cred, "platform": CONSTANTS.PLATFORM, "vname": CONSTANTS.VNAME, "timestamp": timestamp, "sk-language": "en", "sign": signature };
    const options = { method: 'get', headers: headers, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(CONSTANTS.URLS.BINDING, options);
    const json = JSON.parse(response.getContentText());

    if (json.code === 0 && json.data && json.data.list) {
        const apps = json.data.list;
        for (let i = 0; i < apps.length; i++) {
            if (apps[i].appCode === "endfield" && apps[i].bindingList) {
                const binding = apps[i].bindingList[0];
                const role = binding.defaultRole || (binding.roles && binding.roles[0]);
                if (role) return `${CONSTANTS.ENDFIELD_GAME_ID}_${role.roleId}_${role.serverId}`;
            }
        }
    }
    return null;
}

function sendAttendanceRequest(cred, signToken, gameRole) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/web/v1/game/endfield/attendance";
    const signature = computeSign(path, "", timestamp, signToken);
    const headers = {
        "cred": cred, "platform": CONSTANTS.PLATFORM, "vname": CONSTANTS.VNAME, "timestamp": timestamp,
        "sk-language": "en", "sign": signature, "Content-Type": "application/json"
    };
    if (gameRole) headers["sk-game-role"] = gameRole;
    const options = { method: 'post', headers: headers, muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(CONSTANTS.URLS.ATTENDANCE, options);
    return JSON.parse(response.getContentText());
}

// --- CRYPTO LOGIC ---

function computeSign(path, body, timestamp, signToken) {
    const headerObj = { "platform": CONSTANTS.PLATFORM, "timestamp": timestamp, "dId": "", "vName": CONSTANTS.VNAME };
    const headersJson = JSON.stringify(headerObj);
    const signString = path + body + timestamp + headersJson;
    const hmacBytes = Utilities.computeHmacSha256Signature(signString, signToken);
    const hmacHex = bytesToHex(hmacBytes);
    const md5Bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex, Utilities.Charset.UTF_8);
    return bytesToHex(md5Bytes);
}

function bytesToHex(bytes) {
    return bytes.map(function (byte) { return ('0' + (byte & 0xFF).toString(16)).slice(-2); }).join('');
}