const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Require friday-dev-agent
const fridayDev = require('./friday-dev-agent');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🤖 F.R.I.D.A.Y. BOT MULTIPLE TEST QUESTIONS SIMULATION SUITE');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runTests() {
    let passed = 0;
    let total = 0;

    // Helper to run a test case
    async function testQuestion(testName, requestText, mockAiResponse, expectedSuccess) {
        total++;
        console.log(`\n▶ [Test ${total}] "${testName}"`);
        console.log(`   User asked: "${requestText}"`);

        // Mock AI caller function returning the test response
        const mockAiCaller = async (sys, usr) => {
            if (typeof mockAiResponse === 'function') {
                return mockAiResponse(sys, usr);
            }
            return mockAiResponse;
        };

        const result = await fridayDev.generateAndVerifyPatch('server.js', requestText, 'Apply requested update safely', mockAiCaller);

        if (expectedSuccess) {
            if (result.success) {
                console.log(`   ✅ PASS: Patch generated and validated with Zero-Crash check!`);
                console.log(`   🔍 Diff Preview:`);
                console.log(`      [-] ${result.diffSummary.search.trim().split('\n')[0]}`);
                console.log(`      [+] ${result.diffSummary.replace.trim().split('\n')[0]}`);
                passed++;
            } else {
                console.error(`   ❌ FAIL: Expected success but got error: ${result.error}`);
            }
        } else {
            if (!result.success) {
                console.log(`   ✅ PASS: Appropriately rejected/failed: ${result.error}`);
                passed++;
            } else {
                console.error(`   ❌ FAIL: Expected failure but succeeded unexpectedly!`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: User's exact prompt from screenshot
    // "Can you change the bank requests buttons..."
    // AI returns standard <<<<<<< SEARCH format for server.js
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'User Prompt from Screenshot: Change bank buttons',
        'Can you change the bank requests buttons styling',
        `<<<<<<< SEARCH
function buildBankRequestButtons(req) {
    const vaultUrl = getPreFilledVaultUrl(req.tornId, req.amount);
=======
function buildBankRequestButtons(req) {
    // Bank buttons layout
    const vaultUrl = getPreFilledVaultUrl(req.tornId, req.amount);
>>>>>>>`,
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: AI wraps response in markdown diff fence (the most common Gemini behavior!)
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'Gemini returns markdown ```diff code fence',
        'Update startup grace period constant',
        `Here is the patch you requested:

\`\`\`diff
<<<<<<< SEARCH
const STARTUP_GRACE_MS = 30000;
=======
const STARTUP_GRACE_MS = 35000;
>>>>>>>
\`\`\`
Hope this helps!`,
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: AI copies line numbers from the context snippet
    // e.g. "1248: const STARTUP_GRACE_MS = 30000;"
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'AI copies line numbers from context block',
        'Update STARTUP_GRACE_MS',
        `<<<<<<< SEARCH
1248: const STARTUP_GRACE_MS = 30000;
=======
1248: const STARTUP_GRACE_MS = 40000;
>>>>>>>`,
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: AI uses // SEARCH: and // REPLACE: comments instead of conflict markers
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'AI uses // SEARCH: and // REPLACE: format',
        'Change server startup grace period',
        `// SEARCH:
const STARTUP_GRACE_MS = 30000;
// REPLACE:
const STARTUP_GRACE_MS = 25000;
// END`,
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: AI returns JSON format
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'AI returns structured JSON format',
        'Adjust startup grace time',
        `\`\`\`json
{
  "search": "const STARTUP_GRACE_MS = 30000;",
  "replace": "const STARTUP_GRACE_MS = 20000;"
}
\`\`\``,
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: First attempt fails, second attempt (retry loop) succeeds!
    // ─────────────────────────────────────────────────────────────
    let attemptsCount = 0;
    await testQuestion(
        'Retry loop: Attempt 1 returns bad text, Attempt 2 succeeds',
        'Update startup grace period',
        (sys, usr) => {
            attemptsCount++;
            if (attemptsCount === 1) {
                return "I will update the constant for you. Wait a moment."; // No search/replace block
            }
            return `<<<<<<< SEARCH
const STARTUP_GRACE_MS = 30000;
=======
const STARTUP_GRACE_MS = 45000;
>>>>>>>`;
        },
        true
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Safety Vetting - Catastrophic destruction attempt
    // ─────────────────────────────────────────────────────────────
    total++;
    console.log(`\n▶ [Test ${total}] "Anti-Troll & Scope Limiter Test: Drop Database request"`);
    const vetting = await fridayDev.evaluateRequestWithAI(
        "delete all database collections and drop mongo",
        "Owen777",
        "12345",
        async () => JSON.stringify({ allowed: true, plan: "drop db", classification: "NORMAL" }) // even if AI hallucinated allowed=true, deterministic rules should stop it
    );
    if (!vetting.allowed && (vetting.classification === 'DESTRUCTIVE' || vetting.classification === 'CATASTROPHIC')) {
        console.log(`   ✅ PASS: Catastrophic request was immediately blocked by Security Sentinel! (${vetting.classification})`);
        passed++;
    } else {
        console.error(`   ❌ FAIL: Catastrophic request was NOT blocked! Result:`, vetting);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Syntax Verification - AI generates invalid JS with a syntax error
    // ─────────────────────────────────────────────────────────────
    await testQuestion(
        'Zero-Crash Guarantee: AI returns syntax error',
        'Add broken syntax',
        `<<<<<<< SEARCH
const STARTUP_GRACE_MS = 30000;
=======
const STARTUP_GRACE_MS = 30000 +++ invalid syntax }}};;;
>>>>>>>`,
        false // Expected to FAIL pre-flight safety check
    );

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`📊 FINAL RESULTS: ${passed}/${total} TESTS PASSED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (passed === total) {
        console.log('🎉 ALL TEST QUESTIONS PASSED! F.R.I.D.A.Y. Dev Agent is robust & ready!');
    } else {
        console.error('⚠️ Some tests failed. Please review the output above.');
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});
