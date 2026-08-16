import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.resolve(scriptDirectory, "../fixtures/missing-operational");

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
}

function syntheticKey(value, label) {
  if (typeof value !== "string" || !value.startsWith("synthetic_")) throw new Error(`${label} must use a synthetic identifier`);
}

const activity = JSON.parse(await readFile(path.join(fixtureDirectory, "petHomeActivityData.json"), "utf8"));
record(activity, "activity root");
for (const key of ["alerts", "recentVisitors", "petHomeSocial", "migrations"]) record(activity[key], `activity.${key}`);

for (const [owner, alerts] of Object.entries(activity.alerts)) {
  syntheticKey(owner, "alert owner");
  if (!Array.isArray(alerts)) throw new Error("alerts must be arrays");
  for (const alert of alerts) {
    record(alert, "alert");
    for (const key of ["type", "actorId", "createdAt"]) if (typeof alert[key] !== "string") throw new Error(`alert.${key} must be a string`);
    syntheticKey(alert.actorId, "alert actorId");
    if (typeof alert.read !== "boolean") throw new Error("alert.read must be boolean");
  }
}

for (const [owner, visitors] of Object.entries(activity.recentVisitors)) {
  syntheticKey(owner, "visitor owner");
  if (!Array.isArray(visitors)) throw new Error("recentVisitors must be arrays");
  for (const visitor of visitors) {
    record(visitor, "visitor");
    syntheticKey(visitor.visitorId, "visitorId");
    if (typeof visitor.visitedAt !== "string") throw new Error("visitedAt must be a string");
  }
}

for (const [owner, social] of Object.entries(activity.petHomeSocial)) {
  syntheticKey(owner, "social owner");
  record(social, "social");
  for (const key of ["followers", "following", "badges", "deletedBadgeIds"]) stringArray(social[key], `social.${key}`);
  stringArray(social.feedActivityDates, "social.feedActivityDates");
  if (social.equippedBadgeId !== null) syntheticKey(social.equippedBadgeId, "equippedBadgeId");
  const heartUsage = record(social.heartUsage, "social.heartUsage");
  if (typeof heartUsage.date !== "string" || typeof heartUsage.count !== "number" || heartUsage.count < 0) throw new Error("invalid heartUsage");
  const badgeStats = record(social.badgeStats, "social.badgeStats");
  for (const key of ["receivedComments", "receivedHomeLikes", "receivedReactions", "totalVisits"]) {
    if (typeof badgeStats[key] !== "number" || badgeStats[key] < 0) throw new Error(`invalid badgeStats.${key}`);
  }
  if (!Array.isArray(social.specialBadgeLogs)) throw new Error("specialBadgeLogs must be an array");
}

const placed = JSON.parse(await readFile(path.join(fixtureDirectory, "petHomePlacedFurniture.json"), "utf8"));
record(placed, "placed furniture root");
for (const [owner, furniture] of Object.entries(placed)) {
  syntheticKey(owner, "placed furniture owner");
  if (!Array.isArray(furniture)) throw new Error("placed furniture values must be arrays");
  for (const item of furniture) {
    record(item, "furniture item");
    syntheticKey(item.id, "furniture id");
    for (const key of ["name", "grade"]) if (typeof item[key] !== "string") throw new Error(`furniture.${key} must be a string`);
    for (const key of ["exp", "rate"]) if (typeof item[key] !== "number" || !Number.isFinite(item[key])) throw new Error(`furniture.${key} must be a finite number`);
  }
}

console.log(JSON.stringify({
  valid: true,
  fixtureDirectory,
  activityOwners: Object.keys(activity.petHomeSocial).length,
  placedFurnitureOwners: Object.keys(placed).length,
  placedFurnitureItems: Object.values(placed).reduce((total, items) => total + items.length, 0)
}, null, 2));
