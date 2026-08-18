import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import mariadb from "mariadb";
import { loadConfig } from "../src/config.js";

const START_MARKER = "<!-- GENERATED COLUMN ERD START -->";
const END_MARKER = "<!-- GENERATED COLUMN ERD END -->";
const outputPath = path.resolve("../migration-control/schema/HOIBOT_DATABASE_ERD.md");

type ColumnRow = {
  tableName: string;
  columnName: string;
  dataType: string;
  columnType: string;
  nullable: "YES" | "NO";
  columnKey: string;
};

type ForeignKeyRow = {
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
};

const groups: Array<{ title: string; matches: (table: string) => boolean }> = [
  { title: "식별자·채널", matches: (table) => /^(players|player_profiles|external_|channels$|channel_memberships|bot_|room_)/.test(table) },
  { title: "명령·실행·설정", matches: (table) => /^(event_inbox|operations|command_|outbox_|delivery_|common_|configuration_|game_servers|channel_server_)/.test(table) },
  { title: "재화·아이템·시장·패키지", matches: (table) => /^(currency_|item_|inventory_|market_|package_|bag_)/.test(table) },
  { title: "펫·미니펫·홈", matches: (table) => /^(player_pets|pet_|mini_pet_|owned_mini_|player_homes|furniture_|owned_furniture|home_)/.test(table) },
  { title: "길드·커뮤니티·공성전", matches: (table) => /^(guild|community_|castle_)/.test(table) },
  { title: "출석·이벤트·랭킹·시련탑", matches: (table) => /^(attendance_|player_attendance|event_|player_event_|game_mode_|boss_|leaderboard|tower_|player_tower_)/.test(table) },
  { title: "계정·관리자·권한", matches: (table) => /^(admin_|user_|account_|player_restrictions|player_pass_admin_|player_signup_)/.test(table) },
  { title: "모니터링·보존", matches: (table) => /^(normalized_|moderation_|retained_|channel_activity_|channel_name_|request_monitor_)/.test(table) },
  { title: "이관·시스템", matches: (table) => /^(legacy_|schema_migrations|db_connection_)/.test(table) }
];

function mermaidType(dataType: string): string {
  if (["bigint", "int", "smallint", "tinyint"].includes(dataType)) return "int";
  if (["decimal", "double", "float"].includes(dataType)) return "decimal";
  if (["datetime", "timestamp", "date", "time"].includes(dataType)) return "datetime";
  if (["json"].includes(dataType)) return "json";
  if (["text", "mediumtext", "longtext"].includes(dataType)) return "text";
  if (["blob", "binary", "varbinary"].includes(dataType)) return "binary";
  return "string";
}

function entityName(tableName: string): string {
  return tableName.toUpperCase();
}

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");

const connection = await mariadb.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  connectTimeout: config.database.connectTimeoutMs,
  charset: "utf8mb4",
  timezone: "Z",
  bigIntAsNumber: false
});

try {
  const columns = await connection.query<ColumnRow[]>(`
    SELECT
      TABLE_NAME AS tableName,
      COLUMN_NAME AS columnName,
      DATA_TYPE AS dataType,
      COLUMN_TYPE AS columnType,
      IS_NULLABLE AS nullable,
      COLUMN_KEY AS columnKey
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  const foreignKeys = await connection.query<ForeignKeyRow[]>(`
    SELECT
      TABLE_NAME AS tableName,
      COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS referencedTableName,
      REFERENCED_COLUMN_NAME AS referencedColumnName
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
  `);

  const tableColumns = new Map<string, ColumnRow[]>();
  for (const column of columns) {
    const list = tableColumns.get(column.tableName) ?? [];
    list.push(column);
    tableColumns.set(column.tableName, list);
  }
  const foreignKeyColumns = new Set(foreignKeys.map((key) => `${key.tableName}.${key.columnName}`));
  const unassigned = new Set(tableColumns.keys());
  const sections: string[] = [
    START_MARKER,
    "## 전체 물리 컬럼 ERD",
    "",
    `이 섹션은 Docker MariaDB \`${config.database.name}\`의 \`information_schema\`에서 생성한다. 총 ${tableColumns.size}개 테이블, ${columns.length}개 컬럼이다.`,
    ""
  ];

  for (const group of [...groups, { title: "기타", matches: () => true }]) {
    const tables = [...unassigned].filter(group.matches).sort();
    if (tables.length === 0) continue;
    for (const table of tables) unassigned.delete(table);
    const tableSet = new Set(tables);
    sections.push(`### ${group.title}`, "", "```mermaid", "erDiagram");
    for (const table of tables) {
      sections.push(`  ${entityName(table)} {`);
      for (const column of tableColumns.get(table) ?? []) {
        const keys: string[] = [];
        if (column.columnKey === "PRI") keys.push("PK");
        if (foreignKeyColumns.has(`${table}.${column.columnName}`)) keys.push("FK");
        if (column.columnKey === "UNI") keys.push("UK");
        const keySuffix = keys.length > 0 ? ` ${keys.join(",")}` : "";
        const detail = `${column.columnType}; ${column.nullable === "YES" ? "NULL" : "NOT NULL"}`.replaceAll('"', "'");
        sections.push(`    ${mermaidType(column.dataType)} ${column.columnName}${keySuffix} \"${detail}\"`);
      }
      sections.push("  }");
    }
    for (const key of foreignKeys) {
      if (tableSet.has(key.tableName) && tableSet.has(key.referencedTableName)) {
        sections.push(`  ${entityName(key.referencedTableName)} ||--o{ ${entityName(key.tableName)} : \"${key.columnName}\"`);
      }
    }
    sections.push("```", "");
  }
  sections.push(END_MARKER);

  const current = await readFile(outputPath, "utf8");
  const generated = sections.join("\n");
  const start = current.indexOf(START_MARKER);
  const end = current.indexOf(END_MARKER);
  const next = start >= 0 && end > start
    ? `${current.slice(0, start)}${generated}${current.slice(end + END_MARKER.length)}`
    : `${current.trimEnd()}\n\n${generated}\n`;
  await writeFile(outputPath, next, "utf8");
  process.stdout.write(`erd-generated tables=${tableColumns.size} columns=${columns.length}\n`);
} finally {
  await connection.end();
}
