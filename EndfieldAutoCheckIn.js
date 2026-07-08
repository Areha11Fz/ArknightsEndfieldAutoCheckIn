/**
 * ARKNIGHTS: ENDFIELD DAILY ATTENDANCE (Google Apps Script)
 * With Discord Notification & Auto-Scheduler
 */

// ==========================================
// 1. CONFIGURATION
// ==========================================

const ACCOUNT_NAME = "My Account";
// Get this from: DevTools > Application > Cookies > .skport.com > ACCOUNT_TOKEN
const ACCOUNT_TOKEN = decodeURIComponent("YOUR_ACCOUNT_TOKEN_HERE");

// (Optional) Your sk-game-role. Leave empty "" to auto-detect.
const SK_GAME_ROLE = "";

// Paste Discord Webhook URL. Leave empty "" to disable.
const DISCORD_WEBHOOK_URL = "";

// Constants
const BASE_URL = "https://zonai.skport.com/web/v1";
const ATTENDANCE_ENDPOINT = "game/endfield/attendance";
const APP_CODE = "6eb76d4e13aa36e6";
const ENDFIELD_ICON = "https://play-lh.googleusercontent.com/IHJeGhqSpth4VzATp_afjsCnFRc-uYgGC1EV3b2tryjyZsVrbcaeN5L_m8VKwvOSpIu_Skc49mDpLsAzC6Jl3mM";

const COLORS = {
    SUCCESS: 0xFFD700,
    ALREADY: 0x3498DB,
    ERROR: 0xE74C3C
};

// ==========================================
// 2. TRIGGER SETUP (Run this function once)
// ==========================================

function setupDailyTrigger() {
    const functionName = "main";

    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === functionName) {
            ScriptApp.deleteTrigger(triggers[i]);
        }
    }

    ScriptApp.newTrigger(functionName)
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .inTimezone("Asia/Jakarta")
        .create();

    Logger.log(`Trigger set! The '${functionName}' function will run daily between 3 AM and 4 AM (UTC+7).`);
}

// ==========================================
// 3. MAIN LOGIC
// ==========================================

function main() {
    try {
        processAccount();
    } catch (e) {
        console.error(`Error: ${e.message}`);
        sendNotification("Sign-in Failed", e.message, COLORS.ERROR);
    }
}

function processAccount() {
    let cred = "";
    let salt = "";

    if (ACCOUNT_TOKEN) {
        console.log(`Refreshing OAuth credentials...`);
        const oauthResult = performOAuthFlow(ACCOUNT_TOKEN);
        cred = oauthResult.cred;
        salt = oauthResult.salt;
    }

    // Auto-detect SK_GAME_ROLE if it is left empty
    let skGameRole = SK_GAME_ROLE;
    if (!skGameRole) {
        console.log(`Auto-detecting game role identifier...`);
        skGameRole = fetchSkGameRole(cred, salt);
        if (!skGameRole) {
            throw new Error("Failed to auto-detect game role. Please manually configure SK_GAME_ROLE.");
        }
        console.log(`Detected game role: ${skGameRole}`);
    }

    if (!cred || !skGameRole) {
        throw new Error("Missing credentials (cred/token or skGameRole)");
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signPath = `/web/v1/${ATTENDANCE_ENDPOINT}`;

    const sign = salt ? generateSignV2(signPath, timestamp, salt) : generateSignV1(timestamp, cred);

    const headers = {
        "cred": cred,
        "sk-game-role": skGameRole,
        "platform": "3",
        "sk-language": "en",
        "timestamp": timestamp,
        "vname": "1.0.0",
        "sign": sign,
        "User-Agent": "Skport/0.7.0 (com.gryphline.skport; build:700089; Android 33; ) Okhttp/5.1.0",
        "Origin": "https://game.skport.com",
        "Referer": "https://game.skport.com/"
    };

    console.log(`Checking attendance status...`);
    const statusResponse = UrlFetchApp.fetch(`${BASE_URL}/${ATTENDANCE_ENDPOINT}`, {
        method: "get",
        headers: headers,
        muteHttpExceptions: true
    });

    const statusData = JSON.parse(statusResponse.getContentText());
    if (statusData.code !== 0) throw new Error(`Status check failed: ${statusData.message}`);

    if (statusData.data.hasToday) {
        console.log(`Already signed in today.`);
        sendNotification("Already Signed In", `**${ACCOUNT_NAME}** has already claimed today's rewards`, COLORS.ALREADY);
        return;
    }

    const claimSign = salt ? generateSignV2(signPath, timestamp, salt) : generateSignV1(timestamp, cred);
    headers["sign"] = claimSign;

    console.log(`Claiming daily reward...`);
    const claimResponse = UrlFetchApp.fetch(`${BASE_URL}/${ATTENDANCE_ENDPOINT}`, {
        method: "post",
        headers: headers,
        muteHttpExceptions: true
    });

    const claimData = JSON.parse(claimResponse.getContentText());
    if (claimData.code !== 0) throw new Error(`Claim failed: ${claimData.message}`);

    const rewardsText = claimData.data.awardIds.map(award => {
        const info = claimData.data.resourceInfoMap[award.id];
        return info ? `- **${info.name}** x${info.count}` : `- Reward ID: ${award.id}`;
    }).join("\n");

    const firstRewardIcon = claimData.data.awardIds[0]
        ? claimData.data.resourceInfoMap[claimData.data.awardIds[0].id]?.icon
        : null;

    sendNotification("Daily Sign-in Claimed", `Successfully claimed rewards for **${ACCOUNT_NAME}**\n\n${rewardsText}`, COLORS.SUCCESS, firstRewardIcon);
}

// ==========================================
// 4. OAUTH FLOW & ROLE RETRIEVAL
// ==========================================

function performOAuthFlow(accountToken) {
    const infoUrl = `https://as.gryphline.com/user/info/v1/basic?token=${encodeURIComponent(accountToken)}`;
    const infoRes = UrlFetchApp.fetch(infoUrl);
    const infoData = JSON.parse(infoRes.getContentText());
    if (infoData.status !== 0) throw new Error(`OAuth Step 1 Failed: ${infoData.msg}`);

    const grantRes = UrlFetchApp.fetch("https://as.gryphline.com/user/oauth2/v2/grant", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ token: accountToken, appCode: APP_CODE, type: 0 })
    });
    const grantData = JSON.parse(grantRes.getContentText());
    if (grantData.status !== 0 || !grantData.data?.code) throw new Error(`OAuth Step 2 Failed: ${grantData.msg}`);

    const credRes = UrlFetchApp.fetch(`${BASE_URL}/user/auth/generate_cred_by_code`, {
        method: "post",
        contentType: "application/json",
        headers: { "platform": "3" },
        payload: JSON.stringify({ code: grantData.data.code, kind: 1 })
    });
    const credData = JSON.parse(credRes.getContentText());
    if (credData.code !== 0 || !credData.data?.cred) throw new Error(`OAuth Step 3 Failed: ${credData.message}`);

    return {
        cred: credData.data.cred,
        salt: credData.data.token,
        userId: credData.data.userId
    };
}

function fetchSkGameRole(cred, salt) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = "/api/v1/game/player/binding";
    const signature = generateSignV2(path, timestamp, salt);

    const headers = {
        "cred": cred,
        "platform": "3",
        "sk-language": "en",
        "timestamp": timestamp,
        "vname": "1.0.0",
        "sign": signature,
        "User-Agent": "Skport/0.7.0 (com.gryphline.skport; build:700089; Android 33; ) Okhttp/5.1.0",
        "Origin": "https://game.skport.com",
        "Referer": "https://game.skport.com/"
    };

    const url = `https://zonai.skport.com${path}`;
    const response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: headers,
        muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    if (json.code !== 0) {
        console.warn(`Failed to fetch binding: ${json.message}`);
        return null;
    }

    if (json.data && json.data.list) {
        const apps = json.data.list;
        for (let i = 0; i < apps.length; i++) {
            if (apps[i].appCode === "endfield" && apps[i].bindingList) {
                const binding = apps[i].bindingList[0];
                const role = binding.defaultRole || (binding.roles && binding.roles[0]);
                if (role) {
                    return `3_${role.roleId}_${role.serverId}`;
                }
            }
        }
    }
    return null;
}

// ==========================================
// 5. CRYPTO
// ==========================================

function generateSignV1(timestamp, cred) {
    const input = `timestamp=${timestamp}&cred=${cred}`;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input);
    return toHex(digest);
}

function generateSignV2(path, timestamp, salt) {
    const platform = "3";
    const vName = "1.0.0";
    const headerJson = JSON.stringify({ platform, timestamp, dId: "", vName });
    const s = `${path}${timestamp}${headerJson}`;

    const hmacBytes = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, s, salt);
    const hmacHex = toHex(hmacBytes);

    const md5Bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, hmacHex);
    return toHex(md5Bytes);
}

function toHex(bytes) {
    return bytes.map(byte => {
        const b = (byte < 0) ? byte + 256 : byte;
        return ("0" + b.toString(16)).slice(-2);
    }).join("");
}

// ==========================================
// 6. DISCORD NOTIFICATION
// ==========================================

function sendNotification(title, description, color, thumbnail) {
    if (!DISCORD_WEBHOOK_URL) return;

    const payload = {
        embeds: [{
            title: title,
            description: description,
            color: color,
            thumbnail: { url: thumbnail || ENDFIELD_ICON },
            footer: { text: "SKPort Auto Check-In (GAS)", icon_url: ENDFIELD_ICON },
            timestamp: new Date().toISOString()
        }]
    };

    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    });
}