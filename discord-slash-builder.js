'use strict';

const { SlashCommandBuilder } = require('discord.js');

/**
 * Builds the complete array of Discord Slash Commands for F.R.I.D.A.Y.
 * Returns an array of JSON command payloads ready for REST registration.
 */
function buildSlashCommands() {
    return [
        new SlashCommandBuilder().setName('verify').setDescription('Verify a Torn player identity and sync roles & nickname')
            .addUserOption(opt => opt.setName('user').setDescription('The Discord user to verify (leave empty to verify yourself)').setRequired(false))
            .addStringOption(opt => opt.setName('player').setDescription('Optional: Torn Player ID or Name to verify as').setRequired(false)).toJSON(),

        new SlashCommandBuilder().setName('verifyall').setDescription('Admin: Re-verify all members in this Discord server and sync nicknames & roles').toJSON(),

        new SlashCommandBuilder().setName('postverify').setDescription('Admin: Post an interactive verification card with a 1-click Verify button to this channel').toJSON(),

        new SlashCommandBuilder().setName('migrationstatus').setDescription('Leadership: Check migration progress of members to Limited API Key verification').toJSON(),

        new SlashCommandBuilder().setName('remindkeys').setDescription('Admin: Send a polite reminder DM to verified members who haven\'t linked their API key yet')
            .addBooleanOption(opt => opt.setName('dryrun').setDescription('If true, previews members to be reminded without sending DMs').setRequired(false)).toJSON(),

        // 0b. Faction Promotion Requests
        new SlashCommandBuilder().setName('promotion').setDescription('Request a promotion to an actual faction role (excluding leadership positions)')
            .addStringOption(opt => opt.setName('role').setDescription('Select the faction role you want to request').setRequired(false).setAutocomplete(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Optional pitch or reason for your promotion request').setRequired(false)).toJSON(),

        // 1. Vault Banking
        new SlashCommandBuilder().setName('withdraw').setDescription('Request money from the faction vault (with overdraft protection)')
            .addStringOption(opt => opt.setName('amount').setDescription('Amount to request (e.g. 10m, 500k, 25000000)').setRequired(true).setAutocomplete(true)).toJSON(),

        new SlashCommandBuilder().setName('balance').setDescription('Check faction vault balance and donations')
            .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (leave blank for yourself or leaderboard)')).toJSON(),

        // 2. Faction Discord Member Audit
        new SlashCommandBuilder().setName('notindiscord').setDescription('Audit faction members: list who is not in this Discord server').toJSON(),

        // 3. War & Combat Intelligence
        new SlashCommandBuilder().setName('war').setDescription('Show live ranked war status, scores, lead, and top war hitters').toJSON(),
        new SlashCommandBuilder().setName('targets').setDescription('List priority enemy targets attackable in Torn right now').toJSON(),
        new SlashCommandBuilder().setName('claim').setDescription('Claim an attackable enemy target during war')
            .addStringOption(opt => opt.setName('target').setDescription('Numeric Torn Player ID').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('unclaim').setDescription('Release a claimed enemy target')
            .addStringOption(opt => opt.setName('target').setDescription('Numeric Torn Player ID').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('sos').setDescription('Request emergency combat backup for a target')
            .addStringOption(opt => opt.setName('target').setDescription('Numeric Torn Player ID').setRequired(true))
            .addStringOption(opt => opt.setName('note').setDescription('Optional emergency backup note')).toJSON(),
        new SlashCommandBuilder().setName('spy').setDescription('Look up battle stats & spy records for a player')
            .addStringOption(opt => opt.setName('target').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('risk').setDescription('Retaliation risk report for a target — retal rate, response time, known retaliators')
            .addStringOption(opt => opt.setName('target').setDescription('Numeric Torn Player ID').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('retal').setDescription('Retaliation risk report for a target — retal rate, response time, known retaliators')
            .addStringOption(opt => opt.setName('target').setDescription('Numeric Torn Player ID').setRequired(true)).toJSON(),

        // 4. Chain Management
        new SlashCommandBuilder().setName('chain').setDescription('Check live faction chain status, timer, and multiplier').toJSON(),
        new SlashCommandBuilder().setName('oc').setDescription('Check live Organized Crimes status, ready teams, and delayed members').toJSON(),

        // 5. Player Intelligence
        new SlashCommandBuilder().setName('profile').setDescription('View comprehensive player profile, status, and stats')
            .addStringOption(opt => opt.setName('player').setDescription('Torn Player ID or Name').setRequired(true)).toJSON(),

        // 6. Consolidated Faction Management Suite
        new SlashCommandBuilder().setName('faction').setDescription('Faction intelligence, readiness, and management suite')
            .addSubcommand(sub => sub.setName('roster').setDescription('Live faction readiness breakdown (Online, Traveling, Hospital)'))
            .addSubcommand(sub => sub.setName('hospital').setDescription('List friendly faction members currently hospitalized'))
            .addSubcommand(sub => sub.setName('inactive').setDescription('List faction members inactive for 1+ days'))
            .addSubcommand(sub => sub.setName('notindiscord').setDescription('List faction members not in this Discord server'))
            .addSubcommand(sub => sub.setName('oc').setDescription('Summary of Organized Crimes status and ready teams'))
            .addSubcommand(sub => sub.setName('payout').setDescription('Check member war payout balance')
                .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (optional)')))
            .addSubcommand(sub => sub.setName('mvp').setDescription('Leaderboard of top war hitters'))
            .addSubcommand(sub => sub.setName('stats').setDescription('Battle stats roster comparison')
                .addStringOption(opt => opt.setName('side').setDescription('Select faction').addChoices(
                    { name: '🎯 Enemy Faction', value: 'enemy' },
                    { name: '🛡️ Our Faction', value: 'friendly' }
                )))
            .addSubcommand(sub => sub.setName('bounties').setDescription('Track active war bounties placed and claimed'))
            .addSubcommand(sub => sub.setName('flights').setDescription('Audit war flight uptime and travel sentinel')).toJSON(),

        // 7. Travel & Item Stocks
        new SlashCommandBuilder().setName('travel').setDescription('Overseas destination status & item stock (Plushies & Flowers)')
            .addStringOption(opt => opt.setName('country').setDescription('Select country').setRequired(true)
                .addChoices(
                    { name: '🇲🇽 Mexico', value: 'Mexico' },
                    { name: '🏝️ Cayman Islands', value: 'Cayman Islands' },
                    { name: '🇨🇦 Canada', value: 'Canada' },
                    { name: '🌺 Hawaii', value: 'Hawaii' },
                    { name: '🇬🇧 United Kingdom', value: 'United Kingdom' },
                    { name: '🇦🇷 Argentina', value: 'Argentina' },
                    { name: '🇨🇭 Switzerland', value: 'Switzerland' },
                    { name: '🇯🇵 Japan', value: 'Japan' },
                    { name: '🇨🇳 China', value: 'China' },
                    { name: '🇦🇪 UAE', value: 'UAE' },
                    { name: '🇿🇦 South Africa', value: 'South Africa' }
                )
            ).toJSON(),

        // 8. Bazaar & Market
        new SlashCommandBuilder().setName('bazaar').setDescription('Check lowest Torn market price & bazaar stats for an item')
            .addStringOption(opt => opt.setName('item').setDescription('Item name or ID').setRequired(true)).toJSON(),

        // 9. Alert Controls
        new SlashCommandBuilder().setName('alerts').setDescription('Manage automated Discord faction alert notifications')
            .addSubcommand(sub => sub.setName('status').setDescription('Check alert notifications status'))
            .addSubcommand(sub => sub.setName('pause').setDescription('Temporarily pause all automated alerts'))
            .addSubcommand(sub => sub.setName('resume').setDescription('Resume automated alerts')).toJSON(),

        // 10. Direct Faction Standalone Commands
        new SlashCommandBuilder().setName('roster').setDescription('Live faction readiness breakdown (Online, Traveling, Hospital)').toJSON(),
        new SlashCommandBuilder().setName('hospital').setDescription('List friendly faction members currently hospitalized').toJSON(),
        new SlashCommandBuilder().setName('inactive').setDescription('List faction members inactive for 1+ days').toJSON(),
        new SlashCommandBuilder().setName('payout').setDescription('Check member war payout balance')
            .addStringOption(opt => opt.setName('member').setDescription('Member name or ID (optional)')).toJSON(),
        new SlashCommandBuilder().setName('mvp').setDescription('Leaderboard of top war hitters').toJSON(),
        new SlashCommandBuilder().setName('stats').setDescription('Battle stats roster comparison')
            .addStringOption(opt => opt.setName('side').setDescription('Select faction').addChoices(
                { name: '🎯 Enemy Faction', value: 'enemy' },
                { name: '🛡️ Our Faction', value: 'friendly' }
            )).toJSON(),
        new SlashCommandBuilder().setName('bounties').setDescription('Track active war bounties placed and claimed').toJSON(),
        new SlashCommandBuilder().setName('flights').setDescription('Audit war flight uptime and travel sentinel').toJSON(),

        // 11. Chains & OC Standalone Utilities
        new SlashCommandBuilder().setName('chainwatch').setDescription('Live chain drop watcher and alert status').toJSON(),
        new SlashCommandBuilder().setName('myoc').setDescription('Check your personal assigned Organized Crime status')
            .addStringOption(opt => opt.setName('player').setDescription('Player name or ID (optional)')).toJSON(),

        // 12. Economy & Utilities Standalone
        new SlashCommandBuilder().setName('stocks').setDescription('Quick check overseas plushie and flower stocks')
            .addStringOption(opt => opt.setName('country').setDescription('Select country').setRequired(true)
                .addChoices(
                    { name: '🇲🇽 Mexico', value: 'Mexico' },
                    { name: '🏝️ Cayman Islands', value: 'Cayman Islands' },
                    { name: '🇨🇦 Canada', value: 'Canada' },
                    { name: '🌺 Hawaii', value: 'Hawaii' },
                    { name: '🇬🇧 United Kingdom', value: 'United Kingdom' },
                    { name: '🇦🇷 Argentina', value: 'Argentina' },
                    { name: '🇨🇭 Switzerland', value: 'Switzerland' },
                    { name: '🇯🇵 Japan', value: 'Japan' },
                    { name: '🇨🇳 China', value: 'China' },
                    { name: '🇦🇪 UAE', value: 'UAE' },
                    { name: '🇿🇦 South Africa', value: 'South Africa' }
                )
            ).toJSON(),
        new SlashCommandBuilder().setName('donator').setDescription('Check player Torn donator and subscriber status')
            .addStringOption(opt => opt.setName('player').setDescription('Player name or ID (optional)')).toJSON(),

        // 13. Alert Control Shortcuts
        new SlashCommandBuilder().setName('pause').setDescription('Quick shortcut to pause all automated notifications').toJSON(),
        new SlashCommandBuilder().setName('resume').setDescription('Quick shortcut to resume all automated notifications').toJSON(),

        // 14. Interactive Giveaways
        new SlashCommandBuilder().setName('giveaway').setDescription('Host an interactive giveaway with live countdown and automatic winner picking')
            .addStringOption(opt => opt.setName('prize').setDescription('What are you giving away? (e.g. 10x Xanax, $25,000,000, Donator Pack)'))
            .addStringOption(opt => opt.setName('duration').setDescription('Giveaway duration (e.g. 10m, 1h, 1d)'))
            .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners (1 to 20, default: 1)').setMinValue(1).setMaxValue(20))
            .toJSON(),

        // 15. Tactical Torn AI Oracle
        new SlashCommandBuilder().setName('ask').setDescription('Ask F.R.I.D.A.Y any question about Torn City mechanics, wiki guides, and faction rules')
            .addStringOption(opt => opt.setName('question').setDescription('What is your Torn City question?').setRequired(true))
            .toJSON(),

        // 16. Natural Chat Wingman / Conversation Responder
        new SlashCommandBuilder().setName('respond').setDescription('F.R.I.D.A.Y reads recent chat vibes and responds naturally like a person in conversation')
            .addStringOption(opt => opt.setName('hint').setDescription('Optional angle or thought to chime in with').setRequired(false))
            .toJSON(),

        // 17. Continuous Conversational Mode
        new SlashCommandBuilder().setName('conversation').setDescription('Toggle continuous conversational AI mode in this channel')
            .addStringOption(opt => opt.setName('action').setDescription('Action: start, stop, or status')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Start Conversation Mode', value: 'start' },
                    { name: '🛑 Stop Conversation Mode', value: 'stop' },
                    { name: '🧹 Reset / Clear Memory', value: 'reset' },
                    { name: '📊 Check Status', value: 'status' }
                )
            ).toJSON(),

        // 18. Personal Account Vitals & Secure API Key Linking
        new SlashCommandBuilder().setName('notifications').setDescription('Configure your personal Discord DM alerts (Xanax timer, travel, full energy/nerve, hosp)').toJSON(),
        new SlashCommandBuilder().setName('dmalerts').setDescription('Quick shortcut: Manage personal Discord DM alerts & notifications').toJSON(),
        new SlashCommandBuilder().setName('energy').setDescription('Check your live energy, nerve, bars, and cooldowns (uses linked Limited API key)').toJSON(),
        new SlashCommandBuilder().setName('bars').setDescription('Check your live energy, nerve, bars, and cooldowns (alias of /energy)').toJSON(),
        new SlashCommandBuilder().setName('merits').setDescription('Check your live allocated Torn merits and upgrades (uses linked Limited API key)').toJSON(),
        new SlashCommandBuilder().setName('linkkey').setDescription('Privately link your Torn Limited Access API key to F.R.I.D.A.Y')
            .addStringOption(opt => opt.setName('key').setDescription('16-character Limited Access API Key').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('unlinkkey').setDescription('Unlink and permanently delete your stored Torn API key from F.R.I.D.A.Y').toJSON(),
        new SlashCommandBuilder().setName('openrouter').setDescription('Admin: Set OpenRouter backup API key for unlimited AI failover')
            .addStringOption(opt => opt.setName('key').setDescription('OpenRouter API key (sk-or-...)').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('bug').setDescription('Report a bug or issue with F.R.I.D.A.Y or the website to the developer')
            .addStringOption(opt => opt.setName('description').setDescription('Detailed description of the bug or issue encountered').setRequired(true))
            .addStringOption(opt => opt.setName('category').setDescription('Category of the bug').setRequired(false)
                .addChoices(
                    { name: '🐛 General / Other', value: 'general' },
                    { name: '🌐 Web Dashboard', value: 'website' },
                    { name: '🤖 Discord Bot / Commands', value: 'discord' },
                    { name: '🔔 Alerts & Notifications', value: 'alerts' },
                    { name: '🕵️ Organized Crimes', value: 'oc' },
                    { name: '⚔️ War & Chains', value: 'war' },
                    { name: '🏦 Vault Banking', value: 'banking' }
                )
            ).toJSON(),

        // 19. Autonomous Elimination Target Hunter
        new SlashCommandBuilder().setName('snipe').setDescription('Autonomous Elimination Target Hunter: find beatable enemies not in hosp/traveling')
            .addStringOption(opt => opt.setName('tier').setDescription('Difficulty tier (default: manageable)')
                .addChoices(
                    { name: '🟢 Easy (< 0.85x BS)', value: 'easy' },
                    { name: '🟡 Manageable (<= 1.25x BS)', value: 'manageable' },
                    { name: '🔴 Difficult (<= 1.65x BS)', value: 'difficult' },
                    { name: '⚡ All Tiers (Unrestricted)', value: 'all' }
                )
            ).toJSON(),
        new SlashCommandBuilder().setName('elim').setDescription('Autonomous Elimination Target Hunter (alias of /snipe)')
            .addStringOption(opt => opt.setName('tier').setDescription('Difficulty tier (default: manageable)')
                .addChoices(
                    { name: '🟢 Easy (< 0.85x BS)', value: 'easy' },
                    { name: '🟡 Manageable (<= 1.25x BS)', value: 'manageable' },
                    { name: '🔴 Difficult (<= 1.65x BS)', value: 'difficult' },
                    { name: '⚡ All Tiers (Unrestricted)', value: 'all' }
                )
            ).toJSON(),

        // 20. Battle Stats Manual Update & Training Progress Tracker (/bs, /bsupdate)
        new SlashCommandBuilder().setName('bs').setDescription('Track Torn battle stats and training gains (like TornStats)')
            .addSubcommand(sub => sub.setName('update').setDescription('Fetch live battle stats, record training progress, and post publicly in channel')
                .addStringOption(opt => opt.setName('key').setDescription('Optional: provide/link your 16-char Limited Access API key').setRequired(false))
            )
            .addSubcommand(sub => sub.setName('view').setDescription('View your current recorded battle stats and stat distribution publicly in channel')
            ).toJSON(),
        new SlashCommandBuilder().setName('bsupdate').setDescription('Quick shortcut: Update battle stats and post publicly in channel')
            .addStringOption(opt => opt.setName('key').setDescription('Optional: provide/link your 16-char Limited Access API key').setRequired(false)).toJSON()
    ];
}

module.exports = {
    buildSlashCommands
};
