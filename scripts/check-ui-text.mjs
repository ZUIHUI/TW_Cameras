import { readFileSync } from "node:fs";

const checks = [
  {
    file: "apps/web/src/components/NearbyTourismBlock.tsx",
    required: [
      "景點",
      "餐飲推薦",
      "活動",
      "Google Places",
      "附近暫無景點、餐飲推薦或活動資料。"
    ]
  },
  {
    file: "apps/web/src/App.tsx",
    required: ["Google 餐廳推薦暫時無法取得，已顯示可用餐飲資料。"]
  }
];

const mojibakePattern = /[�]|啁|擗|閫|撣|蝷|雿|摰|銝|瘣|鞈/;
const failures = [];

for (const check of checks) {
  const content = readFileSync(check.file, "utf8");

  for (const text of check.required) {
    if (!content.includes(text)) {
      failures.push(`${check.file} missing required text: ${text}`);
    }
  }

  if (mojibakePattern.test(content)) {
    failures.push(`${check.file} contains likely mojibake text.`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("UI text check passed.");
