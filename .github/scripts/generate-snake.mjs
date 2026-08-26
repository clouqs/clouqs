import fs from "node:fs";
import path from "node:path";

const USER = process.env.SNAKE_USER || "clouqs";
const TOKEN = process.env.SNAKE_TOKEN || process.env.GITHUB_TOKEN;
const FROM = process.env.SNAKE_FROM || "2025-01-01";
const TO = process.env.SNAKE_TO || new Date().toISOString().slice(0, 10);

if (!TOKEN) throw new Error("Missing GITHUB_TOKEN");

const LEVEL = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const LEVEL_NAME = [
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
];

const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              weekday
              date
            }
          }
        }
      }
    }
  }
`;

async function fetchRange(from, to) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "clouqs-snake",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: USER,
        from: `${from}T00:00:00Z`,
        to: `${to}T23:59:59Z`,
      },
    }),
  });

  const json = await res.json();
  if (!res.ok || json.errors?.[0]) {
    throw new Error(json.errors?.[0]?.message || (await res.text()));
  }

  return json.data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    (week) =>
      week.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVEL[d.contributionLevel] ?? 0,
        weekday: d.weekday,
      })),
  );
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clampYearWindow(from, to) {
  const windows = [];
  let start = from;
  while (start < to) {
    const maxEnd = addDays(start, 364);
    const end = maxEnd < to ? maxEnd : to;
    windows.push([start, end]);
    start = addDays(end, 1);
  }
  return windows;
}

const days = [];
const seen = new Set();
for (const [from, to] of clampYearWindow(FROM, TO)) {
  for (const day of await fetchRange(from, to)) {
    if (seen.has(day.date)) continue;
    seen.add(day.date);
    days.push(day);
  }
}

days.sort((a, b) => a.date.localeCompare(b.date));
const origin = new Date(`${days[0].date}T00:00:00Z`);
const cells = days.map((day) => {
  const d = new Date(`${day.date}T00:00:00Z`);
  const offset = Math.round((d.getTime() - origin.getTime()) / 86_400_000);
  return {
    x: Math.floor(offset / 7),
    y: d.getUTCDay(),
    date: day.date,
    count: day.count,
    level: day.level,
  };
});

const weeks = [];
for (const cell of cells) {
  weeks[cell.x] ??= { contributionDays: [] };
  weeks[cell.x].contributionDays.push({
    contributionCount: cell.count,
    contributionLevel: LEVEL_NAME[cell.level],
    weekday: cell.y,
    date: cell.date,
  });
}

const total = cells.reduce((sum, cell) => sum + cell.count, 0);
console.log(`contribution range ${FROM} → ${TO}: ${total} commits, ${weeks.length} weeks`);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/graphql")) {
    return new Response(
      JSON.stringify({
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: { weeks },
            },
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  return originalFetch(url, init);
};

const { generateSnakeAnimation } = await import("generate-snake-animation");

const githubDark = {
  sizeDotBorderRadius: 2,
  sizeCell: 16,
  sizeDot: 12,
  colorBackground: "#0c1116",
  colorDotBorder: "#1b1f230a",
  colorEmpty: "#161b22",
  colorDots: ["#161b22", "#01311f", "#034525", "#0f6d31", "#00c647"],
  colorSnake: "#2724DB",
};

const githubLight = {
  ...githubDark,
  colorBackground: "#ffffff",
  colorDotBorder: "#1b1f230a",
  colorEmpty: "#ebedf0",
  colorDots: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  colorSnake: "#2724DB",
};

const animationOptions = { frameByStep: 1, stepDurationMs: 100 };

const [darkSvg, lightSvg] = await generateSnakeAnimation(
  { platform: "github", username: USER, githubToken: TOKEN },
  [
    { format: "svg", drawOptions: githubDark, animationOptions },
    { format: "svg", drawOptions: githubLight, animationOptions },
  ],
);

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(
  path.join("dist", "github-contribution-grid-snake-dark.svg"),
  darkSvg,
);
fs.writeFileSync(
  path.join("dist", "github-contribution-grid-snake.svg"),
  lightSvg,
);
