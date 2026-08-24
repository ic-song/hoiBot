import { parseHomeUpgradeCommand } from "../src/home/home-upgrade-service.js";

const scenarios = [
  ["/집짓기", "home_upgrade_preview"], ["/집뚝딱", "home_upgrade_execute"], ["집뚝딱", "home_upgrade_execute"],
  ["/생각해본다", "home_upgrade_cancel"], ["생각해본다", "home_upgrade_cancel"], ["/집뚝딱 추가", null]
] as const;
const results = scenarios.map(([message, expected]) => ({ message, expected, actual: parseHomeUpgradeCommand(message) }));
if (results.some((row) => row.actual !== row.expected)) throw new Error("home upgrade shadow mismatch");
console.log(JSON.stringify({ passCount: results.length, liveTraffic: false, productionData: false, results }));
