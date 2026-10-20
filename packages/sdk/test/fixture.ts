export const SAMPLE = `---
title: Quarterly Report
author: Ada Lovelace
page:
  size: A4
  margins:
    top: 20
theme: report
footer: "{{title}} | | Page {{page}} of {{pages}}"
references:
  - id: smith2020
    author: Jane Smith
    title: Growth Patterns
    year: 2020
---

::toc[Contents]

# Summary {#summary}

Revenue grew **18%** year on year, driven by *strong* demand in [EMEA](https://example.com "Europe") and ~~legacy~~ new products.^[Figures are unaudited.] See [@smith2020, p. 4].

We {++really ++}{>>@claude: adds emphasis<<}believe the {~~old~>new~~} plan works. {==This needs a source==}{>>@alex: citation?<<}{>>@claude: added one below<<}

Line one\\
line two with \`code\` and [underlined]{.underline} text and H~2~O and x^2^.

## Details

- First point
- Second point with **bold**
  - Nested point
- Third

1. One
2. Two

- [x] Done task
- [ ] Open task

> A quote
> over two lines

:::warning[Heads up]
Callout body.
:::

| Region | Revenue | Growth |
| ------ | ------: | :----: |
| EMEA   | 4.1     | 12%    |
| APAC   | 2.3     | 30%    |

Table: Revenue by region

\`\`\`chart
type: bar
title: Revenue
x: quarter
y: revenue, cost
---
quarter,revenue,cost
Q1,120,80
Q2,140,85
\`\`\`

![A chart](https://example.com/img.png "Figure 1"){width=60%}

::pagebreak

:::columns{count=2}
Left and right text flows in two columns.
:::

:::suggest{type=insert by=claude note="adds a conclusion"}
A new concluding paragraph.
:::

\`\`\`ts
const x = 1
\`\`\`

---

Centered text. {.center}

::references
`
