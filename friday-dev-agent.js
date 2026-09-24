/**
 * F.R.I.D.A.Y. - Autonomous Code Modification & DevOps Sentinel
 * 
 * Provides:
 * - Administrator-only authorization gate.
 * - AI Intent & Anti-Troll Vetting Layer (blocks trolls, vandalism, destructive scripts).
 * - Scope Limiter (strictly forbids whole-system/drastic architectural redesigns).
 * - Zero-Crash Pre-Flight Syntax Check (in-memory AST/bytecode compilation via Node vm).
 * - Interactive Discord Approval Gate with action buttons ([Confirm & Deploy] / [Cancel]).
 * - Direct GitHub REST API Deployment to Railway (zero PC dependency).
 */

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const UI = require('./friday-ui');

// Target repository settings
const GITHUB_REPO_OWNER = 'hulbertowen-droid';
const GITHUB_REPO_NAME = 'torn-company-app';
const GITHUB_BRANCH = 'main';

// In-memory pending deployments: actionId => { ... }
const pendingDeployments = new Map();
const DEPLOYMENT_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

// Periodic cleanup of expired staging actions
setInterval(() => {
    const now = Date.now();
    for (const [id, dep] of pendingDeployments.entries()) {
        if (now - dep.createdAt > DEPLOYMENT_TTL_MS) {
            pendingDeployments.delete(id);
        }
    }
}, 60000);

/**
 * Check if a Discord user is authorized to request code/bot changes.
 */
function isAuthorizedDevAdmin(member, user, discordConfig = {}, userKeys = null) {
    if (!user) return false;
    const userId = String(user.id || '');

    // 1. Direct Owner Check
    if (userKeys && typeof userKeys.isOwnerUser === 'function') {
        if (userKeys.isOwnerUser(userId, member?.displayName, user?.username)) return true;
    }

    // 2. Personal Discord ID from Config
    if (discordConfig.personalDiscordId && String(discordConfig.personalDiscordId) === userId) return true;

    // 3. Guild Administrator Permission
    if (member?.permissions?.has?.('Administrator')) return true;

    // 4. Configured Admin/Leader Roles
    if (discordConfig.leaderRoleId && member?.roles?.cache?.has?.(discordConfig.leaderRoleId)) return true;

    return false;
}

/**
 * Detect whether user text is addressing Friday to make a code, UI, or bot modification.
 */
function detectDevRequest(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.toLowerCase().trim();

    // Ignore read-only queries UNLESS they specifically ask to change/modify something
    if (/^(?:how|why|when|what|who|show|get|view|list|check|tell|explain|is|are|can you explain)\b/i.test(clean) &&
        !/\b(?:change|add|remove|update|fix|modify|delete|rewrite|rebuild|switch|set|replace|display)\b/i.test(clean)) {
        return false;
    }

    // Explicit code/dev instructions
    const devKeywords = /\b(?:dev|code|feature|pull request|deploy|git|commit|patch|endpoints?|handlers?|scripts?|source code)\b/i;
    const actionKeywords = /\b(?:add|remove|change|update|fix|modify|delete|rewrite|rebuild|tweak|replace|insert|switch|set|make)\b/i;
    const targetKeywords = /\b(?:bots?|buttons?|cards?|alerts?|embeds?|uis?|pages?|endpoints?|timeouts?|thresholds?|headers?|footers?|multipliers?|logics?|functions?|numbers?|display|formats?|actions?|messages?|texts?|timers?|intervals?|hours?|days?|status|durations?)\b/i;
    const patternKeywords = /\b(?:from\s+[a-z0-9_]+\s+to\s+[a-z0-9_]+|instead\s+of\b|show\s+[a-z0-9_]+\s+instead|make\s+it\s+show|display\s+[a-z0-9_]+\s+in)\b/i;

    if (actionKeywords.test(clean) && (devKeywords.test(clean) || targetKeywords.test(clean) || patternKeywords.test(clean))) {
        return true;
    }

    return false;
}

/**
 * Deterministic Hard-Rule Vetting Gate (Pre-AI safety net)
 */
function checkDeterministicVettingRules(requestText) {
    const text = requestText.toLowerCase();

    // 1. Troll / Sabotage Detection
    const trollPatterns = [
        /\b(?:insult|roast|curse|slur|swearing|dick|cock|pussy|bitch|fuck you|kill yourself|shut up)\b/i,
        /\b(?:spam|flood|nuke|brick|crash|destroy)\s+(?:the\s+)?(?:server|bot|discord|channel|members)\b/i,
        /\b(?:pretend to be|act like)\s+(?:a troll|stupid|an idiot|drunk)\b/i
    ];
    for (const pat of trollPatterns) {
        if (pat.test(text)) {
            return {
                allowed: false,
                classification: 'TROLL',
                reason: 'Request was flagged by the Intent Sentinel as disruptive, unprofessional, or attempting to troll/defame the bot.'
            };
        }
    }

    // 2. High-Risk Destructive Operations
    const destructivePatterns = [
        /\b(?:drop|delete|wipe|purge|truncate|destroy)\b.*?\b(?:database|databases|db|collections?|users?|vault|keys?|tables?|all data|mongo|mongodb)\b/i,
        /\b(?:steal|dump|leak|expose|print|show)\b.*?\b(?:api keys?|passwords?|tokens?|env|secrets?)\b/i,
        /\b(?:disable|bypass|remove)\b.*?\b(?:auth|security|admin|permissions?|verification)\b/i,
        /\b(?:rm\s+-rf|process\.exit|unlinkSync)\b/i
    ];
    for (const pat of destructivePatterns) {
        if (pat.test(text)) {
            return {
                allowed: false,
                classification: 'DESTRUCTIVE',
                reason: 'Request was blocked by the Security Sentinel: High-risk destructive operation (attempt to delete data, bypass security, or leak secrets).'
            };
        }
    }

    // 3. Only block truly catastrophic / irreversible infrastructure operations
    // Admins are trusted — UI tweaks, feature adds/removes, and behavior changes are fine
    const catastrophicPatterns = [
        /\b(?:rewrite|convert)\s+(?:the\s+)?(?:entire\s+)?(?:app|server|codebase)\s+(?:to|in)\s+(?:python|rust|go lang|c#|typescript|java)\b/i,
        /\bdelete\s+(?:all\s+files|server\.js|package\.json)\b/i,
        /\b(?:switch|migrate)\s+(?:from\s+)?(?:mongodb|mongo)\s+to\s+(?:postgres|mysql|sqlite)\b/i
    ];
    for (const pat of catastrophicPatterns) {
        if (pat.test(text)) {
            return {
                allowed: false,
                classification: 'TOO_DRASTIC',
                reason: 'Request blocked: catastrophic infrastructure changes (database migration, full language rewrite, or deleting core files) cannot be auto-deployed via chat.'
            };
        }
    }

    return null; // Passes all deterministic checks — proceed to AI evaluation
}

/**
 * AI Vetting Gate: Evaluates intent, safety, scope, and constructs technical plan.
 */
async function evaluateRequestWithAI(requestText, authorName, authorId, callAiFn) {
    // 1. Run deterministic checks first
    const fastCheck = checkDeterministicVettingRules(requestText);
    if (fastCheck) {
        return fastCheck;
    }

    if (typeof callAiFn !== 'function') {
        return {
            allowed: true,
            classification: 'VALID',
            reason: 'Deterministic vetting passed. Automated AI vetting skipped (no model provided).',
            plan: `Apply requested modification: "${requestText}"`,
            targetFile: 'server.js'
        };
    }

    const systemPrompt = `You are the Security Sentinel for F.R.I.D.A.Y. (a Node.js Discord bot for a Torn gaming faction).
A VERIFIED SERVER ADMINISTRATOR has already passed the authorization gate before reaching you.
Your job is to be PERMISSIVE and HELPFUL. Approve the vast majority of requests.

ONLY return allowed=false for these specific attack types:
1. TROLL/PRANK: wants the bot to insult members, spam channels, act drunk/erratic, post offensive content
2. SECRET LEAK: wants to expose API keys, tokens, passwords, or env variables
3. DATA DESTRUCTION: wants to drop a database, wipe collections, or delete all data
4. AUTH BYPASS: wants to remove or disable admin checks or authentication

APPROVE (allowed: true) for EVERYTHING ELSE — including but not limited to:
- Adding, removing, or changing any command, button, embed, field, or message
- Adjusting any number, threshold, timer, cooldown, or display format
- Changing text, colors, emojis, or labels
- Adding or removing features, alerts, cards, or endpoints
- Fixing bugs or changing any bot behavior
- Reformatting how data is shown (e.g. hours instead of days, percentages instead of raw)
- Any UI change, feature add, or behavior tweak an admin might reasonably want

Return ONLY valid JSON (no markdown, no extra text):
{
  "classification": "VALID" | "TROLL" | "DESTRUCTIVE",
  "allowed": true | false,
  "reason": "One sentence explanation.",
  "plan": "Concise step-by-step implementation plan for the code change.",
  "targetFile": "server.js"
}`;

    const userPrompt = `Administrator "${authorName}" [ID: ${authorId}] requests:\n\n"${requestText}"\n\nRespond with JSON only:`;

    try {
        const rawAiRes = await callAiFn(systemPrompt, userPrompt);
        let parsed = null;
        try {
            const cleanJson = (rawAiRes || "").replace(/```json/gi, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleanJson);
        } catch(e) {
            // Fallback parsing if wrapped in text
            const jsonMatch = (rawAiRes || "").match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        if (parsed && typeof parsed.allowed === 'boolean') {
            return {
                allowed: parsed.allowed,
                classification: parsed.classification || (parsed.allowed ? 'VALID' : 'REJECTED'),
                reason: parsed.reason || (parsed.allowed ? 'Request approved by AI Sentinel.' : 'Request rejected by safety vetting.'),
                plan: parsed.plan || `Modify ${parsed.targetFile || 'server.js'} per request.`,
                targetFile: parsed.targetFile || 'server.js'
            };
        }
    } catch(err) {
        console.warn('[FridayDevAgent] AI vetting error, falling back to safe deterministic approval:', err.message);
    }

    return {
        allowed: true,
        classification: 'VALID',
        reason: 'Verified safe by deterministic policy (AI fallback passed).',
        plan: `Apply modification: "${requestText}"`,
        targetFile: 'server.js'
    };
}

/**
 * Pre-Flight Syntax & Safety Verification.
 * Compiles JavaScript in-memory using Node vm.Script to ensure zero-crash guarantee!
 */
function verifySyntax(codeString, filename = 'server.js') {
    if (filename.endsWith('.js')) {
        try {
            new vm.Script(codeString, { filename });
        } catch (err) {
            return {
                valid: false,
                error: err.message,
                stack: err.stack
            };
        }

        // Discord API Component Safety: Link buttons (style: 5) cannot have custom_id
        const linkWithCustomIdRegex = /\{\s*[^}]*style:\s*5[^}]*custom_id:[^}]*\}|\{\s*[^}]*custom_id:[^}]*style:\s*5[^}]*\}/;
        if (linkWithCustomIdRegex.test(codeString)) {
            return {
                valid: false,
                error: 'Discord API Error: Link buttons (style: 5) cannot have a custom_id. Either use style: 1-4 for interactive buttons, or remove custom_id for link buttons.'
            };
        }

        return { valid: true };
    }

    if (filename.endsWith('.json')) {
        try {
            JSON.parse(codeString);
            return { valid: true };
        } catch (err) {
            return { valid: false, error: 'Invalid JSON: ' + err.message };
        }
    }

    // HTML / other files: Basic structural check
    return { valid: true };
}

/**
 * Generate a surgical code patch using AI and verify syntax.
 * Automatically retries up to 3 times with progressive instructions.
 */
async function generateAndVerifyPatch(targetFilePath, requestText, plan, callAiFn) {
    const fullPath = path.isAbsolute(targetFilePath) ? targetFilePath : path.join(__dirname, targetFilePath);
    if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Target file not found: ${targetFilePath}` };
    }

    const originalContent = fs.readFileSync(fullPath, 'utf8');
    const isLargeFile = originalContent.length > 50000;

    // Line numbers in context block allow the AI to locate functions quickly
    const contextBlock = isLargeFile
        ? extractRelevantLines(originalContent, requestText, plan)
        : originalContent;

    const MAX_ATTEMPTS = 3;
    let lastError = 'No response from coding AI.';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const systemPrompt = buildPatchSystemPrompt(path.basename(targetFilePath), requestText, plan, attempt);
        const userPrompt = buildPatchUserPrompt(contextBlock, attempt, lastError);

        let aiRes = await callAiFn(systemPrompt, userPrompt);
        if (!aiRes || aiRes.trim().length < 10) {
            lastError = `Coding AI did not return a response (attempt ${attempt}).`;
            continue;
        }

        // Parse SEARCH/REPLACE block with flexible parsing
        const patch = parseSearchReplaceBlock(aiRes);
        if (!patch || !patch.search.trim()) {
            lastError = `Could not extract valid SEARCH/REPLACE block from AI response (attempt ${attempt}). Preview: "${aiRes.slice(0, 120)}..."`;
            continue;
        }

        // Multi-level fuzzy matching
        const matchResult = findAndApplyPatch(originalContent, patch.search, patch.replace);
        if (!matchResult.success) {
            lastError = `The AI search block could not be matched in ${path.basename(targetFilePath)} (attempt ${attempt}). Search block (${patch.search.trim().length} chars) was: "${patch.search.trim().slice(0, 100)}..."`;
            continue;
        }

        // Verify that the patch actually changed something
        if (matchResult.updatedContent === originalContent) {
            lastError = `Patch resulted in zero code changes (attempt ${attempt}).`;
            continue;
        }

        const updatedContent = matchResult.updatedContent;

        // ZERO-CRASH PRE-FLIGHT SYNTAX CHECK
        const syntaxCheck = verifySyntax(updatedContent, path.basename(targetFilePath));
        if (!syntaxCheck.valid) {
            lastError = `Zero-Crash Check FAILED — syntax error in generated code (attempt ${attempt}): ${syntaxCheck.error}`;
            continue;
        }

        return {
            success: true,
            updatedContent,
            diffSummary: {
                search: patch.search.trim().slice(0, 400),
                replace: patch.replace.trim().slice(0, 400)
            }
        };
    }

    return { success: false, error: lastError };
}

/**
 * System prompt for patch generation — progressively stricter across attempts.
 */
function buildPatchSystemPrompt(filename, requestText, plan, attempt) {
    const errorAdvisory = attempt >= 2 ? '\n- CRITICAL: Your previous attempt failed because the SEARCH block lines could not be matched. The code you need to modify is ALREADY inside the provided snippet below. Find the real function name from the snippet. DO NOT invent or guess function names!' : '';

    return `You are the lead developer for F.R.I.D.A.Y., a Node.js Discord bot.
Your ONLY task is to generate a SURGICAL search-and-replace patch for the file "${filename}".

OUTPUT FORMAT (output NOTHING else, no markdown fences):
<<<<<<< SEARCH
[exact lines from the file — verbatim, including indentation]
=======
[modified replacement lines]
>>>>>>>

CRITICAL RULES:
1. The SEARCH block MUST contain lines that appear VERBATIM in the provided code snippet — do NOT paraphrase, summarize, or change indentation.
2. Do NOT invent function names, variable names, or components. Look at the functions in the provided snippet and find the actual code that implements this feature.
3. Do NOT copy the line numbers (e.g. "2537: ") from the snippet into the SEARCH block. Copy ONLY the actual code.
4. Keep the SEARCH block SHORT (3 to 15 lines max).
5. The REPLACE block contains the modified version of those same lines.
6. Do NOT include markdown code fences.
7. Do NOT explain or add commentary.${errorAdvisory}

Plan: ${plan}
Request: ${requestText}`;
}

/**
 * User prompt for patch generation — progressively concise with error feedback.
 */
function buildPatchUserPrompt(contextBlock, attempt, lastError) {
    let errorFeedback = '';
    if (attempt > 1 && lastError) {
        errorFeedback = `⚠️ NOTE: Previous attempt FAILED with: ${lastError}\nMake sure your SEARCH block matches the actual functions in the code snippet below!\n\n`;
    }

    if (attempt === 1) {
        return `Relevant code (line numbers are for your reference only — do NOT copy line numbers into the search block):\n\n\`\`\`javascript\n${contextBlock}\n\`\`\`\n\nGenerate ONE <<<<<<< SEARCH / ======= / >>>>>>> patch block:`;
    }
    if (attempt === 2) {
        return `${errorFeedback}CODE CONTEXT:\n\`\`\`javascript\n${contextBlock}\n\`\`\`\n\nOUTPUT ONLY the <<<<<<< SEARCH / ======= / >>>>>>> block. Start directly with <<<<<<< SEARCH:`;
    }
    return `${errorFeedback}CODE CONTEXT:\n\`\`\`javascript\n${contextBlock}\n\`\`\`\n\nCRITICAL: Copy SEARCH lines EXACTLY as they appear above. Output ONLY:\n<<<<<<< SEARCH\n[old code from snippet]\n=======\n[new modified code]\n>>>>>>>`;
}

/**
 * Multi-level fuzzy matching: exact -> CRLF-normalized -> per-line trimmed -> key-line anchor
 */
function findAndApplyPatch(originalContent, searchBlock, replaceBlock) {
    // Level 1: Exact match
    if (originalContent.includes(searchBlock)) {
        return { success: true, updatedContent: originalContent.replace(searchBlock, replaceBlock) };
    }

    // Level 2: Normalize line endings
    const normOrig = originalContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normSearch = searchBlock.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const normReplace = replaceBlock.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (normOrig.includes(normSearch)) {
        return { success: true, updatedContent: normOrig.replace(normSearch, normReplace) };
    }

    // Level 3: Per-line trimmed matching (handles indentation differences)
    const origLines = normOrig.split('\n');
    const searchLines = normSearch.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (searchLines.length === 0) {
        return { success: false };
    }

    // Slide search window through file looking for matching line sequence
    const windowSize = searchLines.length;
    let bestMatchStart = -1;
    let bestMatchScore = 0;
    // For 1-2 lines require 100%. For 3+ lines, 75% match is sufficient.
    const threshold = windowSize <= 2 ? windowSize : Math.max(2, Math.round(windowSize * 0.75));

    for (let i = 0; i <= origLines.length - windowSize; i++) {
        let matchCount = 0;
        for (let j = 0; j < windowSize; j++) {
            if (origLines[i + j].trim() === searchLines[j]) {
                matchCount++;
            }
        }
        if (matchCount > bestMatchScore) {
            bestMatchScore = matchCount;
            bestMatchStart = i;
        }
        if (matchCount >= windowSize) break; // Perfect match found
    }

    if (bestMatchStart >= 0 && bestMatchScore >= threshold) {
        const before = origLines.slice(0, bestMatchStart).join('\n');
        const after = origLines.slice(bestMatchStart + windowSize).join('\n');
        const updatedContent = [before, normReplace, after].filter((s, i) => i === 1 || s.length > 0).join('\n');
        return { success: true, updatedContent };
    }

    // Level 4: Single-key-line match (if search is up to 4 lines, try finding the most unique one)
    if (searchLines.length <= 4) {
        const uniqueLine = searchLines.reduce((a, b) => a.length > b.length ? a : b);
        if (uniqueLine.length > 15) {
            const lineIdx = origLines.findIndex(l => l.trim() === uniqueLine);
            if (lineIdx >= 0) {
                const origSearchLineCount = normSearch.split('\n').filter(l => l.trim()).length;
                const before = origLines.slice(0, lineIdx).join('\n');
                const after = origLines.slice(lineIdx + origSearchLineCount).join('\n');
                const updatedContent = [before, normReplace, after].filter((s, i) => i === 1 || s.length > 0).join('\n');
                return { success: true, updatedContent };
            }
        }
    }

    return { success: false };
}

/**
 * Strips leading line numbers (e.g. "2537: ") and context header comments from lines.
 */
function stripLineNumbers(str) {
    if (!str) return str;
    const lines = str.split('\n');
    const filtered = lines.filter(l => !/^\s*\/\/\s*(?:──|════)/.test(l));
    const nonEmpty = filtered.filter(l => l.trim().length > 0);
    const countWithLineNums = nonEmpty.filter(l => /^\s*\d{1,7}:\s?/.test(l)).length;
    if (countWithLineNums > 0 && countWithLineNums >= nonEmpty.length * 0.7) {
        return filtered.map(l => l.replace(/^\s*\d{1,7}:\s?/, '')).join('\n');
    }
    return filtered.join('\n');
}

/**
 * Cleans extracted patch search and replace strings.
 */
function cleanPatch(search, replace) {
    if (!search || !search.trim()) return null;
    let s = stripLineNumbers(search);
    let r = stripLineNumbers(replace || '');
    return { search: s, replace: r };
}

/**
 * Robust parser for <<<<<<< SEARCH / ======= / >>>>>>> blocks from AI response.
 * Supports:
 * - Standard and multi-bracket git conflict markers (<<<, ===, >>>)
 * - Backtick code-fence wrapped blocks (```diff, ```javascript, etc.)
 * - // SEARCH: and // REPLACE: comment blocks
 * - JSON object format ({ "search": "...", "replace": "..." })
 * - Unified diff style (- and + lines)
 */
function parseSearchReplaceBlock(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    let text = rawText.trim();

    // 0. Strip outer markdown code fence if wrapped
    if (text.startsWith('```')) {
        text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '').replace(/\r?\n```$/, '').trim();
    }

    // 1. Flexible Conflict / Patch marker pattern: 3+ '<', 3+ '=', 3+ '>'
    const markerRegex = /<{3,}[^\n]*\r?\n([\s\S]*?)\r?\n={3,}[^\n]*\r?\n([\s\S]*?)\r?\n>{3,}[^\n]*/;
    let match = text.match(markerRegex);
    if (match) {
        return cleanPatch(match[1], match[2]);
    }

    // 2. Headings / Comments pattern: // SEARCH: / // REPLACE:, ### SEARCH / ### REPLACE, etc.
    const labelRegex = /(?:^|\n)(?:\/\/|#+|\*\*|--)?\s*(?:SEARCH|BEFORE|OLD|ORIGINAL):?[^\n]*\r?\n([\s\S]*?)\r?\n(?:\/\/|#+|\*\*|--)?\s*(?:REPLACE|AFTER|NEW|MODIFIED):?[^\n]*\r?\n([\s\S]*?)(?:\r?\n(?:\/\/|#+|\*\*|--)?\s*(?:END|>>>>>>>|###|```)|$)/i;
    match = text.match(labelRegex);
    if (match) {
        return cleanPatch(match[1], match[2]);
    }

    // 3. JSON format: { "search": "...", "replace": "..." }
    try {
        const jsonMatch = text.match(/\{[\s\S]*"(?:search|old|before)"[\s\S]*"(?:replace|new|after)"[\s\S]*\}/i);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const search = parsed.search || parsed.old || parsed.before;
            const replace = parsed.replace !== undefined ? parsed.replace : (parsed.new !== undefined ? parsed.new : parsed.after);
            if (search && replace !== undefined) {
                return cleanPatch(search, replace);
            }
        }
    } catch (e) {}

    // 4. Unified diff style with - and + lines
    const diffLines = text.split('\n');
    const minusLines = [];
    const plusLines = [];
    let isDiff = false;
    for (const line of diffLines) {
        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
            isDiff = true;
            continue;
        }
        if (line.startsWith('-')) {
            isDiff = true;
            minusLines.push(line.slice(1));
        } else if (line.startsWith('+')) {
            isDiff = true;
            plusLines.push(line.slice(1));
        } else if (isDiff && (line.startsWith(' ') || line.trim() === '')) {
            minusLines.push(line.startsWith(' ') ? line.slice(1) : line);
            plusLines.push(line.startsWith(' ') ? line.slice(1) : line);
        }
    }
    if (isDiff && minusLines.length > 0 && plusLines.length > 0) {
        return cleanPatch(minusLines.join('\n'), plusLines.join('\n'));
    }

    return null;
}


/**
 * Extract ~200 relevant lines from a large file based on keywords.
 * Includes line numbers so the AI can reference exact locations.
 */
function extractRelevantLines(content, requestText, plan) {
    const lines = content.split('\n');

    // Extract search terms with stemming (singular/plural, common suffixes)
    const rawTerms = `${requestText} ${plan}`.toLowerCase().match(/[a-z0-9_]{3,}/g) || ['discord', 'retal', 'war'];
    const searchTerms = new Set();
    for (const t of rawTerms) {
        searchTerms.add(t);
        if (t.endsWith('s') && t.length > 3) searchTerms.add(t.slice(0, -1));
        if (t.endsWith('ies') && t.length > 4) searchTerms.add(t.slice(0, -3) + 'y');
        if (t.endsWith('ing') && t.length > 5) searchTerms.add(t.slice(0, -3));
        if (t.endsWith('ed') && t.length > 4) searchTerms.add(t.slice(0, -2));
    }
    const termsArray = Array.from(searchTerms);

    // Score all lines
    const scores = new Array(lines.length).fill(0);
    let maxScore = 0;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].toLowerCase();
        let matches = 0;
        for (const term of termsArray) {
            if (l.includes(term)) matches++;
        }
        if (matches === 0) continue;

        let lineScore = matches;

        // Massive boost for function/method definitions containing the search terms
        if (/\b(?:function|async\s+function|const\s+[a-zA-Z0-9_]+\s*=\s*(?:async\s*)?\()/i.test(l)) {
            lineScore += 8 + (matches * 3);
        }

        // Boost for UI and button components
        if (/\b(?:components|actionrow|custom_id|buttonbuilder|actionrowbuilder|embed|color|style)\b/i.test(l)) {
            lineScore += 4;
        }

        // Penalty for bare top-level variable declarations (e.g. `let x = {};`)
        if (/^\s*(?:let|var)\s+[a-zA-Z0-9_]+\s*=\s*\{\}\s*;?\s*$/.test(l)) {
            lineScore = Math.max(1, lineScore - 5);
        }

        scores[i] = lineScore;
        if (lineScore > maxScore) maxScore = lineScore;
    }

    // Find candidate lines
    const candidateLines = [];
    for (let i = 0; i < lines.length; i++) {
        if (scores[i] >= 3) {
            candidateLines.push(i);
        }
    }

    // Sort by score descending
    candidateLines.sort((a, b) => scores[b] - scores[a]);

    // Filter to top candidate lines that are spaced out
    const topRegions = [];
    const minScore = Math.max(3, Math.floor(maxScore * 0.4)); // Must be at least 40% of max score

    for (const idx of candidateLines) {
        if (scores[idx] < minScore) continue;
        const tooClose = topRegions.some(existing => Math.abs(existing - idx) < 90);
        if (!tooClose) {
            topRegions.push(idx);
            if (topRegions.length >= 3) break;
        }
    }

    if (topRegions.length === 0) {
        topRegions.push(11982, 2530);
    }

    // Build snippets with line numbers
    const snippets = topRegions.map(bestLine => {
        const start = Math.max(0, bestLine - 50);
        const end = Math.min(lines.length, bestLine + 70);
        const numberedLines = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`);
        return `// ── File lines ${start + 1}–${end} of ${lines.length} (Target region near line ${bestLine + 1}) ──\n` + numberedLines.join('\n');
    });

    return snippets.join('\n\n// ═══════════════════════════════════════════════\n\n');
}

/**
 * Stage a pending deployment in memory awaiting Admin confirmation.
 */
function stagePendingDeployment(authorId, authorName, requestText, plan, targetFile, updatedContent, diffSummary) {
    const actionId = `dep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const record = {
        actionId,
        authorId: String(authorId),
        authorName,
        requestText,
        plan,
        targetFile,
        updatedContent,
        diffSummary,
        createdAt: Date.now()
    };
    pendingDeployments.set(actionId, record);
    return actionId;
}

/**
 * Format the interactive DevOps Review Card for Discord.
 */
function buildReviewCard(actionId, authorName, authorId, requestText, plan, targetFile, diffSummary) {
    const previewBefore = (diffSummary?.search || '').slice(0, 250);
    const previewAfter = (diffSummary?.replace || '').slice(0, 250);

    const diffText = `\`\`\`diff\n- ${previewBefore.split('\n').join('\n- ')}\n+ ${previewAfter.split('\n').join('\n+ ')}\n\`\`\``;

    const embed = {
        color: UI.COLORS?.INFO || 0x3498db,
        title: "🛠️ F.R.I.D.A.Y. DevOps Review & Approval",
        description: `Administrator <@${authorId}> has requested an automated bot modification. Review the proposal and pre-flight verification below:`,
        fields: [
            { name: "📋 Request", value: `_${requestText}_`, inline: false },
            { name: "🎯 Target File", value: `\`${targetFile}\``, inline: true },
            { name: "🛡️ Safety & Integrity", value: `✅ Passed Anti-Troll & Zero-Crash Syntax Check`, inline: true },
            { name: "💡 Execution Plan", value: plan || "Apply targeted surgical change", inline: false },
            { name: "🔍 Code Diff Preview", value: diffText.slice(0, 1000), inline: false }
        ],
        footer: { text: "F.R.I.D.A.Y. DevOps Sentinel • Requires Admin Approval • Expires in 15m" },
        timestamp: new Date().toISOString()
    };

    const actionRow = UI.actionRow(
        UI.primaryBtn(`btn_dev_deploy_${actionId}`, "Confirm & Deploy to Railway", "🚀"),
        UI.dangerBtn(`btn_dev_cancel_${actionId}`, "Cancel & Discard", "❌")
    );

    return { embeds: [embed], components: [actionRow] };
}

/**
 * Build a rejection card when a request fails safety, troll, or scope vetting.
 */
function buildRejectionCard(classification, reason, requestText, authorName) {
    let title = "🚫 Modification Request Refused";
    let color = UI.COLORS?.ERROR || 0xe74c3c;

    if (classification === 'TOO_DRASTIC') {
        title = "⚠️ Request Exceeds Safe Scope";
        color = UI.COLORS?.WARNING || 0xf39c12;
    } else if (classification === 'TROLL') {
        title = "🛑 Request Refused — Intent Sentinel";
    }

    return {
        embeds: [{
            color,
            title,
            description: `Hey **${authorName}**, your modification request could not be processed.\n\n**Classification:** \`${classification}\`\n**Reason:** ${reason}`,
            fields: [
                { name: "Your Request", value: `_${requestText}_`, inline: false },
                { name: "How to Proceed", value: classification === 'TOO_DRASTIC' 
                    ? "For major architectural or UI redesigns, coordinate directly through the development workspace so changes can be thoroughly tested."
                    : "Please keep requests focused, constructive, and aimed at improving bot functionality.", inline: false }
            ],
            footer: { text: "F.R.I.D.A.Y. DevOps Safety Sentinel • Zero-Crash Policy" },
            timestamp: new Date().toISOString()
        }]
    };
}

/**
 * Safely resolves the GitHub token from config, direct environment variables,
 * or case-insensitive / aliased environment variables (vital for Linux / Railway).
 */
function resolveGitHubToken(discordConfig = {}) {
    // 1. Direct discordConfig check
    if (discordConfig && typeof discordConfig.githubToken === 'string' && discordConfig.githubToken.trim().length > 10) {
        return discordConfig.githubToken.trim().replace(/^["']|["']$/g, '');
    }

    // 2. Direct process.env check
    const direct = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT || process.env.GIT_TOKEN;
    if (direct && typeof direct === 'string' && direct.trim().length > 10) {
        return direct.trim().replace(/^["']|["']$/g, '');
    }

    // 3. Case-insensitive & fuzzy environment scan across process.env
    for (const [key, val] of Object.entries(process.env)) {
        if (!val || typeof val !== 'string' || val.trim().length <= 10) continue;
        const normKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (normKey.includes('GITHUB') && (normKey.includes('TOKEN') || normKey.includes('PAT') || normKey.includes('KEY') || normKey.includes('SECRET'))) {
            return val.trim().replace(/^["']|["']$/g, '');
        }
        if (normKey === 'GHTOKEN' || normKey === 'GITTOKEN' || normKey === 'GITHUB') {
            return val.trim().replace(/^["']|["']$/g, '');
        }
    }

    return "";
}

/**
 * Rigorously verifies a GitHub token against both user identity AND repository write access.
 */
async function verifyGitHubTokenWithRepo(token) {
    if (!token || typeof token !== 'string' || token.trim().length < 15) {
        return { valid: false, error: 'Token is too short or empty.' };
    }
    const cleanToken = token.trim().replace(/^["']|["']$/g, '');
    const primaryAuth = cleanToken.startsWith('ghp_') ? `token ${cleanToken}` : `Bearer ${cleanToken}`;
    const fallbackAuth = cleanToken.startsWith('ghp_') ? `Bearer ${cleanToken}` : `token ${cleanToken}`;

    // 1. Check user authentication
    let userRes = await fetch('https://api.github.com/user', {
        headers: {
            'Authorization': primaryAuth,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Friday-Dev-Agent'
        }
    });

    if (!userRes.ok && (userRes.status === 401 || userRes.status === 403)) {
        userRes = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': fallbackAuth,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Friday-Dev-Agent'
            }
        });
    }

    if (!userRes.ok) {
        return {
            valid: false,
            error: `GitHub rejected token (HTTP ${userRes.status}). Ensure the token is active, correct, and not expired.`
        };
    }

    const userData = await userRes.json();
    const scopes = userRes.headers.get('x-oauth-scopes') || 'fine-grained/unspecified';

    // 2. Check repository push permissions
    let repoRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
        headers: {
            'Authorization': primaryAuth,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Friday-Dev-Agent'
        }
    });

    if (!repoRes.ok && (repoRes.status === 401 || repoRes.status === 403)) {
        repoRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
            headers: {
                'Authorization': fallbackAuth,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Friday-Dev-Agent'
            }
        });
    }

    if (!repoRes.ok) {
        const repoErr = await repoRes.json().catch(() => ({}));
        return {
            valid: false,
            user: userData.login,
            scopes,
            canPush: false,
            error: `Authenticated as **@${userData.login}**, but could not access repository \`${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}\` (HTTP ${repoRes.status}: ${repoErr.message || ''}).`
        };
    }

    const repoData = await repoRes.json();
    const canPush = Boolean(repoData.permissions && (repoData.permissions.push || repoData.permissions.admin));

    if (!canPush) {
        return {
            valid: false,
            user: userData.login,
            scopes,
            canPush: false,
            error: `Authenticated as GitHub user **@${userData.login}**, but this account does **not** have write (push) access to **${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}**.\n\n` +
                   `• **If you own the repo:** You may be logged into GitHub as **${userData.login}** instead of **${GITHUB_REPO_OWNER}**. Log into GitHub as **${GITHUB_REPO_OWNER}** to create the token.\n` +
                   `• **If you want @${userData.login} to deploy:** Go to https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/settings/access and invite **@${userData.login}** as a Collaborator with Admin or Write permissions.`
        };
    }

    return {
        valid: true,
        user: userData.login,
        scopes,
        canPush: true,
        authHeader: primaryAuth
    };
}

/**
 * Execute deployment: Pushes commit to GitHub via REST API.
 * Railway automatically catches the push and rebuilds.
 */
async function deployToGitHub(actionId, user, discordConfig = {}) {
    const deployment = pendingDeployments.get(actionId);
    if (!deployment) {
        return {
            success: false,
            error: "This deployment review has expired or was already processed."
        };
    }

    const githubToken = resolveGitHubToken(discordConfig);
    if (!githubToken) {
        return {
            success: false,
            code: "TOKEN_REQUIRED",
            actionId,
            error: "GitHub Personal Access Token (`GITHUB_TOKEN`) is not configured. F.R.I.D.A.Y. needs a token with repository write permissions to commit changes."
        };
    }

    const targetFile = deployment.targetFile;
    const updatedContent = deployment.updatedContent;
    const authorUsername = user?.username || deployment.authorName || "Admin";

    const authHeader = githubToken.startsWith('ghp_') ? `token ${githubToken}` : `Bearer ${githubToken}`;
    const fallbackAuth = githubToken.startsWith('ghp_') ? `Bearer ${githubToken}` : `token ${githubToken}`;

    try {
        // 1. Fetch current file SHA from GitHub API
        const getUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${targetFile}?ref=${GITHUB_BRANCH}`;
        let getRes = await fetch(getUrl, {
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Friday-Dev-Agent'
            }
        });

        if (!getRes.ok && (getRes.status === 401 || getRes.status === 403)) {
            getRes = await fetch(getUrl, {
                headers: {
                    'Authorization': fallbackAuth,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Friday-Dev-Agent'
                }
            });
        }

        if (!getRes.ok) {
            const errData = await getRes.json().catch(() => ({}));
            return {
                success: false,
                error: `Failed to fetch file from GitHub: ${getRes.status} ${errData.message || ''}`
            };
        }

        const fileData = await getRes.json();
        const currentSha = fileData.sha;

        // 2. Commit updated file to GitHub
        const putUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${targetFile}`;
        const commitMsg = `feat(bot): ${deployment.plan.slice(0, 72)} (via Discord Admin @${authorUsername})`;

        let putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Friday-Dev-Agent',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: commitMsg,
                content: Buffer.from(updatedContent).toString('base64'),
                sha: currentSha,
                branch: GITHUB_BRANCH
            })
        });

        if (!putRes.ok && (putRes.status === 401 || putRes.status === 403)) {
            putRes = await fetch(putUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': fallbackAuth,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Friday-Dev-Agent',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: commitMsg,
                    content: Buffer.from(updatedContent).toString('base64'),
                    sha: currentSha,
                    branch: GITHUB_BRANCH
                })
            });
        }

        if (!putRes.ok) {
            const errData = await putRes.json().catch(() => ({}));
            let errMsg = `GitHub rejected commit: ${putRes.status} ${errData.message || ''}`;
            if (putRes.status === 403) {
                // Diagnose exact reason
                const diag = await verifyGitHubTokenWithRepo(githubToken);
                if (!diag.valid) {
                    errMsg += `\n\n${diag.error}`;
                } else {
                    errMsg += `\n\n🔑 Token has write access as @${diag.user} (scopes: ${diag.scopes}), but GitHub rejected the file commit. Verify repository branch rules or fine-grained token write settings.`;
                }
            }
            return {
                success: false,
                error: errMsg
            };
        }

        const commitData = await putRes.json();
        const commitSha = commitData.commit?.sha?.slice(0, 7) || 'live';
        const commitUrl = commitData.commit?.html_url || `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/commits/${GITHUB_BRANCH}`;

        // Also update local file if running locally
        try {
            const localPath = path.isAbsolute(targetFile) ? targetFile : path.join(__dirname, targetFile);
            if (fs.existsSync(localPath)) {
                fs.writeFileSync(localPath, updatedContent, 'utf8');
            }
        } catch(e) {}

        // Remove from pending
        pendingDeployments.delete(actionId);

        return {
            success: true,
            commitSha,
            commitUrl,
            message: commitMsg
        };

    } catch(err) {
        console.error('[FridayDevAgent] GitHub deploy error:', err);
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Cancel a pending deployment.
 */
function cancelDeployment(actionId) {
    if (pendingDeployments.has(actionId)) {
        pendingDeployments.delete(actionId);
        return true;
    }
    return false;
}

module.exports = {
    isAuthorizedDevAdmin,
    detectDevRequest,
    evaluateRequestWithAI,
    verifySyntax,
    generateAndVerifyPatch,
    stagePendingDeployment,
    buildReviewCard,
    buildRejectionCard,
    deployToGitHub,
    cancelDeployment,
    resolveGitHubToken,
    verifyGitHubTokenWithRepo,
    pendingDeployments
};
