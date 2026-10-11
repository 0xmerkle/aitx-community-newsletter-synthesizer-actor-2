// Shared AITX context injected into every prompt. Source of truth is the
// aitx-context skill in claude-code-aitx/aitx-plugins (aitx-core plugin);
// keep this in sync when community facts or house style change.

export const AITX_CONTEXT = `About the newsletter:
- AITX Community Weekly is the newsletter of AITX Community (AI Texas), Texas's largest in-person community for AI engineers and founders, with chapters in Austin, Dallas and Houston. 4,500+ subscribers.
- Readers are people building with AI in Texas: engineers, founders, investors, operators. Builder-first, concrete over hype.
- "AITX" here always means AITX Community. AITX the robotics/security company (Artificial Intelligence Technology Solutions) is a different, unrelated company; never treat news about it as news about us.`;

export const HOUSE_STYLE = `House style (strict):
- No em dashes or en dashes. Use commas, colons, periods, or parentheses.
- No bold, no markdown emphasis, never emojis.
- Smart Brevity: short sentences, active voice, one idea per sentence. Name the real thing (company, venue, number) instead of adjectives.
- Sound like a person who runs the community, not a brand team. Never use: "exciting", "don't miss", "dive into", "unlock", "game-changer", "buckle up", "fast-paced world", "whether you're X or Y", stacked adjectives, rhetorical triplets, exclamation points.`;

// Only for copy written in our own voice (the header). Never for event or story
// summaries: those describe other organizations, and adding our name misattributes them.
export const NAMING_RULE = `- When you refer to us, say "AITX Community" on first mention and "AITX" after.`;

// Our own voice (header only)
export const VOICE = `Voice: grassroots, direct, casual. Sounds like a person who runs the community. Texas-local framing where it's true. "Y'all" or "Howdy" at most once, never forced.`;

// Real links the header may use. Never invent others.
export const AITX_LINKS = `Links you may use (no others):
- All AITX Community events (Luma calendar): https://lu.ma/AITX
- Present or lead a workshop: https://aitxcommunity.com/participate
- Hackathons: https://aitxcommunity.com/hackathons
- Website: https://aitxcommunity.com`;

export const TITLE_PREFIX = 'AITX Community Weekly: ';

/** Human-readable issue date, e.g. "Friday, October 16, 2026". */
export function formatIssueDate(dateKey: string): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
