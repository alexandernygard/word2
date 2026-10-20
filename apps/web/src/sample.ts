export const WELCOME = `---
title: Northwind Coffee — Q3 Market Review
subtitle: Prepared for the leadership offsite
author: Strategy team
date: October 2026
theme: report
page:
  size: A4
  margins:
    top: 22
    right: 22
    bottom: 22
    left: 22
header: "{{title}} | | {{section}}"
footer: "Confidential | | Page {{page}} of {{pages}}"
numberedHeadings: true
references:
  - id: icoreport
    author: International Coffee Organization
    title: Coffee Market Report, September 2026
    year: 2026
  - id: hartley2025
    author: M. Hartley and J. Osei
    title: Subscription Retail After the Boom
    year: 2025
    publisher: Retail Quarterly
ai:
  audience: Executive team, reads on a phone between meetings
  tone: Direct and confident, no hype
  purpose: Decide whether to expand the subscription line in 2027
---

::toc[Contents]

# Summary

Q3 was the strongest quarter in Northwind's history. Revenue reached **€4.8m**, up 18% on last year, and subscription customers grew faster than any other channel.^[All figures are unaudited management accounts.] Wholesale held steady while café revenue softened slightly as office occupancy plateaued.

We {~~think~>recommend~~}{>>@claude: a summary for executives should commit<<} expanding the subscription line in 2027, funded by the wholesale margin, and pausing new café openings until occupancy data improves.

:::note[What this review covers]
Channel performance, the green coffee price outlook, and three options for 2027. Detailed tables are in the appendix.
:::

# Channel performance

Subscriptions are now a third of revenue. Churn fell for the third quarter in a row, which matches the wider pattern of subscription retail settling after the 2023 boom [@hartley2025].

| Channel       | Q3 2025 (€k) | Q3 2026 (€k) | Change |
| ------------- | -----------: | -----------: | -----: |
| Subscriptions | 1,020        | 1,610        | +58%   |
| Wholesale     | 1,480        | 1,530        | +3%    |
| Cafés         | 1,570        | 1,490        | −5%    |
| Online shop   | —            | 170          | new    |

Table: Revenue by channel, third quarter

\`\`\`chart
type: bar
title: Revenue by channel (€k)
x: channel
y: Q3 2025, Q3 2026
---
channel,Q3 2025,Q3 2026
Subscriptions,1020,1610
Wholesale,1480,1530
Cafés,1570,1490
Online shop,0,170
\`\`\`

## Subscriptions

The relaunch of the *Roaster's Choice* box in May drove most of the growth. Average order value rose to €31, and {==the share of customers on annual plans doubled==}{>>@alex: @claude can you check this against the cohort table and soften it if needed?<<}.

- Active subscribers: 14,200 (up from 9,100)
- Monthly churn: 3.1% (down from 4.4%)
- Annual plans: 22% of subscribers
  - Mostly gifted in the December campaign

## Cafés

Footfall in the four city-centre cafés is flat. Weekday mornings recovered, but afternoons are still 20% below 2019.

# Green coffee prices

Arabica futures stayed volatile through the quarter. Prices eased in September after the Brazilian harvest came in above forecast [@icoreport, p. 3], but we expect them to stay high through the first half of 2027.

::pagebreak

# Options for 2027

1. **Grow subscriptions.** Add a second roastery shift and a decaf box; target 22,000 subscribers.
2. **Hold steady.** Keep the current mix and protect margin while prices are high.
3. **Open two cafés.** Follow the original plan in Utrecht and Leiden.

:::warning[Open question]
Option 3 depends on a lease decision due in November.
:::

## Next steps

- [x] Share draft with finance
- [ ] Confirm the roastery capacity figures
- [ ] Decide at the offsite on 6 November

::references
`
